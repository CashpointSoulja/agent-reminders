# Connected accounts

The public app keeps reminders in the current browser. Google Calendar and Google Tasks use Google's own account chooser and consent popup. An iPhone companion can import selected Apple Reminders through Apple's system permission prompt. The app does not ask for an Apple ID password or Google password.

Google access tokens remain in memory. Reloading, expiration or disconnecting requires another user initiated connection. Imported reminders and source identifiers persist locally; disconnecting does not delete those copies or change the source account. Nothing in these account flows is sent to the shared demonstration backend.

## Google deployment setup

The deployment operator must create a **Web application** OAuth client in Google Cloud, enable the Calendar API and Tasks API, and configure the consent screen. The web client ID is public configuration, not a secret. Do not put a client secret in browser code.

Configure these exact JavaScript origins for the current deployments:

- `https://reminders-web-rea.pages.dev`
- `https://agent-reminders-demo.pages.dev`
- `http://localhost:8081` for local development

Google's token model uses a popup; it does not require a backend callback or refresh token. A testing consent screen only accepts configured test users. Making the consent screen public may require Google's verification for these account scopes. Until a real client is configured, the app must show the configuration requirement rather than claim an account is connected.

The first connection action prepares Google's JavaScript library. A separate **Continue with Google** click launches the popup synchronously, preserving Safari's user gesture requirement. Select a source calendar or task list, preview it, then explicitly import or refresh it.

## Permissions and behavior

| Source | Initial permission | What the app does |
| --- | --- | --- |
| Google Calendar | `https://www.googleapis.com/auth/calendar.readonly` | Read selected calendars; import event copies; never create, update or delete calendar events. |
| Google Tasks | `https://www.googleapis.com/auth/tasks.readonly` | Read selected task lists, including hidden completed tasks. |
| Google Tasks completion, explicitly enabled | `https://www.googleapis.com/auth/tasks` | Complete a selected imported task after checking its current revision. No creation, deletion, reordering or reopening API is exposed. |
| iCloud Reminders | Apple's Reminders system permission in the companion | Preview and import selected lists on the device. This local import flow does not write to Apple Reminders. |

Google does not provide a narrower completion-only OAuth scope. The optional Tasks permission grants wider access at the provider, while this app exposes only completion. Request it only after the user enables completion permission. After reconnecting or enabling completion, refresh the selected task lists before writing. Changes to a Google Calendar copy and reopening a Google task affect the local copy only.

Google Tasks exposes due **dates**, not scheduled times. A Calendar all-day event is placed on its start date; its end date is exclusive. Calendar recurrences are expanded into occurrences within a finite window, defaulting to 30 days before today through 365 days after today. Events outside that window are not imported. Timed events preserve their absolute instant and display the corresponding browser-local time. Imported calendar events are reminder copies, not a complete calendar view.

Refresh merges fields using the last imported source values. Source changes update unedited fields; local tags, flags and other local-only fields remain. If both the source and local copy change the same field, the local value stays and a conflict is reported. Source deletions or events disappearing from the date window mark copies as missing; they never automatically delete local rows. Local deletions are not resurrected. An older preview cannot replace a newer import. Failed or incomplete pages produce no import.

The companion's public EventKit snapshot cannot expose all native Apple Reminders features. Tags, subtasks, flags, attachments, shopping categories, sections, assignment, smart-list definitions, recurrence rules and alarms are not reconstructed by the local account import. The original Apple reminders are unchanged. Non-Gregorian or otherwise unrepresentable dates reject the preview rather than silently approximating it.

## Adapter contract

`src/google-accounts.js` exports `GOOGLE_SCOPES`, `loadGoogleIdentity()` and `createGoogleAccounts({ clientId, fetch?, loadIdentity?, now? })`. `now` returns milliseconds; injected fetch/identity functions are for synthetic tests.

```js
const google = createGoogleAccounts({ clientId });
await google.prepare(); // Load the official library after a user action.
// A separate button click calls connect directly, without waiting on network work first.
await google.connect("google-tasks", { writeback: false });
const sources = await google.listSources("google-tasks");
const preview = await google.snapshot("google-tasks", selectedSources);
```

Methods:

