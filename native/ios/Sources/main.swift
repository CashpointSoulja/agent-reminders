import UIKit
import WebKit

#if targetEnvironment(simulator)
private final class UITestNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
#endif

@MainActor
final class WebController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {
    private var web: WKWebView!
    private var origin: URL = URL(string: "https://reminders-web-rea.pages.dev")!
    private var navigationGeneration = 0
    private var preparingAccountImport = false
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .systemBackground
        if let configured = UserDefaults.standard.string(forKey: "companion.origin"), let valid = try? CompanionOrigin.validate(configured) { origin = valid }
        let configuration = WKWebViewConfiguration()
        #if targetEnvironment(simulator)
        if UITestSessionPolicy.allows(environment: ProcessInfo.processInfo.environment, origin: origin) {
            configuration.websiteDataStore = .nonPersistent()
        }
        #endif
        configuration.userContentController.add(self, name: "reaDevice")
        configuration.userContentController.addUserScript(WKUserScript(source: """
        (() => {
          let viewport = document.querySelector('meta[name="viewport"]');
          if (!viewport) { viewport = document.createElement('meta'); viewport.name = 'viewport'; document.head.append(viewport); }
          const content = (viewport.content || 'width=device-width, initial-scale=1').split(',').map(item => item.trim()).filter(item => !item.startsWith('viewport-fit='));
          content.push('viewport-fit=cover'); viewport.content = content.join(', ');
          document.body?.setAttribute('data-native-shell', 'true');
          document.documentElement.setAttribute('data-native-document', crypto.randomUUID());
        })();
        """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self; web.translatesAutoresizingMaskIntoConstraints = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.isInspectable = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        loadInitialPage()
    }
    private func loadInitialPage() {
        #if targetEnvironment(simulator)
        if UITestSessionPolicy.allows(environment: ProcessInfo.processInfo.environment, origin: origin) {
            Task { @MainActor in
                let configuration = URLSessionConfiguration.ephemeral
                configuration.httpCookieStorage = nil; configuration.urlCache = nil; configuration.httpShouldSetCookies = false
                let session = URLSession(configuration: configuration, delegate: UITestNoRedirect(), delegateQueue: nil)
                defer { session.invalidateAndCancel() }
                do {
                    var request = URLRequest(url: origin.appendingPathComponent("qa/test-session"))
                    request.timeoutInterval = 10
                    let (_, response) = try await session.data(for: request)
                    guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                          CompanionOrigin.matches(response.url, origin),
                          let header = response.value(forHTTPHeaderField: "Set-Cookie") else { throw NativeSyncError.permission }
                    let cookies = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: origin)
                    guard cookies.count == 1, let cookie = cookies.first, cookie.name == "reminders_session",
                          cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == "localhost",
                          cookie.path == "/api", cookie.isHTTPOnly,
                          let expiry = cookie.expiresDate, expiry > Date(), expiry.timeIntervalSinceNow <= 900 else { throw NativeSyncError.permission }
                    await withCheckedContinuation { continuation in
                        web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { continuation.resume() }
                    }
                } catch {
                    // Never print headers, response bodies, credentials or native account information.
                }
                web.load(URLRequest(url: origin))
            }
            return
        }
        #endif
        web.load(URLRequest(url: origin))
    }
    override var keyCommands: [UIKeyCommand]? {
        [UIKeyCommand(title: "Device Connection", action: #selector(showSettings), input: ",", modifierFlags: .command)]
    }
    @objc func showSettings() {
        guard presentedViewController == nil, !preparingAccountImport else { return }
        let settings = ConnectionController(origin: origin) { [weak self] next in
            guard let self else { return }
            origin = next; UserDefaults.standard.set(next.absoluteString, forKey: "companion.origin")
            web.load(URLRequest(url: next))
        }
        let navigation = UINavigationController(rootViewController: settings)
        navigation.modalPresentationStyle = .pageSheet
        navigation.sheetPresentationController?.detents = [.large()]
        present(navigation, animated: true)
    }
    private func showAccountImport() {
        guard presentedViewController == nil, !preparingAccountImport,
              CompanionOrigin.matches(web.url, origin) else { return }
        preparingAccountImport = true
        let generation = navigationGeneration, targetOrigin = origin
        Task { @MainActor in
            defer { preparingAccountImport = false }
            do {
                guard let documentToken = try await web.evaluateJavaScript("document.documentElement.getAttribute('data-native-document')") as? String,
                      documentToken.count == 36 else { throw NativeSyncError.browserChanged }
                try LocalImportPolicy.validateDestination(page: web.url, origin: targetOrigin,
                    requestedGeneration: generation, currentGeneration: navigationGeneration)
                guard presentedViewController == nil else { return }
                let settings = ConnectionController(origin: targetOrigin, importLocally: { [weak self] snapshot in
                    guard let self else { throw NativeSyncError.browserChanged }
                    try LocalImportPolicy.validateDestination(page: self.web.url, origin: targetOrigin,
                        requestedGeneration: generation, currentGeneration: self.navigationGeneration)
                    let bytes = try LocalImportPolicy.encoded(snapshot)
                    guard let json = String(data: bytes, encoding: .utf8) else { throw NativeSyncError.invalidSnapshot }
                    let delivered = try await self.web.callAsyncJavaScript("""
                    if (window.location.origin !== new URL(origin).origin ||
                        document.documentElement.getAttribute('data-native-document') !== documentToken) return false;
                    window.dispatchEvent(new CustomEvent('rea:apple-reminders-import', {detail: JSON.parse(snapshot)}));
                    return true;
                    """, arguments: ["origin": targetOrigin.absoluteString, "documentToken": documentToken, "snapshot": json],
                        in: nil, contentWorld: .page)
                    guard delivered as? Bool == true else { throw NativeSyncError.browserChanged }
                }, updateOrigin: { _ in })
                let navigation = UINavigationController(rootViewController: settings)
                navigation.modalPresentationStyle = .pageSheet
                navigation.sheetPresentationController?.detents = [.large()]
                present(navigation, animated: true)
            } catch {
                // A stale web document cannot open a native consent sheet or receive reminder data.
            }
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, CompanionOrigin.matches(message.frameInfo.request.url, origin),
              let body = message.body as? [String: String], body.count == 1 else { return }
        switch body["action"] {
        case "showSettings": showSettings()
        case "showAccountImport": showAccountImport()
        default: return
        }
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        navigationGeneration += 1
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = navigationAction.request.url else { decisionHandler(.cancel); return }
        if CompanionOrigin.matches(target, origin) { decisionHandler(.allow) }
        else {
            decisionHandler(.cancel)
            // External links require an actual user link action and never receive a device token.
            if navigationAction.navigationType == .linkActivated, target.scheme == "https" { UIApplication.shared.open(target) }
        }
    }
}

@MainActor
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private var controller: WebController?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let root = WebController(); controller = root
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = root; window.makeKeyAndVisible(); self.window = window
        return true
    }
    func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        guard shortcutItem.type == "local.rea.device-settings" else { completionHandler(false); return }
        controller?.showSettings(); completionHandler(true)
    }
}
UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
