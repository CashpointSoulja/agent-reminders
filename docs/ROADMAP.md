# Roadmap

This roadmap distinguishes implemented source from acceptance work. It is not a promise of production readiness or exact Apple parity.

## Implemented preview

- Lists, smart views, reminder fields, recurrence, subtasks, templates and local shopping vocabulary.
- Light/dark responsive UI and translucent material techniques with accessibility fallbacks.
- Password/session gate, revision-aware Worker API, D1 persistence and private R2 attachment lifecycle.
- Agent discovery/OpenAPI, owner-issued scopes, explicit delegation, leases, heartbeat and replay-safe evidence reports.
- A plain Node reference client for a runtime you configure.
- An opt-in iOS companion and selected-list transport, with synthetic core/client tests.
- A browser-local fictional playground that does not share a private workspace.
- Selected Google Calendar/Tasks imports, conflict-preserving refreshes, opt-in Tasks completion and reviewed iCloud local/file imports. Deployment still needs its own Google OAuth web client; signed-device and real-account acceptance are separate checks.
- Section-aware import contracts preserve original metadata. The actual approved native preview validates definitions, membership, native/public UUID mapping, order and source rechecks; owner phone import is USER-ATTESTED. Broader compatibility and full native parity remain open.
- Optional encrypted cloud storage, private recovery, bounded history and conflict choices. The [live release](cloud-release-2026-10-12.md) passes synthetic gates; owner phone “Saved to Cloud” is later USER-ATTESTED. The separately scoped agent API remains disabled on the public sites.

## Next acceptance work

1. Continue screen-by-screen native comparison across phone, tablet and desktop. Fix remaining layout, labels, picker, motion and material differences; do not treat approximate resemblance as exact parity.
2. Exercise physical-device permission, Keychain, selected-list import, conflict handling and completion-only writeback using an independently owned test account.
3. Install and test named external agent runtimes against the public HTTP contract, including durable operation intent and remote-action retry reconciliation.
4. Validate maximum-workspace CPU/queries/storage against the chosen Cloudflare plan and improve backup/restore before using sensitive data.
5. Extend public-field native mapping where available. Disclose private-API limitations rather than inventing full iCloud sync.
6. Verify independent cross-device restoration and monitor quota/failure behaviour. Phone enablement is owner-attested; keep the old private workspace and unrelated Cloudflare resources separate.
7. Extend private-interface/identity compatibility beyond the accepted native selection and retain fail-closed tests. Current original-section preview validation and owner heading/order/import confirmation do not establish complete field or writeback parity.
8. Resolve the Google OAuth setup blocker: its required CAPTCHA panel rendered blank in both browser attempts, so no product client ID was created. This is not a rejection; real consent and provider actions remain unverified.

## Later agent layer

The current external-agent contract does not require hosted inference. A later optional product-hosted layer may add capture/triage suggestions, planning and a durable executor, with separate authorization, budgets and verifiable results.

That layer is design intent only. It must not silently collect provider keys, execute unassigned reminders, widen tool permissions from note text or claim success without evidence. No hosted model calls, background consumer or vendor-specific executor are deployed by this repository. The [agent/LLM design](LLM-LAYER-DESIGN.md) records its proposed state, authority, execution and acceptance boundaries.

## Open product gaps

Delivered OS notifications, geofencing, full collaboration, offline merging, complete native fields, background device sync and independent verification of external-world outcomes remain outside the current implemented preview.

Follow the [requirements tracker](requirements.md) for the current owner scope. Synthetic preservation or storage tests do not close exact native pixel parity, permissioned source recovery or real-account acceptance.
