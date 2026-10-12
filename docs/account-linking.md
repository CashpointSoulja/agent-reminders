# Account linking

The interface keeps the Reminders name, list layout, system fonts and glass sheet controls. This is an independent open-source app; it is not an Apple or Google product.

Open **More → Accounts** on the Home screen or in the desktop sidebar. Account linking is available in the password-free, browser-local app. It is intentionally unavailable in the shared server workspace so imported personal reminders cannot be uploaded there by autosave.

Import alone stays local. If you later explicitly enable **More → Cloud Storage**, those local copies and safe import mappings are included in your private encrypted cloud document. This is a separate storage service; it neither enables the owner/agent API nor changes the account's original access permissions. See the [cloud user guide](cloud-storage-user-guide.md).

## Google Calendar and Google Tasks

1. Open **Accounts**, then choose **Google Calendar** or **Google Tasks**.
2. If this deployment has no Google OAuth configuration, enter your own **public Google Web Client ID**. Never enter a client secret. Create a web client in Google Cloud, enable the Calendar and Tasks APIs, and add this page's exact origin under authorized JavaScript origins.
3. Tap **Connect** to load Google's sign-in library, then **Continue with Google** to open Google's own sign-in and consent window.
4. Select calendars or task lists, tap **Preview**, review the selection and tap **Import on This Device**.
5. Use **Refresh Imported Lists** to fetch the same selected lists again. Reconnect after tokens expire or the page reloads.

The app requests Calendar read permission or Tasks read permission separately. Tokens remain in memory, are never displayed or persisted, and are discarded when the page closes. The public client ID and import mappings can be stored in this browser. The app does not collect Google passwords.

The product's Google OAuth client is still missing. In the latest setup attempts, Google's required CAPTCHA panel rendered blank in both the in-app browser and a dedicated Chrome session. This is an unresolved setup/rendering blocker, not a Google rejection. Real Google consent, API access and completion remain unverified until a client is created and configured.

Calendar imports cover the previous 30 days and next 365 days. Timed events retain their instant and display in the browser's time zone. All-day events use their start date; Google's end date is exclusive. Calendar access is read-only: completing, editing or deleting a local reminder does not alter the calendar event.

Google Tasks supplies date-only due dates, not due times. Imported tasks retain their parent relationships within each selected list. Refresh updates unchanged imported fields, preserves local tags and flags, reports conflicting edits, and retains missing source reminders rather than deleting personal data.

### Optional Google Tasks completion

In the Google Tasks account pane, check the explicit completion consent and tap **Enable Google Tasks Completion**. Google asks for its broader Tasks write permission; this app uses that permission only to complete selected, imported tasks.

After granting permission, review and import the refreshed preview before completion is enabled. If no previously imported lists are selected, choose lists and preview/import them first. A checkbox then updates Google Tasks and saves only confirmed completions locally. Version conflicts require a refresh. Completing a parent attempts each imported child; partial failures preserve only confirmed completions.

Refresh keeps that confirmation gate closed after a new grant, selection change or unconfirmed preview. It shows a fresh preview that you must explicitly import. A normal refresh of already approved, unchanged selected lists can update local copies directly.

Reopening, editing, creating, moving and deleting reminders still affect the local copy only. This is selected-list import with manual refresh and optional completion writeback, not continuous two-way synchronization.

If enabled completion access expires while this page is open, completion stops until you reconnect and review a fresh preview. Reloading closes the memory-only session; imported reminders then behave as local copies until you explicitly reconnect and enable completion again.

**Disconnect Google** clears both Google connections and keeps imported copies. **Remove Google Access** also requests revocation with Google. You can independently revoke access in your Google Account. Neither action deletes your provider data or local reminders.

## iCloud / Apple Reminders

A browser has no EventKit access. Apple ID login or Sign in with Apple does not give a web page Apple Reminders access. The [native iPhone companion](../native/ios/README.md) uses Apple's supported Reminders permission.

Inside the companion, **Accounts → iCloud → Choose Lists…** opens the native permission/list-selection flow. Review only the lists you selected and confirm **Use on This Device**. The app imports local copies into the companion's web view, without an upload. The simulator always uses sample reminders.

To use those copies alongside Google accounts in Safari or another browser:

1. In the companion, select lists and preview them.
2. Choose **Export for Browser** and save the selected JSON export yourself.
3. In the browser, open **Accounts → iCloud → Import from iPhone…**.
4. Select the export, review its preview and confirm **Import on This Device**.

