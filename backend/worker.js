import {
  seedData,
  validateStoredData,
  createReminder,
  completeReminder,
  reopenReminder,
  deleteReminder,
} from "../src/model.js";
import { categoriseShopping } from "../src/shopping.js";
import { TemplateSharingError, manageTemplateShare, readSharedTemplate, templateShareStatuses } from "./template-sharing.js";
import { saveTemplate, useTemplate } from "../src/templates.js";
import { TemplateFileError, copyTemplateFiles, rollbackTemplateCopies, templateCopyStatements, fileDeletionStatements } from "./template-files.js";
import { AgentAPIError, agentPublicRoute, ownerAgentRoute, agentRoute, agentInvalidationStatements } from "./agent-api.js";
import { DeviceAPIError, devicePublicRoute, ownerDeviceRoute, deviceRoute, deviceDelegationStatements, deviceCompletionStatements, deviceInvalidationStatements } from "./device-api.js";

const MAX_BODY = 1024 * 1024,
  MAX_FILE = 5 * 1024 * 1024,
  SESSION_SECONDS = 8 * 60 * 60;
const MAX_OBJECTS = 200,
  MAX_STORED_BYTES = 100 * 1024 * 1024,
  MAX_FILES_PER_REMINDER = 20,
  EVENT_RETENTION = 10000;
const encoder = new TextEncoder();
const mimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
]);
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      ...headers,
    },
  });
