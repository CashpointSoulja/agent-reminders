import { createReminder, validateStoredData } from "./model.js";

const labels = { icloud: "iCloud", "google-calendar": "Google Calendar", "google-tasks": "Google Tasks" };
const fields = ["title", "notes", "url", "location", "dueDate", "dueTime", "dueInstant", "timeZone", "completed", "completedAt", "priority", "parentId"];
const fail = (code, message) => Object.assign(new Error(message), { code });
const text = (value, limit = 2048) => typeof value === "string" && value.trim().length > 0 && value.length <= limit;
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keyFor = (provider, list, id = "") => JSON.stringify([provider, list, id]);
const localListID = (provider, id) => `account-list:${provider}:${encodeURIComponent(id)}`;
const localReminderID = (provider, list, id) => `account-reminder:${provider}:${encodeURIComponent(list)}:${encodeURIComponent(id)}`;
const reminderIndexes = new WeakMap();

export const emptyAccountProvenance = () => ({ version: 1, lists: [], reminders: [] });

export function validateAccountProvenance(value) {
  if (!plain(value) || value.version !== 1 || Object.keys(value).some(key => !["version", "lists", "reminders"].includes(key)) || !Array.isArray(value.lists) || !Array.isArray(value.reminders) || value.lists.length > 1000 || value.reminders.length > 20000) return false;
  const sources = new Set(), local = new Set();
  for (const [kind, rows] of [["list", value.lists], ["reminder", value.reminders]]) for (const row of rows) {
    const allowed = ["provider", "sourceId", "localId", "base", "lastSeenAt", "missing", "etag", ...(kind === "reminder" ? ["sourceListId"] : [])];
    const allowedBase = kind === "list" ? ["name", "color", "group"] : fields;
    if (!plain(row) || Object.keys(row).some(key => !allowed.includes(key)) || !own(labels, row.provider) || !text(row.sourceId) || !text(row.localId, 20000) || (kind === "reminder" && !text(row.sourceListId)) || !timestamp(row.lastSeenAt) || !plain(row.base) || Object.keys(row.base).some(key => !allowedBase.includes(key)) || Object.values(row.base).some(value => value !== null && !["string", "boolean", "number"].includes(typeof value) || typeof value === "string" && value.length > 16384) || row.missing !== undefined && typeof row.missing !== "boolean" || row.etag !== undefined && typeof row.etag !== "string") return false;
    const source = keyFor(row.provider, kind === "list" ? row.sourceId : row.sourceListId, kind === "list" ? "" : row.sourceId);
    if (sources.has(`${kind}:${source}`) || local.has(`${kind}:${row.localId}`)) return false;
    sources.add(`${kind}:${source}`); local.add(`${kind}:${row.localId}`);
  }
  return true;
}

export function accountSourceForReminder(provenance, reminderId) {
  if (!plain(provenance)) return null;
  let index = reminderIndexes.get(provenance);
  if (!index) {
    if (!validateAccountProvenance(provenance)) return null;
    index = new Map(provenance.reminders.map(row => [row.localId, row]));
    reminderIndexes.set(provenance, index);
  }
  return index.get(reminderId) || null;
}

