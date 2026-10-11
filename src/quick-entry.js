import { createReminder } from "./model.js";
export function quickEntryDraft(lists) {
  const list =
    lists.find((l) => l.type !== "smart" && l.name === "Reminders") ||
    lists.find((l) => l.type !== "smart");
  if (!list) return null;
  return {
    ...createReminder(list.id, ""),
    title: "",
    notes: "",
    dueDate: null,
    dueTime: null,
    tags: [],
  };
}
export function finishQuickEntry(draft, lists) {
  if (!draft.title.trim()) throw new Error("Enter a title.");
  if (!lists.some((l) => l.id === draft.listId && l.type !== "smart"))
    throw new Error("Choose an available list.");
  return {
    ...draft,
    title: draft.title.trim(),
    attachments: (draft.attachments || []).filter((a) => !a.pending),
  };
}
