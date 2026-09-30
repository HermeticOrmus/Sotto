import SwiftUI
import SottoCore

/// Three choices: computer, project (or a folder on it), then that computer's model and options.
struct NewThreadSheet: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let opened: (ThreadRef) -> Void
    private enum Step: Equatable { case computer, project, folders, options }
    @State private var step = Step.computer
    @State private var hostID = ""
    @State private var projectID: String?
    @State private var folder: FolderListing?
    @State private var modelID = ""
    @State private var effort = ""
    @State private var permissionID = ""
    private var models: [ThreadModel] { model.creationModels(hostID) }
    private var chosenModel: ThreadModel? { models.first { $0.id == modelID } }
    private var busy: Bool { model.creatingHostID != nil }
    private var projectTitle: String {
        folder?.projectName ?? model.projects(hostID).first { $0.id == projectID }?.title ?? "Project"
    }
    var body: some View {
        NavigationStack {
            Group {
                switch step {
                case .computer: computers
                case .project: projects
                case .folders:
                    ComputerFolderPicker(hostID: hostID, initialPath: folder?.path) { value in
                        folder = value; projectID = nil; chooseOptions()
                    }
                case .options: options
                }
            }
            .font(.figtree(17, .body)).foregroundStyle(Palette.ink)
            .background(Palette.canvas).navigationTitle("New thread").navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Palette.canvas, for: .navigationBar)
            .toolbar {
                if step != .computer {
                    ToolbarItem(placement: .topBarLeading) { Button("Back") { back() }.disabled(busy) }
                }
                ToolbarItem(placement: .topBarTrailing) { Button("Cancel") { dismiss() }.disabled(busy).keyboardShortcut(.cancelAction) }
            }
        }
        .interactiveDismissDisabled(busy)
        .onAppear { model.creationFeedback = nil }
    }
    private var computers: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                heading("1 of 3", "Where should it run?")
                ForEach(model.computers, id: \.hostID) { computer in
                    Button {
                        hostID = computer.hostID; projectID = nil; folder = nil; step = .project
                    } label: {
                        choice(computer.name, detail: model.status(computer.hostID).words, symbol: "laptopcomputer")
                    }.buttonStyle(.plain).disabled(!model.online(computer.hostID))
                        .accessibilityIdentifier("new-thread-computer-\(computer.hostID)")
                    Divider().overlay(Palette.hairline)
                }
                if !model.computers.contains(where: { model.online($0.hostID) }) {
                    Text("Reconnect a computer in Computers before starting a thread.")
                        .foregroundStyle(Palette.muted).padding(.top, 20)
                }
            }.padding(22)
        }
    }
    private var projects: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                heading("2 of 3 · \(model.name(hostID))", "Choose a project")
                connectionNotice
                ForEach(model.projects(hostID)) { project in
                    Button {
                        projectID = project.id; folder = nil; chooseOptions()
                    } label: { choice(project.title, detail: project.path, symbol: "folder") }
                        .buttonStyle(.plain).disabled(!model.online(hostID))
                        .accessibilityIdentifier("new-thread-project-\(project.id)")
                    Divider().overlay(Palette.hairline)
                }
                Button { step = .folders } label: {
                    choice("Browse another folder", detail: "Folders on \(model.name(hostID))", symbol: "folder.badge.plus")
                }.buttonStyle(.plain).foregroundStyle(Palette.accent).disabled(!model.canBrowseFolders(hostID))
                    .accessibilityIdentifier("browse-project-folder")
                if !model.canBrowseFolders(hostID), model.online(hostID) {
                    Text("Update Sotto on this computer to browse its folders.")
                        .font(.figtree(14, .subheadline)).foregroundStyle(Palette.muted).padding(.top, 12)
                }
            }.padding(22)
        }
    }
    private var options: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                heading("3 of 3 · \(model.name(hostID))", projectTitle)
                connectionNotice
                if let path = folder?.path ?? model.projects(hostID).first(where: { $0.id == projectID })?.path {
                    Text(path).font(.figtree(13, .footnote)).foregroundStyle(Palette.muted).textSelection(.enabled)
                }
                if models.isEmpty {
                    Text("No ready models on this computer. Connect a provider in Sotto there, then try again.")
                        .foregroundStyle(Palette.muted)
                } else {
                    field("Model") {
                        Picker("Model", selection: $modelID) {
                            if !models.contains(where: { $0.id == modelID }) {
                                Text("Saved model unavailable — choose a model").tag(modelID).selectionDisabled(true)
                            }
                            ForEach(models) { value in Text("\(Words.provider(value.providerId)) · \(value.name)").tag(value.id) }
                        }.pickerStyle(.menu).accessibilityIdentifier("new-thread-model")
                    }
                    if let chosenModel, let efforts = chosenModel.reasoningEfforts, !efforts.isEmpty {
                        field("Effort") {
                            Picker("Effort", selection: $effort) {
                                ForEach(efforts, id: \.self) { Text($0.capitalized).tag($0) }
                            }.pickerStyle(.menu).accessibilityIdentifier("new-thread-effort")
                        }
                    }
                    if let chosenModel {
                        field("Permissions") {
                            Picker("Permissions", selection: $permissionID) {
                                if permissionID.isEmpty { Text("Choose a permission mode").tag("") }
                                ForEach(chosenModel.permissions) { permission in
                                    Text(permission.name).tag(permission.id).selectionDisabled(permission.grants && !model.mayAnswer(hostID))
                                }
                            }.pickerStyle(.menu).accessibilityIdentifier("new-thread-permissions")
                        }
                        if let permission = chosenModel.permissions.first(where: { $0.id == permissionID }), let asks = permission.asks {
                            Text(asks).font(.figtree(14, .subheadline)).foregroundStyle(Palette.muted)
                        }
                        if chosenModel.permissions.isEmpty {
                            Text("This model has no supported permission modes. Choose another model.").foregroundStyle(Palette.muted)
                        } else if !model.mayAnswer(hostID) {
                            Text("This iPhone can start a thread that asks before acting. To answer its permissions here, turn on Can answer in this computer’s Settings › Phones.")
                                .font(.figtree(14, .subheadline)).foregroundStyle(Palette.muted)
                        }
                    }
                }
                Text("Uses the project’s shared folder.").font(.figtree(14, .subheadline)).foregroundStyle(Palette.muted)
                if let feedback = model.creationFeedback { Text(feedback).foregroundStyle(Palette.warning).accessibilityIdentifier("creation-feedback") }
                ForEach(model.pendingCreations.filter { $0.hostID == hostID }) { CreationPendingRow(operation: $0) }
            }.padding(22)
        }
        .onChange(of: modelID) { _, _ in resetOptions() }
        .safeAreaInset(edge: .bottom) {
            Button {
                Task {
                    if let ref = await model.createThread(on: hostID, projectID: projectID, folder: folder,
                                                         modelID: modelID, effort: effort, permissionID: permissionID) {
                        dismiss(); opened(ref)
                    }
                }
            } label: {
                HStack { if busy { ProgressView().tint(Palette.actionInk) }; Text(busy ? "Opening thread…" : "Open thread on \(model.name(hostID))") }
            }.buttonStyle(ActionStyle(wide: true)).disabled(!canCreate).accessibilityIdentifier("open-new-thread")
                .padding(.horizontal, 22).padding(.vertical, 12).background(Palette.canvas)
        }
    }
    private var canCreate: Bool {
        guard !busy, model.online(hostID), !model.pendingCreations.contains(where: { $0.hostID == hostID }),
              let chosenModel, let permission = chosenModel.permissions.first(where: { $0.id == permissionID }),
              !permission.grants || model.mayAnswer(hostID) else { return false }
        return folder?.path != nil || model.projects(hostID).contains { $0.id == projectID }
    }
    @ViewBuilder private var connectionNotice: some View {
        if !model.online(hostID) { Text("Can’t reach \(model.name(hostID)). Reconnect before opening a thread.").foregroundStyle(Palette.warning) }
    }
    private func chooseOptions() {
        modelID = model.initialCreationModelID(hostID); step = .options; resetOptions()
    }
    private func resetOptions() {
        effort = chosenModel.map { model.initialCreationEffort(hostID, model: $0) } ?? ""
        permissionID = chosenModel?.startingPermission ?? ""
    }
    private func back() {
        model.creationFeedback = nil
        switch step {
        case .computer: dismiss()
        case .project: step = .computer
        case .folders: step = .project
        case .options: step = folder == nil ? .project : .folders
        }
    }
    private func heading(_ step: String, _ title: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(step).font(.figtree(13, .footnote)).foregroundStyle(Palette.muted)
            Text(title).font(.figtree(25, .title2, .semibold)).accessibilityAddTraits(.isHeader)
        }.padding(.bottom, 18)
    }
    private func choice(_ title: String, detail: String?, symbol: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).foregroundStyle(Palette.accent).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(title).fontWeight(.semibold)
                if let detail { Text(detail).font(.figtree(13, .footnote)).foregroundStyle(Palette.muted) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").foregroundStyle(Palette.muted).accessibilityHidden(true)
        }.frame(minHeight: 64).padding(.vertical, 12).contentShape(Rectangle())
    }
    private func field<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.figtree(13, .footnote)).foregroundStyle(Palette.muted)
            content().frame(maxWidth: .infinity, alignment: .leading).fieldSurface()
        }
    }
}

