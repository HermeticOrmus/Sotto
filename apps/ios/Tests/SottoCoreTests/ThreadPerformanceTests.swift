import XCTest
@testable import SottoCore

final class ThreadPerformanceTests: XCTestCase {
    /// Opt-in stopwatch budget, as with the desktop performance suites. This is the real list path.
    func testBusyThreadListStaysWithinAnInteraction() throws {
        guard ProcessInfo.processInfo.environment["SOTTO_PERF_ASSERT"] == "1" else {
            throw XCTSkip("Set SOTTO_PERF_ASSERT=1 to measure list responsiveness")
        }
        let threads = try (0..<500).map { index in
            let second = (index * 137) % 500
            let stamp = String(format: "2026-09-28T12:%02d:%02d.000Z", second / 60, second % 60)
            let json = #"{"id":"\#(index)","projectId":"p","title":"Thread","status":"idle","requests":[],"summary":{"lastMessageAt":"\#(stamp)"}}"#
            return try JSONDecoder().decode(ThreadSummary.self, from: Data(json.utf8))
        }
        let computer = ComputerThreads(hostID: "host", name: "Laptop", status: .online, threads: threads)
        let start = Date()
        let rows = ThreadGroups.merged([computer])
        let elapsed = Date().timeIntervalSince(start)
        print("500-thread list: \(elapsed) seconds")
        XCTAssertEqual(rows.count, 500)
        XCTAssertLessThan(elapsed, 0.15, "Sorting one list blocks interaction on the UI actor")
    }
}
