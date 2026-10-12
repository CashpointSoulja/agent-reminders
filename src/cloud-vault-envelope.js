export const MAX_VAULT_PLAINTEXT = 1250000;
export const MAX_VAULT_ENVELOPE = 1700000;

export function validVaultEnvelope(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 3 && value.version === 1 && typeof value.iv === "string" && /^[A-Za-z0-9_-]{16}$/.test(value.iv) && typeof value.ciphertext === "string" && /^[A-Za-z0-9_-]{24,}$/.test(value.ciphertext) && value.ciphertext.length + 53 <= MAX_VAULT_ENVELOPE;
}
