import XCTest
@testable import SottoCore

final class PhoneTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ text: String) throws -> T { try JSONDecoder().decode(type, from: Data(text.utf8)) }
    private func thread(_ id: String, project: String = "p", status: String = "idle", requests: String = "[]") throws -> ThreadSummary {
        try decode(ThreadSummary.self, #"{"id":"\#(id)","projectId":"\#(project)","title":"\#(id)","status":"\#(status)","requests":\#(requests)}"#)
    }

    // MARK: Finding the host

    func testMachineNameAndFullAddressAreBothAccepted() throws {
        XCTAssertEqual(try HostFinder.read(" Forge "), .name("forge"))
        XCTAssertEqual(try HostFinder.read("forge.tail5c2e.ts.net"), .address(try HostEndpoint("https://forge.tail5c2e.ts.net")))
        XCTAssertEqual(try HostFinder.read("https://forge.tail5c2e.ts.net"), .address(try HostEndpoint("https://forge.tail5c2e.ts.net")))
        for typed in ["", "forge.example.com", "http://forge.tail5c2e.ts.net", "-forge", "for ge", "forge_1", "https://forge.tail5c2e.ts.net/path"] {
            XCTAssertThrowsError(try HostFinder.read(typed), typed)
        }
    }
    func testOnlyThisMachinesTailnetNameBecomesAnAddress() {
        XCTAssertEqual(HostFinder.endpoint(machine: "forge", resolvedName: "forge.tail5c2e.ts.net.")?.url.absoluteString, "https://forge.tail5c2e.ts.net")
        XCTAssertNil(HostFinder.endpoint(machine: "forge", resolvedName: "forge.example.com"))
        XCTAssertNil(HostFinder.endpoint(machine: "forge", resolvedName: "other.tail5c2e.ts.net"))
        XCTAssertNil(HostFinder.endpoint(machine: "forge", resolvedName: "forge"))
    }
    func testFindUsesTheFirstTailnetNameTheResolverGives() async throws {
        let found = try await HostFinder.find("forge") { _ in ["forge", "100.101.102.103", "forge.tail5c2e.ts.net"] }
        XCTAssertEqual(found.url.absoluteString, "https://forge.tail5c2e.ts.net")
        do { _ = try await HostFinder.find("forge") { _ in ["forge.lan"] }; XCTFail("A name off the tailnet must not be used") }
        catch { XCTAssertEqual(error as? ClientError, .hostNotFound("forge")) }
        let typed = try await HostFinder.find("forge.tail5c2e.ts.net") { _ in XCTFail("A full address needs no lookup"); return [] }
        XCTAssertEqual(typed.url.host, "forge.tail5c2e.ts.net")
    }
    func testOnlyTailscaleAddressesAreTrusted() {
        XCTAssertTrue(HostFinder.isTailnetAddress([100, 101, 102, 103]))
        XCTAssertTrue(HostFinder.isTailnetAddress([100, 127, 255, 1]))
        XCTAssertFalse(HostFinder.isTailnetAddress([100, 128, 0, 1]))
        XCTAssertFalse(HostFinder.isTailnetAddress([192, 168, 1, 20]))
        XCTAssertTrue(HostFinder.isTailnetAddress([0xfd, 0x7a, 0x11, 0x5c, 0xa1, 0xe0] + Array(repeating: 1, count: 10)))
        XCTAssertFalse(HostFinder.isTailnetAddress([0xfd, 0x00] + Array(repeating: 0, count: 14)))
    }
    func testHealthMustBeAReadyVersionOneHost() throws {
        let ready = try decode(Health.self, #"{"v":1,"status":"ready","hostId":"00000000-0000-4000-8000-000000000001","pid":7,"port":4455,"sottoVersion":"0.1.19","features":["detail-delta"]}"#)
        XCTAssertNoThrow(try ready.validate())
        XCTAssertThrowsError(try decode(Health.self, #"{"v":2,"status":"ready","hostId":"00000000-0000-4000-8000-000000000001"}"#).validate())
        XCTAssertThrowsError(try decode(Health.self, #"{"v":1,"status":"ready","hostId":"not-a-host"}"#).validate())
    }

    // MARK: Pairing code

    func testPairingCodeIsCleanedToTheHostsAlphabet() throws {
        XCTAssertEqual(try PairingCode.normalized("k7q4-mx9z"), "K7Q4MX9Z")
        XCTAssertEqual(try PairingCode.normalized(" K7Q4 MX9Z "), "K7Q4MX9Z")
        XCTAssertEqual(PairingCode.cleaned("k7q4mx9zzz"), "K7Q4MX9Z")
        for typed in ["K7Q4MX9", "K7Q4MX9O", "K7Q4MX91", "K7Q4MX9Z!", "K7Q4MX9ZZ"] { XCTAssertThrowsError(try PairingCode.normalized(typed), typed) }
    }

    // MARK: Threads

    func testStateWordsPutWaitingRequestsFirst() throws {
        let permission = #"[{"id":"r","kind":"permission","text":"Run?","options":[]}]"#
        let question = #"[{"id":"r","kind":"question","text":"Which?","options":[]}]"#
        XCTAssertEqual(ThreadState(try thread("a", status: "running", requests: permission)), .needsAnswer)
        XCTAssertEqual(ThreadState(try thread("b", requests: question)), .asked)
        XCTAssertEqual(ThreadState(try thread("c", status: "running")), .working)
        XCTAssertEqual(ThreadState(try thread("d", status: "error")), .failed)
        XCTAssertEqual(ThreadState(try thread("e")).words, "Done")
    }
    func testThreadsGroupUnderTheirProjectsAndFilter() throws {
        let projects = try decode([Project].self, #"[{"id":"p","title":"Sotto"},{"id":"q","title":"Releases"}]"#)
        let threads = [try thread("a", project: "q"), try thread("b", status: "running"), try thread("c", project: "gone")]
        let all = ThreadGroups.byProject(threads, projects: projects)
        XCTAssertEqual(all.map(\.title), ["Sotto", "Releases", "Other"])
        XCTAssertEqual(ThreadGroups.byProject(threads, projects: projects, filter: .working).flatMap { $0.threads.map(\.id) }, ["b"])
        XCTAssertEqual(ThreadGroups.byProject(threads, projects: projects, filter: .done).flatMap { $0.threads.map(\.id) }, ["a", "c"])
    }
    func testWaitingListsEveryRequestAndWorkingLeavesThemOut() throws {
        let two = #"[{"id":"r1","kind":"question","text":"One?","options":[]},{"id":"r2","kind":"permission","text":"Two?","options":[]}]"#
        let threads = [try thread("a", status: "running", requests: two), try thread("b", status: "running")]
        XCTAssertEqual(ThreadGroups.waiting(threads).map(\.id), ["a/r1", "a/r2"])
        XCTAssertEqual(ThreadGroups.working(threads).map(\.id), ["b"])
    }

    // MARK: Answering from a card

    func testOnlyASingleChoiceQuestionAnswersInOneTap() throws {
        let single = try decode(AgentRequest.self, #"{"id":"r","kind":"question","text":"Q","options":[],"questions":[{"id":"q","question":"Which?","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"multiSelect":false,"allowFreeText":true}]}"#)
        XCTAssertEqual(single.oneTapOptions?.map(\.id), ["a", "b"])
        let multi = try decode(AgentRequest.self, #"{"id":"r","kind":"question","text":"Q","options":[],"questions":[{"id":"q","question":"Which?","options":[{"id":"a","label":"A"}],"multiSelect":true,"allowFreeText":false}]}"#)
        XCTAssertNil(multi.oneTapOptions)
        let words = try decode(AgentRequest.self, #"{"id":"r","kind":"question","text":"Say?","options":[]}"#)
        XCTAssertNil(words.oneTapOptions)
        let legacy = try decode(AgentRequest.self, #"{"id":"r","kind":"question","text":"Pick","options":[{"id":"x","label":"X"}]}"#)
        XCTAssertEqual(legacy.oneTapOptions?.map(\.id), ["x"])
    }
    func testACardOffersOnlyAllowOnceAndDeny() throws {
        let request = try decode(AgentRequest.self, #"{"id":"r","kind":"permission","text":"Run?","options":[],"permissionChoices":[{"id":"1","label":"Allow once","kind":"allow-once"},{"id":"2","label":"Always","kind":"allow-always"},{"id":"3","label":"Deny","kind":"deny"}]}"#)
        XCTAssertEqual(request.cardPermissionChoices?.map(\.id), ["1", "3"])
        let unknown = try decode(AgentRequest.self, #"{"id":"r","kind":"permission","text":"Run?","options":[],"permissionChoices":[{"id":"1","label":"Auto","kind":"automatic"}]}"#)
        XCTAssertNil(unknown.cardPermissionChoices)
    }

    // MARK: Activity

    func testActivityDecodesAndNamesWhatItTouched() throws {
        let detail = try decode(ThreadDetail.self, #"""
        {"threadId":"t","revision":3,"messages":[],"activities":[
          {"id":"a","turnId":"u","sequence":2,"kind":"command","status":"running","title":"Running tests","command":"npm test"},
          {"id":"b","turnId":"u","sequence":1,"kind":"file-change","status":"completed","title":"Edited files","changes":[{"path":"src/a.ts","kind":"update"},{"path":"src/b.ts","kind":"add"}],"durationMs":1200},
          {"id":"c","turnId":"u","sequence":3,"kind":"something-new","status":"completed","title":"A later kind"}]}
        """#)
        let records = try XCTUnwrap(detail.activities)
        XCTAssertEqual(records.map(\.subject), ["npm test", "src/a.ts and 1 more", nil])
        XCTAssertEqual(records[2].kind, "something-new")
    }
    func testShellRowsReadTheirSummaryWhenPresent() throws {
        let row = try decode(ThreadSummary.self, #"{"id":"t","projectId":"p","title":"T","status":"running","requests":[],"summary":{"messageCount":4,"lastMessageAt":"2026-09-26T09:38:00.000Z","activityCount":2,"runningTurnStartedAt":"2026-09-26T09:40:00.000Z"}}"#)
        XCTAssertEqual(row.summary?.runningTurnStartedAt, "2026-09-26T09:40:00.000Z")
        XCTAssertNil(try thread("bare").summary)
    }
}
