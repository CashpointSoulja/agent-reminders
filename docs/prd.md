# Product requirements: Agent Reminders

## Vision

Provide a private reminder workspace that feels and behaves like iCloud-enabled Apple Reminders on iPhone, iPad and Mac, while giving a person's own agents explicit, limited task authority. Capture and organisation should remain familiar; stored data and claimed completion should be trustworthy.

One-to-one fidelity is the target. Visible or behavioural differences remain defects, including sheet chrome, copy, typography, spacing, gestures and iOS Liquid Glass. Current source and selected tests do not establish complete native parity.

## Users and jobs

| User | Job | Required experience |
| --- | --- | --- |
| Person on a phone | Quickly capture, add context and act while moving | Reliable saves, native-style touch/drag and readable sheets |
| Person on a tablet | Organise and inspect lists with more space | Correct split layout, selection and keyboard/touch use |
| Person on a desktop | Review, sort, template and complete a workspace | Consistent menus, shortcuts, sections and printing |
| Person using multiple devices | Keep reviewed local copies available elsewhere | Explicit private cloud enablement, recovery, preview and conflict choices |
| Registered external agent | Execute an assigned occurrence and report its outcome | Scoped credentials, bounded claims, verification evidence and no repeated product approval for the assigned scope |

The public app starts with fictional data and browser-local copies. A recovery code can connect a private encrypted document across devices. The separately self-hosted owner/agent API serves one owner; this is not an identity-based multi-tenant collaboration product.

## Product boundaries

- Browser-local imports require explicit account selection and review. Import alone does not upload personal reminders.
- Optional Cloud Storage explicitly encrypts local copies and safe provenance before sending a document to a separate Cloudflare Worker/SQLite-backed Durable Object. It cannot run an agent or recover absent native metadata.
- The owner/agent/device REST API uses its own authentication and D1/R2 storage. It is disabled on the public playground deployment.
- Provider/model keys and tools stay with external runtimes. Reminder content is context, never authority.
- Native permission and account sign-in remain on the user's device. Apple credentials, account exports, real reminders and private recordings never belong in Git.

## Required capabilities

| Area | Requirement | Acceptance |
| --- | --- | --- |
| Native presentation | Per-platform labels, layout, controls, typography, icons and states | Side-by-side same-state comparison; every difference recorded and fixed |
| Liquid Glass | Translucency, blur, highlights, fluid rounded floating controls/sheets | Native comparison in light/dark and accessible readable fallbacks; exact dynamics still open |
| Capture/edit | Title, notes, URL, dates, times, timezone, repeat/end repeat, tags, flags and priority | Correct save/cancel/reload and resulting state; actual alerts are separate |
| Hierarchy | Lifted drag card, target highlight, nest/outdent, child circle and animated chevron/count | Native placement, timing and hierarchy consequences match |
| Organisation | Standard/smart lists, groups, sections, sorting, templates and shopping categories | Correct predicates, counts, order, reuse and completed-state behaviour |
| Original section import | Preserve supplied names, source order, empty sections and membership | Synthetic contract proof plus genuine permissioned source recovery; no inference from reminder text |
| Account linking | Reviewed iCloud and Google imports, conflict-preserving manual refresh | Actual consent and selected-data readback; Google Tasks completion needs its separate consent |
| Private cloud | Explicit encrypted save, private recovery, review before replacement and revision guards | Independent-device restore/persistence, isolation, safe failure, bounded history and live release proof |
| Files/photos | Private R2 lifecycle and native-style photo controls | Protected upload/read/delete and cleanup; camera/scans/full binary backups remain separate gaps |
| APIs/agents | Crawlable definitions, scoped assignment, lease/version checks and truthful receipts | No unassigned access, replay-safe completion and explicit agent-attestation boundary |
| Native device | Selected-list preview/import and optional completion-only writeback | Actual hardware permission, identity/version and reconciliation acceptance |
| Alerts/collaboration | Delivered notifications/triggers and genuine shared responsibilities | Real delivery/invitation/edit outcomes; metadata or mock menus do not pass |
| Accessibility/printing | Keyboard, focus, screen-reader/touch access and retained print content | Relevant device/browser/native output comparisons |

See [FEATURES.md](FEATURES.md) and the [requirements tracker](requirements.md) for the current implementation and gaps. Every required capability remains visible even when its acceptance is unfinished.

## Core journeys

1. Create/edit a reminder and reload to confirm saved context. A conflict preserves the local draft instead of silently overwriting another writer.
2. Drag a row to reorder or nest it, toggle its parent count and drag it out again. Completion/recurrence stay in the domain model.
3. Preview selected account lists and explicitly import local copies. Refresh preserves local edits and missing source records; original sections require source metadata.
4. Explicitly enable Cloud Storage, retain the recovery code privately, then preview and deliberately choose a version on another device. Provider tokens are not backed up.
5. In a separately enabled server instance, register an agent and assign an occurrence with completion criteria. The runtime executes only that scope and reports actual verification/evidence.
6. Optionally use a signed companion and local permissioned section helper. No native source edit or account upload follows merely from compiling or opening a preview.

## Success metrics

These are acceptance targets, not measured achievements:

| Metric | Target/evidence |
| --- | --- |
| Scope coverage | Every required capability has a tracker status, evidence boundary and remaining gate |
| Native fidelity | Zero unresolved visible/behavioural defects in accepted phone/tablet/desktop journeys |
| Data integrity | No silent draft loss or stale overwrite; independent readback matches accepted saves |
| Privacy | No real account/credential/recording artifacts in Git; private routes deny unauthorized access |
| Cloud recovery | Reviewed cross-device restore retains sections/provenance and fails safely on wrong key/conflict |
| Agent authority | Explicit assignment required; unassigned, stale and revoked work denied; no duplicate completion |
| Release health | Frozen build, relevant tests and actual runtime flows pass without unhandled errors |
| Cost | Included Cloudflare quotas respected without paid enablement; availability/usage limitations disclosed |

Responsiveness, motion timing and material performance must be measured on the target device. No invented performance baseline is claimed.

## Roadmap and current gaps

The [roadmap](ROADMAP.md) separates implemented preview, next acceptance and later hosted agents. Current cloud live proof is pending. Phone import is user-attested; Mac original-section recovery awaits permission/private-interface acceptance. Google APIs are enabled, but product client creation is blocked by a blank required CAPTCHA panel, not rejection.

Native pixel/motion parity, complete private Apple fields, real Google consent, hardware writeback, delivered alerts, collaboration and production readiness remain incomplete. External-agent support exists as a separate source contract; hosted inference is design-only and later. The [LLM design](LLM-LAYER-DESIGN.md) defines that boundary.
