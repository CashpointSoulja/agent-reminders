# Requirements tracker

Current owner scope, 12 October 2026. This tracker describes source and named evidence separately from live availability. It contains no real reminder contents, account identifiers, credentials, device IDs or private screenshots.

**Current release boundary:** browser-local account import is released. The new isolated encrypted Worker is deployed as a service-only storage backend; Pages binding, browser UI and full live storage proof are still pending. Owner/agent/device API routes remain disabled on the public playground. Exact native parity is incomplete. Phone import is user-attested; genuine Mac section recovery remains unaccepted.

Status meanings:

- **PARTIAL** — useful source exists, but an owner requirement or acceptance gate remains open.
- **TESTED · synthetic** — the named contract passes fictional fixtures; real-account or native equality is not implied.
- **IMPLEMENTED** — source exists; release/live proof remains separate.
- **USER-ATTESTED** — the owner reported the result; it was not independently verified by the automated checks.
- **PENDING / BLOCKED** — required work or an external setup/permission gate is outstanding.
- **DEFERRED** — explicitly later work; no current implementation/deployment claim.

## Native fidelity and reminder features

| ID | Requirement | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| UI-01 | One-to-one iCloud-enabled native parity on iPhone | PARTIAL | Apple-inspired screens and selected simulator/browser flows exist; complete pixel, copy, touch and motion acceptance remains open. |
| UI-02 | One-to-one native parity on iPad | PENDING | Responsive layouts exist; whole-screen native tablet comparison is incomplete. |
| UI-03 | One-to-one native parity on Mac | PENDING | Desktop UI exists; whole-screen native Mac comparison is incomplete. |
| UI-04 | Exact labels, copy, layout, spacing and screen transitions | PARTIAL | Existing screens implement the flows; every visible/behavioural difference remains an open parity defect until measured and fixed. |
| UI-05 | iOS Liquid Glass on buttons, sheets and floating surfaces | PARTIAL | Blur, translucent fills, highlights, shadows and accessibility fallbacks are implemented; native optical rendering and dynamic motion are not exact. |
| UI-06 | Lifted row, accurate reorder, target highlight, drag nesting and outdent | PARTIAL | Motion/domain logic has synthetic and selected browser coverage; exact native drag timing, placement and material acceptance remains open. |
| UI-07 | Parent chevrons, collapsed count and animated expand/collapse | PARTIAL | Implemented with subtasks; complete native layout/motion comparison remains open. |
| UI-08 | Native context menu, including indent, tags, assign, priority and cut | PARTIAL | Menu/organisation controls exist; shared-account assignment and exact native menu behaviour are incomplete. |
| UI-09 | New List sheet chrome, segments, icon, name, type and grids | PARTIAL | Native-style controls and licensed icons exist; pixel equality with native sheet/pickers is incomplete. |
| UI-10 | Native emoji picker and templates flows | PARTIAL | Local emoji/template behaviour has tests; complete native picker/template equality remains open. Server template photos require the separate R2 backend. |
| UI-11 | Details sheet, dates, times, repeats, notes and URL | PARTIAL | Domain/API and selected sheet flows have coverage; exact native pickers, timezone/recurrence semantics and hardware interactions remain open. |
| UI-12 | Tags, flags, priority and saved subtitles | PARTIAL | Web fields and persistence are implemented/tested; complete native parity and importing private Apple fields remain incomplete. |
| UI-13 | Photo attachments and Apple-style photo flows | PARTIAL | Protected R2 lifecycle exists in server source; public cloud vaults do not back up binaries. Native camera/scan/full photo parity remains open. |
| UI-14 | All lists, smart views, sections, sorting and shopping categorisation | PARTIAL | Web lists/views and local English shopping vocabulary exist; Apple's classifier, full smart-list definitions and native parity are incomplete. |
| UI-15 | Home/list scrolling and Safari-safe sheet bounds | PARTIAL | Selected phone-width browser/simulator checks exist; every screen and keyboard/browser-bar state still needs native acceptance. |
| UI-16 | Side-by-side per-feature/native testing logs | PARTIAL | Public synthetic test scope is documented in [account verification](account-verification.md); current release does not claim a completed native pixel audit. Private recordings/data are excluded from this repository. |

