import SwiftUI
import SottoCore

// MARK: Needs you

/// Home: every question and permission waiting on the user, answerable in place, then what is working.
struct NeedsYouView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                ConnectionBanner()
                let waiting = ThreadGroups.waiting(model.threads)
                if waiting.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "checkmark").font(.title2).foregroundStyle(Palette.accent).accessibilityHidden(true)
                        Text("Nothing needs you").fontWeight(.semibold)
                        Text("Questions and permissions from threads on \(model.hostName) appear here.")
                            .font(.subheadline).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 26).padding(.horizontal, 20)
                    .overlay(RoundedRectangle(cornerRadius: 20).stroke(Palette.border, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
                    .accessibilityElement(children: .combine)
                }
                ForEach(waiting) { item in RequestCard(thread: item.thread, request: item.request) }
                let working = ThreadGroups.working(model.threads)
                if !working.isEmpty {
                    SectionLabel("Working")
                    ForEach(working) { thread in
                        NavigationLink(value: ThreadRoute(id: thread.id)) {
                            HStack(spacing: 12) {
                                StatusDot(state: .working)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(thread.title).fontWeight(.semibold).lineLimit(1)
                                    Text(WorkingLine.text(thread)).font(.subheadline).foregroundStyle(Palette.muted).lineLimit(1)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Palette.muted).accessibilityHidden(true)
                            }.frame(minHeight: 44).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        Divider().overlay(Palette.hairline)
                    }
                }
            }.padding(.horizontal, 16).padding(.bottom, 24)
        }
        .refreshable { await model.reconnect() }
        .page("Needs you")
    }
}

private enum WorkingLine {
    static func text(_ thread: ThreadSummary) -> String {
        var parts: [String] = [Words.provider(thread.providerId)]
        if let ago = Words.ago(thread.summary?.runningTurnStartedAt) { parts.append("started \(ago)") }
        return parts.joined(separator: " · ")
    }
}

/// One waiting request. A tap on a choice answers it; nothing is chosen or sent for the user.
struct RequestCard: View {
    @EnvironmentObject var model: AppModel
    let thread: ThreadSummary
    let request: AgentRequest
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink(value: ThreadRoute(id: thread.id)) {
                HStack(spacing: 8) {
                    StatusDot(state: ThreadState(thread))
                    Text(thread.title).font(.subheadline).fontWeight(.semibold).lineLimit(1)
                    Spacer(minLength: 4)
                    if let ago = Words.ago(thread.summary?.lastMessageAt) { Text(ago).font(.footnote).foregroundStyle(Palette.muted) }
                }.frame(minHeight: 32).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel("Open \(thread.title)")
            Text(headline).fixedSize(horizontal: false, vertical: true)
            if let command = request.context?.command { CommandBox(command: command) }
            actions
        }.card()
    }
    private var headline: String {
        if request.kind == "permission", request.context?.command != nil { return "\(Words.provider(thread.providerId)) wants to run a command." }
        if let questions = request.questions, questions.count == 1 { return questions[0].question }
        return request.text
    }
    private var enabled: Bool { model.canAnswer(request, in: thread) && !model.answering }
    @ViewBuilder private var actions: some View {
        if !request.supported {
            explain("This request can’t be answered here. Open the thread to see it.")
        } else if !model.mayAnswer {
            explain("This iPhone can’t answer \(request.kind == "permission" ? "permissions" : "questions") on \(model.hostName). Answer it on the desktop.")
        } else if request.kind == "permission" {
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
        } else if let options = request.oneTapOptions {
            VStack(spacing: 6) {
                ForEach(options) { option in
                    Button { answer(option: option) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(option.label).fontWeight(.semibold)
                            if let description = option.description { Text(description).font(.footnote).foregroundStyle(Palette.muted) }
                        }
                    }.buttonStyle(ChoiceStyle())
                }
            }.disabled(!enabled)
        } else { openThread("Answer") }
    }
    private func explain(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(text).font(.subheadline).foregroundStyle(Palette.muted)
            openThread("Open thread")
        }
    }
    private func openThread(_ label: String) -> some View {
        NavigationLink(value: ThreadRoute(id: thread.id)) { Text(label).frame(maxWidth: .infinity) }.buttonStyle(PlainStyle(wide: true))
    }
    private func answer(choice: String) { Task { await model.answer(request, in: thread.id, choice: choice) } }
    private func answer(option: RequestOption) {
        Task {
            if let question = request.questions?.first {
                await model.answer(request, in: thread.id, answers: [question.id: QuestionAnswer(optionIds: [option.id])])
            } else { await model.answer(request, in: thread.id, choice: option.id) }
        }
    }
}

// MARK: Threads

