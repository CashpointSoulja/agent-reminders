import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { seedData, createReminder } from "../src/model.js";
import { saveTemplate, useTemplate } from "../src/templates.js";
import { manageTemplateShare, readSharedTemplate, sharedTemplateSnapshot, templateShareStatuses } from "../backend/template-sharing.js";

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../backend/schema.sql", import.meta.url), "utf8"));
  const statement = (sql, values = []) => ({ bind(...args) { return statement(sql, args); }, async first() { return sqlite.prepare(sql).get(...values) || null; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; }, async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: result.changes } }; } });
  const data = seedData(), source = data.lists[0], row = data.reminders[0];
  source.shared = true; source.participants = ["Sample private person"]; source.group = "Sample private group"; source.sections = [{ id: "private-section", name: "Sample section" }]; source.shoppingOverrides = [{ title: "Private historical item", sectionId: "private-section" }];
  row.dueDate = "2027-01-13"; row.dueTime = "13:35"; row.location = "Sample private address"; row.tags = ["sample-private"]; row.sectionId = "private-section"; row.attachments = [{ id: "sample-private-photo" }]; row.assignedTo = "Sample person"; row.arbitraryPrivateField = "Sample arbitrary private field";
  data.reminders.push({ ...createReminder(source.id, "Sample child"), parentId: row.id, sectionId: row.sectionId });
  const current = { data: saveTemplate(data, source.id, "Sample template"), revision: 5 };
  sqlite.prepare("INSERT INTO state (id, document, revision, mutation) VALUES (1, ?, ?, '')").run(JSON.stringify(current.data), current.revision);
  return { sqlite, current, id: current.data.templates[0].id, env: { DB: { prepare: statement }, SESSION_SECRET: "sample-only-test-key".repeat(4) } };
}
const sharedRequest = token => new Request("https://sample.test/api/templates/shared", { headers: token ? { authorization: `Bearer ${token}` } : {} });

test("shared snapshots whitelist fields, suppress private metadata and safely remap all graph IDs", () => {
  const { current } = setup(), template = current.data.templates[0];
  const result = sharedTemplateSnapshot(template);
  assert.equal(result.list.group, ""); assert.equal(result.list.shared, undefined); assert.equal(result.list.participants, undefined); assert.equal(result.list.shoppingOverrides, undefined);
  assert.equal(result.reminders[0].dueDate, null); assert.deepEqual(result.reminders[0].tags, []); assert.equal(result.reminders[0].location, "");
  assert.equal(result.reminders[0].attachments, undefined); assert.equal(result.reminders[0].assignedTo, undefined); assert.equal(result.reminders[0].arbitraryPrivateField, undefined);
  assert.equal(result.reminders[1].parentId, result.reminders[0].id); assert.equal(result.reminders[0].sectionId, result.list.sections[0].id); assert.notEqual(result.reminders[0].id, template.reminders[0].id);
  const full = sharedTemplateSnapshot(template, { dates: true, tags: true, locations: true });
  assert.equal(full.reminders[0].dueDate, "2027-01-13"); assert.deepEqual(full.reminders[0].tags, ["sample-private"]); assert.equal(full.reminders[0].location, "Sample private address");
  assert.throws(() => sharedTemplateSnapshot(template, { dates: "yes" }), { status: 400 });
  assert.throws(() => sharedTemplateSnapshot(template, { attachments: true }), { status: 400 });
});

test("Include Dates preserves custom weekly/monthly/yearly occurrences through shared-template import", () => {
  const { current } = setup(), template = current.data.templates[0];
  for (const [recurrence, repeatPattern] of [["weekly", { weekdays: [1, 3] }], ["monthly", { monthdays: [1, 15] }], ["monthly", { ordinal: -1, weekday: 5 }], ["yearly", { months: [1, 6], ordinal: 2, weekday: 1 }]]) {
    Object.assign(template.reminders[0], { recurrence, repeatCustom: true, repeatPattern, repeatInterval: 2, repeatEndDate: "2028-01-13" });
    const shared = sharedTemplateSnapshot(template, { dates: true });
    assert.deepEqual(shared.reminders[0].repeatPattern, repeatPattern);
    assert.equal(shared.reminders[0].repeatCustom, true);
    const imported = useTemplate({ lists: [], reminders: [], templates: [shared] }, shared.id, "Sample imported schedule").data;
    assert.deepEqual(imported.reminders[0].repeatPattern, repeatPattern);
    assert.equal(imported.reminders[0].repeatInterval, 2);
    assert.equal(imported.reminders[0].repeatEndDate, "2028-01-13");
    const privateFields = sharedTemplateSnapshot(template);
    assert.equal(privateFields.reminders[0].repeatPattern, null);
    assert.equal(privateFields.reminders[0].repeatCustom, false);
    assert.equal(privateFields.reminders[0].recurrence, "none");
  }
});

