export const GOOGLE_SCOPES = Object.freeze({
  calendar: "https://www.googleapis.com/auth/calendar.readonly",
  tasks: "https://www.googleapis.com/auth/tasks.readonly",
  taskCompletion: "https://www.googleapis.com/auth/tasks",
});

const providers = ["google-calendar", "google-tasks"];
const fail = (code, message) => Object.assign(new Error(message), { code });
const identifier = (value) => typeof value === "string" && value.trim() && value.length <= 2048;
const string = (value, fallback = "") => typeof value === "string" ? value : fallback;
const dateOnly = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const safeURL = (value) => { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? value : ""; } catch { return ""; } };
const instant = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

let identityPromise;
export function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve(globalThis.google.accounts.oauth2);
  if (!globalThis.document) return Promise.reject(fail("unavailable", "Google connections require a browser."));
  if (!identityPromise) identityPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.referrerPolicy = "strict-origin-when-cross-origin";
    const timer = setTimeout(() => { script.remove(); identityPromise = null; reject(fail("identity_unavailable", "Google sign-in could not load. Try again.")); }, 15000);
    script.onload = () => {
      clearTimeout(timer);
      if (globalThis.google?.accounts?.oauth2) resolve(globalThis.google.accounts.oauth2);
      else { identityPromise = null; reject(fail("identity_unavailable", "Google sign-in is unavailable. Try again.")); }
    };
    script.onerror = () => { clearTimeout(timer); script.remove(); identityPromise = null; reject(fail("identity_unavailable", "Google sign-in could not load. Try again.")); };
    document.head.appendChild(script);
  });
  return identityPromise;
}

