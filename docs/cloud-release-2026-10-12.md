# Encrypted cloud release — 12 October 2026

The optional Cloud Storage release is live at [Reminders](https://reminders-web-rea.pages.dev/) and the [public playground](https://agent-reminders-demo.pages.dev/). It uses the separate encrypted storage service. Owner/agent/device API routes remain disabled on both public sites; the original protected backend is unchanged.

This supersedes the earlier static-only/no-Functions deployment boundary for these Pages releases. It does not turn on scoped external-agent execution or publish a shared reminder workspace.

## Frozen runtime and deployment proof

| Item | Result |
| --- | --- |
| Runtime source | `de3667fa1b00d2d44f7b93e91f708218f0f3d26f` on `rea-reminders-build` |
| Primary Pages release | `dd687765-13b2-4ade-b423-644b048f3427` |
| Playground Pages release | `a69aee9b-1d9e-439b-8beb-82531e1b0511` |
| Served assets | All 28 content assets on each site match the frozen artifact bytes |
| Production bindings | `CLOUD` only; zero preview bindings and zero Pages environment secrets |
| Isolated storage Worker | Version `36628769-2525-4940-a609-1c9aa29c2dbc`; public workers.dev access disabled |
| Health | Both sites return HTTP 200/configured for cloud health |
| Existing private backend | Unchanged; no private records read by the release verification |
| Runtime CI | [GitHub Actions run 38300759592](https://github.com/CashpointSoulja/agent-reminders/actions/runs/38300759592) completed successfully for the frozen runtime source |

The [sanitized structured receipt](cloud-release-2026-10-12.json) records these pins, artifact hash, fifteen synthetic live API checks and cleanup. It contains no recovery code, credentials, owner data or private identifiers.

**Later acceptance checkpoint:** the [separate native/owner receipt](parity/native-section-preview-2026-10-12.json) supersedes the older false owner-backup/native-recovery flags for current status without rewriting that frozen JSON. The actual selected native preview validated original section definitions, membership, native order coverage, native/public reminder UUID mapping and post-fetch source rechecks. The owner then reviewed/exported privately, imported on the phone and reported **“Sections imported correctly”**, followed by **“Saved to Cloud.”** Phone import/cloud save are **USER-ATTESTED**; no agent physically read back the phone, export, recovery key or cloud body. Original Apple reminders and the protected backend are unchanged.

## Verification and its limits

- Public Node suite: **201 passed, one optional browser-wrapper skip** out of 202. Original private-source suite: **200 passed, one optional skip** out of 201. These totals overlap in scope and must not be added together.
- Local browser acceptance: **six checks passed in each of two runs**. Fresh live UI acceptance: **six checks passed**, with no automatic cloud/API requests or initial console errors.
- Actual live storage API: **fifteen synthetic checks passed**, including encrypted create/save/read/decrypt, preserved sections, idempotent setup retry, stale-write denial, two-revision history, wrong capability, foreign Origin and anonymous denial, and disabled owner API reads/writes.
- The uniquely owned synthetic vault was deleted and absence verified. No real reminders were used or read for these checks.
- Real workerd/service-binding integration exposed unsupported `redirect: error`; the selective proxy now requests manual redirect handling and rejects 3xx responses. Passing live checks verify the resulting functional path.

Computed CSS glass checks establish selected browser material properties, not native optical or pixel parity. The release does not certify full production readiness, maximum-quota behaviour, private Mac interfaces, real Google consent, physical writeback or named external agents.

## Historical owner-activation checkpoint

At the frozen cloud release's earlier checkpoint, the phone backup had not been activated: physical phone UI could not be controlled and the previous automation tunnel was absent. The owner subsequently enabled it in the already-imported iPhone companion and reported **“Saved to Cloud.”** The latest attestation closes activation within that evidence scope; automated physical readback and real cloud-body inspection were not performed. The phone needs no Mac/USB tunnel to use the live app.

For future setup, use the companion/profile containing the imported copies: **More → Cloud Storage → Remember on This Device → Enable Cloud Storage**, then **Saved to Cloud**. Mac/browser profiles have separate local storage. Keep the recovery code private before clearing storage or connecting another device; never paste it into chat, Git or an agent prompt. Cloud saving does not write to Apple Reminders.

## Still open

Exact iPhone/iPad/Mac pixels, labels, motion and full native feature parity remain unfinished. Original-section recovery is validated for the reviewed native selection, with phone import/cloud save owner-attested; broader private-interface/version and cross-device restoration acceptance remain separate. Google APIs are enabled, but no product OAuth client exists because its required setup CAPTCHA panel rendered blank in both browser attempts; that was not a rejection. Real Google consent/actions, hardware/Keychain/completion writeback and named external runtime acceptance remain open. Hosted inference remains a later deployment phase; its public layer design is documented now.

See [requirements](requirements.md), [account verification](account-verification.md), [cloud storage](private-cloud-storage.md) and the [cloud user guide](cloud-storage-user-guide.md).
