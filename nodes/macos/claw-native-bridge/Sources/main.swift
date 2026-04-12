import Foundation
import ApplicationServices
import CoreGraphics
import ScreenCaptureKit
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import AppKit

// MARK: - JSON protocol

/// Line-delimited JSON request from Node.js.
///
/// Example:
/// `{"id":"1","method":"ax.uiTree","params":{"maxDepth":10,"maxNodes":1200}}`
struct BridgeRequest: Decodable {
  struct Params: Decodable {
    var maxDepth: Int?
    var maxNodes: Int?

    // Screenshot parameters (optional; keep minimal for now)
    var displayIndex: Int?
    var maxWidth: Int?
    var maxHeight: Int?

    // Menu bar parameters
    var statusText: String?
    var blink: Bool?
    var activeBrain: String?
    var title: String?
    var routerMode: String?
    var recommendLocal: Bool?
  }

  var id: String
  var method: String
  var params: Params?
}

struct BridgeErrorPayload: Encodable {
  var message: String
  var systemHint: String?
  var code: Int?
  var kind: String?
}

struct BridgeResponse: Encodable {
  var id: String
  var ok: Bool
  var result: EncodableValue?
  var error: BridgeErrorPayload?
}

// MARK: - Async events (stdout push)

struct BridgeEvent: Encodable {
  var type: String
  var atMs: Int64
  var data: EncodableValue?
}

struct BridgeEventEnvelope: Encodable {
  var event: BridgeEvent
}

/// Minimal “any encodable” wrapper.
enum EncodableValue: Encodable {
  case object([String: EncodableValue])
  case array([EncodableValue])
  case string(String)
  case number(Double)
  case bool(Bool)
  case null

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .object(let dict):
      try container.encode(dict)
    case .array(let arr):
      try container.encode(arr)
    case .string(let s):
      try container.encode(s)
    case .number(let n):
      try container.encode(n)
    case .bool(let b):
      try container.encode(b)
    case .null:
      try container.encodeNil()
    }
  }
}

// MARK: - Diagnostics

let accessibilityHint = "Accessibility permissions may be missing. Please grant Accessibility access to Apex in System Settings > Privacy & Security > Accessibility and restart the daemon."
let screenRecordingHint = "Screen Recording permissions may be missing. Please grant Screen Recording access to Apex in System Settings > Privacy & Security > Screen Recording and restart the daemon."

func looksLikeAccessibilityDenied(_ message: String) -> Bool {
  let m = message.lowercased()
  return m.contains("not authorized")
    || m.contains("not permitted")
    || m.contains("operation not permitted")
    || m.contains("kaxerrorapidisabled")
    || m.contains("kaxerrorcannotcomplete")
    || m.contains("accessibility")
}

func hintForAxErrorCode(_ code: Int) -> String? {
  // Common accessibility-related failures:
  // -25204 is frequently observed when AX access is not granted for the process.
  if code == -25204 {
    return accessibilityHint
  }
  return nil
}

// MARK: - AX scanning

struct AxFrame: Encodable {
  var x: Double
  var y: Double
  var w: Double
  var h: Double
}

struct AxUiNode: Encodable {
  var id: String
  var type: String
  var label: String?
  var role: String?
  var subrole: String?
  var frame: AxFrame?
  var enabled: Bool?
  var hidden: Bool?
  var children: [AxUiNode]?
}

struct AxUiTree: Encodable {
  var appName: String
  var capturedAtMs: Int64
  var root: AxUiNode
  var limits: Limits

  struct Limits: Encodable {
    var maxDepth: Int
    var maxNodes: Int
  }
}

func axCopyString(_ element: AXUIElement, _ attr: CFString) -> String? {
  var value: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(element, attr, &value)
  guard err == .success else { return nil }
  if let s = value as? String, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    return s
  }
  return nil
}

func axCopyCGPoint(_ element: AXUIElement, _ attr: CFString) -> CGPoint? {
  var value: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(element, attr, &value)
  guard err == .success, let axValue = value else { return nil }
  var point = CGPoint.zero
  if CFGetTypeID(axValue) == AXValueGetTypeID() {
    let ok = AXValueGetValue((axValue as! AXValue), .cgPoint, &point)
    return ok ? point : nil
  }
  return nil
}

