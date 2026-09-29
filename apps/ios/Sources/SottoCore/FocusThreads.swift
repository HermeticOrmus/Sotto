import Foundation

/// One pass over the lightweight host list. Live requests and work outrank settlement; stale
/// snapshots remain readable but never claim to be current work or answerable requests.
public struct FocusThreads {
    public private(set) var questions: [HostedThread] = []
    public private(set) var working: [HostedThread] = []
    public private(set) var recent: [HostedThread] = []
    public private(set) var settled: [HostedThread] = []
    public let searching: Bool
    public var isEmpty: Bool { questions.isEmpty && working.isEmpty && recent.isEmpty && settled.isEmpty }
    public var requestCount: Int { questions.reduce(0) { $0 + $1.thread.requests.count } }

    public init(_ computers: [ComputerThreads], show: ComputerFilter = .all, query: String = "") {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        searching = !query.isEmpty
        for row in ThreadGroups.merged(computers, show: show) {
            let searchable = [row.thread.title, row.project ?? "", row.computer, row.thread.providerId ?? "",
                              row.thread.requests.map(\.text).joined(separator: " ")].joined(separator: " ")
            guard query.isEmpty || searchable.localizedStandardContains(query) else { continue }
            let state = ThreadState(row.thread)
            if row.reachable && state.waitsOnYou { questions.append(row) }
            else if row.reachable && state.workInProgress { working.append(row) }
            else if row.settled { settled.append(row) }
            else { recent.append(row) }
        }
    }
}
