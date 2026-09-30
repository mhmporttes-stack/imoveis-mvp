import "server-only";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

// AES-256-GCM para cifrar segredos guardados pelo Next.js (hoje: tokens da
// integração Google Contacts) — MESMO esquema já usado pelo microsserviço de
// WhatsApp individual para as credenciais do Baileys
// (whatsapp-individual-service/src/crypto.js: IV(12) + authTag(16) + cifrado,
// tudo em base64), só que com uma chave própria do Next.js
// (CRM_SECRETS_ENCRYPTION_KEY) — o Railway nunca teve acesso ao
// SUPABASE_SERVICE_ROLE_KEY nem precisa ter acesso a este segredo, e
// vice-versa. "Não inventar duas arquiteturas diferentes" (pedido do dono):
// mesmo algoritmo, mesmo layout, só chave separada por domínio de segredo.

export function hasSecretsEncryptionKey() {
  const raw = process.env.CRM_SECRETS_ENCRYPTION_KEY || "";
  return Buffer.from(raw, "hex").length === 32;
}

function getKey() {
  const raw = process.env.CRM_SECRETS_ENCRYPTION_KEY || "";
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error("CRM_SECRETS_ENCRYPTION_KEY precisa ser uma chave em HEX de 32 bytes (64 caracteres). Gere com: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  }
  return key;
}

export function encryptSecret(plaintext) {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSecret(payload) {
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
