# Optional iOS companion

The Swift companion embeds the web app in WKWebView and supplies an opt-in bridge through public EventKit. It is independent software, not Apple's Reminders app. The Device Connection screen is a product extension and has no native Reminders counterpart.

**Current boundary:** implemented source with synthetic tests. Physical installation, OS permission, real EventKit/Keychain, import and completion writeback need further acceptance. The public web playground cannot access Apple reminders.

## Build and test

On macOS with Xcode:

```sh
native/ios/test.sh
native/ios/test-device.sh
native/ios/build.sh
```

These core/client checks use synthetic stores and protocol fixtures. The build script creates a Simulator app in ignored `work/`; it does not install or launch the app.

The Xcode project is `native/ios/AgentReminders.xcodeproj`, scheme `AgentReminders`. The signing team is intentionally blank. Physical-device installation requires your own signing configuration and acceptance work.

Simulator builds always use a synthetic reminder store, in-memory credentials and an in-memory journal, even if a simulator has an Apple account. Test with a disposable simulator. Do not use another person's signed-in account or commit screenshots/exports from one.

## Consent and workflow

1. Run a self-hosted web/API instance. Apply `backend/device-sync-schema.sql` and explicitly enable `DEVICE_SYNC=1`.
2. Set your server origin in Device Connection. Localhost is supported only for development; use HTTPS for a deployed server.
3. On your own physical device, request OS Reminders access, then select the lists you want to read. Nothing is selected by default.
4. Review the selected preview. Pairing sends the selected list manifest and a credential digest, not reminder contents.
5. In the signed-in web app, open `/settings/devices`, compare the matching code and approve that device's selected-list grant.
6. Check approval in the companion and explicitly choose Upload Preview. Import changes the web copy; it does not edit Apple reminders.
7. Completion writeback is a separate opt-in. After a successful delegated task, choose Sync Task Completions while the companion is open.

There is no Apple ID sign-in form, credential handling or direct private-database access. Apple requires full Reminders permission even for reading; the application then narrows its own reads to the selected lists. See [Apple's EventKit permission documentation](https://developer.apple.com/documentation/eventkit/accessing-the-event-store).

## Supported bridge

The bridge handles public list/item identity, title, notes, URL, due date/time, public priority and completion fields. Imports use canonical fingerprints and preserve web-only metadata where source changes do not conflict.

Two-sided changes reject the import with versioned conflicts. Keep Server/Use Apple choices resolve supported reminder fields in the web copy. Structural list/deleted-copy conflicts require manual review. Missing source items are marked missing; neither Apple nor web reminders are automatically deleted.

Public EventKit does not expose all private Reminders features. Tags, flags, private hierarchy, photo attachments, shopping categories, sections, assignment and smart-list definitions cannot be fully imported. Recurrence/alarms and cross-device identifier remapping are incomplete. This is not full-fidelity iCloud synchronization.

## Writeback and risks

Writeback is completion-only, scoped to selected writable lists and unchanged nonrecurring source items. It provides no native create, delete or full-record edit primitive. Successful cloud receipt and native command creation share a transaction; the phone checks the source fingerprint and journals a save before acknowledging.

Synchronization is manual while the companion is open. There is no background daemon. EventKit cannot atomically compare-and-swap with D1; a native edit between refresh and save and cross-system failures remain real risks. Journal reconciliation is not a global exactly-once guarantee.

Apple may apply private subtask completion effects that the public API cannot inspect. Reopening, source edits, missing items, expiry and revocation invalidate new task actions, but cannot undo an action already begun. Review uncertain outcomes before retrying.

Disconnect revokes device authority without deleting Apple reminders. Changing the server clears local credentials; previously granted remote authority may still require explicit revocation on that server.
