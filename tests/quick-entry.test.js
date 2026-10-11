import test from "node:test";
import assert from "node:assert/strict";
import { quickEntryDraft, finishQuickEntry } from "../src/quick-entry.js";
const lists = [
  { id: "virtual", name: "Today", type: "smart" },
  { id: "real", name: "Reminders" },
  { id: "other", name: "Work" },
];
test("blank quick entry chooses physical default and never parses title", () => {
  const d = quickEntryDraft(lists);
  assert.equal(d.listId, "real");
  assert.equal(d.title, "");
  assert.equal(d.dueDate, null);
  assert.throws(() => finishQuickEntry(d, lists), /title/);
  const r = finishQuickEntry(
    {
      ...d,
      title: " Plan tomorrow #sample ",
      tags: ["sample"],
      dueDate: "2026-10-15",
      dueTime: "09:00",
    },
    lists,
  );
  assert.equal(r.title, "Plan tomorrow #sample");
  assert.deepEqual(r.tags, ["sample"]);
  assert.equal(r.dueDate, "2026-10-15");
  assert.equal(r.dueTime, "09:00");
});
test("quick entry rejects unavailable or virtual destination and strips pending uploads", () => {
  assert.equal(quickEntryDraft([{ type: "smart", id: "virtual" }]), null);
  const d = {
    ...quickEntryDraft(lists),
    title: "Sample",
    attachments: [{ id: "local", pending: true }, { id: "stored" }],
  };
  assert.deepEqual(finishQuickEntry(d, lists).attachments, [{ id: "stored" }]);
  assert.throws(
    () => finishQuickEntry({ ...d, listId: "virtual" }, lists),
    /available list/,
  );
});
