import { validateStoredData } from "../src/model.js";

export class TemplateSharingError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new TemplateSharingError(status, message); };
const encoder = new TextEncoder();
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const decode = value => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
const hash = async value => encode(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const keyFingerprint = env => hash(`template-share-key:${env.SESSION_SECRET}`);
async function key(env) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(`template-share-encryption:${env.SESSION_SECRET}`));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptToken(env, templateId, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(templateId) }, await key(env), encoder.encode(token));
  return `${encode(iv)}.${encode(ciphertext)}`;
}
async function decryptToken(env, row) {
  try {
    const [iv, ciphertext] = row.token_ciphertext.split(".");
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(iv), additionalData: encoder.encode(row.template_id) }, await key(env), decode(ciphertext)));
  } catch { fail(503, "Shared link unavailable; stop sharing and create a new link."); }
}
function options(input) {
  if (!input || Array.isArray(input) || typeof input !== "object" || Object.keys(input).some(key => !["dates", "tags", "locations"].includes(key)) || ["dates", "tags", "locations"].some(key => input[key] !== undefined && typeof input[key] !== "boolean")) fail(400, "Invalid sharing options");
  return { dates: input.dates === true, tags: input.tags === true, locations: input.locations === true };
}
function shareSource(template, input) {
  if (!input || Array.isArray(input) || typeof input !== "object" || Object.keys(input).some(key => !["dates", "tags", "locations", "draft"].includes(key))) fail(400, "Invalid sharing options");
  const { draft, ...settings } = input;
  if (draft === undefined) return { template, settings: options(settings) };
  const onlyKeys = (value, keys) => value && !Array.isArray(value) && typeof value === "object" && Object.keys(value).every(key => keys.includes(key));
  const listKeys = ["id", "name", "color", "icon", "type", "group", "sections", "shoppingOverrides", "createdAt", "updatedAt"];
  const reminderKeys = ["id", "listId", "title", "notes", "url", "completed", "completedAt", "flagged", "urgent", "priority", "dueDate", "dueTime", "dueInstant", "timeZone", "recurrence", "recurrenceDays", "repeatInterval", "repeatEndDate", "repeatCustom", "repeatPattern", "earlyMinutes", "location", "tags", "parentId", "sectionId", "assignedTo", "shoppingCategoryManual", "shoppingCategoryChoice", "shoppingNewSectionName", "createdAt", "updatedAt"];
  if (!onlyKeys(draft, ["id", "name", "list", "reminders"]) || draft.id !== template.id || draft.list?.id !== template.list.id ||
      !onlyKeys(draft.list, listKeys) || !Array.isArray(draft.list.sections) || draft.list.sections.some(section => !onlyKeys(section, ["id", "name", "shoppingCategory"])) ||
      (draft.list.shoppingOverrides && (!Array.isArray(draft.list.shoppingOverrides) || draft.list.shoppingOverrides.some(choice => !onlyKeys(choice, ["title", "sectionId"])))) ||
      !Array.isArray(draft.reminders) || draft.reminders.some(reminder => !onlyKeys(reminder, reminderKeys)) ||
      !validateStoredData({ lists: [], reminders: [], templates: [draft] })) fail(400, "Invalid template draft");
  // Sharing publishes a separate sanitized snapshot; private draft rows and photos stay untouched.
  return { template: draft, settings: options(settings) };
}
export function sharedTemplateSnapshot(template, input = {}) {
  const include = options(input), sectionIds = new Map(template.list.sections.map((s, i) => [s.id, `shared-section-${i}`])), reminderIds = new Map(template.reminders.map((r, i) => [r.id, `shared-reminder-${i}`]));
  const snapshot = {
    id: "shared-template", name: template.name,
    list: { id: "shared-list", name: template.list.name, color: template.list.color, icon: template.list.icon, group: "", type: template.list.type === "shopping" ? "shopping" : "standard", sections: template.list.sections.map(s => ({ id: sectionIds.get(s.id), name: s.name, ...(s.shoppingCategory ? { shoppingCategory: s.shoppingCategory } : {}) })) },
    reminders: template.reminders.map(r => ({
      id: reminderIds.get(r.id), listId: "shared-list", title: r.title, notes: r.notes, url: r.url || "", completed: false, completedAt: null,
      flagged: r.flagged, urgent: Boolean(r.urgent), priority: r.priority,
      dueDate: include.dates ? r.dueDate : null, dueTime: include.dates ? r.dueTime : null, dueInstant: include.dates ? r.dueInstant || null : null,
      timeZone: include.dates ? r.timeZone || "UTC" : "UTC", recurrence: include.dates ? r.recurrence : "none", repeatInterval: include.dates ? r.repeatInterval : 1, repeatEndDate: include.dates ? r.repeatEndDate || null : null,
      ...(include.dates && r.recurrenceDays ? { recurrenceDays: [...r.recurrenceDays] } : {}),
      repeatCustom: include.dates ? r.repeatCustom === true : false,
      repeatPattern: include.dates && r.repeatPattern ? structuredClone(r.repeatPattern) : null,
      earlyMinutes: include.dates ? r.earlyMinutes : 0, location: include.locations ? r.location : "", tags: include.tags ? [...r.tags] : [],
      parentId: reminderIds.get(r.parentId) || null, sectionId: sectionIds.get(r.sectionId) || null,
    })),
  };
  if (!validateStoredData({ lists: [], reminders: [], templates: [snapshot] })) fail(400, "Invalid shared template");
  if (encoder.encode(JSON.stringify(snapshot)).byteLength > 1024 * 1024) fail(413, "Shared template too large");
  return snapshot;
}
async function fingerprint(template, settings) { return hash(JSON.stringify(sharedTemplateSnapshot(template, settings))); }
function source(current, id) { const template = current.data.templates?.find(t => t.id === id); if (!template) fail(404, "Template not found"); return template; }
const rowFor = (env, id) => env.DB.prepare("SELECT * FROM template_shares WHERE template_id = ?").bind(id).first();
async function status(env, row, template, includeToken = false) {
  if (!row) return { shared: false };
  const validKey = row.key_fingerprint === await keyFingerprint(env);
  const settings = JSON.parse(row.options);
  return { shared: validKey, createdAt: row.created_at, updatedAt: row.updated_at, options: settings, outdated: validKey && row.source_fingerprint !== await fingerprint(template, settings), ...(includeToken && validKey ? { token: await decryptToken(env, row) } : {}) };
}
export async function templateShareStatuses(env, current) {
  const rows = (await env.DB.prepare("SELECT * FROM template_shares").all()).results;
  const statuses = {};
  for (const row of rows) {
    const template = current.data.templates?.find(t => t.id === row.template_id);
    if (template) statuses[row.template_id] = await status(env, row, template);
  }
  return { statuses };
}
export async function manageTemplateShare(env, current, id, method, input, revision) {
  const template = source(current, id);
  let row = await rowFor(env, id);
  if (method === "GET") return status(env, row, template, true);
  if (revision !== current.revision) fail(409, "Workspace changed; reload before sharing");
  if (method === "DELETE") {
    const deleted = await env.DB.prepare("DELETE FROM template_shares WHERE template_id = ? AND EXISTS (SELECT 1 FROM state WHERE id = 1 AND revision = ?)").bind(id, revision).run();
    if ((row && deleted.meta.changes !== 1) || (await env.DB.prepare("SELECT revision FROM state WHERE id = 1").first())?.revision !== revision) fail(409, "Workspace changed; reload before sharing");
    return { shared: false };
  }
  const publication = shareSource(template, input), settings = publication.settings, candidate = publication.template;
  const snapshot = JSON.stringify(sharedTemplateSnapshot(candidate, settings)), sourceFingerprint = await fingerprint(candidate, settings), now = new Date().toISOString(), keyId = await keyFingerprint(env);
  if (row && row.key_fingerprint !== keyId) {
    await env.DB.prepare("DELETE FROM template_shares WHERE template_id = ? AND EXISTS (SELECT 1 FROM state WHERE id = 1 AND revision = ?)").bind(id, revision).run(); row = null;
  }
  if (method === "POST" && row) return status(env, row, candidate, true);
  if (method === "PUT" && !row) fail(404, "Shared link not found");
  let changed;
  if (method === "PUT") {
    changed = await env.DB.prepare("UPDATE template_shares SET snapshot = ?, options = ?, source_fingerprint = ?, updated_at = ? WHERE template_id = ? AND token_hash = ? AND EXISTS (SELECT 1 FROM state WHERE id = 1 AND revision = ?) AND (SELECT COALESCE(SUM(length(CAST(snapshot AS BLOB))), 0) FROM template_shares WHERE template_id != ?) + ? <= ?").bind(snapshot, JSON.stringify(settings), sourceFingerprint, now, id, row.token_hash, revision, id, encoder.encode(snapshot).byteLength, 16 * 1024 * 1024).run();
  } else {
    const token = encode(crypto.getRandomValues(new Uint8Array(32)));
    changed = await env.DB.prepare("INSERT INTO template_shares (template_id, token_hash, token_ciphertext, key_fingerprint, snapshot, options, source_fingerprint, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM state WHERE id = 1 AND revision = ?) AND (SELECT COUNT(*) FROM template_shares) < 100 AND (SELECT COALESCE(SUM(length(CAST(snapshot AS BLOB))), 0) FROM template_shares) + ? <= ? ON CONFLICT(template_id) DO NOTHING").bind(id, await hash(token), await encryptToken(env, id, token), keyId, snapshot, JSON.stringify(settings), sourceFingerprint, now, now, revision, encoder.encode(snapshot).byteLength, 16 * 1024 * 1024).run();
  }
  if (changed.meta.changes !== 1) fail(409, "Workspace or shared link changed, or sharing limit reached; reload before retrying");
  return status(env, await rowFor(env, id), candidate, true);
}
export async function readSharedTemplate(request, env) {
  if (new URL(request.url).protocol !== "https:" && env.DEV_MODE !== "1") fail(503, "HTTPS required");
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) fail(401, "Template access required");
  const row = await env.DB.prepare("SELECT * FROM template_shares WHERE token_hash = ? AND EXISTS (SELECT 1 FROM state, json_each(json_extract(state.document, '$.templates')) AS template WHERE state.id = 1 AND json_extract(template.value, '$.id') = template_shares.template_id)").bind(await hash(token)).first();
  if (!row || row.key_fingerprint !== await keyFingerprint(env)) fail(404, "Shared template unavailable");
  return { template: JSON.parse(row.snapshot), updatedAt: row.updated_at };
}
