import XCTest
@testable import SottoCore

final class StreamingTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }
    private let detail = #"{"threadId":"t","revision":2,"earlierAvailable":true,"messages":[{"id":"m","role":"assistant","text":"Hello"}],"activities":[{"id":"a","sequence":1,"kind":"command","status":"running","title":"Testing"}]}"#

    func testStreamingAppendAndActivityCompletionKeepHistory() throws {
        let original = try decode(ThreadDetail.self, detail)
        let delta = try decode(ThreadDetailDelta.self, #"{"threadId":"t","baseRevision":2,"revision":3,"messageDeltas":[{"id":"m","appendText":" world"}],"activityDeltas":[{"record":{"id":"a","sequence":1,"kind":"command","status":"completed","title":"Tested"}}]}"#)
        let next = try XCTUnwrap(original.applying(delta))
        XCTAssertEqual(next.messages.first?.text, "Hello world")
        XCTAssertEqual(next.activities?.first?.status, "completed")
        XCTAssertEqual(next.earlierAvailable, true)
        XCTAssertEqual(next.revision, 3)
        XCTAssertEqual(original.messages.first?.text, "Hello")
    }
    func testMissingBaseAndUnknownAppendTargetRequireResync() throws {
        let original = try decode(ThreadDetail.self, detail)
        for json in [
            #"{"threadId":"t","baseRevision":1,"revision":3,"messageDeltas":[],"activityDeltas":[]}"#,
            #"{"threadId":"other","baseRevision":2,"revision":3,"messageDeltas":[],"activityDeltas":[]}"#,
            #"{"threadId":"t","baseRevision":2,"revision":2,"messageDeltas":[],"activityDeltas":[]}"#,
            #"{"threadId":"t","baseRevision":2,"revision":3,"messageDeltas":[{"id":"m","appendText":" discarded"},{"id":"missing","appendText":"x"}],"activityDeltas":[]}"#
        ] { XCTAssertNil(original.applying(try decode(ThreadDetailDelta.self, json))) }
        XCTAssertEqual(original.messages.first?.text, "Hello")
    }
    func testNewMessagesAndActivityRemoval() throws {
        let original = try decode(ThreadDetail.self, detail)
        let delta = try decode(ThreadDetailDelta.self, #"{"threadId":"t","baseRevision":2,"revision":4,"messageDeltas":[{"message":{"id":"n","role":"user","text":"Continue"}},{"message":{"id":"m","role":"assistant","text":"Updated"}}],"activityDeltas":[{"id":"a","removed":true}]}"#)
        let next = try XCTUnwrap(original.applying(delta))
        XCTAssertEqual(next.messages.map(\.id), ["m", "n"])
        XCTAssertEqual(next.messages.first?.text, "Updated")
        XCTAssertEqual(next.activities?.count, 0)
    }
    func testFullAndIncrementalFramesUseSameProtocol() async throws {
        let full = try await Wire.readFrame(Data("{\"v\":1,\"event\":\"detail\",\"threadId\":\"t\",\"detail\":\(detail)}".utf8))
        guard case .detail(let id, let snapshot) = full else { return XCTFail("Expected full detail") }
        XCTAssertEqual(id, "t"); XCTAssertEqual(snapshot?.revision, 2)
        let delta = try await Wire.readFrame(Data(#"{"v":1,"event":"detail-delta","threadId":"t","delta":{"threadId":"t","baseRevision":2,"revision":3,"messageDeltas":[],"activityDeltas":[]}}"#.utf8))
        guard case .delta(let threadID, let update) = delta else { return XCTFail("Expected delta") }
        XCTAssertEqual(threadID, "t"); XCTAssertEqual(snapshot?.applying(update)?.revision, 3)
        XCTAssertEqual(Wire.snapshotHello["afterSeq"], .number(9_007_199_254_740_991))
        XCTAssertEqual(Wire.snapshotHello["accepts"], .array([.string("detail-delta")]))
    }
    func testInvalidFramesAndUnrequestedPushesAreRefused() async {
        for json in [#"{"v":2,"event":"detail","threadId":"t","detail":null}"#,
                     #"{"v":1,"event":"unrecognized"}"#,
                     #"{"v":1,"id":"r","ok":true}"#] {
            do { _ = try await Wire.readFrame(Data(json.utf8)); XCTFail("Invalid frame accepted") } catch {}
        }
    }
    func testSettledGroupingMatchesDesktopAndKeepsWaitingRequests() throws {
        let cases: [(String, Bool)] = [
            ("", false), (#", "workspaceSettledAt":"2026-09-28""#, true),
            (#", "settledAt":"2026-09-28""#, true), (#", "settledOverride":"settled""#, true),
            (#", "settledAt":"2026-09-28", "settledOverride":"active""#, false),
            (#", "archivedAt":"2026-09-28", "settledOverride":"active""#, true),
            (#", "workspaceSettledAt":"", "settledAt":null"#, false)
        ]
        for (extra, expected) in cases {
            let thread = try decode(ThreadSummary.self, #"{"id":"t","projectId":"p","title":"Thread","status":"idle","requests":[]\#(extra)}"#)
            XCTAssertEqual(ThreadGroups.isSettled(thread), expected)
        }
        let project = try decode(Project.self, #"{"id":"p","title":"Project","workspaceSettledAt":"2026-09-28"}"#)
        let thread = try decode(ThreadSummary.self, #"{"id":"t","projectId":"p","title":"Thread","status":"idle","requests":[{"id":"r","kind":"question","text":"Ready?","options":[]}]}"#)
        let computer = ComputerThreads(hostID: "host", name: "Laptop", status: .online, threads: [thread], projects: [project])
        XCTAssertTrue(try XCTUnwrap(ThreadGroups.merged([computer]).first).settled)
        XCTAssertEqual(ThreadGroups.waiting([computer]).count, 1, "Settlement never hides a waiting question")
    }
}
