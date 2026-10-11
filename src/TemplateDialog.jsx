import React, { useEffect, useRef, useState } from "react";
import Icon from "./icons.jsx";
import { createReminder, selectReminders } from "./model.js";
import { finishTemplate } from "./templates.js";
import { mergeSubtasks } from "./subtasks.js";
import NativeDetails from "./NativeDetails.jsx";
import NativeListSheet from "./NativeListSheet.jsx";
import NativeTemplatePicker, { NativeTemplateAlert } from "./NativeTemplatePicker.jsx";
import "./native-list-sheet.css";
import "./native-templates.css";
import NativeTemplateShare from "./NativeTemplateShare.jsx";
import GestureRow, { SubtaskChevron } from "./ReminderGestures.jsx";
import { moveReminder, subtreeIds } from "./motion.js";

export default function TemplateDialog({ mode, list, templates, data, api, onApiError, onShareAction, onReorder, onSave, onUse, onUpdate, onDelete, onClose }) {
  const sheet = useRef(null);
  const [name, setName] = useState(list?.name || ""), [includeCompleted, setIncludeCompleted] = useState(false);
  const [editing, setEditing] = useState(false), [editor, setEditor] = useState(null), [info, setInfo] = useState(false);
  const [menu, setMenu] = useState(null), [confirmDelete, setConfirmDelete] = useState(null), [detailId, setDetailId] = useState(null);
  const [creating, setCreating] = useState(null), [newName, setNewName] = useState(""), [sectionName, setSectionName] = useState(null);
  const [selection, setSelection] = useState(null), [inlineId, setInlineId] = useState(null), [error, setError] = useState("");
  const [sort, setSort] = useState("manual"), [sortMenu, setSortMenu] = useState(false);
  const [sharing, setSharing] = useState(null), [shareStatuses, setShareStatuses] = useState({});
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(new Set());
  const original = useRef(null), addedFiles = useRef([]), deletedFiles = useRef([]), persistedDraft = useRef(false);
  useEffect(() => {
    let active = true;
    if (api && mode === "templates") api.templateShareStatuses().then(result => { if (active) setShareStatuses(result.statuses); }).catch(failure => { if (active) { setError(failure.message); if (failure.status === 401) onApiError?.(failure); } });
    return () => { active = false; };
  }, [api, templates, mode]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const modal = sheet.current?.closest(".modal");
    const update = () => { modal?.style.setProperty("--nt-vh", `${viewport?.height || window.innerHeight}px`); modal?.style.setProperty("--nt-vtop", `${viewport?.offsetTop || 0}px`); };
    update(); viewport?.addEventListener("resize", update); viewport?.addEventListener("scroll", update);
    return () => { viewport?.removeEventListener("resize", update); viewport?.removeEventListener("scroll", update); };
  }, []);
  useEffect(() => {
    function handle(e) {
      if (e.key !== "Escape" || detailId || sharing || busy) return;
      e.preventDefault();
      if (info) setInfo(false);
      else if (menu) setMenu(null);
      else if (sortMenu) setSortMenu(false);
      else if (confirmDelete) setConfirmDelete(null);
      else if (creating) setCreating(null);
      else if (sectionName !== null) setSectionName(null);
      else if (selection) setSelection(null);
      else if (editor) cancelEditor();
      else onClose();
    }
    document.addEventListener("keydown", handle); return () => document.removeEventListener("keydown", handle);
  }, [menu, sortMenu, confirmDelete, creating, editor, onClose, info, detailId, sharing, sectionName, selection, busy]);
  const completed = data?.reminders.filter(r => r.listId === list?.id && r.completed).length || 0;
  async function perform(action) { setBusy(true); try { await action(); setError(""); } catch (failure) { setError(failure.message); if (failure.status === 401) onApiError?.(failure); } finally { setBusy(false); } }
  function edit(t) { original.current = structuredClone(t); addedFiles.current = []; deletedFiles.current = []; persistedDraft.current = false; setEditor(structuredClone(t)); setMenu(null); setSelection(null); }
  function updateReminder(id, values) { setEditor(t => ({ ...t, reminders: t.reminders.map(r => r.id === id ? { ...r, ...values } : r) })); }
  function addReminder() { const r = createReminder(editor.list.id, ""); setEditor(t => ({ ...t, reminders: [...t.reminders, r] })); setInlineId(r.id); }
  function finish() { perform(async () => { await onUpdate(finishTemplate(editor), deletedFiles.current); addedFiles.current = []; deletedFiles.current = []; persistedDraft.current = false; setEditor(null); }); }
  function cancelEditor() { perform(async () => { if (persistedDraft.current) await onUpdate(original.current, addedFiles.current); addedFiles.current = []; deletedFiles.current = []; persistedDraft.current = false; setEditor(null); }); }
  function removeRows(ids) {
    setEditor(t => ({ ...t, reminders: t.reminders.filter(r => !ids.includes(r.id)).map(r => { let parentId = r.parentId; while (ids.includes(parentId)) parentId = t.reminders.find(x => x.id === parentId)?.parentId || null; return { ...r, parentId }; }) }));
    setSelection(null);
  }
  function uploadPreparation() {
    const stored = api.snapshot?.data.templates.find(template => template.id === editor.id) || original.current;
    const reminders = [...stored.reminders, ...editor.reminders.filter(row => !stored.reminders.some(existing => existing.id === row.id))];
    const sections = [...stored.list.sections, ...editor.list.sections.filter(section => !stored.list.sections.some(existing => existing.id === section.id))];
    return finishTemplate({ ...stored, list: { ...stored.list, sections }, reminders });
  }
  const hiddenRows = editor ? new Set([...collapsed].flatMap(id => [...subtreeIds(editor.reminders, id)].filter(child => child !== id))) : new Set();
  const record = template => JSON.stringify((({ files, ...values }) => values)(template));
  const dirtyEditor = editor && record(finishTemplate(editor)) !== record(original.current);
  if (sharing) return <NativeTemplateShare template={sharing} initialStatus={shareStatuses[sharing.id]?.shared && dirtyEditor ? { ...shareStatuses[sharing.id], outdated: true } : shareStatuses[sharing.id]} onClose={() => { setSharing(null); if (api) api.templateShareStatuses().then(result => setShareStatuses(result.statuses)).catch(failure => setError(failure.message)); }} onAction={async (method, options) => { const result = await onShareAction(sharing.id, method, options, editor ? finishTemplate(editor) : undefined); setShareStatuses(statuses => ({ ...statuses, [sharing.id]: result })); return result; }} />;
  if (editor && info) return <NativeListSheet list={editor.list} templateInfo data={{ lists: [editor.list], reminders: editor.reminders }} onClose={() => setInfo(false)} onSave={values => { setEditor(t => ({ ...t, name: values.name, list: { ...t.list, ...values } })); setInfo(false); }} />;
  const reminder = editor?.reminders.find(r => r.id === detailId);
  if (reminder) return <NativeDetails key={reminder.id} reminder={{ ...reminder, attachments: (editor.files || []).filter(file => file.reminderId === reminder.id) }} uploading={busy} lists={[editor.list]} existingTags={[...new Set(editor.reminders.flatMap(r => r.tags))]} subtasks={editor.reminders.filter(r => r.parentId === reminder.id)} onCancel={async ({ addedAttachments = [] } = {}) => {
    await perform(async () => {
      if (addedAttachments.length) { const ids = addedAttachments.map(file => typeof file === "string" ? file : file.id); const saved = await onUpdate(uploadPreparation(), ids); addedFiles.current = addedFiles.current.filter(id => !ids.includes(id)); setEditor(t => ({ ...t, files: (saved.files || []).filter(file => !deletedFiles.current.includes(file.id)) })); }
      setDetailId(null);
    });
  }} onUpload={async file => {
    if (!api) throw Error("Connect to the server to add photos.");
    if (!reminder.title.trim()) throw Error("Enter a reminder title before adding a photo.");
    await onUpdate(uploadPreparation()); persistedDraft.current = true;
    const result = await api.uploadTemplateAttachment(editor.id, reminder.id, file), template = result.data.templates.find(t => t.id === editor.id);
    addedFiles.current.push(result.attachment.id); setEditor(t => ({ ...t, files: (template.files || []).filter(file => !deletedFiles.current.includes(file.id)) })); return result.attachment;
  }} onSave={(row, { subtasks = [], deletedAttachments = [] } = {}) => {
    deletedFiles.current = [...new Set([...deletedFiles.current, ...deletedAttachments.map(file => typeof file === "string" ? file : file.id)])];
    const reminders = editor.reminders.map(r => r.id === row.id ? { ...row, completed: false, completedAt: null } : r);
    setEditor(t => ({ ...t, files: (t.files || []).filter(file => !deletedFiles.current.includes(file.id)), reminders: mergeSubtasks(reminders, row, subtasks).map(r => { const { attachments, assignedTo, ...item } = r; return item; }) })); setDetailId(null);
  }} />;
  if (editor) return <section ref={sheet} className="native-list-sheet native-template-sheet nt-editor" role="dialog" aria-modal="true" aria-label="Edit Template" style={{ "--nt-color": editor.list.color }}>
    <header className="nls-header"><div className="nt-chrome"><button type="button" aria-label="Share Template" onClick={() => setSharing(finishTemplate(editor))}><Icon name="share" size={24} /></button><button type="button" aria-label="Template options" onClick={() => setMenu(menu ? null : editor)}><Icon name="more" size={24} /></button></div><button type="button" className="nls-done" aria-label="Done" disabled={busy} onClick={finish}><Icon name="check" size={26} /></button></header>
    <div className="nls-scroll"><h2 className="nt-list-title">{editor.list.name}</h2><div className="nt-status">Template</div>
      {error && <p role="alert">{error}</p>}
      {[...editor.list.sections, { id: null, name: "" }].map(section => <React.Fragment key={section.id || "unsectioned"}>{section.name && <h3 className="nt-section-heading">{section.name}</h3>}{selectReminders({ lists: [editor.list], reminders: editor.reminders }, editor.list.id, { sort }).filter(r => r.sectionId === section.id && !hiddenRows.has(r.id)).map(r => <GestureRow reminder={r} reminders={editor.reminders} onMove={change => setEditor(t => ({ ...t, reminders: moveReminder({ reminders: t.reminders }, change).reminders }))} contextActions={["Indent Reminder", ...(r.parentId ? ["Outdent Reminder"] : []), "Flag", "Details", "Delete"]} onContextAction={label => label === "Delete" ? removeRows([r.id]) : label === "Flag" ? updateReminder(r.id, { flagged: !r.flagged }) : setDetailId(r.id)} className="nt-reminder-row" key={r.id} style={{ marginLeft: r.parentId ? 28 : 0 }}>
        {selection ? <input type="checkbox" aria-label={`Select ${r.title}`} checked={selection.includes(r.id)} onChange={e => setSelection(ids => e.target.checked ? [...ids, r.id] : ids.filter(id => id !== r.id))} /> : <span className="nt-circle" aria-hidden="true" />}
        {inlineId === r.id ? <input autoFocus className="nt-title" aria-label="Template reminder title" value={r.title} onChange={e => updateReminder(r.id, { title: e.target.value })} onBlur={() => setInlineId(null)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setInlineId(null); } }} /> : <button type="button" data-ui="row-main" className="nt-title" onClick={() => setDetailId(r.id)}>{r.title || "New Reminder"}{r.notes && <small>{r.notes}</small>}{(r.dueDate || r.tags.length > 0) && <small>{[r.dueDate && `${r.dueTime ? `, ${r.dueTime}` : ""}`, ...r.tags.map(tag => `#${tag}`)].filter(Boolean).join(" ")}</small>}</button>}
        {editor.reminders.some(row => row.parentId === r.id) && <SubtaskChevron count={editor.reminders.filter(row => row.parentId === r.id).length} collapsed={collapsed.has(r.id)} onToggle={() => setCollapsed(previous => { const next = new Set(previous); next.has(r.id) ? next.delete(r.id) : next.add(r.id); return next; })} />}
      </GestureRow>)}</React.Fragment>)}
      {selection && <div className="nt-selection"><button type="button" onClick={() => setSelection(null)}>Cancel</button><button type="button" onClick={() => removeRows(selection)}>Delete</button></div>}
    </div>
    <button className="nt-add-reminder" type="button" aria-label="New Reminder In Template" onClick={addReminder}><Icon name="plus" size={28} /></button>
    {menu && <div className="nt-menu" role="menu" aria-label="Template actions"><button type="button" role="menuitem" onClick={() => { setMenu(null); setInfo(true); }}>Show Template Info</button><button type="button" role="menuitem" onClick={() => { setMenu(null); setCreating(editor); setNewName(editor.name); }}>Create List from Template</button><button type="button" role="menuitem" onClick={() => { setMenu(null); setSelection([]); }}>Select Reminders</button><button type="button" role="menuitem" onClick={() => { setMenu(null); setSectionName(""); }}>New Section</button><button type="button" role="menuitem" onClick={() => { setSortMenu(true); setMenu(null); }}>Sort By, {sort === "manual" ? "Manual" : sort === "title" ? "Title" : sort === "dueDate" ? "Deadline" : sort === "priority" ? "Priority" : "Creation Date"}</button><button type="button" role="menuitem" className="nt-destructive" onClick={() => { setConfirmDelete(editor); setMenu(null); }}>Delete Template</button></div>}
    {sortMenu && <div className="nt-menu" role="menu" aria-label="Sort By">{[["manual", "Manual"], ["dueDate", "Deadline"], ["createdAt", "Creation Date"], ["priority", "Priority"], ["title", "Title"]].map(([value, label]) => <button type="button" role="menuitemradio" aria-checked={sort === value} key={value} onClick={() => { setSort(value); setSortMenu(false); }}>{label}{sort === value && <Icon name="check" />}</button>)}</div>}
    {creating && <NativeTemplateAlert title="Name List" value={newName} onChange={setNewName} action="Create" onCancel={() => setCreating(null)} busy={busy} onConfirm={() => perform(() => onUse(editor.id, newName, finishTemplate(editor), deletedFiles.current))} />}
    {sectionName !== null && <NativeTemplateAlert title="New Section" inputLabel="Section name" value={sectionName} onChange={setSectionName} action="Done" onCancel={() => setSectionName(null)} onConfirm={() => { setEditor(t => ({ ...t, list: { ...t.list, sections: [...t.list.sections, { id: crypto.randomUUID(), name: sectionName.trim() }] } })); setSectionName(null); }} />}
    {confirmDelete && <NativeTemplateAlert title={`Delete the template “${confirmDelete.name}”?`} action="Delete" destructive onCancel={() => setConfirmDelete(null)} onConfirm={() => { onDelete(confirmDelete.id); setConfirmDelete(null); setEditor(null); }} />}
  </section>;
  return <section ref={sheet} className={`native-list-sheet native-template-sheet ${mode === "save-template" ? "nt-save" : "native-template-browser"}`} role="dialog" aria-modal="true" aria-label={mode === "save-template" ? "Save as Template" : "Templates"}>
    <header className="nls-header"><button type="button" className="nls-close" aria-label="Cancel" disabled={busy} onClick={onClose}><span aria-hidden="true">×</span></button><h2>{mode === "save-template" ? "Save as Template" : "Templates"}</h2>{mode === "save-template" ? <button type="button" className="nls-done" aria-label="Done" disabled={!name.trim() || busy} onClick={() => perform(() => onSave(name.trim(), includeCompleted))}><Icon name="check" size={26} /></button> : <button type="button" className="nt-edit-button" onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit"}</button>}</header>
    <div className="nls-scroll">{error && <p role="alert">{error}</p>}
      {mode === "save-template" ? <><div className="nls-hero"><div className="nls-glow-icon" style={{ "--list-color": list.color }}><Icon nativePicker name={list.icon} size={52} color="white" /></div><input className="nls-name" aria-label="Template name" placeholder="Template Name" maxLength={200} value={name} onChange={e => setName(e.target.value)} style={{ color: list.color }} /></div><p className="nt-footnote">Templates use copies of the list’s current reminders. You can view, edit or use templates when adding or managing lists.</p>{completed > 0 && <><div className="nt-completed"><span>Include Completed Reminders</span><button type="button" role="switch" aria-label="Include Completed Reminders" aria-checked={includeCompleted} className="nt-switch" onClick={() => setIncludeCompleted(!includeCompleted)}><span /></button></div><p className="nt-footnote">When included, {completed} completed {completed === 1 ? "reminder will" : "reminders will"} be marked as incomplete and added to this template.</p></>}</> : <NativeTemplatePicker templates={templates} onUse={onUse} editing={editing} onDetails={setMenu} onDelete={setConfirmDelete} onReorder={onReorder} shareStatuses={shareStatuses} />}
    </div>
    {menu && <div className="nt-menu" role="menu" aria-label={`Details ${menu.name}`}><button type="button" role="menuitem" onClick={() => edit(menu)}><Icon name="pencil" />Edit Template</button><button type="button" role="menuitem" onClick={() => { setSharing(menu); setMenu(null); }}><Icon name="share" />{shareStatuses[menu.id]?.shared ? "Manage Link" : "Share Template"}</button><button type="button" role="menuitem" className="nt-destructive" onClick={() => { setConfirmDelete(menu); setMenu(null); }}><Icon name="trash" />Delete Template</button></div>}
    {confirmDelete && <NativeTemplateAlert title={`Delete the template “${confirmDelete.name}”?`} action="Delete" destructive onCancel={() => setConfirmDelete(null)} onConfirm={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }} />}
  </section>;
}
