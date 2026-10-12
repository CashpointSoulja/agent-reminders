# iOS companion

A small Swift/WKWebView companion for Agent Reminders. It uses public EventKit for explicitly selected-list imports into the password-free browser app, or separately approved self-hosted sync and completion-only writeback.

The implementation is a preview. Physical-device permission, Keychain, import and writeback remain unverified. Simulator builds always use fictional reminders and in-memory secrets, even if an Apple account is signed in.

## Build and test

Requires macOS and Xcode:

```sh
native/ios/test.sh
native/ios/test-device.sh
native/ios/build.sh
```

The build output is ignored under `work/`. No simulator is installed or launched by these commands. Open `AgentReminders.xcodeproj`, scheme `AgentReminders`, for an independently configured simulator or physical device. Signing team and real-account consent are deliberately not supplied.

See [native sync](../../docs/NATIVE-SYNC.md) for setup, pairing, supported fields, private-API gaps and cross-system risks. Use only your own test device/account and synthetic fixtures while evaluating the bridge.

For the browser-local app, see [iCloud linking](../../docs/icloud-link.md): Accounts → iCloud opens native permission, list selection and preview. **Use on This Device** imports the reviewed copy locally. **Export for Browser** saves the same selected snapshot for import in Safari, where Google authorization is supported. These flows do not write to Apple Reminders or upload to the self-hosted API. The companion defaults to the public Reminders site; a previously configured origin is retained. Device Connection remains available through Command-comma, the home-screen shortcut or a self-hosted page's device settings.

Web login is separate from Apple permissions. No Apple ID credentials are entered or read by this application. Provider keys remain with your external agent.

Original list sections are not available through public EventKit. Section-aware snapshot/import support and a consented, read-only **Mac** export helper are documented in [native sections](../../docs/native-sections.md). The Mac helper uses a private framework, stays local, and fails closed when access or a complete source mapping is unavailable. Its live account behavior remains unverified.
