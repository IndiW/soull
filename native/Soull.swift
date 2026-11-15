import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: WKWebView!
    var allowedPort: Int?
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Soull Dev", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Soull Dev", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let appItem = NSMenuItem(); appItem.submenu = appMenu; menu.addItem(appItem)
        let editMenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        let editItem = NSMenuItem(); editItem.submenu = editMenu; menu.addItem(editItem)
        let viewMenu = NSMenu(title: "View")
        let reload = NSMenuItem(title: "Reload Interface", action: #selector(reloadUI), keyEquivalent: "r"); reload.target = self; viewMenu.addItem(reload)
        let viewItem = NSMenuItem(); viewItem.submenu = viewMenu; menu.addItem(viewItem)
        NSApplication.shared.mainMenu = menu
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "clipboard")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.isInspectable = true
        web.underPageBackgroundColor = NSColor(calibratedRed: 0.12, green: 0.11, blue: 0.14, alpha: 1)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 940), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Soull Dev"
        window.minSize = NSSize(width: 960, height: 680)
        window.appearance = NSAppearance(named: .darkAqua)
        window.contentView = web
        window.center(); window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        connect()
    }
    func connect() {
        do {
            let project = Bundle.main.object(forInfoDictionaryKey: "SoullProjectRoot") as? String ?? FileManager.default.currentDirectoryPath
            let runtimePath = ProcessInfo.processInfo.environment["SOULL_RUNTIME_FILE"] ?? project + "/.soull/runtime.json"
            let data = try Data(contentsOf: URL(fileURLWithPath: runtimePath))
            guard let runtime = try JSONSerialization.jsonObject(with: data) as? [String: Any], let base = runtime["url"] as? String, let token = runtime["token"] as? String, let url = URL(string: base), url.scheme == "http", url.host == "127.0.0.1", let port = url.port, let destination = URL(string: base + "/#" + token) else { throw NSError(domain: "Soull", code: 1) }
            allowedPort = port
            web.load(URLRequest(url: destination))
        } catch {
            let alert = NSAlert(); alert.messageText = "Start the Soull service first"
            alert.informativeText = "From the Soull project folder, run npm run build, then npm run service. Choose View → Reload Interface after the service starts."
            alert.runModal()
        }
    }
    @objc func reloadUI() { if web.url == nil { connect() } else { web.reload() } }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "clipboard", message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == "127.0.0.1", message.frameInfo.securityOrigin.port == allowedPort, let text = message.body as? String else { return }
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "http", url.host == "127.0.0.1", url.port == allowedPort { decisionHandler(.allow) }
        else { if navigationAction.navigationType == .linkActivated && ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }; decisionHandler(.cancel) }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
