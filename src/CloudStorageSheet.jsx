import React, { useEffect, useRef, useState } from "react";
import { Check, Cloud, Copy, Eye, EyeOff, X } from "lucide-react";
import "./accounts.css";
import "./cloud-storage.css";

function summary(data) {
  return `${data.lists.length} lists · ${data.reminders.length} reminders · ${data.lists.reduce((count, list) => count + list.sections.length, 0)} sections`;
}

export default function CloudStorageSheet({ cloud, data, onClose, onExport }) {
  const sheet = useRef(null);
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(cloud.remembered === true);
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const preview = cloud.cloudPreview;
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
    const viewport = window.visualViewport, modal = sheet.current?.closest(".modal");
    function resize() {
      modal?.style.setProperty("--accounts-vh", `${viewport?.height || window.innerHeight}px`);
      modal?.style.setProperty("--accounts-vtop", `${viewport?.offsetTop || 0}px`);
    }
    resize(); viewport?.addEventListener("resize", resize); viewport?.addEventListener("scroll", resize);
    return () => { viewport?.removeEventListener("resize", resize); viewport?.removeEventListener("scroll", resize); };
  }, []);
  async function copyCode() {
    setCopyError("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(cloud.recoveryCode);
      setCopied(true);
    } catch { setCopyError("The code could not be copied. Show it and save it privately."); }
  }
  const rememberChoice = <label className="account-source cloud-remember">
    <input type="checkbox" checked={cloud.connected ? cloud.remembered : remember} disabled={cloud.busy} onChange={event => cloud.connected ? cloud.setRemembered(event.target.checked) : setRemember(event.target.checked)} />
    <span>Remember on This Device</span>
  </label>;
  const recoverySection = cloud.recoveryCode && <section className="accounts-group accounts-note cloud-recovery">
    <h3 className="accounts-group-title">Recovery Code</h3>
    <p>Anyone with this code can read and change your cloud reminders. Keep it private. We cannot recover your backup if the code is lost.</p>
    <input className="accounts-input cloud-code" aria-label="Your recovery code" readOnly value={reveal ? cloud.recoveryCode : "••••••••••••••••••••••••"} autoComplete="off" spellCheck={false} />
    <div className="cloud-code-actions">
      <button className="accounts-action secondary" onClick={() => setReveal(value => !value)} aria-pressed={reveal}>{reveal ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}{reveal ? "Hide Code" : "Show Code"}</button>
      <button className="accounts-action secondary" onClick={copyCode}><Copy size={18} aria-hidden="true" />{copied ? "Copied" : "Copy Code"}</button>
    </div>
    {copyError && <p className="accounts-error" role="alert">{copyError}</p>}
    {cloud.connected ? <>{rememberChoice}<p className="accounts-caption">{cloud.remembered ? "This device keeps the recovery code locally. Anyone who can use this device may access this backup." : "The cloud connection lasts until this page closes. Save your code privately before clearing app storage or closing the page."}</p></> : <p className="accounts-caption">Setup may already have created an encrypted backup. Keep this code and retry Enable Cloud Storage to check the same workspace.</p>}
  </section>;
  return <div ref={sheet} className="accounts-sheet cloud-storage-sheet" role="dialog" aria-modal="true" aria-labelledby="cloud-storage-title">
    <header className="accounts-header">
      <button className="accounts-chrome" aria-label="Cancel" onClick={onClose}><X size={24} strokeWidth={1.8} /></button>
      <h2 id="cloud-storage-title">Cloud Storage</h2>
      <button className="accounts-chrome accounts-done" aria-label="Done" onClick={onClose}><Check size={24} strokeWidth={2.4} /></button>
    </header>
    <div className="accounts-body">
      <section className="accounts-group cloud-overview">
        <div className="account-row cloud-summary-row"><span className="account-icon icloud"><Cloud size={23} aria-hidden="true" /></span><span className="account-copy"><strong>Private Cloudflare Storage</strong><span role="status" aria-live="polite">{cloud.status}</span></span></div>
        <p className="accounts-caption">{summary(data)} on this device</p>
      </section>
      <p className="accounts-caption">Your reminders and sections are encrypted on this device before they are saved to Cloudflare. Google passwords and access tokens are never included.</p>
      {recoverySection}
      {!cloud.configured && <p className="accounts-error" role="alert">Private cloud storage is not available on this deployment yet. Your reminders remain on this device.</p>}
      {!cloud.connected ? <>
        <section className="accounts-group accounts-note">
          {rememberChoice}
          <p className="accounts-caption">On your own device, this keeps the recovery code in this app’s local storage so cloud saving can resume after reopening. Leave it off on a shared device.</p>
          <button className="accounts-action" disabled={!cloud.configured || cloud.busy} onClick={() => cloud.create({ remember })}>Enable Cloud Storage</button>
          <p className="accounts-caption">Creates a private backup of this device’s reminders. Save the recovery code privately; it is needed on your other devices.</p>
        </section>
        <form className="accounts-group accounts-note" onSubmit={event => { event.preventDefault(); cloud.connect(code, { remember }); }}>
          <label className="accounts-field-label" htmlFor="cloud-recovery-input">Connect an Existing Backup</label>
          <input id="cloud-recovery-input" className="accounts-input" type="password" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Recovery code" disabled={cloud.busy || !cloud.configured} />
          <p className="accounts-caption">Enter your recovery code to preview its cloud reminders before choosing a version.</p>
          <button className="accounts-action secondary" type="submit" disabled={!code.trim() || cloud.busy || !cloud.configured}>Preview Cloud Reminders</button>
        </form>
      </> : <>
        {preview && <section className="accounts-group accounts-preview" aria-label="Cloud reminders preview">
          <h3 className="accounts-group-title">{preview.historical ? "Previous Backup" : "Cloud Reminders"}</h3>
          <p>{summary(preview.snapshot.data)}</p>
          <ul>{preview.snapshot.data.lists.slice(0, 10).map(list => <li key={list.id}>{list.name}</li>)}</ul>
          <p className="accounts-caption">Use Cloud Version replaces the reminders on this device. Keep This Device Version replaces the cloud copy with this device’s reminders. Export a backup first if you want to keep both.</p>
          <button className="accounts-action secondary" disabled={cloud.busy} onClick={onExport}>Export This Device Backup</button>
          <button className="accounts-action" disabled={cloud.busy} onClick={cloud.useCloudVersion}>Use Cloud Version</button>
          <button className="accounts-action secondary" disabled={cloud.busy} onClick={cloud.keepLocalVersion}>Keep This Device Version</button>
        </section>}
        <button className="accounts-action secondary" disabled={cloud.busy} onClick={cloud.refresh}>Check Cloud for Changes</button>
        {cloud.error && !preview && <button className="accounts-action" disabled={cloud.busy} onClick={cloud.retry}>Retry Saving</button>}
        {cloud.history?.length > 0 && <section className="accounts-group" aria-label="Previous cloud backups"><h3 className="accounts-group-title">Previous Backups</h3>{cloud.history.map(item => <button className="account-row" key={item.revision} disabled={cloud.busy} onClick={() => cloud.previewHistory(item.revision)}><span className="account-copy"><strong>Preview Backup {item.revision}</strong><span>{new Date(item.updatedAt).toLocaleString()}</span></span></button>)}</section>}
        <button className="accounts-action destructive" disabled={cloud.busy} onClick={cloud.disconnect}>Disconnect This Device</button>
        <p className="accounts-caption">Disconnecting keeps the reminders on this device and the encrypted cloud backup.</p>
      </>}
      {cloud.error && <p className="accounts-error" role="alert">{cloud.error}</p>}
    </div>
  </div>;
}
