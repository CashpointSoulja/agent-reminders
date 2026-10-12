# Private Cloudflare storage

The public app remains usable without signing in or sharing a global workspace. **More → Cloud Storage → Enable Cloud Storage** creates a private encrypted workspace and saves the reminders already on that device to a separate Cloudflare Worker and SQLite-backed Durable Object. Imports from iCloud, Google Calendar and Google Tasks are included after the user has chosen and confirmed them.

Lists, section names and order, reminder section membership, subtasks, dates, notes, tags and the rest of the existing reminder document are preserved. Account import provenance and selections are encrypted with the reminder document so refreshing an imported list remains safe after connecting another device. Google OAuth access tokens are excluded.

## Use and recovery

1. Enable Cloud Storage explicitly. The app encrypts the current document before uploading it.
2. Save the recovery code privately. It unlocks that workspace: anyone with the code can read and change its reminders. Never paste it into an agent prompt, URL, GitHub issue or repository.
3. Select **Remember on This Device** only on a trusted personal device. It is off by default; without it, the connection lasts for the open page and you need the recovery code next time. The signed companion uses the same web interface and connection flow.
4. On another device, enter the code, review the cloud preview and explicitly choose whether to use the cloud version or keep and upload the local version. The app never replaces local reminders just because a code was entered.
5. Edits save automatically after a short delay. Check **Saved to Cloud** before closing the app. Offline, failed and conflicting saves leave local reminders intact and show an error. Use Refresh to review another device's changes before resolving a conflict.

Disconnect removes the connection from this browser without deleting local reminders or the encrypted cloud workspace. The two preceding encrypted revisions are retained for explicit backup restoration. Losing every copy of the recovery code makes the cloud document unrecoverable; Cloudflare and the operator do not hold its decryption key. A remembered code is kept in that origin's local browser storage and is available to trusted scripts running on the page. Use a trusted device and deployment.

If setup loses its response, it may already have created the encrypted workspace. The recovery code remains available to show or copy, and retrying Enable uses the same workspace and encrypted request rather than creating another one. If Remember on This Device was selected, the pending code is saved locally before upload so reopening can resume the same setup; reopening alone makes no upload. A workspace that has changed is shown as a preview instead of overwritten.

## Storage and authorization

- The recovery code contains a random 128-bit workspace identifier and a random 256-bit master key.
- HKDF-SHA-256 derives independent authentication and AES-256-GCM encryption keys. The master and encryption keys stay on the device; only a derived bearer capability is sent to the Worker. The AES key is nonextractable in Web Crypto.
- Each save uses a fresh random 96-bit nonce. Authenticated additional data binds ciphertext to the workspace and revision, preventing substitution between workspaces or revisions.
- The Durable Object's private SQLite database stores only the ciphertext envelope, a SHA-256 verifier for the bearer capability, revision numbers and timestamps. Titles, section names, notes and source account identifiers are inside the encrypted document.
- All private routes require both a capability and an explicitly allowed Origin. There is no anonymous document listing. Cookies, Google access tokens, public client-supplied user IDs and the old shared app password do not authorize this service.
- Saves use an exact `If-Match` revision and a guarded synchronous SQLite transaction. A stale device receives HTTP 409; it cannot overwrite a newer revision automatically. History is retained and pruned in the same transaction. Cursors are consumed synchronously before any `await`.
- HTTP transport is disabled outside explicit local development, redirects are rejected, responses are not cached, request bodies are bounded while streaming, and application logging is disabled. Do not enable request/header logging or paste diagnostics containing Authorization headers.

Encryption protects stored documents and prevents another visitor reading them. It cannot protect an unlocked page from malicious code served by a compromised frontend, a compromised personal device or someone who has the recovery code. Cloudflare still sees normal network and storage metadata.

## Isolated deployment

This service uses a **new SQLite-backed Durable Object namespace**, never an existing reminder database. A singleton named `private-vaults-v1` enforces the global 50-workspace ceiling consistently; each document still requires its own capability. The existing owner Worker, its credentials and saved state are left intact. It requires no D1 database slot, R2 or paid plan enrollment.

Copy `wrangler.cloud-vault.example.jsonc` to an ignored operator configuration. Keep the `VAULT_STORE` binding and `new_sqlite_classes` migration, and exactly the intended Pages origins in `APP_ORIGINS`. Supply a random secret of at least 32 characters as `RATE_LIMIT_SECRET` using `wrangler secret put`; never put it in a tracked file or command line.

```sh
npx wrangler secret put RATE_LIMIT_SECRET --config work/wrangler.cloud-vault.jsonc
npx wrangler deploy --config work/wrangler.cloud-vault.jsonc
```

Paths in a copied Wrangler configuration resolve relative to that configuration. Point `main` at the actual `backend/cloud-vault-worker.js` source before deploying. The class creates its three tables and expiry index from `backend/cloud-vault-schema.js` only inside the new namespace. Expired quota buckets are pruned by an indexed query on private requests; no public maintenance endpoint or polling alarm is exposed. Deploying the example creates the namespace through its explicit migration and does not enroll a plan.

