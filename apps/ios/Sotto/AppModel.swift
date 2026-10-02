import Foundation
import SwiftUI
import SottoCore

/// A computer step 1 of adding found at a private address, with the health it answered.
struct FoundHost: Equatable {
    let endpoint: HostEndpoint; let health: Health
    /// The computer's own name, or its name on the tailnet from a host that sends none.
    var name: String { health.computerName ?? endpoint.machine }
}

/// What this iPhone knows about one paired computer while the app runs. Nothing here is saved.
struct Live {
    var status = ComputerStatus.connecting
    var shell: Shell?
    var mayAnswer = false
    var features: [String] = []
    /// Why the last connection ended, for the computer's own page.
    var problem: String?
}

/// Every paired computer, each with its own connection, session and state. A computer that can't be
/// reached, or fails, never holds up the others. Everything that names a thread names its computer too.
@MainActor final class AppModel: ObservableObject {
    private static let requestNoLongerWaiting = "That request is no longer waiting."
    private static let markersUnreadable = "Saved unconfirmed actions could not be read. Check your threads before sending again. Nothing was resent."
    private static func pairingWarning(_ hostID: String) -> String {
        "Pair computer \(hostID) again. Its saved connection details could not be read."
    }
    /// In the order they were added. Credentials live in the Keychain, one item per host ID.
    @Published private(set) var computers: [SavedComputer] = []
    @Published private(set) var live: [String: Live] = [:]
    @Published private(set) var selected: ThreadRef?
    @Published private(set) var pending: [PendingOperation] = []
    /// Finding or pairing a computer.
    @Published private(set) var working = false
    @Published private(set) var storageReady = false
    /// The computer being removed, while its pairing is revoked.
    @Published private(set) var removing: String?
    /// What just happened on the tabs.
    @Published var feedback: String? { didSet { feedbackOperations = [] } }
    private var feedbackOperations: Set<String> = []
    private var dispatchingAnswers: Set<String> = []
    /// More than one check can await the same computer; keep markers until every check returns.
    private var deliveryChecks: [String: Int] = [:]
    /// What went wrong while finding or pairing a computer.
    @Published var pairFeedback: String?
    /// Unsent replies, by `ThreadRef.id`.
    @Published var drafts: [String: String] = [:]
    @Published private(set) var submitted: [String: String] = [:]
    @Published private(set) var failedReplies: [String: String] = [:]
    /// The computer step 1 of adding found, waiting for its code in step 2.
    @Published private(set) var found: FoundHost?
    /// Whether the Add computer sheet is over the tabs.
    @Published var adding = false
    @Published private(set) var creatingHostID: String?
    @Published var creationFeedback: String?
    /// The computer menu on Threads.
    @Published var show = ComputerFilter.all
    @Published private var openDetail: ThreadDetail?
    @Published private(set) var detailProblem: String?
    private let keychain: KeychainStore
    private var computerIndexAccount: String? = ComputerStore.indexAccount
    /// Finds and pairs computers; each paired computer gets its own connection.
    private let finder = HostConnection()
    private var connections: [String: HostConnection] = [:]
    private var generations: [String: UUID] = [:]
    private var connecting: Set<String> = [] { didSet { releaseConnectWaiters() } }
    /// Requests to connect a computer that was already connecting, each waiting for that attempt to end.
    private var connectWaiters: [String: [CheckedContinuation<Void, Never>]] = [:]
    private var active = false
    private var retries: [String: Task<Void, Never>] = [:]
    private var retryAttempts: [String: Int] = [:]
    private let retryJitter: @Sendable () -> Double
    private let retrySleep: @Sendable (UInt64) async throws -> Void
    private var pairGeneration = UUID()
    private var detailVersion = 0
    private var detailReload: Task<Void, Never>?
    private var detailReloadID: UUID?
    private var detailWantedRevision = 0
    private var shellSequences: [String: Int] = [:]
    #if DEBUG && os(iOS)
    /// Simulator journeys use in-memory display data; this code is absent from Release.
    private var isUIFixture = false
    private var fixtureDetails: [String: ThreadDetail] = [:]
    private var fixtureShells: [String: [String: Any]] = [:]
    private func loadUIFixture() {
        isUIFixture = true
        if ProcessInfo.processInfo.arguments.contains("--reset-ui-preferences"), let bundle = Bundle.main.bundleIdentifier {
            UserDefaults.standard.removePersistentDomain(forName: bundle)
        }
        func decode<T: Decodable>(_ type: T.Type, _ object: Any) -> T {
            // Invalid fixed test data should fail loudly in the simulator, never become an empty list.
            try! JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: object))
        }
        let laptop = "11111111-1111-4111-8111-111111111111"
        let studio = "22222222-2222-4222-8222-222222222222"
        let caps: [String: Bool] = ["submit": false, "interrupt": false, "questions": false, "permissions": false, "projects": true, "threads": true]
        let rows: [(String, String, String, String, Int)] = [
            ("release", "Choose the release target", "sotto", "idle", 2),
            ("iphone", "Refine the iPhone thread view", "sotto", "running", 6),
            ("wiring", "Clean up the wiring schedule", "panel", "idle", 12),
            ("shortcuts", "Add keyboard shortcuts", "sotto", "idle", 18),
            ("drives", "Compare motor drive options", "panel", "idle", 60),
            ("lighting", "Update the lighting plan", "house", "idle", 1440),
            ("settings", "Simplify the settings screen", "sotto", "idle", 2880),
            ("notes", "Organize the panel notes", "panel", "idle", 4320)
        ]
        let stamp = ISO8601DateFormatter()
        var threads: [String: [[String: Any]]] = [:]
        for (id, title, project, status, minutes) in rows {
            let host = id == "lighting" ? studio : laptop
            let date = stamp.string(from: Date().addingTimeInterval(-Double(minutes * 60)))
            var row: [String: Any] = ["id": id, "hostId": host, "projectId": project, "title": title,
                "providerId": id == "release" || id == "wiring" ? "claude" : "codex", "status": status,
                "requests": [], "summary": ["lastMessageAt": date]]
            if id == "release" {
                row["requests"] = [["id": "release-target", "kind": "question",
                    "text": "Which release should I prepare?", "options": [
                        ["id": "testflight", "label": "TestFlight"], ["id": "desktop", "label": "Desktop"]]],
                    ["id": "release-permission", "kind": "permission", "text": "Allow reading the release checklist?", "options": []]]
            }
            if id == "wiring" { row["backgroundWork"] = [["type": "agent"]] }
            if id == "settings" || id == "notes" { row["settledAt"] = date }
            threads[host, default: []].append(row)
            fixtureDetails[host + "/" + id] = decode(ThreadDetail.self, ["threadId": id, "revision": 1,
                "messages": [["id": "prompt", "role": "user", "text": title + ". Keep the changes focused."],
                    ["id": "reply", "role": "assistant", "text": "I have the context and am checking the details. The next update will summarize the changes and anything that needs your attention."]],
                "activities": [["id": "read", "sequence": 1, "kind": "command", "status": "completed", "title": "Read project notes"]]])
        }
        for (host, name) in [(laptop, "Laptop"), (studio, "Studio Mac")] {
            let pairing = decode(Pairing.self, ["v": 1, "hostId": host, "clientId": "ui-fixture", "token": "not-a-credential"])
            computers.append(SavedComputer(address: "https://fixture.invalid.ts.net", pairing: pairing, reportedName: name))
            let shellObject: [String: Any] = ["hostId": host, "host": ["hostId": host, "name": name,
                "threads": threads[host] ?? [], "projects": [["id": "sotto", "title": "Sotto", "path": "D:\\Talk to Text Application"],
                    ["id": "panel", "title": "Panel tools", "path": "D:\\Engineering\\Panel tools"], ["id": "house", "title": "House", "path": "D:\\House"]],
                "models": [["id": "fixture-model", "name": "GPT-6.1 Sol", "provider": "Codex", "providerId": "codex", "ready": true,
                    "reasoningEfforts": ["low", "medium", "high"], "defaultReasoningEffort": "high", "runtimeModes": ["approval-required", "full-access"]]],
                "providers": [["id": "codex", "connection": "connected", "capabilities": caps]], "capabilities": caps]]
            fixtureShells[host] = shellObject
            let shell = decode(Shell.self, shellObject)
            live[host] = Live(status: host == laptop ? .online : .unreachable, shell: shell, mayAnswer: false, features: ["host-folders"])
        }
        storageReady = true
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--ui-feedback-request-gone") { feedback = Self.requestNoLongerWaiting }
        if arguments.contains("--ui-feedback-markers-unreadable") { feedback = Self.markersUnreadable }
        if arguments.contains("--ui-feedback-computer-unreadable") { feedback = "Recovered the saved computer list. " + Self.pairingWarning(studio) }
    }
    #endif

    // MARK: Reading

    func computer(_ hostID: String) -> SavedComputer? { computers.first { $0.hostID == hostID } }
    func name(_ hostID: String) -> String { computer(hostID)?.name ?? "the computer" }
    func status(_ hostID: String) -> ComputerStatus { live[hostID]?.status ?? .connecting }
    func online(_ hostID: String) -> Bool { status(hostID) == .online }
    func mayAnswer(_ hostID: String) -> Bool { live[hostID]?.mayAnswer ?? false }
    func problem(_ hostID: String) -> String? { live[hostID]?.problem }
    var anyConnecting: Bool { computers.contains { status($0.hostID) == .connecting } }
    /// Every computer as the lists read it, in the order they were added.
    var lists: [ComputerThreads] {
        computers.map { computer in
            let state = live[computer.hostID]
            return ComputerThreads(hostID: computer.hostID, name: computer.name, status: state?.status ?? .connecting,
                                   threads: state?.shell?.host.threads ?? [], projects: state?.shell?.host.projects ?? [])
        }
    }
    func thread(_ ref: ThreadRef) -> ThreadSummary? { live[ref.hostID]?.shell?.host.threads.first { $0.id == ref.threadID } }
    func detail(for ref: ThreadRef) -> ThreadDetail? { selected == ref && openDetail?.threadId == ref.threadID ? openDetail : nil }
    private func scoped(_ hostID: String) -> [PendingOperation] {
        guard let computer = self.computer(hostID) else { return [] }
        return pending.filter { $0.matches(hostID: hostID, clientID: computer.pairing.clientId) }
    }
    func pending(for ref: ThreadRef) -> [PendingOperation] { scoped(ref.hostID).filter { $0.threadID == ref.threadID } }
    func provider(for ref: ThreadRef) -> Provider? {
        let providerID = thread(ref)?.providerId
        return live[ref.hostID]?.shell?.host.providers?.first { $0.id == providerID }
    }
    private func capabilities(for ref: ThreadRef) -> ProviderCapabilities? { provider(for: ref)?.capabilities ?? live[ref.hostID]?.shell?.host.capabilities }
    /// An answer this iPhone sent to that computer that it hasn't confirmed. Cards wait for it, so a card that
    /// moves under a finger after the first answer can't take a second tap meant for the first.
    func answering(_ hostID: String) -> Bool { scoped(hostID).contains { $0.kind == "answer" } }
    private func canAct(on ref: ThreadRef) -> Bool { online(ref.hostID) && thread(ref) != nil && pending(for: ref).isEmpty }
    func canSend(_ ref: ThreadRef) -> Bool {
        guard canAct(on: ref), let thread = self.thread(ref), thread.status != "running", thread.requests.isEmpty else { return false }
        let source = provider(for: ref)
        return (capabilities(for: ref)?.submit ?? false) && (source == nil || source?.connection == "connected")
    }
    func canInterrupt(_ ref: ThreadRef) -> Bool {
        online(ref.hostID) && pending(for: ref).allSatisfy { $0.kind == "reply" }
            && thread(ref)?.status == "running" && (capabilities(for: ref)?.interrupt ?? false)
    }
    func canAnswer(_ request: AgentRequest, in ref: ThreadRef) -> Bool {
        guard canAct(on: ref), mayAnswer(ref.hostID), request.supported else { return false }
        let allowed = capabilities(for: ref)
        return request.kind == "permission" ? (allowed?.permissions ?? false) : (allowed?.questions ?? false)
    }

    // MARK: Starting and stopping

    init(keychain: KeychainStore = KeychainStore(),
         retryJitter: @escaping @Sendable () -> Double = { Double.random(in: 0.8...1.2) },
         retrySleep: @escaping @Sendable (UInt64) async throws -> Void = { try await Task.sleep(nanoseconds: $0) }) {
        self.keychain = keychain
        self.retrySleep = retrySleep
        self.retryJitter = retryJitter
        #if DEBUG && os(iOS)
        if ProcessInfo.processInfo.arguments.contains("--ui-fixture") {
            loadUIFixture()
            return
        }
        #endif
        loadComputers()
    }
    /// Secure storage may be locked during a prewarmed launch. Publish nothing until all reads succeed.
    private func loadComputers() {
        guard !storageReady else { return }
        let storageProblem = "Secure connection details could not be read. Unlock this iPhone and return to Sotto."
        do {
            var warnings: [String] = []
            var index: [String]?
            var indexAccount: String? = ComputerStore.indexAccount
            var recoveredIndex = false
            do { index = try keychain.read([String].self, account: ComputerStore.indexAccount) }
            catch is KeychainStore.UndecodableItem {
                // Preserve the original bytes. A separate index keeps the recovered order on later
                // launches and is the one pairing and removal may update from now on.
                recoveredIndex = true; indexAccount = ComputerStore.recoveredIndexAccount
                do { index = try keychain.read([String].self, account: ComputerStore.recoveredIndexAccount) }
                catch is KeychainStore.UndecodableItem { index = nil; indexAccount = nil }
                let accounts = try keychain.accounts()
                let discovered = accounts.filter { $0.hasPrefix("computer.") }.map { String($0.dropFirst("computer.".count)) }.sorted()
                index = (index ?? []) + discovered
            }
            var legacy: SavedComputer?
            do { legacy = try readComputer(ComputerStore.legacyAccount) }
            catch is KeychainStore.UndecodableItem { warnings.append("The computer saved by an earlier version needs pairing again.") }
            let plan = ComputerStore.plan(index: index, legacy: legacy)
            var kept: [SavedComputer] = []
            for hostID in plan.index {
                do {
                    let computer = try plan.adopt.flatMap { $0.hostID == hostID ? $0 : nil }
                        ?? readComputer(ComputerStore.account(hostID))
                    if let computer, computer.hostID == hostID { kept.append(computer) }
                    else { warnings.append(Self.pairingWarning(hostID)) }
                } catch is KeychainStore.UndecodableItem {
                    warnings.append(Self.pairingWarning(hostID))
                }
            }
            var markers: [PendingOperation] = []
            do { markers = try keychain.read([PendingOperation].self, account: ComputerStore.pendingAccount) ?? [] }
            catch is KeychainStore.UndecodableItem {
                warnings.append(Self.markersUnreadable)
            }
            // All reads must succeed before migration writes: a locked item never looks missing.
            if let adopt = plan.adopt { try keychain.write(adopt, account: ComputerStore.account(adopt.hostID)) }
            if let indexAccount, recoveredIndex || plan.index != index { try keychain.write(plan.index, account: indexAccount) }
            if plan.removeLegacy { try keychain.remove(account: ComputerStore.legacyAccount) }
            pending = markers.filter { marker in kept.contains { marker.matches(hostID: $0.hostID, clientID: $0.pairing.clientId) } }
            computers = kept; computerIndexAccount = indexAccount
            for computer in kept { live[computer.hostID] = Live() }
            storageReady = true
            if recoveredIndex { warnings.insert(kept.isEmpty ? "The saved computer list could not be recovered." : "Recovered the saved computer list.", at: 0) }
            if !warnings.isEmpty { feedback = warnings.joined(separator: " "); pairFeedback = feedback }
            else {
                if feedback == storageProblem { feedback = nil }
                if pairFeedback == storageProblem { pairFeedback = nil }
            }
        } catch {
            feedback = storageProblem
            pairFeedback = feedback
        }
    }
    /// Invalid records need pairing again. A Keychain access failure still refuses the entire load.
    private func readComputer(_ account: String) throws -> SavedComputer? {
        guard let computer = try keychain.read(SavedComputer.self, account: account) else { return nil }
        do { try computer.validate(); return computer }
        catch { throw KeychainStore.UndecodableItem(account: account) }
    }
    func phase(_ phase: ScenePhase) {
        #if DEBUG && os(iOS)
        if isUIFixture { return }
        #endif
        if phase == .active {
            let wasStorageReady = storageReady
            loadComputers()
            guard !active || (!wasStorageReady && storageReady) else { return }; active = true
            guard storageReady else { return }
            Task { await reconnectAll() }
        } else if phase == .background {
            cancelDetailReload()
            retries.values.forEach { $0.cancel() }; retries.removeAll(); retryAttempts.removeAll()
            active = false; pairGeneration = UUID(); working = false; openDetail = nil
            for (hostID, connection) in connections { generations[hostID] = UUID(); connection.disconnect() }
            connecting.removeAll()
            live = live.mapValues { (state: Live) -> Live in var next = state; next.status = .connecting; next.mayAnswer = false; return next }
        }
    }
    func reconnectAll() async {
        let ids = computers.map(\.hostID)
        await withTaskGroup(of: Void.self) { group in
            for hostID in ids { group.addTask { await self.connect(hostID) } }
        }
    }
    /// Pull to refresh: reconnects every computer, but returns once the ones that were reachable are
    /// back, rather than waiting out one that can't be reached. With none reachable, it waits for all.
    func refresh() async {
        #if DEBUG && os(iOS)
        if isUIFixture { return }
        #endif
        let started = computers.map { computer in
            (reachable: online(computer.hostID), task: Task { await connect(computer.hostID) })
        }
        let awaited = started.contains { $0.reachable } ? started.filter { $0.reachable } : started
        for item in awaited { await item.task.value }
    }
    /// A fresh session, shell and open-thread detail from one computer. Only that computer's state changes.
    /// While the computer is already connecting, this waits for that attempt, delivery check included,
    /// rather than starting another, so a refresh or reconnect never returns before the computer is ready.
    func connect(_ hostID: String) async {
        #if DEBUG && os(iOS)
        if isUIFixture { return }
        #endif
        guard storageReady, active, let saved = computer(hostID) else { return }
        if connecting.contains(hostID) {
            await withCheckedContinuation { connectWaiters[hostID, default: []].append($0) }
            return
        }
        retries.removeValue(forKey: hostID)?.cancel()
        let current = UUID(); generations[hostID] = current; connecting.insert(hostID)
        shellSequences[hostID] = 0
        defer { if generations[hostID] == current { connecting.remove(hostID) } }
        update(hostID) { $0.status = .connecting; $0.mayAnswer = false; $0.problem = nil }
        if selected?.hostID == hostID { cancelDetailReload(); openDetail = nil; detailProblem = nil }
        do {
            guard let endpoint = saved.endpoint else { throw ClientError.invalidHost }
            let greeting = try await connection(hostID).connect(endpoint: endpoint, pairing: saved.pairing)
            guard generations[hostID] == current else { return }
            try applyShell(greeting.value.shell, from: hostID, sequence: greeting.sequence, reconcileAnswers: false)
            update(hostID) {
                $0.status = .online
                // An older host can push a newer shell before hello finishes, without this field.
                if $0.shell?.clientCapabilities == nil { $0.mayAnswer = greeting.value.capabilities.mayAnswer }
                $0.features = greeting.value.features ?? []
            }
            if let selected, selected.hostID == hostID, thread(selected) == nil { self.selected = nil }
        } catch {
            guard generations[hostID] == current else { return }
            update(hostID) { $0.status = .unreachable; $0.mayAnswer = false; $0.problem = error.localizedDescription }
            connections[hostID]?.disconnect()
            if let error = error as? ClientError {
                switch error {
                case .invalidIdentity, .invalidProtocol, .invalidHost, .rejected: return
                default: break
                }
            }
            scheduleRetry(hostID)
            return
        }
        retries.removeValue(forKey: hostID)?.cancel()
        // A refused or slow thread read does not mean the computer's connection was lost.
        do { try await observeAndRead(hostID) }
        catch { if generations[hostID] == current { detailProblem = "This thread could not be loaded. Nothing was lost. Try again." } }
        await checkDelivery(hostID)
    }
    private func scheduleRetry(_ hostID: String) {
        guard active, computer(hostID) != nil, retries[hostID] == nil else { return }
        let attempt = retryAttempts[hostID] ?? 0
        retryAttempts[hostID] = min(attempt + 1, 5)
        let delay = UInt64(min(30, Double(1 << min(attempt, 5)) * retryJitter()) * 1_000_000_000)
        let sleep = retrySleep
        retries[hostID] = Task { [weak self] in
            do { try await sleep(delay) } catch { return }
            guard !Task.isCancelled, let self, self.active, self.computer(hostID) != nil else { return }
            self.retries[hostID] = nil
            await self.connect(hostID)
        }
    }
    /// An attempt ends when its computer leaves `connecting`: it finished, or a disconnect, removal or
    /// the app going to the background ended it early.
    private func releaseConnectWaiters() {
        for hostID in Array(connectWaiters.keys) where !connecting.contains(hostID) {
            connectWaiters.removeValue(forKey: hostID)?.forEach { $0.resume() }
        }
    }
    private func connection(_ hostID: String) -> HostConnection {
        if let existing = connections[hostID] { return existing }
        let made = HostConnection()
        made.onLiveness = { [weak self] in self?.retryAttempts[hostID] = nil }
        made.onPush = { [weak self] frame, sequence in self?.push(frame, from: hostID, sequence: sequence) }
        made.onDisconnect = { [weak self] in
            self?.generations[hostID] = UUID(); self?.connecting.remove(hostID)
            if self?.selected?.hostID == hostID { self?.cancelDetailReload() }
            self?.update(hostID) { $0.status = .unreachable; $0.mayAnswer = false; $0.problem = ClientError.disconnected.localizedDescription }
            self?.scheduleRetry(hostID)
        }
        connections[hostID] = made
        return made
    }
    private func update(_ hostID: String, _ change: (inout Live) -> Void) {
        guard computer(hostID) != nil else { return }
        var state = live[hostID] ?? Live(); change(&state); live[hostID] = state
    }

    // MARK: Adding a computer

    func startAdding() { found = nil; pairFeedback = nil; adding = true }
    /// The sheet closed. A code already spent still finishes pairing; anything else is dropped.
    func closeAdding() { adding = false; pairGeneration = UUID(); working = false; found = nil; pairFeedback = nil }
    /// Step 1: find the computer from its machine name (or full address) and confirm Sotto answers there:
    /// on 8443, where the desktop serves it, then on 443.
    func find(_ typed: String) async {
        #if DEBUG && os(iOS)
        if isUIFixture { return }
        #endif
        guard !working, storageReady else { return }; working = true; pairFeedback = nil
        let current = pairGeneration
        defer { if current == pairGeneration { working = false } }
        do {
            let candidates = try await HostFinder.candidates(typed)
            let finder = self.finder
            let hit = try await HostFinder.probe(candidates) { endpoint in try await finder.health(endpoint: endpoint) }
            guard current == pairGeneration else { return }
            if let existing = computer(hit.found.hostId) {
                pairFeedback = "This iPhone is already paired with \(existing.name). To pair it again, remove it in Computers first."
                return
            }
            found = FoundHost(endpoint: hit.endpoint, health: hit.found)
        } catch { if current == pairGeneration { pairFeedback = error.localizedDescription } }
    }
    func changeComputer() { found = nil; pairFeedback = nil }
    /// Step 2: spend the code on the computer step 1 found.
    func pair(code typed: String) async {
        #if DEBUG && os(iOS)
        if isUIFixture { return }
        #endif
        guard !working, storageReady, let found else { return }; working = true; pairFeedback = nil
        let current = pairGeneration
        do {
            let code = try PairingCode.normalized(typed)
            // Kept even if the sheet closed or the app went to the background meanwhile: the code is spent
            // and the computer holds this client.
            let pairing = try await finder.pair(endpoint: found.endpoint, expectedHostID: found.health.hostId, code: code)
            let computer = SavedComputer(address: found.endpoint.url.absoluteString, pairing: pairing, reportedName: found.health.computerName)
            try keychain.write(computer, account: ComputerStore.account(computer.hostID))
            if let computerIndexAccount { try keychain.write(computers.map(\.hostID).filter { $0 != computer.hostID } + [computer.hostID], account: computerIndexAccount) }
            // Markers from an earlier pairing with this computer must never attach to the new client.
            let markers = pending.filter { $0.hostID != computer.hostID }
            try keychain.write(markers, account: ComputerStore.pendingAccount)
            pending = markers
            computers = computers.filter { $0.hostID != computer.hostID } + [computer]
            live[computer.hostID] = Live()
            // Sheet state belongs to whichever Add computer is open now; a pairing that finishes after
            // Cancel is saved but leaves a newer sheet alone.
            if current == pairGeneration { self.found = nil; working = false; adding = false }
            await connect(computer.hostID)
        } catch { if current == pairGeneration { pairFeedback = error.localizedDescription; working = false } }
    }

    // MARK: Looking after a computer

    func rename(_ hostID: String, to typed: String) {
        #if DEBUG && os(iOS)
        if isUIFixture { return }
        #endif
        guard var computer = self.computer(hostID) else { return }
        computer.localName = ComputerName.cleaned(typed)
        do {
            try keychain.write(computer, account: ComputerStore.account(hostID))
            computers = computers.map { $0.hostID == hostID ? computer : $0 }
        } catch { feedback = error.localizedDescription }
    }
    /// Revokes this iPhone on the computer where it can be reached, then forgets the computer here either way.
    func remove(_ hostID: String) async {
        #if DEBUG && os(iOS)
        if isUIFixture { return }
        #endif
        guard storageReady, removing == nil, let saved = computer(hostID) else { return }
        removing = hostID
        defer { removing = nil }
        var outcome = Revocation.confirmed
        if let endpoint = saved.endpoint {
            do { try await connection(hostID).revoke(endpoint: endpoint, pairing: saved.pairing) }
            catch is URLError { outcome = .unreachable }
            catch { outcome = .unconfirmed }
        } else { outcome = .unconfirmed }
        // The item goes first: an index entry without its item is skipped at launch, and markers for a
        // computer that isn't there are dropped then too, so the later writes can fail without harm.
        do { try keychain.remove(account: ComputerStore.account(hostID)) } catch { feedback = error.localizedDescription; return }
        let rest = computers.filter { $0.hostID != hostID }
        let markers = pending.filter { $0.hostID != hostID }
        if let computerIndexAccount { try? keychain.write(rest.map(\.hostID), account: computerIndexAccount) }
        try? keychain.write(markers, account: ComputerStore.pendingAccount)
        retries.removeValue(forKey: hostID)?.cancel(); retryAttempts[hostID] = nil
        generations[hostID] = UUID(); connecting.remove(hostID)
        connections[hostID]?.close(); connections[hostID] = nil
        let gone = Set(pending.filter { $0.hostID == hostID }.map(\.id))
        computers = rest; live[hostID] = nil; pending = markers
        if selected?.hostID == hostID { cancelDetailReload(); selected = nil; openDetail = nil; detailProblem = nil }
        if show == .only(hostID) { show = .all }
        let prefix = hostID + "/"
        drafts = drafts.filter { !$0.key.hasPrefix(prefix) }
        failedReplies = failedReplies.filter { !$0.key.hasPrefix(prefix) }
        submitted = submitted.filter { !gone.contains($0.key) }
        let words = outcome.words(name: saved.name, clientID: saved.pairing.clientId)
        feedback = words
        // With nothing left paired the app goes back to the pairing steps, which show this instead.
        if rest.isEmpty { pairFeedback = words }
    }
    private enum Revocation {
        case confirmed, unreachable, unconfirmed
        func words(name: String, clientID: String) -> String {
            let there = "Remove it there too: in Settings › Phones on \(name), or on a host without a screen with its --revoke-client \(clientID) command."
            switch self {
            case .confirmed: return "Removed \(name)."
            case .unreachable: return "Removed \(name) from this iPhone. It couldn’t be reached, so it still lists this iPhone. " + there
            case .unconfirmed: return "Removed \(name) from this iPhone, but couldn’t confirm removal there, so it may still list this iPhone. " + there
            }
        }
    }

    // MARK: The open thread

    func select(_ ref: ThreadRef?) async {
        cancelDetailReload()
        let previous = selected
        selected = ref; openDetail = nil; detailProblem = nil; detailVersion += 1
        #if DEBUG && os(iOS)
        if isUIFixture {
            openDetail = ref.flatMap { fixtureDetails[$0.id] }
            return
        }
        #endif
        if let previous, previous.hostID != ref?.hostID, online(previous.hostID), let before = connections[previous.hostID] {
            _ = try? await before.call(["op": .string("observe"), "threadIds": .array([])])
        }
        // Another thread may have been opened, or its computer reconnected, while the last one was let go.
        guard let ref, selected == ref, online(ref.hostID) else { return }
        let current = generations[ref.hostID]
        do { try await observeAndRead(ref.hostID) }
        catch { if generations[ref.hostID] == current, selected == ref { detailProblem = "This thread could not be loaded. Nothing was lost. Try again." } }
    }
    /// Tells one computer which of its threads is open here, and reads that thread.
    private func observeAndRead(_ hostID: String) async throws {
        guard let connection = connections[hostID], let current = generations[hostID] else { return }
        let ref = selected?.hostID == hostID ? selected : nil
        _ = try await connection.call(["op": .string("observe"), "threadIds": .array(ref.map { [.string($0.threadID)] } ?? [])])
        guard generations[hostID] == current, let ref, ref == selected else { return }
        // observe sends the initial detail before acknowledging. Do not download it twice.
        if openDetail?.threadId == ref.threadID { return }
        let version = detailVersion
        let next = try await connection.call(["op": .string("detail"), "threadId": .string(ref.threadID)], as: Optional<ThreadDetail>.self)
        try applyDetail(next, ref: ref, epoch: current, versionAtRead: version)
    }
    private func cancelDetailReload() {
        detailReload?.cancel(); detailReload = nil; detailReloadID = nil; detailWantedRevision = 0
    }
    /// Several deltas can arrive after a gap. One full read repairs the base for all of them.
    private func reloadDetail(_ ref: ThreadRef) {
        guard detailReload == nil, selected == ref, let connection = connections[ref.hostID], let epoch = generations[ref.hostID] else { return }
        let id = UUID(); detailReloadID = id
        let version = detailVersion
        detailReload = Task { [weak self] in
            guard let self else { return }
            var repeatRead = false
            defer {
                if detailReloadID == id {
                    detailReload = nil; detailReloadID = nil
                    if repeatRead { reloadDetail(ref) }
                }
            }
            do {
                let next = try await connection.call(["op": .string("detail"), "threadId": .string(ref.threadID)], as: Optional<ThreadDetail>.self)
                guard !Task.isCancelled else { return }
                try applyDetail(next, ref: ref, epoch: epoch, versionAtRead: version)
                // A newer delta may have arrived during the read/decode. Do not lose the final
                // update just because a repair was already in flight when it arrived.
                repeatRead = next != nil && selected == ref && generations[ref.hostID] == epoch
                    && (openDetail?.revision ?? 0) < detailWantedRevision
            } catch {
                if !Task.isCancelled, selected == ref, generations[ref.hostID] == epoch {
                    detailProblem = "This thread could not be refreshed. Nothing was lost. Try again."
                }
            }
        }
    }
    private func applyDetail(_ next: ThreadDetail?, ref: ThreadRef, epoch: UUID, versionAtRead: Int? = nil) throws {
        guard let now = generations[ref.hostID], epoch == now, ref == selected else { return }
        if let next, next.threadId != ref.threadID { throw ClientError.invalidIdentity }
        guard SnapshotGuard.accepts(requestGeneration: epoch, currentGeneration: now,
                                    requestedThread: ref.id, selectedThread: selected?.id,
                                    incomingRevision: next?.revision, currentRevision: openDetail?.revision,
                                    changedSinceRead: versionAtRead.map { $0 != detailVersion } ?? false) else { return }
        if let next, next.revision == openDetail?.revision { return }
        openDetail = next; detailProblem = nil; detailVersion += 1
    }
    func earlier(_ ref: ThreadRef) async {
        guard online(ref.hostID), selected == ref, let connection = connections[ref.hostID] else { return }
        let current = generations[ref.hostID]
        do {
            let command = try Commands.loadEarlier(threadID: ref.threadID)
            _ = try await connection.call(["op": .string("command"), "command": command])
            guard generations[ref.hostID] == current, selected == ref else { return }
            try await observeAndRead(ref.hostID)
        } catch { if generations[ref.hostID] == current { feedback = error.localizedDescription } }
    }

    // MARK: Replies, answers and stops, each to its thread's own computer

    func send(_ ref: ThreadRef) async {
        guard canSend(ref), let text = drafts[ref.id], let computer = self.computer(ref.hostID) else { return }
        let draft = UUID().uuidString
        do {
            let command = try Commands.prompt(threadID: ref.threadID, text: text, draftID: draft)
            let operation = PendingOperation(hostID: ref.hostID, clientID: computer.pairing.clientId, threadID: ref.threadID, draftID: draft, kind: "reply")
            try remember(operation); submitted[operation.id] = text; drafts[ref.id] = ""
            await dispatch(command, operation: operation)
        } catch { feedback = error.localizedDescription }
    }
    /// Answers a request from the open thread's sheet, after rechecking the computer's authority.
    func answer(_ request: AgentRequest, in ref: ThreadRef, choice: String? = nil, text: String = "", answers: [String: QuestionAnswer] = [:]) async {
        guard let thread = self.thread(ref), canAnswer(request, in: ref), let computer = self.computer(ref.hostID) else { return }
        do {
            let command = try Commands.answer(threadID: ref.threadID, request: request, currentRequests: thread.requests, choice: choice, text: text, answers: answers)
            let operation = PendingOperation(hostID: ref.hostID, clientID: computer.pairing.clientId, threadID: ref.threadID, requestID: request.id, kind: "answer")
            try remember(operation); await dispatch(command, operation: operation)
        } catch { feedback = error.localizedDescription }
    }
    func interrupt(_ ref: ThreadRef) async {
        guard canInterrupt(ref), let computer = self.computer(ref.hostID) else { return }
        do {
            let command = try Commands.interrupt(threadID: ref.threadID)
            let operation = PendingOperation(hostID: ref.hostID, clientID: computer.pairing.clientId, threadID: ref.threadID, kind: "interrupt")
            try remember(operation)
            await dispatch(command, operation: operation)
        } catch { feedback = error.localizedDescription }
    }
    private func remember(_ operation: PendingOperation) throws {
        guard pending.count < 100 else { throw ClientError.rejected("Check the unconfirmed actions before sending more.") }
        let next = pending + [operation]; try keychain.write(next, account: ComputerStore.pendingAccount); pending = next
    }
    private func forgetMarker(_ id: String) throws {
        let next = pending.filter { $0.id != id }; try keychain.write(next, account: ComputerStore.pendingAccount); pending = next; submitted.removeValue(forKey: id)
    }
    @discardableResult private func dispatch(_ command: JSONValue, operation: PendingOperation) async -> Shell? {
        let hostID = operation.hostID, current = generations[hostID]
        if operation.kind == "answer" { dispatchingAnswers.insert(operation.id) }
        defer { dispatchingAnswers.remove(operation.id) }
        guard let connection = connections[hostID] else { operationFeedback(ClientError.uncertain.localizedDescription, operations: [operation.id]); return nil }
        do {
            let result = try await connection.callReceived(["op": .string("command"), "command": command], as: Shell.self, id: operation.id)
            guard generations[hostID] == current else { return nil }
            let next = result.value
            try applyShell(next, from: hostID, sequence: result.sequence, reconcileAnswers: false)
            await checkDelivery(hostID)
            guard generations[hostID] == current else { return nil }
            if let error = next.error {
                if operation.kind.hasPrefix("create-") { creationFeedback = error }
                return nil
            }
            return next
        } catch let error as HostRefusal {
            guard generations[hostID] == current else { return nil }
            // Revocation can replace an acknowledgement AFTER the action ran.
            // Generic unavailable failures may also follow provider side effects.
            if ["invalid_request", "stale_request", "forbidden", "busy"].contains(error.failure.code) {
                do { try rejectOperation(operation) } catch { feedback = error.localizedDescription; return nil }
            }
            if error.failure.code == "forbidden" { update(hostID) { $0.mayAnswer = false } }
            if error.failure.code == "unauthenticated" { update(hostID) { $0.status = .unreachable; $0.problem = error.localizedDescription } }
            feedback = error.localizedDescription
        } catch { if generations[hostID] == current { operationFeedback("Delivery is unconfirmed. Reconnect and check the thread before sending again.", operations: [operation.id]) } }
        return nil
    }
    func checkDelivery(_ hostID: String) async {
        guard online(hostID), !scoped(hostID).isEmpty, let connection = connections[hostID] else { return }
        let current = generations[hostID]
        deliveryChecks[hostID, default: 0] += 1
        defer { deliveryChecks[hostID, default: 0] -= 1 }
        do {
            let fresh = try await connection.callReceived(["op": .string("shell")], as: Shell.self)
            guard generations[hostID] == current else { return }
            let next = fresh.value
            try applyShell(next, from: hostID, sequence: fresh.sequence, reconcileAnswers: false)
            for item in scoped(hostID) {
                let receipt = try await connection.call(["op": .string("receipt"), "commandId": .string(item.id)], as: Receipt.self)
                guard generations[hostID] == current else { return }
                guard scoped(hostID).contains(where: { $0.id == item.id }) else { continue }
                try settle(item, receipt: receipt, shell: live[hostID]?.shell)
            }
        } catch { if generations[hostID] == current { operationFeedback("Delivery to \(name(hostID)) could not be checked. Nothing was resent. Reconnect to try again.", operations: Set(scoped(hostID).map(\.id))) } }
    }
    private func operationFeedback(_ words: String, operations: Set<String>) {
        feedback = words; feedbackOperations = operations
    }
    private func settle(_ item: PendingOperation, receipt: Receipt? = nil, shell: Shell?) throws {
        // A phone-minted Sotto ID identifies this exact creation even after its receipt expired.
        if item.kind == "create-thread", shell?.host.threads.contains(where: { $0.id == item.threadID }) == true {
            try forgetMarker(item.id)
            return
        }
        let delivery = shell?.deliveries?.first { $0.threadId == item.threadID && $0.draftId == item.draftID }
        let delivered = shell?.deliveredDrafts?.contains { $0.threadId == item.threadID && $0.draftId == item.draftID } == true
        let accepted = delivered || delivery?.status == "accepted"
        let thread = shell?.host.threads.first { $0.id == item.threadID }
        // Only this command's own receipt confirms the phone's answer. A request can also leave
        // after a desktop answer, a stopped turn or provider cancellation.
        let noLongerWaiting = item.kind == "answer" && item.requestID != nil && thread != nil
            && thread?.requests.contains(where: { $0.id == item.requestID }) == false
        if item.kind == "answer" {
            let confirmed = receipt?.confirmsAnswer == true
            guard confirmed || noLongerWaiting else { return }
            try forgetMarker(item.id)
            if feedback == nil || feedbackOperations.contains(item.id) {
                feedback = confirmed ? "Answer sent." : Self.requestNoLongerWaiting
            }
        } else if delivery?.status == "failed" {
            try rejectOperation(item)
            // Named, because the thread open now may be another one, on another computer.
            let title = thread.map { "“\($0.title)”" } ?? "a thread"
            feedback = "Your reply to \(title) on \(name(item.hostID)) wasn’t sent. Its text is back in that thread."
        } else if accepted || receipt.map({ item.reconciled(receipt: $0, deliveries: shell?.deliveries ?? []) }) == true {
            try forgetMarker(item.id)
            if feedbackOperations.remove(item.id) != nil, feedbackOperations.isEmpty { feedback = nil }
        }
    }
    private func rejectOperation(_ operation: PendingOperation) throws {
        if let text = submitted[operation.id], operation.kind == "reply" {
            failedReplies[ThreadRef(hostID: operation.hostID, threadID: operation.threadID).id] = text
        }
        try forgetMarker(operation.id)
    }
    func restoreReply(_ ref: ThreadRef) {
        guard (drafts[ref.id] ?? "").isEmpty, let text = failedReplies[ref.id] else { return }
        drafts[ref.id] = text; failedReplies.removeValue(forKey: ref.id)
    }
    func acknowledgeUnknown(_ id: String) {
        do { try forgetMarker(id); feedback = "Unconfirmed action dismissed. Nothing was resent." }
        catch { feedback = error.localizedDescription }
    }

    // MARK: New threads on one computer

    var pendingCreations: [PendingOperation] {
        pending.filter { item in
            item.kind.hasPrefix("create-") && computer(item.hostID).map { item.matches(hostID: $0.hostID, clientID: $0.pairing.clientId) } == true
        }
    }
    func creationModels(_ hostID: String) -> [ThreadModel] {
        guard let host = live[hostID]?.shell?.host else { return [] }
        return NewThreads.availableModels(host)
    }
    func initialCreationModelID(_ hostID: String) -> String {
        live[hostID]?.shell.map(NewThreads.startingModelID) ?? ""
    }
    func initialCreationEffort(_ hostID: String, model: ThreadModel) -> String {
        live[hostID]?.shell.map { NewThreads.startingEffort(model, shell: $0) } ?? model.startingEffort
    }
    func projects(_ hostID: String) -> [Project] {
        (live[hostID]?.shell?.host.projects ?? []).filter { $0.workspaceSettledAt == nil }
    }
    func canBrowseFolders(_ hostID: String) -> Bool { online(hostID) && live[hostID]?.features.contains("host-folders") == true }
    func folders(_ hostID: String, path: JSONValue? = nil) async throws -> FolderResult {
        #if DEBUG && os(iOS)
        if isUIFixture {
            if ProcessInfo.processInfo.arguments.contains("--ui-folder-timeout") { throw ClientError.readTimedOut }
            let target = path?.string ?? "D:\\Engineering"
            let top = path == .null
            let children: [[String: Any]] = top ? [["name": "D:", "path": "D:\\", "git": false]]
                : target == "D:\\New project" ? [] : [["name": "New project", "path": "D:\\New project", "git": true], ["name": "Panel tools", "path": "D:\\Engineering\\Panel tools", "git": false]]
            let json: [String: Any] = ["status": "listed", "path": top ? NSNull() : target as Any, "home": "D:\\Engineering", "separator": "\\",
                "crumbs": top ? [["name": "Drives", "path": NSNull()]] : [["name": "Drives", "path": NSNull()], ["name": target == "D:\\New project" ? "New project" : "Engineering", "path": target]],
                "folders": children, "truncated": false]
            return try JSONDecoder().decode(FolderResult.self, from: JSONSerialization.data(withJSONObject: json))
        }
        #endif
        guard canBrowseFolders(hostID), let connection = connections[hostID], let epoch = generations[hostID] else {
            throw ClientError.rejected("Folder browsing is unavailable. Reconnect or update Sotto on this computer.")
        }
        let result = try await connection.call(NewThreads.folderRequest(path: path), as: FolderResult.self)
        guard generations[hostID] == epoch, online(hostID) else { throw ClientError.disconnected }
        return result
    }
    /// Registration and creation are separate commands. Neither is replayed after a lost acknowledgement.
    func createThread(on hostID: String, projectID: String?, folder: FolderListing?, modelID: String,
                      effort: String, permissionID: String) async -> ThreadRef? {
        #if DEBUG && os(iOS)
        if isUIFixture {
            guard online(hostID), var root = fixtureShells[hostID], var host = root["host"] as? [String: Any],
                  let chosen = creationModels(hostID).first(where: { $0.id == modelID }) else { return nil }
            let threadID = UUID().uuidString, chosenProject = projectID ?? "new-project"
            do {
                _ = try Commands.createThread(projectID: chosenProject, threadID: threadID, model: chosen,
                                              effort: effort, permissionID: permissionID, mayAnswer: mayAnswer(hostID))
                // Only this debug simulator fixture can mutate in-memory display data without a host.
                var rows = host["threads"] as? [[String: Any]] ?? []
                rows.append(["id": threadID, "projectId": chosenProject, "title": "New thread", "providerId": "codex", "status": "idle", "requests": []])
                var projects = host["projects"] as? [[String: Any]] ?? []
                if let folder { projects.append(["id": chosenProject, "title": folder.projectName, "path": folder.path ?? ""]) }
                host["threads"] = rows; host["projects"] = projects; root["host"] = host
                let next = try JSONDecoder().decode(Shell.self, from: JSONSerialization.data(withJSONObject: root))
                fixtureShells[hostID] = root
                update(hostID) { $0.shell = next }
                fixtureDetails[hostID + "/" + threadID] = try JSONDecoder().decode(ThreadDetail.self, from: JSONSerialization.data(withJSONObject: ["threadId": threadID, "revision": 1, "messages": []]))
                return ThreadRef(hostID: hostID, threadID: threadID)
            } catch { creationFeedback = error.localizedDescription; return nil }
        }
        #endif
        guard creatingHostID == nil, storageReady, online(hostID),
              !pendingCreations.contains(where: { $0.hostID == hostID }), let computer = computer(hostID),
              let epoch = generations[hostID] else { return nil }
        creatingHostID = hostID; creationFeedback = nil
        defer { creatingHostID = nil }
        let threadID = UUID().uuidString
        do {
            guard (projectID != nil) != (folder != nil),
                  let model = creationModels(hostID).first(where: { $0.id == modelID }) else {
                throw ClientError.rejected("The project or model changed. Choose it again before opening a thread.")
            }
            // Validate the visible options before registering anything on the computer.
            _ = try Commands.createThread(projectID: projectID ?? "new-project", threadID: threadID, model: model,
                                          effort: effort, permissionID: permissionID, mayAnswer: mayAnswer(hostID))
            var chosenProject = projectID
            if let folder, let path = folder.path {
                guard case .listed(let fresh) = try await folders(hostID, path: .string(path)), fresh.path != nil else {
                    throw ClientError.rejected("This folder can no longer be opened. Nothing was added. Choose another folder.")
                }
                guard generations[hostID] == epoch, online(hostID) else { throw ClientError.disconnected }
                let confirmedPath = fresh.path!
                chosenProject = live[hostID]?.shell?.host.projects.first { NewThreads.sameFolder($0.path, confirmedPath, separator: fresh.separator) }?.id
                if chosenProject == nil {
                    guard let providerID = model.providerId,
                          live[hostID]?.shell?.host.providers?.first(where: { $0.id == providerID })?.capabilities.projects == true else {
                        throw ClientError.rejected("This provider cannot add a project folder. Choose another model.")
                    }
                    let command = try Commands.createProject(providerID: providerID, title: fresh.projectName, path: confirmedPath)
                    let marker = PendingOperation(hostID: hostID, clientID: computer.pairing.clientId, threadID: threadID, kind: "create-project")
                    try remember(marker)
                    guard let result = await dispatch(command, operation: marker), generations[hostID] == epoch,
                          !pending.contains(where: { $0.id == marker.id }) else {
                        creationFeedback = creationResultWords(hostID, kind: "Project registration")
                        return nil
                    }
                    chosenProject = result.host.projects.first { NewThreads.sameFolder($0.path, confirmedPath, separator: fresh.separator) && ($0.providerId == nil || $0.providerId == providerID) }?.id
                }
            }
            guard generations[hostID] == epoch, online(hostID), let chosenProject,
                  live[hostID]?.shell?.host.projects.contains(where: { $0.id == chosenProject }) == true,
                  let currentModel = creationModels(hostID).first(where: { $0.id == modelID }) else {
                throw ClientError.rejected("The project or model is no longer available. Reconnect and choose it again.")
            }
            let command = try Commands.createThread(projectID: chosenProject, threadID: threadID, model: currentModel,
                                                   effort: effort, permissionID: permissionID, mayAnswer: mayAnswer(hostID))
            let marker = PendingOperation(hostID: hostID, clientID: computer.pairing.clientId, threadID: threadID, kind: "create-thread")
            try remember(marker)
            _ = await dispatch(command, operation: marker)
            let ref = ThreadRef(hostID: hostID, threadID: threadID)
            guard generations[hostID] == epoch, online(hostID), thread(ref) != nil,
                  !pending.contains(where: { $0.id == marker.id }) else {
                creationFeedback = creationResultWords(hostID, kind: "Thread creation")
                return nil
            }
            return ref
        } catch { creationFeedback = error.localizedDescription; return nil }
    }
    private func creationResultWords(_ hostID: String, kind: String) -> String {
        let explanation = creationFeedback.map { $0 + " " } ?? ""
        if pendingCreations.contains(where: { $0.hostID == hostID }) {
            return explanation + "\(kind) on \(name(hostID)) is unconfirmed. Nothing was resent. Close this sheet and check Threads before trying again."
        }
        return creationFeedback ?? feedback ?? "\(kind) did not finish. Choose the project and model again."
    }

    // MARK: Updates from a computer

    private func applyShell(_ next: Shell, from hostID: String, sequence: Int, reconcileAnswers: Bool = true) throws {
        guard computer(hostID) != nil else { throw ClientError.invalidIdentity }
        try next.validate(hostID: hostID)
        guard sequence > (shellSequences[hostID] ?? 0) else { return }
        shellSequences[hostID] = sequence
        update(hostID) {
            $0.shell = next
            if let allowed = next.clientCapabilities?.mayAnswer { $0.mayAnswer = allowed }
        }
        // Live evidence can arrive after the acknowledgement timed out. Never resend to settle it.
        // A Keychain write failure is local feedback, not a lost connection to the computer.
        for item in scoped(hostID) {
            // A connect, dispatch or solicited shell is followed by a receipt check. Keep its
            // answer markers through intervening pushes until their own receipts are read.
            if item.kind == "answer", !reconcileAnswers || connecting.contains(hostID) || dispatchingAnswers.contains(item.id) || (deliveryChecks[hostID] ?? 0) > 0 { continue }
            do { try settle(item, shell: next) }
            catch { feedback = error.localizedDescription }
        }
        if let selected, selected.hostID == hostID, !next.host.threads.contains(where: { $0.id == selected.threadID }) {
            cancelDetailReload(); self.selected = nil; openDetail = nil; detailProblem = nil
        }
    }
    private func push(_ frame: IncomingFrame, from hostID: String, sequence: Int) {
        do {
            switch frame {
            case .shell(let shell): try applyShell(shell, from: hostID, sequence: sequence)
            case .detail(let id, let detail):
                if let epoch = generations[hostID] { try applyDetail(detail, ref: ThreadRef(hostID: hostID, threadID: id), epoch: epoch) }
            case .delta(let id, let delta):
                guard delta.threadId == id else { throw ClientError.invalidIdentity }
                let ref = ThreadRef(hostID: hostID, threadID: id)
                guard selected == ref else { return }
                if let openDetail, delta.revision <= openDetail.revision { return }
                if let next = openDetail?.applying(delta), let epoch = generations[hostID] {
                    try applyDetail(next, ref: ref, epoch: epoch)
                } else { detailWantedRevision = max(detailWantedRevision, delta.revision); reloadDetail(ref) }
            case .failure(let failure):
                // The host sends this in place of an update too large for one frame; the connection stays open.
                feedback = failure.message
            default: throw ClientError.invalidProtocol
            }
        } catch {
            let words = "The update from \(name(hostID)) could not be read. Reconnect to refresh it."
            update(hostID) { $0.status = .unreachable; $0.mayAnswer = false; $0.problem = words }
            connections[hostID]?.disconnect(); feedback = words
        }
    }
}
