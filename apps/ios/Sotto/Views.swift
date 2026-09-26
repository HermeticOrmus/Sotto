import SwiftUI
import SottoCore

/// Pairing until this iPhone holds a host, then three tabs: Needs you, Threads and Host.
struct RootView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        if model.saved == nil { PairFlow() } else { MainTabs() }
    }
}

struct MainTabs: View {
    @EnvironmentObject var model: AppModel
    @State private var tab = Tab.needsYou
    enum Tab: Hashable { case needsYou, threads, host }
    var body: some View {
        TabView(selection: $tab) {
            NavigationStack { NeedsYouView().threadDestination() }
                .tabItem { Label("Needs you", systemImage: "tray") }
                .badge(ThreadGroups.waiting(model.threads).count)
                .tag(Tab.needsYou)
            NavigationStack { ThreadsView().threadDestination() }
                .tabItem { Label("Threads", systemImage: "list.bullet") }
                .tag(Tab.threads)
            NavigationStack { HostTabView() }
                .tabItem { Label("Host", systemImage: "server.rack") }
                .tag(Tab.host)
        }
        .toolbarBackground(Palette.surface, for: .tabBar)
    }
}

struct ThreadRoute: Hashable { let id: String }
extension View {
    func threadDestination() -> some View { navigationDestination(for: ThreadRoute.self) { ThreadView(threadID: $0.id) } }
    /// A tab's page: canvas behind it and a large title.
    func page(_ title: String) -> some View {
        background(Palette.canvas).navigationTitle(title)
            .toolbarBackground(Palette.canvas, for: .navigationBar)
    }
    func fieldSurface() -> some View {
        padding(12).frame(minHeight: 48).background(Palette.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.border, lineWidth: 1))
    }
    func card() -> some View {
        padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Palette.border, lineWidth: 1))
    }
}

/// The asset catalog's colours: Sotto's default palette, light and dark (src/shared/themes/palettes.ts).
enum Palette {
    static let canvas = Color("Canvas"), surface = Color("Surface"), raised = Color("Raised")
    static let ink = Color("Ink"), muted = Color("Muted"), border = Color("Border"), hairline = Color("Hairline")
    static let accent = Color("Accent"), action = Color("Action"), actionInk = Color("ActionInk")
    static let bubble = Color("Bubble"), bubbleInk = Color("BubbleInk")
    static let warning = Color("Warning"), warningSurface = Color("WarningSurface"), danger = Color("Danger")
}

extension Font {
    static func figtree(_ size: CGFloat, _ style: Font.TextStyle, _ weight: Font.Weight = .regular) -> Font {
        .custom("Figtree-Regular", size: size, relativeTo: style).weight(weight)
    }
    static let mono = Font.system(.subheadline, design: .monospaced)
}

enum Words {
    static func provider(_ id: String?) -> String {
        ["claude": "Claude Code", "codex": "Codex", "grok": "Grok Build", "devin": "Devin"][id ?? ""] ?? "The agent"
    }
    private static let stamp: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    private static let plainStamp = ISO8601DateFormatter()
    private static let relative: RelativeDateTimeFormatter = { let f = RelativeDateTimeFormatter(); f.unitsStyle = .abbreviated; return f }()
    static func date(_ iso: String?) -> Date? { iso.flatMap { stamp.date(from: $0) ?? plainStamp.date(from: $0) } }
    /// "4 min. ago", or nothing when the host did not say.
    static func ago(_ iso: String?) -> String? { date(iso).map { relative.localizedString(for: $0, relativeTo: Date()) } }
    static func duration(_ ms: Double?) -> String? {
        guard let ms, ms >= 1000 else { return nil }
        let seconds = Int(ms / 1000)
        return seconds < 60 ? "\(seconds)s" : "\(seconds / 60)m \(seconds % 60)s"
    }
}

struct StatusDot: View {
    let state: ThreadState
    var size: CGFloat = 8
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false
    var body: some View {
        Circle().fill(color).frame(width: size, height: size)
            .opacity(state == .working && dim ? 0.35 : 1)
            .onAppear {
                guard state == .working, !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { dim = true }
            }
            .accessibilityHidden(true)
    }
    private var color: Color {
        switch state {
        case .needsAnswer, .asked: return Palette.warning
        case .working: return Palette.accent
        case .failed: return Palette.danger
        case .done: return Palette.muted.opacity(0.55)
        }
    }
}

struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased()).font(.figtree(13, .footnote, .semibold)).tracking(0.5).foregroundStyle(Palette.muted)
            .padding(.top, 18).padding(.bottom, 4).accessibilityAddTraits(.isHeader)
    }
}

struct CommandBox: View {
    let command: String
    var body: some View {
        Text(command).font(.mono).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Palette.canvas, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.hairline, lineWidth: 1))
    }
}

/// Says when the host can't be reached, or what just went wrong, above whatever page is open.
struct ConnectionBanner: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        if model.saved != nil && !model.online && !model.working {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(Palette.warning).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Can’t reach \(model.hostName)").fontWeight(.semibold)
                    Text("Work carries on there. Your drafts are kept.").font(.subheadline).foregroundStyle(Palette.muted)
                }
                Spacer(minLength: 0)
                Button("Reconnect") { Task { await model.reconnect() } }.buttonStyle(PlainStyle(compact: true))
            }
            .padding(12).background(Palette.warningSurface, in: RoundedRectangle(cornerRadius: 14))
        } else if let feedback = model.feedback {
            HStack(alignment: .top, spacing: 10) {
                Text(feedback).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
                Button { model.feedback = nil } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                    .accessibilityLabel("Dismiss message")
            }
            .padding(.leading, 12).background(Palette.raised, in: RoundedRectangle(cornerRadius: 14))
            .accessibilityAddTraits(.updatesFrequently)
        }
    }
}

/// The one accent action on a surface.
struct ActionStyle: ButtonStyle {
    var wide = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.fontWeight(.semibold).padding(.horizontal, 16).frame(maxWidth: wide ? .infinity : nil, minHeight: 48)
            .foregroundStyle(Palette.actionInk).background(Palette.action, in: RoundedRectangle(cornerRadius: 14))
            .opacity(!enabled ? 0.5 : configuration.isPressed ? 0.75 : 1)
    }
}
/// Every other action: the same shape on the raised surface.
struct PlainStyle: ButtonStyle {
    var wide = false, compact = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.fontWeight(.semibold).padding(.horizontal, compact ? 12 : 16).frame(maxWidth: wide ? .infinity : nil, minHeight: 44)
            .foregroundStyle(Palette.ink).background(Palette.raised, in: RoundedRectangle(cornerRadius: compact ? 12 : 14))
            .opacity(!enabled ? 0.5 : configuration.isPressed ? 0.75 : 1)
    }
}
/// A choice in a question: left-aligned, with its explanation under it.
struct ChoiceStyle: ButtonStyle {
    var chosen = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).padding(.horizontal, 14).padding(.vertical, 10)
            .foregroundStyle(Palette.ink).background(Palette.raised, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(chosen ? Palette.accent : .clear, lineWidth: 2))
            .opacity(!enabled ? 0.5 : configuration.isPressed ? 0.75 : 1)
    }
}
