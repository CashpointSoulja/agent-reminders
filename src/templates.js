import { selectReminders } from "./model.js";
const clone = (value) => structuredClone(value);
const freshId = () => globalThis.crypto.randomUUID();
export function finishTemplate(template) {
  const reminders = template.reminders.filter(r => r.title.trim()).map(r => ({ ...r, title: r.title.trim() }));
  const included = new Set(reminders.map(r => r.id));
  reminders.forEach(r => {
    while (r.parentId && !included.has(r.parentId)) r.parentId = template.reminders.find(parent => parent.id === r.parentId)?.parentId || null;
  });
  return { ...template, name: template.list.name.trim(), list: { ...template.list, name: template.list.name.trim() }, reminders };
}
export function saveTemplate(data, listId, name, includeCompleted = false) {
  name = name.trim();
  const source = data.lists.find((list) => list.id === listId);
  if (!name || !source)
    throw new Error("A template name and list are required");
  if ((data.templates || []).length >= 100)
    throw new Error("Template limit reached");
  const reminders = (source.type === "smart" ? selectReminders(data, listId, { showCompleted: includeCompleted }) : data.reminders.filter(r => r.listId === listId && (includeCompleted || !r.completed)))
    .map((r) => {
      const { attachments, assignedTo, ...item } = clone(r);
      return { ...item, listId, ...(source.type === "smart" ? { sectionId: null } : {}), completed: false, completedAt: null };
    });
  const included = new Set(reminders.map((r) => r.id));
  reminders.forEach((r) => {
    if (!included.has(r.parentId)) r.parentId = null;
  });
  const { shared, participants, filters, shoppingOverrides, ...list } = clone(source);
  list.type = "standard";
  const template = { id: freshId(), name, list: { ...list, name }, reminders };
  return { ...data, templates: [...(data.templates || []), template] };
}
export function useTemplate(data, templateId, name, now = new Date()) {
  const template = data.templates?.find((t) => t.id === templateId);
  if (!template || !name.trim())
    throw new Error("A template and list name are required");
  if (
    data.lists.length >= 100 ||
    data.reminders.length + template.reminders.length > 1000
  )
    throw new Error("Workspace limit reached");
  const listId = freshId(),
    sections = new Map(template.list.sections.map((s) => [s.id, freshId()])),
    ids = new Map(template.reminders.map((r) => [r.id, freshId()]));
  const list = {
    ...clone(template.list),
    id: listId,
    name: name.trim(),
    sections: template.list.sections.map((s) => ({
      ...s,
      id: sections.get(s.id),
    })),
    ...(template.list.shoppingOverrides ? { shoppingOverrides: template.list.shoppingOverrides.map(entry => ({ ...entry, sectionId: sections.get(entry.sectionId) || null })) } : {}),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const reminders = template.reminders.map((r) => ({
    ...clone(r),
    id: ids.get(r.id),
    listId,
    parentId: ids.get(r.parentId) || null,
    sectionId: sections.get(r.sectionId) || null,
    completed: false,
    completedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }));
  return {
    data: {
      ...data,
      lists: [...data.lists, list],
      reminders: [...data.reminders, ...reminders],
    },
    listId,
  };
}
