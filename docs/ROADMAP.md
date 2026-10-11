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

## Next acceptance work

1. Continue screen-by-screen native comparison across phone, tablet and desktop. Fix remaining layout, labels, picker, motion and material differences; do not treat approximate resemblance as exact parity.
2. Exercise physical-device permission, Keychain, selected-list import, conflict handling and completion-only writeback using an independently owned test account.
3. Install and test named external agent runtimes against the public HTTP contract, including durable operation intent and remote-action retry reconciliation.
4. Validate maximum-workspace CPU/queries/storage against the chosen Cloudflare plan and improve backup/restore before using sensitive data.
5. Extend public-field native mapping where available. Disclose private-API limitations rather than inventing full iCloud sync.

## Later agent layer

The current external-agent contract does not require hosted inference. A later optional product-hosted layer may add capture/triage suggestions, planning and a durable executor, with separate authorization, budgets and verifiable results.

That layer is design intent only. It must not silently collect provider keys, execute unassigned reminders, widen tool permissions from note text or claim success without evidence. No hosted model calls, background consumer or vendor-specific executor are deployed by this repository.

## Open product gaps

Delivered OS notifications, geofencing, full collaboration, offline merging, complete native fields, background device sync and independent verification of external-world outcomes remain outside the current implemented preview.
