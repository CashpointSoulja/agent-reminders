import { validateStoredData } from "./model.js";
import { validateAccountProvenance } from "./account-import.js";
import { MAX_VAULT_PLAINTEXT, MAX_VAULT_ENVELOPE, validVaultEnvelope } from "./cloud-vault-envelope.js";
export { MAX_VAULT_PLAINTEXT, MAX_VAULT_ENVELOPE, validVaultEnvelope } from "./cloud-vault-envelope.js";

export const VAULT_LOCAL_KEY = "reminders-cloud-vault-v1";
export const VAULT_ENROLLMENT_LOCAL_KEY = "reminders-cloud-enrollment-v1";
const encoder = new TextEncoder();
const fail = (code, message) => Object.assign(new Error(message), { code });
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
const base64 = bytes => {
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
function unbase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw fail("invalid_key", "The recovery code is invalid.");
  try {
    const text = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(text, character => character.charCodeAt(0));
    if (base64(bytes) !== value) throw new Error();
    return bytes;
  } catch { throw fail("invalid_key", "The recovery code is invalid."); }
}

export function validateVaultSnapshot(value) {
  if (!plain(value) || value.version !== 1 || Object.keys(value).some(key => !["version", "data", "accountMetadata"].includes(key)) || !validateStoredData(value.data) || value.data.lists.length > 1000 || value.data.reminders.length > 10000) return false;
  if (value.accountMetadata !== undefined) {
    const metadata = value.accountMetadata;
    if (!plain(metadata) || metadata.version !== 1 || Object.keys(metadata).some(key => !["version", "provenance", "selections", "importInfo"].includes(key)) || !validateAccountProvenance(metadata.provenance) || !plain(metadata.selections)) return false;
    for (const [provider, ids] of Object.entries(metadata.selections)) if (!["icloud", "google-calendar", "google-tasks"].includes(provider) || !Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !id || id.length > 2000)) return false;
    if (metadata.importInfo !== undefined && (!plain(metadata.importInfo) || Object.entries(metadata.importInfo).some(([provider, info]) => !["icloud", "google-calendar", "google-tasks"].includes(provider) || !plain(info) || Object.keys(info).some(key => !["importedAt", "lists", "sample"].includes(key)) || typeof info.importedAt !== "string" || !Number.isFinite(Date.parse(info.importedAt)) || !Number.isInteger(info.lists) || info.lists < 0 || info.lists > 100 || typeof info.sample !== "boolean"))) return false;
  }
  try { return encoder.encode(JSON.stringify(value)).length <= MAX_VAULT_PLAINTEXT; } catch { return false; }
}

