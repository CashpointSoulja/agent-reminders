import test from "node:test";
import assert from "node:assert/strict";
import {
  seedData,
  createReminder,
  parseTitle,
  counts,
  selectReminders,
  completeReminder,
  reopenReminder,
  deleteReminder,
  validateStoredData,
} from "../src/model.js";

const now = new Date(2026, 9, 10, 10, 30);
const dataWith = (reminders) => ({ lists: seedData(now).lists, reminders });

test("title parser preserves unrecognized tokens and understands explicit date and time", () => {
  assert.deepEqual(parseTitle("Call Sam tomorrow at 9am", now), {
    title: "Call Sam",
    dueDate: "2026-10-11",
    dueTime: "09:00",
  });
  assert.deepEqual(parseTitle("Lunch next monday at 12:30pm", now), {
    title: "Lunch",
    dueDate: "2026-10-12",
    dueTime: "12:30",
  });
  assert.deepEqual(parseTitle("Read today", now), {
    title: "Read",
    dueDate: "2026-10-10",
    dueTime: null,
  });
  assert.deepEqual(parseTitle("Read at 12am", now), {
    title: "Read",
    dueDate: "2026-10-10",
    dueTime: "00:00",
  });
  assert.deepEqual(parseTitle("Read 2028-02-29 at 18:45", now), {
    title: "Read",
    dueDate: "2028-02-29",
    dueTime: "18:45",
  });
  assert.deepEqual(parseTitle("Read 2026-02-30 at 25:00", now), {
    title: "Read 2026-02-30 at 25:00",
    dueDate: null,
    dueTime: null,
  });
  assert.equal(parseTitle("Read next saturday", now).dueDate, "2026-10-17");
});

test("smart counts, active filtering, text/tag search and sort do not mutate data", () => {
  const overdue = {
    ...createReminder("work", "Zulu", now),
    dueDate: "2026-10-09",
    flagged: true,
    urgent: true,
    notes: "Quarterly review",
    tags: ["team"],
  };
  const future = {
    ...createReminder("work", "Alpha tomorrow", now),
    priority: "high",
  };
  const completed = {
    ...createReminder("personal", "Done", now),
    completed: true,
    completedAt: now.toISOString(),
  };
  const data = dataWith([overdue, future, completed]);
  assert.deepEqual(counts(data, now), {
    today: 1,
    scheduled: 2,
    all: 2,
    flagged: 1,
    completed: 1,
    urgent: 1,
  });
  assert.deepEqual(selectReminders(data, "today", {}, now), [overdue]);
  assert.deepEqual(
    selectReminders(data, "all", { query: "quarterly", tag: "team" }, now),
    [overdue],
  );
  assert.deepEqual(selectReminders(data, "all", { sort: "title" }, now), [
    future,
    overdue,
  ]);
  assert.deepEqual(selectReminders(data, "work", { sort: "priority" }, now), [
    future,
    overdue,
  ]);
  assert.deepEqual(selectReminders(data, "completed", {}, now), [completed]);
  assert.equal(
    selectReminders(data, "all", { showCompleted: true }, now).length,
    3,
  );
  assert.deepEqual(data.reminders, [overdue, future, completed]);
});

test("nonrepeat completion and reopening cascade without changing hierarchy", () => {
  const parent = createReminder("work", "Parent", now), child = { ...createReminder("work", "Child", now), parentId: parent.id }, grandchild = { ...createReminder("work", "Grandchild", now), parentId: child.id }, unrelated = createReminder("personal", "Other", now);
  const data = dataWith([parent, child, grandchild, unrelated]);
  const completed = completeReminder(data, parent.id, now);
  assert.ok(completed.reminders.slice(0, 3).every(r => r.completed && r.completedAt === now.toISOString()));
  assert.equal(completed.reminders[3], unrelated);
  assert.equal(completeReminder(completed, parent.id, now), completed);
  const reopened = reopenReminder(completed, parent.id, now);
  assert.ok(reopened.reminders.every(r => !r.completed && r.completedAt === null));
  assert.deepEqual(reopened.reminders.map(r => r.parentId), data.reminders.map(r => r.parentId));
  assert.equal(reopenReminder(reopened, parent.id, now), reopened);
  assert.equal(reopenReminder(data, "missing", now), data);
  assert.equal(data.reminders[0].completed, false);
  assert.deepEqual(deleteReminder(data, parent.id).reminders, [unrelated]);
  assert.ok(validateStoredData(reopened));
});