struct ThreadsView: View {
    @EnvironmentObject var model: AppModel
    @State private var filter = ThreadFilter.all
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ConnectionBanner().padding(.bottom, 8)
                Picker("Show", selection: $filter) { ForEach(ThreadFilter.allCases) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.segmented)
                let groups = ThreadGroups.byProject(model.threads, projects: model.projects, filter: filter)
                if groups.isEmpty { Text(emptyText).foregroundStyle(Palette.muted).padding(.vertical, 28) }
                ForEach(groups) { group in
                    SectionLabel(group.title)
                    ForEach(group.threads) { thread in
                        NavigationLink(value: ThreadRoute(id: thread.id)) { ThreadRow(thread: thread) }.buttonStyle(.plain)
                        Divider().overlay(Palette.hairline).padding(.leading, 48)
                    }
                }
            }.padding(.horizontal, 16).padding(.bottom, 24)
        }
        .refreshable { await model.reconnect() }
        .page("Threads")
    }
    private var emptyText: String {
        if model.working { return "Reading threads…" }
        if filter == .all { return "No threads on \(model.hostName) yet. Start one on the desktop." }
        return "No threads here."
    }
}

struct ThreadRow: View {
    let thread: ThreadSummary
    var body: some View {
        let state = ThreadState(thread)
        let rest: String = [Words.provider(thread.providerId), Words.ago(thread.summary?.lastMessageAt)].compactMap { $0 }.joined(separator: " · ")
        let stateColor: Color = state.waitsOnYou ? Palette.warning : state == .working ? Palette.accent : state == .failed ? Palette.danger : Palette.muted
        let line: Text = Text(state.words).foregroundColor(stateColor) + Text(" · " + rest).foregroundColor(Palette.muted)
        HStack(spacing: 12) {
            Text(String(Words.provider(thread.providerId).prefix(1)))
                .font(.figtree(14, .footnote, .bold)).foregroundStyle(Palette.muted)
                .frame(width: 36, height: 36).background(Palette.raised, in: RoundedRectangle(cornerRadius: 10))
                .overlay(alignment: .topTrailing) { StatusDot(state: state, size: 10).padding(2).background(Palette.canvas, in: Circle()).offset(x: 4, y: -4) }
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(thread.title).fontWeight(.semibold).lineLimit(1)
                line.font(.subheadline).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 56).contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: Host

struct HostTabView: View {
    @EnvironmentObject var model: AppModel
    @State private var confirmForget = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(model.saved.flatMap { URL(string: $0.address)?.host } ?? model.hostName)
                        .font(.subheadline).foregroundStyle(Palette.muted).textSelection(.enabled)
                    HStack(spacing: 10) {
                        Circle().fill(model.online ? Palette.accent : Palette.warning).frame(width: 10, height: 10).accessibilityHidden(true)
                        Text(model.online ? "Connected" : model.working ? "Connecting…" : "Can’t reach it").font(.figtree(22, .title2, .bold))
                    }
                    if !model.online && !model.working {
                        Text("Work carries on on the host. Your drafts are kept. Check that Tailscale is connected on this iPhone, then reconnect.")
                            .font(.subheadline).foregroundStyle(Palette.muted)
                        Button { Task { await model.reconnect() } } label: { Label("Reconnect", systemImage: "arrow.clockwise") }
                            .buttonStyle(ActionStyle(wide: true))
                    }
                }.card()
                VStack(spacing: 0) {
                    row("Answers from this iPhone", model.mayAnswer ? "Allowed" : "Not allowed")
                    Divider().overlay(Palette.hairline)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Client ID")
                        Text(model.saved?.pairing.clientId ?? "").font(.mono).foregroundStyle(Palette.muted).textSelection(.enabled)
                    }.frame(maxWidth: .infinity, minHeight: 48, alignment: .leading).padding(.horizontal, 16).padding(.vertical, 8)
                }.background(Palette.surface, in: RoundedRectangle(cornerRadius: 16))
                if !model.mayAnswer {
                    Text("To answer permissions and questions from this iPhone, run the host’s --allow-answers command with this client ID.")
                        .font(.subheadline).foregroundStyle(Palette.muted)
                }
                if let feedback = model.feedback { Text(feedback).font(.subheadline).accessibilityAddTraits(.updatesFrequently) }
                Button("Forget this host", role: .destructive) { confirmForget = true }
                    .foregroundStyle(Palette.danger).frame(maxWidth: .infinity, minHeight: 48, alignment: .leading).padding(.horizontal, 16)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16)).disabled(model.working)
                Text("Forget removes this iPhone’s pairing. Threads stay on the host.").font(.footnote).foregroundStyle(Palette.muted)
            }.padding(.horizontal, 16).padding(.bottom, 24)
        }
        .refreshable { await model.reconnect() }
        .page("Host")
        .confirmationDialog("Forget \(model.hostName)?", isPresented: $confirmForget, titleVisibility: .visible) {
            Button("Remove pairing and forget", role: .destructive) { Task { await model.forgetHost() } }
        } message: { Text("If the host can’t be reached, the pairing is kept so you can try again.") }
    }
    private func row(_ label: String, _ value: String) -> some View {
        HStack { Text(label); Spacer(); Text(value).foregroundStyle(Palette.muted) }
            .frame(minHeight: 48).padding(.horizontal, 16)
    }
}
