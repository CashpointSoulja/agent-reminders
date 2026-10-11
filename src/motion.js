export function subtreeIds(reminders, rootId) {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const reminder of reminders) {
      if (ids.has(reminder.parentId) && !ids.has(reminder.id)) {
        ids.add(reminder.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function previousSibling(reminders, reminder) {
  const siblings = reminders.filter(r => r.listId === reminder.listId && r.parentId === reminder.parentId);
  return siblings[siblings.findIndex(r => r.id === reminder.id) - 1] || null;
}

export function rowDropZone(y, { y: top, height }) {
  const edge = Math.min(12, height * 0.2);
  return y < top + edge ? 'before' : y >= top + height - edge ? 'after' : 'nest';
}

export function rowDropChange(reminders, id, targetId, zone) {
  const target = reminders.find(r => r.id === targetId);
  if (!target) return null;
  if (zone === 'nest') return { id, parentId: target.id };
  return { id, parentId: target.parentId, ...(zone === 'before' ? { beforeId: target.id } : { afterId: target.id }) };
}

export function moveReminder(data, { id, parentId = null, beforeId = null, afterId = null }) {
  const root = data.reminders.find(r => r.id === id);
  if (!root || !(parentId === null || typeof parentId === 'string')) return data;
  const ids = subtreeIds(data.reminders, id);
  const parent = parentId === null ? null : data.reminders.find(r => r.id === parentId);
  const before = beforeId === null ? null : data.reminders.find(r => r.id === beforeId);
  const after = afterId === null ? null : data.reminders.find(r => r.id === afterId);
  if (parentId !== null && (!parent || parent.listId !== root.listId || ids.has(parentId))) return data;
  if (beforeId !== null && (!before || ids.has(beforeId) || before.listId !== root.listId || before.parentId !== parentId)) return data;
  if (afterId !== null && (beforeId !== null || !after || ids.has(afterId) || after.listId !== root.listId || after.parentId !== parentId)) return data;
  const remaining = data.reminders.filter(r => !ids.has(r.id));
  const sectionId = parent ? parent.sectionId : before ? before.sectionId : after ? after.sectionId : root.sectionId;
  const moved = data.reminders.filter(r => ids.has(r.id)).map(r => ({ ...r, sectionId, ...(r.id === id ? { parentId } : {}) }));
  let index = before ? remaining.findIndex(r => r.id === before.id) : remaining.length;
  if (after) {
    const targetIds = subtreeIds(remaining, after.id);
    index = remaining.findLastIndex(r => targetIds.has(r.id)) + 1;
  } else if (!before) {
    const anchorId = parent?.id || (root.parentId && parentId === null ? root.parentId : null);
    const anchorIds = anchorId ? subtreeIds(remaining, anchorId) : new Set(remaining.filter(r => r.listId === root.listId).map(r => r.id));
    const last = remaining.findLastIndex(r => anchorIds.has(r.id));
    if (last >= 0) index = last + 1;
  }
  return { ...data, reminders: [...remaining.slice(0, index), ...moved, ...remaining.slice(index)] };
}
