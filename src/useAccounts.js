import { useEffect, useRef, useState } from "react";
import { createGoogleAccounts } from "./google-accounts.js";
import { accountSourceForReminder, emptyAccountProvenance, mergeAccountSnapshot, normalizeICloudSnapshot, validateAccountProvenance } from "./account-import.js";

const KEY = "reminders-accounts-v1";
const CLIENT_KEY = "reminders-google-client-id";
const PROVIDERS = ["google-calendar", "google-tasks"];
const empty = emptyAccountProvenance;

export function parseAccountMetadata(raw) {
  const fallback = () => ({ provenance: empty(), selections: {} });
  try {
    if (typeof raw !== "string" || !raw || raw.length > 5000000) return fallback();
    const value = JSON.parse(raw);
    if (value?.version !== 1 || Object.keys(value).some(key => !["version", "provenance", "selections", "importInfo"].includes(key)) || !validateAccountProvenance(value.provenance) || !value.selections || typeof value.selections !== "object" || Array.isArray(value.selections) || Object.entries(value.selections).some(([provider, ids]) => ![...PROVIDERS, "icloud"].includes(provider) || !Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !id || id.length > 2000))) return fallback();
    if (value.importInfo !== undefined && (!value.importInfo || typeof value.importInfo !== "object" || Array.isArray(value.importInfo) || Object.entries(value.importInfo).some(([provider, info]) => ![...PROVIDERS, "icloud"].includes(provider) || !info || typeof info !== "object" || Object.keys(info).some(key => !["importedAt", "lists", "sample"].includes(key)) || typeof info.importedAt !== "string" || !Number.isFinite(Date.parse(info.importedAt)) || !Number.isInteger(info.lists) || info.lists < 0 || info.lists > 100 || typeof info.sample !== "boolean"))) return fallback();
    return value;
  } catch { return fallback(); }
}
function stored() {
  try { return parseAccountMetadata(localStorage.getItem(KEY)); }
  catch { return parseAccountMetadata(null); }
}

export function validPublicGoogleClientId(value) {
  return typeof value === "string" && /^[0-9]{5,30}-[a-zA-Z0-9_-]{10,100}\.apps\.googleusercontent\.com$/.test(value);
}

