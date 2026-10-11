# Architecture

Agent Reminders is a small single-owner application. The browser renders the familiar capture and organisation UI. A same-origin Cloudflare Worker authenticates access and persists the workspace in D1; private files are held in R2.

## Components

| Component | Source | Responsibility |
| --- | --- | --- |
| Web application | `App.jsx`, `src/` | Lists, reminder editing, templates, gestures, owner settings |
| Server entry | `src/ServerApp.jsx`, `src/api.js` | Login, authoritative state, queued saves and conflict preservation |
| Worker API | `backend/worker.js` | Owner sessions, revision-guarded writes, validation, files and events |
| Agent protocol | `backend/agent-api.js`, `backend/agent-openapi.js` | Registration, scopes, explicit delegation, claims and receipts |
| Device protocol | `backend/device-api.js` | Pairing, selected-list grants, versioned imports and completion commands |
| Shared domain | `src/model.js` and related modules | Reminder graph, dates, recurrence, templates and shopping vocabulary |
| Native companion | `native/ios/Sources/` | WKWebView, public EventKit, consent, credentials and command journal |
| Reference runtime client | `scripts/agent-client.mjs` | Discovery, assigned-task reads, claim/heartbeat/report helper |

The public playground is a separate browser-local experience with fictional seed data. It has no connection to a deployed private API or Apple account.

## Data and writes

The main workspace is a bounded snapshot containing lists and reminders. Subtasks are reminders with `parentId`; sections belong to lists. Attachment metadata is server-owned and cannot be manufactured through a workspace save.

Owner changes carry the current `If-Match` revision. Validation, compare-and-swap and durable change events share a D1 transaction. A stale save returns a conflict; the frontend preserves its unsaved draft instead of silently replacing another writer's changes.

The design is intentionally sized for a personal workspace: 100 lists and 1,000 reminders. It is not a high-volume or multi-tenant database design. Agent and device tables are additive; device transport has a separate schema file.

File upload stores a private R2 object, then commits metadata. Download requires authentication. Durable cleanup jobs handle orphan deletion after partial failures. The application does not provide a full backup/restore system.

## Authentication and authority

- Owner password login issues an HttpOnly, SameSite=Strict session cookie. HTTPS is required outside explicit localhost development.
- Owner mutations require a matching browser origin and workspace revision.
- Agent bearer tokens grant only named scopes for that agent's explicitly delegated tasks. Only the token digest is stored.
- Device credentials are separate from owner and agent credentials. Selected-list upload and completion writeback are distinct grants.
- Model-provider keys and external tool credentials remain in the runtime, never in this application.

Reminder text, URLs and attachments are untrusted content. They cannot grant authority or enlarge an agent's scope.

## Execution model

An owner assigns one active reminder occurrence with completion criteria. The runtime claims a leased task, pins its fingerprint and performs the work with its own tools. A report is accepted only while credential, lease, task version and replay guards remain valid.

Success records `completionBasis: agent_attestation`. The server verifies protocol consistency and commits completion/receipt/events atomically; it cannot independently verify a remote-world action. Cancellation prevents new work but cannot undo a remote action already underway.

Hosted model inference and a durable external-action executor are not implemented. The reference client requires an explicit driver and does not invent a successful result.

## Native boundary

Browsers and Cloudflare cannot run EventKit. The optional iOS companion runs on the user's device and requests the OS's Reminders permission. It previews selected data before upload and enables completion-only writeback separately.

Synchronization is manual while the companion is open. EventKit and D1 cannot share an atomic transaction; the native journal and server receipts support reconciliation, not a global exactly-once guarantee. See [native sync](NATIVE-SYNC.md).

## Acceptance limits

Tests exercise domain behaviour, actual SQLite rollback/CAS, transport isolation and selected browser/simulator flows with synthetic data. Exact Apple screen pixels, dynamic glass, physical-device sync, vendor runtimes and maximum-workspace free-tier CPU remain unverified.
