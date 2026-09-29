import SwiftUI
import SottoCore

/// Focus reads only host list summaries. Opening a thread subscribes to its detail.
struct ThreadsView: View {
    @EnvironmentObject var model: AppModel
    @State private var query = ""
    @State private var settledExpanded = false
    @FocusState private var searching: Bool
    var body: some View {
        let groups = FocusThreads(model.lists, show: model.show, query: query)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ComputerMenu().padding(.bottom, 6)
                searchPill.padding(.bottom, 12)
                HStack(spacing: 18) {
                    (Text("\(groups.working.count)").foregroundColor(Palette.accent) + Text(" working"))
                    Text("\(groups.requestCount) \(groups.requestCount == 1 ? "needs" : "need") you")
                }.font(.figtree(13, .footnote)).foregroundStyle(Palette.muted)
                FeedbackBanner().padding(.top, 8)
                ForEach(model.lists.filter { model.show.admits($0.hostID) && $0.status != .online }, id: \.hostID) { computer in
                    connectionNote(computer).padding(.top, 12)
                }
                if groups.isEmpty {
                    Text(groups.searching ? "No matching threads." : model.anyConnecting ? "Reading threads…" : "No threads here yet. Start one in Sotto on your computer.")
                        .foregroundStyle(Palette.muted).padding(.vertical, 28)
                }
                if !groups.questions.isEmpty {
                    FocusHeading("Needs your answer", count: groups.questions.count)
                    ForEach(groups.questions) { row in threadLink(row, style: .question).padding(.bottom, 10) }
                }
                if !groups.working.isEmpty {
                    FocusHeading("Working now", count: groups.working.count)
                    ForEach(groups.working) { row in threadLink(row, style: .working).padding(.bottom, 10) }
                }
                if !groups.recent.isEmpty {
                    FocusHeading("Recent", count: groups.recent.count)
                    ForEach(groups.recent) { row in threadLink(row, style: .recent); Divider().overlay(Palette.hairline) }
                }
                if !groups.settled.isEmpty {
                    if groups.searching { FocusHeading("Settled", count: groups.settled.count) }
                    else {
                        Button { settledExpanded.toggle() } label: {
                            HStack(spacing: 9) {
                                Image(systemName: settledExpanded ? "chevron.down" : "chevron.right").font(.caption)
                                Text("Settled"); Spacer(); Text("\(groups.settled.count)")
                            }.font(.figtree(15, .subheadline)).foregroundStyle(Palette.muted)
                                .frame(minHeight: 52).contentShape(Rectangle())
                        }.buttonStyle(.plain).padding(.top, 16)
                            .accessibilityIdentifier("settled-threads")
                            .accessibilityLabel(settledExpanded ? "Hide settled threads" : "Show settled threads")
                            .accessibilityValue("\(groups.settled.count) threads, \(settledExpanded ? "expanded" : "collapsed")")
                    }
                    if settledExpanded || groups.searching {
                        ForEach(groups.settled) { row in threadLink(row, style: .recent); Divider().overlay(Palette.hairline) }
                    }
                }
            }.padding(.horizontal, 22).padding(.bottom, 24)
        }.scrollDismissesKeyboard(.interactively).refreshable { await model.refresh() }.page("Threads")
    }
    private var searchPill: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Palette.muted).accessibilityHidden(true)
            TextField("Search threads", text: $query).focused($searching)
                .font(.figtree(16, .body)).textInputAutocapitalization(.never).autocorrectionDisabled()
                .submitLabel(.search).onSubmit { searching = false }
                .accessibilityLabel("Search threads").accessibilityIdentifier("thread-search")
            if !query.isEmpty {
                Button { query = ""; searching = true } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.muted).frame(width: 44, height: 44)
                }.buttonStyle(.plain).accessibilityLabel("Clear search")
            }
        }.padding(.leading, 16).padding(.trailing, query.isEmpty ? 16 : 2).frame(minHeight: 48)
            .background(Palette.raised, in: Capsule())
            .overlay(Capsule().stroke(searching ? Palette.accent : Palette.hairline, lineWidth: 1))
    }
    private func threadLink(_ row: HostedThread, style: FocusRow.Style) -> some View {
        NavigationLink(value: ThreadRoute(ref: row.ref)) { FocusRow(row: row, style: style) }
            .buttonStyle(.plain).accessibilityIdentifier("thread-\(row.id)")
    }
    private func connectionNote(_ computer: ComputerThreads) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(computer.status == .connecting ? "Checking \(computer.name)…" : "Can’t reach \(computer.name). Showing its last shared threads.")
                .font(.figtree(13, .footnote)).foregroundStyle(Palette.muted)
            if computer.status == .unreachable {
                Button("Reconnect to \(computer.name)") { Task { await model.connect(computer.hostID) } }
                    .font(.figtree(14, .subheadline)).frame(minHeight: 44).buttonStyle(.plain).foregroundStyle(Palette.accent)
            }
        }
    }
}