test("repeating parent keeps active identity and children and archives one parent occurrence", () => {
  const parent = { ...createReminder("work", "Parent", now), recurrence: "daily", dueDate: "2026-10-10", flagged: true, notes: "Keep this", tags: ["team"], attachments: [{ id: "sample-photo" }], ownerId: "sample-owner" };
  const child = { ...createReminder("work", "Child", now), parentId: parent.id }, grandchild = { ...createReminder("work", "Grandchild", now), parentId: child.id };
  const data = dataWith([parent, child, grandchild]), before = structuredClone(data);
  const result = completeReminder(data, parent.id, now);
  assert.equal(result.reminders.length, 4);
  const [active, unchangedChild, unchangedGrandchild, history] = result.reminders;
  assert.equal(active.id, parent.id);
  assert.equal(active.dueDate, "2026-10-11");
  assert.equal(active.completed, false);
  assert.equal(unchangedChild, child);
  assert.equal(unchangedGrandchild, grandchild);
  assert.notEqual(history.id, parent.id);
  assert.equal(history.parentId, null);
  assert.equal(history.dueDate, "2026-10-10");
  assert.equal(history.completed, true);
  assert.equal(history.completedAt, now.toISOString());
  for (const reminder of [active, history]) {
    assert.equal(reminder.flagged, true);
    assert.equal(reminder.notes, parent.notes);
    assert.deepEqual(reminder.tags, parent.tags);
    assert.deepEqual(reminder.attachments, parent.attachments);
    assert.equal(reminder.ownerId, parent.ownerId);
  }
  assert.notEqual(history.tags, parent.tags);
  assert.deepEqual(data, before);
  assert.ok(validateStoredData(result));
  assert.equal(completeReminder(result, history.id, now), result);
});

