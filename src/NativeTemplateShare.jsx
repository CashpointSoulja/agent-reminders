import React, { useEffect, useState } from "react";
import Icon from "./icons.jsx";
import { NativeTemplateAlert } from "./NativeTemplatePicker.jsx";
import "./native-templates.css";

export default function NativeTemplateShare({ template, initialStatus, onAction, onClose }) {
  const [status, setStatus] = useState(initialStatus || { shared: false });
  const [include, setInclude] = useState(initialStatus?.options || { dates: false, tags: false, locations: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirmStop, setConfirmStop] = useState(false), [copied, setCopied] = useState(false);
  useEffect(() => {
    const key = event => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!busy) { if (confirmStop) setConfirmStop(false); else onClose(); }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [busy, confirmStop, onClose]);
  const present = { dates: template.reminders.some(r => r.dueDate), tags: template.reminders.some(r => r.tags.length), locations: template.reminders.some(r => r.location) };
  async function run(method) {
    setBusy(true); setError("");
    try { const result = await onAction(method, method === "DELETE" ? undefined : include); setStatus(result); setConfirmStop(false); setCopied(false); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function send(share = false) {
    setError("");
    try {
      const current = status.token ? status : await onAction("GET");
      if (!current.token) throw Error("Shared link unavailable. Share this template again.");
      setStatus(current);
      const link = `${window.location.origin}/#template=${current.token}`;
      if (share && navigator.share) await navigator.share({ title: template.name, url: link });
      else { await navigator.clipboard.writeText(link); setCopied(true); }
    } catch (failure) { if (failure.name !== "AbortError") setError("Unable to send the link. Try Copy Link."); }
  }
  return <section className="native-list-sheet native-template-sheet nt-share" role="dialog" aria-modal="true" aria-label="Share Template">
    <header className="nls-header"><button type="button" className="nls-close" aria-label="Cancel" disabled={busy} onClick={onClose}><span aria-hidden="true">×</span></button><h2>{status.shared ? "Manage Link" : "Share Template"}</h2><button type="button" className="nls-done" aria-label="Share Template" disabled={busy || status.shared} onClick={() => run("POST")}><Icon name="check" size={26} /></button></header>
    <div className="nls-scroll">
      <div className="nt-share-template"><span className="nt-template-badge" style={{ backgroundColor: template.list.color }}><Icon nativePicker name={template.list.icon} size={22} color="white" /></span><span>{template.name}</span></div>
      {busy && <p role="status">Sharing template…</p>}
      {error && <p role="alert">{error}</p>}
      {!status.shared && <><div className="nt-share-options">{[["dates", "Include Dates"], ["tags", "Include Tags"], ["locations", "Include Locations"]].filter(([key]) => present[key]).map(([key, label]) => <div className="nt-completed" key={key}><span>{label}</span><button type="button" role="switch" aria-label={label} className="nt-switch" aria-checked={include[key]} disabled={busy} onClick={() => setInclude(options => ({ ...options, [key]: !options[key] }))}><span /></button></div>)}</div><p className="nt-footnote">Anyone with the link can download a copy of this template. Images are removed.</p></>}
      {status.shared && <div className="nt-share-options"><button type="button" className="nt-share-action" disabled={busy || !status.outdated} onClick={() => run("PUT")}><Icon name="repeat" />Update Link</button><button type="button" className="nt-share-action" disabled={busy} onClick={() => send(true)}><Icon name="share" />Send Link</button><button type="button" className="nt-share-action" disabled={busy} onClick={() => send(false)}><Icon name="link" />Copy Link</button><button type="button" className="nt-share-action nt-destructive" disabled={busy} onClick={() => setConfirmStop(true)}><Icon name="close" />Stop Sharing</button></div>}
      {copied && <p role="status">Link Copied</p>}
    </div>
    {confirmStop && <NativeTemplateAlert title="Stop Sharing?" message="Others will no longer be able to download this template." action="Stop Sharing" destructive busy={busy} onCancel={() => setConfirmStop(false)} onConfirm={() => run("DELETE")} />}
  </section>;
}

export function NativeTemplateImport({ template, busy, onClose, onCreate }) {
  const [name, setName] = useState(template.name), [naming, setNaming] = useState(false);
  useEffect(() => {
    const key = event => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!busy) { if (naming) setNaming(false); else onClose(); }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [busy, naming, onClose]);
  return <section className="native-list-sheet native-template-sheet nt-editor" role="dialog" aria-modal="true" aria-label="Shared Template">
    <header className="nls-header"><button type="button" className="nls-close" aria-label="Cancel" disabled={busy} onClick={onClose}><span aria-hidden="true">×</span></button><h2>Template</h2><button type="button" className="nt-edit-button" disabled={busy} onClick={() => setNaming(true)}>Create List</button></header>
    <div className="nls-scroll"><h2 className="nt-list-title" style={{ color: template.list.color }}>{template.name}</h2><div className="nt-status">Template</div>{template.reminders.map(r => <div className="nt-reminder-row" key={r.id} style={{ marginLeft: r.parentId ? 28 : 0 }}><span className="nt-circle" aria-hidden="true" /><span>{r.title}</span></div>)}</div>
    {naming && <NativeTemplateAlert title="Name List" value={name} onChange={setName} action={busy ? "Creating…" : "Create"} busy={busy} onCancel={() => setNaming(false)} onConfirm={() => onCreate(name)} />}
  </section>;
}
