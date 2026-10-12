import { MAX_VAULT_ENVELOPE, validVaultEnvelope } from "../src/cloud-vault-envelope.js";
import { CLOUD_VAULT_SCHEMA } from "./cloud-vault-schema.js";

const encoder = new TextEncoder();
const MAX_VAULTS = 50;
const failure = (status, message) => Object.assign(new Error(message), { status });
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; frame-ancestors 'none'", ...headers } });

async function input(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw failure(415, "JSON required");
  if (Number(request.headers.get("content-length")) > MAX_VAULT_ENVELOPE) throw failure(413, "Cloud snapshot too large");
  const reader = request.body?.getReader(), chunks = [];
  let size = 0;
  if (!reader) throw failure(400, "Invalid encrypted snapshot");
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > MAX_VAULT_ENVELOPE) { await reader.cancel(); throw failure(413, "Cloud snapshot too large"); }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let envelope, text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); envelope = JSON.parse(text); }
  catch { throw failure(400, "Invalid encrypted snapshot"); }
  if (!validVaultEnvelope(envelope)) throw failure(400, "Invalid encrypted snapshot");
  return text;
}

async function limit(env, bucket, maximum, duration) {
  await env.CLOUD_DB.prepare("DELETE FROM private_vault_limits WHERE expires_at <= ?").bind(Date.now()).run();
  const expires = (Math.floor(Date.now() / duration) + 1) * duration;
  const key = `${bucket}:${expires}`;
  const result = await env.CLOUD_DB.prepare("INSERT INTO private_vault_limits (bucket, count, expires_at) SELECT ?, 1, ? WHERE EXISTS (SELECT 1 FROM private_vault_limits WHERE bucket = ?) OR (SELECT COUNT(*) FROM private_vault_limits) < 5000 ON CONFLICT(bucket) DO UPDATE SET count = count + 1 WHERE count < ?").bind(key, expires, key, maximum).run();
  if (result.meta.changes !== 1) throw failure(429, "Private cloud limit reached");
}