func axCopyCGSize(_ element: AXUIElement, _ attr: CFString) -> CGSize? {
  var value: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(element, attr, &value)
  guard err == .success, let axValue = value else { return nil }
  var size = CGSize.zero
  if CFGetTypeID(axValue) == AXValueGetTypeID() {
    let ok = AXValueGetValue((axValue as! AXValue), .cgSize, &size)
    return ok ? size : nil
  }
  return nil
}

func axCopyChildren(_ element: AXUIElement) -> [AXUIElement] {
  var value: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value)
  guard err == .success else { return [] }
  return (value as? [AXUIElement]) ?? []
}

func axCopyBool(_ element: AXUIElement, _ attr: CFString) -> Bool? {
  var value: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(element, attr, &value)
  guard err == .success else { return nil }
  if let b = value as? Bool {
    return b
  }
  if let n = value as? NSNumber {
    return n.boolValue
  }
  return nil
}

func axIsIgnored(_ element: AXUIElement) -> Bool {
  // Prefer AXIsIgnored (requested), fall back to AXIgnored.
  return axCopyBool(element, "AXIsIgnored" as CFString)
    ?? axCopyBool(element, "AXIgnored" as CFString)
    ?? false
}

func simplifyRole(_ role: String?) -> String {
  guard var r = role, !r.isEmpty else { return "unknown" }
  if r.hasPrefix("AX") { r.removeFirst(2) }
  return r.prefix(1).lowercased() + r.dropFirst()
}

func bestLabel(for element: AXUIElement) -> String? {
  let candidates: [CFString] = [
    kAXTitleAttribute as CFString,
    kAXDescriptionAttribute as CFString,
    kAXValueAttribute as CFString,
    kAXHelpAttribute as CFString,
  ]
  for attr in candidates {
    if let s = axCopyString(element, attr) {
      return String(s.prefix(200))
    }
  }
  return nil
}

func frameFor(_ element: AXUIElement) -> AxFrame? {
  guard let pos = axCopyCGPoint(element, kAXPositionAttribute as CFString),
        let size = axCopyCGSize(element, kAXSizeAttribute as CFString) else {
    return nil
  }
  let w = Double(size.width)
  let h = Double(size.height)
  if w <= 0 || h <= 0 {
    return nil
  }
  return AxFrame(x: Double(pos.x), y: Double(pos.y), w: w, h: h)
}

func getFrontmostAxRoot() throws -> AXUIElement {
  let sys = AXUIElementCreateSystemWide()
  var focusedAppRef: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(sys, kAXFocusedApplicationAttribute as CFString, &focusedAppRef)
  guard err == .success, let app = focusedAppRef else {
    let msg = "Failed to get focused application (\(err.rawValue))"
    throw NSError(domain: "claw-native-bridge.ax", code: Int(err.rawValue), userInfo: [NSLocalizedDescriptionKey: msg])
  }
  return app as! AXUIElement
}

func getFocusedWindow(for app: AXUIElement) -> AXUIElement? {
  var value: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &value)
  guard err == .success else { return nil }
  return value as! AXUIElement?
}

