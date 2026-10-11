import { createReminder } from './model.js';

export function createSubtask(parent, title) {
  return { ...createReminder(parent.listId, ''), title: title.trim(), parentId: parent.id, sectionId: parent.sectionId || null, dueDate: null, dueTime: null, attachments: [] };
}

// Replace only this parent's direct children; preserve descendant metadata and array order.
export function mergeSubtasks(reminders, parent, subtasks) {
  const ids = new Set();
  const existing = new Map(reminders.map(row => [row.id, row]));
  const children = subtasks.filter(row => row.title.trim()).map(row => {
    if (!row.id || row.id === parent.id || ids.has(row.id)) throw Error('Invalid subtask identity.');
    const previous = existing.get(row.id);
    if (previous && previous.parentId !== parent.id) throw Error('Subtask belongs to another parent.');
    ids.add(row.id);
    return { ...row, title: row.title.trim(), parentId: parent.id, listId: parent.listId, sectionId: parent.sectionId || null };
  });
  const removed = new Set(reminders.filter(row => row.parentId === parent.id && !ids.has(row.id)).map(row => row.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of reminders) if (removed.has(row.parentId) && !removed.has(row.id)) { removed.add(row.id); changed = true; }
  }
  const byId = new Map(children.map(row => [row.id, row]));
  const result = reminders.filter(row => !removed.has(row.id)).map(row => byId.get(row.id) || row);
  for (const row of children) if (!existing.has(row.id)) result.push(row);
  return result;
}
