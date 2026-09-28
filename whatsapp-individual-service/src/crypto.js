// AES-256-GCM — usado só para cifrar/decifrar as credenciais do Baileys
// (session_creds_encrypted) antes de gravar no Supabase. Nunca guardamos a
// credencial em texto puro; sem SESSION_ENCRYPTION_KEY o serviço não sobe.
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

function getKey() {
  const raw = process.env.SESSION_ENCRYPTION_KEY || "";
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error("SESSION_ENCRYPTION_KEY precisa ser uma chave em HEX de 32 bytes (64 caracteres). Gere com: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  }
  return key;
}

export function encrypt(plaintext) {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decrypt(payload) {
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