SQLite-backed Durable Objects are available on Workers Free and avoid D1's ten-database Free account ceiling. This choice avoids deleting or reusing unrelated databases when D1 slots are unavailable. See [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

For the public app, set the public build variable `EXPO_PUBLIC_CLOUD_VAULT_URL=/cloud`. The Pages proxy forwards only `/cloud/*` to the isolated Worker. A same-origin proxy must retain the request's verified Origin and Authorization, forward only to the new cloud service, and keep the old owner API unbound. There are no keys in this public build variable. The Worker supports `/v1/vaults/*` and `/cloud/v1/vaults/*`; its example disables public `workers.dev` and preview URLs so it is reachable only through the service binding.

### Publish the public app safely

The root `wrangler.jsonc` is for a different server-workspace mode and binds its `API` to the old backend. **Do not use it for this release.** The optional cloud release uses `wrangler.cloud-pages.example.jsonc`, which binds only `CLOUD` to `agent-reminders-private-cloud` and leaves preview services empty.

1. Export the public app with demo mode, `/cloud` and dotenv loading disabled. Configure the public Google client ID separately; never pass private OAuth or vault credentials as build variables.
2. Run `node scripts/prepare-private-cloud.mjs`. It creates the frozen `work/cloud-static` copy, a selective `/cloud/*` proxy, and disabled owner/agent/device API metadata. It rejects functions directories, configuration, environment files, maps and symbolic links in the artifact.
3. Create a new temporary deployment directory **outside the repository and any directory containing an ancestor Wrangler configuration**. Copy the artifact into its `work/cloud-static` directory. Copy `wrangler.cloud-pages.example.jsonc` into this isolated directory as `wrangler.jsonc`.
4. Deploy from that isolated directory with its exact config and the project's production branch. This release uses `rea-reminders-build`; a Pages project whose production branch differs must be configured deliberately before publishing. Do not merge Git branches as part of deployment.
5. Verify that the Pages production binding is only `CLOUD`, preview bindings are empty, `/api/state` returns disabled metadata, `/cloud/health` is configured and anonymous `/cloud/v1/vaults/...` does not reveal documents.

The static Pages site remains available to visitors. Cloud Storage is explicit and uses a private capability; opening the app alone does not upload real reminders. Preview hosts reject `/cloud/*` with HTTP 503 and cannot claim a connected cloud workspace.

## API

| Route | Behavior |
| --- | --- |
| `GET /health` | Public configuration status; no reminder or tenant data. |
| `POST /v1/vaults/{id}` | Create an encrypted workspace using its derived bearer capability, revision 0. |
| `GET /v1/vaults/{id}` | Read the authorized workspace envelope, current revision and bounded history metadata. |
| `PUT /v1/vaults/{id}` | Store a new encrypted envelope with exact `If-Match`; retain two previous revisions. |
| `GET /v1/vaults/{id}/history/{revision}` | Read an authorized retained encrypted revision. |
| `DELETE /v1/vaults/{id}` | Delete that authorized workspace and its history with exact `If-Match`; intended for explicit deletion and disposable test cleanup. |

Recovery codes are entered privately and never sent to these routes. The browser sends only the derived bearer token. API clients cannot use this storage service to read assigned agent tasks: external-agent execution is a separate authenticated, scoped backend feature.

## Free-tier ceilings and checks

The implementation caps plaintext at 1,250,000 UTF-8 bytes, ciphertext envelopes at 1,700,000 bytes, 10,000 reminders, 1,000 lists and 50 workspaces. Current plus two retained documents use at most approximately 255 MB; rate-limit records are bounded to 5,000 rows. New-workspace creation is limited to three per IP per UTC day, private requests to 120 per IP per minute. IP bucket keys use HMAC and a private server secret; raw IPs are not stored in the SQLite database.

These ceilings keep each row below the Durable Object SQL 2 MB row limit and document storage below the 1 GB Free per-object ceiling. Free account and daily request/query quotas still apply and may stop availability; the app keeps local data and surfaces failures. See [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/). No paid enrollment is part of setup.

Run `node --test tests/cloud-vault.test.js` for synthetic encryption, section preservation, tenant isolation, wrong-key/tamper rejection, Origin/HTTPS checks, CAS conflicts, two-version history, deletion, rate/capacity limits and the maximum permitted encrypted row. The SQLite Durable Object facade tests also recreate the instance on the same database and prove transaction rollback after an injected failed update. Run the app's browser checks for the UI, explicit remembered credentials, reconnect preview and save/reload behavior. Never use real account contents in fixture files or diagnostic output.

This is document storage, not live iCloud writeback. A source refresh still needs the account's original consent and access. Photos requiring a backend/R2 object cannot be reconstructed from an unavailable attachment URL by this service.
