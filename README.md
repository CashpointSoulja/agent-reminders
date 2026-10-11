# Agent Reminders

A personal reminders app with an Apple-inspired interface and an API for the agents you bring.

Organise lists, dates, notes and subtasks, then explicitly delegate selected reminders to your own agent runtime. Your runtime supplies its model keys and tools; this app supplies scoped access, task claims and completion receipts.

**Status: working preview.** Core flows have automated coverage. Exact Apple UI parity, physical-device sync and named vendor integrations remain unfinished.

## Try it

**[Open the playground](https://agent-reminders-demo.pages.dev)** — fictional reminders stored in your own browser. It does not connect to an Apple account, expose a private workspace or run agents. Your edits survive a reload; use a private window or clear this site's browser data to start again.

For persistent server storage, agent execution and private attachments, run your own instance using the instructions below.

## Features

- Lists and smart views, colours, icons, emoji and shopping sections.
- Dates, times, custom repeats, notes, links, tags, flags and priorities.
- Drag to reorder, nest and unnest subtasks; collapse a parent with its count.
- Reusable templates and independently copied template attachments.
- Light and dark layouts with translucent floating controls and reduced-motion/contrast fallbacks.
- A password-protected workspace, revision-guarded writes and private attachments.
- Agent discovery, OpenAPI, scoped tokens, leased claims and evidence-backed completion receipts.
- An opt-in iOS companion for selected-list import and completion-only writeback.

Agent and device features are separate opt-ins. The public playground does not provide their server authority. Shopping categorisation uses a local English vocabulary; it does not reproduce Apple's classifier.

## Run locally

Requirements: Node.js 22.19 or later and npm. Native builds additionally require macOS and Xcode.

```sh
git clone https://github.com/CashpointSoulja/agent-reminders.git
cd agent-reminders
npm ci
npm start
```

Open [localhost:8081](http://localhost:8081) to play with the browser-local demo. No login, secrets or Cloudflare account are needed for that mode.

For a private server-backed instance, copy `.dev.vars.example` to `.dev.vars` and edit it locally: choose an owner password and generate a session secret of at least 32 characters. This ignored file must never enter Git. Keep `DEV_MODE=1` and `APP_ORIGIN=http://localhost:8081` for development.

Start the API in one terminal:

```sh
npm run api:migrate
npm run api:dev
```

Start the web app in another:

```sh
npm run start:server
```

Open [localhost:8081](http://localhost:8081) and sign in with the password you configured. Stop the demo development server before starting server mode on the same port. API traffic is proxied to localhost:8787, keeping browser cookies on the same origin.

For Cloudflare deployment, resource provisioning and feature flags, see [self-hosting](docs/SELF-HOSTING.md).

## Bring your agent

On an instance with `AGENT_API=1`, open `/settings/agents`, register your runtime and issue a scoped token. Configure it in the runtime's private secret store, then assign a reminder with clear completion criteria.

Your agent polls its assignments, claims one, performs the work using its own tools, verifies the result and reports evidence. A successful receipt completes the assigned occurrence. The app does not collect model-provider keys and does not execute arbitrary reminder text.

Machine entry points:

- `/llms.txt`
- `/.well-known/reminders-agent.json`
- `/api/agent/discovery`
- `/api/agent/openapi.json`
- `/api/agent/guide`

See the [agent API](docs/AGENT-API.md) and the [reference client](scripts/agent-client.mjs). OpenClaw, Hermes, Grok and other agents can implement this HTTP contract; vendor-specific adapters are not included or verified.

## Architecture

```text
Web UI ── same-origin API ── Cloudflare Worker
                              ├── D1: private workspace, claims and receipts
                              └── R2: private attachments

External agent ── scoped task API ── Worker
Optional iOS companion ── selected-list device API ── Worker
```

The source is React/Expo Web, plain JavaScript Worker modules and a small Swift companion. Agent tools and inference run outside the app. The native companion uses public EventKit on the user's device; it does not ask for Apple ID credentials.

## Test and build

```sh
npm test
npm run build
```

`npm run build` exports the private server-backed web app. `npm run build:demo` exports the browser-local playground. Neither command deploys anything.

The unit/integration suite includes real SQLite transaction tests with a D1 adapter and fake R2. Browser and iPhone simulator checks cover selected flows using fictional data; they do not establish whole-screen pixel equality or physical-device sync.

Optional macOS checks:

```sh
native/ios/test.sh
native/ios/test-device.sh
native/ios/build.sh
```

## Documentation

[User guide](docs/USER-GUIDE.md) · [Architecture](docs/ARCHITECTURE.md) · [REST API](docs/API.md) · [Agent API](docs/AGENT-API.md) · [iOS companion](docs/NATIVE-SYNC.md) · [Roadmap](docs/ROADMAP.md) · [All docs](docs/README.md)

## Limits and privacy

This is a small single-owner application, not a multi-tenant service. OS notifications, geofences, full collaboration, offline conflict merging and hosted LLM execution are not implemented. Exact native styling and motion are still in progress.

The native bridge is manual and opt-in. Public EventKit cannot reproduce every private Apple Reminders field. Physical-device permission, Keychain, import and writeback need further acceptance testing. Use fictional data while evaluating these features.

The repository contains source and synthetic fixtures, not account exports, owner recordings, deployed secrets or private audit history. See [SECURITY.md](SECURITY.md) before exposing an instance publicly.

## Contributing and licence

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for included data and dependencies.

Project code is licensed under [MIT](LICENSE). Agent Reminders is an independent project and is not affiliated with Apple. Apple Reminders and Apple are trademarks of their respective owner.
