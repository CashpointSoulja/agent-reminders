# iOS companion

A small Swift/WKWebView companion for a self-hosted Agent Reminders instance. It uses public EventKit for explicitly selected-list imports and optional completion-only writeback.

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

Web login is separate from Apple permissions. No Apple ID credentials are entered or read by this application. Provider keys remain with your external agent.
