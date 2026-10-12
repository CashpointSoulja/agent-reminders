# Documentation

| Document | What it covers |
| --- | --- |
| [User guide](USER-GUIDE.md) | Lists, reminders, templates, attachments and delegation |
| [Self-hosting](SELF-HOSTING.md) | Local setup, Cloudflare resources, secrets and deployment |
| [Build modes](build-modes.md) | Cache-safe browser-local versus protected server exports |
| [Architecture](ARCHITECTURE.md) | UI, API, storage, credentials and execution boundaries |
| [REST API](API.md) | Owner sessions, state revisions, CRUD, files and change feed |
| [Agent API](AGENT-API.md) | Connect an external runtime, claim work and report evidence |
| [Native sync](NATIVE-SYNC.md) | iOS companion, explicit consent, imports and writeback limits |
| [Account linking](account-linking.md) | Browser-local iCloud, Google Calendar and Google Tasks connections |
| [Google setup](google-accounts.md) | Public OAuth client, scopes and provider limits |
| [iCloud linking](icloud-link.md) | Device consent, local import and reviewed browser export |
| [Roadmap](ROADMAP.md) | Current implementation and remaining acceptance work |

The public playground starts with synthetic data and stores edits in this browser. Optional account linking imports only records you select and approve. Server agent/API capabilities require a self-hosted instance and deliberate enablement. Source implementation, automated tests and real-device acceptance are separate states. The public site's [privacy policy](../public/privacy.html) describes provider access and local storage.
