# Self-hosting

Choose the mode you need. The public browser app is local by default and can optionally use an isolated encrypted cloud vault. The separate owner/agent/device API is a single-owner server workspace backed by D1/R2. Start locally with fictional data before deploying or granting real-data access.

| Mode | Storage and authority |
| --- | --- |
| Browser-local app | No server workspace; selected account imports stay local until cloud saving is explicitly enabled |
| Optional private cloud | Client-encrypted document in an isolated SQLite-backed Durable Object; no externally scoped agent execution |
| Server workspace | Owner sessions, D1 reminder API, private R2 files and opt-in scoped agent/device contracts |

## Local development

Install Node.js 22.19 or later, then follow the [README](../README.md). Copy `.dev.vars.example` to ignored `.dev.vars` and replace both secret placeholders privately. A session secret must be at least 32 characters.

The API uses local Wrangler D1/R2 bindings. `npm run api:migrate` applies `backend/schema.sql` to the local database. `npm run api:dev` serves port 8787; `npm run start:server` serves the authenticated browser app on 8081 and proxies `/api` to the Worker. Plain `npm start` runs the separate browser-local demo.

`SAMPLE_DATA=1` seeds fictional reminders only when the workspace is first initialized. Setting it later does not overwrite an existing workspace. Choose `SAMPLE_DATA=0` for a new empty instance.

The following D1/R2 setup is for server-workspace mode. The optional public-app cloud mode has its own configuration and does not require a D1 slot or R2 bucket.

## Configuration

| Name | Use |
| --- | --- |
| `APP_PASSWORD` | Private owner login secret |
| `SESSION_SECRET` | Random signing secret, at least 32 characters |
| `APP_ORIGIN` | Exact browser origin, without trailing slash |
| `DEV_MODE` | `1` for localhost HTTP only; `0` for deployment |
| `SAMPLE_DATA` | `1` for initial fictional seed; otherwise empty initialization |
| `AGENT_API` | `1` to enable agent management/execution after schema installation; default `0` |
| `DEVICE_SYNC` | `1` to enable native transport after its schema installation; default `0` |
| `DB` | Dedicated D1 binding |
| `FILES` | Private R2 binding for attachments |

Optional encrypted-cloud configuration uses separate names: public `EXPO_PUBLIC_CLOUD_VAULT_URL=/cloud`, exact allowed `APP_ORIGINS`, private `RATE_LIMIT_SECRET`, and `VAULT_STORE` bound to the new SQLite-backed Durable Object. None of these grants agent task execution; recovery codes must never become public build variables.

Do not expose secrets through `EXPO_PUBLIC_*`, browser bundles, URLs, command arguments or logs. Do not commit `.dev.vars`, environment files, database exports or reminders.

## Cloudflare resources

Use your own Cloudflare account and dedicated resources. The checked-in configuration uses generic resource names and a placeholder database ID; it contains no account credentials.

```sh
npx wrangler login
npx wrangler d1 create agent-reminders-data
npx wrangler r2 bucket create agent-reminders-attachments
```

Set the new database ID in your private deployment configuration or local copy of `wrangler.api.jsonc`. Check the configured Worker, Pages project, service binding and R2 bucket names agree.

This project is designed around Cloudflare Pages/Workers, D1 and private R2. Stay within included quotas and review usage; a source configuration cannot guarantee your account's billing eligibility or a permanently zero-cost deployment. Do not enable paid features or overage authorization unless you choose to do so. R2 provisioning/activation may require account billing setup. An instance without R2 must clearly disable attachments instead of presenting them as available.

## Deploy the private API

Choose the final Pages origin, set it as `APP_ORIGIN` and keep `DEV_MODE=0`. Configure secrets through Wrangler's interactive prompt, not inline shell values:

```sh
npx wrangler secret put APP_PASSWORD --config wrangler.api.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.api.jsonc
npx wrangler d1 execute agent-reminders-data --remote --file backend/schema.sql --config wrangler.api.jsonc
npx wrangler deploy --config wrangler.api.jsonc
```

Remote schema commands change the selected database. Confirm the target and back up an existing instance before an upgrade. This repository contains no deployed database or secret.

## Deploy the web app

```sh
npm run build
npx wrangler pages project create agent-reminders
npx wrangler pages deploy dist --project-name agent-reminders
```

The Pages configuration binds `API` to the Worker service. The checked-in Pages function proxies `/api` to that binding. Web and API must share the same browser origin; calling an unrelated `workers.dev` URL directly will not make strict owner cookies work.

Check both preview and production service bindings and origin values in your account. Verify login, logout, unauthenticated denial, create/edit/reload, stale-save conflict and private attachment upload/download/delete with disposable fictional data before using the instance.

The built-in password/session gate is the supported baseline. Cloudflare Access may be added as a separate outer gate; it is not provisioned or claimed active by this source.

## Optional agent and device features

Apply `backend/schema.sql` before setting `AGENT_API=1`. Discovery remains public when execution is off, and reports `enabled: false`.

For device transport, also apply:

```sh
npx wrangler d1 execute agent-reminders-data --local --file backend/device-sync-schema.sql --config wrangler.api.jsonc
```

For a remote instance, deliberately select `--remote` only after reviewing the target. Then set `DEVICE_SYNC=1` and redeploy. Device writeback still requires an explicit per-list grant; enabling the transport is not permission to modify an Apple account.

Physical-device sync and public EventKit field limits remain acceptance gaps. Do not enable real-data writeback just because the app compiles. See [native sync](NATIVE-SYNC.md).

## Optional private cloud for the browser app

The source implements explicit enablement, device-side encryption, a private recovery capability, two retained encrypted revisions, reconnect preview and deliberate local/cloud conflict choices. It preserves section names/order/membership and safe account provenance already present in the snapshot. It cannot recover absent EventKit sections or photo binaries, and it does not perform provider refresh/writeback or external agent execution.

Use [`wrangler.cloud-vault.example.jsonc`](../wrangler.cloud-vault.example.jsonc) for a new Worker and SQLite-backed Durable Object namespace, and [`wrangler.cloud-pages.example.jsonc`](../wrangler.cloud-pages.example.jsonc) for a Pages release bound only to `CLOUD`. Keep owner/agent/device APIs unbound. Do not deploy this public mode with the root server-workspace `wrangler.jsonc`.

Build demo mode with only the public cloud endpoint and dotenv loading disabled, then prepare its selective cloud artifact:

```sh
EXPO_NO_DOTENV=1 EXPO_PUBLIC_CLOUD_VAULT_URL=/cloud npm run build:demo
node scripts/prepare-private-cloud.mjs
```

Publish the frozen artifact from an isolated directory and exact cloud-only configuration, following [private cloud storage](private-cloud-storage.md). That guide owns the resource setup, secret provisioning, capability API, quotas and release checks. A public Google client ID is separate configuration; a missing client does not prevent local storage or vault encryption.

Current source and synthetic checks do not establish a successful live cloud release. Before claiming availability, verify health, unauthorized denial, isolated encrypted create/save/reload/history/conflict/deletion with disposable data, and that owner/agent/device endpoints remain disabled. Stay within the documented free-tier ceilings; no paid enrollment, unrelated database deletion or reuse of an existing private workspace belongs in this setup.

Real section recovery still needs owner-granted Mac Reminders permission and private-interface acceptance. Cloud saving retains sections supplied by the source; it cannot manufacture their original names or order. See [original sections](native-sections.md) and the [requirements tracker](requirements.md).
