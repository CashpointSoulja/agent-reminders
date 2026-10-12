# iCloud and Apple Reminders linking

The iPhone companion can read selected Apple Reminders lists and import a reviewed copy into this app. Lists already synced by iOS with iCloud are read through Apple's public EventKit API. The app never asks for an Apple ID or an app-specific password.

This is a manual import and refresh. Editing or completing an imported reminder in the password-free browser app does not change the original Apple reminder. Existing self-hosted device pairing and separately approved completion writeback remain separate features.

## Use the iPhone companion

1. Open [the native Xcode project](../native/ios/AgentReminders.xcodeproj). Choose your own signing team and install it on your own iPhone. The source requires iOS 17 or later. There is no published App Store or TestFlight build.
2. Enable iCloud Reminders yourself in Apple's settings if you want iCloud lists. The companion does not change account settings or enter credentials.
3. Open Reminders in the companion, then Accounts → iCloud. The companion starts at the public browser app; a previously configured personal origin is retained.
4. Choose **Connect Apple Reminders**. iOS asks for full Reminders permission. No list is selected automatically.
5. Select the lists you want, then **Preview Selected Reminders**. The preview is local and does not upload anything.
6. Choose **Use on This Device** and confirm the destination and selected reminder count. Only that selection is shared with the currently loaded web page. The password-free browser app saves imported copies in this device's web storage.

For a refresh, open the same flow, select your lists, inspect a fresh preview and import again. Changing the selection or changing Apple reminders invalidates the preview. Before import, the companion fetches the selection again and checks that its lists and reminder revisions match what you reviewed.

**Simulator builds always use fictional sample reminders**, even if the simulator is signed into iCloud. They never instantiate an Apple reminder store from the connection UI.

## Use iCloud copies alongside Google in Safari

Google authorization can reject embedded WKWebView browsers. Native Google authentication is not implemented in this companion; use the ordinary Safari/browser app for Google Calendar and Google Tasks. Google's [installed-app OAuth guidance](https://developers.google.com/identity/protocols/oauth2/native-app#disallowed_useragent) describes this restriction.

1. In the companion, connect, select and preview Apple lists as above.
2. Choose **Export for Browser** and confirm. In the system share sheet, save `reminders-import.json` to a private location you control.
3. In Safari, open the Reminders app, then Accounts → iCloud → **Import from iPhone**, and select that file. Review the selection before importing it into that browser.
4. Delete the exported file when you have finished. It contains the selected reminder text. The companion's protected temporary share file is removed after the share sheet completes or is cancelled; your saved copy remains under your control.

This is a file import, not a live iCloud session in Safari. Repeat the export and import when you want a refresh. No cloud workspace or Apple reminder is modified by this flow. Browser storage is separate between Safari and the companion's WKWebView.

## Supported information and gaps

Exported fields include selected-list identifiers and names, reminder identifiers, title, notes, URL, completion state and timestamp, date and time components, time zone, priority, modification timestamp and whether a reminder recurs. The web importer validates and maps these fields into its supported local model; it must reject unsupported or malformed dates rather than guess them.

Public EventKit does not provide this foundation with Apple's tags, subtask hierarchy, flags, photos, shopping categories, sections, assignments, smart-list definitions or complete recurrence/notification rules. Those features are listed as unsupported in every snapshot. Imported copies cannot claim full Apple data parity. The exported snapshot includes a recurring flag; browser copies are individual records without reconstructed recurrence rules.

The native bridge does not create, delete or complete Apple reminders. An agent crossing off a browser copy does not constitute verified execution or a native completion receipt.

## Bridge contract

The main-frame page requests a native consent sheet with:

```js
window.webkit.messageHandlers.reaDevice.postMessage({ action: "showAccountImport" });
```

After explicit native confirmation, the companion dispatches `rea:apple-reminders-import` on that same document. Its `event.detail` is the existing `NativeSnapshot` JSON structure:

```json
{
  "schemaVersion": 1,
  "generatedAt": 1791763200000,
  "sample": true,
  "selectedListIDs": ["sample-list"],
  "lists": [{ "id": "sample-list", "title": "Sample tasks", "writable": true }],
  "reminders": [],
  "revisions": {},
  "unsupportedFeatures": ["tags", "subtasks", "flags", "photos", "shoppingCategories", "sections", "assignment", "smartListDefinitions", "recurrenceRules", "alarms"]
}
```

Reminder records use `id`, optional `externalID`, `listID`, `title`, optional `notes` and `url`, `completed`, optional `completionDate`, optional `due` and `start`, `priority`, optional `modifiedAt` and `recurring`. Exported timestamps are milliseconds since the Unix epoch. `due` and `start` retain native date components, `timeZone`, `calendarID`, `era`, `isLeapMonth` and a `floating` flag. Optional values can be absent. The file export uses exactly the same structure.

The native side rejects foreign frames and origins. It captures the navigation generation and a per-document nonce when the sheet opens, then checks them before delivery and again inside the destination document. JSON is passed through WebKit arguments and parsed as data; reminder text is never inserted into JavaScript source. Tokens and Keychain contents are never passed to the page.

Every snapshot must have an exact selected-list set and unique records. Imports are bounded to 100 lists, 5,000 reminders and 2 MiB of JSON, with UTF-8 limits of 1,024 bytes for identifiers/reminder titles, 512 for list names, 16,384 for notes and 4,096 for URLs. Oversized selections are rejected rather than silently shortened. The browser/file importer must independently validate the payload: any web script can construct a DOM event, so the event is not an authentication mechanism.

## Hosting and verification

Cloudflare Pages and Workers can host the web app and its APIs. They cannot run iOS EventKit or obtain the device's Reminders permission. This link therefore requires the native companion on an Apple device; no alternate cloud provider or paid service is introduced. Apple's [EventKit access documentation](https://developer.apple.com/documentation/eventkit/accessing-the-event-store) describes the OS permission boundary.

The local bridge, snapshot bounds and export share code compile for iOS Simulator; 51 synthetic native core checks and 11 existing device-client checks pass. The simulator binary was built without installing or controlling any simulator. Physical-device compilation is checked separately. Actual device permission, a real iCloud selection, system file sharing and an end-to-end browser import remain unverified on signed hardware. No real account data is included in these tests or this repository.
