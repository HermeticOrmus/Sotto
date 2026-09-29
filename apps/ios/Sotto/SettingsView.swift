import SwiftUI

/// Phone-only display preferences. Nothing here is sent to a paired computer.
enum PhoneAppearance: String, CaseIterable {
    case dark, light
    var title: String { self == .dark ? "Dark" : "Light" }
    var scheme: ColorScheme { self == .dark ? .dark : .light }
}

struct SettingsView: View {
    @AppStorage("phoneAppearance") private var appearance = PhoneAppearance.dark.rawValue
    @AppStorage("phoneLargerText") private var largerText = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                VStack(alignment: .leading, spacing: 14) {
                    heading("Appearance")
                    HStack(spacing: 12) {
                        ForEach(PhoneAppearance.allCases, id: \.rawValue) { choice in
                            Button { appearance = choice.rawValue } label: {
                                VStack(alignment: .leading, spacing: 14) {
                                    VStack(alignment: .leading, spacing: 8) {
                                        Capsule().fill(Palette.muted).frame(width: 70, height: 7)
                                        Capsule().fill(Palette.muted).frame(width: 45, height: 5)
                                        Spacer(minLength: 0)
                                    }.padding(14).frame(maxWidth: .infinity, minHeight: 76, maxHeight: 76, alignment: .leading)
                                        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 9))
                                        .environment(\.colorScheme, choice.scheme).accessibilityHidden(true)
                                    HStack {
                                        Text(choice.title).font(.figtree(16, .body))
                                        Spacer(minLength: 4)
                                        Image(systemName: appearance == choice.rawValue ? "checkmark.circle" : "circle")
                                            .foregroundStyle(appearance == choice.rawValue ? Palette.accent : Palette.muted)
                                            .accessibilityHidden(true)
                                    }
                                }.padding(14).foregroundStyle(Palette.ink)
                                    .background(appearance == choice.rawValue ? Palette.accent.opacity(0.12) : Palette.surface, in: RoundedRectangle(cornerRadius: 17))
                                    .overlay(RoundedRectangle(cornerRadius: 17).stroke(appearance == choice.rawValue ? Palette.accent : Palette.border, lineWidth: 1))
                            }.buttonStyle(.plain)
                                .accessibilityLabel(choice.title).accessibilityValue(appearance == choice.rawValue ? "Selected" : "Not selected")
                                .accessibilityAddTraits(appearance == choice.rawValue ? .isSelected : [])
                                .accessibilityIdentifier("setting-\(choice.rawValue)")
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 14) {
                    heading("Reading")
                    Divider().overlay(Palette.hairline)
                    Toggle(isOn: $largerText) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Larger text").font(.figtree(17, .body))
                            Text("Increase text size throughout Sotto.").font(.figtree(14, .subheadline)).foregroundStyle(Palette.muted)
                        }
                    }.padding(.vertical, 3).accessibilityIdentifier("setting-larger-text")
                    Divider().overlay(Palette.hairline)
                }
            }.padding(.horizontal, 22).padding(.top, 22).padding(.bottom, 30)
        }.page("Settings")
    }
    private func heading(_ text: String) -> some View {
        Text(text).font(.figtree(14, .subheadline, .semibold)).foregroundStyle(Palette.muted).accessibilityAddTraits(.isHeader)
    }
}

/// Raising the minimum never shrinks a system accessibility size.
struct PhoneDisplayPreferences: ViewModifier {
    @AppStorage("phoneAppearance") private var appearance = PhoneAppearance.dark.rawValue
    @AppStorage("phoneLargerText") private var largerText = false
    @Environment(\.dynamicTypeSize) private var systemSize
    func body(content: Content) -> some View {
        content.preferredColorScheme((PhoneAppearance(rawValue: appearance) ?? .dark).scheme)
            .dynamicTypeSize(largerText ? max(systemSize, .xxxLarge) : systemSize)
    }
}