## Accounts, imports and original sections

| ID | Requirement | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| AC-01 | Reviewed selected iCloud import on the phone | USER-ATTESTED | Owner reports the phone import worked. Synthetic bridge/import checks exist; this is not automated complete field, Keychain or writeback acceptance. |
| AC-02 | Manual account refresh preserves edits, identity and missing records | TESTED · synthetic | Import reducer and fictional provider/browser checks cover three-way conflict handling, stable identity and consent. Real-account refresh acceptance remains separate. |
| AC-03 | Original section names, order, empty sections and memberships survive import/reload | TESTED · synthetic | Section-aware snapshot/reducer checks exist; original real sections still need a genuine section-aware source. See [native sections](native-sections.md). |
| AC-04 | Repair old flat imports without duplicates; preserve local section edits | TESTED · synthetic | Stable source mapping and section-aware refresh are checked. An EventKit-only snapshot marks sections unknown and cannot erase known sections. |
| AC-05 | Recover actual original sections from the synced Mac | BLOCKED | Read-only helper compiles and its 15 synthetic checks pass. Owner macOS permission and installed private-interface/identity/order acceptance remain outstanding; no real section export is claimed. |
| AC-06 | No invented or inferred original Apple sections | IMPLEMENTED | Unknown source fields remain unknown; section membership is never guessed from titles, tags or notes. Private-interface failures reject export. |
| AC-07 | Google Calendar and Tasks OAuth connection | BLOCKED | APIs are enabled, but no product OAuth support group/client was created. The required CAPTCHA panel was blank in both the in-app browser and dedicated Chrome; Create remained disabled. This was not a rejection. Exact rendering cause is unverified. |
| AC-08 | Google Calendar read-only import and optional selected Tasks completion | TESTED · synthetic | Permission, preview/import, paging/version and completion-consent tests exist. Real Google consent, API access and completion await the client and provider acceptance. |
| AC-09 | Safe disconnect, token handling and reconnect on another device | TESTED · synthetic | Google tokens stay in memory and are excluded from stored reminder/provenance documents. Real provider/hardware acceptance remains open. |
| AC-10 | Full native field/continuous two-way sync | PENDING | Public EventKit omits private tags/flags/hierarchy/photos/sections and other metadata. Refresh is manual; native full-record editing, background sync and complete source writeback are absent. |

## Private Cloudflare storage and release

| ID | Requirement | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| CF-01 | Cloudflare-hosted app with a private per-user storage path | PARTIAL | Browser app is released; isolated encrypted Worker is deployed service-only. Pages cloud binding and current live UI/storage proof are pending. |
| CF-02 | Explicit enablement; no upload just from opening the app or Accounts | IMPLEMENTED | Cloud controls require an explicit action and preview/restore choices. Synthetic contracts exist; fresh live browser proof is pending. |
| CF-03 | Encryption, private recovery and isolated documents | TESTED · synthetic | Device-side HKDF/AES-GCM, scoped capability verifier, tamper/wrong-key/tenant tests and strict transport are implemented. Recovery codes remain private; live isolation proof is pending. |
| CF-04 | Preserve sections, subtasks, fields, templates and safe import provenance | TESTED · synthetic | Validated encrypted snapshots retain metadata already present. They exclude OAuth credentials/recovery codes and cannot recover missing native metadata or photo binaries. |
| CF-05 | Cross-device preview, deliberate version choice and revision conflicts | IMPLEMENTED | Reconnect preview, use-cloud/keep-local choices and CAS are implemented/tested with fictional documents. Full live two-device UI proof remains pending. |
| CF-06 | Save/reload, retry, bounded history and explicit restoration | TESTED · synthetic | Storage/client checks cover guarded writes, lost setup response, retained revisions and rollback. Current live acceptance remains pending. |
| CF-07 | Durable Objects, D1 and R2 boundaries | IMPLEMENTED | New browser-cloud storage uses a separate SQLite-backed Durable Object. D1/R2 belong to the independently self-hosted owner/agent API; no unrelated database reuse/deletion is required. |
| CF-08 | Free-tier-only operation and resource limits | PARTIAL | Explicit document/workspace/rate ceilings and Free-compatible architecture exist. No paid enrollment is requested; actual request/query/CPU usage and account quota availability still need ongoing verification. |
| CF-09 | Private data auth gate | PARTIAL | Cloud documents require their derived capability and allowed Origin; server workspace uses owner sessions. Public UI is open with no shared data. Live unauthorized denial remains a release gate. |
| CF-10 | Cloudflare Access if appropriate | PENDING | Access is not provisioned. Current storage capability/owner-session gates are separate and must not be described as Access. |
| CF-11 | Public release keeps owner/agent/device APIs disabled | PARTIAL | Selective `/cloud/*` proxy and disabled metadata are implemented/tested. Verify current production/preview bindings and endpoints after publishing. |
| CF-12 | No secrets, real reminders or private captures in Git | IMPLEMENTED | Source uses placeholders and synthetic fixtures. Real exports/recovery codes stay private; root must repeat the source/artifact privacy gate before pushing the release. |
| CF-13 | Production readiness and complete live acceptance | PENDING | Fresh deployment/UI/storage, maximum-size behaviour, recoverability and remaining native/provider gates prevent a complete production-ready claim. |

