import test from "node:test";
import assert from "node:assert/strict";
import { createReminder, validateStoredData, completeReminder, reopenReminder } from "../src/model.js";
import { categoriseShopping, shoppingCategory, moveShoppingItem, resetShoppingCategories } from "../src/shopping.js";

const fixture = (titles = []) => ({
  lists: [{ id: "shop", name: "REA SAMPLE Shopping", type: "shopping", color: "#007AFF", icon: "cart", sections: [] }],
  reminders: titles.map(title => createReminder("shop", title)),
});
const sectionName = (data, row) => data.lists[0].sections.find(section => section.id === row.sectionId)?.name || "Others";

test("shopping classifies English items, phrases, quantities and leaves unknown titles in Others", () => {
  const data = categoriseShopping(fixture(["2 bananas", "Milk", "frozen peas", "dog food", "toilet paper", "REA SAMPLE unknown widget"]));
  assert.deepEqual(data.reminders.map(row => sectionName(data, row)), ["Produce", "Dairy, Eggs & Cheese", "Frozen Foods", "Pet Care", "Household Items", "Others"]);
  assert.equal(validateStoredData(data), true);
  assert.equal(shoppingCategory("check email"), null);
  assert.equal(shoppingCategory("ice cream"), "frozen");
  assert.equal(data.lists[0].sections.length, 5);
});

test("manual moves and Others choices are remembered for later same-title items and survive edits", () => {
  let data = categoriseShopping(fixture(["Milk", "Bananas"]));
  const produce = data.reminders[1].sectionId;
  data = moveShoppingItem(data, data.reminders[0].id, produce);
  const old = data;
  data = categoriseShopping({ ...data, reminders: [...data.reminders, createReminder("shop", "milk")] }, old);
  assert.equal(data.reminders[2].sectionId, produce);
  assert.equal(data.reminders[2].shoppingCategoryManual, true);
  data = moveShoppingItem(data, data.reminders[2].id, null);
  const before = data;
  data = categoriseShopping({ ...data, reminders: [...data.reminders, createReminder("shop", "Milk")] }, before);
  assert.equal(data.reminders[3].sectionId, null);
  assert.equal(data.lists[0].shoppingOverrides.filter(choice => choice.title === "milk").length, 1);
  assert.equal(validateStoredData(data), true);
});

test("the newest manual correction wins while an unchanged duplicate keeps its older section", () => {
  let data = categoriseShopping(fixture(["Milk", "Bananas", "Salmon"]));
  const produce = data.reminders[1].sectionId, seafood = data.reminders[2].sectionId;
  data = moveShoppingItem(data, data.reminders[0].id, produce);
  data = categoriseShopping({ ...data, reminders: [...data.reminders, createReminder("shop", "milk")] }, data);
  data = moveShoppingItem(data, data.reminders[0].id, seafood);
  assert.equal(data.reminders[3].sectionId, produce);
  assert.equal(data.lists[0].shoppingOverrides.find(choice => choice.title === "milk").sectionId, seafood);
  const roundTrip = categoriseShopping(data, data);
  assert.equal(roundTrip.lists[0].shoppingOverrides.find(choice => choice.title === "milk").sectionId, seafood);
  data = categoriseShopping({ ...roundTrip, reminders: [...roundTrip.reminders, createReminder("shop", "MILK")] }, roundTrip);
  assert.equal(data.reminders[4].sectionId, seafood);
});

test("automatic title edits recategorise while existing manual sections survive Shopping conversion", () => {
  let data = categoriseShopping(fixture(["Bananas"]));
  let next = categoriseShopping({ ...data, reminders: [{ ...data.reminders[0], title: "milk" }] }, data);
  assert.equal(sectionName(next, next.reminders[0]), "Dairy, Eggs & Cheese");
  const section = { id: "custom", name: "Corner Shop" };
  const original = fixture(["Bananas"]);
  original.lists[0] = { ...original.lists[0], type: "standard", sections: [section] };
  original.reminders[0].sectionId = section.id;
  next = categoriseShopping({ ...original, lists: [{ ...original.lists[0], type: "shopping" }] }, original);
  assert.equal(next.reminders[0].sectionId, section.id);
  assert.equal(next.reminders[0].shoppingCategoryManual, true);
});

