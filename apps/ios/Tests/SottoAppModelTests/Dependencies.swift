import Foundation
import SottoCore

/// Scripted dependencies for the real AppModel.swift, compiled into this test target only.
@MainActor final class KeychainStore {
    static let failure = ClientError.rejected("Secure storage unavailable")
    static var items: [String: Data] = [:]
    static var locked = false
    func read<T: Decodable>(_ type: T.Type, account: String) throws -> T? {
        if Self.locked { throw Self.failure }
        guard let data = Self.items[account] else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
    func write<T: Encodable>(_ value: T, account: String) throws { Self.items[account] = try JSONEncoder().encode(value) }
    func remove(account: String) throws { Self.items[account] = nil }
}

struct HostRefusal: Error { let failure: WireFailure }

@MainActor final class HostConnection {
    static var instances: [HostConnection] = []
    static var failDetail = false
    static var holdDetail = false
    static var shell: JSONValue = .null
    static var detail: JSONValue = .null
    static var afterGreeting: ((HostConnection) -> Void)?
    var onPush: ((IncomingFrame, Int) -> Void)?
    var onDisconnect: (() -> Void)?
    var operations: [String] = []
    var disconnects = 0
    var detailStarted: (() -> Void)?
    var heldDetail: CheckedContinuation<JSONValue, Error>?
    var afterReply: ((String) -> Void)?
    var received = 0
    init() { Self.instances.append(self) }
    func connect(endpoint: HostEndpoint, pairing: Pairing) async throws -> Received<Hello> {
        let hello = try JSONValue.object(["hostId": .string(pairing.hostId), "clientId": .string(pairing.clientId),
            "shell": Self.shell, "capabilities": .object(["mayAnswer": .bool(false)])]).decode(Hello.self)
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
        if op == "shell" || op == "command" { return Self.shell }
        if op == "receipt" { return .object(["status": .string("unknown")]) }
        return .null
    }
    func disconnect() { disconnects += 1 }
    func close() { disconnect() }
    func health(endpoint: HostEndpoint) async throws -> Health { throw ClientError.disconnected }
    func pair(endpoint: HostEndpoint, expectedHostID: String, code: String) async throws -> Pairing { throw ClientError.disconnected }
    func revoke(endpoint: HostEndpoint, token: String) async throws {}
}
