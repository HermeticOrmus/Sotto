// swift-tools-version: 5.9
import PackageDescription
import Foundation

// Compile the actual app model against scripted storage and transport on macOS. Keep SwiftUI
// out of SottoCore; the core's protocol tests remain usable with a standalone Swift toolchain.
var modelTests: [Target] = []
#if os(macOS)
let modelSources = ["Sotto/AppModel.swift", "Tests/SottoAppModelTests"]
let appDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Sotto")
let otherAppFiles = (try? FileManager.default.contentsOfDirectory(atPath: appDirectory.path)) ?? []
modelTests = [.testTarget(name: "SottoAppModelTests", dependencies: ["SottoCore"], path: ".",
    exclude: ["Sources", "Scripts", "Sotto.xcodeproj", "README.md", "ExportOptions.example.plist", "Tests/SottoCoreTests"]
        + otherAppFiles.filter { $0 != "AppModel.swift" }.map { "Sotto/" + $0 }, sources: modelSources)]
#endif
let package = Package(name: "SottoCore", platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "SottoCore", targets: ["SottoCore"])],
    targets: [.target(name: "SottoCore"), .testTarget(name: "SottoCoreTests", dependencies: ["SottoCore"])] + modelTests)