test("link creation encrypts token at rest; capability read exposes only a sanitized immutable template", async () => {
  const { env, current, id, sqlite } = setup();
  const created = await manageTemplateShare(env, current, id, "POST", {}, 5);
  assert.equal(created.shared, true); assert.equal(created.outdated, false); assert.ok(/^[A-Za-z0-9_-]{43}$/.test(created.token), "Capability has the expected entropy and encoding");
  const row = sqlite.prepare("SELECT * FROM template_shares").get();
  assert.ok(row.token_hash !== created.token, "Raw token is not the lookup hash"); assert.ok(!row.token_ciphertext.includes(created.token)); assert.equal(JSON.stringify(row).includes(created.token), false);
  const read = await readSharedTemplate(sharedRequest(created.token), env);
  assert.equal(read.template.name, "Sample template"); assert.equal(read.token, undefined); assert.equal(read.data, undefined); assert.equal(read.template.reminders[0].attachments, undefined);
  const retrieved = await manageTemplateShare(env, current, id, "GET"); assert.ok(retrieved.token === created.token, "Owner recovers the same encrypted link");
  const statuses = await templateShareStatuses(env, current); assert.equal(statuses.statuses[id].token, undefined);
  await assert.rejects(readSharedTemplate(sharedRequest(), env), { status: 401 });
  await assert.rejects(readSharedTemplate(sharedRequest("x".repeat(43)), env), { status: 404 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM template_shares").get().count, 1);
});

test("Update Link is explicit, keeps the same link and reflects only committed template version", async () => {
  const { env, current, id, sqlite } = setup(), created = await manageTemplateShare(env, current, id, "POST", { dates: true }, 5);
  current.data.templates[0].reminders[0].title = "Sample changed title"; current.revision = 6;
  sqlite.prepare("UPDATE state SET document = ?, revision = ?").run(JSON.stringify(current.data), current.revision);
  assert.equal((await manageTemplateShare(env, current, id, "GET")).outdated, true);
  assert.notEqual((await readSharedTemplate(sharedRequest(created.token), env)).template.reminders[0].title, "Sample changed title");
  await assert.rejects(manageTemplateShare(env, current, id, "PUT", { dates: true }, 5), { status: 409 });
  const updated = await manageTemplateShare(env, current, id, "PUT", { dates: true }, 6);
  assert.ok(updated.token === created.token, "Update keeps the same capability"); assert.equal(updated.outdated, false);
  assert.equal((await readSharedTemplate(sharedRequest(created.token), env)).template.reminders[0].title, "Sample changed title");
});

test("Stop Sharing, deleted source template and key rotation all fail closed for old capabilities", async () => {
  const { env, current, id, sqlite } = setup(), first = await manageTemplateShare(env, current, id, "POST", {}, 5);
  await manageTemplateShare(env, current, id, "DELETE", undefined, 5);
  await assert.rejects(readSharedTemplate(sharedRequest(first.token), env), { status: 404 });
  const next = await manageTemplateShare(env, current, id, "POST", {}, 5); assert.ok(next.token !== first.token, "New share replaces revoked capability");
  const rotated = { ...env, SESSION_SECRET: "rotated-sample-test-key".repeat(4) };
  await assert.rejects(readSharedTemplate(sharedRequest(next.token), rotated), { status: 404 });
  assert.equal((await manageTemplateShare(rotated, current, id, "GET")).shared, false);
  const replacement = await manageTemplateShare(rotated, current, id, "POST", {}, 5); assert.ok(replacement.token !== next.token, "Key rotation creates a distinct capability");
  await assert.rejects(readSharedTemplate(sharedRequest(next.token), env), { status: 404 });
  sqlite.prepare("UPDATE state SET document = ?").run(JSON.stringify({ ...current.data, templates: [] }));
  await assert.rejects(readSharedTemplate(sharedRequest(replacement.token), rotated), { status: 404 });
});

test("stale workspace CAS, unknown template, corrupted encrypted link and capacity cannot broaden access", async () => {
  const { env, current, id, sqlite } = setup();
  await assert.rejects(manageTemplateShare(env, current, id, "POST", {}, 4), { status: 409 });
  await assert.rejects(manageTemplateShare(env, current, "unknown", "POST", {}, 5), { status: 404 });
  await manageTemplateShare(env, current, id, "POST", {}, 5);
  sqlite.prepare("UPDATE template_shares SET token_ciphertext = 'invalid'").run();
  await assert.rejects(manageTemplateShare(env, current, id, "GET"), { status: 503 });
  sqlite.prepare("UPDATE state SET revision = 6").run();
  await assert.rejects(manageTemplateShare(env, current, id, "PUT", {}, 5), { status: 409 });
  sqlite.prepare("DELETE FROM template_shares").run();
  sqlite.prepare("UPDATE state SET revision = 5").run();
  const insert = sqlite.prepare("INSERT INTO template_shares VALUES (?, ?, 'sample-encrypted', 'sample-key', '{}', '{}', 'sample-fingerprint', 'sample-date', 'sample-date')");
  for (let i = 0; i < 100; i++) insert.run(`sample-capacity-${i}`, `sample-hash-${i}`);
  await assert.rejects(manageTemplateShare(env, current, id, "POST", {}, 5), { status: 409 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM template_shares").get().count, 100);
});
