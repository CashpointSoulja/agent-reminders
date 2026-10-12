# Architecture

Agent Reminders has separate browser-local, optional encrypted-cloud and server-workspace paths. The public playground keeps local reminder copies and optional account imports in the browser. Its new cloud path explicitly saves encrypted documents to an isolated Cloudflare Worker/SQLite-backed Durable Object. The separately self-hosted owner/agent/device API uses D1 and private R2; that API is disabled on the public playground deployment.

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
| Encrypted cloud client | `src/cloud-vault.js`, `src/useCloudStorage.js` | Device-side encryption, recovery, preview, revision saves and conflicts |
| Private cloud storage | `backend/cloud-vault-worker.js` | Capability-authorised ciphertext storage in a separate SQLite-backed Durable Object |
| Selective Pages proxy | `backend/pages-cloud-proxy.js` | Forward only `/cloud/*`; keep owner/agent/device APIs unbound |

The public playground is a separate browser-local experience with fictional seed data. Its optional Accounts sheet connects directly to Google, or imports a selected Apple Reminders snapshot from the companion. Import alone stays local. Explicitly enabling Cloud Storage includes those local copies and safe import mappings in an encrypted document; it does not send them to the owner/agent API.

## Browser-local accounts

Google Identity Services supplies short-lived access tokens through explicit provider consent. Tokens live only in a service closure in memory. Calendar is read-only; Tasks completion writeback needs a separate permission and is limited to selected previewed tasks, guarded by the current provider version. Reloading requires reconnection.

Provider snapshots pass through a bounded shared import reducer. Stable source identifiers prevent duplicate imports; separate local provenance enables a three-way refresh that preserves local edits and missing source records. No provider credentials are saved with reminders or provenance. Browser storage is local to the profile, not encrypted against another person using that profile.

Section-aware snapshots preserve names, source order, empty sections and reminder membership. Omitted section fields mean unknown, so an older EventKit snapshot cannot erase an existing section layout. Public EventKit does not supply the missing original section metadata. The separate local Mac helper needs owner-granted permission and private-interface acceptance before a genuine section-aware snapshot can be claimed. See [original sections](native-sections.md).

The companion's main-frame, same-origin bridge offers reviewed EventKit snapshots to the local app. Navigation generation and document checks prevent delivery into another destination. A separately confirmed JSON export lets the user import selected iCloud lists into Safari, where Google sign-in is available. EventKit, Google and local storage do not share a transaction, and these are manual foreground refreshes rather than background synchronization.

## Data and writes

The reminder document contains lists and reminders. Subtasks are reminders with `parentId`; sections belong to lists. The following revision/CAS and R2 behaviour applies to the server-workspace API, which is distinct from the encrypted document vault. Server attachment metadata cannot be manufactured through a workspace save.

Owner changes carry the current `If-Match` revision. Validation, compare-and-swap and durable change events share a D1 transaction. A stale save returns a conflict; the frontend preserves its unsaved draft instead of silently replacing another writer's changes.

The design is intentionally sized for a personal workspace: 100 lists and 1,000 reminders. It is not a high-volume or multi-tenant database design. Agent and device tables are additive; device transport has a separate schema file.

File upload stores a private R2 object, then commits metadata. Download requires authentication. Durable cleanup jobs handle orphan deletion after partial failures. The server-workspace API does not provide a full backup/restore system.

## Optional encrypted document storage

Cloud Storage starts only after explicit enablement. The browser derives separate authentication and AES-GCM encryption keys from a random recovery code and encrypts the reminder document plus safe account provenance before upload. The isolated Durable Object stores the encrypted envelope, verifier, revision and bounded history; it does not receive the decryption key or OAuth tokens.

The vault preserves sections and memberships already present in the imported document. It cannot reconstruct absent EventKit metadata or restore R2/photo bytes from unavailable URLs. A recovery code grants document access, so it must not be shared as an external agent token.

Connecting another device presents a preview and requires a deliberate choice before replacing local data or uploading a local version. Revision conflicts stop automatic saves. Current plus two previous encrypted revisions support bounded restoration, not a comprehensive backup system. This is manual-review cross-device storage, not continuous provider synchronization or externally scoped agent execution.

The optional cloud Pages configuration binds only the storage service under `/cloud/*` and keeps owner/agent/device endpoints disabled. Its separate deployment and free-tier limits are described in [private cloud storage](private-cloud-storage.md). The isolated Worker is deployed service-only; Pages binding, current browser UI and full live-release proof remain pending.

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

Hosted model inference and a durable external-action executor are not implemented. The reference client requires an explicit driver and does not invent a successful result. [LLM-LAYER-DESIGN.md](LLM-LAYER-DESIGN.md) documents the current external contract and later hosted layer without claiming a runtime deployment.

## Native boundary

Browsers and Cloudflare cannot run EventKit. The optional iOS companion runs on the user's device and requests the OS's Reminders permission. It previews selected data before upload and enables completion-only writeback separately.

Synchronization is manual while the companion is open. EventKit and D1 cannot share an atomic transaction; the native journal and server receipts support reconciliation, not a global exactly-once guarantee. See [native sync](NATIVE-SYNC.md).

## Acceptance limits

Tests exercise domain behaviour, actual SQLite rollback/CAS, transport isolation and selected browser/simulator flows with synthetic data. Exact Apple screen pixels, dynamic glass, physical-device sync, vendor runtimes and maximum-workspace free-tier CPU remain unverified.

Phone import has been reported working by the owner; it is user-attested rather than automated real-account acceptance. Section-contract/import tests do not establish permissioned Mac recovery, private-interface compatibility or complete native layout fidelity. The product Google OAuth client remains unconfigured because its required setup CAPTCHA panel rendered blank in both browser attempts, rather than rejecting the application. See the [requirements tracker](requirements.md).
