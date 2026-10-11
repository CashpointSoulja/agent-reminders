import { validSmartFilters, matchesSmartFilters } from "./smartFilters.js";
import { shoppingCategories, shoppingItemKey } from "./shopping.js";
import { validListIcon } from "./emoji.js";
import { nextPatternDate, validRepeatPattern } from "./repeat-pattern.js";
const dateKey = (date) =>
  `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const localDate = (value) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};
const id = () => globalThis.crypto.randomUUID();
const priorities = ["none", "low", "medium", "high"];
const repeats = [
  "none",
  "hourly",
  "daily",
  "weekdays",
  "weekends",
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "halfyearly",
  "yearly",
];
const validDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  dateKey(localDate(value)) === value;
const validTime = (value) =>
  typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const validUrl = (value) => {
  if (value === "") return true;
  if (typeof value !== "string") return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const validTimeZone = (value) => {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

// shortcut: only explicit English date tokens are inferred; expand with evidence of more parser rules.
export function parseTitle(input, now = new Date()) {
  let title = input.trim(),
    dueDate = null,
    dueTime = null;
  const match = title.match(
    /\b(today|tomorrow|next (sunday|monday|tuesday|wednesday|thursday|friday|saturday)|\d{4}-\d{2}-\d{2})\b/i,
  );
  if (match) {
    const token = match[0].toLowerCase(),
      date = new Date(now);
    if (token === "today" || token === "tomorrow") {
      date.setDate(date.getDate() + (token === "tomorrow" ? 1 : 0));
      dueDate = dateKey(date);
    } else if (token.startsWith("next ")) {
      const day = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ].indexOf(match[2].toLowerCase());
      date.setDate(date.getDate() + ((day - date.getDay() + 7) % 7 || 7));
      dueDate = dateKey(date);
    } else if (validDate(token)) dueDate = token;
    if (dueDate)
      title =
        title.slice(0, match.index) +
        title.slice(match.index + match[0].length);
  }
  const time = title.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (time) {
    let hour = Number(time[1]);
    const minute = Number(time[2] || 0),
      period = time[3]?.toLowerCase();
    if (minute < 60 && (period ? hour >= 1 && hour <= 12 : hour <= 23)) {
      if (period) hour = (hour % 12) + (period === "pm" ? 12 : 0);
      dueTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      dueDate ||= dateKey(now);
      title =
        title.slice(0, time.index) + title.slice(time.index + time[0].length);
    }
  }
  return {
    title: title.replace(/\s+/g, " ").trim() || input.trim(),
    dueDate,
    dueTime,
  };
}

export function createReminder(listId, title, now = new Date()) {
  return {
    id: id(),
    listId,
    ...parseTitle(title, now),
    notes: "",
    url: "",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dueInstant: null,
    repeatEndDate: null,
    completed: false,
    completedAt: null,
    flagged: false,
    urgent: false,
    priority: "none",
    recurrence: "none",
    repeatInterval: 1,
    earlyMinutes: 0,
    location: "",
    tags: [],
    parentId: null,
    sectionId: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function seedData(now = new Date()) {
  const lists = [
    {
      id: "work",
      name: "Work",
      color: "#FF9500",
      icon: "briefcase",
      sections: [],
    },
    {
      id: "personal",
      name: "Personal",
      color: "#007AFF",
      icon: "person",
      sections: [],
    },
    {
      id: "shopping",
      name: "Shopping",
      color: "#34C759",
      icon: "cart",
      sections: [],
    },
  ];
  const reminders = [
    createReminder("work", "Prepare project update tomorrow at 9am", now),
    createReminder("personal", "Book a dentist appointment", now),
    createReminder("shopping", "Pick up fresh fruit", now),
  ];
  reminders[0].flagged = true;
  reminders[0].tags = ["work"];
  return { lists, reminders };
}

export function counts(data, now = new Date()) {
  const active = data.reminders.filter((r) => !r.completed),
    today = dateKey(now);
  return {
    today: active.filter((r) => r.dueDate && r.dueDate <= today).length,
    scheduled: active.filter((r) => r.dueDate).length,
    all: active.length,
    flagged: active.filter((r) => r.flagged).length,
    completed: data.reminders.length - active.length,
    urgent: active.filter((r) => r.urgent).length,
  };
}

export function selectReminders(
  data,
  viewId,
  {
    query = "",
    tag = "",
    sort = "manual",
    group = "none",
    showCompleted = false,
  } = {},
  now = new Date(),
) {
  const today = dateKey(now),
    search = query.trim().toLowerCase(),
    smartList = data.lists.find((l) => l.id === viewId && l.type === "smart");
  const selected = data.reminders.filter((r) => {
    if (viewId === "completed" ? !r.completed : !showCompleted && r.completed)
      return false;
    if (viewId === "today" && (!r.dueDate || r.dueDate > today)) return false;
    if (viewId === "scheduled" && !r.dueDate) return false;
    if (viewId === "flagged" && !r.flagged) return false;
    if (viewId === "urgent" && !r.urgent) return false;
    if (
      !["today", "scheduled", "all", "flagged", "completed", "urgent"].includes(
        viewId,
      ) &&
      !smartList &&
      r.listId !== viewId
    )
      return false;
    return (
      (!smartList || matchesSmartFilters(r, smartList.filters, now)) &&
      (!tag || r.tags.includes(tag)) &&
      (!search ||
        `${r.title} ${r.notes} ${r.tags.join(" ")}`
          .toLowerCase()
          .includes(search))
    );
  });
  const groupKey = (r) =>
    group === "list"
      ? r.listId
      : group === "date"
        ? r.dueDate || "9999"
        : group === "priority"
          ? String(3 - priorities.indexOf(r.priority))
          : group === "section"
            ? r.sectionId || ""
            : "";
  const compare = (a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "priority"
        ? priorities.indexOf(b.priority) - priorities.indexOf(a.priority)
        : sort === "dueDate" || sort === "date"
          ? `${a.dueDate || "9999"} ${a.dueTime || "23:59"}`.localeCompare(
              `${b.dueDate || "9999"} ${b.dueTime || "23:59"}`,
            )
          : sort === "createdAt" || sort === "created"
            ? (a.createdAt || "").localeCompare(b.createdAt || "")
            : 0;
  return selected.sort(
    (a, b) => groupKey(a).localeCompare(groupKey(b)) || compare(a, b),
  );
}

export function descendants(reminders, rootId) {
  const found = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of reminders)
      if (found.has(r.parentId) && !found.has(r.id)) {
        found.add(r.id);
        changed = true;
      }
  }
  return found;
}

function nextDue(reminder, now) {
  const date = localDate(reminder.dueDate || dateKey(now)),
    interval = reminder.repeatInterval;
  const patternedDate = nextPatternDate(reminder);
  if (patternedDate) return { dueDate: patternedDate, dueTime: reminder.dueTime, dueInstant: null };
  if (reminder.recurrence === "hourly") {
    const timeZone =
      reminder.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = (timestamp) =>
      Object.fromEntries(
        formatter
          .formatToParts(timestamp)
          .map(({ type, value }) => [type, value]),
      );
    const wallTime = (timestamp) => {
      const p = parts(timestamp);
      return Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        Number(p.hour),
        Number(p.minute),
      );
    };
    const current = parts(now),
      [year, month, day] = (
        reminder.dueDate || `${current.year}-${current.month}-${current.day}`
      )
        .split("-")
        .map(Number),
      [hour, minute] = (reminder.dueTime || `${current.hour}:${current.minute}`)
        .split(":")
        .map(Number),
      target = Date.UTC(year, month - 1, day, hour, minute);
    const candidates = [-86400000, 0, 86400000].map((offset) => {
      const probe = target + offset;
      return target - (wallTime(probe) - probe);
    });
    // shortcut: choose the earlier overlap or shift a missing clock time forward; native DST choices need verification.
    const matching = candidates.filter(
        (timestamp) => wallTime(timestamp) === target,
      ),
      savedInstant = Date.parse(reminder.dueInstant),
      start =
        Number.isFinite(savedInstant) && wallTime(savedInstant) === target
          ? savedInstant
          : matching.length
            ? Math.min(...matching)
            : Math.max(...candidates),
      nextInstant = start + interval * 60 * 60 * 1000,
      next = parts(nextInstant);
    return {
      dueDate: `${next.year}-${next.month}-${next.day}`,
      dueTime: `${next.hour}:${next.minute}`,
      dueInstant: new Date(nextInstant).toISOString(),
    };
  }
  const days = { daily: 1, weekly: 7, fortnightly: 14 };
  if (days[reminder.recurrence])
    date.setDate(date.getDate() + interval * days[reminder.recurrence]);
  else if (["weekdays", "weekends"].includes(reminder.recurrence)) {
    for (let count = 0; count < interval;) {
      date.setDate(date.getDate() + 1);
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      if (weekend === (reminder.recurrence === "weekends")) count++;
    }
  } else {
    const day = date.getDate();
    date.setDate(1);
    const months = { monthly: 1, quarterly: 3, halfyearly: 6 };
    if (months[reminder.recurrence])
      date.setMonth(date.getMonth() + interval * months[reminder.recurrence]);
    else date.setFullYear(date.getFullYear() + interval);
    date.setDate(
      Math.min(
        day,
        new Date(date.getFullYear(), date.getMonth() + 1, 0, 12).getDate(),
      ),
    );
  }
  return {
    dueDate: dateKey(date),
    dueTime: reminder.dueTime,
    dueInstant: null,
  };
}

export function completeReminder(data, reminderId, now = new Date()) {
  const root = data.reminders.find((r) => r.id === reminderId);
  if (!root || root.completed) return data;
  const timestamp = now.toISOString();
  if (root.recurrence !== "none") {
    const next = nextDue(root, now);
    if (!root.repeatEndDate || next.dueDate <= root.repeatEndDate) {
      // shortcut: recurring child history is detached; verify native parent ownership before claiming parity.
      const history = {
        ...root,
        id: id(),
        parentId: null,
        tags: [...root.tags],
        completed: true,
        completedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      return {
        ...data,
        reminders: [
          ...data.reminders.map((r) =>
            r.id === root.id ? { ...r, ...next, updatedAt: timestamp } : r,
          ),
          history,
        ],
      };
    }
    // shortcut: ending a series completes its descendants; native end-date cascade remains unverified.
  }
  const affected = descendants(data.reminders, reminderId);
  return {
    ...data,
    reminders: data.reminders.map((r) =>
      affected.has(r.id)
        ? {
            ...r,
            completed: true,
            completedAt: timestamp,
            updatedAt: timestamp,
          }
        : r,
    ),
  };
}

export function reopenReminder(data, reminderId, now = new Date()) {
  const root = data.reminders.find((r) => r.id === reminderId);
  if (!root || !root.completed) return data;
  const affected = descendants(data.reminders, reminderId),
    timestamp = now.toISOString();
  return {
    ...data,
    reminders: data.reminders.map((r) =>
      affected.has(r.id)
        ? { ...r, completed: false, completedAt: null, updatedAt: timestamp }
        : r,
    ),
  };
}

export function deleteReminder(data, reminderId) {
  const affected = descendants(data.reminders, reminderId);
  return {
    ...data,
    reminders: data.reminders.filter((r) => !affected.has(r.id)),
  };
}

export function validateStoredData(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray(raw.lists) ||
    !Array.isArray(raw.reminders)
  )
    return false;
  const string = (value) => typeof value === "string",
    nonempty = (value) => string(value) && value.trim().length > 0;
  if (raw.templates !== undefined) {
    if (!Array.isArray(raw.templates) || raw.templates.length > 100)
      return false;
    const templateIds = new Set();
    for (const template of raw.templates) {
      if (
        !template ||
        !nonempty(template.id) ||
        templateIds.has(template.id) ||
        !nonempty(template.name) ||
        !template.list ||
        !Array.isArray(template.reminders) ||
        template.reminders.length > 1000 ||
        template.templates !== undefined ||
        !validateStoredData({
          lists: [template.list],
          reminders: template.reminders,
        }) ||
        template.reminders.some(
          (r) => r.attachments !== undefined || r.assignedTo != null,
        )
      )
        return false;
      templateIds.add(template.id);
    }
  }
  const listIds = new Set(),
    reminderIds = new Set(),
    sectionIds = new Map();
  for (const list of raw.lists) {
    if (
      !list ||
      !nonempty(list.id) ||
      listIds.has(list.id) ||
      !nonempty(list.name) ||
      !nonempty(list.color) ||
      !validListIcon(list.icon) ||
      !Array.isArray(list.sections) ||
      (list.type !== undefined &&
        !["standard", "shopping", "smart"].includes(list.type)) ||
      (list.type === "smart" && !validSmartFilters(list.filters)) ||
      (list.filters !== undefined && !validSmartFilters(list.filters))
    )
      return false;
    const ids = new Set();
    for (const section of list.sections) {
      if (
        !section ||
        !nonempty(section.id) ||
        !nonempty(section.name) ||
        ids.has(section.id) ||
        (section.shoppingCategory !== undefined && !shoppingCategories.some(category => category.id === section.shoppingCategory))
      )
        return false;
      ids.add(section.id);
    }
    if (list.shoppingOverrides !== undefined && (
      !Array.isArray(list.shoppingOverrides) || list.shoppingOverrides.length > 1000 ||
      list.shoppingOverrides.some(choice => !choice || !nonempty(choice.title) || choice.title.length > 1000 || shoppingItemKey(choice.title) !== choice.title || !(choice.sectionId === null || ids.has(choice.sectionId))) ||
      new Set(list.shoppingOverrides.map(choice => choice.title)).size !== list.shoppingOverrides.length
    )) return false;
    listIds.add(list.id);
    sectionIds.set(list.id, ids);
  }
  for (const r of raw.reminders) {
    if (
      !r ||
      !nonempty(r.id) ||
      reminderIds.has(r.id) ||
      !listIds.has(r.listId) ||
      !nonempty(r.title) ||
      !string(r.notes) ||
      !string(r.location) ||
      !["completed", "flagged", "urgent"].every(
        (key) => typeof r[key] === "boolean",
      ) ||
      !priorities.includes(r.priority) ||
      !repeats.includes(r.recurrence) ||
      !Number.isInteger(r.repeatInterval) ||
      r.repeatInterval < 1 ||
      r.repeatInterval > 1000 ||
      (r.repeatCustom !== undefined && typeof r.repeatCustom !== "boolean") ||
      !validRepeatPattern(r.repeatPattern, r.recurrence) ||
      (r.repeatPattern != null && !r.dueDate) ||
      !Number.isInteger(r.earlyMinutes) ||
      r.earlyMinutes < 0 ||
      !(r.dueDate === null || validDate(r.dueDate)) ||
      !(r.dueTime === null || validTime(r.dueTime)) ||
      (r.dueTime && !r.dueDate) ||
      !Array.isArray(r.tags) ||
      !r.tags.every(nonempty) ||
      new Set(r.tags).size !== r.tags.length ||
      !(r.parentId === null || nonempty(r.parentId)) ||
      !(r.sectionId === null || sectionIds.get(r.listId).has(r.sectionId)) ||
      (r.shoppingCategoryManual !== undefined && typeof r.shoppingCategoryManual !== "boolean") ||
      (r.shoppingCategoryChoice !== undefined && r.shoppingCategoryChoice !== null && !shoppingCategories.some(category => category.id === r.shoppingCategoryChoice)) ||
      (r.shoppingNewSectionName !== undefined && (!nonempty(r.shoppingNewSectionName) || r.shoppingNewSectionName.length > 200)) ||
      (r.createdAt !== undefined &&
        (!string(r.createdAt) || !Number.isFinite(Date.parse(r.createdAt)))) ||
      (r.updatedAt !== undefined &&
        (!string(r.updatedAt) || !Number.isFinite(Date.parse(r.updatedAt)))) ||
      (r.repeatEndDate !== undefined &&
        r.repeatEndDate !== null &&
        !validDate(r.repeatEndDate)) ||
      (r.url !== undefined && !validUrl(r.url)) ||
      (r.timeZone !== undefined && !validTimeZone(r.timeZone)) ||
      (r.dueInstant !== undefined &&
        r.dueInstant !== null &&
        (!string(r.dueInstant) ||
          !Number.isFinite(Date.parse(r.dueInstant)) ||
          new Date(r.dueInstant).toISOString() !== r.dueInstant)) ||
      (r.completed
        ? !string(r.completedAt) || !Number.isFinite(Date.parse(r.completedAt))
        : r.completedAt !== null)
    )
      return false;
    reminderIds.add(r.id);
  }
  const byId = new Map(raw.reminders.map((r) => [r.id, r]));
  for (const r of raw.reminders) {
    const seen = new Set([r.id]);
    let parentId = r.parentId;
    while (parentId !== null) {
      const parent = byId.get(parentId);
      if (!parent || parent.listId !== r.listId || seen.has(parentId))
        return false;
      seen.add(parentId);
      parentId = parent.parentId;
    }
  }
  return true;
}
