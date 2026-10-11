import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../backend/worker.js";
import { createReminder } from "../src/model.js";

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../backend/schema.sql", import.meta.url), "utf8"));
  const statement = (sql, values = []) => ({
    sql, values, bind(...next) { return statement(sql, next); },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...values).changes } }; },
  });
  const DB = { prepare: statement, async batch(rows) { sqlite.exec("BEGIN"); try { const results = []; for (const row of rows) results.push(/^SELECT/i.test(row.sql) ? await row.all() : await row.run()); sqlite.exec("COMMIT"); return results; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } } };
  const objects = new Map(), deleted = [];
  const FILES = { async put(key, bytes) { objects.set(key, new Uint8Array(bytes)); }, async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; }, async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) { deleted.push(key); objects.delete(key); } } };
  const env = { DB, FILES, SAMPLE_DATA: "0", APP_PASSWORD: "fictional-p1-fixture", SESSION_SECRET: "fictional-p1-session-secret".repeat(3) };
  let cookie, current;
  async function call(path, { method = "GET", data, form, revision, authenticated = true, origin = "https://sample.test", bearer } = {}) {
    const headers = { Origin: origin };
    if (cookie && authenticated) headers.Cookie = cookie;
    if (revision !== undefined) headers["If-Match"] = String(revision);
    if (data !== undefined) headers["Content-Type"] = "application/json";
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    return worker.fetch(new Request(`https://sample.test${path}`, { method, headers, body: form || (data === undefined ? undefined : JSON.stringify(data)) }), env);
  }
  const state = async () => { const response = await call("/api/state"); assert.equal(response.status, 200); current = await response.json(); return current; };
  const mutate = async (path, method, data, form) => { await state(); const response = await call(path, { method, data, form, revision: current.revision }); assert.ok(response.ok, `Owned fixture operation returned ${response.status}`); current = await response.json(); return current; };
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const upload = (filename = "Sample.png") => { const form = new FormData(); form.set("file", new Blob([png], { type: "image/png" }), filename); return form; };
  async function fixture() {
    const login = await call("/api/auth/login", { method: "POST", data: { password: env.APP_PASSWORD } }); assert.equal(login.status, 200); cookie = login.headers.get("set-cookie").split(";")[0];
    await mutate("/api/state", "PUT", { data: { lists: [{ id: "sample-list", name: "Sample source", color: "#007aff", icon: "list", sections: [] }], reminders: [createReminder("sample-list", "Sample A"), createReminder("sample-list", "Sample B")] } });
    const a = current.data.reminders[0], b = current.data.reminders[1];
    await mutate(`/api/reminders/${a.id}/attachments`, "POST", undefined, upload("Sample_A.png"));
    await mutate("/api/templates", "POST", { listId: "sample-list", name: "Sample template", includeCompleted: false });
    const original = structuredClone(current.data.templates[0]), fileA = original.files[0], objectA = sqlite.prepare("SELECT object_key FROM template_attachments WHERE id = ?").get(fileA.id).object_key;
    return { a, b, original, fileA, objectA };
  }
  return { env, sqlite, objects, deleted, call, state, mutate, upload, fixture, png };
}

const storedRecord = ({ files, ...template }) => template;

test("dirty draft Share/Update publishes its selected graph without changing private photos; outer Cancel preserves A", async () => {
  const h = setup(), { b, original, fileA, objectA } = await h.fixture();
  await h.mutate(`/api/templates/${original.id}/reminders/${b.id}/attachments`, "POST", undefined, h.upload("Sample_B.png"));
  const staged = (await h.state()).data.templates[0], fileB = staged.files.find(file => file.id !== fileA.id);
  const draft = { ...storedRecord(staged), name: "Sample draft", list: { ...staged.list, name: "Sample draft" }, reminders: staged.reminders.filter(row => row.id === b.id).map(row => ({ ...row, assignedTo: null })) };
  const before = await h.state();
  const response = await h.call(`/api/templates/${original.id}/share`, { method: "POST", data: { dates: false, tags: false, locations: false, draft }, revision: before.revision });
  assert.equal(response.status, 200);
  const share = await response.json();
  assert.equal(share.outdated, false);
  const after = await h.state(); assert.equal(after.revision, before.revision); assert.deepEqual(after.data, before.data);
  const preview = await (await h.call("/api/templates/shared", { bearer: share.token, authenticated: false })).json();
  assert.equal(preview.template.name, "Sample draft"); assert.equal(preview.template.reminders.length, 1); assert.equal(preview.template.reminders[0].title, "Sample B"); assert.equal(preview.template.files, undefined); assert.equal(preview.template.reminders[0].attachments, undefined);
  assert.equal((await h.call(fileA.downloadUrl, { bearer: share.token, authenticated: false })).status, 401);
  const updatedDraft = { ...draft, name: "Sample edited draft", list: { ...draft.list, name: "Sample edited draft" } };
  const unchanged = await h.call(`/api/templates/${original.id}/share`, { method: "POST", data: { draft: updatedDraft }, revision: after.revision }); assert.equal(unchanged.status, 200);
  assert.equal((await (await h.call("/api/templates/shared", { bearer: share.token, authenticated: false })).json()).template.name, "Sample draft");
  const updated = await h.call(`/api/templates/${original.id}/share`, { method: "PUT", data: { draft: updatedDraft }, revision: after.revision }); assert.equal(updated.status, 200);
  assert.equal((await updated.json()).outdated, false); assert.equal((await (await h.call("/api/templates/shared", { bearer: share.token, authenticated: false })).json()).template.name, "Sample edited draft");
  assert.deepEqual((await h.state()).data, after.data);
  await h.mutate(`/api/templates/${original.id}`, "PATCH", { template: storedRecord(original), deletedAttachmentIds: [fileB.id] });
  const restored = (await h.state()).data.templates[0]; assert.deepEqual(storedRecord(restored), storedRecord(original)); assert.equal(restored.files.length, 1); assert.equal(restored.files[0].id, fileA.id);
  assert.deepEqual(h.objects.get(objectA), h.png); assert.equal(h.deleted.includes(objectA), false);
  assert.equal((await h.call(fileA.downloadUrl)).status, 200); assert.equal((await h.call(fileB.downloadUrl)).status, 404);
  const current = await h.state();
  assert.equal((await (await h.call(`/api/templates/${original.id}/share`)).json()).outdated, true);
  assert.equal((await h.call(`/api/templates/${original.id}/share`, { method: "DELETE", revision: current.revision, authenticated: false, bearer: share.token })).status, 401);
  assert.equal((await h.call(`/api/templates/${original.id}/share`, { method: "DELETE", revision: current.revision })).status, 200);
  assert.equal((await h.call("/api/templates/shared", { bearer: share.token, authenticated: false })).status, 404);
  assert.deepEqual((await h.state()).data, current.data); assert.deepEqual(h.objects.get(objectA), h.png);
});

