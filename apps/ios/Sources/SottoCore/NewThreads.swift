import Foundation

public struct ThreadStartPreferences: Decodable, Sendable {
    public let newThreadModelId: String?; public let newThreadReasoningEffort: String?
}

/// Display data from this computer's own model catalog. IDs are opaque Sotto IDs.
public struct ThreadModel: Decodable, Identifiable, Sendable {
    public let id: String; public let name: String; public let provider: String; public let providerId: String?
    public let ready: Bool; public let recommended: Bool?
    public let reasoningEfforts: [String]?; public let defaultReasoningEffort: String?
    public let runtimeModes: [String]?; public let providerModes: [ProviderMode]?
    public struct ProviderMode: Decodable, Sendable {
        public let id: String; public let name: String; public let allows: String?; public let asks: String?
    }
    public var startingEffort: String {
        if let value = defaultReasoningEffort, reasoningEfforts?.contains(value) == true { return value }
        return reasoningEfforts?.first ?? ""
    }
    public var permissions: [ThreadPermission] {
        if let modes = providerModes, !modes.isEmpty {
            return modes.map { ThreadPermission(id: $0.id, name: $0.name, asks: $0.asks,
                                               grants: $0.allows != "nothing", providerOwned: true) }
        }
        let labels = ["approval-required": "Ask before actions", "auto-accept-edits": "Allow edits",
                      "auto": "Allow actions", "full-access": "Full access"]
        return (runtimeModes ?? []).compactMap { id in
            labels[id].map { ThreadPermission(id: id, name: $0, asks: nil,
                                             grants: id != "approval-required", providerOwned: false) }
        }
    }
    /// Prefer an asking mode. A grant is never selected just because Can answer is on.
    public var startingPermission: String { permissions.first { !$0.grants }?.id ?? "" }
}
public struct ThreadPermission: Identifiable, Sendable {
    public let id: String; public let name: String; public let asks: String?
    public let grants: Bool; public let providerOwned: Bool
}

public struct HostFolder: Decodable, Identifiable, Sendable {
    public let name: String; public let path: String; public let git: Bool
    public var id: String { path }
}
public struct FolderCrumb: Decodable, Sendable { public let name: String; public let path: String? }
public struct FolderListing: Decodable, Sendable {
    public let path: String?; public let home: String; public let separator: String
    public let crumbs: [FolderCrumb]; public let folders: [HostFolder]; public let truncated: Bool
    /// Use the host's spelling, including drive roots; never apply iPhone URL/path rules.
    public var projectName: String {
        let name = crumbs.last?.name ?? "Project"
        return name.hasSuffix(":") ? String(name.dropLast()) + " drive" : name == "/" ? "Root" : name
    }
}
public enum FolderResult: Decodable, Sendable {
    case listed(FolderListing), missing, unreadable
    private enum Keys: String, CodingKey { case status }
    public init(from decoder: Decoder) throws {
        switch try decoder.container(keyedBy: Keys.self).decode(String.self, forKey: .status) {
        case "listed":
            let value = try FolderListing(from: decoder)
            guard ["/", "\\"].contains(value.separator), !value.crumbs.isEmpty,
                  value.crumbs.count <= 256, value.folders.count <= 1000,
                  value.path == nil || !(value.path ?? "").isEmpty else { throw ClientError.invalidProtocol }
            self = .listed(value)
        case "missing": self = .missing
        case "unreadable": self = .unreadable
        default: throw ClientError.invalidProtocol
        }
    }
}

public enum NewThreads {
    public static func startingModelID(_ shell: Shell) -> String {
        if let selected = shell.configuration?.newThreadModelId, !selected.isEmpty { return selected }
        let available = availableModels(shell.host)
        return (available.first { $0.recommended == true } ?? available.first)?.id ?? ""
    }
    public static func startingEffort(_ model: ThreadModel, shell: Shell) -> String {
        guard let desired = shell.configuration?.newThreadReasoningEffort, !desired.isEmpty,
              let offered = model.reasoningEfforts, !offered.isEmpty else { return model.startingEffort }
        if offered.contains(desired) { return desired }
        let reference = shell.host.models?.first { $0.id == shell.configuration?.newThreadModelId }?.reasoningEfforts ?? offered
        guard let position = reference.firstIndex(of: desired), reference.count >= 2 else { return model.startingEffort }
        return offered[Int((Double(position) / Double(reference.count - 1) * Double(offered.count - 1)).rounded())]
    }
    public static func availableModels(_ host: HostSnapshot) -> [ThreadModel] {
        (host.models ?? []).filter { model in
            guard model.ready else { return false }
            if let providers = host.providers {
                guard let provider = providers.first(where: { $0.id == model.providerId }) else { return false }
                return provider.connection == "connected" && provider.capabilities.threads == true
            }
            return host.capabilities.threads == true
        }
    }
    /// The host declares its path format. Windows compares without case; POSIX preserves it.
    public static func sameFolder(_ lhs: String?, _ rhs: String, separator: String) -> Bool {
        guard let lhs else { return false }
        func key(_ value: String) -> String {
            let normalized = separator == "\\" ? value.replacingOccurrences(of: "\\", with: "/").lowercased() : value
            var result = normalized
            while result.count > 1 && result.hasSuffix("/") { result.removeLast() }
            return result
        }
        return key(lhs) == key(rhs)
    }
    public static func folderRequest(path: JSONValue? = nil) throws -> [String: JSONValue] {
        if let path, path != .null {
            guard let value = path.string, !value.isEmpty, value.utf16.count <= 4096 else { throw ClientError.invalidRequest }
        }
        return ["op": .string("host-folders"), "request": .object(path.map { ["path": $0] } ?? [:])]
    }
}
extension Commands {
    public static func createProject(providerID: String, title: String, path: String) throws -> JSONValue {
        guard ["codex", "claude", "grok", "devin"].contains(providerID),
              !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, title.utf16.count <= 512,
              !path.isEmpty, path.utf16.count <= 4096 else { throw ClientError.invalidRequest }
        return try RemoteCommands.checked(.object(["type": .string("create-project"), "provider": .string(providerID),
            "title": .string(title), "path": .string(path), "useExisting": .bool(true)]))
    }
    public static func createThread(projectID: String, threadID: String, model: ThreadModel,
                                    effort: String, permissionID: String, mayAnswer: Bool) throws -> JSONValue {
        guard !projectID.isEmpty, projectID.utf16.count <= 6144, UUID(uuidString: threadID) != nil,
              model.ready, !model.id.isEmpty, model.id.utf16.count <= 6144,
              let permission = model.permissions.first(where: { $0.id == permissionID }),
              !permission.grants || mayAnswer,
              effort.isEmpty || (model.reasoningEfforts?.contains(effort) == true && effort.utf16.count <= 64) else { throw ClientError.invalidRequest }
        var fields: [String: JSONValue] = ["type": .string("create-thread"), "projectId": .string(projectID),
            "threadId": .string(threadID), "title": .string("New thread"), "titleSource": .string("default"),
            "modelId": .string(model.id), "workingCopy": .string("shared"), "managed": .bool(false)]
        fields[permission.providerOwned ? "providerMode" : "runtimeMode"] = .string(permission.id)
        if !effort.isEmpty { fields["reasoningEffort"] = .string(effort) }
        return try RemoteCommands.checked(.object(fields))
    }
}
