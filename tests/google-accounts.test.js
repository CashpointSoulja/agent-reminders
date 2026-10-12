import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleAccounts, GOOGLE_SCOPES } from "../src/google-accounts.js";

const clientId = "synthetic-web-client.apps.googleusercontent.com";
const time = Date.parse("2026-10-12T10:00:00Z");
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
function fixture({ fetch = async () => response({ items: [] }), consent = "success", expires = 3600 } = {}) {
  const calls = [], configs = [];
  let clock = time, requested = 0, loaded = 0, callback, revoke = [];
  const identity = {
    initTokenClient(config) {
      configs.push(config); callback = config.callback;
      return { requestAccessToken() { requested++; if (consent === "success") config.callback({ access_token: "SYNTHETIC_MEMORY_TOKEN", expires_in: expires, scope: config.scope }); else if (consent === "denied") config.callback({ error: "access_denied", error_description: "DO_NOT_SURFACE_THIS" }); else if (consent === "closed") config.error_callback({ type: "popup_closed" }); } };
    },
    revoke(token, done) { revoke.push(token); done({ successful: true }); },
  };
  const adapter = createGoogleAccounts({ clientId, now: () => clock, loadIdentity: async () => { loaded++; return identity; }, fetch: async (url, options) => { calls.push({ url, options }); return fetch(url, options); } });
  return { adapter, calls, configs, advance(ms) { clock += ms; }, get loaded() { return loaded; }, get requested() { return requested; }, get callback() { return callback; }, get revoked() { return revoke; } };
}

test("unconfigured and disconnected adapters never fetch or load identity implicitly", async () => {
  const f = fixture();
  assert.deepEqual(f.adapter.state("google-calendar"), { configured: true, connected: false, writeback: false, expiresAt: null });
  assert.equal(f.loaded, 0); assert.equal(f.calls.length, 0);
  await assert.rejects(f.adapter.listSources("google-calendar"), { code: "auth_expired" });
  assert.throws(() => f.adapter.connect("google-calendar"), { code: "identity_not_ready" });
  const absent = createGoogleAccounts({ clientId: "" });
  await assert.rejects(absent.prepare(), { code: "not_configured" });
  assert.throws(() => absent.connect("google-tasks"), { code: "not_configured" });
  assert.equal(f.calls.length, 0);
});

test("separate preparation and synchronous popup gesture keep token out of public status", async () => {
  const f = fixture();
  await f.adapter.prepare();
  assert.equal(f.requested, 0);
  const connection = f.adapter.connect("google-calendar");
  assert.equal(f.requested, 1);
  const state = await connection;
  assert.equal(state.connected, true);
  assert.equal(f.configs[0].scope, GOOGLE_SCOPES.calendar);
  assert.equal(f.configs[0].include_granted_scopes, false);
  assert.equal(JSON.stringify(state).includes("SYNTHETIC_MEMORY_TOKEN"), false);
  assert.equal(f.calls.length, 0);
  f.advance(3600000);
  assert.equal(f.adapter.state("google-calendar").connected, false);
  await assert.rejects(f.adapter.listSources("google-calendar"), { code: "auth_expired" });
});

test("denied/closed/missing-scope consent rejects safely; disconnect cancels pending callback", async () => {
  for (const consent of ["denied", "closed"]) {
    const f = fixture({ consent }); await f.adapter.prepare();
    await assert.rejects(f.adapter.connect("google-tasks"), error => !error.message.includes("DO_NOT_SURFACE_THIS") && ["consent_denied", "popup_closed"].includes(error.code));
    assert.equal(f.adapter.state("google-tasks").connected, false);
  }
  const missing = fixture({ consent: "pending" }); await missing.adapter.prepare();
  const request = missing.adapter.connect("google-tasks");
  missing.callback({ access_token: "SYNTHETIC_MEMORY_TOKEN", expires_in: 3600, scope: GOOGLE_SCOPES.calendar });
  await assert.rejects(request, { code: "permission_denied" });
  const cancelled = fixture({ consent: "pending" }); await cancelled.adapter.prepare();
  const pending = cancelled.adapter.connect("google-tasks");
  await cancelled.adapter.disconnect();
  await assert.rejects(pending, { code: "disconnected" });
  cancelled.callback({ access_token: "SYNTHETIC_MEMORY_TOKEN", expires_in: 3600, scope: GOOGLE_SCOPES.tasks });
  assert.equal(cancelled.adapter.state("google-tasks").connected, false);
});

