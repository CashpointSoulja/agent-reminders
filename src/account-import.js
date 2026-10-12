import { createReminder, validateStoredData } from "./model.js";

const labels = { icloud: "iCloud", "google-calendar": "Google Calendar", "google-tasks": "Google Tasks" };
const fields = ["title", "notes", "url", "location", "dueDate", "dueTime", "dueInstant", "timeZone", "completed", "completedAt", "priority", "parentId", "sectionId"];
const fail = (code, message) => Object.assign(new Error(message), { code });
const text = (value, limit = 2048) => typeof value === "string" && value.trim().length > 0 && value.length <= limit;
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nativeID = value => typeof value === "string" && /^(?:x-apple-reminderkit:\/\/REM(?:List|Reminder|ListSection)\/)?[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value) ? value.slice(-36).toLowerCase() : value;
const sourceID = (provider, value) => provider === "icloud" ? nativeID(value) : value;
const keyFor = (provider, list, id = "") => JSON.stringify([provider, sourceID(provider, list), sourceID(provider, id)]);
const localListID = (provider, id) => `account-list:${provider}:${encodeURIComponent(id)}`;
const localReminderID = (provider, list, id) => `account-reminder:${provider}:${encodeURIComponent(list)}:${encodeURIComponent(id)}`;
const localSectionID = (provider, list, id) => `account-section:${provider}:${encodeURIComponent(list)}:${encodeURIComponent(id)}`;
const same = (first, second) => JSON.stringify(first) === JSON.stringify(second);
const validSections = (rows, idLimit = 1024) => Array.isArray(rows) && rows.length <= 200 && rows.every(row => plain(row) && Object.keys(row).every(key => ["id", "name"].includes(key)) && text(row.id, idLimit) && text(row.name, 200)) && new Set(rows.map(row => row.id)).size === rows.length;
const reminderIndexes = new WeakMap();

export const emptyAccountProvenance = () => ({ version: 1, lists: [], reminders: [] });

