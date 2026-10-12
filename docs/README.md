# Documentation

| Document | What it covers |
| --- | --- |
| [Product requirements](prd.md) | Vision, users, scope, acceptance targets and current gaps |
| [Feature inventory](FEATURES.md) | Source capabilities versus public deployment and native acceptance |
| [Improvements](IMPROVEMENTS.md) | Delivery priorities and honest exit gates |
| [User guide](USER-GUIDE.md) | Lists, reminders, templates, attachments and delegation |
| [Self-hosting](SELF-HOSTING.md) | Local setup, Cloudflare resources, secrets and deployment |
| [Build modes](build-modes.md) | Cache-safe browser-local versus protected server exports |
| [Architecture](ARCHITECTURE.md) | UI, API, storage, credentials and execution boundaries |
| [REST API](API.md) | Owner sessions, state revisions, CRUD, files and change feed |
| [Agent API](AGENT-API.md) | Connect an external runtime, claim work and report evidence |
| [Agent/LLM design](LLM-LAYER-DESIGN.md) | Current external-agent contract and later hosted orchestration boundaries |
| [Native sync](NATIVE-SYNC.md) | iOS companion, explicit consent, imports and writeback limits |
| [Account linking](account-linking.md) | Browser-local iCloud, Google Calendar and Google Tasks connections |
| [Accounts verification](account-verification.md) | Source, synthetic/browser checks, static deployment and open acceptance |
| [Google setup](google-accounts.md) | Public OAuth client, scopes and provider limits |
| [iCloud linking](icloud-link.md) | Device consent, local import and reviewed browser export |
| [Original sections](native-sections.md) | Section-preserving snapshots and permissioned Mac recovery limits |
| [Cloud storage user guide](cloud-storage-user-guide.md) | Explicit encrypted backups, recovery and cross-device conflict choices |
| [Private Cloudflare storage](private-cloud-storage.md) | Separate Worker/Durable Object, encryption, routes and release configuration |
| [Requirements tracker](requirements.md) | Current owner scope, evidence boundaries and open defects |
| [Roadmap](ROADMAP.md) | Current implementation and remaining acceptance work |

The public playground starts with synthetic data and stores edits in this browser. Optional account linking imports only records you select and approve. Optional encrypted cloud storage is a separate, explicitly enabled document service; current live-release proof is pending. Externally scoped agent/API capabilities require a server-backed instance and deliberate enablement, and remain disabled on the public playground. Source implementation, synthetic tests, user-reported phone import and real-device acceptance are separate states. The public site's [privacy policy](../public/privacy.html) describes these boundaries.