private struct ComputerMenu: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        Menu {
            Picker("Computer", selection: $model.show) {
                Text("All computers").tag(ComputerFilter.all)
                ForEach(model.computers, id: \.hostID) { computer in
                    Text("\(computer.name) · \(model.status(computer.hostID).words)").tag(ComputerFilter.only(computer.hostID))
                }
            }
        } label: {
            HStack(spacing: 7) {
                if case .only(let id) = model.show { ComputerDot(status: model.status(id), size: 5) }
                else { Image(systemName: "laptopcomputer").font(.caption) }
                Text(title)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
            }.font(.figtree(14, .subheadline)).foregroundStyle(Palette.muted).frame(minHeight: 44)
        }.accessibilityLabel("Choose a computer").accessibilityValue(title).accessibilityIdentifier("computer-filter")
    }
    private var title: String {
        if case .only(let id) = model.show { return model.name(id) }
        return "All computers"
    }
}

private struct FocusHeading: View {
    let title: String
    let count: Int
    init(_ title: String, count: Int) { self.title = title; self.count = count }
    var body: some View {
        HStack { Text(title); Spacer(); Text("\(count)") }
            .font(.figtree(13, .footnote, .semibold)).foregroundStyle(Palette.muted)
            .padding(.top, 22).padding(.bottom, 12).accessibilityAddTraits(.isHeader)
    }
}

private struct FocusRow: View {
    enum Style { case question, working, recent }
    let row: HostedThread
    let style: Style
    private var state: ThreadState { ThreadState(row.thread) }
    var body: some View {
        Group {
            switch style {
            case .question:
                VStack(alignment: .leading, spacing: 9) {
                    Label("Needs you", systemImage: "questionmark.circle").font(.figtree(12, .caption)).foregroundStyle(Palette.warning)
                    title
                    if let request = row.thread.requests.first {
                        Text(request.questions?.first?.question ?? request.text).font(.figtree(15, .subheadline))
                            .foregroundStyle(Palette.muted).lineLimit(2)
                    }
                    metadata
                    HStack {
                        Text(row.thread.requests.count > 1 ? "Review \(row.thread.requests.count) requests" : row.thread.requests.first?.kind == "permission" ? "Review permission" : "Review question")
                        Spacer(); Image(systemName: "chevron.right").accessibilityHidden(true)
                    }.font(.figtree(14, .subheadline, .semibold)).foregroundStyle(Palette.warning).padding(.top, 3)
                }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.warningSurface, in: UnevenRoundedRectangle(bottomTrailingRadius: 14, topTrailingRadius: 14))
                    .overlay(alignment: .leading) { Rectangle().fill(Palette.warning).frame(width: 2) }
            case .working:
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .firstTextBaseline) { status; Spacer(minLength: 8); timestamp }
                    title
                    Text(workDescription).font(.figtree(15, .subheadline)).foregroundStyle(Palette.muted).lineLimit(2)
                    Divider().overlay(Palette.hairline).padding(.top, 3)
                    metadata
                }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 17))
                    .overlay(RoundedRectangle(cornerRadius: 17).stroke(Palette.hairline, lineWidth: 1))
            case .recent:
                VStack(alignment: .leading, spacing: 7) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) { title; Spacer(minLength: 0); timestamp }
                    if !row.reachable || state == .failed { status }
                    metadata
                }.frame(maxWidth: .infinity, minHeight: 56, alignment: .leading).padding(.vertical, 14)
            }
        }.contentShape(Rectangle()).accessibilityElement(children: .combine)
    }
    private var title: some View {
        Text(row.thread.title).font(.figtree(style == .working ? 18 : 16, .headline, .semibold))
            .foregroundStyle(Palette.ink).lineLimit(3).fixedSize(horizontal: false, vertical: true)
    }
    private var metadata: some View {
        Text([row.project, Words.provider(row.thread.providerId), row.computer].compactMap { $0 }.joined(separator: " · "))
            .font(.figtree(12, .caption)).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
    }
    private var timestamp: some View {
        Text(Words.ago(row.thread.summary?.runningTurnStartedAt ?? row.thread.summary?.lastMessageAt) ?? "")
            .font(.figtree(11, .caption2)).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
    }
    private var status: some View {
        HStack(spacing: 6) {
            if row.reachable { StatusDot(state: state, size: 5) }
            Text(row.reachable ? state.words : row.status.words)
        }.font(.figtree(12, .caption)).foregroundStyle(!row.reachable ? Palette.muted : state == .failed ? Palette.danger : Palette.accent)
    }
    private var workDescription: String {
        if state == .compacting { return "Making room in the thread’s context." }
        if state == .waiting { return "A background command is still running." }
        if row.thread.status != "running", !(row.thread.backgroundWork ?? []).isEmpty { return "Background agents are still working." }
        return "\(Words.provider(row.thread.providerId)) is working on \(row.computer)."
    }
}
