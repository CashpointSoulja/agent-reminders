# Owner REST API

The browser and API must share an origin. Owner sessions use HttpOnly cookies; agents use a separate scoped protocol described in [AGENT-API.md](AGENT-API.md).

## Authentication

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/api/health` | Configuration booleans; no workspace or secrets |
| POST | `/api/auth/login` | JSON password; creates owner session |
| GET | `/api/auth/session` | Authenticated boolean only |
| POST | `/api/auth/logout` | Revokes current session |

Sessions expire after eight hours. Cookies are Secure on HTTPS, SameSite=Strict and scoped to `/api`. Explicit localhost `DEV_MODE=1` permits HTTP development without bypassing authentication.

Login is limited to ten attempts per hashed client IP in a fixed fifteen-minute window starting with the first attempt. Denied attempts do not extend that window. Proxied/local requests without Cloudflare's client-IP header may share a fallback bucket.

## State and concurrency

`GET /api/state` returns:

```json
{
  "data": { "lists": [], "reminders": [] },
  "revision": 0,
  "sequence": 0
}
```

Owner mutations require an exact allowed `Origin` and `If-Match: <revision>`. Missing revisions yield 428, malformed revisions 400 and stale revisions 409. Re-read and reconcile a conflict; do not blindly repeat a completion or overwrite an uncertain result.

`PUT /api/state` accepts `{ "data": { "lists": [], "reminders": [] } }`. It validates the graph and replaces owner state; submitted attachment metadata is ignored. Normal mutations return the authoritative snapshot.

## Resources

| Collection | Methods |
| --- | --- |
| `/api/lists` | GET, POST |
| `/api/lists/:id` | GET, PATCH, DELETE |
| `/api/reminders` | GET, POST |
| `/api/reminders/:id` | GET, PATCH, DELETE |

List IDs and timestamps are server-generated. Creating a reminder requires a valid `listId`; fields include title, notes, URL, date/time, recurrence, tags, priority, flags, section and parent.

Dates are `YYYY-MM-DD`; times are `HH:mm` and require a date. Priority is `none`, `low`, `medium` or `high`. Subtasks use `parentId`, must stay within one list and cannot form a cycle. Sections belong to the list. URL fields accept HTTP/HTTPS references; the server does not fetch them.

PATCH completion uses the domain service, including descendant completion and recurrence consequences. A snapshot replacement expects a complete valid representation. Deletion removes a reminder's descendants or a list's reminders and records tombstone events.

Shopping lists use `type: "shopping"`. A local English vocabulary categorises explicitly created/edited items. Unknown items stay under Others; manual section preferences are retained. Apple's downloaded classifier is not included.

## Attachments

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/api/reminders/:id/attachments` | Private metadata |
| POST | `/api/reminders/:id/attachments` | Multipart `file` upload with current revision |
| GET | `/api/attachments/:id` | Authenticated file body |
| DELETE | `/api/attachments/:id` | Revision-guarded removal |

Accepted types: PNG, JPEG, WebP, PDF and plain text, one byte to five MiB per file. Image/PDF signatures are checked. HTML, SVG, executables and null-containing text are refused. This is type validation, not malware scanning.

R2 objects are private and object keys are not returned. File responses use no-store, nosniff and sandbox/download controls. Cleanup failures are retained as jobs for retry.

## Changes and errors

`GET /api/changes?since=0` and `/api/events?since=0` expose the owner change feed. Responses contain `events`, `nextCursor` and `hasMore`, with up to 100 events per page. An expired cursor yields 410 and requires a full rescan.

Ordinary JSON errors contain `error`; unexpected failures expose a generic message rather than internal exception details. Common statuses include 401 unauthenticated, 403 denied origin/scope, 409 conflict, 413 bounds and 429 login limit.

Current personal-workspace bounds include 100 lists, 1,000 reminders and approximately one MiB serialized state. There is no high-volume, multitenant, webhook or background model executor API. Machine-readable agent schemas are served from `/api/agent/openapi.json`.
