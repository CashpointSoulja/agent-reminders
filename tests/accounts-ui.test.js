import test from "node:test";
import assert from "node:assert/strict";
import { parseAccountMetadata, validPublicGoogleClientId } from "../src/useAccounts.js";

test("account setup accepts a public web client ID and rejects secrets, URLs and injected markup", () => {
  assert.equal(validPublicGoogleClientId("123456789012-abcdefghijklmnop.apps.googleusercontent.com"), true);
  for (const value of ["GOCSPX-private-test-value", "https://accounts.google.com", "<script>alert(1)</script>", "123.apps.googleusercontent.com", null]) assert.equal(validPublicGoogleClientId(value), false);
});

test("local account metadata validates source selection and never accepts credential fields", () => {
  const metadata = { version: 1, provenance: { version: 1, lists: [], reminders: [] }, selections: { "google-tasks": ["synthetic-list"] }, importInfo: { "google-tasks": { importedAt: "2026-10-12T10:00:00.000Z", lists: 1, sample: false } } };
  assert.deepEqual(parseAccountMetadata(JSON.stringify(metadata)), metadata);
  for (const unsafe of [
    { ...metadata, access_token: "synthetic-token" },
    { ...metadata, selections: { "google-tasks": ["duplicate", "duplicate"] } },
    { ...metadata, selections: { unknown: ["list"] } },
    { ...metadata, provenance: { ...metadata.provenance, credentials: "synthetic-token" } },
    { ...metadata, importInfo: { "google-tasks": { ...metadata.importInfo["google-tasks"], secret: "synthetic-token" } } },
  ]) assert.deepEqual(parseAccountMetadata(JSON.stringify(unsafe)), { provenance: { version: 1, lists: [], reminders: [] }, selections: {} });
  assert.deepEqual(parseAccountMetadata("invalid JSON"), { provenance: { version: 1, lists: [], reminders: [] }, selections: {} });
});
