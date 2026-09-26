import SwiftUI
import SottoCore

/// Pairing in two steps: find the host by its name on the tailnet, then enter the code it printed.
/// Pairing admits this iPhone; whether it may answer permissions is decided on the host.
struct PairFlow: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        Group {
            if let found = model.found { CodeStep(found: found) } else { NameStep() }
        }
        .background(Palette.canvas)
    }
}

private struct StepHeader: View {
    let step: Int, title: String, detail: String
    var body: some View {
        VStack(spacing: 8) {
            Text("Step \(step) of 2").font(.subheadline).foregroundStyle(Palette.muted)
            Text(title).font(.figtree(28, .title, .bold)).multilineTextAlignment(.center).accessibilityAddTraits(.isHeader)
            Text(detail).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
        }
    }
}

private struct PairFeedback: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        if let feedback = model.feedback {
            Text(feedback).font(.subheadline).foregroundStyle(Palette.warning).multilineTextAlignment(.center)
                .accessibilityAddTraits(.updatesFrequently)
        }
    }
}

struct NameStep: View {
    @EnvironmentObject var model: AppModel
    @State private var name = ""
    @FocusState var focused: Bool
    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 24) {
                    StepHeader(step: 1, title: "Pair with your host", detail: "Its name on your tailnet, such as forge.")
                    TextField("forge", text: $name).keyboardType(.URL).textContentType(.URL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .submitLabel(.next).onSubmit(find).focused($focused).fieldSurface()
                        .accessibilityLabel("Host name")
                    PairFeedback()
                }.padding(.horizontal, 24).padding(.top, 32)
            }.scrollDismissesKeyboard(.interactively)
            Button(model.working ? "Finding the host…" : "Next", action: find).buttonStyle(ActionStyle(wide: true))
                .disabled(model.working || !model.storageReady || name.trimmingCharacters(in: .whitespaces).isEmpty)
                .padding(.horizontal, 24).padding(.bottom, 12)
        }
        .onAppear { focused = true }
    }
    private func find() {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        Task { await model.find(name) }
    }
}

struct CodeStep: View {
    @EnvironmentObject var model: AppModel
    let found: FoundHost
    @State private var code = ""
    @FocusState var focused: Bool
    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 24) {
                    StepHeader(step: 2, title: "Enter the pairing code",
                               detail: "Run the host’s pairing command on \(found.name) and type the code it prints. A code works once, for five minutes.")
                    ZStack {
                        // The field takes the typing; the boxes show it. VoiceOver reads the field.
                        TextField("", text: $code).keyboardType(.asciiCapable).textContentType(.oneTimeCode)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled()
                            .submitLabel(.go).onSubmit(pair).focused($focused)
                            .foregroundStyle(.clear).tint(.clear).accessibilityLabel("Pairing code")
                        CodeBoxes(code: code, focused: focused).allowsHitTesting(false)
                    }
                    .contentShape(Rectangle()).onTapGesture { focused = true }
                    HStack(spacing: 6) {
                        Image(systemName: "server.rack").accessibilityHidden(true)
                        Text(found.endpoint.url.host ?? found.name).lineLimit(1).truncationMode(.middle)
                        Button("Change") { model.changeHost() }.frame(minHeight: 44).disabled(model.working)
                            .accessibilityLabel("Change host")
                    }.font(.subheadline).foregroundStyle(Palette.muted)
                    PairFeedback()
                }.padding(.horizontal, 24).padding(.top, 32)
            }.scrollDismissesKeyboard(.interactively)
            Button(model.working ? "Pairing…" : "Pair", action: pair).buttonStyle(ActionStyle(wide: true))
                .disabled(model.working || code.count != PairingCode.length)
                .padding(.horizontal, 24).padding(.bottom, 12)
        }
        .onAppear { focused = true }
        .onChange(of: code) { _, typed in
            let cleaned = PairingCode.cleaned(typed)
            if cleaned != typed { code = cleaned }
        }
    }
    private func pair() {
        guard code.count == PairingCode.length else { return }
        Task { await model.pair(code: code); if model.saved != nil { code = "" } }
    }
}

/// Eight boxes in two groups of four, the way the host prints a code.
private struct CodeBoxes: View {
    let code: String, focused: Bool
    var body: some View {
        let characters = Array(code)
        HStack(spacing: 5) {
            ForEach(0..<PairingCode.length, id: \.self) { index in
                if index == 4 { Text("–").foregroundStyle(Palette.muted).frame(width: 10) }
                let current = focused && index == min(characters.count, PairingCode.length - 1)
                Text(index < characters.count ? String(characters[index]) : " ")
                    .font(.system(size: 24, weight: .semibold, design: .monospaced))
                    .frame(width: 34, height: 50)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(current ? Palette.accent : Palette.border, lineWidth: current ? 2 : 1))
            }
        }
        .accessibilityHidden(true)
    }
}
