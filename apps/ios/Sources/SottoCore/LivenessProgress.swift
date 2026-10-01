/// A partial message is progress even when its pong is still waiting behind the body.
public struct LivenessProgress: Sendable {
    public let bytes: Int64
    public let messages: Int
    public init(bytes: Int64, messages: Int) { self.bytes = bytes; self.messages = messages }
    public func isAlive(bytes: Int64, messages: Int, pong: Bool) -> Bool {
        pong || bytes > self.bytes || messages > self.messages
    }
}
