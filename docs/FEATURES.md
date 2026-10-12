# Feature inventory

This inventory distinguishes source, the public app and acceptance. A tested domain or UI flow does not establish exact native parity. Current release and remaining gates are recorded in [requirements](requirements.md).

| Feature | Current implementation | Remaining boundary |
| --- | --- | --- |
| Lists, colours, icons and emoji | Browser UI, domain model and server source | Native sheet/picker/icon pixel equality incomplete |
| Smart views, search and filters | Browser views and tested predicates | Complete native filters, counts and per-platform interaction acceptance |
| Sections, ordering and sorting | Web organisation and section-aware import contract | Genuine original Mac section recovery awaits permission/private-interface acceptance |
| Original section refresh | Supplied source names/order/membership retained; unknown fields do not erase known sections | Public EventKit cannot supply absent metadata; no guessed reconstruction |
| Shopping lists | Local English vocabulary and remembered manual choices | Apple's downloaded classifier and full native behaviour are not reproduced |
| Title, notes and URL | Editable, persisted and validated | Exact native capture/focus/copy flows remain open |
| Dates, times and time zones | Domain/API fields and browser controls | Full native picker/calendar/zone and hardware behaviour |
| Repeats and end repeat | Tested domain rules and custom controls | Complete Apple recurrence semantics; metadata is not notification delivery |
| Tags, flags and priority | Browser organisation and persistence | Private Apple fields are not fully available through public EventKit |
| Subtasks and collapse | Parent graph, drag nesting/outdent and chevron/count | Exact native motion/touch/layout acceptance |
| Templates | Snapshot, editing, reuse and sharing source | Full native equality; server attachment copies require R2 authority |
| Photos/files | Authenticated R2 lifecycle in server source | Public vault does not back up binaries; camera/scans/sketch/native library parity incomplete |
| Light/dark glass | Blur/highlights/translucency and accessibility fallbacks | Exact native optical rendering, shapes and dynamics incomplete |
| Local persistence | Browser profile storage and explicit backups | Storage clearing removes local copies; no comprehensive provider/offline sync |
| Google Calendar import | Read-only selected preview/import and manual refresh source | Product OAuth client, real consent and provider acceptance pending |
| Google Tasks import/completion | Selected import; completion requires separate permission and fresh review | Synthetic checks pass; real consent/version/completion acceptance pending |
| iCloud local import/export | Reviewed companion/file snapshots | Phone import user-attested; full private fields, recurrence and hardware acceptance incomplete |
| Private encrypted cloud | Client encryption, private recovery, bounded history and conflict choices | Current Pages/UI/live release proof pending; provider tokens and photo bytes excluded |
| Owner API | Cookie authentication, revisions, CRUD, events and private files | Separate self-hosted mode; public playground API disabled |
| Agent API | Discovery/OpenAPI, scoped tokens, assignment, claim/heartbeat and evidence receipt | Public cloud storage does not enable execution; named runtimes/live executor unverified |
| Native completion bridge | Versioned selected-list transport and journal source | Real EventKit/Keychain/completion effects unaccepted |
| Printing/accessibility | Web print/layout and basic interaction support | Complete native output and screen-reader/device acceptance incomplete |
| Notifications/triggers | Date/time/location metadata where supported | Delivered OS alarms, geofences/people triggers not implemented |
| Collaboration | No full shared identity/invitation/editing service | Genuine native-equivalent collaboration remains required/open |
| Hosted LLM execution | Design in [LLM-LAYER-DESIGN.md](LLM-LAYER-DESIGN.md) | No hosted inference, provider selection or durable model consumer deployed |

## Storage and execution separation

The browser app can keep selected imports locally and explicitly save an encrypted document to the new cloud service. That capability grants document storage access, not narrowly scoped task execution. Do not give a recovery code to an agent as its task token.

The independently self-hosted Worker/D1/R2 API exposes owner and external-agent contracts. Its flags, credentials and task claims are separate. Public definitions are crawlable while execution remains disabled on the playground.

See the [user guide](USER-GUIDE.md), [accounts](account-linking.md), [cloud guide](cloud-storage-user-guide.md), [native limits](NATIVE-SYNC.md) and [requirements tracker](requirements.md) before treating a feature as accepted.
