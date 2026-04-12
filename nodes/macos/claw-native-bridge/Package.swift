// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "claw-native-bridge",
  platforms: [
    // ScreenCaptureKit is macOS 12.3+, but in practice you’ll want a modern baseline.
    .macOS(.v13),
  ],
  products: [
    .executable(name: "claw-native-bridge", targets: ["claw-native-bridge"]),
  ],
  targets: [
    .executableTarget(
      name: "claw-native-bridge",
      dependencies: [],
      path: "Sources"
    ),
  ]
)

