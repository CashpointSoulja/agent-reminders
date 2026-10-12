import React, { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Cloud, ListTodo, X } from "lucide-react";
import "./accounts.css";

const providers = [
  { id: "icloud", name: "iCloud", Icon: Cloud, className: "icloud" },
  { id: "google-calendar", name: "Google Calendar", Icon: CalendarDays, className: "calendar" },
  { id: "google-tasks", name: "Google Tasks", Icon: ListTodo, className: "tasks" },
];

export default function AccountsSheet({ accounts, onClose }) {
  const sheet = useRef(null);
  const appleFile = useRef(null);
  const [provider, setProvider] = useState("");
  const [clientId, setClientId] = useState(accounts.clientId);
  const [selected, setSelected] = useState([]);
  const [completionConsent, setCompletionConsent] = useState(false);
  const current = providers.find(item => item.id === provider);
  const state = accounts.states[provider] || {};
  const preview = accounts.previews[provider];
  const busy = Boolean(accounts.busy);
  useEffect(() => {
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => sheet.current?.querySelector("button")?.focus());
    function trap(event) {
      if (event.key !== "Tab") return;
      const controls = [...(sheet.current?.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]') || [])].filter(control => control.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !sheet.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !sheet.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", trap);
    return () => {
      cancelAnimationFrame(frame); document.removeEventListener("keydown", trap);
      const target = previous?.isConnected && previous !== document.body ? previous : document.querySelector('[data-ui="sidebar"] [aria-label="More"]');
      target?.focus();
    };
  }, []);
  useEffect(() => {
    if (!provider) return;
    const frame = requestAnimationFrame(() => sheet.current?.querySelector(".account-back")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [provider]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const modal = sheet.current?.closest(".modal");
    function resize() {
      modal?.style.setProperty("--accounts-vh", `${viewport?.height || window.innerHeight}px`);
      modal?.style.setProperty("--accounts-vtop", `${viewport?.offsetTop || 0}px`);
    }
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => { viewport?.removeEventListener("resize", resize); viewport?.removeEventListener("scroll", resize); };
  }, []);
  function open(id) {
    setProvider(id); setSelected(accounts.selectedSources(id)); setCompletionConsent(false); accounts.clearMessages();
  }
  async function connect(writeback = false) {
    const found = await accounts.connect(provider, { writeback });
    if (found) setSelected(accounts.selectedSources(provider).filter(id => found.some(source => source.id === id)));
  }
  const imported = accounts.importInfo[provider];
  function renderPreview() {
    if (!preview) return null;
    return <section className="accounts-group accounts-preview">
      <h4 className="accounts-group-title">Preview</h4>
      <p>{preview.lists.length} {preview.sample ? "sample " : ""}lists · {preview.lists.reduce((count, source) => count + source.reminders.length, 0)} reminders</p>
      <ul>{preview.lists.flatMap(source => source.reminders).slice(0, 5).map((reminder, index) => <li key={`${reminder.id}:${index}`}>{reminder.title}</li>)}</ul>
      <p className="accounts-caption">Only the previewed lists will be imported. Existing local edits and reminders are kept.</p>
      <button className="accounts-action" disabled={busy} onClick={() => accounts.importPreview(provider)}>Import on This Device</button>
    </section>;
  }
  return (
    <div ref={sheet} className="accounts-sheet" role="dialog" aria-modal="true" aria-labelledby="accounts-title">
      <header className="accounts-header">
        <button className="accounts-chrome" aria-label="Cancel" onClick={onClose}><X size={24} strokeWidth={1.8} /></button>
        <h2 id="accounts-title">Accounts</h2>
        <button className="accounts-chrome accounts-done" aria-label="Done" onClick={onClose}><Check size={24} strokeWidth={2.4} /></button>
      </header>
      <div className="accounts-body">
        {!current ? <>
          <section className="accounts-group" aria-label="Connected accounts">
            {providers.map(item => {
              const connected = accounts.states[item.id]?.connected;
              const info = accounts.importInfo[item.id];
              const subtitle = connected ? "Connected" : info ? item.id === "icloud" ? `${info.sample ? "Sample lists" : "Local copies"} on this device` : "Reconnect to Refresh" : "Not Connected";
              return <button key={item.id} className="account-row" onClick={() => open(item.id)}>
                <span className={`account-icon ${item.className}`}><item.Icon size={23} aria-hidden="true" /></span>
                <span className="account-copy"><strong>{item.name}</strong><span>{subtitle}</span></span>
                <ChevronRight className="account-chevron" size={18} aria-hidden="true" />
              </button>;
            })}
          </section>
          <p className="accounts-caption">Choose which lists to use. Imported reminders stay in this browser or on this device.</p>
          <p className="accounts-caption">Your Apple ID and Google password are entered only with Apple or Google.</p>
        </> : <div key={provider} className="account-panel">
          <button className="account-back" onClick={() => open("")}><ChevronLeft size={20} aria-hidden="true" /> Accounts</button>
          <div className="accounts-provider-heading"><span className={`account-icon ${current.className}`}><current.Icon size={24} aria-hidden="true" /></span><h3>{current.name}</h3></div>
          {provider === "icloud" ? <>
            <section className="accounts-group accounts-note">
              <p>Choose your Apple Reminders lists on an iPhone or iPad using the companion app. Apple asks for Reminders permission, then you review the selected lists before importing them on this device.</p>
              <p>Nothing is uploaded. Changes to these local copies do not change iCloud.</p>
            </section>
            {accounts.nativeAvailable ? <button className="accounts-action" onClick={accounts.importApple}>Choose Lists…</button> : <>
              <p className="accounts-caption">iCloud Reminders access needs the native companion. A web page cannot ask for Apple’s Reminders permission.</p>
              <a className="accounts-action" href="https://github.com/CashpointSoulja/agent-reminders/blob/rea-reminders-build/native/ios/README.md" target="_blank" rel="noopener noreferrer">Set Up the iPhone Companion</a>
              <input ref={appleFile} type="file" accept=".json,application/json" hidden aria-label="iPhone Reminders Export" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) accounts.previewAppleFile(file); }} />
              <button className="accounts-action secondary" disabled={busy} onClick={() => appleFile.current?.click()}>Import from iPhone…</button>
              <p className="accounts-caption">In the companion, choose lists, preview them, then use Export for Browser. Select that file here and confirm its preview. Export again to refresh your local copies.</p>
              {renderPreview()}
            </>}
            {imported && <p className="accounts-caption">{imported.lists} {imported.sample ? "sample " : ""}lists imported. To refresh, choose the same lists again.</p>}
          </> : <>
            <p className="accounts-caption">{provider === "google-calendar" ? "Import calendar events as local reminders. Calendar access is read-only; calendar events are never edited here. The import covers the last 30 days and the next 365 days." : "Choose task lists, preview them, then import them on this device. Google Tasks dates have no time of day."}</p>
            {!accounts.clientId && !accounts.nativeAvailable && <section className="accounts-group accounts-note">
              <label className="accounts-field-label" htmlFor="google-public-client-id">Google Web Client ID</label>
              <input id="google-public-client-id" className="accounts-input" value={clientId} onChange={event => setClientId(event.target.value)} placeholder="…apps.googleusercontent.com" autoComplete="off" spellCheck={false} />
              <p className="accounts-caption">This is the public ID of a Google OAuth web app, never a client secret. Its allowed origins must include {window.location.origin}.</p>
              <button className="accounts-action secondary" disabled={busy || !clientId.trim()} onClick={() => accounts.configure(clientId)}>Use Client ID</button>
            </section>}
            {accounts.nativeAvailable && <section className="accounts-group accounts-note"><p>Google connections need Safari. Google sign-in is not supported inside this companion’s embedded browser.</p><a className="accounts-action secondary" href="https://reminders-web-rea.pages.dev/" target="_blank" rel="noopener noreferrer">Connect Google in Safari</a><p className="accounts-caption">Safari has its own local reminders. Use the iCloud export above to import selected lists there.</p></section>}
            {!state.connected && !accounts.nativeAvailable && <>
              {!accounts.identityReady ? <button className="accounts-action" disabled={busy || !accounts.clientId} onClick={() => accounts.prepare(provider)}>{busy ? "Loading…" : "Connect"}</button> : <button className="accounts-action" disabled={busy} onClick={() => connect()}>{busy ? "Connecting…" : "Continue with Google"}</button>}
              <p className="accounts-caption">Google opens its own sign-in and consent window. Tokens stay in memory and are cleared when this page closes.</p>
            </>}
            {state.connected && <>
              <section className="accounts-group" aria-label="Choose lists">
                <h4 className="accounts-group-title">{provider === "google-calendar" ? "Calendars" : "Task Lists"}</h4>
                {(accounts.sources[provider] || []).map(source => <label key={source.id} className="account-source">
                  <input type="checkbox" disabled={busy} checked={selected.includes(source.id)} onChange={event => { accounts.clearPreview(provider); setSelected(previous => event.target.checked ? [...previous, source.id] : previous.filter(id => id !== source.id)); }} />
                  <span className="account-copy"><strong>{source.name}</strong></span>
                </label>)}
                {!accounts.sources[provider]?.length && <p className="accounts-caption">No lists are available in this account.</p>}
              </section>
              <button className="accounts-action secondary" disabled={busy || !selected.length} onClick={() => accounts.preview(provider, selected)}>{busy ? "Loading…" : "Preview"}</button>
              {renderPreview()}
              {imported && <button className="accounts-action secondary" disabled={busy} onClick={() => accounts.refresh(provider)}>Refresh Imported Lists</button>}
              {provider === "google-tasks" && <section className="accounts-group accounts-note">
                <h4 className="accounts-group-title">Task Completion</h4>
                {state.writeback ? <p>{accounts.completionReady ? "Enabled. Completing an imported Google task also completes it in Google Tasks." : "Permission granted. Review and import a fresh preview to enable completion."} Reopening, editing, and deleting affect only the local copy.</p> : <>
                  <label className="account-source"><input type="checkbox" disabled={busy} checked={completionConsent} onChange={event => setCompletionConsent(event.target.checked)} /><span className="account-copy">Allow me to complete selected, imported tasks in Google Tasks.</span></label>
                  <p className="accounts-caption">Google’s Tasks permission is broader than completion. This app uses it only to complete the tasks you selected and imported.</p>
                  <button className="accounts-action secondary" disabled={busy || !completionConsent} onClick={() => connect(true)}>Enable Google Tasks Completion</button>
                </>}
              </section>}
              <button className="accounts-action destructive" disabled={busy} onClick={() => accounts.disconnect()}>Disconnect Google</button>
              <button className="accounts-action destructive secondary" disabled={busy} onClick={() => accounts.disconnect({ revoke: true })}>Remove Google Access</button>
              <p className="accounts-caption">Disconnecting clears both Google connections. Imported copies stay on this device.</p>
            </>}
          </>}
        </div>}
        <p className="accounts-status" role="status">{accounts.status}</p>
        <p className="accounts-error" role="alert">{accounts.error}</p>
        <a className="accounts-policy" href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy</a>
      </div>
    </div>
  );
}
