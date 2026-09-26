import Foundation

/// How the phone words and sorts a thread. Pure, so the list, the tabs and the tests read one answer.
public enum ThreadState: String, Sendable {
    case needsAnswer, asked, working, failed, done

    public init(_ thread: ThreadSummary) {
        if let request = thread.requests.first { self = request.kind == "permission" ? .needsAnswer : .asked }
        else if thread.status == "running" { self = .working }
        else if thread.status == "error" { self = .failed }
        else { self = .done }
    }
    public var words: String {
        switch self {
        case .needsAnswer: return "Needs your answer"
        case .asked: return "Asked you a question"
        case .working: return "Working"
        case .failed: return "Turn failed"
        case .done: return "Done"
        }
    }
    public var waitsOnYou: Bool { self == .needsAnswer || self == .asked }
}

public enum ThreadFilter: String, CaseIterable, Identifiable, Sendable {
    case all = "All", working = "Working", done = "Done"
    public var id: String { rawValue }
    public func admits(_ thread: ThreadSummary) -> Bool {
        switch self {
        case .all: return true
        case .working: return ThreadState(thread) != .done
        case .done: return ThreadState(thread) == .done
        }
    }
}

public struct ProjectGroup: Identifiable, Sendable {
    public let id: String; public let title: String; public let threads: [ThreadSummary]
}

/// One request waiting on the user, with the thread it belongs to: a card on Needs you.
public struct Waiting: Identifiable, Sendable {
    public let thread: ThreadSummary; public let request: AgentRequest
    public var id: String { thread.id + "/" + request.id }
}

public enum ThreadGroups {
    /// Threads under their projects, in the order the host lists projects; threads whose project
    /// the shell does not name go last under "Other".
    public static func byProject(_ threads: [ThreadSummary], projects: [Project], filter: ThreadFilter = .all) -> [ProjectGroup] {
        let shown = threads.filter { $0.archivedAt == nil && filter.admits($0) }
        var groups = projects.compactMap { project -> ProjectGroup? in
            let members = shown.filter { $0.projectId == project.id }
            return members.isEmpty ? nil : ProjectGroup(id: project.id, title: project.title, threads: members)
        }
        let known = Set(projects.map(\.id))
        let rest = shown.filter { !known.contains($0.projectId) }
        if !rest.isEmpty { groups.append(ProjectGroup(id: "", title: "Other", threads: rest)) }
        return groups
    }
    /// Each open request with its thread, in the order the host lists threads.
    public static func waiting(_ threads: [ThreadSummary]) -> [Waiting] {
        threads.filter { $0.archivedAt == nil }.flatMap { thread in thread.requests.map { Waiting(thread: thread, request: $0) } }
    }
    public static func working(_ threads: [ThreadSummary]) -> [ThreadSummary] {
        threads.filter { $0.archivedAt == nil && $0.status == "running" && $0.requests.isEmpty }
    }
}

public extension AgentRequest {
    /// A question answered by one tap on its card: one single-choice question, or plain options.
    /// Anything else (several questions, several choices, words) opens the full answer sheet.
    var oneTapOptions: [RequestOption]? {
        guard kind == "question", supported else { return nil }
        if let questions, !questions.isEmpty {
            guard questions.count == 1, let q = questions.first, !q.multiSelect, !q.options.isEmpty, q.unavailableReason == nil else { return nil }
            return q.options
        }
        return options.isEmpty ? nil : options
    }
    /// The permission choices a card offers in place: allow once and deny. Others live in the sheet.
    var cardPermissionChoices: [PermissionChoice]? {
        guard kind == "permission", supported, let choices = permissionChoices else { return nil }
        let picked = choices.filter { $0.kind == "allow-once" || $0.kind == "deny" }
        return picked.isEmpty ? nil : picked
    }
}
