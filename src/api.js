import { validateStoredData } from "./model.js";

export class ApiError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.resync = Boolean(details.resync);
  }
}

export function createApiClient({ fetchImpl = globalThis.fetch, onUnauthenticated = () => {} } = {}) {
  let latest = null,
    queue = Promise.resolve(),
    conflict = null;
  const enqueue = (operation) => {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetchImpl(`/api${path}`, {
        ...options,
        credentials: options.credentials ?? "include",
        cache: "no-store",
      });
    } catch {
      throw new ApiError(
        0,
        "Cannot reach the server. Your unsaved changes are preserved.",
      );
    }
    if (response.status === 401 && path !== "/auth/login" && options.credentials !== "omit") onUnauthenticated(new ApiError(401, "Your session expired. Sign in to recover your unsaved draft."));
    let result;
    try {
      result = await response.json();
    } catch {
      throw new ApiError(
        response.status || 502,
        "The server returned an unreadable response.",
      );
    }
    if (!response.ok)
      throw new ApiError(
        response.status,
        result.error || "Request failed",
        result,
      );
    return result;
  }
  function remember(result) {
    if (
      !validateStoredData(result.data) ||
      !Number.isSafeInteger(result.revision) ||
      result.revision < 0 ||
      !Number.isSafeInteger(result.sequence) ||
      result.sequence < 0
    ) {
      throw new ApiError(502, "The server returned an invalid workspace.");
    }
    latest = { data: result.data, revision: result.revision, sequence: result.sequence };
    return result;
  }
  async function mutate(path, options) {
    if (conflict) throw conflict;
    if (!latest) throw new ApiError(428, "Load the workspace before saving.");
    try {
      return remember(
        await request(path, {
          ...options,
          headers: { ...options.headers, "If-Match": String(latest.revision) },
        }),
      );
    } catch (error) {
      // A conflicting draft needs an explicit reload; queued writes must not retry it.
      if (error.status === 409 || error.status === 0 || error.status >= 500)
        conflict = error;
      throw error;
    }
  }
  return {
    get snapshot() {
      return latest;
    },
    getState: ({ accept = () => true } = {}) =>
      enqueue(async () => {
        const result = await request("/state");
        if (!accept()) {
          conflict = new ApiError(
            409,
            "Your draft changed while fetching the workspace. Export it or reload explicitly.",
          );
          throw conflict;
        }
        remember(result);
        conflict = null;
        return result;
      }),
    saveData: (data) => {
      const body = JSON.stringify({ data: { ...data, ...(data.templates ? { templates: data.templates.map(({ files, ...template }) => template) } : {}) } });
      return enqueue(() =>
        mutate("/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        }),
      );
    },
    uploadAttachment: (reminderId, file) =>
      enqueue(() => {
        const body = new FormData();
        body.append("file", file);
        return mutate(
          `/reminders/${encodeURIComponent(reminderId)}/attachments`,
          { method: "POST", body },
        );
      }),
    deleteAttachment: (id) =>
      enqueue(() =>
        mutate(`/attachments/${encodeURIComponent(id)}`, { method: "DELETE" }),
      ),
    saveTemplate: (listId, name, includeCompleted) => enqueue(() => mutate("/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listId, name, includeCompleted }) })),
    useTemplate: (id, name, editedTemplate, deletedAttachmentIds = []) => { const record = editedTemplate && (({ files, ...template }) => template)(editedTemplate); const body = JSON.stringify({ name, ...(record ? { template: record, deletedAttachmentIds } : {}) }); return enqueue(() => mutate(`/templates/${encodeURIComponent(id)}/use`, { method: "POST", headers: { "Content-Type": "application/json" }, body })); },
    updateTemplate: (template, deletedAttachmentIds = []) => { const { files, ...record } = template; const body = JSON.stringify({ template: record, deletedAttachmentIds }); return enqueue(() => mutate(`/templates/${encodeURIComponent(template.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body })); },
    uploadTemplateAttachment: (templateId, reminderId, file) => enqueue(() => { const body = new FormData(); body.append("file", file); return mutate(`/templates/${encodeURIComponent(templateId)}/reminders/${encodeURIComponent(reminderId)}/attachments`, { method: "POST", body }); }),
    deleteTemplateAttachment: id => enqueue(() => mutate(`/template-attachments/${encodeURIComponent(id)}`, { method: "DELETE" })),
    getChanges: (since) =>
      request(`/changes?since=${encodeURIComponent(since)}`),
    ownerAgents: (method, path, payload) => {
      if (!['GET', 'POST', 'DELETE'].includes(method) || !/^\/(?:agents(?:\/[A-Za-z0-9_-]+(?:\/tokens(?:\/[A-Za-z0-9_-]+)?)?)?|reminders\/[A-Za-z0-9_-]+\/delegation)$/.test(path)) throw new ApiError(400, 'Invalid agent management request.');
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      return enqueue(() => method === 'GET' ? request(path) : mutate(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body }) }));
    },
    ownerDevices: (method, path, payload) => {
      if (!['GET', 'POST', 'DELETE'].includes(method) || !/^\/devices(?:\/(?:[A-Za-z0-9_-]+|pairings\/[A-Za-z0-9_-]+\/approve))?$/.test(path)) throw new ApiError(400, 'Invalid device management request.');
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      return enqueue(async () => {
        if (method === 'GET') return request(path);
        if (conflict) throw conflict;
        if (!latest) throw new ApiError(428, 'Load the workspace before pairing.');
        try {
          const result = await request(path, { method, headers: { 'Content-Type': 'application/json', 'If-Match': String(latest.revision) }, ...(body === undefined ? {} : { body }) });
          remember(await request('/state'));
          return result;
        } catch (problem) { if (problem.status === 409 || problem.status === 0 || problem.status >= 500) conflict = problem; throw problem; }
      });
    },
    templateShareStatuses: () => request("/templates/shares"),
    templateShare: (id, method = "GET", options, draft) => {
      const record = draft && (({ files, ...template }) => template)(draft);
      const body = ["POST", "PUT"].includes(method) ? JSON.stringify({ ...options, ...(record ? { draft: record } : {}) }) : undefined;
      return enqueue(() => {
        if (method !== "GET" && conflict) throw conflict;
        if (method !== "GET" && !latest) throw new ApiError(428, "Load the workspace before sharing.");
        return request(`/templates/${encodeURIComponent(id)}/share`, { method, headers: { ...(method !== "GET" ? { "If-Match": String(latest.revision) } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body } : {}), referrerPolicy: "no-referrer" });
      });
    },
    readSharedTemplate: async token => {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(400, "Invalid template link.");
      const result = await request("/templates/shared", { headers: { Authorization: `Bearer ${token}` }, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!result.template || !validateStoredData({ lists: [], reminders: [], templates: [result.template] })) throw new ApiError(502, "The server returned an invalid template.");
      return result;
    },
    login: (password) =>
      request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }),
    logout: () =>
      enqueue(async () => {
        const result = await request("/auth/logout", { method: "POST" });
        latest = null;
        conflict = null;
        return result;
      }),
    session: () => request("/auth/session"),
  };
}