## APIs, agents, BYOK and documentation

| ID | Requirement | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| AG-01 | Crawlable product and machine-readable API discovery | PARTIAL | `llms.txt`, well-known discovery and OpenAPI exist. Public playground definitions explicitly report disabled execution; no private data is crawled. |
| AG-02 | Independent REST API for lists, reminders, files and changes | TESTED · synthetic | Self-hosted Worker/D1/R2 source and transaction tests exist. Those endpoints are not enabled by the public cloud storage release. |
| AG-03 | Bring any external agent with its own model keys/tools | PARTIAL | Generic authenticated HTTP contract and Node reference client exist. Named Instinct/Hermes/OpenClaw/Grok installations/adapters remain unverified; model keys stay external. |
| AG-04 | Explicit assignments may execute without another product approval | TESTED · synthetic | Owner assignment, criteria, subtree opt-in, scoped leases/heartbeat and replay-safe reports are implemented in the separate backend. Public encrypted vaults provide no such authority. |
| AG-05 | Agent success crosses off only its authorised task with evidence | TESTED · synthetic | Guards check task version, credential, lease and evidence attestation. Receipt basis is agent attestation, not independent verification of remote-world actions. Live external executor acceptance remains open. |
| AG-06 | Device-selected import and optional completion-only native writeback | PARTIAL | Synthetic native transport/journal source exists. Real hardware/Keychain/completion effects are unaccepted; browser cloud saving itself never writes to iCloud. |
| AG-07 | Native-only capability boundaries | IMPLEMENTED | EventKit and the optional private Mac interface run locally after permission; Cloudflare/browser code cannot run them. Neither accepts Apple ID credentials or bypasses OS permission. |
| AG-08 | Architecture, features, improvements, API, user guide, PRD and agent design docs | IMPLEMENTED | Sanitized public [PRD](prd.md), [features](FEATURES.md), [improvements](IMPROVEMENTS.md), architecture/API/guides and roadmap exist. They omit private operational history and distinguish source/evidence/gaps. |
| AG-09 | Design the product-hosted LLM layer now, deploy it later | DEFERRED · hosting | [Agent/LLM design](LLM-LAYER-DESIGN.md) documents current external authority and later hosted state/tools/verification/budget boundaries. Hosted implementation, provider choice and runtime acceptance remain later; no inference service is deployed. |
| AG-10 | Open-source GitHub, branch-only changes and no merge | IMPLEMENTED | Clean public source, MIT/third-party notices and contribution/security docs exist. Release commit/push remains root-owned; this tracker does not authorize a merge or expose private history. |

## Next gates

Root will append the final frozen source, local/browser checks and live release results when available. The immediate open gates are cloud Pages/UI acceptance, real Mac section permission/private-interface recovery and Google OAuth client creation. Exact native parity, real provider consent, full native fields, external vendor execution and comprehensive production readiness remain open after those scoped gates pass.
