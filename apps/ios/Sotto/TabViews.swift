import SwiftUI
import SottoCore

// MARK: Needs you

/// Home: every question and permission waiting on the user on every computer, answerable in place,
/// then what is working. A computer that can't be reached gets a line and hides nothing else.
struct NeedsYouView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                ComputerStrip()
                FeedbackBanner()
                ForEach(unreachable, id: \.hostID) { computer in UnreachableNote(computer: computer) }
                if waiting.isEmpty {
                    if let checking { Checking(place: checking) } else { NothingWaiting(place: place) }
                }
                ForEach(waiting) { item in RequestCard(item: item) }
                if !working.isEmpty {
                    SectionLabel("Working")
                    ForEach(working) { row in
                        NavigationLink(value: ThreadRoute(ref: row.ref)) { WorkingRow(row: row) }.buttonStyle(.plain)
                        Divider().overlay(Palette.hairline)
                    }
                }
            }.padding(.horizontal, 16).padding(.bottom, 24)
        }
        .refreshable { await model.reconnectAll() }
        .page("Needs you")
    }
    private var lists: [ComputerThreads] { model.lists }
    private var waiting: [Waiting] { ThreadGroups.waiting(lists, show: model.show) }
    private var working: [HostedThread] { ThreadGroups.working(lists, show: model.show) }
    private var unreachable: [ComputerThreads] { ThreadGroups.unreachable(lists, show: model.show) }
    private var place: String {
        if case .only(let hostID) = model.show { return model.name(hostID) }
        return model.computers.count == 1 ? model.name(model.computers[0].hostID) : "your computers"
    }
    /// The computers the strip admits that are still connecting: "Nothing needs you" would be a guess.
    private var checking: String? {
        let names = lists.filter { model.show.admits($0.hostID) && $0.status == .connecting }.map(\.name)
        if names.isEmpty { return nil }
        return names.count == 1 ? names[0] : "your computers"
    }
}

private struct Checking: View {
    let place: String
    var body: some View {
        HStack(spacing: 10) {
            ProgressView().controlSize(.small)
            Text("Checking \(place)…").foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 26)
        .accessibilityElement(children: .combine)
    }
}

private struct NothingWaiting: View {
    let place: String
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "checkmark").font(.title2).foregroundStyle(Palette.accent).accessibilityHidden(true)
            Text("Nothing needs you").fontWeight(.semibold)
            Text("Questions and permissions from threads on \(place) appear here.")
                .font(.subheadline).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 26).padding(.horizontal, 20)
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Palette.border, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
        .accessibilityElement(children: .combine)
    }
}

/// One computer this iPhone can't reach: anything waiting there shows once it's back.
private struct UnreachableNote: View {
    @EnvironmentObject var model: AppModel
    let computer: ComputerThreads
    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: "desktopcomputer").foregroundStyle(Palette.muted).accessibilityHidden(true)
            sentence.font(.subheadline).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Button("Try again") { Task { await model.connect(computer.hostID) } }
                .buttonStyle(PlainStyle(compact: true))
                .accessibilityLabel("Try reaching \(computer.name) again")
        }
        .accessibilityElement(children: .contain)
    }
    private var sentence: Text {
        Text("Can’t reach \(computer.name).").fontWeight(.semibold).foregroundColor(Palette.ink)
            + Text(" Anything waiting there shows here once it’s back.").foregroundColor(Palette.muted)
    }
}

private struct WorkingRow: View {
    let row: HostedThread
    var body: some View {
        HStack(spacing: 12) {
            StatusDot(state: .working)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.thread.title).fontWeight(.semibold).lineLimit(1)
                Text(line).font(.subheadline).foregroundStyle(Palette.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Palette.muted).accessibilityHidden(true)
        }
        .frame(minHeight: 44).contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
    private var line: String {
        var parts: [String] = [Words.provider(row.thread.providerId), row.computer]
        if let ago = Words.ago(row.thread.summary?.runningTurnStartedAt) { parts.append("started \(ago)") }
        return parts.joined(separator: " · ")
    }
}

