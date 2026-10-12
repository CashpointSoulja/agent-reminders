import { useEffect, useRef, useState } from "react";
import { createCloudVaultClient, createVaultRecoveryCode, VAULT_ENROLLMENT_LOCAL_KEY, VAULT_LOCAL_KEY, validateVaultSnapshot } from "./cloud-vault.js";

const fingerprint = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, "0")).join("");
function savedConnection() {
  try {
    const value = JSON.parse(localStorage.getItem(VAULT_LOCAL_KEY));
    if (value?.version === 1 && typeof value.endpoint === "string" && typeof value.recoveryCode === "string" && Number.isSafeInteger(value.revision) && value.revision >= 0 && /^[a-f0-9]{64}$/.test(value.lastSavedFingerprint)) return value;
  } catch { /* A damaged connection never replaces local reminders. */ }
  return null;
}
function savedEnrollment(endpoint) {
  try {
    const value = JSON.parse(localStorage.getItem(VAULT_ENROLLMENT_LOCAL_KEY));
    if (value?.version === 1 && value.endpoint === endpoint && typeof value.recoveryCode === "string" && /^arv1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(value.recoveryCode)) return value;
  } catch { /* Pending setup never changes reminders or starts network requests. */ }
  return null;
}

export default function useCloudStorage({ enabled, data, accountMetadata, onRestore, onNotice, endpoint = process.env.EXPO_PUBLIC_CLOUD_VAULT_URL || "" }) {
  const snapshot = { version: 1, data, ...(accountMetadata ? { accountMetadata } : {}) };
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const callbacks = useRef({ onRestore, onNotice });
  callbacks.current = { onRestore, onNotice };
  const initial = useRef(undefined);
  if (initial.current === undefined) initial.current = enabled ? savedConnection() : null;
  const initialEnrollment = useRef(undefined);
  if (initialEnrollment.current === undefined) initialEnrollment.current = enabled ? savedEnrollment(endpoint) : null;
  const connection = useRef(initial.current);
  const remember = useRef(Boolean(initial.current || initialEnrollment.current));
  const confirmed = useRef(Boolean(initial.current));
  const lastSavedSnapshot = useRef("");
  const client = useRef(null);
  const enrollment = useRef(null);
  const retainedEnrollmentCode = useRef(initialEnrollment.current?.recoveryCode || "");
  const generation = useRef(0);
  const pending = useRef(false);
  const ready = useRef(false);
  const blocked = useRef(false);
  const [status, setStatus] = useState(initial.current ? "Checking Cloud…" : initialEnrollment.current ? "Cloud Setup Not Confirmed" : "Off");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState(initial.current?.recoveryCode || initialEnrollment.current?.recoveryCode || "");
  const [remembered, setRemembered] = useState(Boolean(initial.current || initialEnrollment.current));
  const [cloudPreview, setCloudPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [tick, setTick] = useState(0);

  function clearEnrollment() {
    enrollment.current = null; retainedEnrollmentCode.current = "";
    try { localStorage.removeItem(VAULT_ENROLLMENT_LOCAL_KEY); } catch { /* A retained copy still requires its owner's private code. */ }
  }

  function persist(next) {
    connection.current = next;
    if (!confirmed.current) return;
    try { if (remember.current) localStorage.setItem(VAULT_LOCAL_KEY, JSON.stringify(next)); else localStorage.removeItem(VAULT_LOCAL_KEY); }
    catch { throw new Error("Cloud storage saved, but this browser could not keep your connection. Keep your recovery code before closing this page."); }
  }
  async function run(operation) {
    if (!enabled || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    const activeGeneration = generation.current;
    try { return await operation(() => activeGeneration === generation.current); }
    catch (failure) {
      if (activeGeneration === generation.current) {
        blocked.current = true;
        setError(failure.message || "Cloud storage is unavailable. Your reminders remain on this device.");
        setStatus(failure.code === "creation_uncertain" ? "Cloud Setup Not Confirmed" : failure.code === "conflict" ? "Conflict — Local Changes Kept" : "Not Saved to Cloud");
        callbacks.current.onNotice?.(failure.message || "Your changes have not been saved to cloud storage.");
      }
    } finally { if (activeGeneration === generation.current) { pending.current = false; setBusy(false); } }
  }
  async function saveCurrent(active) {
    if (!confirmed.current) throw new Error("Review the cloud preview and choose a version before saving.");
    const current = latest.current, hash = await fingerprint(current);
    if (!connection.current || hash === connection.current.lastSavedFingerprint) { lastSavedSnapshot.current = JSON.stringify(current); setStatus("Saved to Cloud"); return; }
    setStatus("Saving to Cloud…");
    const result = await client.current.save(current, connection.current.revision);
    if (!active()) return;
    persist({ ...connection.current, revision: result.revision, lastSavedFingerprint: hash });
    lastSavedSnapshot.current = JSON.stringify(current);
    blocked.current = false; setStatus("Saved to Cloud"); setTick(value => value + 1);
  }
  async function checkCloud(active) {
    const remote = await client.current.read();
    if (!active()) return;
    setHistory(remote.history || []);
    if (!confirmed.current || remote.revision !== connection.current.revision) {
      blocked.current = true; setCloudPreview(remote); setStatus(confirmed.current ? "Cloud Changes Available" : "Review Cloud Reminders");
    } else {
      const unchanged = await fingerprint(latest.current) === connection.current.lastSavedFingerprint;
      if (unchanged) lastSavedSnapshot.current = JSON.stringify(latest.current);
      ready.current = true; blocked.current = false; setStatus(unchanged ? "Saved to Cloud" : "Local Changes Pending"); setTick(value => value + 1);
    }
  }
  useEffect(() => {
    if (!enabled || !connection.current) return;
    try {
      // A stored recovery code is only sent as derived credentials to the configured endpoint.
      if (!endpoint || connection.current.endpoint !== endpoint) throw new Error("The cloud server changed. Reconnect with your recovery code; local reminders are unchanged.");
      client.current = createCloudVaultClient(connection.current);
      run(checkCloud);
    } catch (failure) { blocked.current = true; setError(failure.message); setStatus("Not Saved to Cloud"); }
    return () => { generation.current++; ready.current = false; pending.current = false; };
  }, [enabled, endpoint]);

  const serialized = JSON.stringify(snapshot);
  useEffect(() => {
    if (!enabled || !ready.current || !confirmed.current || blocked.current || !connection.current || pending.current || serialized === lastSavedSnapshot.current) return;
    setStatus("Local Changes Pending");
    const timeout = setTimeout(() => run(saveCurrent), 1500);
    return () => clearTimeout(timeout);
  }, [enabled, serialized, tick]);

  return {
    enabled, configured: Boolean(endpoint), connected: Boolean(connection.current), status, error, busy, recoveryCode, remembered, cloudPreview, history,
    create({ remember: keep = false } = {}) {
      if (!endpoint) { setError("Private cloud storage is not configured."); return; }
      if (connection.current) return;
      return run(async active => {
        remember.current = keep === true; setRemembered(remember.current);
        if (!validateVaultSnapshot(latest.current)) throw new Error("Your reminders exceed the cloud storage limit or contain invalid values. Local reminders are unchanged.");
        if (!enrollment.current) {
          const code = retainedEnrollmentCode.current || createVaultRecoveryCode();
          enrollment.current = { code, snapshot: JSON.parse(JSON.stringify(latest.current)), client: createCloudVaultClient({ endpoint, recoveryCode: code }), resuming: Boolean(retainedEnrollmentCode.current) };
        }
        const { code, snapshot: current, client: nextClient } = enrollment.current;
        setRecoveryCode(code);
        try {
          if (remember.current) localStorage.setItem(VAULT_ENROLLMENT_LOCAL_KEY, JSON.stringify({ version: 1, endpoint, recoveryCode: code }));
          else localStorage.removeItem(VAULT_ENROLLMENT_LOCAL_KEY);
        } catch { throw new Error("This browser could not remember your recovery code. Save it privately and retry with Remember on This Device off; nothing new was uploaded."); }
        let result;
        if (enrollment.current.resuming) {
          try {
            const remote = await nextClient.read();
            if (!active()) return;
            client.current = nextClient; confirmed.current = false; ready.current = false;
            connection.current = { version: 1, endpoint, recoveryCode: code, revision: remote.revision, lastSavedFingerprint: await fingerprint(remote.snapshot) };
            setCloudPreview(remote); setHistory(remote.history || []); blocked.current = true; setStatus("Review Cloud Reminders");
            return;
          } catch (failure) {
            if (failure.code !== "unauthorized") throw Object.assign(new Error("Cloud setup could not be confirmed. Keep your recovery code and retry Enable Cloud Storage to check the same backup. Your local reminders are unchanged."), { code: "creation_uncertain" });
            enrollment.current.resuming = false;
          }
        }
        try { result = await nextClient.create(current); }
        catch (failure) {
          if (failure.code === "conflict") {
            const remote = await nextClient.read();
            if (!active()) return;
            client.current = nextClient; confirmed.current = false; ready.current = false;
            connection.current = { version: 1, endpoint, recoveryCode: code, revision: remote.revision, lastSavedFingerprint: await fingerprint(remote.snapshot) };
            setCloudPreview(remote); setHistory(remote.history || []); blocked.current = true; setStatus("Review Cloud Reminders");
            return;
          }
          if (["offline", "cloud_error"].includes(failure.code)) throw Object.assign(new Error("Cloud setup could not be confirmed. Keep your recovery code and retry Enable Cloud Storage to check the same backup. Your local reminders are unchanged."), { code: "creation_uncertain" });
          throw failure;
        }
        if (!active()) return;
        client.current = nextClient;
        confirmed.current = true;
        persist({ version: 1, endpoint, recoveryCode: code, revision: result.revision, lastSavedFingerprint: await fingerprint(current) });
        clearEnrollment();
        lastSavedSnapshot.current = JSON.stringify(current);
        ready.current = true; blocked.current = false; setStatus("Saved to Cloud"); setTick(value => value + 1);
      });
    },
    connect(code, { remember: keep = false } = {}) {
      if (!endpoint || connection.current) return;
      return run(async active => {
        remember.current = keep === true; setRemembered(remember.current);
        const nextClient = createCloudVaultClient({ endpoint, recoveryCode: code });
        const remote = await nextClient.read();
        if (!active()) return;
        client.current = nextClient;
        confirmed.current = false; ready.current = false;
        connection.current = { version: 1, endpoint, recoveryCode: code.trim(), revision: remote.revision, lastSavedFingerprint: await fingerprint(remote.snapshot) };
        setRecoveryCode(code.trim()); setCloudPreview(remote); setHistory(remote.history || []);
        blocked.current = true; setStatus("Review Cloud Reminders");
      });
    },
    useCloudVersion() {
      if (!cloudPreview || pending.current) return;
      return run(async () => {
        if (!validateVaultSnapshot(cloudPreview.snapshot)) throw new Error("The cloud preview is invalid. Local reminders are unchanged.");
        await callbacks.current.onRestore(cloudPreview.snapshot);
        confirmed.current = true;
        persist({ ...connection.current, ...(cloudPreview.historical ? {} : { revision: cloudPreview.revision }), lastSavedFingerprint: cloudPreview.historical ? "0".repeat(64) : await fingerprint(cloudPreview.snapshot) });
        clearEnrollment();
        lastSavedSnapshot.current = cloudPreview.historical ? "" : JSON.stringify(cloudPreview.snapshot);
        setCloudPreview(null); ready.current = true; blocked.current = false; setStatus(cloudPreview.historical ? "Saving Restored Backup…" : "Saved to Cloud"); setTick(value => value + 1);
      });
    },
    keepLocalVersion() {
      if (!cloudPreview || pending.current) return;
      return run(async active => {
        confirmed.current = true;
        persist({ ...connection.current, revision: cloudPreview.historical ? connection.current.revision : cloudPreview.revision, lastSavedFingerprint: "0".repeat(64) });
        clearEnrollment();
        setCloudPreview(null); ready.current = true; blocked.current = false;
        await saveCurrent(active);
      });
    },
    refresh() { if (!client.current || !connection.current) return; return run(checkCloud); },
    retry() { if (!client.current || !connection.current || !confirmed.current) return; blocked.current = false; return run(saveCurrent); },
    setRemembered(value) {
      if (pending.current) return;
      remember.current = value === true; setRemembered(remember.current);
      try {
        if (connection.current && confirmed.current) persist(connection.current);
        else if (!remember.current) localStorage.removeItem(VAULT_LOCAL_KEY);
        if (!remember.current) localStorage.removeItem(VAULT_ENROLLMENT_LOCAL_KEY);
        else if (enrollment.current && connection.current?.recoveryCode === enrollment.current.code) localStorage.setItem(VAULT_ENROLLMENT_LOCAL_KEY, JSON.stringify({ version: 1, endpoint, recoveryCode: enrollment.current.code }));
      }
      catch (failure) { setError(failure.message); callbacks.current.onNotice?.(failure.message); }
    },
    previewHistory(revision) {
      if (!client.current || !connection.current) return;
      return run(async active => {
        const remote = await client.current.readHistory(revision);
        if (active()) { setCloudPreview({ ...remote, historical: true }); blocked.current = true; setStatus("Review Previous Backup"); }
      });
    },
    disconnect() {
      if (pending.current) return;
      generation.current++; ready.current = false; blocked.current = false;
      connection.current = null; client.current = null;
      clearEnrollment();
      confirmed.current = false; lastSavedSnapshot.current = "";
      remember.current = false; setRemembered(false);
      try { localStorage.removeItem(VAULT_LOCAL_KEY); } catch { callbacks.current.onNotice?.("This browser could not remove the saved connection. Clear its site data to disconnect fully."); }
      setRecoveryCode(""); setCloudPreview(null); setHistory([]); setError(""); setStatus("Off"); setTick(value => value + 1);
    },
  };
}
