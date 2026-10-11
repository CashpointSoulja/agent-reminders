import test from "node:test";
import assert from "node:assert/strict";
import { seedData, createReminder, validateStoredData } from "../src/model.js";
import { finishTemplate, saveTemplate, useTemplate } from "../src/templates.js";
test("templates snapshot independently, exclude completed optionally, safely remap sections and parents", () => {
  const original = seedData();
  original.lists[0].sections = [{ id: "section", name: "Sample section" }];
  original.reminders[0].sectionId = "section";
  const child = createReminder("work", "Sample child");
  child.parentId = original.reminders[0].id;
  child.attachments = [{ id: "private-file" }];
  child.assignedTo = "owner";
  original.reminders.push(child);
  const done = createReminder("work", "Sample completed");
  done.completed = true;
  done.completedAt = new Date().toISOString();
  original.reminders.push(done);
  const saved = saveTemplate(original, "work", "Packing");
  assert.equal(saved.templates[0].reminders.length, 2);
  assert.equal(saved.templates[0].reminders[1].attachments, undefined);
  original.reminders[0].title = "Changed original";
  assert.notEqual(
    saved.templates[0].reminders[0].title,
    original.reminders[0].title,
  );
  const result = useTemplate(saved, saved.templates[0].id, "Trip");
  const copied = result.data.reminders.filter(
    (r) => r.listId === result.listId,
  );
  assert.equal(copied[1].parentId, copied[0].id);
  assert.notEqual(copied[0].sectionId, "section");
  assert.equal(copied[0].sectionId, result.data.lists.at(-1).sections[0].id);
  assert.ok(validateStoredData(result.data));
  copied[0].title = "Changed copy";
  assert.notEqual(saved.templates[0].reminders[0].title, copied[0].title);
  const full = saveTemplate(original, "work", "All", true);
  assert.equal(full.templates[0].reminders.length, 3);
  assert.ok(full.templates[0].reminders.every(r => !r.completed && r.completedAt === null));
  assert.ok(
    useTemplate(full, full.templates[0].id, "Again")
      .data.reminders.filter((r) => r.listId !== "work")
      .every((r) => !r.completed),
  );
});
test("template draft commit removes empty rows, promotes surviving children and preserves metadata", () => {
  const template = saveTemplate(seedData(), "work", " Sample ").templates[0];
  const empty = createReminder(template.list.id, "");
  const child = { ...createReminder(template.list.id, " Child "), parentId: empty.id, notes: "Sample note", tags: ["sample"] };
  template.reminders.push(empty, child);
  const finished = finishTemplate(template);
  assert.equal(finished.reminders.length, 2);
  assert.equal(finished.reminders.at(-1).parentId, null);
  assert.equal(finished.reminders.at(-1).title, "Child");
  assert.equal(finished.reminders.at(-1).notes, "Sample note");
  assert.deepEqual(finished.reminders.at(-1).tags, ["sample"]);
  assert.ok(validateStoredData({ lists: [], reminders: [], templates: [finished] }));
  assert.equal(template.reminders.at(-1).parentId, empty.id);
});
test("shopping template reuses category labels but remaps learned item section IDs", () => {
  const data = seedData();
  data.lists[0].type = "shopping";
  data.lists[0].sections = [{ id: "sample-fruit", name: "Fruit & Veg", shoppingCategory: "produce" }];
  data.lists[0].shoppingOverrides = [{ title: "sample apples", sectionId: "sample-fruit" }, { title: "sample paper", sectionId: null }];
  data.reminders[0].sectionId = "sample-fruit";
  const saved = saveTemplate(data, "work", "Sample shopping");
  assert.equal(saved.templates[0].list.type, "standard");
  assert.equal(saved.templates[0].list.shoppingOverrides, undefined);
  // Previously saved Shopping templates remain readable and remap their recorded choices.
  saved.templates[0].list.type = "shopping";
  saved.templates[0].list.shoppingOverrides = structuredClone(data.lists[0].shoppingOverrides);
  const copied = useTemplate(saved, saved.templates[0].id, "Sample copy").data.lists.at(-1);
  assert.notEqual(copied.sections[0].id, "sample-fruit");
  assert.equal(copied.shoppingOverrides[0].sectionId, copied.sections[0].id);
  assert.equal(copied.shoppingOverrides[0].title, "sample apples");
  assert.equal(copied.shoppingOverrides[1].sectionId, null);
  assert.equal(saved.templates[0].list.shoppingOverrides[0].sectionId, "sample-fruit");
});
test("template boundaries reject malformed refs, attachment metadata, duplicates and quota overflow", () => {
  const data = saveTemplate(seedData(), "work", "Sample");
  assert.ok(validateStoredData(data));
  const invalid = structuredClone(data);
  invalid.templates[0].reminders[0].parentId = "missing";
  assert.equal(validateStoredData(invalid), false);
  invalid.templates[0].reminders[0].parentId = null;
  invalid.templates[0].reminders[0].attachments = [];
  assert.equal(validateStoredData(invalid), false);
  assert.equal(
    validateStoredData({
      ...data,
      templates: [data.templates[0], data.templates[0]],
    }),
    false,
  );
  assert.equal(
    validateStoredData({
      ...data,
      templates: Array.from({ length: 101 }, (_, i) => ({
        ...data.templates[0],
        id: String(i),
      })),
    }),
    false,
  );
  assert.throws(() => saveTemplate(data, "work", " "));
  assert.throws(() => useTemplate(data, "unknown", "List"));
});

test("Smart template snapshots flatten foreign physical sections while retaining selected parent metadata", () => {
  const data = seedData();
  data.lists[0].sections = [{ id: "sample-physical-section", name: "Sample source section" }];
  data.reminders[0].sectionId = "sample-physical-section"; data.reminders[0].tags = ["sample-match"];
  const child = { ...createReminder("work", "Sample child"), parentId: data.reminders[0].id, sectionId: "sample-physical-section", tags: ["sample-match"] };
  data.reminders.push(child);
  data.lists.push({ id: "sample-smart", name: "Sample Smart", type: "smart", color: "#007aff", icon: "list", sections: [], filters: { match: "all", rules: [{ field: "tags", values: ["sample-match"], mode: "selected" }] } });
  assert.ok(validateStoredData(data));
  const saved = saveTemplate(data, "sample-smart", "Sample flat template");
  assert.ok(validateStoredData(saved));
  assert.equal(saved.templates[0].list.type, "standard"); assert.equal(saved.templates[0].list.filters, undefined);
  assert.equal(saved.templates[0].reminders.length, 2); assert.ok(saved.templates[0].reminders.every(row => row.sectionId === null && row.listId === "sample-smart"));
  assert.equal(saved.templates[0].reminders[1].parentId, saved.templates[0].reminders[0].id);
  assert.equal(data.reminders[0].sectionId, "sample-physical-section");
});