async function route(request, env, cors) {
  const path = new URL(request.url).pathname;
  if (["/health", "/cloud/health"].includes(path) && request.method === "GET") return json({ service: "private-encrypted-reminders", storage: "sqlite-durable-object", configured: Boolean((env.VAULT_STORE || env.CLOUD_DB) && typeof env.RATE_LIMIT_SECRET === "string" && env.RATE_LIMIT_SECRET.length >= 32) }, 200, cors);
  if (!env.CLOUD_DB || typeof env.RATE_LIMIT_SECRET !== "string" || env.RATE_LIMIT_SECRET.length < 32) throw failure(503, "Private cloud configuration incomplete");
  const match = path.match(/^(?:\/cloud)?\/v1\/vaults\/([A-Za-z0-9_-]{22})(?:\/history\/(\d{1,15}))?$/);
  if (!match || !["GET", "POST", "PUT", "DELETE"].includes(request.method)) throw failure(404, "Not found");
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw failure(401, "Private cloud access required");
  const rateKey = await crypto.subtle.importKey("raw", encoder.encode(env.RATE_LIMIT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const ip = request.headers.get("cf-connecting-ip") || "local-development";
  const ipHash = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", rateKey, encoder.encode(ip))), byte => byte.toString(16).padStart(2, "0")).join("");
  await limit(env, `requests:${ipHash}`, 120, 60000);
  const id = match[1], tokenHash = await digest(token);
  const now = Date.now();
  if (request.method === "POST") {
    if (match[2]) throw failure(404, "Not found");
    const envelope = await input(request);
    const existing = await env.CLOUD_DB.prepare("SELECT envelope, revision, updated_at FROM private_vaults WHERE id = ? AND token_hash = ?").bind(id, tokenHash).first();
    if (existing) {
      if (existing.revision === 0 && existing.envelope === envelope) return json({ revision: 0, updatedAt: existing.updated_at }, 200, cors);
      throw failure(409, "This workspace already contains a different cloud version");
    }
    await limit(env, `creation:${ipHash}`, 3, 86400000);
    const created = await env.CLOUD_DB.prepare("INSERT OR IGNORE INTO private_vaults (id, token_hash, envelope, revision, created_at, updated_at) SELECT ?, ?, ?, 0, ?, ? WHERE (SELECT COUNT(*) FROM private_vaults) < ?").bind(id, tokenHash, envelope, now, now, MAX_VAULTS).run();
    if (created.meta.changes !== 1) throw failure(429, "Private cloud capacity reached");
    return json({ revision: 0, updatedAt: now }, 201, cors);
  }
  const vault = await env.CLOUD_DB.prepare("SELECT envelope, revision, updated_at FROM private_vaults WHERE id = ? AND token_hash = ?").bind(id, tokenHash).first();
  if (!vault) throw failure(401, "Private cloud access required");
  if (request.method === "GET") {
    if (match[2]) {
      const previous = await env.CLOUD_DB.prepare("SELECT envelope, revision, updated_at FROM private_vault_history WHERE vault_id = ? AND revision = ?").bind(id, Number(match[2])).first();
      if (!previous) throw failure(404, "Backup unavailable");
      return json({ revision: previous.revision, envelope: JSON.parse(previous.envelope), updatedAt: previous.updated_at }, 200, cors);
    }
    const history = await env.CLOUD_DB.prepare("SELECT revision, updated_at AS updatedAt FROM private_vault_history WHERE vault_id = ? ORDER BY revision DESC LIMIT 2").bind(id).all();
    return json({ revision: vault.revision, envelope: JSON.parse(vault.envelope), history: history.results, updatedAt: vault.updated_at }, 200, cors);
  }
  if (match[2]) throw failure(404, "Not found");
  const expected = request.headers.get("if-match");
  if (typeof expected !== "string" || !/^\d{1,15}$/.test(expected)) throw failure(428, "A cloud revision is required");
  const revision = Number(expected);
  if (vault.revision !== revision) throw failure(409, "Another device saved changes");
  if (request.method === "DELETE") {
    const deleted = await env.CLOUD_DB.prepare("DELETE FROM private_vaults WHERE id = ? AND token_hash = ? AND revision = ?").bind(id, tokenHash, revision).run();
    if (deleted.meta.changes !== 1) throw failure(409, "Another device saved changes");
    return json({ revision, deleted: true }, 200, cors);
  }
  const envelope = await input(request);
  const result = await env.CLOUD_DB.batch([
    env.CLOUD_DB.prepare("INSERT OR IGNORE INTO private_vault_history (vault_id, revision, envelope, updated_at) SELECT id, revision, envelope, updated_at FROM private_vaults WHERE id = ? AND token_hash = ? AND revision = ?").bind(id, tokenHash, revision),
    env.CLOUD_DB.prepare("UPDATE private_vaults SET envelope = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND token_hash = ? AND revision = ?").bind(envelope, now, id, tokenHash, revision),
    env.CLOUD_DB.prepare("DELETE FROM private_vault_history WHERE vault_id = ? AND revision < (SELECT revision - 2 FROM private_vaults WHERE id = ?)").bind(id, id),
  ]);
  if (result[1].meta.changes !== 1) throw failure(409, "Another device saved changes");
  return json({ revision: revision + 1, updatedAt: now }, 200, cors);
}

export function createDurableVaultDatabase(storage) {
  const execute = (sql, values) => storage.sql.exec(sql, ...values).toArray();
  const run = (sql, values) => {
    const results = execute(sql, values);
    const changes = execute("SELECT changes() AS changes", [])[0].changes;
    return { results, meta: { changes } };
  };
  const statement = (sql, values = []) => ({
    sql, values,
    bind(...args) { return statement(sql, args); },
    first() { return execute(sql, values)[0] || null; },
    all() { return { results: execute(sql, values) }; },
    run() { return run(sql, values); },
  });
  return {
    prepare: statement,
    batch(statements) { return storage.transactionSync(() => statements.map(item => run(item.sql, item.values))); },
  };
}

export class PrivateVaultStore {
  constructor(ctx, env) {
    ctx.storage.sql.exec(CLOUD_VAULT_SCHEMA).toArray();
    this.env = { ...env, VAULT_STORE: undefined, CLOUD_DB: createDurableVaultDatabase(ctx.storage) };
  }
  fetch(request) { return worker.fetch(request, this.env); }
}

const worker = {
  async fetch(request, env) {
    const origin = request.headers.get("origin");
    const allowed = new Set((env.APP_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean));
    const cors = allowed.has(origin) ? { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type, If-Match", "access-control-max-age": "600" } : {};
    try {
      const url = new URL(request.url);
      if (url.protocol !== "https:" && env.DEV_MODE !== "1") throw failure(503, "HTTPS required");
      if (!["/health", "/cloud/health"].includes(url.pathname) && (!origin || !allowed.has(origin))) throw failure(403, "Origin denied");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (env.VAULT_STORE && !["/health", "/cloud/health"].includes(url.pathname)) return await env.VAULT_STORE.get(env.VAULT_STORE.idFromName("private-vaults-v1")).fetch(request);
      return await route(request, env, cors);
    } catch (error) { return json({ error: error.status ? error.message : "Private cloud storage is unavailable" }, error.status || 503, cors); }
  },
};
export default worker;
