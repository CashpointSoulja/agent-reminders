import test from "node:test";
import assert from "node:assert/strict";
import { seedData, validateStoredData } from "../src/model.js";
import { accountSourceForReminder, emptyAccountProvenance, mergeAccountSnapshot, normalizeICloudSnapshot, validateAccountProvenance } from "../src/account-import.js";

const now = new Date("2026-10-12T10:00:00Z");
const reminder = (id, extra = {}) => ({ id, title: `Source ${id}`, notes: "Source note", url: "https://example.com/task", dueDate: "2026-10-13", dueTime: null, dueInstant: null, completed: false, completedAt: null, parentId: null, etag: "e1", ...extra });
const snapshot = (rows = [reminder("one")], extra = {}) => ({ provider: "google-tasks", generatedAt: now.toISOString(), lists: [{ id: "source-list", name: "Synthetic Tasks", reminders: rows }], ...extra });

test("imports are deterministic, idempotent, grouped and leave seed rows unchanged", () => {
  const data = seedData(now), original = JSON.stringify(data);
  const one = mergeAccountSnapshot(data, null, snapshot(), { now });
  const repeatPure = mergeAccountSnapshot(data, null, snapshot(), { now });
  assert.deepEqual(one, repeatPure);
  assert.equal(JSON.stringify(data), original);
  assert.equal(one.imported, 1); assert.equal(one.updated, 0);
  assert.equal(one.data.lists.at(-1).group, "Google Tasks");
  assert.equal(validateStoredData(one.data), true);
  assert.equal(validateAccountProvenance(one.provenance), true);
  const two = mergeAccountSnapshot(one.data, one.provenance, snapshot(), { now });
  assert.equal(two.imported, 0); assert.equal(two.updated, 0);
  assert.equal(two.data.reminders.length, data.reminders.length + 1);
  assert.deepEqual(two.data, one.data);
  const source = accountSourceForReminder(one.provenance, one.data.reminders.at(-1).id);
  assert.equal(source.sourceId, "one"); assert.equal(source.sourceListId, "source-list");
});

test("refresh updates unedited fields, retains local tags/flags and reports both-edited conflicts", () => {
  const first = mergeAccountSnapshot(seedData(now), null, snapshot(), { now });
  const row = first.data.reminders.at(-1);
  row.title = "Locally renamed"; row.tags = ["local"]; row.flagged = true;
  const next = mergeAccountSnapshot(first.data, first.provenance, snapshot([reminder("one", { title: "Remote renamed", notes: "Remote revised note" })], { generatedAt: "2026-10-12T11:00:00.000Z" }), { now });
  const refreshed = next.data.reminders.at(-1);
  assert.equal(refreshed.title, "Locally renamed"); assert.equal(refreshed.notes, "Remote revised note");
  assert.deepEqual(refreshed.tags, ["local"]); assert.equal(refreshed.flagged, true);
  assert.deepEqual(next.conflicts.map(conflict => [conflict.field, conflict.reason]), [["title", "both_changed"]]);
  assert.equal(next.updated, 1);
  assert.equal(next.provenance.reminders[0].base.title, "Source one");
  assert.equal(next.provenance.reminders[0].base.notes, "Remote revised note");
});

test("missing source records are retained; local deletion is not resurrected; older previews reject", () => {
  const first = mergeAccountSnapshot(seedData(now), null, snapshot(), { now });
  const missing = mergeAccountSnapshot(first.data, first.provenance, snapshot([], { generatedAt: "2026-10-12T11:00:00.000Z" }), { now });
  assert.equal(missing.missing, 1); assert.equal(missing.data.reminders.length, first.data.reminders.length);
  assert.throws(() => mergeAccountSnapshot(missing.data, missing.provenance, snapshot(), { now }), { code: "stale_snapshot" });
  const deleted = { ...first.data, reminders: first.data.reminders.slice(0, -1) };
  const refresh = mergeAccountSnapshot(deleted, first.provenance, snapshot(), { now });
  assert.equal(refresh.data.reminders.length, deleted.reminders.length);
  assert.deepEqual(refresh.conflicts.map(conflict => conflict.reason), ["local_deleted"]);
  const listDeleted = { ...deleted, lists: deleted.lists.slice(0, -1) };
  assert.equal(mergeAccountSnapshot(listDeleted, first.provenance, snapshot(), { now }).data.lists.length, listDeleted.lists.length);
});