test("category moves propagate through subtasks without losing metadata or completion state", () => {
  let data = fixture(["Milk", "Bananas"]);
  const parent = data.reminders[0], child = createReminder("shop", "REA SAMPLE carton size"), grandchild = createReminder("shop", "REA SAMPLE barcode");
  child.parentId = parent.id; child.notes = "REA SAMPLE preserved";
  grandchild.parentId = child.id;
  data.reminders = [grandchild, ...data.reminders, child];
  data = categoriseShopping(data);
  assert.equal(data.reminders[0].sectionId, data.reminders[1].sectionId);
  const produce = data.reminders[2].sectionId;
  data = moveShoppingItem(data, parent.id, produce);
  assert.equal(data.reminders.find(row => row.id === child.id).sectionId, produce);
  assert.equal(data.reminders.find(row => row.id === grandchild.id).sectionId, produce);
  const done = completeReminder(data, parent.id);
  assert.equal(done.reminders.find(row => row.id === child.id).completed, true);
  assert.equal(reopenReminder(done, parent.id).reminders.find(row => row.id === child.id).notes, "REA SAMPLE preserved");
  assert.equal(validateStoredData(data), true);
});

test("reset removes learned choices and manual flags without deleting any item or custom section", () => {
  let data = categoriseShopping(fixture(["Milk", "Bananas", "REA SAMPLE unknown"]));
  data = moveShoppingItem(data, data.reminders[0].id, data.reminders[1].sectionId);
  const ids = data.reminders.map(row => row.id);
  data = resetShoppingCategories(data, "shop");
  assert.deepEqual(data.reminders.map(row => row.id), ids);
  assert.equal(sectionName(data, data.reminders[0]), "Dairy, Eggs & Cheese");
  assert.equal(data.reminders.every(row => !row.shoppingCategoryManual), true);
  assert.deepEqual(data.lists[0].shoppingOverrides, []);
});

test("pending custom Section choices create one section at commit and remain idempotent on the API round trip", () => {
  const original = categoriseShopping(fixture(["Milk"]));
  const draft = { ...original, reminders: [{ ...original.reminders[0], shoppingNewSectionName: "REA SAMPLE Corner Shop", shoppingCategoryManual: true }] };
  const committed = categoriseShopping(draft, original);
  assert.equal(original.lists[0].sections.length, 1);
  assert.equal(committed.lists[0].sections.length, 2);
  assert.equal(sectionName(committed, committed.reminders[0]), "REA SAMPLE Corner Shop");
  assert.equal(committed.reminders[0].shoppingNewSectionName, undefined);
  assert.equal(validateStoredData(committed), true);
  const reloaded = categoriseShopping(committed, original);
  assert.deepEqual(reloaded, committed);
  const learned = categoriseShopping({ ...committed, reminders: [...committed.reminders, createReminder("shop", "milk")] }, committed);
  assert.equal(learned.reminders[1].sectionId, committed.reminders[0].sectionId);
});

test("standard and smart lists are untouched and malformed category metadata fails validation", () => {
  const data = fixture(["Milk"]);
  data.lists[0].type = "standard";
  assert.deepEqual(categoriseShopping(data), data);
  for (const patch of [
    { shoppingOverrides: [{ title: "milk", sectionId: "missing" }] },
    { shoppingOverrides: [{ title: "", sectionId: null }] },
    { shoppingOverrides: [{ title: "milk", sectionId: null }, { title: "milk", sectionId: null }] },
    { shoppingOverrides: [{ title: "Milk", sectionId: null }] },
    { shoppingOverrides: [{ title: "x".repeat(1001), sectionId: null }] },
    { sections: [{ id: "bad", name: "Invalid", shoppingCategory: "unknown" }] },
  ]) assert.equal(validateStoredData({ ...data, lists: [{ ...data.lists[0], ...patch }] }), false);
  assert.equal(validateStoredData({ ...data, reminders: [{ ...data.reminders[0], shoppingCategoryManual: "true" }] }), false);
  assert.equal(validateStoredData({ ...data, lists: [{ ...data.lists[0], icon: "emoji:🍉" }] }), true);
  assert.equal(validateStoredData({ ...data, lists: [{ ...data.lists[0], icon: "emoji:not-an-emoji" }] }), false);
});
