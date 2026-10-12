import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seedData } from "../src/model.js";
import { createCloudVaultClient, createVaultRecoveryCode } from "../src/cloud-vault.js";

const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const { buildSync } = require("esbuild");
const origin = "https://reminders-web-rea.pages.dev";

test("actual workerd service binding supports safe health and encrypted SQLite vault roundtrip without redirects or external network", async () => {
  const proxy = readFileSync(new URL("../backend/pages-cloud-proxy.js", import.meta.url), "utf8");
  const vault = buildSync({ entryPoints: [fileURLToPath(new URL("../backend/cloud-vault-worker.js", import.meta.url))], bundle: true, write: false, format: "esm", platform: "neutral" }).outputFiles[0].text;
  let outbound = 0;
  const blocked = () => { outbound++; throw new Error("Synthetic external network denied"); };
  const options = { cf: false, workers: [
    { name: "synthetic-proxy", modules: true, script: proxy, compatibilityDate: "2026-10-12", serviceBindings: { CLOUD: "synthetic-vault", ASSETS: () => new Response(JSON.stringify({ enabled: false })) }, outboundService: blocked },
    { name: "synthetic-vault", modules: true, script: vault, compatibilityDate: "2026-10-12", bindings: { APP_ORIGINS: origin, DEV_MODE: "0", RATE_LIMIT_SECRET: "synthetic-only-rate-secret-123456789012345678" }, durableObjects: { VAULT_STORE: { className: "PrivateVaultStore", useSQLite: true } }, outboundService: blocked },
  ] };
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  try {
    const health = await mf.dispatchFetch(`${origin}/cloud/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).configured, true);
    const client = createCloudVaultClient({ endpoint: `${origin}/cloud`, recoveryCode: createVaultRecoveryCode(), fetchImpl: (url, options) => mf.dispatchFetch(url, { ...options, headers: { ...options.headers, origin } }) });
    const snapshot = { version: 1, data: seedData(new Date("2026-10-12T12:00:00Z")) };
    snapshot.data.lists[0].sections = [{ id: "synthetic-workerd-section", name: "Synthetic Section" }];
    snapshot.data.reminders[0].sectionId = "synthetic-workerd-section";
    assert.equal((await client.create(snapshot)).revision, 0);
    assert.deepEqual((await client.read()).snapshot, snapshot);
    const revised = structuredClone(snapshot); revised.data.reminders[0].notes = "Synthetic workerd durable update";
    assert.equal((await client.save(revised, 0)).revision, 1);
    assert.deepEqual((await client.read()).snapshot, revised);
    assert.deepEqual((await client.readHistory(0)).snapshot, snapshot);
    await assert.rejects(client.save(snapshot, 0), { code: "conflict" });
    assert.equal((await mf.dispatchFetch(`${origin}/api/state`)).status, 200);
    assert.equal((await (await mf.dispatchFetch(`${origin}/api/state`)).json()).enabled, false);
    await client.remove(1);
    await assert.rejects(client.read(), { code: "unauthorized" });
    assert.equal(outbound, 0);
  } finally { await mf.dispose(); }
});