test("task paging includes first-party hidden completions and date-only subtasks", async () => {
  const f = fixture({ fetch: async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("showCompleted"), "true");
    assert.equal(parsed.searchParams.get("showHidden"), "true");
    return response(parsed.searchParams.has("pageToken") ? { items: [{ id: "child", title: "Child", status: "completed", due: "2026-10-13T21:00:00Z", completed: "2026-10-12T09:00:00Z", parent: "parent", etag: "c1" }] } : { items: [{ id: "parent", title: "Parent", status: "needsAction", etag: "p1" }], nextPageToken: "page-two" });
  } });
  await f.adapter.prepare(); await f.adapter.connect("google-tasks");
  const snapshot = await f.adapter.snapshot("google-tasks", [{ id: "list/with?chars", name: "Synthetic Tasks" }]);
  assert.equal(f.calls.length, 2);
  assert.equal(new URL(f.calls[0].url).pathname, "/tasks/v1/lists/list%2Fwith%3Fchars/tasks");
  assert.deepEqual(snapshot.lists[0].reminders.map(row => [row.id, row.dueDate, row.dueTime, row.completed, row.parentId]), [["parent", null, null, false, null], ["child", "2026-10-13", null, true, "parent"]]);
  assert.equal(f.calls[0].options.credentials, "omit");
  assert.equal(f.calls[0].options.redirect, "error");
  assert.equal(f.calls[0].options.headers.Authorization, "Bearer SYNTHETIC_MEMORY_TOKEN");
  assert.equal(JSON.stringify(snapshot).includes("SYNTHETIC_MEMORY_TOKEN"), false);
});

test("calendar uses actual list IDs, bounded recurrence expansion and exclusive all-day ends", async () => {
  const f = fixture({ fetch: async url => url.includes("calendarList") ? response({ items: [{ id: "calendar-id", summary: "Synthetic Calendar", backgroundColor: "#abcdef" }] }) : response({ items: [{ id: "one-day", summary: "One day", start: { date: "2026-10-13" }, end: { date: "2026-10-14" } }, { id: "several-days", summary: "Several days", start: { date: "2026-10-20" }, end: { date: "2026-10-23" } }, { id: "timed", summary: "Call", start: { dateTime: "2026-10-14T09:30:00+01:00" }, end: { dateTime: "2026-10-14T10:30:00+01:00" } }] }) });
  await f.adapter.prepare(); await f.adapter.connect("google-calendar");
  const sources = await f.adapter.listSources("google-calendar");
  const snapshot = await f.adapter.snapshot("google-calendar", sources);
  assert.deepEqual(snapshot.lists[0].reminders.slice(0, 2).map(row => [row.dueDate, row.dueTime]), [["2026-10-13", null], ["2026-10-20", null]]);
  assert.equal(snapshot.lists[0].reminders[2].dueInstant, "2026-10-14T08:30:00.000Z");
  const query = new URL(f.calls[1].url).searchParams;
  assert.equal(query.get("singleEvents"), "true"); assert.equal(query.get("orderBy"), "startTime");
  assert.equal(query.get("timeMin"), "2026-09-12T10:00:00.000Z"); assert.equal(query.get("timeMax"), "2027-10-12T10:00:00.000Z");
  await assert.rejects(f.adapter.snapshot("google-calendar", [{ id: "primary", name: "Alias" }]), { code: "invalid_selection" });
  assert.throws(() => f.adapter.connect("google-calendar", { writeback: true }), { code: "readonly" });
});

