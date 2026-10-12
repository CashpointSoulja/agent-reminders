import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "@babel/core";
import { accountMetadataSnapshot, parseAccountMetadata } from "../src/useAccounts.js";
import { seedData } from "../src/model.js";
import { createVaultRecoveryCode, parseVaultRecoveryCode, encryptVaultSnapshot, decryptVaultSnapshot, VAULT_ENROLLMENT_LOCAL_KEY, VAULT_LOCAL_KEY } from "../src/cloud-vault.js";

const file = fileURLToPath(new URL("../src/CloudStorageSheet.jsx", import.meta.url));
const compiled = transformSync(readFileSync(file, "utf8"), { filename: file, babelrc: false, configFile: false, plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;
const componentModule = new Module(file), require = createRequire(file);
componentModule.require = id => id.endsWith(".css") ? {} : require(id);
componentModule._compile(compiled, file);
const CloudStorageSheet = componentModule.exports.default;
const code = "arv1.synthetic-private-recovery-code";
function render(overrides = {}) {
  let mutations = 0;
  const mutate = () => { mutations++; };
  const cloud = { enabled: true, configured: true, connected: false, remembered: false, busy: false, status: "Off", error: "", recoveryCode: code, history: [], create: mutate, connect: mutate, useCloudVersion: mutate, keepLocalVersion: mutate, disconnect: mutate, refresh: mutate, retry: mutate, setRemembered: mutate, previewHistory: mutate, ...overrides };
  const html = renderToStaticMarkup(React.createElement(CloudStorageSheet, { cloud, data: seedData(), onClose: mutate, onExport: mutate }));
  return { html, mutations };
}

test("opening Cloud Storage does not upload, connect, copy or display a private recovery code", () => {
  const { html, mutations } = render();
  assert.equal(mutations, 0);
  assert.equal(html.includes(code), false);
  assert.match(html, /Enable Cloud Storage/);
  assert.match(html, /Preview Cloud Reminders/);
  assert.match(html, /type="password"/);
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
  assert.match(html, /role="dialog".*aria-labelledby="cloud-storage-title"/);
});

test("connected recovery codes stay out of initial DOM, labels, titles and status", () => {
  const { html, mutations } = render({ connected: true, status: "Saved to Cloud" });
  assert.equal(mutations, 0);
  assert.equal(html.includes(code), false);
  assert.match(html, /Show Code/);
  assert.match(html, /Copy Code/);
  assert.match(html, /cannot recover your backup if the code is lost/);
  assert.match(html, /connection lasts until this page closes/);
});

test("an interrupted setup retains masked recovery controls and instructs retrying the same workspace", () => {
  const { html, mutations } = render({ connected: false, status: "Cloud Setup Not Confirmed", error: "Synthetic acknowledgement was lost" });
  assert.equal(mutations, 0); assert.equal(html.includes(code), false);
  assert.match(html, /Show Code/); assert.match(html, /Copy Code/);
  assert.match(html, /Setup may already have created an encrypted backup/);
  assert.match(html, /retry Enable Cloud Storage to check the same workspace/);
  assert.match(html, /Synthetic acknowledgement was lost/);
});

test("cloud restore preview names both replacements and does not replace data on render", () => {
  const data = seedData();
  data.lists[0].sections = [{ id: "synthetic-section", name: "Synthetic Reference Section" }];
  const before = JSON.stringify(data);
  const { html, mutations } = render({ connected: true, status: "Review Cloud Reminders", cloudPreview: { revision: 3, snapshot: { version: 1, data } } });
  assert.equal(mutations, 0);
  assert.equal(JSON.stringify(data), before);
  assert.match(html, /1 sections/);
  assert.match(html, /Use Cloud Version/);
  assert.match(html, /Keep This Device Version/);
  assert.match(html, /Export This Device Backup/);
  assert.match(html, /replaces the reminders on this device/);
  assert.match(html, /replaces the cloud copy/);
});

test("safe cloud metadata is a detached snapshot and rejects credentials at every boundary", () => {
  const provenance = { version: 1, lists: [], reminders: [] }, selections = { icloud: ["synthetic-list"] };
  const info = { icloud: { importedAt: "2026-10-12T10:00:00.000Z", lists: 1, sample: true } };
  const snapshot = accountMetadataSnapshot(provenance, selections, info);
  selections.icloud.push("local-only-selection");
  assert.deepEqual(snapshot.selections.icloud, ["synthetic-list"]);
  assert.equal(snapshot.importInfo.icloud.sample, true);
  assert.throws(() => accountMetadataSnapshot({ ...provenance, access_token: "synthetic-google-token" }, {}, {}), /invalid/);
  assert.throws(() => accountMetadataSnapshot(provenance, { "google-tasks": ["duplicate", "duplicate"] }, {}), /invalid/);
  assert.throws(() => accountMetadataSnapshot(provenance, {}, { icloud: { ...info.icloud, recoveryCode: code } }), /invalid/);
  assert.equal(parseAccountMetadata(JSON.stringify({ ...snapshot, token: "synthetic-google-token" })).version, undefined);
});

test("browser cloud consent, masked codes, offline edits, preview guards and explicit replacement", { skip: !process.env.CLOUD_STORAGE_BROWSER_TEST_URL }, async () => {
  const { chromium, expect } = require("@playwright/test");
  const base = process.env.CLOUD_STORAGE_BROWSER_TEST_URL, origin = new URL(base).origin;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark", serviceWorkers: "block" });
  const local = seedData(), remote = seedData();
  local.lists[0].name = "Synthetic Local Work";
  remote.lists[0].name = "Synthetic Cloud Work";
  remote.lists[0].sections = [{ id: "synthetic-cloud-section", name: "Synthetic Reference Section" }];
  const existingCode = createVaultRecoveryCode(), keys = await parseVaultRecoveryCode(existingCode);
  const vaults = new Map([[keys.id, { revision: 0, envelope: await encryptVaultSnapshot(keys, { version: 1, data: remote }, 0) }]]);
  const blocked = [], requests = [];
  let offlineWrites = false;
  let loseCreationResponse = false;
  try {
    await context.addInitScript(({ data, connectionKey, enrollmentKey }) => {
      if (location.origin === "null") return;
      if (!localStorage.getItem("reminders-web-v1")) localStorage.setItem("reminders-web-v1", JSON.stringify(data));
      window.__syntheticClipboardWrites = 0;
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { window.__syntheticClipboardWrites++; } } });
      window.__syntheticConnectionKey = connectionKey;
      window.__syntheticEnrollmentKey = enrollmentKey;
    }, { data: local, connectionKey: VAULT_LOCAL_KEY, enrollmentKey: VAULT_ENROLLMENT_LOCAL_KEY });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { blocked.push(url.origin + url.pathname); return route.abort(); }
      const match = url.pathname.match(/^\/cloud\/v1\/vaults\/([A-Za-z0-9_-]+)$/);
      if (!match) return route.continue();
      requests.push(request.method());
      const id = match[1], entry = vaults.get(id);
      let status = 200, body;
      if (request.method() === "GET") {
        status = entry ? 200 : 401;
        body = entry ? { ...entry, history: [], updatedAt: "2026-10-12T12:00:00.000Z" } : {};
      } else if (offlineWrites) { status = 503; body = {}; }
      else {
        const envelope = JSON.parse(request.postData());
        assert.equal(Object.hasOwn(envelope, "ciphertext"), true);
        assert.equal(request.postData().includes("Synthetic Local Work"), false, "Uploads must be encrypted");
        assert.equal(request.postData().includes("Synthetic Reference Section"), false, "Section names must be encrypted too");
        assert.equal(request.postData().includes(existingCode), false, "A recovery code must not be uploaded");
        assert.match(request.headers().authorization || "", /^Bearer [A-Za-z0-9_-]{43}$/);
        if (request.method() === "POST") {
          vaults.set(id, { revision: 0, envelope }); body = { revision: 0 };
          if (loseCreationResponse) { loseCreationResponse = false; return route.abort(); }
        } else if (request.method() === "PUT") {
          if (!entry || request.headers()["if-match"] !== String(entry.revision)) { status = 409; body = {}; }
          else { vaults.set(id, { revision: entry.revision + 1, envelope }); body = { revision: entry.revision + 1 }; }
        }
      }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    const saved = () => page.evaluate(() => localStorage.getItem("reminders-web-v1"));
    const credential = () => page.evaluate(() => localStorage.getItem(window.__syntheticConnectionKey));
    const pendingCredential = () => page.evaluate(() => localStorage.getItem(window.__syntheticEnrollmentKey));
    async function openCloud() {
      await page.locator('[data-ui="sidebar"] [aria-label="More"]').click();
      await page.getByRole("menuitem", { name: "Cloud Storage", exact: true }).click();
    }
    const closeCloud = () => page.locator(".cloud-storage-sheet").getByRole("button", { name: "Done", exact: true }).click();
    await page.goto(base);
    await openCloud();
    assert.deepEqual(requests, [], "Opening the app or sheet must not upload reminders");
    await expect(page.getByRole("checkbox", { name: "Remember on This Device", exact: true })).not.toBeChecked();
    await page.getByRole("checkbox", { name: "Remember on This Device", exact: true }).check();
    loseCreationResponse = true;
    await page.getByRole("button", { name: "Enable Cloud Storage", exact: true }).click();
    await expect(page.locator(".cloud-summary-row")).toContainText("Cloud Setup Not Confirmed");
    assert.ok(await pendingCredential(), "Explicit Remember must preserve an interrupted setup capability");
    assert.equal(await credential(), null, "Interrupted setup must remain separate from confirmed autosave");
    await expect(page.getByRole("button", { name: "Show Code", exact: true })).toBeVisible();
    const beforeResume = await saved();
    await page.reload(); await openCloud();
    assert.deepEqual(requests, ["POST"], "Reopening must not create or upload a workspace");
    await expect(page.locator(".cloud-summary-row")).toContainText("Cloud Setup Not Confirmed");
    await expect(page.getByRole("checkbox", { name: "Remember on This Device", exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Enable Cloud Storage", exact: true }).click();
    await expect(page.locator(".cloud-summary-row")).toContainText("Review Cloud Reminders");
    assert.deepEqual(requests, ["POST", "GET"], "Resuming a committed setup must read a preview without another creation or write");
    assert.equal(await saved(), beforeResume);
    assert.equal(await credential(), null);
    await page.getByRole("checkbox", { name: "Remember on This Device", exact: true }).uncheck();
    assert.equal(await pendingCredential(), null, "Removing explicit Remember must remove a pending capability too");
    await page.getByRole("button", { name: "Use Cloud Version", exact: true }).click();
    await expect(page.locator(".cloud-summary-row")).toContainText("Saved to Cloud");
    await page.getByRole("button", { name: "Disconnect This Device", exact: true }).click();
    requests.length = 0;
    await closeCloud(); await openCloud();
    await page.getByRole("button", { name: "Enable Cloud Storage", exact: true }).click();
    await expect(page.locator(".cloud-summary-row")).toContainText("Saved to Cloud");
    assert.deepEqual(requests, ["POST"]);
    assert.equal(await credential(), null);
    const hiddenValue = await page.getByRole("textbox", { name: "Your recovery code", exact: true }).inputValue();
    assert.ok(!hiddenValue.startsWith("arv1."), "Recovery code must stay out of masked DOM");
    assert.equal(await page.evaluate(() => window.__syntheticClipboardWrites), 0);
    await page.getByRole("button", { name: "Copy Code", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__syntheticClipboardWrites), 1);
    await closeCloud();

    await page.getByRole("button", { name: "Synthetic Local Work", exact: true }).click();
    await page.getByRole("textbox", { name: "New reminder title", exact: true }).fill("Synthetic unfinished composer draft");
    offlineWrites = true;
    await page.getByRole("checkbox", { name: "Complete Prepare project update", exact: true }).click();
    await expect(page.locator('[data-ui="cloud-storage-status"]')).toContainText("Not Saved to Cloud");
    assert.ok(JSON.parse(await saved()).reminders.find(row => row.title === "Prepare project update").completed, "Offline cloud failure must retain local edits");
    await openCloud(); await closeCloud();
    await expect(page.getByRole("textbox", { name: "New reminder title", exact: true })).toHaveValue("Synthetic unfinished composer draft");
    offlineWrites = false;
    await openCloud();
    await page.getByRole("button", { name: "Disconnect This Device", exact: true }).click();

    const beforePreview = await saved(), writesBeforePreview = requests.filter(method => method !== "GET").length;
    await page.getByLabel("Connect an Existing Backup", { exact: true }).fill(existingCode);
    await page.getByRole("button", { name: "Preview Cloud Reminders", exact: true }).click();
    await expect(page.getByRole("region", { name: "Cloud reminders preview", exact: true })).toContainText("Synthetic Cloud Work");
    assert.equal(await saved(), beforePreview);
    await page.getByRole("checkbox", { name: "Remember on This Device", exact: true }).check();
    await page.getByRole("button", { name: "Check Cloud for Changes", exact: true }).click();
    await expect(page.locator(".cloud-summary-row")).toContainText("Review Cloud Reminders");
    assert.equal(await credential(), null, "Remember must not persist an unconfirmed preview");
    await page.reload(); await openCloud();
    await expect(page.locator(".cloud-summary-row")).toContainText("Off");
    assert.equal(await saved(), beforePreview);
    assert.equal(requests.filter(method => method !== "GET").length, writesBeforePreview, "Preview/remember/check/reload must not write cloud data");

    await page.getByLabel("Connect an Existing Backup", { exact: true }).fill(existingCode);
    await page.getByRole("button", { name: "Preview Cloud Reminders", exact: true }).click();
    await page.getByRole("button", { name: "Use Cloud Version", exact: true }).click();
    await expect.poll(async () => JSON.parse(await saved()).lists[0].name).toBe("Synthetic Cloud Work");
    assert.deepEqual(JSON.parse(await saved()).lists[0].sections, remote.lists[0].sections);
    assert.equal(await credential(), null);
    await page.getByRole("button", { name: "Disconnect This Device", exact: true }).click();
    await page.evaluate(data => localStorage.setItem("reminders-web-v1", JSON.stringify(data)), local);
    await page.reload(); await openCloud();
    await page.getByLabel("Connect an Existing Backup", { exact: true }).fill(existingCode);
    await page.getByRole("button", { name: "Preview Cloud Reminders", exact: true }).click();
    await page.getByRole("button", { name: "Keep This Device Version", exact: true }).click();
    await expect(page.locator(".cloud-summary-row")).toContainText("Saved to Cloud");
    const entry = vaults.get(keys.id), decoded = await decryptVaultSnapshot(keys, entry.envelope, entry.revision);
    assert.equal(decoded.data.lists[0].name, "Synthetic Local Work");
    assert.equal(JSON.parse(await saved()).lists[0].name, "Synthetic Local Work");
    assert.ok(!page.url().includes(existingCode), "Recovery code must never enter a URL");

    const otherDeviceRevision = entry.revision + 1;
    vaults.set(keys.id, { revision: otherDeviceRevision, envelope: await encryptVaultSnapshot(keys, { version: 1, data: remote }, otherDeviceRevision) });
    await closeCloud();
    await page.getByRole("checkbox", { name: "Complete Prepare project update", exact: true }).click();
    await expect(page.locator('[data-ui="cloud-storage-status"]')).toContainText("Conflict — Local Changes Kept");
    const beforeConflictPreview = await saved(), writesAtConflict = requests.filter(method => method !== "GET").length;
    assert.equal(vaults.get(keys.id).revision, otherDeviceRevision, "A stale device must not overwrite another device's save");
    await openCloud();
    await page.getByRole("button", { name: "Check Cloud for Changes", exact: true }).click();
    await expect(page.getByRole("region", { name: "Cloud reminders preview", exact: true })).toContainText("Synthetic Cloud Work");
    assert.equal(await saved(), beforeConflictPreview, "Conflict preview must preserve local edits");
    assert.equal(requests.filter(method => method !== "GET").length, writesAtConflict, "Conflict preview must not upload before a version choice");
    await page.getByRole("button", { name: "Keep This Device Version", exact: true }).click();
    await expect(page.locator(".cloud-summary-row")).toContainText("Saved to Cloud");
    assert.equal(vaults.get(keys.id).revision, otherDeviceRevision + 1);
    await closeCloud();

    for (const viewport of [{ width: 402, height: 874 }, { width: 402, height: 662 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('[data-ui="home-toolbar"], [data-ui="toolbar"] [aria-label="Lists"]')).toBeVisible();
      const listsButton = page.getByRole("button", { name: "Lists", exact: true });
      if (await listsButton.isVisible()) await listsButton.click();
      await expect(page.locator('[data-ui="home-toolbar"]')).toBeVisible();
      await openCloud();
      const sheet = page.locator(".cloud-storage-sheet"), body = sheet.locator(".accounts-body");
      await expect.poll(async () => {
        const box = await sheet.boundingBox();
        return box && box.x >= 0 && box.width <= viewport.width && box.y + box.height <= viewport.height + 1;
      }, { message: "iPhone sheet must fit its viewport" }).toBeTruthy();
      const material = await sheet.evaluate(element => {
        const style = getComputedStyle(element), button = getComputedStyle(element.querySelector(".accounts-chrome"));
        const body = element.querySelector(".accounts-body");
        return { fill: style.backgroundColor, blur: style.backdropFilter, shadow: style.boxShadow, radius: style.borderTopLeftRadius, buttonBlur: button.backdropFilter, buttonRadius: button.borderRadius, overflow: getComputedStyle(body).overflowY, scrollable: body.scrollHeight > body.clientHeight, documentOverflow: document.documentElement.scrollWidth > innerWidth };
      });
      const fill = material.fill.match(/[\d.]+/g)?.map(Number);
      assert.ok(fill && fill.length === 4 && fill.slice(0, 3).every(value => value < 70) && fill[3] < 1, "Dark glass must use a translucent dark fill");
      assert.match(material.blur, /blur\(/);
      assert.match(material.buttonBlur, /blur\(/);
      assert.ok(parseFloat(material.radius) >= 34 && material.buttonRadius === "50%", "Native-style sheet and circular chrome must keep rounded shapes");
      assert.notEqual(material.shadow, "none");
      assert.equal(material.overflow, "auto");
      if (viewport.height < 874) assert.equal(material.scrollable, true, "Short screens must allow scrolling through the full sheet");
      assert.equal(material.documentOverflow, false, "The phone layout must not scroll horizontally");
      const first = sheet.getByRole("button", { name: "Cancel", exact: true });
      const last = sheet.getByRole("button", { name: "Disconnect This Device", exact: true });
      await first.focus(); await page.keyboard.press("Shift+Tab"); await expect(last).toBeFocused();
      await page.keyboard.press("Tab"); await expect(first).toBeFocused();
      await last.scrollIntoViewIfNeeded();
      if (material.scrollable) assert.ok(await body.evaluate(element => element.scrollTop) > 0, "The lower sheet controls must be reachable by scrolling");
      const header = await sheet.locator(".accounts-header").boundingBox();
      assert.ok(header.y >= 0 && header.y + header.height <= viewport.height, "Sheet chrome must remain visible while the body scrolls");
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(page.locator('[data-ui="sidebar"] [aria-label="More"]')).toBeFocused();
    }
    assert.deepEqual(blocked, [], "No real provider or private API may be contacted");
  } finally { await context.close(); await browser.close(); }
});