- `state(provider)` returns `{ configured, connected, writeback, expiresAt }`. It never returns a token.
- `prepare()` loads the official library and returns `{ ready: true }`. It does not prompt for consent or read an account.
- `connect(provider, { writeback = false })` opens Google's account chooser and resolves connection status. Only the two providers `google-calendar` and `google-tasks` are accepted. Calls can throw immediately for missing configuration or preparation; handle both synchronous errors and rejected promises.
- `listSources(provider)` returns `{ id, name, color? }[]` from complete bounded pagination. Calendar IDs are actual source IDs; the alias `primary` is rejected to avoid account-switch collisions.
- `snapshot(provider, selectedSources, { timeMin?, timeMax? })` reads only the selected sources. It accepts up to 50 sources, 100 pages per source and 10,000 total records. A successful Tasks preview replaces the previous completion selection; a selection change cancels a pending completion before its write. The caller must import only after explicit user confirmation.
- `completeTask(sourceListId, taskId, { etag? })` requires Tasks completion permission and a previously selected snapshot record. It reads the current task and compares its etag before a status-only conditional PATCH. It returns confirmation only when the response names the requested task and reports it completed. An ambiguous successful HTTP response rejects with `verification_failed`; refresh to check the source before marking the local copy complete. The UI must also require an imported provenance mapping. Already completed tasks are returned without a second write.
- `disconnect({ revoke = false })` clears all local Google sessions and cancels pending connections. With explicit revocation it asks Google to revoke the app's granted permissions. Local copies remain.

Connection errors include `not_configured`, `identity_not_ready`, `popup_closed`, `permission_denied`, `auth_expired`, `network_error`, `conflict`, `verification_failed` and `too_many_records`. Provider response bodies and OAuth error descriptions are not displayed or logged. A connection change cancels in-flight snapshots and completion confirmations, including responses still being parsed, rather than mixing account data. Reconnecting Tasks clears its completion selection; connecting Calendar preserves it. Tokens are never included in a URL, local storage, provenance, app state, error message or exported snapshot.

The normalized snapshot shape is:

```js
{
  provider: "google-tasks", // or google-calendar / icloud
  generatedAt: "2026-10-12T10:00:00.000Z",
  lists: [{
    id: "synthetic-source-list", name: "Sample Tasks", color: "#007AFF",
    reminders: [{
      id: "synthetic-source-task", title: "Sample task", notes: "", url: "",
      dueDate: null, dueTime: null, dueInstant: null,
      completed: false, completedAt: null, parentId: null, etag: "synthetic-etag"
    }]
  }]
}
```

`src/account-import.js` exports:

- `emptyAccountProvenance()` returns `{ version: 1, lists: [], reminders: [] }`.
- `validateAccountProvenance(value)` rejects malformed metadata and unexpected fields, including credential fields.
- `mergeAccountSnapshot(data, provenance, snapshot, { now = new Date() })` returns `{ data, provenance, conflicts, imported, updated, missing }`. It validates the complete snapshot and resulting reminder structure before returning. Inputs are not mutated.
- `accountSourceForReminder(provenance, localReminderId)` returns the source mapping or `null`.
- `normalizeICloudSnapshot(rawNativeSnapshot)` converts schema version 1 selected-list EventKit snapshots into the same reducer input. Native timestamps are milliseconds; normalized timestamps are ISO strings. Sample mode remains identifiable.

Provenance is kept separately from normal reminder data. Each mapping contains its provider, source identifier, local identifier, imported field baseline, last snapshot time, optional etag and missing status. Reminder mappings also contain the source list ID. It contains imported personal data, so treat it with the same privacy as reminders. Treat returned provenance as immutable; each refresh returns a new object, and reminder lookup indexes are cached per object. Local IDs are deterministic exact encoded source identifiers, preventing duplicates when reducers run again. They are private local bookkeeping, not an authorization boundary.

## Verification

Run `node --test tests/google-accounts.test.js tests/account-import.test.js`. Tests use synthetic records and injected identity/network functions. They cover explicit preparation/consent, token privacy and expiration, popup cancellation, source paging, all-day and task-date semantics, conditional completion, unconfirmed completion responses, disconnect/reconnect and selection changes during response parsing, repeated imports, conflict preservation, missing records, hierarchy, and invalid native/provider data. These tests do not prove a real Google consent screen, account login or physical iPhone permission flow.

References: [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [Google authorization JavaScript API](https://developers.google.com/identity/oauth2/web/reference/js-reference), [Calendar events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Google Tasks resource](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks), [Google Tasks list](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list), [Google Tasks patch](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/patch), and [Apple event-store permission](https://developer.apple.com/documentation/eventkit/accessing-the-event-store).