The JSON import is bounded to 2 MB and validates the selected list IDs and reminder fields before making any changes. Re-export the same selected lists and import again to refresh. The export contains the selected personal reminders: keep it private, and never commit it to Git.

The native bridge checks the configured origin, main frame and navigation generation before returning data. The browser treats both native events and files as untrusted data and validates them with the same reducer. No Apple ID password is entered in this app. Account settings and credential entry remain with the owner.

### Preserve original sections

The importer now preserves supplied original section names, source order, empty sections and reminder membership. Omitted section fields mean unknown; an older EventKit-only refresh keeps an existing known section layout. A section-aware refresh can repair an earlier flat import using stable source identity without duplicating reminders, while retaining local edits and reporting conflicts.

Public iPhone EventKit does not provide original section metadata. A separately permissioned, read-only Mac helper can supply the shared snapshot format through an installed private interface, but real recovery still awaits the owner's Mac permission and interface acceptance. It does not infer sections from reminder text. See [original sections](native-sections.md) before attempting a recovery. The owner reports a working phone import; that is user-attested and does not prove original sections, full field fidelity or writeback.

Google sign-in is not supported in the companion's embedded browser. Use **Connect Google in Safari**; Safari has separate local storage. Use the selected-list export to import iCloud copies there.

## Configuration and implementation

For a configured build, provide `EXPO_PUBLIC_GOOGLE_CLIENT_ID` with a public OAuth web client ID before `npm run build:demo`. For a self-managed client, the sheet accepts the public ID as a browser-local setting. Typical authorized origins are `http://localhost:8081`, `https://reminders-web-rea.pages.dev` and `https://agent-reminders-demo.pages.dev`. Register only the origins that you actually use. Google's OAuth consent/testing or verification requirements still apply to that client.

`src/google-accounts.js` owns memory-only Google sessions and API requests. `src/account-import.js` validates provider snapshots and performs deterministic three-way merges. `src/useAccounts.js` coordinates consent, previews, local import mappings and confirmed completion. `src/AccountsSheet.jsx` renders the Accounts sheet; `App.jsx` enables it only when there is no server API or server autosave callback.

App data stays under `reminders-web-v1`; account provenance and source selections stay under `reminders-accounts-v1`. Neither stores OAuth tokens. Provider IDs distinguish imported rows across lists and providers, so refresh does not create duplicates. Exporting a browser backup is an explicit user action and includes personal reminder content.

Optional Cloud Storage encrypts that document and validated provenance before upload. OAuth tokens, Apple credentials and recovery codes are excluded from the backup. Another device must reconnect to Google before refreshing source lists or enabling Tasks completion. Cloud conflict choices operate on saved local copies; they do not edit Apple or Google records. A recovery code grants document access and must not be passed to an external agent as though it were a narrowly scoped task token.

## Current limits and verification

- A Google OAuth client must be configured for the deployed origin. Until then, the app shows setup rather than a false Connected state.
- An iPhone companion needs owner-controlled signing/installation and Reminders permission. Cloudflare cannot run EventKit; the companion performs that native operation locally.
- Standard iPhone imports expose the fields supported by public EventKit: title, notes, URL, dates, times, completion and priority. Tags, flags, private hierarchy, attachments, smart-list definitions and recurrence rules are not imported. Recurring reminders are copied as reminders without claiming to reproduce their recurrence. Section-aware snapshot preservation is tested, while genuine private-interface section recovery remains pending.
- Browser storage is per browser/profile. Optional cloud storage is separately enabled and encrypted; clearing browser storage removes local copies and any recovery code you chose to remember. Keep that code privately before clearing storage.
- The cloud feature is implemented and has synthetic coverage; current release/live proof is pending. Its routes store encrypted documents and provide no externally scoped agent execution.
- Synthetic adapter/import tests cover validation, isolation, stable IDs, conflict preservation and completion scope. Real account consent and physical-device behavior require the owner's account/permission and are separate acceptance checks. No real account mutation or exact native pixel parity is claimed by those tests.

The focused browser regression is `node tests/browser/accounts-completion.cjs` against a static browser-local app at `http://127.0.0.1:8083`, or set `ACCOUNTS_TEST_URL` to another local test origin. It uses synthetic OAuth/provider fixtures and blocks private API and real external requests. It verifies that Refresh cannot bypass fresh Import consent, while an explicit Import permits a confirmed completion.