// Google credentials stay in this closure; callers only receive connection status and selected records.
export function createGoogleAccounts({ clientId = "", fetch: fetcher = globalThis.fetch, loadIdentity = loadGoogleIdentity, now = () => Date.now() } = {}) {
  const configured = typeof clientId === "string" && /^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId);
  const sessions = new Map(), selectedTasks = new Map(), pending = new Set();
  let generation = 0, identity;
  const checkProvider = (provider) => { if (!providers.includes(provider)) throw fail("invalid_provider", "Choose Google Calendar or Google Tasks."); };
  const session = (provider) => {
    checkProvider(provider);
    const value = sessions.get(provider);
    if (!value || value.expiresAt <= now() + 5000) { sessions.delete(provider); throw fail("auth_expired", "Connect your Google account to continue."); }
    return value;
  };
  function state(provider) {
    checkProvider(provider);
    const value = sessions.get(provider);
    if (value && value.expiresAt <= now() + 5000) sessions.delete(provider);
    const active = sessions.get(provider);
    return { configured, connected: Boolean(active), writeback: Boolean(active?.writeback), expiresAt: active?.expiresAt || null };
  }
  async function prepare() {
    if (!configured) throw fail("not_configured", "A Google OAuth web client ID is required for this deployment.");
    identity ||= await loadIdentity();
    return { ready: true };
  }
  function connect(provider, { writeback = false } = {}) {
    checkProvider(provider);
    if (!configured) throw fail("not_configured", "A Google OAuth web client ID is required for this deployment.");
    if (!identity) throw fail("identity_not_ready", "Load Google sign-in first, then choose Continue with Google.");
    if (provider === "google-calendar" && writeback) throw fail("readonly", "Google Calendar is read-only.");
    if (pending.size) throw fail("connect_pending", "Finish the current Google sign-in first.");
    const version = ++generation;
    sessions.delete(provider);
    if (provider === "google-tasks") selectedTasks.clear();
    const scope = provider === "google-calendar" ? GOOGLE_SCOPES.calendar : writeback ? GOOGLE_SCOPES.taskCompletion : GOOGLE_SCOPES.tasks;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error, value) => {
        if (finished) return;
        finished = true; clearTimeout(timer); pending.delete(cancel);
        error ? reject(error) : resolve(value);
      };
      const cancel = () => finish(fail("disconnected", "The connection was cancelled."));
      const timer = setTimeout(() => finish(fail("popup_timeout", "Google sign-in did not finish. Try again.")), 120000);
      pending.add(cancel);
      try {
        const client = identity.initTokenClient({
          client_id: clientId, scope, include_granted_scopes: false, prompt: "select_account",
          callback: (response) => {
            if (finished) return;
            if (version !== generation) return cancel();
            if (!response || response.error) return finish(fail("consent_denied", "Google connection was not approved."));
            const granted = new Set(string(response.scope).split(/\s+/));
            if (!granted.has(scope) || typeof response.access_token !== "string" || !response.access_token || response.access_token.length > 16384 || !Number.isFinite(Number(response.expires_in)) || Number(response.expires_in) <= 5 || Number(response.expires_in) > 86400)
              return finish(fail("permission_denied", "Google did not grant the requested permission."));
            sessions.set(provider, { token: response.access_token, expiresAt: now() + Number(response.expires_in) * 1000, writeback: provider === "google-tasks" && writeback === true });
            finish(null, state(provider));
          },
          error_callback: (error) => finish(fail(error?.type === "popup_closed" ? "popup_closed" : "popup_failed", error?.type === "popup_closed" ? "Google sign-in was closed." : "Allow the Google sign-in popup and try again.")),
        });
        client.requestAccessToken();
      } catch { finish(fail("identity_unavailable", "Google sign-in could not start. Try again.")); }
    });
  }
  async function request(provider, path, params = {}, options = {}) {
    const active = session(provider), version = generation;
    const url = new URL(`https://www.googleapis.com/${path}`);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      let response;
      try { response = await fetcher(url.href, { ...options, signal: controller.signal, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { ...options.headers, Authorization: `Bearer ${active.token}` } }); }
      catch { throw fail("network_error", "Google could not be reached. Your local reminders are unchanged."); }
      if (version !== generation) throw fail("disconnected", "The connection changed. Try again.");
      if (response.status === 401) { sessions.delete(provider); throw fail("auth_expired", "Google access expired. Connect again."); }
      if (!response.ok) throw fail(response.status === 403 ? "permission_denied" : response.status === 429 ? "quota_limited" : response.status === 412 ? "conflict" : "provider_error", response.status === 412 ? "The Google task changed. Refresh before completing it." : "Google could not complete this request. Your local reminders are unchanged.");
      let result;
      try { result = await response.json(); } catch { throw fail("invalid_response", "Google returned an unreadable response."); }
      if (version !== generation) throw fail("disconnected", "The connection changed. Try again.");
      if (!result || typeof result !== "object" || Array.isArray(result) || JSON.stringify(result).length > 2 * 1024 * 1024) throw fail("invalid_response", "Google returned an invalid or oversized response.");
      return result;
    } finally { clearTimeout(timer); }
  }
  async function pages(provider, path, params = {}, limit = 10000) {
    const items = [], seen = new Set();
    let pageToken;
    for (let page = 0; page < 100; page++) {
      const response = await request(provider, path, { ...params, pageToken });
      if (response.items !== undefined && (!Array.isArray(response.items) || response.items.some(item => !item || typeof item !== "object" || Array.isArray(item)))) throw fail("invalid_response", "Google returned an invalid collection.");
      items.push(...(response.items || []));
      if (items.length > limit) throw fail("too_many_records", "This selection is too large. Select fewer lists or a shorter date range.");
      pageToken = response.nextPageToken;
      if (!pageToken) return items;
      if (!identifier(pageToken) || seen.has(pageToken)) throw fail("invalid_response", "Google pagination did not finish. No records were imported.");
      seen.add(pageToken);
    }
    throw fail("too_many_records", "Google pagination reached its limit. No records were imported.");
  }
  async function listSources(provider) {
    checkProvider(provider);
    const items = await pages(provider, provider === "google-calendar" ? "calendar/v3/users/me/calendarList" : "tasks/v1/users/@me/lists", { maxResults: 100 }, 1000);
    const ids = new Set();
    return items.filter(item => !item.deleted && item.accessRole !== "freeBusyReader").map(item => {
      if (!identifier(item.id) || item.id === "primary" || ids.has(item.id)) throw fail("invalid_response", "Google returned invalid list identifiers.");
      ids.add(item.id);
      return { id: item.id, name: string(item.summaryOverride || item.summary || item.title, provider === "google-calendar" ? "Calendar" : "Tasks"), ...(provider === "google-calendar" && /^#[\da-f]{6}$/i.test(item.backgroundColor) ? { color: item.backgroundColor } : {}) };
    });
  }
  async function snapshot(provider, sources, { timeMin, timeMax } = {}) {
    checkProvider(provider); session(provider);
    if (!Array.isArray(sources) || !sources.length || sources.length > 50 || sources.some(source => !source || !identifier(source.id) || source.id === "primary" || typeof source.name !== "string") || new Set(sources.map(source => source.id)).size !== sources.length)
      throw fail("invalid_selection", "Choose between 1 and 50 distinct lists.");
    const version = generation, generatedAt = new Date(now()).toISOString();
    const from = timeMin || new Date(now() - 30 * 86400000).toISOString(), until = timeMax || new Date(now() + 365 * 86400000).toISOString();
    if (provider === "google-calendar" && (!instant(from) || !instant(until) || Date.parse(from) >= Date.parse(until))) throw fail("invalid_range", "Choose a valid calendar date range.");
    const lists = [];
    let total = 0;
    for (const source of sources) {
      const items = await pages(provider, provider === "google-calendar" ? `calendar/v3/calendars/${encodeURIComponent(source.id)}/events` : `tasks/v1/lists/${encodeURIComponent(source.id)}/tasks`, provider === "google-calendar" ? { maxResults: 250, singleEvents: true, showDeleted: false, orderBy: "startTime", timeMin: from, timeMax: until } : { maxResults: 100, showCompleted: true, showHidden: true, showDeleted: false }, 10000 - total);
      const reminders = items.filter(item => !item.deleted && item.status !== "cancelled").map(item => provider === "google-calendar" ? calendarReminder(item) : taskReminder(item, generatedAt));
      total += reminders.length;
      if (new Set(reminders.map(item => item.id)).size !== reminders.length) throw fail("invalid_response", "Google returned duplicate records.");
      lists.push({ ...source, reminders });
    }
    if (version !== generation) throw fail("disconnected", "The connection changed. No records were imported.");
    if (provider === "google-tasks") {
      selectedTasks.clear();
      for (const list of lists) selectedTasks.set(list.id, new Map(list.reminders.map(item => [item.id, item.etag])));
    }
    return { provider, generatedAt, lists, ...(provider === "google-calendar" ? { range: { timeMin: from, timeMax: until } } : {}) };
  }
  async function completeTask(sourceListId, taskId, { etag } = {}) {
    if (!session("google-tasks").writeback) throw fail("writeback_disabled", "Enable Google Tasks completion permission first.");
    const version = generation;
    const selected = selectedTasks.get(sourceListId);
    if (!identifier(taskId) || !selected?.has(taskId)) throw fail("not_selected", "Only a selected, imported Google task can be completed.");
    const path = `tasks/v1/lists/${encodeURIComponent(sourceListId)}/tasks/${encodeURIComponent(taskId)}`;
    const current = await request("google-tasks", path);
    if (version !== generation) throw fail("disconnected", "The connection changed. Refresh to verify completion.");
    if (selectedTasks.get(sourceListId) !== selected || !selected.has(taskId)) throw fail("not_selected", "The selected Google Tasks preview changed. Refresh before completing this task.");
    if (current.id !== taskId || current.deleted) throw fail("conflict", "The Google task is unavailable. Refresh first.");
    if (!["needsAction", "completed"].includes(current.status)) throw fail("invalid_response", "Google returned an invalid task status. Refresh before completing it.");
    if (current.status === "completed") return taskReminder(current, new Date(now()).toISOString());
    const expected = etag || selected.get(taskId);
    if (!expected || current.etag !== expected) throw fail("conflict", "The Google task changed. Refresh before completing it.");
    const result = await request("google-tasks", path, {}, { method: "PATCH", headers: { "Content-Type": "application/json", "If-Match": current.etag }, body: JSON.stringify({ status: "completed" }) });
    if (version !== generation) throw fail("disconnected", "The connection changed. Refresh to verify completion.");
    if (result.id !== taskId || result.status !== "completed" || result.deleted) throw fail("verification_failed", "Google did not confirm this task was completed. Refresh to check its status.");
    return taskReminder(result, new Date(now()).toISOString());
  }
  async function disconnect({ revoke = false } = {}) {
    const tokens = [...new Set([...sessions.values()].map(value => value.token))];
    ++generation; sessions.clear(); selectedTasks.clear();
    for (const cancel of [...pending]) cancel();
    if (revoke && tokens.length) {
      identity ||= await loadIdentity();
      await Promise.all(tokens.map(token => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(fail("revoke_failed", "Disconnected locally. Remove this app in your Google Account to finish revoking access.")), 15000);
        identity.revoke(token, result => { clearTimeout(timer); result?.successful || result?.error === "invalid_token" ? resolve() : reject(fail("revoke_failed", "Disconnected locally. Remove this app in your Google Account to finish revoking access.")); });
      })));
    }
  }
  return { state, prepare, connect, listSources, snapshot, completeTask, disconnect };
}

