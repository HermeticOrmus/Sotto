import XCTest
import SottoCore

final class AppModelTests: XCTestCase {
    @MainActor private func fixture() throws -> (AppModel, ThreadRef) {
        HostConnection.instances = []; HostConnection.failDetail = false; HostConnection.holdDetail = false; KeychainStore.items = [:]
        HostConnection.afterGreeting = nil
        KeychainStore.locked = false
        HostConnection.mayAnswer = false; HostConnection.receipt = .object(["status": .string("unknown")])
        HostConnection.loseAcknowledgement = false
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
    @MainActor func testLockedLaunchLoadsComputersAndMarkersWhenActiveAfterUnlock() async throws {
        let (_, ref) = try fixture()
        let marker = PendingOperation(hostID: ref.hostID, clientID: "phone", threadID: ref.threadID, draftID: "draft", kind: "reply")
        try KeychainStore().write([marker], account: ComputerStore.pendingAccount)
        KeychainStore.locked = true
        let model = AppModel()
        XCTAssertFalse(model.storageReady)
        XCTAssertTrue(model.computers.isEmpty)
        model.phase(.active)
        XCTAssertFalse(model.storageReady)
        KeychainStore.locked = false
        let reconnected = expectation(description: "Recovered computers connect when storage becomes readable")
        HostConnection.afterGreeting = { _ in reconnected.fulfill() }
        model.phase(.active)
        XCTAssertTrue(model.storageReady)
        XCTAssertEqual(model.computers.map(\.hostID), [ref.hostID])
        XCTAssertEqual(model.pending, [marker])
        XCTAssertNil(model.feedback)
        XCTAssertNil(model.pairFeedback)
        await fulfillment(of: [reconnected], timeout: 10)
        XCTAssertTrue(model.online(ref.hostID))
    }
    @MainActor func testUndecodableStorageItemsDoNotLockLaunch() throws {
        for account in [ComputerStore.indexAccount, ComputerStore.pendingAccount, ComputerStore.legacyAccount] {
            _ = try fixture()
            KeychainStore.items[account] = Data("incompatible item".utf8)
            let model = AppModel()
            XCTAssertTrue(model.storageReady, account)
            XCTAssertNil(model.feedback, account)
        }
        let (_, ref) = try fixture()
        KeychainStore.items[ComputerStore.account(ref.hostID)] = Data("incompatible computer".utf8)
        let model = AppModel()
        XCTAssertTrue(model.storageReady)
        XCTAssertTrue(model.computers.isEmpty)
    }
    @MainActor private func changeShell(status: String = "idle", requests: [[String: Any]] = [], error: String? = nil, deliveries: [[String: Any]] = []) throws -> Shell {
        var shell = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(HostConnection.shell)) as? [String: Any])
        var host = try XCTUnwrap(shell["host"] as? [String: Any])
        var threads = try XCTUnwrap(host["threads"] as? [[String: Any]])
        threads[0]["status"] = status; threads[0]["requests"] = requests
        host["threads"] = threads; shell["host"] = host; shell["error"] = error
        shell["deliveries"] = deliveries
        HostConnection.shell = try JSONDecoder().decode(JSONValue.self, from: JSONSerialization.data(withJSONObject: shell))
        return try HostConnection.shell.decode(Shell.self)
    }
    @MainActor private func modelWithMarker(_ marker: PendingOperation) throws -> AppModel {
        try KeychainStore().write([marker], account: ComputerStore.pendingAccount)
        return AppModel()
    }
    @MainActor func testCompletedReceiptDoesNotClaimAnAnswerWithItsRequestStillWaiting() async throws {
        let (_, ref) = try fixture()
        let marker = PendingOperation(hostID: ref.hostID, clientID: "phone", threadID: ref.threadID, requestID: "request", kind: "answer")
        _ = try changeShell(requests: [["id": "request", "kind": "permission", "text": "Read files?", "options": []]])
        HostConnection.receipt = .object(["status": .string("completed")])
        let model = try modelWithMarker(marker)
        model.phase(.active); await model.reconnectAll()
        XCTAssertEqual(model.pending, [marker])
        XCTAssertNotEqual(model.feedback, "Answer sent.")
    }
    @MainActor func testAnsweredRequestSettlesDespiteAnUnrelatedComputerError() async throws {
        let (_, ref) = try fixture()
        let marker = PendingOperation(hostID: ref.hostID, clientID: "phone", threadID: ref.threadID, requestID: "old", kind: "answer")
        _ = try changeShell(requests: [["id": "next", "kind": "permission", "text": "Read files?", "options": []]], error: "Another thread failed")
        HostConnection.mayAnswer = true
        let model = try modelWithMarker(marker)
        model.phase(.active); await model.reconnectAll()
        XCTAssertTrue(model.pending.isEmpty)
        XCTAssertEqual(model.feedback, "Answer sent.")
        XCTAssertTrue(model.canAnswer(try XCTUnwrap(model.thread(ref)?.requests.first), in: ref))
    }
    @MainActor func testUncertainOrMissingRequestThreadDoesNotConfirmAnAnswer() async throws {
        let (_, ref) = try fixture()
        let marker = PendingOperation(hostID: ref.hostID, clientID: "phone", threadID: ref.threadID, requestID: "request", kind: "answer")
        _ = try changeShell(requests: [["id": "request", "kind": "permission", "text": "Read files?", "options": [], "delivery": "uncertain"]])
        HostConnection.receipt = .object(["status": .string("completed")])
        let model = try modelWithMarker(marker)
        model.phase(.active); await model.reconnectAll()
        XCTAssertEqual(model.pending, [marker])
        let missing = PendingOperation(hostID: ref.hostID, clientID: "phone", threadID: "missing", requestID: "request", kind: "answer")
        let missingModel = try modelWithMarker(missing)
        missingModel.phase(.active); await missingModel.reconnectAll()
        XCTAssertEqual(missingModel.pending, [missing])
    }
    @MainActor func testStopRemainsAvailableAfterAReplyAcknowledgementIsLost() async throws {
        let (model, ref) = try fixture()
        model.phase(.active); await model.reconnectAll()
        let connection = try XCTUnwrap(HostConnection.instances.last)
        HostConnection.loseAcknowledgement = true
        model.drafts[ref.id] = "Continue"
        await model.send(ref)
        XCTAssertEqual(model.pending(for: ref).map(\.kind), ["reply"])
        connection.push(.shell(try changeShell(status: "running")))
        XCTAssertTrue(model.canInterrupt(ref))
        await model.interrupt(ref)
        XCTAssertEqual(model.pending(for: ref).map(\.kind), ["reply", "interrupt"])
        XCTAssertFalse(model.canInterrupt(ref), "An unconfirmed stop must not create duplicate stops")
    }
    @MainActor func testLiveShellSettlesALostReplyWithoutCheckingAgainOrResending() async throws {
        let (model, ref) = try fixture()
        model.phase(.active); await model.reconnectAll()
        let connection = try XCTUnwrap(HostConnection.instances.last)
        HostConnection.loseAcknowledgement = true
        model.drafts[ref.id] = "Continue"
        await model.send(ref)
        let marker = try XCTUnwrap(model.pending.first)
        let accepted = try changeShell(deliveries: [["threadId": ref.threadID, "draftId": try XCTUnwrap(marker.draftID), "status": "accepted"]])
        connection.onPush?(.shell(accepted), 1)
        XCTAssertEqual(model.pending, [marker], "An older shell cannot confirm delivery")
        connection.push(.shell(accepted))
        XCTAssertTrue(model.pending.isEmpty)
        XCTAssertTrue(model.canSend(ref))
        XCTAssertEqual(connection.operations.filter { $0 == "command" }.count, 1)
        XCTAssertEqual(connection.operations.filter { $0 == "receipt" }.count, 0)
        XCTAssertEqual(try KeychainStore().read([PendingOperation].self, account: ComputerStore.pendingAccount), [])
    }
    @MainActor func testLiveShellSettlesAnAnswerAndRestoresAFailedReply() async throws {
        let (_, ref) = try fixture()
        let answer = PendingOperation(hostID: ref.hostID, clientID: "phone", threadID: ref.threadID, requestID: "request", kind: "answer")
        _ = try changeShell(requests: [["id": "request", "kind": "permission", "text": "Read files?", "options": []]])
        let model = try modelWithMarker(answer)
        model.phase(.active); await model.reconnectAll()
        let connection = try XCTUnwrap(HostConnection.instances.last)
        connection.push(.shell(try changeShell()))
        XCTAssertTrue(model.pending.isEmpty)
        XCTAssertEqual(model.feedback, "Answer sent.")
        HostConnection.loseAcknowledgement = true
        model.drafts[ref.id] = "Keep this reply"
        await model.send(ref)
        let reply = try XCTUnwrap(model.pending.first)
        connection.push(.shell(try changeShell(deliveries: [["threadId": ref.threadID, "draftId": try XCTUnwrap(reply.draftID), "status": "failed"]])))
        XCTAssertTrue(model.pending.isEmpty)
        XCTAssertEqual(model.failedReplies[ref.id], "Keep this reply")
        model.restoreReply(ref)
        XCTAssertEqual(model.drafts[ref.id], "Keep this reply")
        XCTAssertTrue(model.online(ref.hostID))
    }
    @MainActor func testMarkerStorageFailureDuringPushDoesNotDisconnectComputer() async throws {
        let (_, ref) = try fixture()
        let marker = PendingOperation(hostID: ref.hostID, clientID: "phone", threadID: ref.threadID, draftID: "draft", kind: "reply")
        let model = try modelWithMarker(marker)
        model.phase(.active); await model.reconnectAll()
        let connection = try XCTUnwrap(HostConnection.instances.last)
        KeychainStore.locked = true
        connection.push(.shell(try changeShell(deliveries: [["threadId": ref.threadID, "draftId": "draft", "status": "accepted"]])))
        KeychainStore.locked = false
        XCTAssertEqual(model.pending, [marker])
        XCTAssertTrue(model.online(ref.hostID))
        XCTAssertEqual(connection.disconnects, 0)
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
