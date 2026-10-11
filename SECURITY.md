# Security

This is a preview application for a single owner. Run your own instance and evaluate it with fictional data before granting access to real reminders or an external agent. No hosted security certification or production-readiness claim is made.

## Report a vulnerability

Use GitHub's private vulnerability-reporting option in this repository's **Security** tab. If that option is unavailable, open an issue requesting a private reporting channel without posting exploit details, credentials, reminder contents or screenshots from a real account.

Include the affected source version, a synthetic reproduction, expected security boundary and observed impact. Do not send API tokens, passwords, Apple credentials or private exports.

## Self-hosting checklist

- Generate a unique owner password and at least 32-character session secret; store them using Wrangler secrets.
- Keep D1 and R2 dedicated to the instance. R2 must remain private.
- Serve web and API on the same HTTPS origin. `DEV_MODE=1` is only for localhost.
- Keep agent/device features off until their schema and configuration are installed deliberately.
- Issue short-lived, narrowly scoped agent credentials, and revoke unused access.
- Select native lists explicitly. Completion writeback is a separate opt-in.
- Treat reminder text, URLs and attachments as untrusted context. External runtimes retain responsibility for their own tools and permissions.
- Back up data independently before upgrades; there is no comprehensive built-in backup/restore system.

## Important boundaries

Owner sessions cannot be replaced by agent credentials. Agents can read and execute only assigned tasks within their token scope. Provider keys remain in the external runtime.

A success receipt records an agent's verification attestation. The server checks the credential, lease, task version and replay identity; it does not independently prove a remote action happened. Revoking access cannot undo an action already started in another service.

Native EventKit operations are not atomic with D1. Physical-device sync, public-API field limits and cross-system reconciliation remain acceptance risks; see [native sync](docs/NATIVE-SYNC.md).

## Known dependency advisories

At the initial public preview, `npm audit` reports inherited Expo/React Native toolchain advisories involving `braces`, `node-forge` and `xcode`'s `uuid` dependency. The registry currently proposes incompatible framework downgrades rather than a supported in-place repair. This is not a clean dependency-audit release.

The hosted playground serves a static bundle; it does not expose Metro, Wrangler or signing tools. Do not expose a development server publicly or feed untrusted projects, glob patterns or signing certificates into the affected build tooling. Recheck `npm audit` when upgrading dependencies and validate fixes without forced framework downgrades.