export function validateAccountProvenance(value) {
  if (!plain(value) || value.version !== 1 || Object.keys(value).some(key => !["version", "lists", "reminders"].includes(key)) || !Array.isArray(value.lists) || !Array.isArray(value.reminders) || value.lists.length > 1000 || value.reminders.length > 20000) return false;
  const sources = new Set(), local = new Set();
  for (const [kind, rows] of [["list", value.lists], ["reminder", value.reminders]]) for (const row of rows) {
    const allowed = ["provider", "sourceId", "localId", "base", "lastSeenAt", "missing", "etag", ...(kind === "reminder" ? ["sourceListId", "order"] : [])];
    const allowedBase = kind === "list" ? ["name", "color", "group", "sections"] : fields;
    if (!plain(row) || Object.keys(row).some(key => !allowed.includes(key)) || !own(labels, row.provider) || !text(row.sourceId) || !text(row.localId, 20000) || (kind === "reminder" && !text(row.sourceListId)) || !timestamp(row.lastSeenAt) || !plain(row.base) || Object.keys(row.base).some(key => !allowedBase.includes(key)) || Object.entries(row.base).some(([key, value]) => key === "sections" ? !validSections(value, 20000) : value !== null && !["string", "boolean", "number"].includes(typeof value) || typeof value === "string" && value.length > 16384) || row.missing !== undefined && typeof row.missing !== "boolean" || row.etag !== undefined && typeof row.etag !== "string" || row.order !== undefined && (!Number.isInteger(row.order) || row.order < 0 || row.order > 10000)) return false;
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
    if (!plain(list) || !text(list.id) || listIds.has(list.id) || !text(list.name, 512) || list.color !== undefined && (typeof list.color !== "string" || !/^#[\da-f]{6}$/i.test(list.color)) || !Array.isArray(list.reminders) || list.sections !== undefined && !validSections(list.sections)) throw fail("invalid_snapshot", "The account returned invalid lists. No reminders were imported.");
    listIds.add(list.id);
    const listId = localListID(snapshot.provider, list.id), ids = new Set(list.reminders.map(row => row?.id));
    if (ids.size !== list.reminders.length) throw fail("invalid_snapshot", "The account returned duplicate reminders. No reminders were imported.");
    const sectionIDs = new Set((list.sections || []).map(section => section.id));
    lists.push({ id: listId, name: list.name, color: list.color || "#007AFF", icon: snapshot.provider === "google-calendar" ? "calendar" : "list", sections: (list.sections || []).map(section => ({ id: localSectionID(snapshot.provider, list.id, section.id), name: section.name })), group: labels[snapshot.provider] });
    for (const row of list.reminders) {
      if (!plain(row) || !["dueDate", "dueTime", "dueInstant", "completed", "completedAt"].every(field => own(row, field)) || !text(row.id) || !text(row.title, 1024) || typeof row.notes !== "string" || row.notes.length > 16384 || typeof row.url !== "string" || row.url.length > 4096 || row.etag !== undefined && (typeof row.etag !== "string" || row.etag.length > 2048) || row.parentId !== undefined && row.parentId !== null && !text(row.parentId)) throw fail("invalid_snapshot", "The account returned invalid reminders. No reminders were imported.");
      const imported = Object.fromEntries(fields.filter(field => own(row, field)).map(field => [field, row[field]]));
      imported.parentId = row.parentId && ids.has(row.parentId) ? localReminderID(snapshot.provider, list.id, row.parentId) : null;
      if (own(row, "sectionId")) {
        if (row.sectionId !== null && (!text(row.sectionId, 1024) || !sectionIDs.has(row.sectionId))) throw fail("invalid_snapshot", "An imported reminder refers to an unavailable section. No reminders were imported.");
        imported.sectionId = row.sectionId === null ? null : localSectionID(snapshot.provider, list.id, row.sectionId);
      }
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
  const selected = new Set(snapshot.lists.map(list => sourceID(provider, list.id)));
  if (provenance.lists.some(row => row.provider === provider && selected.has(sourceID(provider, row.sourceId)) && row.lastSeenAt > snapshot.generatedAt)) throw fail("stale_snapshot", "This preview is older than the latest import. Refresh it first.");
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
      link = { provider, sourceId: source.id, ...(kind === "reminder" ? { sourceListId } : {}), localId: row.id, base: { ...fresh, ...(fresh.sections ? { sections: fresh.sections.map(section => ({ ...section })) } : {}) }, lastSeenAt: snapshot.generatedAt, missing: false, ...(source.etag ? { etag: source.etag } : {}) };
      links.push(link);
      rowMaps[kind].set(row.id, row); linkMaps[kind].set(sourceKey, link);
      if (kind === "reminder") imported++;
    } else if (!row) {
      conflicts.push({ kind, localId: link.localId, reason: "local_deleted" });
    } else {
      let changed = false;
      for (const [field, value] of Object.entries(fresh)) {
        if (field === "sections") {
          const base = link.base.sections || [], current = row.sections, old = new Map(base.map(section => [section.id, section]));
          const byID = new Map(current.map(section => [section.id, { ...section }]));
          for (const section of value) {
            const existing = byID.get(section.id);
            if (!existing) byID.set(section.id, { ...section });
            else if (existing.name === old.get(section.id)?.name || existing.name === section.name) existing.name = section.name;
            else if (section.name !== old.get(section.id)?.name) conflicts.push({ kind, localId: row.id, field: "sections", reason: "both_changed" });
          }
          const oldIDs = new Set(base.map(section => section.id));
          const localOrder = current.filter(section => oldIDs.has(section.id)).map(section => section.id);
          const baseOrder = base.filter(section => byID.has(section.id)).map(section => section.id);
          const reorderedLocally = !same(localOrder, baseOrder);
          if (reorderedLocally && !same(value.map(section => section.id), base.map(section => section.id))) conflicts.push({ kind, localId: row.id, field: "sections", reason: "both_changed" });
          const order = reorderedLocally ? [...current.map(section => section.id), ...value.filter(section => !current.some(existing => existing.id === section.id)).map(section => section.id)] : [...value.map(section => section.id), ...current.filter(section => !value.some(incoming => incoming.id === section.id)).map(section => section.id)];
          row.sections = order.map(id => byID.get(id));
          link.base.sections = value.map(section => ({ ...section }));
        } else if (same(row[field], link.base[field]) || same(row[field], value) || !own(link.base, field) && row[field] == null) {
          if (!same(row[field], value)) { row[field] = value; changed = true; }
          link.base[field] = value;
        } else if (!same(value, link.base[field])) conflicts.push({ kind, localId: row.id, field, localValue: row[field], sourceValue: value, reason: "both_changed" });
      }
      if (changed && kind === "reminder") { row.updatedAt = now.toISOString(); updated++; }
    }
    link.lastSeenAt = snapshot.generatedAt; link.missing = false;
    if (source.etag) link.etag = source.etag;
    return row;
  }
  for (const [index, list] of snapshot.lists.entries()) {
    const importedList = normalized.lists[index];
    const oldLinks = provenance.reminders.filter(link => link.provider === provider && sourceID(provider, link.sourceListId) === sourceID(provider, list.id));
    const oldIDs = new Set(oldLinks.map(link => link.localId));
    const oldOrder = data.reminders.filter(item => oldIDs.has(item.id)).map(item => item.id);
    const baseOrder = oldLinks.filter(link => oldOrder.includes(link.localId)).sort((a, b) => a.order - b.order).map(link => link.localId);
    const reorderedLocally = oldLinks.every(link => link.order !== undefined) && !same(oldOrder, baseOrder);
    const row = mergeRow("list", list, null, importedList, ["name", "color", "group", ...(own(list, "sections") ? ["sections"] : [])]);
    if (!row) continue;
    for (const [order, source] of list.reminders.entries()) {
      const incoming = normalizedReminders.get(localReminderID(provider, list.id, source.id));
      const importedFields = fields.filter(field => own(source, field) || field === "parentId");
      mergeRow("reminder", source, list.id, { ...incoming, listId: row.id }, importedFields);
      linkMaps.reminder.get(keyFor(provider, list.id, source.id)).order = order;
    }
    if (own(list, "sections")) {
      const oldSections = new Map((provenance.lists.find(link => link.provider === provider && keyFor(provider, link.sourceId) === keyFor(provider, list.id))?.base.sections || []).map(section => [section.id, section]));
      const incomingIDs = new Set(importedList.sections.map(section => section.id));
      const referencedIDs = new Set(next.reminders.filter(item => item.listId === row.id).map(item => item.sectionId));
      row.sections = row.sections.filter(section => incomingIDs.has(section.id) || !oldSections.has(section.id) || section.name !== oldSections.get(section.id).name || referencedIDs.has(section.id));
    }
    const sourceIDs = list.reminders.map(source => linkMaps.reminder.get(keyFor(provider, list.id, source.id)).localId);
    if (!reorderedLocally) {
      const sourceSet = new Set(sourceIDs), orderedRows = sourceIDs.map(id => rowMaps.reminder.get(id)).filter(Boolean);
      let position = 0;
      next.reminders = next.reminders.map(item => sourceSet.has(item.id) ? orderedRows[position++] : item);
    } else if (!same(oldOrder, sourceIDs.filter(id => oldIDs.has(id)))) conflicts.push({ kind: "list", localId: row.id, field: "order", reason: "both_changed" });
  }
  for (const link of metadata.reminders) if (link.provider === provider && selected.has(sourceID(provider, link.sourceListId)) && !encountered.has(`reminder:${keyFor(provider, link.sourceListId, link.sourceId)}`)) link.missing = true;
  if (!validateStoredData(next) || !validateAccountProvenance(metadata)) throw fail("invalid_merge", "Account refresh conflicts with the local reminder structure. Your reminders are unchanged.");
  return { data: next, provenance: metadata, conflicts, imported, updated, missing: metadata.reminders.filter(row => row.provider === provider && selected.has(sourceID(provider, row.sourceListId)) && row.missing).length };
}

export function normalizeICloudSnapshot(raw) {
  if (!plain(raw) || raw.schemaVersion !== 1 || !Number.isFinite(raw.generatedAt) || !Number.isFinite(new Date(raw.generatedAt).getTime()) || typeof raw.sample !== "boolean" || !Array.isArray(raw.selectedListIDs) || !raw.selectedListIDs.length || raw.selectedListIDs.length > 100 || raw.selectedListIDs.some(id => !text(id, 1024)) || new Set(raw.selectedListIDs).size !== raw.selectedListIDs.length || !Array.isArray(raw.lists) || !Array.isArray(raw.reminders) || raw.lists.length > 100 || raw.reminders.length > 5000) throw fail("invalid_snapshot", "The iCloud preview is invalid. No reminders were imported.");
  const selected = new Set(raw.selectedListIDs.map(nativeID)), listIds = new Set(), reminderIds = new Set();
  if (selected.size !== raw.selectedListIDs.length) throw fail("invalid_snapshot", "The iCloud preview repeats a list identifier.");
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
    if (!plain(list) || !text(list.id, 1024) || !selected.has(nativeID(list.id)) || listIds.has(nativeID(list.id)) || !text(list.title, 512) || typeof list.writable !== "boolean") throw fail("invalid_snapshot", "The iCloud list selection is invalid.");
    listIds.add(nativeID(list.id));
    if (list.sections !== undefined && (!Array.isArray(list.sections) || !validSections(list.sections.map(section => plain(section) ? { id: section.id, name: section.title } : section)))) throw fail("invalid_snapshot", "The iCloud sections are invalid.");
    return { id: nativeID(list.id), name: list.title, ...(list.sections !== undefined ? { sections: list.sections.map(section => ({ id: nativeID(section.id), name: section.title })) } : {}), reminders: [] };
  });
  if (listIds.size !== selected.size) throw fail("invalid_snapshot", "The iCloud list preview is incomplete.");
  for (const row of raw.reminders) {
    if (!plain(row) || !text(row.id, 1024) || reminderIds.has(nativeID(row.id)) || !listIds.has(nativeID(row.listID)) || !text(row.title, 1024) || row.notes != null && (typeof row.notes !== "string" || row.notes.length > 16384) || row.url != null && (typeof row.url !== "string" || row.url.length > 4096) || typeof row.completed !== "boolean" || !Number.isInteger(row.priority) || row.priority < 0 || row.priority > 9 || typeof row.recurring !== "boolean" || row.completionDate != null && (!Number.isFinite(row.completionDate) || !Number.isFinite(new Date(row.completionDate).getTime()))) throw fail("invalid_snapshot", "The iCloud reminder preview is invalid.");
    reminderIds.add(nativeID(row.id));
    lists.find(list => list.id === nativeID(row.listID)).reminders.push({ id: nativeID(row.id), title: row.title, notes: row.notes || "", url: safeUrl(row.url), ...date(row.due), priority: row.priority === 0 ? "none" : row.priority <= 4 ? "high" : row.priority === 5 ? "medium" : "low", completed: row.completed, completedAt: row.completed ? new Date(row.completionDate ?? raw.generatedAt).toISOString() : null, parentId: null, ...(own(row, "sectionID") ? { sectionId: nativeID(row.sectionID) } : {}) });
  }
  const snapshot = { provider: "icloud", generatedAt: new Date(raw.generatedAt).toISOString(), sample: raw.sample, lists };
  validateSnapshot(snapshot, new Date(raw.generatedAt));
  return snapshot;
}