export function createVaultRecoveryCode() {
  return `arv1.${base64(crypto.getRandomValues(new Uint8Array(16)))}.${base64(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export async function parseVaultRecoveryCode(code) {
  if (typeof code !== "string") throw fail("invalid_key", "The recovery code is invalid.");
  const [version, id, secret, extra] = code.trim().split(".");
  if (version !== "arv1" || extra !== undefined || unbase64(id).length !== 16 || unbase64(secret).length !== 32) throw fail("invalid_key", "The recovery code is invalid.");
  const master = await crypto.subtle.importKey("raw", unbase64(secret), "HKDF", false, ["deriveBits", "deriveKey"]);
  const parameters = info => ({ name: "HKDF", hash: "SHA-256", salt: encoder.encode(`agent-reminders:${id}`), info: encoder.encode(info) });
  const token = base64(await crypto.subtle.deriveBits(parameters("vault-auth-v1"), master, 256));
  const encryptionKey = await crypto.subtle.deriveKey(parameters("vault-encryption-v1"), master, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { id, token, encryptionKey };
}

export async function encryptVaultSnapshot(credentials, snapshot, revision) {
  if (!validateVaultSnapshot(snapshot) || !Number.isSafeInteger(revision) || revision < 0) throw fail("invalid_snapshot", "Your reminders are invalid or exceed the private cloud limit. They remain on this device.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(`agent-reminders:v1:${credentials.id}:${revision}`) }, credentials.encryptionKey, encoder.encode(JSON.stringify(snapshot)));
  return { version: 1, iv: base64(iv), ciphertext: base64(ciphertext) };
}

export async function decryptVaultSnapshot(credentials, envelope, revision) {
  if (!validVaultEnvelope(envelope) || !Number.isSafeInteger(revision) || revision < 0) throw fail("invalid_snapshot", "The cloud backup is invalid. Your local reminders are unchanged.");
  try {
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(envelope.iv), additionalData: encoder.encode(`agent-reminders:v1:${credentials.id}:${revision}`) }, credentials.encryptionKey, unbase64(envelope.ciphertext));
    if (bytes.byteLength > MAX_VAULT_PLAINTEXT) throw new Error();
    const snapshot = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!validateVaultSnapshot(snapshot)) throw new Error();
    return snapshot;
  } catch { throw fail("decrypt_failed", "This backup could not be opened with that recovery code. Your local reminders are unchanged."); }
}

export function createCloudVaultClient({ endpoint, recoveryCode, fetchImpl = globalThis.fetch }) {
  let url;
  try { url = new URL(endpoint, globalThis.location?.origin); } catch { throw fail("not_configured", "Private cloud storage is not configured."); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) || url.username || url.password || url.search || url.hash || !["", "/", "/cloud"].includes(url.pathname)) throw fail("not_configured", "Private cloud storage requires a secure server address.");
  const prefix = url.pathname === "/cloud" ? "/cloud" : "";
  const credentials = parseVaultRecoveryCode(recoveryCode);
  let creation = null;
  async function request(method, { snapshot, revision, historicalRevision } = {}) {
    const keys = await credentials;
    const headers = { authorization: `Bearer ${keys.token}` };
    if (method === "DELETE") headers["if-match"] = String(revision);
    let body;
    if (snapshot) {
      headers["content-type"] = "application/json";
      if (method === "PUT") headers["if-match"] = String(revision);
      if (method === "POST") {
        const serialized = JSON.stringify(snapshot);
        if (creation && creation.snapshot !== serialized) throw fail("invalid_snapshot", "Cloud setup already started with another preview. Keep your recovery code and review that cloud version before creating another backup.");
        if (!creation) creation = { snapshot: serialized, body: JSON.stringify(await encryptVaultSnapshot(keys, snapshot, 0)) };
        body = creation.body;
      } else body = JSON.stringify(await encryptVaultSnapshot(keys, snapshot, revision + 1));
    }
    let response;
    try { response = await fetchImpl(`${url.origin}${prefix}/v1/vaults/${keys.id}${historicalRevision === undefined ? "" : `/history/${historicalRevision}`}`, { method, headers, body, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" }); }
    catch { throw fail("offline", "Cloud storage could not be reached. Your reminders remain on this device."); }
    if (!response.ok) {
      const code = response.status === 409 ? "conflict" : response.status === 401 ? "unauthorized" : response.status === 429 ? "rate_limited" : response.status === 413 ? "too_large" : "cloud_error";
      const messages = { conflict: "Another device saved changes. Review the cloud version before saving again; your local reminders are unchanged.", unauthorized: "The recovery code does not have access to this cloud backup.", rate_limited: "The private cloud limit has been reached. Your reminders remain on this device.", too_large: "Your reminders exceed the private cloud limit. They remain on this device.", cloud_error: "Cloud storage is unavailable. Your reminders remain on this device." };
      throw fail(code, messages[code]);
    }
    let result;
    try { const text = await response.text(); if (text.length > MAX_VAULT_ENVELOPE + 1000) throw new Error(); result = JSON.parse(text); } catch { throw fail("cloud_error", "Cloud storage returned an invalid response. Your reminders remain on this device."); }
    if (!Number.isSafeInteger(result.revision) || result.revision < 0) throw fail("cloud_error", "Cloud storage returned an invalid revision.");
    if (method === "GET") return { revision: result.revision, snapshot: await decryptVaultSnapshot(keys, result.envelope, result.revision), history: result.history || [], updatedAt: result.updatedAt };
    return { revision: result.revision, updatedAt: result.updatedAt };
  }
  return { create: snapshot => request("POST", { snapshot }), read: () => request("GET"), save: (snapshot, revision) => request("PUT", { snapshot, revision }), readHistory: revision => request("GET", { historicalRevision: revision }), remove: revision => request("DELETE", { revision }) };
}