func scanAxTree(app: AXUIElement, root: AXUIElement, maxDepth: Int, maxNodes: Int) throws -> AxUiTree {
  var pid: pid_t = 0
  AXUIElementGetPid(app, &pid)
  let appName = NSRunningApplication(processIdentifier: pid)?.localizedName
    ?? axCopyString(app, kAXTitleAttribute as CFString)
    ?? "FrontmostApp"
  var emitted = 0

  func shouldInclude(_ el: AXUIElement) -> (include: Bool, frame: AxFrame?) {
    // Only include elements that have a non-zero frame and are not ignored.
    let ignored = axIsIgnored(el)
    let frame = frameFor(el)
    if ignored || frame == nil {
      return (false, frame)
    }

    // Skip empty AXStaticText nodes (common in web views; high token noise).
    let role = axCopyString(el, kAXRoleAttribute as CFString)
    if role == "AXStaticText" {
      let text = bestLabel(for: el)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      if text.isEmpty {
        return (false, frame)
      }
    }

    return (true, frame)
  }

  func walkCollect(_ el: AXUIElement, depth: Int, path: String) -> [AxUiNode] {
    if emitted >= maxNodes { return [] }
    // Strict depth enforcement: do not traverse or emit beyond maxDepth.
    if depth > maxDepth { return [] }

    // Always traverse children to find framed elements even if the parent is a container without frame.
    let kids = axCopyChildren(el)
    var childNodes: [AxUiNode] = []
    if depth < maxDepth && !kids.isEmpty {
      for (index, k) in kids.enumerated() {
        childNodes.append(contentsOf: walkCollect(k, depth: depth + 1, path: "\(path).\(index)"))
        if emitted >= maxNodes { break }
      }
    }

    let (include, frame) = shouldInclude(el)
    if !include || emitted >= maxNodes {
      // Bubble up included descendants.
      return childNodes
    }

    let role = axCopyString(el, kAXRoleAttribute as CFString)
    let subrole = axCopyString(el, kAXSubroleAttribute as CFString)
    var node = AxUiNode(
      id: path,
      type: simplifyRole(role),
      label: bestLabel(for: el),
      role: role,
      subrole: subrole,
      frame: frame,
      enabled: axCopyBool(el, "AXEnabled" as CFString),
      hidden: axCopyBool(el, "AXHidden" as CFString),
      children: nil
    )
    emitted += 1

    if !childNodes.isEmpty {
      node.children = childNodes
    }
    return [node]
  }

  let collected = walkCollect(root, depth: 0, path: "0")
  if collected.isEmpty {
    throw NSError(domain: "claw-native-bridge.ax", code: -1, userInfo: [NSLocalizedDescriptionKey: "AX scan produced an empty tree"])
  }

  // Prefer returning the focused window root node if it survives filtering; otherwise synthesize a root.
  let rootNode: AxUiNode
  if collected.count == 1 {
    rootNode = collected[0]
  } else {
    rootNode = AxUiNode(
      id: "root",
      type: "window",
      label: "FocusedWindow",
      role: "AXWindow",
      subrole: nil,
      frame: frameFor(root),
      enabled: nil,
      hidden: nil,
      children: collected
    )
  }

  return AxUiTree(
    appName: appName,
    capturedAtMs: Int64(Date().timeIntervalSince1970 * 1000),
    root: rootNode,
    limits: .init(maxDepth: maxDepth, maxNodes: maxNodes)
  )
}

// MARK: - ScreenCaptureKit single-frame capture

final class FrameCollector: NSObject, SCStreamOutput {
  private let continuation: CheckedContinuation<CMSampleBuffer, Error>
  private var completed = false

  init(_ continuation: CheckedContinuation<CMSampleBuffer, Error>) {
    self.continuation = continuation
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, !completed else { return }
    completed = true
    continuation.resume(returning: sampleBuffer)
  }
}

func pngData(from sampleBuffer: CMSampleBuffer, maxWidth: Int?, maxHeight: Int?) throws -> Data {
  guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
    throw NSError(domain: "claw-native-bridge.sck", code: -2, userInfo: [NSLocalizedDescriptionKey: "No image buffer in sample"])
  }

  let ciImage = CIImage(cvPixelBuffer: imageBuffer)
  let context = CIContext(options: [.useSoftwareRenderer: false])

  var outputImage = ciImage
  if let mw = maxWidth, mw > 0, let mh = maxHeight, mh > 0 {
    let sx = CGFloat(mw) / ciImage.extent.width
    let sy = CGFloat(mh) / ciImage.extent.height
    let s = min(sx, sy, 1)
    outputImage = ciImage.transformed(by: CGAffineTransform(scaleX: s, y: s))
  }

  guard let cgImage = context.createCGImage(outputImage, from: outputImage.extent) else {
    throw NSError(domain: "claw-native-bridge.sck", code: -3, userInfo: [NSLocalizedDescriptionKey: "Failed to create CGImage"])
  }

  let data = NSMutableData()
  guard let dest = CGImageDestinationCreateWithData(data as CFMutableData, UTType.png.identifier as CFString, 1, nil) else {
    throw NSError(domain: "claw-native-bridge.sck", code: -4, userInfo: [NSLocalizedDescriptionKey: "Failed to create image destination"])
  }
  CGImageDestinationAddImage(dest, cgImage, nil)
  guard CGImageDestinationFinalize(dest) else {
    throw NSError(domain: "claw-native-bridge.sck", code: -5, userInfo: [NSLocalizedDescriptionKey: "Failed to encode PNG"])
  }
  return data as Data
}

