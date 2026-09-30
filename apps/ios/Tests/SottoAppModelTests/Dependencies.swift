import Foundation
import SottoCore

/// Scripted dependencies for the real AppModel.swift, compiled into this test target only.
@MainActor enum TestKeychain {
    static var items: [String: Data] = [:]
    static var locked = false
    static var unreadableAccount: String?
    static var store: KeychainStore {
        KeychainStore(readData: { account in
            if locked || account == unreadableAccount { throw KeychainStore.failure }
            return items[account]
        }, writeData: { data, account in
            if locked { throw KeychainStore.failure }
            items[account] = data
        }, removeItem: { account in
            if locked { throw KeychainStore.failure }
            items[account] = nil
        }, listAccounts: {
            if locked { throw KeychainStore.failure }
            return Array(items.keys)
        })
    }
}

struct HostRefusal: Error { let failure: WireFailure }

@MainActor final class HostConnection {
    static var instances: [HostConnection] = []
    static var failDetail = false
    static var holdDetail = false
    static var shell: JSONValue = .null
    static var detail: JSONValue = .null
    static var afterGreeting: ((HostConnection) -> Void)?
    static var mayAnswer = false
    static var receipt: JSONValue = .object(["status": .string("unknown")])
    static var loseAcknowledgement = false
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
            "shell": Self.shell, "capabilities": .object(["mayAnswer": .bool(Self.mayAnswer)])]).decode(Hello.self)
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
        if op == "command", Self.loseAcknowledgement { throw ClientError.uncertain }
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
        if op == "receipt" { return Self.receipt }
        return .null
    }
    func disconnect() { disconnects += 1 }
    func close() { disconnect() }
    func health(endpoint: HostEndpoint) async throws -> Health { throw ClientError.disconnected }
    func pair(endpoint: HostEndpoint, expectedHostID: String, code: String) async throws -> Pairing { throw ClientError.disconnected }
    func revoke(endpoint: HostEndpoint, token: String) async throws {}
}