function required(env) {
  if (
    !env.DB ||
    !env.APP_PASSWORD ||
    !env.SESSION_SECRET ||
    env.SESSION_SECRET.length < 32
  )
    fail(503, "Service configuration incomplete");
}
const base64 = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
async function digest(value) {
  return base64(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
async function equal(a, b) {
  const x = await digest(String(a)),
    y = await digest(String(b));
  let difference = x.length ^ y.length;
  for (let i = 0; i < x.length; i++)
    difference |= x.charCodeAt(i) ^ (y.charCodeAt(i) || 0);
  return difference === 0;
}
async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
export async function sessionToken(env, now = Date.now()) {
  const value = `${Math.floor(now / 1000) + SESSION_SECONDS}.${crypto.randomUUID()}`;
  const nonce = value.split(".")[1];
  await pruneAuth(env, now);
  const inserted = await env.DB.prepare(
    "INSERT INTO sessions (nonce_hash, expires) SELECT ?, ? WHERE (SELECT COUNT(*) FROM sessions) < 200",
  )
    .bind(await digest(nonce), Math.floor(now / 1000) + SESSION_SECONDS)
    .run();
  if (inserted.meta.changes !== 1)
    fail(429, "Session limit reached; sign out an existing session");
  return `${value}.${await sign(value, env.SESSION_SECRET)}`;
}
export async function validSession(request, env, now = Date.now()) {
  const token = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)reminders_session=([^;]+)/)?.[1];
  if (!token || token.length > 300) return false;
  const [expires, nonce, signature, extra] = token.split(".");
  if (extra || !signature || !nonce || !/^\d+$/.test(expires)) return false;
  const expiry = Number(expires),
    current = Math.floor(now / 1000);
  if (expiry <= current || expiry > current + SESSION_SECONDS) return false;
  if (
    !(await equal(
      signature,
      await sign(`${expires}.${nonce}`, env.SESSION_SECRET),
    ))
  )
    return false;
  const stored = await env.DB.prepare(
    "SELECT expires FROM sessions WHERE nonce_hash = ?",
  )
    .bind(await digest(nonce))
    .first();
  return stored?.expires === expiry;
}
function cookie(request, env, token, logout = false) {
  const secure = new URL(request.url).protocol === "https:";
  if (!secure && env.DEV_MODE !== "1") fail(503, "HTTPS required");
  return `reminders_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${logout ? 0 : SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}
function checkOrigin(request, env) {
  if (["GET", "HEAD"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const self = new URL(request.url).origin;
  const allowed = new Set([self]);
  if (env.APP_ORIGIN) allowed.add(env.APP_ORIGIN);
  if (!origin || !allowed.has(origin)) fail(403, "Origin denied");
}
async function body(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    fail(415, "JSON required");
  if (Number(request.headers.get("content-length")) > MAX_BODY)
    fail(413, "Request too large");
  const bytes = await limitedBytes(request, MAX_BODY);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail(400, "Invalid JSON");
  }
}
async function limitedBytes(request, limit) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(),
    chunks = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.length;
    if (length > limit) {
      await reader.cancel();
      fail(413, "Request too large");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
function validData(data) {
  if (
    !validateStoredData(data) ||
    data.lists.length > 100 ||
    data.reminders.length > 1000
  )
    fail(400, "Invalid reminder data");
  if (encoder.encode(JSON.stringify(data)).byteLength > MAX_BODY)
    fail(413, "Workspace too large");
  for (const l of data.lists) {
    if (
      l.id.length > 100 ||
      l.name.length > 200 ||
      l.sections.length > 100 ||
      !/^#[0-9a-f]{6}$/i.test(l.color)
    )
      fail(400, "Invalid list");
    for (const s of l.sections)
      if (s.name.length > 200) fail(400, "Invalid section");
  }
  for (const r of data.reminders) {
    if (
      r.title.length > 2000 ||
      r.notes.length > 20000 ||
      r.location.length > 1000 ||
      r.tags.length > 50 ||
      r.tags.some((t) => t.length > 100)
    )
      fail(400, "Reminder field too long");
    if (
      r.id.length > 100 ||
      r.listId.length > 100 ||
      (r.parentId && r.parentId.length > 100)
    )
      fail(400, "Invalid identifier");
    if (r.url !== undefined && r.url !== "") {
      if (typeof r.url !== "string") fail(400, "Invalid URL");
      let url;
      try {
        url = new URL(r.url);
      } catch {
        fail(400, "Invalid URL");
      }
      if (!["http:", "https:"].includes(url.protocol) || r.url.length > 2000)
        fail(400, "Invalid URL");
    }
  }
}
function cleanData(data, previous = { lists: [], reminders: [] }) {
  if (!data || !Array.isArray(data.lists) || !Array.isArray(data.reminders))
    fail(400, "Invalid data");
  validData(data);
  data = categoriseShopping(data, previous);
  const now = new Date().toISOString();
  const comparable = (item) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(item || {}).filter(
          ([key]) => !["createdAt", "updatedAt", "attachments"].includes(key),
        ),
      ),
    );
  const stamp = (item, old) => ({
    ...item,
    createdAt: old?.createdAt || now,
    updatedAt:
      old && comparable(item) === comparable(old) ? old.updatedAt || now : now,
  });
  const lists = data.lists.map((l) =>
    stamp(
      l,
      previous.lists.find((x) => x.id === l.id),
    ),
  );
  const reminders = data.reminders.map((r) => {
    const { attachments, ...rest } = r;
    return stamp(
      rest,
      previous.reminders.find((x) => x.id === r.id),
    );
  });
  const result = {
    lists,
    reminders,
    ...((data.templates ?? previous.templates) !== undefined
      ? { templates: (data.templates ?? previous.templates).map(({ files, ...template }) => template) }
      : {}),
  };
  validData(result);
  return result;
}
async function state(env) {
  let row = await env.DB.prepare(
    "SELECT document, revision FROM state WHERE id = 1",
  ).first();
  if (!row) {
    const data =
      env.SAMPLE_DATA === "1" ? seedData() : { lists: [], reminders: [] };
    await env.DB.prepare(
      "INSERT OR IGNORE INTO state (id, document, revision, mutation) VALUES (1, ?, 0, ?)",
    )
      .bind(JSON.stringify(cleanData(data)), "")
      .run();
    row = await env.DB.prepare(
      "SELECT document, revision FROM state WHERE id = 1",
    ).first();
  }
  return { data: JSON.parse(row.document), revision: row.revision };
}
const attachment = (row) => ({
  id: row.id,
  reminderId: row.reminder_id,
  filename: row.filename,
  contentType: row.content_type,
  size: row.size,
  createdAt: row.created_at,
  downloadUrl: `/api/attachments/${row.id}`,
});
async function snapshot(env) {
  await state(env);
  const rows = await env.DB.batch([
    env.DB.prepare("SELECT document, revision FROM state WHERE id = 1"),
    env.DB.prepare("SELECT * FROM attachments"),
    env.DB.prepare(
      "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'events'), 0) AS sequence",
    ),
    env.DB.prepare("SELECT * FROM template_attachments"),
  ]);
  const current = {
    data: JSON.parse(rows[0].results[0].document),
    revision: rows[0].results[0].revision,
  };
  const files = rows[1].results || [];
  const sequence = rows[2].results[0].sequence;
  return {
    data: {
      ...current.data,
      lists: current.data.lists,
      ...(current.data.templates ? { templates: current.data.templates.map(template => ({ ...template, files: rows[3].results.filter(file => file.template_id === template.id).map(file => ({ ...attachment(file), templateId: file.template_id, downloadUrl: `/api/template-attachments/${file.id}` })) })) } : {}),
      reminders: current.data.reminders.map((r) => ({
        ...r,
        attachments: files
          .filter((a) => a.reminder_id === r.id)
          .map(attachment),
      })),
    },
    revision: current.revision,
    sequence,
  };
}
function expected(request) {
  const value = request.headers.get("if-match")?.replaceAll('"', "");
  if (value === undefined || value === null)
    fail(428, "If-Match revision required");
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    fail(400, "Invalid revision");
  return Number(value);
}
async function commit(
  env,
  previous,
  data,
  revision,
  type,
  payload,
  extra = [],
  guard = { sql: '', values: [] },
) {
  if (revision !== previous.revision)
    fail(409, "Workspace changed; reload before retrying");
  const token = crypto.randomUUID(),
    now = new Date().toISOString();
  const invalidations = [...(env.AGENT_API === '1' ? await agentInvalidationStatements(env, data, type, payload) : []), ...await deviceInvalidationStatements(env, data)];
  const result = await env.DB.batch([
    env.DB.prepare(
      `UPDATE state SET document = ?, revision = revision + 1, mutation = ? WHERE id = 1 AND revision = ? ${guard.sql}`,
    ).bind(JSON.stringify(data), token, revision, ...guard.values),
    ...extra.map((fn) => fn(token)),
    ...invalidations.map((fn) => fn(token)),
    env.DB.prepare(
      "INSERT INTO events (operation_id, type, payload, created_at) SELECT ?, ?, ?, ? FROM state WHERE id = 1 AND mutation = ?",
    ).bind(
      token,
      type,
      JSON.stringify({ ...payload, revision: revision + 1 }),
      now,
      token,
    ),
    env.DB.prepare(
      `DELETE FROM events WHERE sequence <= (SELECT COALESCE(MAX(sequence), 0) - ? FROM events)
      OR sequence <= (SELECT MAX(sequence) FROM (SELECT sequence, SUM(length(CAST(payload AS BLOB))) OVER (ORDER BY sequence DESC) AS bytes FROM events) WHERE bytes > ?)`,
    ).bind(EVENT_RETENTION, 16 * 1024 * 1024),
    ...(env.AGENT_API === '1' ? [env.DB.prepare("DELETE FROM agent_events WHERE sequence <= (SELECT COALESCE(MAX(sequence), 0) - 10000 FROM agent_events)")] : []),
  ]);
  if (result[0].meta.changes !== 1)
    fail(409, "Workspace changed; reload before retrying");
  return snapshot(env);
}
async function pruneAuth(env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires <= ?").bind(
      Math.floor(now / 1000),
    ),
    env.DB.prepare("DELETE FROM login_attempts WHERE window_start < ?").bind(
      now - 900000,
    ),
  ]);
}
function deletionStatements(env, file) {
  return fileDeletionStatements(env, Array.isArray(file) ? file : [file]);
}
async function deleteQueuedFile(env, objectKey) {
  if (!env.FILES) throw new Error("Attachment storage unavailable");
  await env.FILES.delete(objectKey);
  await env.DB.prepare("DELETE FROM pending_file_cleanup WHERE object_key = ?")
    .bind(objectKey)
    .run();
}
export async function cleanupStorage(env, now = Date.now()) {
  await pruneAuth(env, now);
  const jobs = (
    await env.DB.prepare(
      "SELECT object_key FROM pending_file_cleanup WHERE ready_at <= ? ORDER BY ready_at, object_key LIMIT 20",
    )
      .bind(now)
      .all()
  ).results;
  let deleted = 0;
  for (const job of jobs) {
    try {
      await deleteQueuedFile(env, job.object_key);
      deleted++;
    } catch {
      /* Retain durable job for the next maintenance run. */
    }
  }
  const pending = (
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM pending_file_cleanup",
    ).first()
  ).count;
  return { deleted, pending };
}
async function reportCleanup(env, result) {
  const cleanup = await cleanupStorage(env);
  if (cleanup.pending)
    result.warning = "Private file cleanup is pending; maintenance will retry";
}
async function mutate(env, request, transform, type, payload) {
  const previous = await state(env),
    revision = expected(request);
  const data = cleanData(transform(previous.data), previous.data);
  const removed = previous.data.reminders
    .filter((r) => !data.reminders.some((x) => x.id === r.id))
    .map((r) => r.id);
  const files = removed.length
    ? (await env.DB.prepare("SELECT * FROM attachments").all()).results.filter(
        (a) => removed.includes(a.reminder_id),
      )
    : [];
  const templateFiles = (await env.DB.prepare("SELECT * FROM template_attachments").all()).results.filter(file => !data.templates?.some(template => template.id === file.template_id && template.reminders.some(reminder => reminder.id === file.reminder_id)));
  const extra = [...deletionStatements(env, files), ...fileDeletionStatements(env, templateFiles, true)];
  extra.push(token => env.DB.prepare("DELETE FROM template_shares WHERE NOT EXISTS (SELECT 1 FROM state, json_each(json_extract(state.document, '$.templates')) AS template WHERE state.id = 1 AND json_extract(template.value, '$.id') = template_shares.template_id) AND EXISTS (SELECT 1 FROM state WHERE mutation = ?)").bind(token));
  const result = await commit(
    env,
    previous,
    data,
    revision,
    type,
    { ...payload, deletedReminderIds: removed },
    extra,
  );
  if (files.length || templateFiles.length) await reportCleanup(env, result);
  return result;
}
async function login(request, env) {
  await pruneAuth(env);
  const input = await body(request);
  if (typeof input.password !== "string" || input.password.length > 1024)
    fail(400, "Invalid login");
  const client = await digest(
      `${env.SESSION_SECRET}:${request.headers.get("cf-connecting-ip") || "local"}`,
    ),
    now = Date.now();
  await env.DB.prepare(
    "INSERT INTO login_attempts (client_hash, count, window_start) SELECT ?, 1, ? WHERE (SELECT COUNT(*) FROM login_attempts) < 2000 OR EXISTS (SELECT 1 FROM login_attempts WHERE client_hash = ?) ON CONFLICT(client_hash) DO UPDATE SET count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END, window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END",
  )
    .bind(client, now, client, now - 900000, now - 900000)
    .run();
  const row = await env.DB.prepare(
    "SELECT count FROM login_attempts WHERE client_hash = ?",
  )
    .bind(client)
    .first();
  if (!row) fail(429, "Login capacity reached; try again later");
  if (row.count > 10)
    fail(429, "Too many login attempts; try again in 15 minutes");
  if (!(await equal(input.password, env.APP_PASSWORD)))
    fail(401, "Invalid login");
  return json({ authenticated: true }, 200, {
    "set-cookie": cookie(request, env, await sessionToken(env)),
  });
}
async function copyTemplateOperation(request, env, templateId = null) {
  const previous = await state(env), revision = expected(request), input = await body(request);
  if (revision !== previous.revision) fail(409, "Workspace changed; reload before retrying");
  const allowed = templateId ? ["name", "template", "deletedAttachmentIds"] : ["listId", "name", "includeCompleted"];
  if (!input || Object.keys(input).some(key => !allowed.includes(key)) || typeof input.name !== "string" || !input.name.trim() || input.name.length > 200) fail(400, "Invalid template request");
  let data, targetId, sources, removedTemplateFiles = [];
  if (templateId) {
    const source = previous.data.templates?.find(row => row.id === templateId);
    let template = source;
    if (!template) fail(404, "Template not found");
    const deletedIds = input.deletedAttachmentIds || [];
    if (!Array.isArray(deletedIds) || deletedIds.length > 200 || deletedIds.some(id => typeof id !== "string") || new Set(deletedIds).size !== deletedIds.length || (input.template && input.template.id !== templateId)) fail(400, "Invalid template request");
    const base = input.template ? cleanData({ ...previous.data, templates: previous.data.templates.map(row => row.id === templateId ? input.template : row) }, previous.data) : previous.data;
    template = base.templates.find(row => row.id === templateId);
    if (previous.data.lists.length >= 100 || previous.data.reminders.length + template.reminders.length > 1000) fail(413, "Workspace limit reached");
    const result = useTemplate(base, templateId, input.name);
    data = cleanData(result.data, previous.data); targetId = result.listId;
    const newRows = data.reminders.filter(row => row.listId === targetId), ids = new Map(template.reminders.map((row, i) => [row.id, newRows[i].id]));
    const files = (await env.DB.prepare("SELECT * FROM template_attachments WHERE template_id = ?").bind(templateId).all()).results;
    if (deletedIds.some(id => !files.some(file => file.id === id))) fail(400, "Attachment does not belong to this template");
    removedTemplateFiles = files.filter(file => !ids.has(file.reminder_id) || deletedIds.includes(file.id));
    sources = files.filter(file => ids.has(file.reminder_id) && !deletedIds.includes(file.id)).map(file => ({ ...file, template_id: null, reminder_id: ids.get(file.reminder_id) }));
  } else {
    if (typeof input.listId !== "string" || (input.includeCompleted !== undefined && typeof input.includeCompleted !== "boolean")) fail(400, "Invalid template request");
    if (!previous.data.lists.some(list => list.id === input.listId)) fail(404, "List not found");
    if ((previous.data.templates || []).length >= 100) fail(413, "Template limit reached");
    data = cleanData(saveTemplate(previous.data, input.listId, input.name, input.includeCompleted), previous.data);
    const template = data.templates.at(-1); targetId = template.id;
    const included = new Set(template.reminders.map(row => row.id));
    sources = (await env.DB.prepare("SELECT * FROM attachments").all()).results.filter(file => included.has(file.reminder_id)).map(file => ({ ...file, template_id: targetId }));
  }
  // Graph, quota and document validation precede every R2 allocation.
  validData(data);
  const copies = await copyTemplateFiles(env, sources), table = templateId ? "attachments" : "template_attachments";
  try {
    const result = await commit(env, previous, data, revision, templateId ? "template.used" : "template.created", { templateId: templateId || targetId, ...(templateId ? { listId: targetId } : {}) }, [...templateCopyStatements(env, copies, !templateId), ...fileDeletionStatements(env, removedTemplateFiles, true)]);
    if (removedTemplateFiles.length) await reportCleanup(env, result);
    return json({ ...result, ...(templateId ? { listId: targetId } : { templateId: targetId }) }, 201);
  } catch (error) {
    if (copies.length) {
      let committed;
      try { committed = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(copies.map(row => row.id))).first(); }
      catch { fail(503, "Template outcome unavailable; reload before retrying"); }
      if (committed.count) fail(503, "Template change committed; reload workspace before retrying");
      await rollbackTemplateCopies(env, copies);
    }
    throw error;
  }
}
async function upload(request, env, reminderId, templateId = null) {
  if (!env.FILES) fail(503, "Attachment storage unavailable");
  const previous = await state(env),
    revision = expected(request);
  if (revision !== previous.revision)
    fail(409, "Workspace changed; reload before retrying");
  const targetReminder = templateId ? previous.data.templates?.find(template => template.id === templateId)?.reminders.find(reminder => reminder.id === reminderId) : previous.data.reminders.find(reminder => reminder.id === reminderId);
  if (!targetReminder)
    fail(404, "Reminder not found");
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    fail(415, "Multipart file required");
  const bytes = await limitedBytes(request, MAX_FILE + 65536);
  let form;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") },
      body: bytes,
    }).formData();
  } catch {
    fail(400, "Invalid upload");
  }
  const file = form.get("file");
  if (
    !file ||
    typeof file.arrayBuffer !== "function" ||
    typeof file.name !== "string"
  )
    fail(400, "File required");
  if (!file.size || file.size > MAX_FILE)
    fail(413, "File must be between 1 byte and 5 MiB");
  if (!mimeTypes.has(file.type)) fail(415, "Unsupported file type");
  const content = new Uint8Array(await file.arrayBuffer());
  // Validate signatures; MIME headers supplied by a browser are not trusted.
  const prefix = [...content.slice(0, 12)],
    starts = (signature) => signature.every((n, i) => prefix[i] === n);
  if (
    (file.type === "image/png" && !starts([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (file.type === "image/jpeg" && !starts([255, 216, 255])) ||
    (file.type === "application/pdf" && !starts([37, 80, 68, 70, 45])) ||
    (file.type === "image/webp" &&
      !(
        starts([82, 73, 70, 70]) &&
        prefix.slice(8, 12).join(",") === "87,69,66,80"
      ))
  )
    fail(415, "File content does not match type");
  if (file.type === "text/plain" && content.includes(0))
    fail(415, "Text file contains binary data");
  const id = crypto.randomUUID(),
    objectKey = `attachments/${id}`,
    now = new Date().toISOString();
  const filename =
    file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "attachment";
  const namespace = templateId ? `template:${templateId}:${reminderId}` : reminderId;
  const targetCount = templateId ? "SELECT COUNT(*) FROM template_attachments WHERE template_id = ? AND reminder_id = ?" : "SELECT COUNT(*) FROM attachments WHERE reminder_id = ?";
  // Reserve before R2 put: concurrent uploads and crash orphans consume the same hard quota.
  const reservation = await env.DB.prepare(
    `INSERT INTO pending_file_cleanup (object_key, reminder_id, size, ready_at) SELECT ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM attachments) + (SELECT COUNT(*) FROM template_attachments) + (SELECT COUNT(*) FROM pending_file_cleanup) < ?
    AND (SELECT COALESCE(SUM(size), 0) FROM attachments) + (SELECT COALESCE(SUM(size), 0) FROM template_attachments) + (SELECT COALESCE(SUM(size), 0) FROM pending_file_cleanup) + ? <= ?
    AND (${targetCount}) + (SELECT COUNT(*) FROM pending_file_cleanup WHERE reminder_id = ?) < ?`,
  )
    .bind(
      objectKey,
      namespace,
      file.size,
      Date.now() + 3600000,
      MAX_OBJECTS,
      file.size,
      MAX_STORED_BYTES,
      ...(templateId ? [templateId, reminderId] : [reminderId]),
      namespace,
      MAX_FILES_PER_REMINDER,
    )
    .run();
  if (reservation.meta.changes !== 1)
    fail(413, "Attachment storage limit reached");
  let result;
  try {
    await env.FILES.put(objectKey, content, {
      httpMetadata: { contentType: file.type },
    });
    const data = cleanData(previous.data, previous.data);
    result = await commit(
      env,
      previous,
      data,
      revision,
      "attachment.created",
      { reminderId, attachmentId: id },
      templateCopyStatements(env, [{ id, template_id: templateId, reminder_id: reminderId, object_key: objectKey, filename, content_type: file.type, size: file.size, created_at: now }], Boolean(templateId)),
    );
  } catch (error) {
    // A failed response read after a committed CAS must not remove the committed object.
    let committed;
    try {
      committed = await env.DB.prepare(
        `SELECT id FROM ${templateId ? "template_attachments" : "attachments"} WHERE id = ?`,
      )
        .bind(id)
        .first();
    } catch {
      fail(503, "Upload outcome unavailable; reload before retrying");
    }
    if (committed)
      fail(503, "Upload committed; reload workspace before retrying");
    // The pre-put reservation survives even when R2 rollback fails.
    try {
      await env.DB.prepare(
        "UPDATE pending_file_cleanup SET ready_at = 0 WHERE object_key = ?",
      )
        .bind(objectKey)
        .run();
      await deleteQueuedFile(env, objectKey);
    } catch {
      fail(503, "Upload failed; private file cleanup is pending");
    }
    throw error;
  }
  return json(
    {
      ...result,
      attachment: templateId ? result.data.templates.find(template => template.id === templateId).files.find(file => file.id === id) : result.data.reminders.find((r) => r.id === reminderId).attachments.find((a) => a.id === id),
    },
    201,
  );
}
async function route(request, env) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  const publicDeviceResponse = devicePublicRoute(request, env, json);
  if (publicDeviceResponse) return publicDeviceResponse;
  const publicAgentResponse = agentPublicRoute(request, json, env);
  if (publicAgentResponse) return publicAgentResponse;
  if (path === "/api/health" && method === "GET")
    return json({
      ok: Boolean(
        env.DB && env.APP_PASSWORD && env.SESSION_SECRET?.length >= 32,
      ),
      attachmentsConfigured: Boolean(env.FILES),
      agentAPIEnabled: env.AGENT_API === '1',
    });
  required(env);
  const deviceResponse = await deviceRoute(request, env, { body, json, state, expected, cleanData, commit });
  if (deviceResponse) return deviceResponse;
  const agentResponse = await agentRoute(request, env, { body, json, state, cleanData, commit, onAgentSuccessStatements: deviceCompletionStatements });
  if (agentResponse) return agentResponse;
  checkOrigin(request, env);
  if (path === "/api/auth/login" && method === "POST")
    return login(request, env);
  if (path === "/api/auth/session" && method === "GET")
    return json({ authenticated: await validSession(request, env) });
  if (path === "/api/templates/shared" && method === "GET")
    return json(await readSharedTemplate(request, env), 200, { "referrer-policy": "no-referrer" });
  if (!(await validSession(request, env))) fail(401, "Login required");
  const ownerDeviceResponse = await ownerDeviceRoute(request, env, { state, expected, body, json, commit, cleanData });
  if (ownerDeviceResponse) return ownerDeviceResponse;
  const ownerAgentResponse = await ownerAgentRoute(request, env, { state, expected, body, json, commit, cleanData, onAgentDelegatedStatements: deviceDelegationStatements });
  if (ownerAgentResponse) return ownerAgentResponse;
  if (path === "/api/auth/logout" && method === "POST") {
    const token = request.headers
      .get("cookie")
      .match(/(?:^|;\s*)reminders_session=([^;]+)/)[1];
    await env.DB.prepare("DELETE FROM sessions WHERE nonce_hash = ?")
      .bind(await digest(token.split(".")[1]))
      .run();
    return json({ authenticated: false }, 200, {
      "set-cookie": cookie(request, env, "", true),
    });
  }
  if (path === "/api/maintenance" && method === "POST")
    return json(await cleanupStorage(env));
  if (path === "/api/state" && method === "GET")
    return json(await snapshot(env));
  if (path === "/api/templates" && method === "POST") return copyTemplateOperation(request, env);
  const useMatch = path.match(/^\/api\/templates\/([^/]+)\/use$/);
  if (useMatch && method === "POST") return copyTemplateOperation(request, env, decodeURIComponent(useMatch[1]));
  const templateMatch = path.match(/^\/api\/templates\/([^/]+)$/);
  if (templateMatch && method === "PATCH") {
    const id = decodeURIComponent(templateMatch[1]), previous = await state(env), revision = expected(request), input = await body(request);
    if (!previous.data.templates?.some(template => template.id === id)) fail(404, "Template not found");
    if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "Invalid template update");
    const deletedIds = input.deletedAttachmentIds || [];
    if (!input.template || input.template.id !== id || !Array.isArray(deletedIds) || deletedIds.length > 200 || deletedIds.some(value => typeof value !== "string" || value.length > 100) || new Set(deletedIds).size !== deletedIds.length) fail(400, "Invalid template update");
    const data = cleanData({ ...previous.data, templates: previous.data.templates.map(template => template.id === id ? input.template : template) }, previous.data);
    const files = (await env.DB.prepare("SELECT * FROM template_attachments WHERE template_id = ?").bind(id).all()).results;
    if (deletedIds.some(fileId => !files.some(file => file.id === fileId))) fail(400, "Attachment does not belong to this template");
    const removals = files.filter(file => deletedIds.includes(file.id) || !input.template.reminders.some(reminder => reminder.id === file.reminder_id));
    const result = await commit(env, previous, data, revision, "template.updated", { templateId: id }, fileDeletionStatements(env, removals, true));
    if (removals.length) await reportCleanup(env, result);
    return json(result);
  }
  if (path === "/api/templates/shares" && method === "GET")
    return json(await templateShareStatuses(env, await state(env)));
  const shareMatch = path.match(/^\/api\/templates\/([^/]+)\/share$/);
  if (shareMatch && ["GET", "POST", "PUT", "DELETE"].includes(method)) {
    const id = decodeURIComponent(shareMatch[1]);
    if (!id || id.length > 100) fail(400, "Invalid template identifier");
    return json(await manageTemplateShare(env, await state(env), id, method, ["POST", "PUT"].includes(method) ? await body(request) : undefined, method === "GET" ? undefined : expected(request)), 200, { "referrer-policy": "no-referrer" });
  }
  if (path === "/api/state" && method === "PUT") {
    const input = await body(request);
    return json(
      await mutate(env, request, () => input.data, "workspace.updated", {}),
    );
  }
  if (["/api/changes", "/api/events"].includes(path) && method === "GET") {
    const value = url.searchParams.get("since") || "0";
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
      fail(400, "Invalid cursor");
    const bounds = await env.DB.prepare(
      "SELECT MIN(sequence) AS oldest, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'events'), 0) AS latest FROM events",
    ).first();
    if (Number(value) < (bounds.oldest ?? bounds.latest + 1) - 1)
      return json(
        { error: "Change cursor expired; reload /api/state", resync: true },
        410,
      );
    const rows = (
      await env.DB.prepare(
        "SELECT * FROM events WHERE sequence > ? ORDER BY sequence LIMIT 100",
      )
        .bind(Number(value))
        .all()
    ).results;
    return json({
      events: rows.map((e) => ({
        ...JSON.parse(e.payload),
        sequence: e.sequence,
        operationId: e.operation_id,
        type: e.type,
        createdAt: e.created_at,
      })),
      nextCursor: rows.at(-1)?.sequence || Number(value),
      hasMore: rows.length === 100,
    });
  }
  let match = path.match(/^\/api\/templates\/([^/]+)\/reminders\/([^/]+)\/attachments$/);
  if (match && method === "POST") return upload(request, env, decodeURIComponent(match[2]), decodeURIComponent(match[1]));
  match = path.match(/^\/api\/template-attachments\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]), row = await env.DB.prepare("SELECT * FROM template_attachments WHERE id = ?").bind(id).first();
    if (!row) fail(404, "Attachment not found");
    if (!env.FILES) fail(503, "Attachment storage unavailable");
    if (method === "GET") {
      const object = await env.FILES.get(row.object_key);
      if (!object) fail(404, "File unavailable");
      return new Response(object.body, { headers: { "content-type": row.content_type, "content-length": String(row.size), "content-disposition": `attachment; filename="${row.filename}"`, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
    }
    if (method === "DELETE") {
      const previous = await state(env), result = await commit(env, previous, cleanData(previous.data, previous.data), expected(request), "template-attachment.deleted", { templateId: row.template_id, attachmentId: id }, fileDeletionStatements(env, [row], true));
      await reportCleanup(env, result); return json(result);
    }
  }
  match = path.match(/^\/api\/reminders\/([^/]+)\/attachments$/);
  if (match) {
    const reminderId = decodeURIComponent(match[1]);
    if (method === "POST") return upload(request, env, reminderId);
    if (method === "GET") {
      const current = await snapshot(env),
        reminder = current.data.reminders.find((r) => r.id === reminderId);
      if (!reminder) fail(404, "Reminder not found");
      return json({
        attachments: reminder.attachments,
        revision: current.revision,
      });
    }
  }
  match = path.match(/^\/api\/attachments\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]),
      row = await env.DB.prepare("SELECT * FROM attachments WHERE id = ?")
        .bind(id)
        .first();
    if (!row) fail(404, "Attachment not found");
    if (!env.FILES) fail(503, "Attachment storage unavailable");
    if (method === "GET") {
      const object = await env.FILES.get(row.object_key);
      if (!object) fail(404, "File unavailable");
      return new Response(object.body, {
        headers: {
          "content-type": row.content_type,
          "content-length": String(row.size),
          "content-disposition": `attachment; filename="${row.filename}"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
        },
      });
    }
    if (method === "DELETE") {
      const previous = await state(env);
      const result = await commit(
        env,
        previous,
        cleanData(previous.data, previous.data),
        expected(request),
        "attachment.deleted",
        { reminderId: row.reminder_id, attachmentId: id },
        deletionStatements(env, row),
      );
      await reportCleanup(env, result);
      return json(result);
    }
  }
  match = path.match(/^\/api\/(lists|reminders)(?:\/([^/]+))?$/);
  if (match) {
    const collection = match[1],
      id = match[2] && decodeURIComponent(match[2]),
      current = await state(env);
    const item = id && current.data[collection].find((r) => r.id === id);
    if (id && !item) fail(404, "Not found");
    if (method === "GET") {
      const full = await snapshot(env);
      return json({
        [id ? "item" : collection]: id
          ? full.data[collection].find((r) => r.id === id)
          : full.data[collection],
        revision: full.revision,
      });
    }
    if (method === "POST" && !id) {
      const input = await body(request);
      if (!input || typeof input !== "object" || Array.isArray(input))
        fail(400, "Invalid payload");
      return json(
        await mutate(
          env,
          request,
          (data) => {
            let created;
            if (collection === "reminders") {
              if (
                typeof input.title !== "string" ||
                typeof input.listId !== "string"
              )
                fail(400, "Title and list required");
              created = {
                ...createReminder(input.listId, input.title),
                dueDate: null,
                dueTime: null,
                ...input,
                id: crypto.randomUUID(),
                attachments: undefined,
              };
            } else
              created = {
                ...input,
                id: crypto.randomUUID(),
                sections: input.sections || [],
                color: input.color || "#007AFF",
                icon: input.icon || "list",
              };
            return { ...data, [collection]: [...data[collection], created] };
          },
          `${collection}.created`,
          {},
        ),
        201,
      );
    }
    if (method === "PATCH" && id) {
      const input = await body(request);
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        ["id", "createdAt", "updatedAt", "attachments"].some(
          (key) => key in input,
        )
      )
        fail(400, "Invalid patch");
      return json(
        await mutate(
          env,
          request,
          (data) => {
            if (
              collection === "reminders" &&
              input.completed === true &&
              !item.completed
            ) {
              const changed = {
                ...data,
                reminders: data.reminders.map((r) =>
                  r.id === id
                    ? { ...r, ...input, completed: false, completedAt: null }
                    : r,
                ),
              };
              validData(changed);
              return completeReminder(changed, id);
            }
            if (
              collection === "reminders" &&
              input.completed === false &&
              item.completed
            ) {
              const changed = {
                ...data,
                reminders: data.reminders.map((r) =>
                  r.id === id ? { ...r, ...input, completed: true } : r,
                ),
              };
              return reopenReminder(changed, id);
            }
            return {
              ...data,
              [collection]: data[collection].map((r) =>
                r.id === id
                  ? {
                      ...r,
                      ...input,
                      ...(collection === "reminders" &&
                      input.completed === false
                        ? { completedAt: null }
                        : {}),
                    }
                  : r,
              ),
            };
          },
          `${collection}.updated`,
          { id },
        ),
      );
    }
    if (method === "DELETE" && id)
      return json(
        await mutate(
          env,
          request,
          (data) =>
            collection === "reminders"
              ? deleteReminder(data, id)
              : {
                  ...data,
                  lists: data.lists.filter((l) => l.id !== id),
                  reminders: data.reminders.filter((r) => r.listId !== id),
                },
          `${collection}.deleted`,
          { id },
        ),
      );
  }
  fail(404, "Endpoint not found");
}
export default {
  async scheduled(_event, env) {
    await cleanupStorage(env);
  },
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      return json(
        {
          error:
            error instanceof HttpError || error instanceof TemplateSharingError || error instanceof TemplateFileError || error instanceof AgentAPIError || error instanceof DeviceAPIError
              ? error.message
              : "Service operation failed",
          ...(error instanceof AgentAPIError || error instanceof DeviceAPIError ? { code: error.code, retryable: error.retryable } : {}),
        },
        error instanceof HttpError || error instanceof TemplateSharingError || error instanceof TemplateFileError || error instanceof AgentAPIError || error instanceof DeviceAPIError ? error.status : 500,
      );
    }
  },
};
