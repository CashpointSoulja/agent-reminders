import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { copyTemplateFiles, rollbackTemplateCopies, templateCopyStatements, fileDeletionStatements } from "../backend/template-files.js";

function setup(count = 1) {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec(readFileSync(new URL("../backend/schema.sql", import.meta.url), "utf8"));
  sqlite.prepare("INSERT INTO state VALUES (1, '{\"lists\":[],\"reminders\":[]}', 0, 'sample-mutation')").run();
  const statement = (sql, values = []) => ({ bind(...args) { return statement(sql, args); }, async first() { return sqlite.prepare(sql).get(...values) || null; }, async run() { return { meta: { changes: sqlite.prepare(sql).run(...values).changes } }; } });
  const objects = new Map(), sources = [];
  for (let i = 0; i < count; i++) {
    const row = { id: `sample-file-${i}`, reminder_id: `sample-source-${Math.floor(i / 20)}`, object_key: `sample-source-object-${i}`, filename: "Sample.png", content_type: "image/png", size: 16, created_at: "2026-10-10T12:00:00.000Z" };
    sqlite.prepare("INSERT INTO attachments VALUES (?,?,?,?,?,?,?)").run(row.id, row.reminder_id, row.object_key, row.filename, row.content_type, row.size, row.created_at);
    objects.set(row.object_key, new Uint8Array(16).fill(i)); sources.push(row);
  }
  let puts = 0;
  const env = { DB: { prepare: statement }, FILES: { async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; }, async put(key, body) { puts++; objects.set(key, new Uint8Array(body)); }, async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); } } };
  return { sqlite, env, objects, sources, puts: () => puts };
}
const target = (source, i = 0) => ({ ...source, template_id: "sample-template", reminder_id: `sample-target-${Math.floor(i / 20)}` });

test("template file copies own immutable blobs and commit metadata/reservations with bounded JSON SQL", async () => {
  const { sqlite, env, objects, sources } = setup(3), copies = await copyTemplateFiles(env, sources.map(target));
  assert.equal(copies.length, 3); assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM pending_file_cleanup").get().n, 3);
  copies.forEach((copy, i) => { assert.notEqual(copy.id, sources[i].id); assert.notEqual(copy.object_key, sources[i].object_key); assert.deepEqual(objects.get(copy.object_key), objects.get(sources[i].object_key)); });
  const statements = templateCopyStatements(env, copies, true); assert.equal(statements.length, 2);
  for (const prepare of statements) await prepare("sample-mutation").run();
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM template_attachments").get().n, 3); assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM pending_file_cleanup").get().n, 0);
  const rows = sqlite.prepare("SELECT * FROM template_attachments").all();
  for (const prepare of fileDeletionStatements(env, rows, true)) await prepare("wrong-mutation").run();
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM template_attachments").get().n, 3);
  for (const prepare of fileDeletionStatements(env, rows, true)) await prepare("sample-mutation").run();
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM template_attachments").get().n, 0); assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM pending_file_cleanup").get().n, 3);
});

test("copy reservations count physical/template/in-flight objects and bytes before any R2 writes", async () => {
  const { sqlite, env, sources, puts } = setup(150);
  const copies = await copyTemplateFiles(env, sources.slice(0, 50).map(target));
  assert.equal(copies.length, 50); assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM pending_file_cleanup").get().n, 50);
  const before = puts(); await assert.rejects(copyTemplateFiles(env, [target(sources[0])]), { status: 413 }); assert.equal(puts(), before);
  await rollbackTemplateCopies(env, copies); assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM pending_file_cleanup").get().n, 0);
  sqlite.prepare("UPDATE attachments SET size = ?").run(1024 * 1024);
  await assert.rejects(copyTemplateFiles(env, [target(sources[0])]), { status: 413 }); assert.equal(puts(), before);
});

test("per-reminder copy limit is enforced without expanding the global object quota", async () => {
  const { env, sources, puts } = setup();
  await assert.rejects(copyTemplateFiles(env, Array.from({ length: 21 }, () => target(sources[0]))), { status: 413 }); assert.equal(puts(), 0);
});

test("a missing source or R2 write failure rolls back every staged copy and preserves original blobs", async () => {
  const { sqlite, env, sources, objects } = setup(3);
  env.FILES.put = async () => { throw Error("Sample R2 failure"); };
  await assert.rejects(copyTemplateFiles(env, sources.map(target)));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM pending_file_cleanup").get().n, 0); assert.equal(objects.size, 3);
  env.FILES.get = async () => null;
  await assert.rejects(copyTemplateFiles(env, sources.map(target)), { status: 404 }); assert.equal(objects.size, 3);
});

test("failed rollback leaves durable ready cleanup jobs without deleting source objects", async () => {
  const { sqlite, env, sources, objects } = setup(3);
  env.FILES.put = async () => { throw Error("Sample failed put"); }; env.FILES.delete = async () => { throw Error("Sample failed cleanup"); };
  await assert.rejects(copyTemplateFiles(env, sources.map(target)));
  const rows = sqlite.prepare("SELECT * FROM pending_file_cleanup").all(); assert.equal(rows.length, 3); assert.ok(rows.every(row => row.ready_at === 0)); assert.equal(objects.size, 3);
});
