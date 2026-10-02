import Foundation

/// Local receive order, scoped to one socket connection. It is never a host revision or wire field.
public struct Received<Value: Sendable>: Sendable {
    public let value: Value
    public let sequence: Int
    public init(_ value: Value, sequence: Int) { self.value = value; self.sequence = sequence }
}

/// Decode pushes directly into the fields the phone displays. In particular, shell event pages
/// and unused activity bodies never become recursive JSONValue trees on the UI actor.
public enum IncomingFrame: Decodable, Sendable {
    case reply(id: String, result: JSONValue)
    case refusal(id: String, failure: WireFailure)
    case shell(Shell)
    case detail(threadID: String, value: ThreadDetail?)
    case delta(threadID: String, value: ThreadDetailDelta)
    case failure(WireFailure)

    private enum Keys: String, CodingKey { case v, id, ok, result, error, event, state, threadId, detail, delta }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        guard try c.decode(Int.self, forKey: .v) == 1 else { throw ClientError.invalidProtocol }
        if let event = try c.decodeIfPresent(String.self, forKey: .event) {
            switch event {
            case "shell": self = .shell(try c.decode(Shell.self, forKey: .state))
            case "detail": self = .detail(threadID: try c.decode(String.self, forKey: .threadId), value: try c.decode(Optional<ThreadDetail>.self, forKey: .detail))
            case "detail-delta": self = .delta(threadID: try c.decode(String.self, forKey: .threadId), value: try c.decode(ThreadDetailDelta.self, forKey: .delta))
            case "error": self = .failure(try c.decode(WireFailure.self, forKey: .error))
            default: throw ClientError.invalidProtocol
            }
        } else {
            let id = try c.decode(String.self, forKey: .id)
            if try c.decode(Bool.self, forKey: .ok) {
                self = .reply(id: id, result: try c.decode(JSONValue.self, forKey: .result))
            } else { self = .refusal(id: id, failure: try c.decode(WireFailure.self, forKey: .error)) }
        }
    }
}

public extension Wire {
    /// The phone reads snapshots, not event history. Match the desktop's v1 snapshot-only hello.
    static let snapshotHello: [String: JSONValue] = ["op": .string("hello"), "afterSeq": .number(9_007_199_254_740_991),
        "accepts": .array([.string("detail-delta"), .string("client-liveness")])]

    // Nonisolated async functions run on the generic executor in this package's Swift 5 mode.
    // Awaiting each frame before receiving the next keeps pushes and replies in socket order.
    static func readFrame(_ data: Data) async throws -> IncomingFrame {
        guard data.count <= maximumFrameBytes else { throw ClientError.invalidProtocol }
        return try JSONDecoder().decode(IncomingFrame.self, from: data)
    }
    static func readValue<T: Decodable & Sendable>(_ value: JSONValue, as type: T.Type) async throws -> T {
        try value.decode(type)
    }
}