func captureScreenPng(displayIndex: Int?, maxWidth: Int?, maxHeight: Int?) async throws -> Data {
  let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
  let displays = content.displays
  guard !displays.isEmpty else {
    throw NSError(domain: "claw-native-bridge.sck", code: -1, userInfo: [NSLocalizedDescriptionKey: "No displays available"])
  }
  let idx = max(0, min(displayIndex ?? 0, displays.count - 1))
  let display = displays[idx]

  let filter = SCContentFilter(display: display, excludingWindows: [])
  let config = SCStreamConfiguration()
  config.capturesAudio = false
  config.showsCursor = false
  config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
  config.queueDepth = 1

  let stream = SCStream(filter: filter, configuration: config, delegate: nil)

  let sample: CMSampleBuffer = try await withCheckedThrowingContinuation { continuation in
    let collector = FrameCollector(continuation)
    let queue = DispatchQueue(label: "claw-native-bridge.sck.output")
    try? stream.addStreamOutput(collector, type: .screen, sampleHandlerQueue: queue)
    stream.startCapture { err in
      if let err {
        continuation.resume(throwing: err)
      }
    }
  }

  try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
    stream.stopCapture { err in
      if let err { cont.resume(throwing: err) } else { cont.resume(returning: ()) }
    }
  }

  return try pngData(from: sample, maxWidth: maxWidth, maxHeight: maxHeight)
}

// MARK: - Main loop

@main
struct ClawNativeBridge {
  static func main() {
    let stdin = FileHandle.standardInput
    let stdout = FileHandle.standardOutput
    let decoder = JSONDecoder()
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]

    let writeQueue = DispatchQueue(label: "claw-native-bridge.stdout")
    let writeResponse: @Sendable (BridgeResponse) -> Void = { response in
      writeQueue.async {
        do {
          let data = try encoder.encode(response)
          stdout.write(data)
          stdout.write(Data([0x0A]))
          // Ensure events/responses don't clump due to buffering.
          stdout.synchronizeFile()
        } catch {
          // Avoid crashing the bridge if encoding fails.
        }
      }
    }

    let writeEvent: @Sendable (BridgeEventEnvelope) -> Void = { envelope in
      writeQueue.async {
        do {
          let data = try encoder.encode(envelope)
          stdout.write(data)
          stdout.write(Data([0x0A]))
          // Ensure proactive focus events flush immediately.
          stdout.synchronizeFile()
        } catch {
          // Avoid crashing the bridge if encoding fails.
        }
      }
    }

    // MARK: Menu Bar (NSStatusItem)
    var statusItem: NSStatusItem? = nil
    var blinkTimer: Timer? = nil
    var baseTitle: String = "Apex"
    var blinkOn = false
    var brainLocalItem: NSMenuItem? = nil
    var brainGeminiItem: NSMenuItem? = nil
    var brainSmartItem: NSMenuItem? = nil
    var switchLocalRecommendedItem: NSMenuItem? = nil
    var testGeminiItem: NSMenuItem? = nil
    var menuTarget: BridgeMenuTarget? = nil

