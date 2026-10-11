import test from "node:test";
import assert from "node:assert/strict";
import { validSmartFilters, matchesSmartFilters } from "../src/smartFilters.js";
import { seedData, selectReminders, validateStoredData } from "../src/model.js";
const now = new Date(2026, 9, 10, 10);
const r = {
  ...seedData(now).reminders[0],
  dueDate: "2026-10-10",
  dueTime: "23:00",
  tags: ["work"],
  location: "Office",
  priority: "high",
};
const filter = (...rules) => ({ match: "all", rules });
test("smart filters combine predicates without mutating reminders", () => {
  const rules = [
    { field: "tags", mode: "selected", values: ["work"] },
    { field: "date", mode: "today" },
    { field: "time", mode: "night" },
    { field: "location", mode: "selected", value: "Office" },
    { field: "flag", mode: "flagged" },
    { field: "priority", mode: "high" },
    { field: "lists", mode: "selected", values: ["work"] },
  ];
  assert.equal(matchesSmartFilters(r, filter(...rules), now), true);
  assert.equal(
    matchesSmartFilters({ ...r, flagged: false }, filter(...rules), now),
    false,
  );
  assert.equal(
    matchesSmartFilters({ ...r, flagged: false }, { match: "any", rules }, now),
    true,
  );
  assert.equal(
    matchesSmartFilters(
      r,
      filter({
        field: "date",
        mode: "range",
        start: "2026-10-09",
        end: "2026-10-11",
      }),
      now,
    ),
    true,
  );
  assert.equal(
    matchesSmartFilters(
      r,
      filter({ field: "time", mode: "range", start: "22:00", end: "02:00" }),
      now,
    ),
    true,
  );
  assert.equal(
    matchesSmartFilters(
      r,
      filter({ field: "lists", mode: "exclude", values: ["work"] }),
      now,
    ),
    false,
  );
  assert.equal(matchesSmartFilters(r, filter(), now), true);
});
test("smart list selection crosses physical lists and excludes completed reminders", () => {
  const data = seedData(now);
  data.reminders = [
    r,
    { ...r, id: "other", listId: "personal", flagged: false },
    { ...r, id: "done", completed: true, completedAt: now.toISOString() },
  ];
  data.lists.push({
    id: "smart",
    name: "Flags",
    color: "#007aff",
    icon: "list",
    sections: [],
    type: "smart",
    filters: filter({ field: "flag", mode: "flagged" }),
  });
  assert.deepEqual(selectReminders(data, "smart", {}, now), [r]);
  assert.equal(validateStoredData(data), true);
  data.lists.at(-1).filters.rules.push({ field: "flag", mode: "unflagged" });
  assert.equal(validateStoredData(data), false);
});
test("filter validation rejects unknown predicates and malformed ranges", () => {
  for (const rules of [
    [{ field: "eval", mode: "any" }],
    [{ field: "date", mode: "range", start: "2026-02-30", end: "2026-03-01" }],
    [{ field: "time", mode: "range", start: "25:00", end: "02:00" }],
    [{ field: "lists", mode: "selected", values: ["work", "work"] }],
    [{ field: "location", mode: "selected", value: "" }],
  ])
    assert.equal(validSmartFilters(filter(...rules)), false);
  const data = seedData(now);
  data.lists[0].type = "unsupported";
  assert.equal(validateStoredData(data), false);
});
test("native relative ranges and date comparisons retain local day boundaries", () => {
  assert.equal(
    matchesSmartFilters(
      r,
      filter({ field: "date", mode: "on", value: "2026-10-10" }),
      now,
    ),
    true,
  );
  assert.equal(
    matchesSmartFilters(
      r,
      filter({ field: "date", mode: "before", value: "2026-10-11" }),
      now,
    ),
    true,
  );
  assert.equal(
    matchesSmartFilters(
      r,
      filter({ field: "date", mode: "after", value: "2026-10-10" }),
      now,
    ),
    false,
  );
  const relative = {
    field: "date",
    mode: "relative",
    amount: 1,
    direction: "next",
    unit: "day",
    includeOverdue: false,
  };
  assert.equal(
    matchesSmartFilters({ ...r, dueDate: "2026-10-11" }, filter(relative), now),
    true,
  );
  assert.equal(
    matchesSmartFilters({ ...r, dueDate: "2026-10-09" }, filter(relative), now),
    false,
  );
  assert.equal(
    matchesSmartFilters(
      { ...r, dueDate: "2026-10-09" },
      filter({ ...relative, includeOverdue: true }),
      now,
    ),
    true,
  );
  assert.equal(
    matchesSmartFilters(
      { ...r, dueTime: "17:30" },
      filter({ field: "time", mode: "evening" }),
      now,
    ),
    true,
  );
  assert.equal(
    validSmartFilters(filter({ ...relative, unit: "arbitrary" })),
    false,
  );
});
