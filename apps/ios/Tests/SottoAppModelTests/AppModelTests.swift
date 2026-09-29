import XCTest
import SottoCore

final class AppModelTests: XCTestCase {
    @MainActor private func fixture() throws -> (AppModel, ThreadRef) {
        HostConnection.instances = []; HostConnection.failDetail = false; HostConnection.holdDetail = false; KeychainStore.items = [:]
        HostConnection.afterGreeting = nil
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
        connection.push(.delta(threadID: "t", value: delta))
        connection.push(.delta(threadID: "t", value: delta))
        await fulfillment(of: [started], timeout: 10)
        XCTAssertEqual(connection.operations.filter { $0 == "detail" }.count, 1)
        await model.select(nil)
        connection.heldDetail?.resume(returning: HostConnection.detail); connection.heldDetail = nil
        XCTAssertNil(model.selected)
        XCTAssertNil(model.detail(for: ref))
        XCTAssertTrue(model.online(ref.hostID))
    }
    @MainActor func testFinalDeltaDuringRepairTriggersAnotherRead() async throws {
        let (model, ref) = try fixture()
        model.phase(.active); await model.reconnectAll(); await model.select(ref)
        let connection = try XCTUnwrap(HostConnection.instances.last)
        HostConnection.holdDetail = true
        let first = expectation(description: "First repair")
        let second = expectation(description: "Repair includes final missed delta")
        connection.detailStarted = { first.fulfill() }
        func delta(_ base: Int, _ revision: Int) throws -> ThreadDetailDelta {
            try JSONDecoder().decode(ThreadDetailDelta.self, from: Data(#"{"threadId":"t","baseRevision":\#(base),"revision":\#(revision),"messageDeltas":[],"activityDeltas":[]}"#.utf8))
        }
        connection.push(.delta(threadID: "t", value: try delta(8, 9)))
        await fulfillment(of: [first], timeout: 10)
        connection.push(.delta(threadID: "t", value: try delta(9, 10)))
        connection.detailStarted = { second.fulfill() }
        let older = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"threadId":"t","revision":9,"messages":[]}"#.utf8))
        connection.heldDetail?.resume(returning: older); connection.heldDetail = nil
        await fulfillment(of: [second], timeout: 10)
        XCTAssertEqual(connection.operations.filter { $0 == "detail" }.count, 2)
        let final = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"threadId":"t","revision":10,"messages":[]}"#.utf8))
        connection.heldDetail?.resume(returning: final); connection.heldDetail = nil
        // No later push can rescue the display: the repair itself must reach the final revision.
        let deadline = Date().addingTimeInterval(10)
        while model.detail(for: ref)?.revision != 10 && Date() < deadline { await Task.yield() }
        XCTAssertEqual(model.detail(for: ref)?.revision, 10)
    }
    @MainActor private func newerShell() throws -> Shell {
        let json = String(decoding: try JSONEncoder().encode(HostConnection.shell), as: UTF8.self)
            .replacingOccurrences(of: "\"Thread\"", with: "\"New title\"")
        HostConnection.shell = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        return try HostConnection.shell.decode(Shell.self)
    }
    @MainActor func testHelloCannotReplaceAShellReceivedAfterIt() async throws {
        let (model, ref) = try fixture()
        HostConnection.afterGreeting = { connection in connection.push(.shell(try! self.newerShell())) }
        model.phase(.active); await model.reconnectAll()
        XCTAssertEqual(model.thread(ref)?.title, "New title")
    }
    @MainActor func testCommandReplyCannotReplaceANewerShellPush() async throws {
        let (model, ref) = try fixture()
        model.phase(.active); await model.reconnectAll()
        let connection = try XCTUnwrap(HostConnection.instances.last)
        connection.afterReply = { op in if op == "command" { connection.push(.shell(try! self.newerShell())) } }
        model.drafts[ref.id] = "Continue"
        await model.send(ref)
        XCTAssertEqual(model.thread(ref)?.title, "New title")
    }
    @MainActor func testDisconnectDuringHelloCannotMarkComputerOnlineAgain() async throws {
        let (model, ref) = try fixture()
        HostConnection.afterGreeting = { connection in connection.onDisconnect?() }
        model.phase(.active); await model.reconnectAll()
        XCTAssertEqual(model.status(ref.hostID), .unreachable)
    }
    @MainActor func testLiveShellTracksForegroundBackgroundAndCompletedWork() async throws {
        let (model, ref) = try fixture()
        model.phase(.active); await model.reconnectAll()
        let connection = try XCTUnwrap(HostConnection.instances.last)
        let original = String(decoding: try JSONEncoder().encode(HostConnection.shell), as: UTF8.self)
        func push(status: String, extra: String = "") async throws {
            let shell = original.replacingOccurrences(of: #""status":"idle""#, with: #""status":"\#(status)"\#(extra)"#)
            let frame = try await Wire.readFrame(Data(#"{"v":1,"event":"shell","state":\#(shell)}"#.utf8))
            connection.push(frame)
        }
        try await push(status: "running")
        XCTAssertEqual(ThreadState(try XCTUnwrap(model.thread(ref))), .working)
        XCTAssertEqual(ThreadGroups.working(model.lists).map(\.id), [ref.id])
        try await push(status: "idle", extra: #", "backgroundWork":[{"type":"subagent","id":"00000000-0000-4000-8000-000000000002","label":"Checking"}]"#)
        XCTAssertEqual(ThreadState(try XCTUnwrap(model.thread(ref))), .working)
        XCTAssertEqual(ThreadGroups.working(model.lists).map(\.id), [ref.id])
        XCTAssertTrue(ThreadGroups.merged(model.lists, filter: .done).isEmpty)
        try await push(status: "idle", extra: #", "backgroundWork":[]"#)
        XCTAssertEqual(ThreadState(try XCTUnwrap(model.thread(ref))), .done)
        XCTAssertTrue(ThreadGroups.working(model.lists).isEmpty)
        XCTAssertEqual(connection.disconnects, 0)
    }

}