test("subtask identities preserve hierarchy across refresh and source-list/provider boundaries", () => {
  const first = mergeAccountSnapshot(seedData(now), null, snapshot([reminder("parent"), reminder("child", { parentId: "parent" })]), { now });
  assert.equal(first.data.reminders.at(-1).parentId, first.data.reminders.at(-2).id);
  const second = mergeAccountSnapshot(first.data, first.provenance, snapshot([reminder("parent"), reminder("child", { parentId: "parent" })], { provider: "icloud" }), { now });
  assert.notEqual(second.data.reminders.at(-1).id, first.data.reminders.at(-1).id);
  assert.equal(second.data.lists.at(-1).group, "iCloud");
  const detached = mergeAccountSnapshot(first.data, first.provenance, snapshot([reminder("child", { parentId: "missing" })]), { now });
  assert.equal(detached.data.reminders.at(-1).parentId, null);
});

test("malformed/oversized snapshots, duplicate IDs and invalid URLs reject atomically", () => {
  const data = seedData(now), copy = JSON.stringify(data);
  for (const bad of [snapshot([reminder("x"), reminder("x")]), snapshot([reminder("x", { dueDate: "2026-02-30" })]), snapshot([reminder("x", { url: "javascript:alert(1)" })]), snapshot([reminder("x", { notes: "x".repeat(16385) })]), snapshot([reminder("x", { title: "" })]), snapshot([reminder("x", { parentId: "x" })]), snapshot([], { generatedAt: "yesterday" })]) {
    assert.throws(() => mergeAccountSnapshot(data, null, bad, { now }), { code: "invalid_snapshot" });
    assert.equal(JSON.stringify(data), copy);
  }
  const missing = reminder("missing"); delete missing.completed;
  assert.throws(() => mergeAccountSnapshot(data, null, snapshot([missing]), { now }), { code: "invalid_snapshot" });
  const metadata = { ...emptyAccountProvenance(), access_token: "must-not-be-stored" };
  assert.equal(validateAccountProvenance(metadata), false);
  assert.throws(() => mergeAccountSnapshot(data, metadata, snapshot(), { now }), { code: "invalid_local_data" });
});

test("native selected-list snapshot retains date/time/priority and clears unsafe URL; no recurrence approximation", () => {
  const raw = { schemaVersion: 1, generatedAt: now.getTime(), sample: true, selectedListIDs: ["native-list"], lists: [{ id: "native-list", title: "Sample Native", writable: true }], reminders: [{ id: "native-one", listID: "native-list", title: "Native reminder", notes: "Synthetic note", url: "javascript:unsafe", completed: false, due: { year: 2026, month: 10, day: 13, hour: 9, minute: 30, timeZone: "Europe/London", calendarID: "gregorian", floating: false }, priority: 1, recurring: true }, { id: "native-dated", listID: "native-list", title: "Date only", completed: true, completionDate: now.getTime() - 1000, due: { year: 2026, month: 10, day: 14 }, priority: 9, recurring: false }] };
  const normalized = normalizeICloudSnapshot(raw);
  assert.equal(normalized.sample, true);
  const merged = mergeAccountSnapshot(seedData(now), null, normalized, { now });
  const imported = merged.data.reminders.slice(-2);
  assert.deepEqual(imported.map(row => [row.dueDate, row.dueTime, row.priority, row.url, row.recurrence]), [["2026-10-13", "09:30", "high", "", "none"], ["2026-10-14", null, "low", "", "none"]]);
  assert.equal(imported[0].timeZone, "Europe/London");
  assert.equal(imported[1].completedAt, "2026-10-12T09:59:59.000Z");
  for (const bad of [{ ...raw, selectedListIDs: ["unselected"] }, { ...raw, reminders: [...raw.reminders, raw.reminders[0]] }, { ...raw, generatedAt: 1e20 }, { ...raw, reminders: [{ ...raw.reminders[0], due: { year: 2026, month: 2, day: 30 } }] }, { ...raw, reminders: [{ ...raw.reminders[0], due: { year: 2026, month: 10, day: 13, calendarID: "hebrew" } }] }]) assert.throws(() => normalizeICloudSnapshot(bad), { code: "invalid_snapshot" });
});
