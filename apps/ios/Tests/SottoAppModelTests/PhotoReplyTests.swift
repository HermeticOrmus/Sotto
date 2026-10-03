import XCTest
import SottoCore

/// Photos from the reply box.
final class PhotoReplyTests: XCTestCase {
    private let host = "00000000-0000-4000-8000-000000000001"
    private func json(_ value: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(value.utf8)) }
    private func refusal(_ code: String, _ message: String) throws -> HostRefusal {
        HostRefusal(failure: try JSONDecoder().decode(WireFailure.self, from: Data(#"{"code":"\#(code)","message":"\#(message)"}"#.utf8)))
    }

    @MainActor private func fixture(supportsImages: Bool = true, features: [String] = ["host-folders", "attachment-staging"]) async throws -> (AppModel, ThreadRef) {
        TestKeychain.items = [:]; TestKeychain.locked = false; TestKeychain.unreadableAccount = nil; TestKeychain.unwritableAccount = nil
        HostConnection.instances = []; HostConnection.afterGreeting = nil; HostConnection.failDetail = false; HostConnection.holdDetail = false
        HostConnection.mayAnswer = false; HostConnection.receipt = .object(["status": .string("unknown")]); HostConnection.receipts = [:]
        HostConnection.loseAcknowledgement = false; HostConnection.features = features
        HostConnection.shells = [:]; HostConnection.commandHandler = nil; HostConnection.folderHandler = nil
        HostConnection.stageHandler = nil; HostConnection.previewHandler = nil
        let pairing = try json(#"{"v":1,"hostId":"\#(host)","clientId":"phone","token":"fixture"}"#).decode(Pairing.self)
        try TestKeychain.store.write([host], account: ComputerStore.indexAccount)
        try TestKeychain.store.write(SavedComputer(address: "https://laptop.example.ts.net:8443", pairing: pairing, reportedName: "Laptop"), account: ComputerStore.account(host))
        HostConnection.shell = try json(#"{"hostId":"\#(host)","host":{"hostId":"\#(host)","name":"Laptop","threads":[{"id":"t","projectId":"p","title":"Thread","status":"idle","requests":[],"modelId":"m"}],"projects":[],"models":[{"id":"m","name":"Model","provider":"Claude","ready":true,"supportsImages":\#(supportsImages)}],"capabilities":{"submit":true,"interrupt":true,"questions":true,"permissions":true}}}"#)
        HostConnection.detail = try json(#"{"threadId":"t","revision":1,"messages":[]}"#)
        var staged = 0
        HostConnection.stageHandler = { image in
            staged += 1
            return try self.json(#"{"id":"staged-\#(staged)","name":\#(String(decoding: try JSONEncoder().encode(image["name"]), as: UTF8.self)),"mimeType":"image/jpeg","sizeBytes":4,"digest":"\#(String(repeating: "d", count: 64))"}"#)
        }
        // A reply the computer takes comes back accepted, as the desktop answers once the provider has it.
        HostConnection.commandHandler = { _, command, id in
            guard case .object(var root) = HostConnection.shell else { throw ClientError.invalidProtocol }
            if command["type"] == .string("manual-send") {
                root["deliveries"] = .array([.object(["threadId": command["threadId"], "draftId": command["draftId"], "status": .string("accepted")])])
            }
            HostConnection.shell = .object(root)
            HostConnection.receipts[id] = .object(["status": .string("completed")])
            return HostConnection.shell
        }
        let model = AppModel(keychain: TestKeychain.store,
                             preparePhoto: { _, name in PreparedPhoto(name: name + ".jpg", mimeType: "image/jpeg", base64: "/9j/AA==", byteCount: 4, dimensions: nil, thumbnail: nil) })
        model.phase(.active); await model.waitForActivation()
        return (model, ThreadRef(hostID: host, threadID: "t"))
    }
    private func source(_ name: String = "Photo 1") -> PhotoSource { PhotoSource(name: name) { Data([1, 2, 3]) } }
    @MainActor private func sent(_ connection: HostConnection) -> [JSONValue] {
        connection.commands.filter { $0["type"] == .string("manual-send") }
    }

    @MainActor func testAPhotoReplyIsSentOnceByHandleEvenWhenPressedTwice() async throws {
        let (model, ref) = try await fixture()
        let connection = try XCTUnwrap(HostConnection.instances.last)
        model.attachPhotos(ref, from: [source()])
        await model.waitForPhotos()
        XCTAssertEqual(model.photos(ref).first?.staged?.id, "staged-1")
        XCTAssertTrue(model.canSendReply(ref), "Photos alone are a reply")
        async let first: Void = model.send(ref)
        async let second: Void = model.send(ref)
        _ = await (first, second)
        let replies = sent(connection)
        XCTAssertEqual(replies.count, 1)
        guard case .array(let images) = replies[0]["attachments"] else { return XCTFail("The reply carried no photos") }
        XCTAssertEqual(images.map { $0["id"] }, [.string("staged-1")])
        XCTAssertEqual(replies[0]["text"], .string(""))
        XCTAssertEqual(connection.operations.filter { $0 == "stage-attachment" }.count, 1, "A fresh handle is not staged again")
        XCTAssertTrue(model.photos(ref).isEmpty)
        XCTAssertTrue(model.pending.isEmpty)
    }
    @MainActor func testAPhotoThatNeverReachedTheComputerIsStagedWhenTheReplyIsSent() async throws {
        let (model, ref) = try await fixture()
        let connection = try XCTUnwrap(HostConnection.instances.last)
        let working = HostConnection.stageHandler
        HostConnection.stageHandler = { _ in throw ClientError.readTimedOut }
        model.attachPhotos(ref, from: [source()])
        await model.waitForPhotos()
        XCTAssertEqual(model.photos(ref).count, 1, "A photo that couldn't reach the computer stays in the box")
        XCTAssertNil(model.photos(ref).first?.staged)
        XCTAssertNil(model.photoNotices[ref.id])
        HostConnection.stageHandler = working
        model.drafts[ref.id] = "Here it is"
        await model.send(ref)
        XCTAssertEqual(sent(connection).count, 1)
        XCTAssertEqual(sent(connection).first?["text"], .string("Here it is"))
        XCTAssertEqual(connection.operations.filter { $0 == "stage-attachment" }.count, 2)
    }
    @MainActor func testAPhotoTheComputerRefusesLeavesTheBoxWithItsReason() async throws {
        let (model, ref) = try await fixture()
        let refused = try refusal("invalid_request", "Only PNG, JPEG, GIF, and WebP screenshots can be attached.")
        HostConnection.stageHandler = { _ in throw refused }
        model.attachPhotos(ref, from: [source()])
        await model.waitForPhotos()
        XCTAssertTrue(model.photos(ref).isEmpty)
        XCTAssertEqual(model.photoNotices[ref.id], "Only PNG, JPEG, GIF, and WebP screenshots can be attached.")
        XCTAssertFalse(model.canSendReply(ref))
    }
    @MainActor func testAPhotoThatCantBeReadIsNotAddedAndSaysSo() async throws {
        let (model, ref) = try await fixture()
        model.attachPhotos(ref, from: [PhotoSource(name: "Photo 1") { throw CocoaError(.fileReadCorruptFile) }])
        await model.waitForPhotos()
        XCTAssertTrue(model.photos(ref).isEmpty)
        XCTAssertEqual(model.photoNotices[ref.id], PhotoPipelineError.unreadable.errorDescription)
    }
    @MainActor func testAReplyCarriesAtMostEightPhotos() async throws {
        let (model, ref) = try await fixture()
        model.attachPhotos(ref, from: (1...10).map { source("Photo \($0)") })
        XCTAssertEqual(model.photos(ref).count, PhotoLimits.count)
        XCTAssertEqual(model.photoNotices[ref.id], "A reply can carry 8 photos. The others weren’t added.")
        await model.waitForPhotos()
        model.attachPhotos(ref, from: [source()])
        XCTAssertEqual(model.photos(ref).count, PhotoLimits.count)
    }
    @MainActor func testPhotosNeverGoToAModelThatCantTakeThem() async throws {
        let (model, ref) = try await fixture(supportsImages: false)
        XCTAssertEqual(model.photoSupport(ref), .modelCannot)
        model.attachPhotos(ref, from: [source()])
        XCTAssertTrue(model.photos(ref).isEmpty)
        let (older, olderRef) = try await fixture(features: ["host-folders"])
        XCTAssertEqual(older.photoSupport(olderRef), .needsUpdate)
    }
    @MainActor func testARefusedPhotoReplyComesBackWithItsPhotos() async throws {
        let (model, ref) = try await fixture()
        let refused = try refusal("invalid_request", "That reply was refused.")
        HostConnection.commandHandler = { _, _, _ in throw refused }
        model.attachPhotos(ref, from: [source(), source("Photo 2")])
        await model.waitForPhotos()
        await model.send(ref)
        XCTAssertTrue(model.pending.isEmpty)
        XCTAssertEqual(model.failedReplies[ref.id], "")
        XCTAssertEqual(model.failedPhotos[ref.id]?.count, 2)
        XCTAssertTrue(model.photos(ref).isEmpty)
        model.restoreReply(ref)
        XCTAssertEqual(model.photos(ref).count, 2)
        XCTAssertNil(model.failedPhotos[ref.id])
    }
}