/// The top of a card: the thread, how long ago, and where it is. A press opens the thread.
private struct CardHeader: View {
    let row: HostedThread
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                StatusDot(state: ThreadState(row.thread))
                Text(row.thread.title).font(.subheadline).fontWeight(.semibold).lineLimit(1)
                Spacer(minLength: 4)
                if let ago = Words.ago(row.thread.summary?.lastMessageAt) { Text(ago).font(.footnote).foregroundStyle(Palette.muted) }
            }
            Text(Words.place(row)).font(.footnote).foregroundStyle(Palette.muted).lineLimit(1)
        }
        .frame(minHeight: 44).contentShape(Rectangle())
    }
}

/// One waiting request. A tap on a choice answers it on the thread's own computer; nothing is chosen
/// or sent for the user.
struct RequestCard: View {
    @EnvironmentObject var model: AppModel
    let item: Waiting
    private var row: HostedThread { item.thread }
    private var request: AgentRequest { item.request }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink(value: ThreadRoute(ref: row.ref)) { CardHeader(row: row) }
                .buttonStyle(.plain).accessibilityLabel("Open \(row.thread.title) on \(row.computer)")
            Text(headline).fixedSize(horizontal: false, vertical: true)
            if let command = request.context?.command { CommandBox(command: command) }
            actions
        }.card()
    }
    private var headline: String {
        if request.kind == "permission", request.context?.command != nil { return "\(Words.provider(row.thread.providerId)) wants to run a command." }
        if let questions = request.questions, questions.count == 1 { return questions[0].question }
        return request.text
    }
    private var enabled: Bool { model.canAnswer(request, in: row.ref) && !model.answering(row.ref.hostID) }
    @ViewBuilder private var actions: some View {
        if !request.supported {
            explain("This request can’t be answered here. Open the thread to see it.")
        } else if !model.mayAnswer(row.ref.hostID) {
            explain("This iPhone can’t answer on \(row.computer) yet. Turn on Can answer for it in Sotto on \(row.computer), or answer there.")
        } else if request.kind == "permission" {
            permission
        } else if let options = request.oneTapOptions {
            VStack(spacing: 6) {
                ForEach(options) { option in
                    Button { answer(option: option) } label: { OptionLabel(option: option) }.buttonStyle(ChoiceStyle())
                }
            }.disabled(!enabled)
        } else { openThread("Answer") }
    }
    @ViewBuilder private var permission: some View {
        if let choices = request.cardPermissionChoices {
            HStack(spacing: 8) {
                ForEach(choices.sorted { $0.kind == "deny" && $1.kind != "deny" }) { choice in
                    if choice.kind == "deny" { Button(choice.label) { answer(choice: choice.id) }.buttonStyle(PlainStyle(wide: true)) }
                    else { Button(choice.label) { answer(choice: choice.id) }.buttonStyle(ActionStyle(wide: true)) }
                }
            }.disabled(!enabled)
            if (request.permissionChoices?.count ?? 0) > choices.count { openThread("More choices") }
        } else if request.permissionChoices == nil {
            HStack(spacing: 8) {
                Button("Deny") { answer(choice: "deny") }.buttonStyle(PlainStyle(wide: true))
                Button("Allow") { answer(choice: "allow") }.buttonStyle(ActionStyle(wide: true))
            }.disabled(!enabled)
        } else { openThread("Answer in the thread") }
    }
    private func explain(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(text).font(.subheadline).foregroundStyle(Palette.muted)
            openThread("Open thread")
        }
    }
    private func openThread(_ label: String) -> some View {
        NavigationLink(value: ThreadRoute(ref: row.ref)) { Text(label).frame(maxWidth: .infinity) }.buttonStyle(PlainStyle(wide: true))
    }
    private func answer(choice: String) { Task { await model.answer(request, in: row.ref, choice: choice) } }
    private func answer(option: RequestOption) {
        Task {
            if let question = request.questions?.first {
                await model.answer(request, in: row.ref, answers: [question.id: QuestionAnswer(optionIds: [option.id])])
            } else { await model.answer(request, in: row.ref, choice: option.id) }
        }
    }
}