function taskReminder(item, generatedAt) {
  if (!item || !identifier(item.id) || !["needsAction", "completed"].includes(item.status)) throw fail("invalid_response", "Google returned an invalid task.");
  const date = item.due?.slice(0, 10);
  if (date && !dateOnly(date)) throw fail("invalid_response", "Google returned an invalid task date.");
  return { id: item.id, title: string(item.title).trim() || "Untitled Task", notes: string(item.notes), url: safeURL(item.webViewLink || item.links?.[0]?.link), dueDate: date || null, dueTime: null, dueInstant: null, completed: item.status === "completed", completedAt: item.status === "completed" ? instant(item.completed) || generatedAt : null, parentId: identifier(item.parent) ? item.parent : null, etag: string(item.etag) };
}

function calendarReminder(item) {
  if (!item || !identifier(item.id) || !item.start) throw fail("invalid_response", "Google returned an invalid calendar event.");
  const start = item.start, end = item.end || {};
  let dueDate, dueTime = null, dueInstant = null;
  if (start.date) {
    if (!dateOnly(start.date) || !dateOnly(end.date) || end.date <= start.date) throw fail("invalid_response", "Google returned an invalid all-day event.");
    // Calendar's end date is exclusive; the reminder is scheduled on the start day.
    dueDate = start.date;
  } else {
    dueInstant = instant(start.dateTime);
    if (!dueInstant) throw fail("invalid_response", "Google returned an invalid event time.");
    const date = new Date(dueInstant);
    dueDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    dueTime = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return { id: item.id, title: string(item.summary).trim() || "Untitled Event", notes: string(item.description), url: safeURL(item.htmlLink), location: string(item.location), dueDate, dueTime, dueInstant, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, completed: false, completedAt: null, parentId: null, etag: string(item.etag) };
}
