import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import proxy from "../backend/pages-cloud-proxy.js";

const origin = "https://reminders-web-rea.pages.dev";
const bearer = `Bearer ${"s".repeat(43)}`;
function setup() {
  const cloudCalls = [], assetCalls = [];
  const env = {
    CLOUD: { async fetch(request) { cloudCalls.push(request); return new Response(JSON.stringify({ revision: 4 }), { headers: { "content-type": "application/json", "set-cookie": "must-not-forward" } }); } },
    ASSETS: { async fetch(request) { assetCalls.push(request); return new Response(new URL(request.url).pathname === "/api-disabled.json" ? JSON.stringify({ enabled: false, agentApiEnabled: false, deviceSyncEnabled: false }) : "synthetic asset", { headers: { "content-type": "application/json" } }); } },
  };
  return { env, cloudCalls, assetCalls };
}
const request = (path, { method = "GET", headers = {}, host = origin, body } = {}) => new Request(`${host}${path}`, { method, headers, body });

test("public Pages binds only the explicit production cloud service; previews cannot inherit it", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.cloud-pages.example.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.services, [{ binding: "CLOUD", service: "agent-reminders-private-cloud", environment: "production" }]);
  assert.deepEqual(config.env.preview.services, []);
  assert.equal(config.d1_databases, undefined); assert.equal(config.r2_buckets, undefined);
});

test("only nested cloud routes use CLOUD; capability passes privately, cookies/referrer are removed and missing GET Origin is supplied", async () => {
  const { env, cloudCalls, assetCalls } = setup();
  const response = await proxy.fetch(request("/cloud/v1/vaults/synthetic/history/1", { headers: { authorization: bearer, cookie: "private-cookie", referer: `${origin}/?private=never-forward` } }), env);
  assert.equal(response.status, 200);
  assert.equal(cloudCalls.length, 1); assert.equal(assetCalls.length, 0);
  assert.equal(new URL(cloudCalls[0].url).pathname, "/cloud/v1/vaults/synthetic/history/1");
  assert.equal(cloudCalls[0].headers.get("authorization"), bearer);
  assert.equal(cloudCalls[0].headers.get("origin"), origin);
  assert.equal(cloudCalls[0].headers.get("cookie"), null); assert.equal(cloudCalls[0].headers.get("referer"), null);
  assert.equal(cloudCalls[0].redirect, "error");
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("set-cookie"), null);
  await proxy.fetch(request("/_expo/static/synthetic.js"), env);
  assert.equal(cloudCalls.length, 1); assert.equal(assetCalls.length, 1);
});

test("cloud writes require same app Origin and bearer; preview/foreign/query/missing-binding fail closed", async () => {
  const { env, cloudCalls } = setup();
  const headers = { authorization: bearer, "content-type": "application/json" };
  assert.equal((await proxy.fetch(request("/cloud/v1/vaults/synthetic", { method: "PUT", headers, body: "{}" }), env)).status, 403);
  for (const foreign of ["https://evil.test", "https://agent-reminders-demo.pages.dev", "null"]) assert.equal((await proxy.fetch(request("/cloud/v1/vaults/synthetic", { headers: { ...headers, origin: foreign } }), env)).status, 403);
  assert.equal((await proxy.fetch(request("/cloud/v1/vaults/synthetic", { headers, host: "https://preview.reminders-web-rea.pages.dev" }), env)).status, 503);
  assert.equal((await proxy.fetch(request("/cloud/v1/vaults/synthetic?key=do-not-forward", { headers }), env)).status, 400);
  assert.equal((await proxy.fetch(request("/cloud/v1/vaults/synthetic", { headers: { origin } }), env)).status, 401);
  assert.equal((await proxy.fetch(request("/cloud/v1/vaults/synthetic", { headers }), { ASSETS: env.ASSETS })).status, 503);
  assert.equal(cloudCalls.length, 0);
  const allowed = await proxy.fetch(request("/cloud/v1/vaults/synthetic", { method: "PUT", headers: { ...headers, origin }, body: "{\"version\":1}" }), env);
  assert.equal(allowed.status, 200); assert.equal(await cloudCalls[0].text(), "{\"version\":1}");
});

test("API routes always serve disabled metadata and never forward owner or agent authority to CLOUD", async () => {
  const { env, cloudCalls, assetCalls } = setup();
  const response = await proxy.fetch(request("/api/state", { headers: { authorization: bearer, cookie: "owner-session" } }), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).enabled, false);
  assert.equal(new URL(assetCalls[0].url).pathname, "/api-disabled.json");
  assert.equal(assetCalls[0].headers.get("authorization"), null); assert.equal(assetCalls[0].headers.get("cookie"), null);
  for (const path of ["/api", "/api/auth/login", "/api/device/v1/pairings"]) assert.equal((await proxy.fetch(request(path, { method: "POST", headers: { origin, authorization: bearer }, body: "private-not-logged" }), env)).status, 405);
  assert.equal(cloudCalls.length, 0);
});

test("health and preflight do not expose capabilities; redirects and upstream errors cannot leave the private service", async () => {
  const { env, cloudCalls } = setup();
  assert.equal((await proxy.fetch(request("/cloud/health", { headers: { authorization: "unused-private-provider-token" } }), env)).status, 200);
  assert.equal((await proxy.fetch(request("/cloud/v1/vaults/synthetic", { method: "OPTIONS", headers: { origin } }), env)).status, 200);
  assert.equal(cloudCalls.length, 2);
  assert.equal(cloudCalls[0].headers.get("authorization"), null);
  env.CLOUD.fetch = async () => new Response(null, { status: 302, headers: { location: "https://evil.test" } });
  assert.equal((await proxy.fetch(request("/cloud/v1/vaults/synthetic", { headers: { authorization: bearer } }), env)).status, 503);
  env.CLOUD.fetch = async () => { throw new Error("private backend detail must not escape"); };
  const failed = await proxy.fetch(request("/cloud/v1/vaults/synthetic", { headers: { authorization: bearer } }), env);
  assert.equal(failed.status, 503); assert.equal((await failed.text()).includes("private backend detail"), false);
});