test("malformed dates, repeated page tokens and failed later pages never produce partial snapshot", async () => {
  const bad = fixture({ fetch: async () => response({ items: [{ id: "bad", status: "needsAction", title: "Bad", due: "2026-99-99T00:00:00Z" }] }) });
  await bad.adapter.prepare(); await bad.adapter.connect("google-tasks");
  await assert.rejects(bad.adapter.snapshot("google-tasks", [{ id: "l", name: "List" }]), { code: "invalid_response" });
  const cycle = fixture({ fetch: async () => response({ items: [], nextPageToken: "again" }) });
  await cycle.adapter.prepare(); await cycle.adapter.connect("google-tasks");
  await assert.rejects(cycle.adapter.snapshot("google-tasks", [{ id: "l", name: "List" }]), { code: "invalid_response" });
  assert.equal(cycle.calls.length, 2);
  const late = fixture({ fetch: async url => new URL(url).searchParams.has("pageToken") ? response({ error: { message: "PRIVATE_PROVIDER_DETAILS" } }, 403) : response({ items: [{ id: "first", status: "needsAction" }], nextPageToken: "next" }) });
  await late.adapter.prepare(); await late.adapter.connect("google-tasks");
  await assert.rejects(late.adapter.snapshot("google-tasks", [{ id: "l", name: "List" }]), error => error.code === "permission_denied" && !error.message.includes("PRIVATE_PROVIDER_DETAILS"));
});

test("completion only writes selected imported task with opt-in, current etag, If-Match and status-only body", async () => {
  const f = fixture({ fetch: async (url, options) => url.endsWith("/tasks?maxResults=100&showCompleted=true&showHidden=true&showDeleted=false") ? response({ items: [{ id: "task", title: "Synthetic Task", status: "needsAction", etag: "revision-1" }] }) : options.method === "PATCH" ? response({ id: "task", title: "Synthetic Task", status: "completed", etag: "revision-2", completed: "2026-10-12T10:00:00Z" }) : response({ id: "task", title: "Synthetic Task", status: "needsAction", etag: "revision-1" }) });
  await f.adapter.prepare(); await f.adapter.connect("google-tasks");
  await assert.rejects(f.adapter.completeTask("list", "task"), { code: "writeback_disabled" });
  await f.adapter.connect("google-tasks", { writeback: true });
  await assert.rejects(f.adapter.completeTask("list", "task"), { code: "not_selected" });
  await f.adapter.snapshot("google-tasks", [{ id: "list", name: "List" }]);
  await f.adapter.connect("google-calendar");
  const completed = await f.adapter.completeTask("list", "task");
  assert.equal(completed.completed, true);
  const patch = f.calls.find(call => call.options.method === "PATCH");
  assert.deepEqual(JSON.parse(patch.options.body), { status: "completed" });
  assert.equal(patch.options.headers["If-Match"], "revision-1");
  assert.equal(f.configs[1].scope, GOOGLE_SCOPES.taskCompletion);
  await f.adapter.disconnect({ revoke: true });
  assert.equal(f.adapter.state("google-tasks").connected, false);
  assert.equal(f.revoked.length, 1);
});

test("changed source or disconnect during fetch prevents completion/import", async () => {
  const changed = fixture({ fetch: async url => url.includes("/tasks?") ? response({ items: [{ id: "task", title: "Task", status: "needsAction", etag: "old" }] }) : response({ id: "task", status: "needsAction", etag: "new" }) });
  await changed.adapter.prepare(); await changed.adapter.connect("google-tasks", { writeback: true });
  await changed.adapter.snapshot("google-tasks", [{ id: "list", name: "List" }]);
  await assert.rejects(changed.adapter.completeTask("list", "task"), { code: "conflict" });
  assert.equal(changed.calls.some(call => call.options.method === "PATCH"), false);
  let resolve;
  const f = fixture({ fetch: () => new Promise(done => { resolve = done; }) });
  await f.adapter.prepare(); await f.adapter.connect("google-tasks");
  const pending = f.adapter.snapshot("google-tasks", [{ id: "list", name: "List" }]);
  await f.adapter.disconnect(); resolve(response({ items: [] }));
  await assert.rejects(pending, { code: "disconnected" });
});