    let ensureMenu: () -> Void = {
      DispatchQueue.main.async {
        if statusItem == nil {
          NSApplication.shared.setActivationPolicy(.accessory)
          statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        }

        if statusItem?.menu != nil {
          return
        }

        let menu = NSMenu()

        let smart = NSMenuItem(title: "Smart Mode", action: #selector(BridgeMenuTarget.switchSmart(_:)), keyEquivalent: "")
        let local = NSMenuItem(title: "Switch to Local", action: #selector(BridgeMenuTarget.switchLocal(_:)), keyEquivalent: "")
        let gemini = NSMenuItem(title: "Switch to Gemini", action: #selector(BridgeMenuTarget.switchGemini(_:)), keyEquivalent: "")
        let localRecommended = NSMenuItem(title: "Switch to Local (recommended)", action: #selector(BridgeMenuTarget.switchLocalRecommended(_:)), keyEquivalent: "")
        localRecommended.isEnabled = false
        let test = NSMenuItem(title: "Test Connection (Gemini)", action: #selector(BridgeMenuTarget.testGemini(_:)), keyEquivalent: "")

        let target = BridgeMenuTarget(writeEvent: writeEvent)
        smart.target = target
        local.target = target
        gemini.target = target
        localRecommended.target = target
        test.target = target
        menuTarget = target

        brainSmartItem = smart
        brainLocalItem = local
        brainGeminiItem = gemini
        switchLocalRecommendedItem = localRecommended
        testGeminiItem = test

        menu.addItem(smart)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(local)
        menu.addItem(gemini)
        menu.addItem(localRecommended)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(test)

        statusItem?.menu = menu
      }
    }

    let setBrainUi: (_ activeBrain: String, _ routerMode: String?, _ recommendLocal: Bool) -> Void = { activeBrain, routerMode, recommendLocal in
      DispatchQueue.main.async {
        ensureMenu()
        let isGemini = activeBrain.lowercased() == "gemini"
        let isSmart = (routerMode?.lowercased() ?? "") == "smart"
        brainSmartItem?.state = isSmart ? .on : .off
        brainGeminiItem?.state = (!isSmart && isGemini) ? .on : .off
        brainLocalItem?.state = (!isSmart && !isGemini) ? .on : .off
        switchLocalRecommendedItem?.isEnabled = recommendLocal
        switchLocalRecommendedItem?.state = .off

        // Visual feedback: SF Symbols icon on status item.
        let symbolName = isSmart ? "sparkles" : (isGemini ? "cloud.fill" : "house.fill")
        if let img = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil) {
          img.isTemplate = true
          statusItem?.button?.image = img
          statusItem?.button?.imagePosition = .imageLeft
        }
      }
    }

    let applyMenuBarTitle: (String) -> Void = { title in
      DispatchQueue.main.async {
        if statusItem == nil {
          NSApplication.shared.setActivationPolicy(.accessory)
          statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        }
        ensureMenu()
        statusItem?.button?.title = title
      }
    }

    let setBlinking: (Bool) -> Void = { enabled in
      DispatchQueue.main.async {
        blinkTimer?.invalidate()
        blinkTimer = nil
        blinkOn = false

        if !enabled {
          statusItem?.button?.title = baseTitle
          return
        }

        // Simple "blink" effect by toggling a dot prefix.
        blinkTimer = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: true) { _ in
          blinkOn.toggle()
          let title = blinkOn ? "• \(baseTitle)" : baseTitle
          statusItem?.button?.title = title
        }
      }
    }

    // Ensure status item exists early (but keep minimal UI).
    applyMenuBarTitle(baseTitle)

    // MARK: Workspace focus events -> stdout
    DispatchQueue.main.async {
      NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.didActivateApplicationNotification,
        object: nil,
        queue: nil
      ) { note in
        let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        let bundleId = app?.bundleIdentifier
        let name = app?.localizedName
        let pid = app?.processIdentifier

        var data: [String: EncodableValue] = [:]
        if let bundleId { data["bundleId"] = .string(bundleId) }
        if let name { data["name"] = .string(name) }
        if let pid { data["pid"] = .number(Double(pid)) }

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        writeEvent(.init(event: .init(type: "WINDOW_FOCUS", atMs: now, data: .object(data))))
      }
    }

    // Read stdin in a background task while the AppKit runloop is active.
    Task.detached(priority: .userInitiated) {
      // Robust line framing: stdin can deliver partial JSON lines.
      var buffer = Data()
      while true {
        guard let chunk = try? stdin.read(upToCount: 64 * 1024) else { break }
        if chunk.isEmpty { break } // EOF
        buffer.append(chunk)

        while let newlineIndex = buffer.firstIndex(of: 0x0A) {
          let lineData = buffer.prefix(upTo: newlineIndex)
          buffer.removeSubrange(...newlineIndex)

          let line = String(decoding: lineData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
          guard !line.isEmpty, let json = line.data(using: .utf8) else { continue }

          do {
            let req = try decoder.decode(BridgeRequest.self, from: json)
            switch req.method {
            case "ax.uiTree":
              do {
                let maxDepth = max(1, req.params?.maxDepth ?? 10)
                let maxNodes = max(1, req.params?.maxNodes ?? 1200)
                let app = try getFrontmostAxRoot()
                let focusedWindow = getFocusedWindow(for: app)
                let traversalRoot = focusedWindow ?? app
                let tree = try scanAxTree(app: app, root: traversalRoot, maxDepth: maxDepth, maxNodes: maxNodes)

                let childCount = tree.root.children?.count ?? 0
                if childCount == 0 {
                  writeResponse(.init(
                    id: req.id,
                    ok: false,
                    result: nil,
                    error: .init(message: "AX scan returned an empty UI tree.", systemHint: accessibilityHint, code: -25204, kind: "permissions")
                  ))
                } else {
                  let encodedTree = try JSONEncoder().encode(tree)
                  let treeJson = String(decoding: encodedTree, as: UTF8.self)
                  writeResponse(.init(id: req.id, ok: true, result: .string(treeJson), error: nil))
                }
              } catch {
                let message = (error as NSError).localizedDescription
                let nsError = error as NSError
                let hint = hintForAxErrorCode(nsError.code) ?? (looksLikeAccessibilityDenied(message) ? accessibilityHint : nil)
                let kind = nsError.code == -25204 ? "permissions" : nil
                writeResponse(.init(id: req.id, ok: false, result: nil, error: .init(message: message, systemHint: hint, code: nsError.code, kind: kind)))
              }

            case "screen.capturePng":
              Task {
                do {
                  let png = try await captureScreenPng(
                    displayIndex: req.params?.displayIndex,
                    maxWidth: req.params?.maxWidth,
                    maxHeight: req.params?.maxHeight
                  )
                  let b64 = png.base64EncodedString()
                  writeResponse(.init(id: req.id, ok: true, result: .string(b64), error: nil))
                } catch {
                  let message = (error as NSError).localizedDescription
                  writeResponse(.init(id: req.id, ok: false, result: nil, error: .init(message: message, systemHint: screenRecordingHint)))
                }
              }

            case "menuBar.updateStatus":
              let text = req.params?.statusText?.trimmingCharacters(in: .whitespacesAndNewlines)
              if let text, !text.isEmpty {
                baseTitle = text
                applyMenuBarTitle(baseTitle)
              }
              let blink = req.params?.blink ?? false
              setBlinking(blink)
              writeResponse(.init(id: req.id, ok: true, result: .object(["ok": .bool(true)]), error: nil))

            case "menuBar.configureBrainSelector":
              let title = req.params?.title?.trimmingCharacters(in: .whitespacesAndNewlines)
              if let title, !title.isEmpty {
                baseTitle = title
                applyMenuBarTitle(baseTitle)
              } else {
                applyMenuBarTitle(baseTitle)
              }
              let activeBrain = req.params?.activeBrain ?? "local"
              let routerMode = req.params?.routerMode
              let recommendLocal = req.params?.recommendLocal ?? false
              setBrainUi(activeBrain, routerMode, recommendLocal)
              writeResponse(.init(id: req.id, ok: true, result: .object(["ok": .bool(true)]), error: nil))

            default:
              writeResponse(.init(
                id: req.id,
                ok: false,
                result: nil,
                error: .init(message: "Unknown method: \(req.method)", systemHint: nil)
              ))
            }
          } catch {
            // Malformed request: ignore.
            continue
          }
        }
      }

      // EOF: terminate the app cleanly.
      DispatchQueue.main.async {
        NSApplication.shared.terminate(nil)
      }
    }

    // Run an AppKit runloop so the status item can render.
    NSApplication.shared.run()
  }
}

// MARK: - Menu target -> stdout events
@objc final class BridgeMenuTarget: NSObject {
  let writeEvent: @Sendable (BridgeEventEnvelope) -> Void
  init(writeEvent: @escaping @Sendable (BridgeEventEnvelope) -> Void) {
    self.writeEvent = writeEvent
  }

  private func send(action: String) {
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    let data: [String: EncodableValue] = ["action": .string(action)]
    writeEvent(.init(event: .init(type: "MENU_BAR_ACTION", atMs: now, data: .object(data))))
  }

  @objc func switchLocal(_ sender: Any?) { send(action: "switch_local") }
  @objc func switchGemini(_ sender: Any?) { send(action: "switch_gemini") }
  @objc func switchSmart(_ sender: Any?) { send(action: "switch_smart") }
  @objc func switchLocalRecommended(_ sender: Any?) { send(action: "switch_local_recommended") }
  @objc func testGemini(_ sender: Any?) { send(action: "test_gemini") }
}