export default function useAccounts({ enabled, data, setData, onNotice }) {
  const initial = useRef(null);
  if (!initial.current) initial.current = enabled ? stored() : { provenance: empty(), selections: {} };
  const provenance = useRef(initial.current.provenance);
  const selections = useRef(initial.current.selections);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [clientId, setClientId] = useState(() => {
    const configured = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || "";
    if (validPublicGoogleClientId(configured)) return configured;
    try { const saved = localStorage.getItem(CLIENT_KEY); return validPublicGoogleClientId(saved) ? saved : ""; } catch { return ""; }
  });
  const google = useRef(null);
  if (!google.current) google.current = createGoogleAccounts({ clientId });
  const [states, setStates] = useState({});
  const [sources, setSources] = useState({});
  const [previews, setPreviews] = useState({});
  const [busy, setBusy] = useState("");
  const [identityReady, setIdentityReady] = useState(false);
  const [completionReady, setCompletionReady] = useState(false);
  const [completionIntent, setCompletionIntent] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [importInfo, setImportInfo] = useState(initial.current.importInfo || {});
  const generation = useRef(0);
  const operationPending = useRef(false);
  const pendingCompletions = useRef(new Set());
  const nativeAvailable = enabled && Boolean(globalThis.window?.webkit?.messageHandlers?.reaDevice);

  function updateStates() {
    setStates(Object.fromEntries(PROVIDERS.map(provider => [provider, google.current.state(provider)])));
  }
  function saveMetadata(nextProvenance = provenance.current, nextSelections = selections.current, nextInfo = importInfo) {
    provenance.current = nextProvenance;
    selections.current = nextSelections;
    try { localStorage.setItem(KEY, JSON.stringify({ version: 1, provenance: nextProvenance, selections: nextSelections, importInfo: nextInfo })); }
    catch { onNotice("Your account links could not be saved. Export a backup before closing this tab."); }
  }
  function importSnapshot(snapshot) {
    const now = new Date();
    const result = mergeAccountSnapshot(dataRef.current, provenance.current, snapshot, { now });
    const priorProvenance = provenance.current;
    setData(previous => mergeAccountSnapshot(previous, priorProvenance, snapshot, { now }).data);
    const nextSelections = { ...selections.current, [snapshot.provider]: snapshot.lists.map(list => list.id) };
    const nextInfo = { ...importInfo, [snapshot.provider]: { importedAt: new Date().toISOString(), lists: snapshot.lists.length, sample: snapshot.sample === true } };
    saveMetadata(result.provenance, nextSelections, nextInfo);
    setImportInfo(nextInfo);
    if (snapshot.provider === "google-tasks" && google.current.state("google-tasks").writeback) setCompletionReady(true);
    const conflicts = result.conflicts?.length || 0;
    setStatus(`${result.imported} imported, ${result.updated} updated.${conflicts ? ` ${conflicts} local changes kept.` : ""}${result.missing ? ` ${result.missing} source items are no longer available; local copies were kept.` : ""}`);
    setError("");
    return result;
  }
  async function run(provider, operation) {
    if (!enabled || operationPending.current) return null;
    operationPending.current = true;
    const currentGeneration = generation.current;
    setBusy(provider);
    setError("");
    setStatus("");
    try { return await operation(() => currentGeneration === generation.current); }
    catch (failure) {
      if (currentGeneration === generation.current) setError(failure?.message || "The account could not be connected. Try again.");
      return null;
    } finally {
      if (currentGeneration === generation.current) { operationPending.current = false; setBusy(""); updateStates(); }
    }
  }
  useEffect(() => {
    if (!enabled) return;
    updateStates();
    const interval = setInterval(updateStates, 30000);
    function nativeImport(event) {
      if (!globalThis.window?.webkit?.messageHandlers?.reaDevice) return;
      try {
        const snapshot = normalizeICloudSnapshot(event.detail);
        importSnapshot(snapshot);
        setStatus(`${snapshot.lists.length} ${snapshot.sample ? "sample " : ""}lists imported on this device. Nothing was uploaded.`);
      } catch (failure) { setError(failure?.message || "The Apple Reminders import was not valid. Try again."); }
    }
    window.addEventListener("rea:apple-reminders-import", nativeImport);
    return () => { clearInterval(interval); window.removeEventListener("rea:apple-reminders-import", nativeImport); };
  }, [enabled, importInfo]);

  return {
    enabled, clientId, states, sources, previews, busy, error, status, importInfo, nativeAvailable, identityReady, completionReady, completionIntent,
    sourceForReminder: id => accountSourceForReminder(provenance.current, id),
    selectedSources: provider => selections.current[provider] || [],
    clearMessages() { setError(""); setStatus(""); },
    clearPreview(provider) {
      setPreviews(previous => ({ ...previous, [provider]: null }));
      if (provider === "google-tasks") setCompletionReady(false);
    },
    configure(value) {
      const next = value.trim();
      if (!validPublicGoogleClientId(next)) { setError("Enter a Google web client ID ending in .apps.googleusercontent.com."); return false; }
      if (busy) return false;
      generation.current++;
      google.current.disconnect();
      google.current = createGoogleAccounts({ clientId: next });
      setClientId(next); setSources({}); setPreviews({}); setError(""); setIdentityReady(false); setCompletionReady(false); setCompletionIntent(false);
      try { localStorage.setItem(CLIENT_KEY, next); } catch { onNotice("The public Google client ID could not be saved in this browser."); }
      updateStates();
      return true;
    },
    prepare(provider) {
      return run(provider, async current => {
        await google.current.prepare();
        if (!current()) return null;
        setIdentityReady(true);
        return true;
      });
    },
    connect(provider, options) {
      return run(provider, async current => {
        if (provider === "google-tasks") setCompletionReady(false);
        await google.current.connect(provider, options);
        if (!current()) return null;
        if (provider === "google-tasks") setCompletionIntent(options?.writeback === true);
        const found = await google.current.listSources(provider);
        if (!current()) return null;
        setSources(previous => ({ ...previous, [provider]: found }));
        setPreviews(previous => ({ ...previous, [provider]: null }));
        if (provider === "google-tasks" && options?.writeback) {
          const selected = found.filter(source => (selections.current[provider] || []).includes(source.id));
          if (selected.length) {
            const snapshot = await google.current.snapshot(provider, selected);
            if (!current()) return null;
            setPreviews(previous => ({ ...previous, [provider]: snapshot }));
            setStatus("Completion permission granted. Review and import this new preview to enable completion.");
          }
        }
        return found;
      });
    },
    preview(provider, selectedIds) {
      return run(provider, async current => {
        if (provider === "google-tasks") setCompletionReady(false);
        const selected = (sources[provider] || []).filter(source => selectedIds.includes(source.id));
        if (!selected.length) throw new Error("Select at least one list to preview.");
        const snapshot = await google.current.snapshot(provider, selected);
        if (!current()) return null;
        setPreviews(previous => ({ ...previous, [provider]: snapshot }));
        return snapshot;
      });
    },
    importPreview(provider) {
      try {
        if (!previews[provider]) return false;
        importSnapshot(previews[provider]);
        setPreviews(previous => ({ ...previous, [provider]: null }));
        return true;
      } catch (failure) { setError(failure?.message || "The selected lists could not be imported."); return false; }
    },
    previewAppleFile(file) {
      return run("icloud", async current => {
        if (!file || !Number.isInteger(file.size) || file.size < 2 || file.size > 2 * 1024 * 1024 || !/\.json$/i.test(file.name)) throw new Error("Choose a JSON export from the iPhone companion, no larger than 2 MB.");
        let raw;
        try { raw = JSON.parse(await file.text()); } catch { throw new Error("The iPhone export could not be read. Export it again from the companion."); }
        const snapshot = normalizeICloudSnapshot(raw);
        if (!current()) return null;
        setPreviews(previous => ({ ...previous, icloud: snapshot }));
        return snapshot;
      });
    },
    refresh(provider) {
      return run(provider, async current => {
        const found = await google.current.listSources(provider);
        const selected = found.filter(source => (selections.current[provider] || []).includes(source.id));
        if (!selected.length) throw new Error("Choose lists and import them before refreshing.");
        const snapshot = await google.current.snapshot(provider, selected);
        if (!current()) return null;
        setSources(previous => ({ ...previous, [provider]: found }));
        if (provider === "google-tasks" && google.current.state(provider).writeback && (!completionReady || previews[provider])) {
          setCompletionReady(false);
          setPreviews(previous => ({ ...previous, [provider]: snapshot }));
          setStatus("Review and import this fresh preview to enable Google Tasks completion.");
          return snapshot;
        }
        return importSnapshot(snapshot);
      });
    },
    async disconnect(options = {}) {
      generation.current++;
      operationPending.current = false;
      setCompletionReady(false);
      setCompletionIntent(false);
      setBusy(options.revoke ? "google" : ""); setSources({}); setPreviews({}); setError("");
      try {
        await google.current.disconnect(options);
        setStatus(options.revoke ? "Google access removed. Imported reminders remain on this device." : "Google disconnected. Imported reminders remain on this device.");
      } catch (failure) { setError(failure?.message || "Disconnected locally. Remove this app from your Google Account to revoke access."); }
      finally { setBusy(""); }
      updateStates();
    },
    importApple() {
      setError(""); setStatus("");
      if (!nativeAvailable) return false;
      window.webkit.messageHandlers.reaDevice.postMessage({ action: "showAccountImport" });
      return true;
    },
    async completeReminder(reminder) {
      if (pendingCompletions.current.has(reminder.id)) return true;
      const source = accountSourceForReminder(provenance.current, reminder.id);
      if (!source) return false;
      const taskState = google.current.state("google-tasks");
      if (!reminder.completed && source.provider === "google-tasks" && completionIntent && !taskState.writeback) {
        onNotice("Google Tasks access expired. Reconnect, enable completion, and review a fresh preview before completing this task.");
        updateStates();
        return true;
      }
      if (reminder.completed || source.provider !== "google-tasks" || !taskState.writeback) {
        onNotice("Changed on this device. The connected account was not changed.");
        return false;
      }
      if (!completionReady) { onNotice("Review and import a fresh Google Tasks preview to enable completion."); return true; }
      const affected = new Set([reminder.id]);
      for (let changed = true; changed;) {
        changed = false;
        for (const item of dataRef.current.reminders) if (affected.has(item.parentId) && !affected.has(item.id)) { affected.add(item.id); changed = true; }
      }
      const confirmed = [];
      const completionGeneration = generation.current;
      const targets = dataRef.current.reminders.filter(item => affected.has(item.id) && !item.completed);
      const fingerprints = new Map(targets.map(item => [item.id, JSON.stringify(item)]));
      for (const id of affected) pendingCompletions.current.add(id);
      try {
        for (const item of targets) {
          const mapped = accountSourceForReminder(provenance.current, item.id);
          if (mapped?.provider !== "google-tasks") continue;
          if (generation.current !== completionGeneration || JSON.stringify(dataRef.current.reminders.find(row => row.id === item.id)) !== fingerprints.get(item.id)) throw new Error("The local task or connection changed. Refresh Google Tasks before retrying.");
          const confirmation = await google.current.completeTask(mapped.sourceListId, mapped.sourceId, { etag: mapped.etag });
          if (confirmation?.id !== mapped.sourceId || confirmation.completed !== true) throw new Error("Google did not confirm completion. Refresh before retrying.");
          if (generation.current !== completionGeneration || JSON.stringify(dataRef.current.reminders.find(row => row.id === item.id)) !== fingerprints.get(item.id)) throw new Error("The local task or connection changed while Google was completing it. Refresh to reconcile Google's result.");
          confirmed.push(item.id);
        }
        for (const item of dataRef.current.reminders) if (affected.has(item.id) && !accountSourceForReminder(provenance.current, item.id)) confirmed.push(item.id);
        onNotice("Google confirmed completion.");
      } catch (failure) { onNotice(`${failure?.message || "Google Tasks could not be updated."} Only confirmed, unchanged local tasks can be marked complete.`); }
      finally { for (const id of affected) pendingCompletions.current.delete(id); }
      if (confirmed.length) {
        const timestamp = new Date().toISOString();
        setData(previous => generation.current !== completionGeneration ? previous : ({ ...previous, reminders: previous.reminders.map(item => confirmed.includes(item.id) && JSON.stringify(item) === fingerprints.get(item.id) ? { ...item, completed: true, completedAt: timestamp, updatedAt: timestamp } : item) }));
      }
      updateStates();
      return true;
    },
  };
}
