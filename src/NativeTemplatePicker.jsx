import React, { useEffect, useRef, useState } from "react";
import Icon from "./icons.jsx";
import "./native-templates.css";
import GestureRow from "./ReminderGestures.jsx";
import { moveReminder } from "./motion.js";

export function NativeTemplateAlert({ title, message, value, onChange, inputLabel = "List name", action, destructive = false, busy = false, onCancel, onConfirm }) {
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <div className="nt-alert-backdrop" onClick={e => { if (!busy && e.target === e.currentTarget) onCancel(); }}>
    <div className="nt-alert" role="alertdialog" aria-modal="true" aria-label={title}>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {onChange && <input ref={input} disabled={busy} aria-label={inputLabel} placeholder={inputLabel === "Section name" ? "Section Name" : "List Name"} value={value} maxLength={200} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !busy && value.trim()) { e.preventDefault(); onConfirm(); } }} />}
      <div className="nt-alert-actions"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className={destructive ? "nt-destructive" : ""} disabled={busy || (onChange && !value.trim())} onClick={onConfirm}>{action}</button></div>
    </div>
  </div>;
}

export default function NativeTemplatePicker({ templates, onUse, onDetails, editing = false, onDelete, onReorder, shareStatuses = {} }) {
  const [active, setActive] = useState(null), [name, setName] = useState(""), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const order = templates.map(t => ({ id: t.id, title: t.name, listId: "templates", parentId: null, sectionId: null }));
  async function create() {
    setBusy(true);
    try { await onUse(active.id, name.trim()); setActive(null); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <>
    <div className="nt-template-rows">
      {templates.map(t => {
        const Row = editing && onReorder ? GestureRow : "div";
        return <Row className="nt-template-row" key={t.id} data-template-id={t.id} {...(Row === GestureRow ? { reminder: order.find(row => row.id === t.id), reminders: order, allowNesting: false, contextActions: ["Edit Template", "Delete Template"], onContextAction: label => label === "Delete Template" ? onDelete(t) : onDetails(t), onMove: change => onReorder(moveReminder({ reminders: order }, change).reminders.map(row => row.id)) } : {})}>
        {editing && <button type="button" className="nt-delete-control" aria-label={`Delete Template ${t.name}`} onClick={() => onDelete(t)}>−</button>}
        <button type="button" data-ui="row-main" className="nt-template-name" onClick={() => { setActive(t); setName(t.name); }}>
          <span className="nt-template-badge" style={{ backgroundColor: t.list.color }}><Icon nativePicker name={t.list.icon} color="white" size={22} /></span><span>{t.name}{shareStatuses[t.id]?.shared && <small>Template Shared Today</small>}</span>
        </button>
        {onDetails && !editing && <button type="button" className="nt-info" aria-label={`Details ${t.name}`} onClick={() => onDetails(t)}><span aria-hidden="true">i</span></button>}
        {editing && <span className="nt-reorder-mark" aria-hidden="true">☰</span>}
      </Row>})}
    </div>
    {templates.length ? <p className="nt-footnote">Select a template to create a list.</p> : <div className="nt-empty"><Icon name="templates" size={48} /><h3>No Templates</h3></div>}
    {error && <p role="alert">{error}</p>}
    {active && <NativeTemplateAlert title="Name List" value={name} onChange={setName} action="Create" busy={busy} onCancel={() => setActive(null)} onConfirm={create} />}
  </>;
}
