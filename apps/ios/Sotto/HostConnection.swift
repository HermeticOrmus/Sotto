import Foundation
import SottoCore

/// Credentials must never follow redirects, including to another private host.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor final class HostConnection {
    var onPush: ((IncomingFrame, Int) -> Void)?
    var onDisconnect: (() -> Void)?
    var onLiveness: (() -> Void)?
    private var answeredPing: UUID?
    private var liveness = LivenessProgress()
    private let redirects = NoRedirects()
    private var made: URLSession?
    /// Made on first use. A session holds its delegate until it is invalidated, so `close()` ends it.
    private var network: URLSession {
        if let made { return made }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        let session = URLSession(configuration: configuration, delegate: redirects, delegateQueue: nil)
        made = session
        return session
    }
    private var socket: URLSessionWebSocketTask?
    private var reader: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var pending: [String: CheckedContinuation<Received<JSONValue>, Error>] = [:]
    private var received = 0
    private var deadlines: [String: Task<Void, Never>] = [:]
    private var session = ""
    private var generation = UUID()

    /// Confirms Sotto is listening at the address before a code is spent on it. Ten seconds, because
    /// finding a computer may try two ports and nothing answering on the first is the usual miss.
    func health(endpoint: HostEndpoint) async throws -> Health {
        let name = endpoint.machine
        var request = URLRequest(url: endpoint.route("/v1/health")); request.httpMethod = "GET"; request.timeoutInterval = 10
        let fetched: (Data, URLResponse)
        do { fetched = try await network.data(for: request) } catch { throw ClientError.hostUnreachable(name) }
        let (data, response) = fetched
        guard let response = response as? HTTPURLResponse, response.url == endpoint.route("/v1/health"),
              (200..<300).contains(response.statusCode),
              let health = try? Wire.decode(data).decode(Health.self) else { throw ClientError.notASottoHost(name) }
        try health.validate()
        return health
    }
    /// Pairs only with the host `health` found: a different host answering at the same address is refused.
    func pair(endpoint: HostEndpoint, expectedHostID: String, code: String) async throws -> Pairing {
        let result = try await post(endpoint: endpoint, route: "/v1/pair", body: .object(["v": .number(1), "code": .string(code), "name": .string("iPhone")]))
        let pairing = try result.decode(Pairing.self); try pairing.validate()
        guard pairing.hostId == expectedHostID else { throw ClientError.invalidIdentity }
        return pairing
    }
    func revoke(endpoint: HostEndpoint, token: String) async throws {
        let result = try await post(endpoint: endpoint, route: "/v1/revoke", token: token)
        guard result["revoked"].bool == true else { throw ClientError.invalidProtocol }
    }
    func connect(endpoint: HostEndpoint, pairing: Pairing) async throws -> Received<Hello> {
        disconnect()
        let current = generation
        let result = try await post(endpoint: endpoint, route: "/v1/session", token: pairing.token)
        guard current == generation else { throw CancellationError() }
        let access = try result.decode(HostSession.self); try access.validate(pairing: pairing)
        session = access.session
        var request = URLRequest(url: endpoint.route("/v1/socket", socket: true))
        request.setValue("Bearer " + session, forHTTPHeaderField: "Authorization")
        let task = network.webSocketTask(with: request); task.maximumMessageSize = Wire.maximumFrameBytes
        socket = task; task.resume()
        reader = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    let message = try await task.receive()
                    let data: Data
                    switch message { case .string(let text): data = Data(text.utf8); case .data(let bytes): data = bytes; @unknown default: throw ClientError.invalidProtocol }
                    let frame = try await Wire.readFrame(data)
                    guard let self, self.generation == current else { return }
                    self.receive(frame)
                } catch {
                    guard let self, self.generation == current else { return }
                    self.disconnect(); self.onDisconnect?(); return
                }
            }
        }
        heartbeat = Task { [weak self] in
            var interval: UInt64 = 25_000_000_000
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: interval) } catch { return }
                guard let self, self.generation == current else { return }
                let ping = UUID()
                let messages = self.received
                task.sendPing { [weak self] error in
                    Task { @MainActor in
                        guard let self, self.generation == current, error == nil else { return }
                        self.answeredPing = ping
                    }
                }
                do { try await Task.sleep(nanoseconds: 10_000_000_000) } catch { return }
                guard self.generation == current else { return }
                let alive = self.received > messages || self.answeredPing == ping
                if self.liveness.shouldDisconnect(now: ProcessInfo.processInfo.systemUptime, messagesAdvanced: self.received > messages, pong: self.answeredPing == ping) {
                    self.disconnect(); self.onDisconnect?(); return
                }
                if alive { self.onLiveness?() }
                interval = 15_000_000_000
            }
        }
        let helloResult = try await callReceived(Wire.snapshotHello)
        let hello = try await Wire.readValue(helloResult.value, as: Hello.self)
        guard hello.hostId == pairing.hostId, hello.clientId == pairing.clientId else { disconnect(); throw ClientError.invalidIdentity }
        try hello.shell.validate(hostID: pairing.hostId)
        return Received(hello, sequence: helloResult.sequence)
    }
    /// Ends the connection and its URL session for good, when its computer is removed.
    func close() {
        disconnect(); made?.invalidateAndCancel(); made = nil
    }
    func disconnect() {
        generation = UUID(); liveness = LivenessProgress(); received = 0; answeredPing = nil; reader?.cancel(); reader = nil
        heartbeat?.cancel(); heartbeat = nil
        socket?.cancel(with: .goingAway, reason: nil); socket = nil; session = ""
        let waiting = pending; pending.removeAll()
        deadlines.values.forEach { $0.cancel() }; deadlines.removeAll()
        waiting.values.forEach { $0.resume(throwing: ClientError.disconnected) }
    }
    func call(_ operation: [String: JSONValue], id: String = UUID().uuidString) async throws -> JSONValue {
        try await callReceived(operation, id: id).value
    }
    func callReceived(_ operation: [String: JSONValue], id: String = UUID().uuidString) async throws -> Received<JSONValue> {
        guard let socket, !session.isEmpty else { throw ClientError.disconnected }
        let data = try Wire.request(id: id, session: session, operation: operation)
        guard data.count <= Wire.maximumFrameBytes else { throw ClientError.invalidRequest }
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            let operationName = operation["op"]?.string ?? ""
            liveness.beginRequest(id: id, operation: operationName, now: ProcessInfo.processInfo.systemUptime)
            let timeout = UInt64(LivenessProgress.requestTimeout(operation: operationName) * 1_000_000_000)
            deadlines[id] = Task { [weak self] in
                do { try await Task.sleep(nanoseconds: timeout) } catch { return }
                self?.finish(id: id, result: .failure(ClientError.uncertain))
            }
            Task { [weak self] in
                do { try await socket.send(.string(String(decoding: data, as: UTF8.self))) }
                catch { self?.finish(id: id, result: .failure(ClientError.uncertain)) }
            }
        }
    }
    private func receive(_ frame: IncomingFrame) {
        received += 1
        switch frame {
        case .reply(let id, let result): finish(id: id, result: .success(Received(result, sequence: received)))
        case .refusal(let id, let failure): finish(id: id, result: .failure(HostRefusal(failure: failure)))
        default: onPush?(frame, received)
        }
    }
    private func finish(id: String, result: Result<Received<JSONValue>, Error>) {
        liveness.finishRequest(id: id)
        deadlines.removeValue(forKey: id)?.cancel(); pending.removeValue(forKey: id)?.resume(with: result)
    }
    private func post(endpoint: HostEndpoint, route: String, token: String? = nil, body: JSONValue? = nil) async throws -> JSONValue {
        var request = URLRequest(url: endpoint.route(route)); request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONEncoder().encode(body) }
        let (data, response) = try await network.data(for: request)
        guard let response = response as? HTTPURLResponse, response.url == endpoint.route(route) else { throw ClientError.disconnected }
        // Retrying Forget after revocation succeeded but local deletion failed is safe.
        if route == "/v1/revoke" && response.statusCode == 401 { return .object(["v": .number(1), "revoked": .bool(true)]) }
        guard (200..<300).contains(response.statusCode) else { throw Self.refusal(route: route, status: response.statusCode, name: endpoint.machine) }
        return try Wire.decode(data)
    }
}
extension HostConnection {
    /// What a refused request means. Only 401 and 403 say the pairing is gone; anything else from a
    /// computer that answered (a 502 from Tailscale Serve while Sotto is closed there) means Sotto isn't running.
    nonisolated static func refusal(route: String, status: Int, name: String) -> ClientError {
        if route == "/v1/pair" && (400..<500).contains(status) {
            return .rejected("That code didn't work. Codes work once and last five minutes; get a new one on that computer.")
        }
        if status == 401 || status == 403 {
            return .rejected("This iPhone is no longer paired with \(name). Remove it in Computers and add it again.")
        }
        return .sottoNotRunning(name)
    }
}
struct HostRefusal: Error, LocalizedError {
    let failure: WireFailure
    var errorDescription: String? { failure.message }
}
