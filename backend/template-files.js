export class TemplateFileError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new TemplateFileError(status, message); };
const json = value => JSON.stringify(value);

export async function copyTemplateFiles(env, sources) {
  if (!sources.length) return [];
  if (!env.FILES) fail(503, "Attachment storage unavailable");
  const groups = new Map();
  const copies = sources.map(source => {
    if (!Number.isInteger(source.size) || source.size < 1 || source.size > 5 * 1024 * 1024) fail(400, "Invalid source attachment");
    const namespace = source.template_id ? `template:${source.template_id}:${source.reminder_id}` : source.reminder_id;
    const count = (groups.get(namespace) || 0) + 1; groups.set(namespace, count);
    if (count > 20) fail(413, "Attachment limit reached");
    const id = crypto.randomUUID();
    return { ...source, id, object_key: `attachments/${id}`, namespace, created_at: new Date().toISOString() };
  });
  const reservation = await env.DB.prepare(`INSERT INTO pending_file_cleanup (object_key, reminder_id, size, ready_at)
    SELECT json_extract(value, '$.object_key'), json_extract(value, '$.namespace'), json_extract(value, '$.size'), ? FROM json_each(?)
    WHERE (SELECT COUNT(*) FROM attachments) + (SELECT COUNT(*) FROM template_attachments) + (SELECT COUNT(*) FROM pending_file_cleanup) + ? <= 200
    AND (SELECT COALESCE(SUM(size), 0) FROM attachments) + (SELECT COALESCE(SUM(size), 0) FROM template_attachments) + (SELECT COALESCE(SUM(size), 0) FROM pending_file_cleanup) + ? <= ?`)
    .bind(Date.now() + 3600000, json(copies), copies.length, copies.reduce((bytes, row) => bytes + row.size, 0), 100 * 1024 * 1024).run();
  if (reservation.meta.changes !== copies.length) fail(413, "Attachment storage limit reached");
  try {
    for (let i = 0; i < copies.length; i++) {
      const object = await env.FILES.get(sources[i].object_key);
      if (!object?.body) fail(404, "Source attachment unavailable");
      await env.FILES.put(copies[i].object_key, object.body, { httpMetadata: { contentType: copies[i].content_type } });
    }
    return copies;
  } catch (error) { await rollbackTemplateCopies(env, copies); throw error; }
}

export async function rollbackTemplateCopies(env, copies) {
  if (!copies.length) return;
  const keys = copies.map(row => row.object_key);
  await env.DB.prepare("UPDATE pending_file_cleanup SET ready_at = 0 WHERE object_key IN (SELECT value FROM json_each(?))").bind(json(keys)).run();
  try {
    await env.FILES.delete(keys);
    await env.DB.prepare("DELETE FROM pending_file_cleanup WHERE object_key IN (SELECT value FROM json_each(?))").bind(json(keys)).run();
  } catch { /* A durable cleanup reservation owns every staged object. */ }
}

export function templateCopyStatements(env, copies, templateTarget) {
  if (!copies.length) return [];
  const records = json(copies);
  return [
    token => env.DB.prepare(templateTarget
      ? `INSERT INTO template_attachments (id, template_id, reminder_id, object_key, filename, content_type, size, created_at)
        SELECT json_extract(value, '$.id'), json_extract(value, '$.template_id'), json_extract(value, '$.reminder_id'), json_extract(value, '$.object_key'), json_extract(value, '$.filename'), json_extract(value, '$.content_type'), json_extract(value, '$.size'), json_extract(value, '$.created_at') FROM json_each(?) WHERE EXISTS (SELECT 1 FROM state WHERE mutation = ?)`
      : `INSERT INTO attachments (id, reminder_id, object_key, filename, content_type, size, created_at)
        SELECT json_extract(value, '$.id'), json_extract(value, '$.reminder_id'), json_extract(value, '$.object_key'), json_extract(value, '$.filename'), json_extract(value, '$.content_type'), json_extract(value, '$.size'), json_extract(value, '$.created_at') FROM json_each(?) WHERE EXISTS (SELECT 1 FROM state WHERE mutation = ?)`).bind(records, token),
    token => env.DB.prepare("DELETE FROM pending_file_cleanup WHERE object_key IN (SELECT json_extract(value, '$.object_key') FROM json_each(?)) AND EXISTS (SELECT 1 FROM state WHERE mutation = ?)").bind(records, token),
  ];
}

export function fileDeletionStatements(env, files, templateTarget = false) {
  if (!files.length) return [];
  const table = templateTarget ? "template_attachments" : "attachments", records = json(files);
  return [
    token => env.DB.prepare("INSERT OR IGNORE INTO pending_file_cleanup (object_key, reminder_id, size, ready_at) SELECT json_extract(value, '$.object_key'), json_extract(value, '$.reminder_id'), json_extract(value, '$.size'), 0 FROM json_each(?) WHERE EXISTS (SELECT 1 FROM state WHERE mutation = ?)").bind(records, token),
    token => env.DB.prepare(`DELETE FROM ${table} WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?)) AND EXISTS (SELECT 1 FROM state WHERE mutation = ?)`).bind(records, token),
  ];
}
