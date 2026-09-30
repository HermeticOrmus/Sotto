import Foundation
import SottoCore

/// Scripted dependencies for the real AppModel.swift, compiled into this test target only.
@MainActor final class KeychainStore {
    static let failure = ClientError.rejected("Secure storage unavailable")
    static var items: [String: Data] = [:]
    func read<T: Decodable>(_ type: T.Type, account: String) throws -> T? {
        try Self.items[account].map { try JSONDecoder().decode(type, from: $0) }
    }
    func write<T: Encodable>(_ value: T, account: String) throws { Self.items[account] = try JSONEncoder().encode(value) }
    func remove(account: String) throws { Self.items[account] = nil }
}

struct HostRefusal: Error, LocalizedError {
    let failure: WireFailure
    var errorDescription: String? { failure.message }
}

@MainActor final class HostConnection {
    static var instances: [HostConnection] = []
    static var failDetail = false
    static var holdDetail = false
    static var shell: JSONValue = .null
    static var detail: JSONValue = .null
    static var afterGreeting: ((HostConnection) -> Void)?
    static var shells: [String: JSONValue] = [:]
    static var mayAnswer = false
    static var features = ["host-folders"]
    static var commandHandler: ((String, JSONValue, String) async throws -> JSONValue)?
    static var folderHandler: ((String, JSONValue) async throws -> JSONValue)?
    static var receipts: [String: JSONValue] = [:]
    var onPush: ((IncomingFrame, Int) -> Void)?
    var onDisconnect: (() -> Void)?
    var operations: [String] = []
    var commands: [JSONValue] = []
    var hostID = ""
    var disconnects = 0
    var detailStarted: (() -> Void)?
    var heldDetail: CheckedContinuation<JSONValue, Error>?
    var afterReply: ((String) -> Void)?
    var received = 0
    init() { Self.instances.append(self) }
    func connect(endpoint: HostEndpoint, pairing: Pairing) async throws -> Received<Hello> {
        hostID = pairing.hostId
        let hello = try JSONValue.object(["hostId": .string(pairing.hostId), "clientId": .string(pairing.clientId),
            "shell": Self.shells[hostID] ?? Self.shell, "features": .array(Self.features.map(JSONValue.string)),
            "capabilities": .object(["mayAnswer": .bool(Self.mayAnswer)])]).decode(Hello.self)
        received += 1; let sequence = received
        Self.afterGreeting?(self)
        return Received(hello, sequence: sequence)
    }
    func push(_ frame: IncomingFrame) { received += 1; onPush?(frame, received) }
    func callReceived(_ operation: [String: JSONValue], id: String = UUID().uuidString) async throws -> Received<JSONValue> {
        let value = try await call(operation, id: id)
        received += 1; let sequence = received
        afterReply?(operation["op"]?.string ?? "")
        return Received(value, sequence: sequence)
    }
    func call(_ operation: [String: JSONValue], id: String = UUID().uuidString) async throws -> JSONValue {
        let op = operation["op"]?.string ?? ""
        operations.append(op)
        if op == "observe", case .array(let ids) = operation["threadIds"], let id = ids.first?.string {
            if Self.failDetail { throw ClientError.rejected("Thread read refused") }
            push(.detail(threadID: id, value: try Self.detail.decode(ThreadDetail.self)))
        }
        if op == "detail" {
            if Self.holdDetail {
                return try await withCheckedThrowingContinuation { continuation in
                    heldDetail = continuation; detailStarted?()
                }
            }
            return Self.detail
        }
        if op == "command" {
            let command = operation["command"] ?? .null; commands.append(command)
            if let handler = Self.commandHandler { return try await handler(hostID, command, id) }
            return Self.shells[hostID] ?? Self.shell
        }
        if op == "shell" { return Self.shells[hostID] ?? Self.shell }
        if op == "receipt" { return Self.receipts[operation["commandId"]?.string ?? ""] ?? .object(["status": .string("unknown")]) }
        if op == "host-folders", let handler = Self.folderHandler { return try await handler(hostID, operation["request"] ?? .null) }
        return .null
    }
    func disconnect() { disconnects += 1 }
    func close() { disconnect() }
    func health(endpoint: HostEndpoint) async throws -> Health { throw ClientError.disconnected }
    func pair(endpoint: HostEndpoint, expectedHostID: String, code: String) async throws -> Pairing { throw ClientError.disconnected }
    func revoke(endpoint: HostEndpoint, token: String) async throws {}
}
