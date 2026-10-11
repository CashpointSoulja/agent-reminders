# Bring your agent

Agent Reminders exposes a plain HTTP contract. Your runtime supplies model keys, tools, policy and execution; the application supplies scoped assignments and completion receipts. No vendor-specific adapter is bundled or verified.

`AGENT_API` must be exactly `1` after installing the additive tables in `backend/schema.sql`. Machine definitions remain public with the feature off; `/api/agent/discovery` reports actual enablement.

## Connect and assign

The signed-in owner uses `/settings/agents` to register a runtime and issue a one-time token. Configure that token privately in the runtime, not a command argument, URL or source file. The server stores only its digest.

Available scopes:

- `tasks:read` — required; read that agent's assignments.
- `tasks:execute` — claim and report those assignments.
- `attachments:read` — optional; access only the assigned task's authorised attachments.

Credentials expire and can be revoked. The default lifetime is seven days, with a supported range of sixty seconds to thirty days. An agent credential cannot authenticate the owner API or read unrelated reminders.

Explicit assignment includes an agent and owner-authored completion criteria. A reminder title, note, tag or attachment cannot create a delegation. Assignment is the owner's execution decision; there is no second product approval for work within that assigned scope. The external runtime still enforces its own tool permissions and must request missing authority for extra actions.

Owner management routes require cookie authentication, exact `Origin` and current `If-Match`:

| Method and path | Purpose |
| --- | --- |
| `POST /api/agents` | Register `{ "name": "My runtime" }` |
| `POST /api/agents/:id/tokens` | Issue scopes and expiry; token returned once |
| `POST /api/reminders/:id/delegation` | Assign `{ "agentId": "id", "criteria": "Result read back and checked." }` |
| `GET /api/reminders/:id/delegation` | Read the current task/receipt |
| `DELETE /api/reminders/:id/delegation` | Cancel that delegation |

A nonrepeating parent requires explicit `includeSubtasks: true` to delegate its subtree. Overlapping active tasks are refused. Editing the reminder, children or attachments supersedes the pinned assignment. A repeating parent with descendants is refused until occurrence-level child history is defined; a repeating leaf is supported.

## Machine discovery

Start with `/llms.txt` or `/.well-known/reminders-agent.json`, then read:

- `/api/agent/discovery` for runtime enablement, authentication and capabilities.
- `/api/agent/openapi.json` for OpenAPI 3.1 schemas.
- `/api/agent/guide` for the execution contract.

Personal data is never exposed by public discovery. These endpoints are crawlable; execution still requires owner-issued authority.

## Runtime flow

All following paths are relative to `/api/agent/v1`. Authenticate over HTTPS with `Authorization: Bearer <scoped token>`.

| Method and path | Purpose |
| --- | --- |
| `GET /me` | Own credential metadata |
| `GET /tasks?after=0` | Active assignments, paginated |
| `GET /changes?since=0` | Own task change feed; 410 requires rescan |
| `GET /tasks/:id` | Current task and authorised reminder/subtask context |
| `POST /tasks/:id/claim` | Claim with a stable random `Idempotency-Key` and `leaseSeconds` |
| `POST /tasks/:id/heartbeat` | Renew using pinned `claimId`, `taskVersion` and lease |
| `POST /tasks/:id/report` | Report actual outcome and verification evidence |
| `GET /tasks/:id/attachments` | Authorised metadata with file scope |
| `GET /tasks/:id/attachments/:attachmentId` | Private scoped file download |

Poll no faster than discovery's `pollAfterSeconds`, currently sixty seconds. Persist your claim identity and intended external operation before claiming. Re-read current context, perform authorised work and verify the result before reporting.

Claim leases are thirty to nine hundred seconds, with one hour maximum total renewal. An owner edit, revocation, cancellation or expired lease stops new work. Do not repeat a remote action merely because a report response was lost: reconcile the durable receipt or retry the exact report.

Success requires an unchanged task version, active credential/claim and structured evidence with a verification method, `passed: true` and actual `verifiedAt`. Text evidence includes a checked SHA-256 digest; URL evidence is an attested artifact digest and is never fetched by the server.

Receipts state `completionBasis: "agent_attestation"`. They establish what the credentialed runtime reported, not independent proof of the external-world result. Completion, recurrence consequences, receipt and events commit together; exact replay cannot create another occurrence.

Other outcomes are `failed`, `cancelled` and `needs_input`; they leave the reminder open. Cancellation cannot undo an action already underway in another service.

## Reference client

`scripts/agent-client.mjs` defaults to discovery and does not automatically execute tasks. Configure `REMINDERS_AGENT_BASE_URL` and `REMINDERS_AGENT_TOKEN` privately in the runtime's environment/secret store, then:

```sh
node scripts/agent-client.mjs discover
node scripts/agent-client.mjs tasks
node scripts/agent-client.mjs task TASK_ID
```

The module exports `createAgentClient`, `runAssignedTask` and `evidenceDigest`. Supply your own driver to `runAssignedTask`; it claims, reads, heartbeats and reports only the driver's actual result. Honour its abort signal. There is no built-in model, unrestricted network tool or fabricated completion.

A production runtime must persist operation intent and reconcile tool-side retries. This helper is not a durable external-action orchestrator. Limits include fifty active delegations and two hundred reminders per authorised subtree; this remains a personal-workspace protocol.