test("completion rejects an unconfirmed 200 response or mismatched task ID", async () => {
  for (const result of [{ id: "task", status: "needsAction", etag: "next" }, { id: "other-task", status: "completed", completed: "2026-10-12T10:00:00Z" }, { id: "task", status: "completed", deleted: true }]) {
    const f = fixture({ fetch: async (url, options) => url.includes("/tasks?") ? response({ items: [{ id: "task", title: "Task", status: "needsAction", etag: "old" }] }) : options.method === "PATCH" ? response(result) : response({ id: "task", title: "Task", status: "needsAction", etag: "old" }) });
    await f.adapter.prepare(); await f.adapter.connect("google-tasks", { writeback: true });
    await f.adapter.snapshot("google-tasks", [{ id: "list", name: "List" }]);
    await assert.rejects(f.adapter.completeTask("list", "task"), { code: "verification_failed" });
    assert.equal(f.calls.filter(call => call.options.method === "PATCH").length, 1);
  }
  const invalidCurrent = fixture({ fetch: async url => url.includes("/tasks?") ? response({ items: [{ id: "task", title: "Task", status: "needsAction", etag: "old" }] }) : response({ id: "task", status: "unknown", etag: "old" }) });
  await invalidCurrent.adapter.prepare(); await invalidCurrent.adapter.connect("google-tasks", { writeback: true });
  await invalidCurrent.adapter.snapshot("google-tasks", [{ id: "list", name: "List" }]);
  await assert.rejects(invalidCurrent.adapter.completeTask("list", "task"), { code: "invalid_response" });
  assert.equal(invalidCurrent.calls.some(call => call.options.method === "PATCH"), false);
});

test("disconnect while reading a successful completion body prevents confirmation", async () => {
  let resolveBody, bodyStarted;
  const started = new Promise(resolve => { bodyStarted = resolve; });
  const f = fixture({ fetch: async (url, options) => url.includes("/tasks?") ? response({ items: [{ id: "task", title: "Task", status: "needsAction", etag: "old" }] }) : options.method === "PATCH" ? { ok: true, status: 200, json: () => { bodyStarted(); return new Promise(resolve => { resolveBody = resolve; }); } } : response({ id: "task", title: "Task", status: "needsAction", etag: "old" }) });
  await f.adapter.prepare(); await f.adapter.connect("google-tasks", { writeback: true });
  await f.adapter.snapshot("google-tasks", [{ id: "list", name: "List" }]);
  const completion = f.adapter.completeTask("list", "task");
  await started;
  await f.adapter.disconnect();
  resolveBody({ id: "task", title: "Task", status: "completed", completed: "2026-10-12T10:00:00Z" });
  await assert.rejects(completion, { code: "disconnected" });
  assert.equal(f.adapter.state("google-tasks").connected, false);
});

test("reauthorization during the current-task JSON read cannot write using an old selection", async () => {
  let resolveBody, bodyStarted;
  const started = new Promise(resolve => { bodyStarted = resolve; });
  const f = fixture({ fetch: async url => url.includes("/tasks?") ? response({ items: [{ id: "task", title: "Task", status: "needsAction", etag: "old" }] }) : { ok: true, status: 200, json: () => { bodyStarted(); return new Promise(resolve => { resolveBody = resolve; }); } } });
  await f.adapter.prepare(); await f.adapter.connect("google-tasks", { writeback: true });
  await f.adapter.snapshot("google-tasks", [{ id: "list", name: "List" }]);
  const completion = f.adapter.completeTask("list", "task");
  await started;
  await f.adapter.disconnect();
  await f.adapter.connect("google-tasks", { writeback: true });
  resolveBody({ id: "task", title: "Task", status: "needsAction", etag: "old" });
  await assert.rejects(completion, { code: "disconnected" });
  assert.equal(f.calls.some(call => call.options.method === "PATCH"), false);
  await assert.rejects(f.adapter.completeTask("list", "task"), { code: "not_selected" });
});

test("a new preview replaces prior completion selection before any conditional write", async () => {
  let resolveBody, bodyStarted;
  const started = new Promise(resolve => { bodyStarted = resolve; });
  const f = fixture({ fetch: async url => url.includes("/tasks?") ? response({ items: [{ id: "task", title: "Task", status: "needsAction", etag: "old" }] }) : { ok: true, status: 200, json: () => { bodyStarted(); return new Promise(resolve => { resolveBody = resolve; }); } } });
  await f.adapter.prepare(); await f.adapter.connect("google-tasks", { writeback: true });
  await f.adapter.snapshot("google-tasks", [{ id: "old-list", name: "Old List" }]);
  const completion = f.adapter.completeTask("old-list", "task");
  await started;
  await f.adapter.snapshot("google-tasks", [{ id: "new-list", name: "New List" }]);
  resolveBody({ id: "task", title: "Task", status: "needsAction", etag: "old" });
  await assert.rejects(completion, { code: "not_selected" });
  assert.equal(f.calls.some(call => call.options.method === "PATCH"), false);
});