private struct OptionLabel: View {
    let option: RequestOption
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(option.label).fontWeight(.semibold)
            if let description = option.description { Text(description).font(.footnote).foregroundStyle(Palette.muted) }
        }
    }
}

// MARK: Threads

/// Every computer's threads as one list, most recent first; the strip narrows it to one computer.
struct ThreadsView: View {
    @EnvironmentObject var model: AppModel
    @State private var filter = ThreadFilter.all
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ComputerStrip().padding(.bottom, 8)
                FeedbackBanner().padding(.bottom, 8)
                Picker("Show", selection: $filter) { ForEach(ThreadFilter.allCases) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.segmented).padding(.bottom, 6)
                if rows.isEmpty { Text(emptyText).foregroundStyle(Palette.muted).padding(.vertical, 28) }
                ForEach(rows) { row in
                    NavigationLink(value: ThreadRoute(ref: row.ref)) { ThreadRow(row: row) }.buttonStyle(.plain)
                    Divider().overlay(Palette.hairline).padding(.leading, 48)
                }
            }.padding(.horizontal, 16).padding(.bottom, 24)
        }
        .refreshable { await model.reconnectAll() }
        .page("Threads")
    }
    private var rows: [HostedThread] { ThreadGroups.merged(model.lists, show: model.show, filter: filter) }
    private var place: String {
        if case .only(let hostID) = model.show { return model.name(hostID) }
        return model.computers.count == 1 ? model.name(model.computers[0].hostID) : "your computers"
    }
    private var emptyText: String {
        if model.anyConnecting { return "Reading threads…" }
        if filter == .all { return "No threads on \(place) yet. Start one in Sotto on the computer." }
        return "No threads here."
    }
}

/// A thread: what it's doing, then its computer and project. A computer that can't be reached shows
/// its threads as it last shared them, in muted text.
struct ThreadRow: View {
    let row: HostedThread
    var body: some View {
        HStack(spacing: 12) {
            ProviderBadge(providerID: row.thread.providerId, state: state)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.thread.title).fontWeight(.semibold).lineLimit(1).foregroundStyle(row.status == .unreachable ? Palette.muted : Palette.ink)
                line.font(.subheadline).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 56).contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
    private var state: ThreadState { ThreadState(row.thread) }
    private var words: String { row.status == .unreachable ? ComputerStatus.unreachable.words : state.words }
    private var color: Color {
        if row.status == .unreachable { return Palette.muted }
        if state.waitsOnYou { return Palette.warning }
        switch state {
        case .working: return Palette.accent
        case .failed: return Palette.danger
        default: return Palette.muted
        }
    }
    private var rest: String { [row.computer, row.project].compactMap { $0 }.joined(separator: " · ") }
    private var line: Text { Text(words).foregroundColor(color) + Text(" · " + rest).foregroundColor(Palette.muted) }
}

/// The agent's initial with the thread's state dot.
private struct ProviderBadge: View {
    let providerID: String?
    let state: ThreadState
    var body: some View {
        Text(String(Words.provider(providerID).prefix(1)))
            .font(.figtree(14, .footnote, .bold)).foregroundStyle(Palette.muted)
            .frame(width: 36, height: 36).background(Palette.raised, in: RoundedRectangle(cornerRadius: 10))
            .overlay(alignment: .topTrailing) { StatusDot(state: state, size: 10).padding(2).background(Palette.canvas, in: Circle()).offset(x: 4, y: -4) }
            .accessibilityHidden(true)
    }
}
