import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { seedData } from "../src/model.js";
import { emptyAccountProvenance } from "../src/account-import.js";
import { createCloudVaultClient, createVaultRecoveryCode, decryptVaultSnapshot, encryptVaultSnapshot, MAX_VAULT_ENVELOPE, MAX_VAULT_PLAINTEXT, parseVaultRecoveryCode, validateVaultSnapshot } from "../src/cloud-vault.js";
import worker, { PrivateVaultStore, createDurableVaultDatabase } from "../backend/cloud-vault-worker.js";
import { CLOUD_VAULT_SCHEMA } from "../backend/cloud-vault-schema.js";

const origin = "https://synthetic-reminders.test";
const endpoint = "https://synthetic-cloud.test";
const snapshot = () => ({ version: 1, data: seedData(new Date("2026-10-12T12:00:00Z")), accountMetadata: { version: 1, provenance: emptyAccountProvenance(), selections: {} } });

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(CLOUD_VAULT_SCHEMA);
  const statement = (sql, values = []) => ({
    sql, values,
    bind(...args) { return statement(sql, args); },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...values).changes } }; },
  });
  const CLOUD_DB = {
    prepare: statement,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result = [];
        for (const item of statements) result.push(await item.run());
        sqlite.exec("COMMIT"); return result;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const env = { CLOUD_DB, RATE_LIMIT_SECRET: "synthetic-rate-limit-secret-1234567890", APP_ORIGINS: origin };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return worker.fetch(new Request(url, { ...options, headers: { ...options.headers, origin } }), env);
  };
  return { sqlite, env, requests, fetchImpl };
}

