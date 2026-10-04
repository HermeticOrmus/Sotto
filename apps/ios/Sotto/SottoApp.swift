import SwiftUI

@main struct SottoApp: App {
    @StateObject private var model = AppModel()
    @StateObject private var previews = PhotoPreviews()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model).environmentObject(previews)
                .font(.custom("Figtree-Regular", size: 17, relativeTo: .body))
                .foregroundStyle(Color("Ink")).tint(Color("Accent"))
                .overlay {
                    if phase != .active {
                        Color("Canvas").ignoresSafeArea().overlay(Text("Sotto").font(.title2).foregroundStyle(Color("Ink")))
                    }
                }
                .task {
                    // A sent reply's photos are drawn from this iPhone's own copies until the thread is read again.
                    model.photosSent = { [weak previews] photos, ref in previews?.keep(photos, ref: ref) }
                    model.phase(phase)
                }
                .onChange(of: phase) { _, value in model.phase(value) }
                .modifier(PhoneDisplayPreferences())
        }
    }
}
