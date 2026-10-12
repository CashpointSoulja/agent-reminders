# Accounts verification

## Current encrypted-cloud release — 12 October 2026

Runtime source `de3667fa1b00d2d44f7b93e91f708218f0f3d26f` is live on both public sites. Each serves all 28 frozen content assets, binds only `CLOUD` in production, and has zero preview bindings/Pages environment secrets. Owner/agent/device APIs remain disabled and the original private backend is unchanged. The [release receipt](cloud-release-2026-10-12.md) and [sanitized JSON](cloud-release-2026-10-12.json) own the current deployment pins.

Public Node: 201 passed/one optional skip out of 202. Private-source Node: 200 passed/one optional skip out of 201. Local browser six-check acceptance passed twice; fresh live UI six-check acceptance and fifteen actual synthetic live storage API checks pass. Passive UI made no automatic cloud/API requests and had no initial console errors. The actual encrypted test vault was deleted and its absence verified.

Those cloud release tests did not activate owner data. A later actual selected native preview validated original section definitions, membership, native/public UUID mapping, order and source rechecks; 24 synthetic helper checks pass. The owner privately reviewed/exported/imported and reported “Sections imported correctly,” then enabled phone storage and reported “Saved to Cloud.” Those phone results are USER-ATTESTED, without agent physical/export/key/cloud-body readback. [Latest acceptance](parity/native-section-preview-2026-10-12.json) supersedes the earlier activation/native-recovery pending flags while preserving the frozen cloud JSON. Mac/browser profiles remain separate; Google, full native parity/writeback and external-agent acceptance remain open.

The older static-only/no-Functions release below is historical and is superseded by this selective cloud release. Its previous account-test results remain scoped evidence rather than being relabelled as new runtime proof.

## Historical account-linking source

Runtime source: `44965dda06854269e583dce196b01d8656cba67a` on `rea-reminders-build`. Its later documentation/test-only commits did not change that older deployed bundle.

## Checks and their scope

| Check | Result |
| --- | --- |
| Public Node suite | 173 tests pass; GitHub CI passes for the runtime commit |
| Original branch Node suite | 172 tests pass |
| Native synthetic checks | 51 core and 11 protocol checks pass; simulator build and physical-device source typecheck pass |
| Local browser cases | 48 cases pass across initial and corrected runs; 35 unchanged cases retain their earlier pass and all 13 completion cases were repeated |
| Completion regression | Four cases pass: new-grant refresh, pending-preview refresh, already-approved refresh and confirmed completion; one mocked PATCH occurs only after explicit import |
| Additional corrected-run checks | Six baseline and two changed-selection checks pass |
| Live phone and desktop | Both public URLs load the correct browser-local app; Accounts, Templates, fictional CRUD/reload/isolation and 402 × 662 scrolling pass |
| Provider privacy | Synthetic routes intercept all provider requests; passive deployed pages make zero API/private/external requests and have zero page errors |
| Build modes | Compiled entries select DemoApp and ServerApp respectively after cache clearing; mode-switching is checked rather than inferred from a successful export |

The initial browser pass found a refresh-confirmation bypass. The corrected run stages a fresh preview when approval is pending and requires explicit import before completion. Earlier review also fixed an unconfirmed-success response and a disconnect/reconnection race. Tests cover those failures; no real provider data or account mutation was used.

## Historical live static release

- [Reminders](https://reminders-web-rea.pages.dev/): Pages deployment `00d0bf1f-c56b-4789-a2f8-d6dd2e6a8ff5`.
- [Public playground](https://agent-reminders-demo.pages.dev/): deployment `57186e0b-5e53-4c5b-aff1-41dc4dc4c1c0`.
- Both serve 27 matching content assets; `privacy.html` canonically redirects to `/privacy`, whose bytes match the policy source.
- No Pages Functions or production/preview environment, service, D1, R2 or KV bindings are attached. This release changes no private backend, credentials or reminder database.
- Bundle: `index-0c3a0aaab63e81f81d5d7c665dd7cdb9.js`, SHA256 `05ff1fa00dbbb4cb6f9e33f89a4c80b302682a71ee19cf75088853900d65f210`.
- Whole prepared artifact: 29 files, SHA256 `c89ada1c2160953070fec35ac2e5c17aa3bdc441f3cbfc265b08db80dade3dac`, hashing sorted relative path, NUL, bytes and NUL. The two hashes identify different things.

## Repeat the focused browser check

Build the local demo and serve `work/demo-static`, or use a fresh isolated context against the public site. The portable test always substitutes fictional provider responses:

```sh
ACCOUNTS_TEST_URL=https://reminders-web-rea.pages.dev node tests/browser/accounts-completion.cjs
```

Playwright Chromium must be installed. The test never opens real Google consent or sends a real provider mutation. Its initialization skips null-origin documents; the earlier harness-only `about:blank` storage error did not occur on deployed pages.

The corrected portable test was repeated against the live primary URL: four cases pass, exactly one mocked completion PATCH, zero errors including `about:blank`, and zero actual external/private API requests. Its browser closed after the run.

## Open acceptance

The deployment still needs a Google OAuth web client: its required setup CAPTCHA panel was blank in both browser attempts, not a rejection. Real Google consent/actions remain unverified. Selected Mac section recovery has actual preview validation; phone import/cloud save are owner-attested. Independent cross-device restore, complete private fields, Keychain and completion writeback remain open. Imports refresh manually; Calendar/iCloud copies do not write to source. Exact native pixels/motion, named agents and production readiness are not certified.