private struct ComputerFolderPicker: View {
    @EnvironmentObject var model: AppModel
    let hostID: String
    let initialPath: String?
    let selected: (FolderListing) -> Void
    @State private var listing: FolderListing?
    @State private var filter = ""
    @State private var path = ""
    @State private var loading = false
    @State private var problem: String?
    @State private var requestID = UUID()
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Folders on \(model.name(hostID))").font(.figtree(23, .title2, .semibold)).accessibilityAddTraits(.isHeader)
                HStack {
                    Button("Home") { read(nil) }.frame(minHeight: 44)
                    Button("All folders") { read(.null) }.frame(minHeight: 44)
                    Spacer(minLength: 0)
                    if let listing, listing.crumbs.count > 1 {
                        Button("Up") { read(listing.crumbs[listing.crumbs.count - 2].path.map(JSONValue.string) ?? .null) }
                            .frame(minHeight: 44).accessibilityLabel("Open parent folder")
                    }
                }.foregroundStyle(Palette.accent)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Full folder path").font(.figtree(13, .footnote)).foregroundStyle(Palette.muted)
                    TextField("Enter a folder path", text: $path).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .submitLabel(.go).onSubmit { if !path.isEmpty { read(.string(path)) } }.fieldSurface()
                        .accessibilityIdentifier("project-folder-path").accessibilityLabel("Full folder path on \(model.name(hostID))")
                    Button("Go to folder") { read(.string(path)) }.disabled(path.isEmpty).frame(minHeight: 44)
                }
                TextField("Filter folders", text: $filter).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .fieldSurface().accessibilityLabel("Filter folders in this directory").accessibilityIdentifier("folder-filter")
                if loading { ProgressView("Reading folders…").frame(maxWidth: .infinity) }
                if let problem { Text(problem).foregroundStyle(Palette.warning) }
                if let listing, !loading, problem == nil {
                    Text(listing.path ?? "Drives").font(.figtree(13, .footnote)).foregroundStyle(Palette.muted).textSelection(.enabled)
                    LazyVStack(spacing: 0) {
                        ForEach(listing.folders.filter { filter.isEmpty || $0.name.localizedCaseInsensitiveContains(filter) }) { folder in
                            Button { read(.string(folder.path)) } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "folder").foregroundStyle(Palette.accent).accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(folder.name)
                                        if folder.git { Text("Git repository").font(.figtree(12, .caption)).foregroundStyle(Palette.muted) }
                                    }.frame(maxWidth: .infinity, alignment: .leading)
                                    Image(systemName: "chevron.right").foregroundStyle(Palette.muted).accessibilityHidden(true)
                                }.frame(minHeight: 54).padding(.vertical, 8).contentShape(Rectangle())
                            }.buttonStyle(.plain).accessibilityIdentifier("folder-\(folder.name)")
                            Divider().overlay(Palette.hairline)
                        }
                    }
                    if listing.folders.isEmpty { Text("No subfolders here.").foregroundStyle(Palette.muted) }
                    if listing.truncated { Text("Only the first 1,000 folders are listed. Enter a full path to open another.").font(.figtree(14, .subheadline)).foregroundStyle(Palette.muted) }
                }
            }.padding(22)
        }.scrollDismissesKeyboard(.interactively)
        .task { await load(initialPath.map(JSONValue.string)) }
        .onDisappear { requestID = UUID() }
        .safeAreaInset(edge: .bottom) {
            Button("Use this folder") { if let listing { selected(listing) } }
                .buttonStyle(ActionStyle(wide: true)).disabled(loading || problem != nil || listing?.path == nil || !model.online(hostID))
                .accessibilityIdentifier("use-project-folder").padding(.horizontal, 22).padding(.vertical, 12).background(Palette.canvas)
        }
    }
    private func read(_ path: JSONValue?) { Task { await load(path) } }
    private func load(_ target: JSONValue?) async {
        let current = UUID(); requestID = current; loading = true; problem = nil
        defer { if requestID == current { loading = false } }
        do {
            let result = try await model.folders(hostID, path: target)
            guard requestID == current else { return }
            switch result {
            case .listed(let value): listing = value; path = value.path ?? ""; filter = ""
            case .missing: problem = "This folder doesn’t exist. Nothing was added. Go Home or enter another path."
            case .unreadable: problem = "This folder can’t be read. Nothing was added. Go Home or choose another folder."
            }
        } catch { if requestID == current { problem = error.localizedDescription } }
    }
}

struct CreationPendingRow: View {
    @EnvironmentObject var model: AppModel
    let operation: PendingOperation
    @State private var dismissing = false
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(operation.kind == "create-project" ? "Project registration" : "Thread creation") on \(model.name(operation.hostID)) is unconfirmed.")
                .fontWeight(.semibold)
            Text("Nothing was resent. Check this computer before trying again.").font(.figtree(14, .subheadline)).foregroundStyle(Palette.muted)
            Button("Check again") { Task { await model.checkDelivery(operation.hostID) } }
                .buttonStyle(PlainStyle(compact: true)).disabled(!model.online(operation.hostID))
            Button("Dismiss unconfirmed action") { dismissing = true }.frame(minHeight: 44)
        }.card()
        .confirmationDialog("Dismiss this unconfirmed action?", isPresented: $dismissing, titleVisibility: .visible) {
            Button("Dismiss unconfirmed action") { model.acknowledgeUnknown(operation.id) }
        } message: { Text("The computer may already have created it. Check its projects and threads first. Dismissing sends nothing.") }
    }
}