function durableStorage() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const storage = {
    sql: {
      exec(sql, ...values) {
        let rows;
        if (sql.trim().split(";").filter(Boolean).length > 1) { sqlite.exec(sql); rows = []; }
        else {
          const statement = sqlite.prepare(sql);
          if (statement.columns().length) rows = statement.all(...values);
          else { statement.run(...values); rows = []; }
        }
        return { toArray: () => rows };
      },
    },
    transactionSync(callback) {
      sqlite.exec("BEGIN");
      try {
        const result = callback();
        assert.equal(typeof result?.then, "undefined", "DO transactions consume SQL results synchronously");
        sqlite.exec("COMMIT"); return result;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { sqlite, storage };
}

test("recovery derives separate auth/encryption keys; sections and metadata survive authenticated encryption", async () => {
  const code = createVaultRecoveryCode(), keys = await parseVaultRecoveryCode(code);
  assert.equal(keys.encryptionKey.extractable, false);
  assert.equal(keys.token.length, 43);
  assert.notEqual(keys.token, code.split(".")[2]);
  const value = snapshot();
  value.data.lists[0].sections = [{ id: "synthetic-directors", name: "Directors" }, { id: "synthetic-films", name: "Recommended Films" }];
  value.data.reminders[0].sectionId = "synthetic-directors";
  value.accountMetadata.provenance.lists.push({ provider: "icloud", sourceId: "synthetic-native-list", localId: value.data.lists[0].id, base: { name: "Synthetic Study", color: "#007AFF", group: "iCloud", sections: structuredClone(value.data.lists[0].sections) }, lastSeenAt: "2026-10-12T12:00:00.000Z" });
  value.accountMetadata.provenance.reminders.push({ provider: "icloud", sourceId: "synthetic-native-reminder", sourceListId: "synthetic-native-list", localId: value.data.reminders[0].id, base: { title: value.data.reminders[0].title, sectionId: "synthetic-directors" }, order: 0, lastSeenAt: "2026-10-12T12:00:00.000Z" });
  const first = await encryptVaultSnapshot(keys, value, 0), second = await encryptVaultSnapshot(keys, value, 0);
  assert.notEqual(first.iv, second.iv); assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(JSON.stringify(first).includes("Recommended Films"), false);
  assert.deepEqual(await decryptVaultSnapshot(keys, first, 0), value);
  await assert.rejects(decryptVaultSnapshot(keys, first, 1), { code: "decrypt_failed" });
  const other = await parseVaultRecoveryCode(createVaultRecoveryCode());
  await assert.rejects(decryptVaultSnapshot(other, first, 0), { code: "decrypt_failed" });
  const tampered = { ...first, ciphertext: `${first.ciphertext.slice(0, -2)}AA` };
  await assert.rejects(decryptVaultSnapshot(keys, tampered, 0), { code: "decrypt_failed" });
  for (const invalid of ["", "arv1.bad.bad", `${code}.extra`, code.replace("arv1", "arv2")]) await assert.rejects(parseVaultRecoveryCode(invalid), { code: "invalid_key" });
});

test("real SQLite cloud API stores ciphertext only and isolates anonymous/wrong-vault credentials", async () => {
  const { fetchImpl, requests, env, sqlite } = setup();
  const code = createVaultRecoveryCode(), keys = await parseVaultRecoveryCode(code);
  const client = createCloudVaultClient({ endpoint, recoveryCode: code, fetchImpl });
  const original = snapshot();
  assert.equal((await client.create(original)).revision, 0);
  const stored = sqlite.prepare("SELECT * FROM private_vaults").get();
  assert.equal(stored.token_hash.length, 64); assert.notEqual(stored.token_hash, keys.token);
  assert.equal(stored.envelope.includes("Prepare project update"), false);
  assert.equal(stored.envelope.includes(code), false);
  assert.deepEqual((await client.read()).snapshot, original);
  assert.equal(requests.every(row => !row.url.includes(code) && !row.options.body?.includes(code)), true);
  assert.equal(requests.every(row => row.options.credentials === "omit" && row.options.redirect === "error"), true);
  const url = `${endpoint}/v1/vaults/${keys.id}`;
  assert.equal((await worker.fetch(new Request(url, { headers: { origin } }), env)).status, 401);
  const other = await parseVaultRecoveryCode(createVaultRecoveryCode());
  assert.equal((await worker.fetch(new Request(url, { headers: { origin, authorization: `Bearer ${other.token}` } }), env)).status, 401);
  assert.equal((await worker.fetch(new Request(`${endpoint}/v1/vaults`, { headers: { origin, authorization: `Bearer ${keys.token}` } }), env)).status, 404);
});

test("lost creation response retries the same encrypted workspace without consuming another creation quota", async () => {
  const { fetchImpl, requests, sqlite } = setup();
  let loseFirstResponse = true;
  const interrupted = async (url, options) => {
    const response = await fetchImpl(url, options);
    if (options.method === "POST" && loseFirstResponse) { loseFirstResponse = false; throw new TypeError("Synthetic lost acknowledgement after commit"); }
    return response;
  };
  const code = createVaultRecoveryCode(), client = createCloudVaultClient({ endpoint, recoveryCode: code, fetchImpl: interrupted });
  const initial = snapshot();
  await assert.rejects(client.create(initial), { code: "offline" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM private_vaults").get().count, 1);
  assert.equal((await client.create(initial)).revision, 0);
  assert.equal(requests[0].url, requests[1].url);
  assert.equal(requests[0].options.body, requests[1].options.body);
  assert.equal(sqlite.prepare("SELECT SUM(count) AS count FROM private_vault_limits WHERE bucket LIKE 'creation:%'").get().count, 1);
  assert.deepEqual((await client.read()).snapshot, initial);
  const changed = structuredClone(initial); changed.data.reminders[0].notes = "Later local edit";
  await assert.rejects(client.create(changed), { code: "invalid_snapshot" });
  const nextSession = createCloudVaultClient({ endpoint, recoveryCode: code, fetchImpl });
  await assert.rejects(nextSession.create(changed), { code: "conflict" });
  assert.deepEqual((await nextSession.read()).snapshot, initial);
});

test("CAS rejects stale saves atomically and retains only two decryptable previous versions", async () => {
  const { fetchImpl, sqlite } = setup();
  const code = createVaultRecoveryCode(), client = createCloudVaultClient({ endpoint, recoveryCode: code, fetchImpl });
  let current = snapshot();
  await client.create(current);
  for (let revision = 0; revision < 4; revision++) {
    current = structuredClone(current); current.data.reminders[0].notes = `Synthetic version ${revision + 1}`;
    assert.equal((await client.save(current, revision)).revision, revision + 1);
  }
  await assert.rejects(client.save(snapshot(), 0), { code: "conflict" });
  const latest = await client.read();
  assert.equal(latest.revision, 4); assert.equal(latest.snapshot.data.reminders[0].notes, "Synthetic version 4");
  assert.deepEqual(latest.history.map(row => row.revision), [3, 2]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM private_vault_history").get().count, 2);
  assert.equal((await client.readHistory(2)).snapshot.data.reminders[0].notes, "Synthetic version 2");
  await assert.rejects(client.readHistory(0), { code: "cloud_error" });
  await client.remove(4);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM private_vault_history").get().count, 0);
  await assert.rejects(client.read(), { code: "unauthorized" });
});

test("CORS, HTTPS, input size, non-JSON and incomplete configuration fail closed", async () => {
  const { env } = setup(), keys = await parseVaultRecoveryCode(createVaultRecoveryCode());
  const url = `${endpoint}/v1/vaults/${keys.id}`;
  const headers = { origin, authorization: `Bearer ${keys.token}`, "content-type": "application/json" };
  for (const deniedOrigin of ["", "https://evil.test", `${origin}.evil.test`]) assert.equal((await worker.fetch(new Request(url, { headers: { ...headers, origin: deniedOrigin } }), env)).status, 403);
  const allowed = await worker.fetch(new Request(url, { method: "OPTIONS", headers: { origin } }), env);
  assert.equal(allowed.status, 204); assert.equal(allowed.headers.get("access-control-allow-origin"), origin); assert.equal(allowed.headers.get("access-control-allow-credentials"), null);
  assert.equal((await worker.fetch(new Request(url.replace("https:", "http:"), { headers }), env)).status, 503);
  assert.equal((await worker.fetch(new Request(url, { headers }), { ...env, RATE_LIMIT_SECRET: "short" })).status, 503);
  assert.equal((await worker.fetch(new Request(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }), env)).status, 415);
  assert.equal((await worker.fetch(new Request(url, { method: "POST", headers, body: "x".repeat(MAX_VAULT_ENVELOPE + 1) }), env)).status, 413);
  assert.equal((await worker.fetch(new Request(url, { method: "POST", headers, body: JSON.stringify({ version: 1, iv: "A".repeat(16), ciphertext: "A".repeat(24), title: "private" }) }), env)).status, 400);
  assert.throws(() => createCloudVaultClient({ endpoint: "http://evil.test", recoveryCode: "" }), { code: "not_configured" });
  assert.throws(() => createCloudVaultClient({ endpoint: `${endpoint}/?key=private`, recoveryCode: "" }), { code: "not_configured" });
});

test("creation quotas and maximum tenant count cap free-tier growth; deletion requires owner capability and current revision", async () => {
  const { env, sqlite, fetchImpl } = setup();
  const codes = [];
  for (let index = 0; index < 3; index++) { const code = createVaultRecoveryCode(); codes.push(code); await createCloudVaultClient({ endpoint, recoveryCode: code, fetchImpl }).create(snapshot()); }
  await assert.rejects(createCloudVaultClient({ endpoint, recoveryCode: createVaultRecoveryCode(), fetchImpl }).create(snapshot()), { code: "rate_limited" });
  for (let index = 3; index < 50; index++) sqlite.prepare("INSERT INTO private_vaults (id,token_hash,envelope,revision,created_at,updated_at) VALUES (?,?,?,0,0,0)").run(`synthetic-${index}`, "hash", "{}");
  const newKeys = await parseVaultRecoveryCode(createVaultRecoveryCode()), envelope = await encryptVaultSnapshot(newKeys, snapshot(), 0);
  const denied = await worker.fetch(new Request(`${endpoint}/v1/vaults/${newKeys.id}`, { method: "POST", headers: { origin, authorization: `Bearer ${newKeys.token}`, "cf-connecting-ip": "203.0.113.2", "content-type": "application/json" }, body: JSON.stringify(envelope) }), env);
  assert.equal(denied.status, 429); assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM private_vaults").get().count, 50);
  const keys = await parseVaultRecoveryCode(codes[0]), url = `${endpoint}/v1/vaults/${keys.id}`;
  const headers = { origin, authorization: `Bearer ${keys.token}`, "if-match": "1" };
  assert.equal((await worker.fetch(new Request(url, { method: "DELETE", headers }), env)).status, 409);
  assert.equal((await worker.fetch(new Request(url, { method: "DELETE", headers: { ...headers, "if-match": "0" } }), env)).status, 200);
  assert.equal((await worker.fetch(new Request(url, { headers }), env)).status, 401);
});

test("snapshot validation rejects foreign sections, token metadata and oversized plaintext without uploading", async () => {
  const valid = snapshot(); assert.equal(validateVaultSnapshot(valid), true);
  const foreign = structuredClone(valid); foreign.data.reminders[0].sectionId = "not-in-list";
  assert.equal(validateVaultSnapshot(foreign), false);
  const token = structuredClone(valid); token.accountMetadata.accessToken = "never-persist-google-token";
  assert.equal(validateVaultSnapshot(token), false);
  const large = structuredClone(valid); large.data.reminders[0].notes = "x".repeat(MAX_VAULT_PLAINTEXT);
  const keys = await parseVaultRecoveryCode(createVaultRecoveryCode());
  await assert.rejects(encryptVaultSnapshot(keys, large, 0), { code: "invalid_snapshot" });
  const { env, sqlite } = setup();
  for (let index = 0; index < 5000; index++) sqlite.prepare("INSERT INTO private_vault_limits (bucket,count,expires_at) VALUES (?,1,?)").run(`bounded-${index}`, Date.now() + 86400000);
  const request = new Request(`${endpoint}/v1/vaults/${keys.id}`, { headers: { origin, authorization: `Bearer ${keys.token}` } });
  assert.equal((await worker.fetch(request, env)).status, 429);
  sqlite.prepare("UPDATE private_vault_limits SET expires_at = 0").run();
  assert.equal((await worker.fetch(request, env)).status, 401);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM private_vault_limits").get().count, 1);
});

test("maximum permitted encrypted row remains below SQLite two-million-byte row ceiling", async () => {
  const { fetchImpl, sqlite } = setup(), code = createVaultRecoveryCode();
  const value = snapshot();
  const overhead = new TextEncoder().encode(JSON.stringify(value)).length;
  value.data.reminders[0].notes = "x".repeat(MAX_VAULT_PLAINTEXT - overhead);
  assert.equal(validateVaultSnapshot(value), true);
  const client = createCloudVaultClient({ endpoint: `${endpoint}/cloud`, recoveryCode: code, fetchImpl });
  await client.create(value);
  const stored = sqlite.prepare("SELECT length(CAST(envelope AS BLOB)) AS size FROM private_vaults").get();
  assert.ok(stored.size < 2000000);
  assert.ok(stored.size <= MAX_VAULT_ENVELOPE);
  assert.deepEqual((await client.read()).snapshot, value);
});

test("SQLite Durable Object persists encrypted workspaces across instance restart and enforces tenant isolation/CAS", async () => {
  const { sqlite, storage } = durableStorage();
  const env = { RATE_LIMIT_SECRET: "synthetic-durable-limit-secret-1234567890", APP_ORIGINS: origin };
  let object = new PrivateVaultStore({ storage }, env);
  const namespaceCalls = [];
  env.VAULT_STORE = {
    idFromName(name) { namespaceCalls.push(name); return name; },
    get() { return { fetch: request => object.fetch(request) }; },
  };
  const fetchImpl = (url, options) => worker.fetch(new Request(url, { ...options, headers: { ...options.headers, origin } }), env);
  const code = createVaultRecoveryCode(), client = createCloudVaultClient({ endpoint: `${endpoint}/cloud`, recoveryCode: code, fetchImpl });
  const initial = snapshot();
  initial.data.lists[0].sections = [{ id: "synthetic-section", name: "Synthetic Section" }];
  initial.data.reminders[0].sectionId = "synthetic-section";
  await client.create(initial);
  object = new PrivateVaultStore({ storage }, env);
  assert.deepEqual((await client.read()).snapshot, initial);
  const revised = structuredClone(initial); revised.data.reminders[0].notes = "After synthetic restart";
  await client.save(revised, 0);
  await assert.rejects(client.save(initial, 0), { code: "conflict" });
  object = new PrivateVaultStore({ storage }, env);
  assert.deepEqual((await client.read()).snapshot, revised);
  assert.deepEqual((await client.readHistory(0)).snapshot, initial);
  const keys = await parseVaultRecoveryCode(code), foreign = await parseVaultRecoveryCode(createVaultRecoveryCode());
  assert.equal((await worker.fetch(new Request(`${endpoint}/cloud/v1/vaults/${keys.id}`, { headers: { origin, authorization: `Bearer ${foreign.token}` } }), env)).status, 401);
  assert.equal(namespaceCalls.every(name => name === "private-vaults-v1"), true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM private_vaults").get().count, 1);
  const health = await (await worker.fetch(new Request(`${endpoint}/health`), env)).json();
  assert.equal(health.configured, true); assert.equal(health.storage, "sqlite-durable-object");
});

test("DO synchronous transaction rolls back the preceding history insert on a failed encrypted snapshot update", async () => {
  const { sqlite, storage } = durableStorage();
  const env = { RATE_LIMIT_SECRET: "synthetic-durable-limit-secret-1234567890", APP_ORIGINS: origin };
  const object = new PrivateVaultStore({ storage }, env);
  const fetchImpl = (url, options) => object.fetch(new Request(url, { ...options, headers: { ...options.headers, origin } }));
  const client = createCloudVaultClient({ endpoint, recoveryCode: createVaultRecoveryCode(), fetchImpl });
  const initial = snapshot(); await client.create(initial);
  sqlite.exec("CREATE TRIGGER synthetic_cloud_failure BEFORE UPDATE ON private_vaults BEGIN SELECT RAISE(ABORT, 'synthetic test failure'); END;");
  const revised = structuredClone(initial); revised.data.reminders[0].notes = "Must not become durable";
  await assert.rejects(client.save(revised, 0), { code: "cloud_error" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM private_vault_history").get().count, 0);
  assert.deepEqual((await client.read()).snapshot, initial);
  sqlite.exec("DROP TRIGGER synthetic_cloud_failure");
  await client.save(revised, 0);
  assert.deepEqual((await client.read()).snapshot, revised);
  const db = createDurableVaultDatabase(storage);
  assert.equal(db.prepare("UPDATE private_vaults SET updated_at = updated_at WHERE revision = ?").bind(99).run().meta.changes, 0);
});
