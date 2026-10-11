import React, { useCallback, useEffect, useRef, useState } from "react";
import App from "../App";
import { createApiClient } from "./api";
import "./auth.css";
import { NativeTemplateImport } from "./NativeTemplateShare.jsx";
import { useTemplate } from "./templates.js";
import AgentSettings from "./AgentSettings.jsx";
import DeviceSettings from "./DeviceSettings.jsx";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function exportDraft(data) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "reminders-unsaved-draft.json";
  link.click();
  URL.revokeObjectURL(url);
}

export default function ServerApp() {
  const api = useRef(null);
  if (!api.current) api.current = createApiClient({ onUnauthenticated: failure });
  const [phase, setPhase] = useState("loading"),
    [initial, setInitial] = useState(null),
    [incoming, setIncoming] = useState(null),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false);
  const [sharedTemplate, setSharedTemplate] = useState(null), [sharedError, setSharedError] = useState("");
  const [agentsEnabled, setAgentsEnabled] = useState(false);
  useEffect(() => { let active = true; fetch('/api/agent/discovery', { credentials: 'omit', cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(result => { if (active) setAgentsEnabled(result?.enabled === true); }).catch(() => {}); return () => { active = false; }; }, []);
  const pending = useRef(null),
    timer = useRef(null),
    writing = useRef(false),
    stopped = useRef(false),
    version = useRef(0),
    local = useRef(null),
    mounted = useRef(true);
  const dirty = () =>
    Boolean(pending.current || writing.current || stopped.current);

  function failure(e) {
    if (!mounted.current) return;
    stopped.current = true;
    setBlocked(true);
    setStatus(
      e.status === 409
        ? "Conflict: your local draft is preserved. Export it or reload explicitly."
        : e.message,
    );
    if (e.status === 401) {
      setPhase("login");
      setError("Your session expired. Sign in to recover your unsaved draft.");
    }
  }
  async function flush() {
    timer.current = null;
    if (writing.current || stopped.current || !pending.current) return;
    const draft = pending.current,
      sentVersion = version.current;
    pending.current = null;
    writing.current = true;
    setStatus("Saving…");
    try {
      const snapshot = await api.current.saveData(draft);
      if (!mounted.current) return;
      if (sentVersion === version.current && !pending.current) {
        local.current = snapshot.data;
        setIncoming(snapshot.data);
        setStatus("Saved");
      }
    } catch (e) {
      if (!pending.current) pending.current = draft;
      failure(e);
    } finally {
      writing.current = false;
      if (pending.current && !stopped.current && mounted.current)
        timer.current = setTimeout(flush, 250);
    }
  }
  const changed = useCallback((data) => {
    local.current = data;
    version.current += 1;
    if (same(data, api.current.snapshot?.data) && !writing.current) {
      pending.current = null;
      clearTimeout(timer.current);
      if (!stopped.current) setStatus("Saved");
      return;
    }
    pending.current = data;
    if (stopped.current) return;
    setStatus("Unsaved changes");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 250);
  }, []);
  async function load({ discard = false } = {}) {
    setBusy(true);
    setError("");
    try {
      const session = await api.current.session();
      if (!session.authenticated) {
        setPhase("login");
        return;
      }
      // A session recovery must not silently discard an expired session's local draft.
      if (stopped.current && local.current && !discard) {
        setInitial(local.current);
        setIncoming(local.current);
        setPhase("ready");
        return;
      }
      const snapshot = await api.current.getState();
      pending.current = null;
      stopped.current = false;
      setBlocked(false);
      local.current = snapshot.data;
      setInitial(snapshot.data);
      setIncoming(snapshot.data);
      setStatus("Saved");
      setPhase("ready");
    } catch (e) {
      if (e.status === 401) setPhase("login");
      else {
        setPhase("unavailable");
        setError(e.message);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    load();
    const unload = (event) => {
      if (dirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    const poll = setInterval(async () => {
      if (
        dirty() ||
        document.visibilityState === "hidden" ||
        !api.current.snapshot
      )
        return;
      const checkedVersion = version.current;
      try {
        let changes;
        try {
          changes = await api.current.getChanges(api.current.snapshot.sequence);
        } catch (e) {
          if (e.status !== 410 || !e.resync) throw e;
          changes = { events: [true] };
        }
        if (
          !changes.events?.length ||
          dirty() ||
          checkedVersion !== version.current
        )
          return;
        const snapshot = await api.current.getState({
          accept: () => !dirty() && checkedVersion === version.current,
        });
        if (dirty() || checkedVersion !== version.current || !mounted.current)
          return;
        local.current = snapshot.data;
        setIncoming(snapshot.data);
        setStatus("Saved");
      } catch (e) {
        failure(e);
      }
    }, 15000);
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      clearInterval(poll);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let generation = 0;
    async function consumeLink() {
      const token = window.location.hash.match(/^#template=([A-Za-z0-9_-]{43})$/)?.[1];
      if (!token) return;
      const requestGeneration = ++generation;
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setSharedError("");
      setSharedTemplate(null);
      try { const result = await api.current.readSharedTemplate(token); if (active && requestGeneration === generation) setSharedTemplate(result.template); }
      catch { if (active && requestGeneration === generation) setSharedError("This shared template is unavailable."); }
    }
    consumeLink(); window.addEventListener("hashchange", consumeLink);
    return () => { active = false; window.removeEventListener("hashchange", consumeLink); };
  }, []);
  useEffect(() => {
    if (!sharedTemplate) return;
    const handle = event => {
      if (event.metaKey || event.ctrlKey) {
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, [sharedTemplate, busy]);

  async function importTemplate(name) {
    if (dirty() || writing.current) { setSharedError("Save your changes before creating this list."); return; }
    setBusy(true); setSharedError("");
    try {
      const current = api.current.snapshot;
      const template = { ...structuredClone(sharedTemplate), id: crypto.randomUUID() };
      const result = useTemplate({ ...current.data, templates: [...(current.data.templates || []), template] }, template.id, name);
      const saved = await api.current.saveData(result.data);
      local.current = saved.data; setIncoming(saved.data); setStatus("Saved"); setSharedTemplate(null);
    } catch (error) { if (error.status === 401) failure(error); else setSharedError(error.message); }
    finally { setBusy(false); }
  }

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.current.login(password);
      setPassword("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    if (
      dirty() &&
      !window.confirm(
        "Your unsaved draft will be lost when you sign out. Export it first if you need to keep it. Sign out?",
      )
    )
      return;
    clearTimeout(timer.current);
    stopped.current = true;
    setBusy(true);
    try {
      await api.current.logout();
      pending.current = null;
      stopped.current = false;
      setBlocked(false);
      local.current = null;
      setInitial(null);
      setIncoming(null);
      setStatus("");
      setPhase("login");
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {phase !== "ready" && (
        <main className="auth-gate">
          <section className="auth-card" aria-labelledby="auth-title">
            <h1 id="auth-title">Reminders</h1>
            {phase === "loading" ? (
              <p role="status">Checking your session…</p>
            ) : phase === "unavailable" ? (
              <>
                <p role="alert">Server unavailable. {error}</p>
                <button disabled={busy} onClick={() => load()}>
                  Try Again
                </button>
              </>
            ) : (
              <form onSubmit={signIn}>
                <p>This private workspace requires its access password.</p>
                <label htmlFor="workspace-password">Workspace password</label>
                <input
                  id="workspace-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {error && <p role="alert">{error}</p>}
                {sharedTemplate && <p>A shared template is ready. Sign in to create a list.</p>}
                {sharedError && <p role="alert">{sharedError}</p>}
                <button disabled={busy}>
                  {busy ? "Signing In…" : "Sign In"}
                </button>
              </form>
            )}
          </section>
        </main>
      )}
      {initial && (
        <div
          className="server-root"
          hidden={phase !== "ready"}
          inert={phase !== "ready" ? true : undefined}
        >
          {blocked && (
            <div className="workspace-session">
              <span role="alert">{status}</span>
              <button onClick={() => exportDraft(local.current)}>
                Export Draft
              </button>
              <button
                disabled={busy || writing.current}
                onClick={() => {
                  if (
                    window.confirm(
                      "Discard your local draft and load the saved workspace?",
                    )
                  ) {
                    clearTimeout(timer.current);
                    load({ discard: true });
                  }
                }}
              >
                Reload Saved
              </button>
              <button disabled={busy} onClick={signOut}>
                Sign Out
              </button>
            </div>
          )}
          {window.location.pathname.replace(/\/$/, '') === '/settings/devices' ? <DeviceSettings api={api.current} /> : window.location.pathname.replace(/\/$/, '') === '/settings/agents' ? <AgentSettings api={api.current} active={phase === 'ready'} /> : <App
            initialData={initial}
            incomingData={incoming}
            onDataChange={changed}
            api={api.current}
            onApiError={failure}
            saveStatus={status}
            agentsEnabled={agentsEnabled}
          />}
          {sharedError && <div className="workspace-session"><span role="alert">{sharedError}</span><button onClick={() => setSharedError("")}>Dismiss</button></div>}
          {sharedTemplate && <div className="modal-backdrop"><div className="modal native-template-modal"><NativeTemplateImport template={sharedTemplate} busy={busy} onClose={() => setSharedTemplate(null)} onCreate={importTemplate} /></div></div>}
        </div>
      )}
    </>
  );
}
