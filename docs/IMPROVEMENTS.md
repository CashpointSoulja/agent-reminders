# Improvements and priorities

Native one-to-one fidelity remains required. A visible difference from the chosen native reference is a defect, not a discretionary redesign. The following priorities order delivery and acceptance; they do not remove owner requirements or claim Apple lacks equivalent features.

| Priority | Work | Benefit | Current status/exit gate |
| --- | --- | --- | --- |
| P0 | Preserve original sections and identities | Keep imported organisation intact instead of flattening lists | Contract tests exist; genuine Mac permission/private-interface recovery still required |
| P0 | Private cross-device storage | Retain reviewed local copies without a shared plaintext workspace | Encrypted cloud source implemented; live Pages/UI/isolation/persistence proof pending |
| P0 | Honest save/conflict/recovery | Prevent silent lost edits or uncertain setup duplication | Revision/draft safeguards and synthetic tests exist; live failure/reconnect proof required |
| P0 | Exact phone sheets and motion | Preserve the intended native capture/organisation experience | All remaining copy/layout/picker/glass/drag differences stay open defects |
| P0 | Explicit authority and data boundaries | Prevent account imports or note text granting unrelated access | Separate owner, agent, device and cloud capabilities; live deployment separation must be verified |
| P1 | Actual account consent and source acceptance | Make configured import flows usable on real devices | Google client setup blocker and Mac permission/interface gates remain open |
| P1 | Photo/file durability | Keep the material needed to perform a task private and recoverable | R2 source lifecycle exists; cloud binary backup and native capture parity remain gaps |
| P1 | Accessible parity on every layout | Let keyboard, touch and assistive users perform the same core work | Basic checks are a baseline; full native/device/screen-reader acceptance needed |
| P1 | Complete product/API/agent documentation | Make source capabilities and limits understandable without private history | Public PRD, inventory, architecture, APIs and later-layer design documented; keep evidence current |
| P1 | Runtime evidence and reconciliation | Avoid completing a task merely because a model/tool request was accepted | Agent attestation contract exists; named runtime tools and durable retry behaviour remain unverified |
| P2 | Comprehensive backup/restore | Recover full data and files after loss | Two encrypted document revisions are bounded recovery, not complete attachment/backend backup |
| P2 | Reliable offline/provider reconciliation | Retain edits across disconnection without broad automatic writes | Local retention/manual refresh exist; complete offline merging/background sync remains proposed |
| P2 | Delivered notifications and collaboration | Add actual scheduling and shared responsibility | Permission, scheduling, invitation and shared-edit implementations/results are absent |
| P3 | Optional hosted agent layer | Add capture/triage/planning without requiring an external runtime | Design only; separate provider/budget/tool policy and deployment authority needed |

Do not advertise full iCloud sync, live collaboration, geofencing, exact pixels or hosted agent execution until the corresponding flow passes actual acceptance. Follow [requirements](requirements.md) and [roadmap](ROADMAP.md) for current status.