test("draft Share retains owner/Origin/CAS/same-template validation and rejects private file authority", async () => {
  const h = setup(), { original } = await h.fixture(), before = await h.state(), path = `/api/templates/${original.id}/share`;
  const draft = storedRecord(original);
  for (const [changes, expected] of [
    [{ authenticated: false }, 401], [{ origin: "https://untrusted.test" }, 403], [{ revision: before.revision - 1 }, 409],
    [{ data: { draft: { ...draft, id: "different-template" } } }, 400],
    [{ data: { draft: { ...draft, list: { ...draft.list, id: "different-list" } } } }, 400],
    [{ data: { draft: { ...draft, files: original.files } } }, 400],
    [{ data: { draft: { ...draft, reminders: draft.reminders.map(row => ({ ...row, attachments: original.files })) } } }, 400],
    [{ data: { draft: { ...draft, reminders: draft.reminders.map(row => ({ ...row, assignedTo: "Sample person" })) } } }, 400],
    [{ data: { draft, arbitraryPrivateField: "sample-only" } }, 400],
    [{ data: { draft: { ...draft, arbitraryField: true } } }, 400],
    [{ data: { draft: { ...draft, list: { ...draft.list, privateField: true } } } }, 400],
    [{ data: { draft: { ...draft, reminders: draft.reminders.map(row => ({ ...row, privateField: true })) } } }, 400],
    [{ data: { draft: { ...draft, reminders: draft.reminders.map(row => ({ ...row, parentId: row.id })) } } }, 400],
    [{ data: { draft: null } }, 400],
  ]) {
    const response = await h.call(path, { method: "POST", data: { draft }, revision: before.revision, ...changes }); assert.equal(response.status, expected);
    assert.equal((await h.state()).revision, before.revision); assert.deepEqual((await h.state()).data, before.data);
  }
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS count FROM template_shares").get().count, 0);
});

test("private photo Save/Use/source deletion/template deletion preserve independent bytes and drain only owned copies", async () => {
  const h = setup(), { original, fileA, objectA } = await h.fixture();
  await h.mutate(`/api/templates/${original.id}/use`, "POST", { name: "Sample reused list" });
  const snapshot = await h.state(), copy = snapshot.data.lists.find(list => list.name === "Sample reused list"), copyFile = snapshot.data.reminders.find(row => row.listId === copy.id && row.title === "Sample A").attachments[0];
  const copyObject = h.sqlite.prepare("SELECT object_key FROM attachments WHERE id = ?").get(copyFile.id).object_key;
  assert.notEqual(copyFile.id, fileA.id); assert.notEqual(copyObject, objectA); assert.deepEqual(h.objects.get(copyObject), h.png);
  await h.mutate("/api/lists/sample-list", "DELETE"); assert.equal((await h.call(fileA.downloadUrl)).status, 200); assert.equal((await h.call(copyFile.downloadUrl)).status, 200);
  const current = await h.state(); await h.mutate("/api/state", "PUT", { data: { ...current.data, templates: [] } });
  assert.equal((await h.call(fileA.downloadUrl)).status, 404); assert.equal((await h.call(copyFile.downloadUrl)).status, 200); assert.deepEqual(h.objects.get(copyObject), h.png);
  await h.mutate(`/api/lists/${copy.id}`, "DELETE"); assert.equal(h.objects.size, 0); assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS count FROM pending_file_cleanup").get().count, 0); assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS count FROM template_attachments").get().count, 0);
});
