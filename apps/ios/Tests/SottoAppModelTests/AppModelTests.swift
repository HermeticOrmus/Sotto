import XCTest
import SottoCore

final class AppModelTests: XCTestCase {
    @MainActor private func fixture() throws -> (AppModel, ThreadRef) {
        HostConnection.instances = []; HostConnection.failDetail = false; HostConnection.holdDetail = false; KeychainStore.items = [:]
        let host = "00000000-0000-4000-8000-000000000001"
        let pairing = try JSONDecoder().decode(Pairing.self, from: Data(#"{"v":1,"hostId":"\#(host)","clientId":"phone","token":"fixture"}"#.utf8))
        let saved = SavedComputer(address: "https://laptop.example.ts.net:8443", pairing: pairing, reportedName: "Laptop")
        let store = KeychainStore()
        try store.write([host], account: ComputerStore.indexAccount)
        try store.write(saved, account: ComputerStore.account(host))
        HostConnection.shell = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"hostId":"\#(host)","host":{"hostId":"\#(host)","name":"Laptop","threads":[{"id":"t","projectId":"p","title":"Thread","status":"idle","requests":[]}],"projects":[],"capabilities":{"submit":true,"interrupt":true,"questions":true,"permissions":true}}}"#.utf8))
        HostConnection.detail = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"threadId":"t","revision":1,"messages":[{"id":"m","role":"assistant","text":"Ready"}]}"#.utf8))
        return (AppModel(), ThreadRef(hostID: host, threadID: "t"))
    }
    @MainActor func testAThreadReadFailureDoesNotDisconnectItsOnlineComputer() async throws {
        let (model, ref) = try fixture()
        await model.select(ref)
        HostConnection.failDetail = true
        model.phase(.active)
        await model.reconnectAll()
        XCTAssertTrue(model.online(ref.hostID), "The session and shell succeeded; a failed thread read must not require reconnecting")
        XCTAssertEqual(HostConnection.instances.last?.disconnects, 0)
    }
    @MainActor func testOpeningAThreadUsesTheObservedDetailOnce() async throws {
        let (model, ref) = try fixture()
        model.phase(.active)
        await model.reconnectAll()
        await model.select(ref)
        XCTAssertEqual(model.detail(for: ref)?.messages.first?.text, "Ready")
        XCTAssertEqual(HostConnection.instances.last?.operations.filter { $0 == "detail" }.count, 0,
                       "observe already sent the initial detail; do not download it again")
        XCTAssertEqual(HostConnection.instances.last?.operations.filter { $0 == "shell" }.count, 0,
                       "No pending delivery needs another copy of the shell")
    }
    @MainActor func testSeveralMissingDeltaBasesShareOneReadAndCannotRestoreAClosedThread() async throws {
        let (model, ref) = try fixture()
        model.phase(.active); await model.reconnectAll(); await model.select(ref)
        let connection = try XCTUnwrap(HostConnection.instances.last)
        let started = expectation(description: "Full detail read after a revision gap")
        connection.detailStarted = { started.fulfill() }; HostConnection.holdDetail = true
        let delta = try JSONDecoder().decode(ThreadDetailDelta.self, from: Data(#"{"threadId":"t","baseRevision":8,"revision":9,"messageDeltas":[],"activityDeltas":[]}"#.utf8))
        connection.onPush?(.delta(threadID: "t", value: delta))
        connection.onPush?(.delta(threadID: "t", value: delta))
        await fulfillment(of: [started], timeout: 10)
        XCTAssertEqual(connection.operations.filter { $0 == "detail" }.count, 1)
        await model.select(nil)
        connection.heldDetail?.resume(returning: HostConnection.detail); connection.heldDetail = nil
        XCTAssertNil(model.selected)
        XCTAssertNil(model.detail(for: ref))
        XCTAssertTrue(model.online(ref.hostID))
    }
}
