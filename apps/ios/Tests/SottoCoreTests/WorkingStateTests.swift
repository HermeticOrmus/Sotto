import XCTest
@testable import SottoCore

final class WorkingStateTests: XCTestCase {
    private func thread(_ extra: String = "", status: String = "idle", requests: String = "[]") throws -> ThreadSummary {
        try JSONDecoder().decode(ThreadSummary.self, from: Data(#"{"id":"t","projectId":"p","title":"Thread","status":"\#(status)","requests":\#(requests)\#(extra)}"#.utf8))
    }
    func testConfirmedBackgroundAgentRemainsWorkingAfterItsTurnEnds() throws {
        let active = try thread(#", "backgroundWork":[{"id":"00000000-0000-4000-8000-000000000002","label":"Checking","type":"subagent"}]"#)
        XCTAssertEqual(ThreadState(active), .working)
        XCTAssertTrue(ThreadFilter.working.admits(active))
        XCTAssertFalse(ThreadFilter.done.admits(active))
        let computer = ComputerThreads(hostID: "h", name: "Laptop", status: .online, threads: [active])
        XCTAssertEqual(ThreadGroups.working([computer]).map(\.id), ["h/t"])
    }
    func testRunningCompactionIsNotDone() throws {
        let active = try thread(#", "compaction":{"commandId":"c","status":"running"}"#)
        XCTAssertEqual(ThreadState(active), .compacting)
        XCTAssertEqual(ThreadState(active).words, "Compacting context")
        XCTAssertTrue(ThreadState(active).workInProgress)
        XCTAssertTrue(ThreadFilter.working.admits(active))
        XCTAssertFalse(ThreadFilter.done.admits(active))
    }
    func testForegroundTurnIsWorkingAndIdleIsDone() throws {
        XCTAssertEqual(ThreadState(try thread(status: "running")), .working)
        XCTAssertEqual(ThreadState(try thread()), .done)
    }
    func testBackgroundCommandsWaitAndMixedWorkWorks() throws {
        let command = try thread(#", "backgroundWork":[{"type":"command"}]"#)
        XCTAssertEqual(ThreadState(command), .waiting)
        XCTAssertEqual(ThreadState(command).words, "Waiting")
        XCTAssertTrue(ThreadState(command).workInProgress)
        XCTAssertTrue(ThreadFilter.working.admits(command))
        XCTAssertFalse(ThreadFilter.done.admits(command))
        let mixed = try thread(#", "backgroundWork":[{"type":"command"},{"type":"subagent"}]"#)
        XCTAssertEqual(ThreadState(mixed), .working)
        let future = try thread(#", "backgroundWork":[{"type":"future-agent"}]"#)
        XCTAssertEqual(ThreadState(future), .working)
    }
    func testRequestsAndErrorsOutrankBackgroundWork() throws {
        let work = #", "backgroundWork":[{"type":"subagent"}],"compaction":{"status":"running"}"#
        let question = try thread(work, requests: #"[{"id":"q","kind":"question","text":"Ready?","options":[]}]"#)
        let permission = try thread(work, requests: #"[{"id":"p","kind":"permission","text":"Allow?","options":[]}]"#)
        XCTAssertEqual(ThreadState(question), .asked)
        XCTAssertEqual(ThreadState(permission), .needsAnswer)
        XCTAssertEqual(ThreadState(try thread(work, status: "error")), .failed)
        let computer = ComputerThreads(hostID: "h", name: "Laptop", status: .online, threads: [question])
        XCTAssertTrue(ThreadGroups.working([computer]).isEmpty)
        XCTAssertEqual(ThreadGroups.waiting([computer]).count, 1)
    }
    func testOnlyCurrentConfirmedWorkCountsAsWorking() throws {
        for extra in [#", "backgroundWork":[]"#, #", "backgroundWork":null"#,
                      #", "compaction":{"status":"completed"}"#, #", "compaction":{"status":"failed"}"#,
                      #", "summary":{"runningTurnStartedAt":"2026-09-28T12:00:00Z"},"activities":[{"status":"running"}]"#,
                      #", "monitoring":[{"id":"m","label":"Watching"}]"#] {
            XCTAssertEqual(ThreadState(try thread(extra)), .done)
        }
        let active = try thread(#", "backgroundWork":[{"type":"subagent"}]"#)
        let offline = ComputerThreads(hostID: "h", name: "Laptop", status: .unreachable, threads: [active])
        XCTAssertTrue(ThreadGroups.working([offline]).isEmpty)
    }

}