test("recurrence uses local calendar days across month ends, leap years and DST", () => {
  const advance = (date, recurrence, repeatInterval = 1) => {
    const r = {
      ...createReminder("work", "Repeat", now),
      dueDate: date,
      recurrence,
      repeatInterval,
    };
    return completeReminder(dataWith([r]), r.id, now).reminders[0].dueDate;
  };
  assert.equal(advance("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(advance("2028-01-31", "monthly"), "2028-02-29");
  assert.equal(advance("2028-02-29", "yearly"), "2029-02-28");
  assert.equal(advance("2026-12-31", "monthly", 2), "2027-02-28");
  assert.equal(advance("2026-03-28", "daily"), "2026-03-29");
  assert.equal(advance("2026-10-24", "daily"), "2026-10-25");
  assert.equal(advance("2026-03-25", "weekly"), "2026-04-01");
  assert.equal(advance("2026-10-10", "fortnightly"), "2026-10-24");
  assert.equal(advance("2026-01-31", "quarterly"), "2026-04-30");
  assert.equal(advance("2026-08-31", "halfyearly"), "2027-02-28");
  assert.equal(advance("2026-10-09", "weekdays"), "2026-10-12");
  assert.equal(advance("2026-10-09", "weekdays", 2), "2026-10-13");
  assert.equal(advance("2026-10-11", "weekends"), "2026-10-17");
  assert.equal(advance("2026-10-09", "weekends", 2), "2026-10-11");
});

test("storage rejects corrupt dates, duplicate IDs, missing parents, cycles and bad shapes", () => {
  const valid = seedData(now);
  assert.ok(validateStoredData(JSON.parse(JSON.stringify(valid))));
  for (const patch of [
    { dueDate: "2026-02-30" },
    { dueTime: "24:00" },
    { repeatInterval: 0 },
    { repeatInterval: 1001 },
    { repeatInterval: Number.MAX_SAFE_INTEGER },
    { priority: "critical" },
    { parentId: "missing" },
    { tags: ["team", "team"] },
    { completed: true },
    { notes: 5 },
  ]) {
    const data = structuredClone(valid);
    Object.assign(data.reminders[0], patch);
    assert.equal(validateStoredData(data), false, JSON.stringify(patch));
  }
  const duplicate = structuredClone(valid);
  duplicate.reminders.push({ ...duplicate.reminders[0] });
  assert.equal(validateStoredData(duplicate), false);
  const cycle = structuredClone(valid);
  cycle.reminders[0].parentId = cycle.reminders[0].id;
  assert.equal(validateStoredData(cycle), false);
  assert.equal(validateStoredData(null), false);
  assert.equal(validateStoredData({ lists: [], reminders: [{}] }), false);
});


test("hourly recurrence crosses midnight and preserves other fields", () => {
  const reminder = { ...createReminder("work", "Hourly", now), recurrence: "hourly", repeatInterval: 2, dueDate: "2026-10-10", dueTime: "23:30" };
  const result = completeReminder(dataWith([reminder]), reminder.id, now);
  assert.equal(result.reminders[0].dueDate, "2026-10-11");
  assert.equal(result.reminders[0].dueTime, "01:30");
  assert.equal(result.reminders[1].dueTime, "23:30");
  assert.equal(reminder.dueDate, "2026-10-10");
});

test("hourly recurrence uses reminder timezone across host zones and DST changes", () => {
  const originalZone = process.env.TZ;
  try {
    for (const hostZone of ["UTC", "Europe/London", "America/New_York"]) {
      process.env.TZ = hostZone;
      for (const [dueDate, dueTime, timeZone, expectedDate, expectedTime] of [
        ["2026-03-29", "00:30", "Europe/London", "2026-03-29", "02:30"],
        ["2026-10-25", "00:30", "Europe/London", "2026-10-25", "01:30"],
        ["2026-03-08", "01:30", "America/New_York", "2026-03-08", "03:30"],
        ["2026-11-01", "00:30", "America/New_York", "2026-11-01", "01:30"],
        ["2026-10-10", "23:30", "Asia/Kolkata", "2026-10-11", "00:30"],
        ["2026-03-29", "01:30", "Europe/London", "2026-03-29", "03:30"],
        ["2026-10-25", "01:30", "Europe/London", "2026-10-25", "01:30"],
      ]) {
        const r = { ...createReminder("work", "Sample hourly", now), dueDate, dueTime, timeZone, recurrence: "hourly" };
        const next = completeReminder(dataWith([r]), r.id, now).reminders[0];
        assert.equal(next.dueDate, expectedDate, `${hostZone} / ${timeZone} / ${dueDate}`);
        assert.equal(next.dueTime, expectedTime, `${hostZone} / ${timeZone} / ${dueDate} ${dueTime}`);
      }
    }
  } finally {
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  }
});

test("hourly DST overlap advances through both occurrences and a date edit discards stale instant", () => {
  const r = { ...createReminder("work", "Sample overlap", now), dueDate: "2026-10-25", dueTime: "00:30", timeZone: "Europe/London", recurrence: "hourly" };
  const first = completeReminder(dataWith([r]), r.id, now);
  assert.equal(first.reminders[0].dueInstant, "2026-10-25T00:30:00.000Z");
  const second = completeReminder(first, r.id, now);
  assert.equal(second.reminders[0].dueTime, "01:30");
  assert.equal(second.reminders[0].dueInstant, "2026-10-25T01:30:00.000Z");
  const third = completeReminder(second, r.id, now);
  assert.equal(third.reminders[0].dueTime, "02:30");
  assert.equal(third.reminders[0].dueInstant, "2026-10-25T02:30:00.000Z");
  const edited = { ...second.reminders[0], dueDate: "2026-10-26" };
  assert.equal(completeReminder(dataWith([edited]), r.id, now).reminders[0].dueInstant, "2026-10-26T02:30:00.000Z");
  for (const dueInstant of ["invalid", "2026-10-25", "2026-10-25T02:30:00+01:00", "2026-10-25T01:30:00Z", 5]) {
    assert.equal(validateStoredData(dataWith([{ ...r, dueInstant }])), false, String(dueInstant));
  }
  for (const dueInstant of [undefined, null, "2026-10-25T01:30:00.000Z"]) {
    assert.equal(validateStoredData(dataWith([{ ...r, dueInstant }])), true);
  }
});

test("repeat end date allows its final occurrence then ends the series with cascade", () => {
  const reminder = { ...createReminder("work", "Daily", now), recurrence: "daily", dueDate: "2026-10-10", repeatEndDate: "2026-10-11" };
  const child = { ...createReminder("work", "Child", now), parentId: reminder.id };
  const first = completeReminder(dataWith([reminder, child]), reminder.id, now);
  assert.equal(first.reminders[0].dueDate, reminder.repeatEndDate);
  const last = completeReminder(first, reminder.id, now);
  assert.equal(last.reminders.length, first.reminders.length);
  assert.ok(last.reminders.every(r => r.completed));
  assert.ok(validateStoredData(last));
});

test("optional metadata defaults and legacy storage validate at the trust boundary", () => {
  const valid = seedData(now), reminder = valid.reminders[0];
  assert.equal(reminder.url, "");
  assert.equal(reminder.repeatEndDate, null);
  assert.equal(reminder.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const legacy = structuredClone(valid);
  for (const r of legacy.reminders) for (const key of ["url", "repeatEndDate", "timeZone", "updatedAt", "createdAt"]) delete r[key];
  assert.ok(validateStoredData(legacy));
  for (const patch of [{ url: "javascript:alert(1)" }, { url: "data:text/html,hello" }, { url: "/relative" }, { url: 5 }, { repeatEndDate: "2026-02-30" }, { timeZone: "Madeup/Zone" }, { timeZone: 5 }, { updatedAt: "yesterday" }, { createdAt: 5 }, { recurrence: "arbitrary" }]) {
    const data = structuredClone(valid);
    Object.assign(data.reminders[0], patch);
    assert.equal(validateStoredData(data), false, JSON.stringify(patch));
  }
  for (const recurrence of ["hourly", "daily", "weekdays", "weekends", "weekly", "fortnightly", "monthly", "quarterly", "halfyearly", "yearly"]) {
    const data = structuredClone(valid);
    Object.assign(data.reminders[0], { recurrence, url: "https://example.com/sample", timeZone: "Europe/London" });
    assert.ok(validateStoredData(data), recurrence);
  }
});