function validateSnapshot(snapshot, now) {
  if (!plain(snapshot) || !own(labels, snapshot.provider) || !timestamp(snapshot.generatedAt) || !Array.isArray(snapshot.lists) || !snapshot.lists.length || snapshot.lists.length > 100) throw fail("invalid_snapshot", "The account returned an invalid snapshot. No reminders were imported.");
  const lists = [], reminders = [], listIds = new Set();
  for (const list of snapshot.lists) {
    if (!plain(list) || !text(list.id) || listIds.has(list.id) || !text(list.name, 512) || list.color !== undefined && (typeof list.color !== "string" || !/^#[\da-f]{6}$/i.test(list.color)) || !Array.isArray(list.reminders)) throw fail("invalid_snapshot", "The account returned invalid lists. No reminders were imported.");
    listIds.add(list.id);
    const listId = localListID(snapshot.provider, list.id), ids = new Set(list.reminders.map(row => row?.id));
    if (ids.size !== list.reminders.length) throw fail("invalid_snapshot", "The account returned duplicate reminders. No reminders were imported.");
    lists.push({ id: listId, name: list.name, color: list.color || "#007AFF", icon: snapshot.provider === "google-calendar" ? "calendar" : "list", sections: [], group: labels[snapshot.provider] });
    for (const row of list.reminders) {
      if (!plain(row) || !["dueDate", "dueTime", "dueInstant", "completed", "completedAt"].every(field => own(row, field)) || !text(row.id) || !text(row.title, 1024) || typeof row.notes !== "string" || row.notes.length > 16384 || typeof row.url !== "string" || row.url.length > 4096 || row.etag !== undefined && (typeof row.etag !== "string" || row.etag.length > 2048) || row.parentId !== undefined && row.parentId !== null && !text(row.parentId)) throw fail("invalid_snapshot", "The account returned invalid reminders. No reminders were imported.");
      const imported = Object.fromEntries(fields.filter(field => own(row, field)).map(field => [field, row[field]]));
      imported.parentId = row.parentId && ids.has(row.parentId) ? localReminderID(snapshot.provider, list.id, row.parentId) : null;
      reminders.push({ ...createReminder(listId, row.title, now), ...imported, title: row.title, id: localReminderID(snapshot.provider, list.id, row.id) });
      if (reminders.length > 10000) throw fail("invalid_snapshot", "This account selection is too large. Select fewer lists.");
    }
  }
  if (!validateStoredData({ lists, reminders })) throw fail("invalid_snapshot", "The account returned unsupported reminder values. No reminders were imported.");
  return { lists, reminders };
}

// Three-way refresh preserves local edits; missing source rows are retained until the user removes them.
export function mergeAccountSnapshot(data, provenance, snapshot, { now = new Date() } = {}) {
  provenance ||= emptyAccountProvenance();
  if (!validateStoredData(data) || !validateAccountProvenance(provenance)) throw fail("invalid_local_data", "Account import metadata is invalid. Your reminders are unchanged.");
  const normalized = validateSnapshot(snapshot, now), provider = snapshot.provider;
  const selected = new Set(snapshot.lists.map(list => list.id));
  if (provenance.lists.some(row => row.provider === provider && selected.has(row.sourceId) && row.lastSeenAt > snapshot.generatedAt)) throw fail("stale_snapshot", "This preview is older than the latest import. Refresh it first.");
  const next = { ...data, lists: data.lists.map(row => ({ ...row })), reminders: data.reminders.map(row => ({ ...row })) };
  const metadata = { version: 1, lists: provenance.lists.map(row => ({ ...row, base: { ...row.base } })), reminders: provenance.reminders.map(row => ({ ...row, base: { ...row.base } })) };
  const conflicts = [], encountered = new Set();
  const rowMaps = { list: new Map(next.lists.map(row => [row.id, row])), reminder: new Map(next.reminders.map(row => [row.id, row])) };
  const linkMaps = { list: new Map(metadata.lists.map(row => [keyFor(row.provider, row.sourceId), row])), reminder: new Map(metadata.reminders.map(row => [keyFor(row.provider, row.sourceListId, row.sourceId), row])) };
  const normalizedReminders = new Map(normalized.reminders.map(row => [row.id, row]));
  let imported = 0, updated = 0;
  function mergeRow(kind, source, sourceListId, incoming, importedFields) {
    const rows = kind === "list" ? next.lists : next.reminders, links = kind === "list" ? metadata.lists : metadata.reminders;
    const sourceKey = keyFor(provider, kind === "list" ? source.id : sourceListId, kind === "list" ? "" : source.id);
    let link = linkMaps[kind].get(sourceKey);
    encountered.add(`${kind}:${sourceKey}`);
    let row = link && rowMaps[kind].get(link.localId);
    const fresh = Object.fromEntries(importedFields.map(field => [field, incoming[field]]));
    if (!link) {
      if (rowMaps[kind].has(incoming.id)) throw fail("id_collision", "An imported identifier conflicts with local data. No reminders were changed.");
      row = incoming; rows.push(row);
      link = { provider, sourceId: source.id, ...(kind === "reminder" ? { sourceListId } : {}), localId: row.id, base: { ...fresh }, lastSeenAt: snapshot.generatedAt, missing: false, ...(source.etag ? { etag: source.etag } : {}) };
      links.push(link);
      rowMaps[kind].set(row.id, row); linkMaps[kind].set(sourceKey, link);
      if (kind === "reminder") imported++;
    } else if (!row) {
      conflicts.push({ kind, localId: link.localId, reason: "local_deleted" });
    } else {
      let changed = false;
      for (const [field, value] of Object.entries(fresh)) {
        if (row[field] === link.base[field] || row[field] === value) {
          if (row[field] !== value) { row[field] = value; changed = true; }
          link.base[field] = value;
        } else if (value !== link.base[field]) conflicts.push({ kind, localId: row.id, field, localValue: row[field], sourceValue: value, reason: "both_changed" });
      }
      if (changed && kind === "reminder") { row.updatedAt = now.toISOString(); updated++; }
    }
    link.lastSeenAt = snapshot.generatedAt; link.missing = false;
    if (source.etag) link.etag = source.etag;
    return row;
  }
  for (const [index, list] of snapshot.lists.entries()) {
    const importedList = normalized.lists[index];
    const row = mergeRow("list", list, null, importedList, ["name", "color", "group"]);
    if (!row) continue;
    for (const source of list.reminders) {
      const incoming = normalizedReminders.get(localReminderID(provider, list.id, source.id));
      const importedFields = fields.filter(field => own(source, field) || field === "parentId");
      mergeRow("reminder", source, list.id, { ...incoming, listId: row.id }, importedFields);
    }
  }
  for (const link of metadata.reminders) if (link.provider === provider && selected.has(link.sourceListId) && !encountered.has(`reminder:${keyFor(provider, link.sourceListId, link.sourceId)}`)) link.missing = true;
  if (!validateStoredData(next) || !validateAccountProvenance(metadata)) throw fail("invalid_merge", "Account refresh conflicts with the local reminder structure. Your reminders are unchanged.");
  return { data: next, provenance: metadata, conflicts, imported, updated, missing: metadata.reminders.filter(row => row.provider === provider && selected.has(row.sourceListId) && row.missing).length };
}

export function normalizeICloudSnapshot(raw) {
  if (!plain(raw) || raw.schemaVersion !== 1 || !Number.isFinite(raw.generatedAt) || !Number.isFinite(new Date(raw.generatedAt).getTime()) || typeof raw.sample !== "boolean" || !Array.isArray(raw.selectedListIDs) || !raw.selectedListIDs.length || raw.selectedListIDs.length > 100 || raw.selectedListIDs.some(id => !text(id, 1024)) || new Set(raw.selectedListIDs).size !== raw.selectedListIDs.length || !Array.isArray(raw.lists) || !Array.isArray(raw.reminders) || raw.lists.length > 100 || raw.reminders.length > 5000) throw fail("invalid_snapshot", "The iCloud preview is invalid. No reminders were imported.");
  const selected = new Set(raw.selectedListIDs), listIds = new Set(), reminderIds = new Set();
  const date = (components) => {
    if (components == null) return { dueDate: null, dueTime: null, dueInstant: null };
    if (!plain(components) || components.calendarID != null && components.calendarID !== "gregorian" || components.era != null && components.era !== 1 || components.isLeapMonth === true || !Number.isInteger(components.year) || !Number.isInteger(components.month) || !Number.isInteger(components.day) || components.year < 1 || components.year > 9999 || components.month < 1 || components.month > 12 || components.day < 1 || components.day > 31) throw fail("invalid_snapshot", "An iCloud date cannot be represented safely.");
    const dueDate = `${String(components.year).padStart(4, "0")}-${String(components.month).padStart(2, "0")}-${String(components.day).padStart(2, "0")}`;
    const timed = components.hour != null;
    if (!timed && (components.minute != null || components.second != null) || components.floating !== undefined && typeof components.floating !== "boolean" || components.second != null && (!Number.isInteger(components.second) || components.second < 0 || components.second > 59) || timed && (!Number.isInteger(components.hour) || components.hour < 0 || components.hour > 23 || components.minute != null && (!Number.isInteger(components.minute) || components.minute < 0 || components.minute > 59))) throw fail("invalid_snapshot", "An iCloud time cannot be represented safely.");
    return { dueDate, dueTime: timed ? `${String(components.hour).padStart(2, "0")}:${String(components.minute || 0).padStart(2, "0")}` : null, dueInstant: null, ...(timed && components.timeZone ? { timeZone: components.timeZone } : {}) };
  };
  const safeUrl = value => { try { return ["http:", "https:"].includes(new URL(value).protocol) ? value : ""; } catch { return ""; } };
  const lists = raw.lists.map(list => {
    if (!plain(list) || !text(list.id, 1024) || !selected.has(list.id) || listIds.has(list.id) || !text(list.title, 512) || typeof list.writable !== "boolean") throw fail("invalid_snapshot", "The iCloud list selection is invalid.");
    listIds.add(list.id);
    return { id: list.id, name: list.title, reminders: [] };
  });
  if (listIds.size !== selected.size) throw fail("invalid_snapshot", "The iCloud list preview is incomplete.");
  for (const row of raw.reminders) {
    if (!plain(row) || !text(row.id, 1024) || reminderIds.has(row.id) || !listIds.has(row.listID) || !text(row.title, 1024) || row.notes != null && (typeof row.notes !== "string" || row.notes.length > 16384) || row.url != null && (typeof row.url !== "string" || row.url.length > 4096) || typeof row.completed !== "boolean" || !Number.isInteger(row.priority) || row.priority < 0 || row.priority > 9 || typeof row.recurring !== "boolean" || row.completionDate != null && (!Number.isFinite(row.completionDate) || !Number.isFinite(new Date(row.completionDate).getTime()))) throw fail("invalid_snapshot", "The iCloud reminder preview is invalid.");
    reminderIds.add(row.id);
    lists.find(list => list.id === row.listID).reminders.push({ id: row.id, title: row.title, notes: row.notes || "", url: safeUrl(row.url), ...date(row.due), priority: row.priority === 0 ? "none" : row.priority <= 4 ? "high" : row.priority === 5 ? "medium" : "low", completed: row.completed, completedAt: row.completed ? new Date(row.completionDate ?? raw.generatedAt).toISOString() : null, parentId: null });
  }
  const snapshot = { provider: "icloud", generatedAt: new Date(raw.generatedAt).toISOString(), sample: raw.sample, lists };
  validateSnapshot(snapshot, new Date(raw.generatedAt));
  return snapshot;
}
