// swift-tools-version:5.9
// Swift bridge to Apple's Foundation Models (Apple Intelligence).
// Built as a static library by `swift-rs` from src-tauri/build.rs.
import PackageDescription

let package = Package(
    name: "CRMIntelligence",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "CRMIntelligence", type: .static, targets: ["CRMIntelligence"]),
    ],
    targets: [
        .target(name: "CRMIntelligence", path: "Sources/CRMIntelligence"),
    ]
)
