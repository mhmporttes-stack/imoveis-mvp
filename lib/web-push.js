import "server-only";
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign as signBuffer } from "crypto";

// Implementação própria do protocolo Web Push (RFC 8291 aes128gcm + RFC 8292
// VAPID) usando apenas o módulo crypto nativo do Node — não há gerenciador de
// pacotes (npm/pnpm) disponível neste ambiente para instalar a lib "web-push",
// então evitamos essa dependência inteiramente.

const DEFAULT_TTL_SECONDS = 60 * 60 * 12;
const MAX_PAYLOAD_LENGTH = 4078;

export class WebPushError extends Error {
  constructor(message, statusCode, body) {
    super(message);
    this.name = "WebPushError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function padTo32(buffer) {
  if (buffer.length === 32) return buffer;
  if (buffer.length > 32) return buffer.subarray(buffer.length - 32);
  return Buffer.concat([Buffer.alloc(32 - buffer.length), buffer]);
}

// Usado apenas uma vez (fora da aplicação) para gerar o par de chaves VAPID
// que é então salvo como variáveis de ambiente (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY).
export function generateVapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: base64UrlEncode(ecdh.getPublicKey()),
    privateKey: base64UrlEncode(padTo32(ecdh.getPrivateKey()))
  };
}

function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:mhmporttes@gmail.com";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export function hasWebPushConfig() {
  return Boolean(getVapidConfig());
}

function vapidPrivateKeyObject(publicKeyB64, privateKeyB64) {
  const publicBytes = base64UrlDecode(publicKeyB64);
  const privateBytes = padTo32(base64UrlDecode(privateKeyB64));
  const x = publicBytes.subarray(1, 33);
  const y = publicBytes.subarray(33, 65);
  return createPrivateKey({
    key: { kty: "EC", crv: "P-256", x: base64UrlEncode(x), y: base64UrlEncode(y), d: base64UrlEncode(privateBytes) },
    format: "jwk"
  });
}

function signVapidJwt(audience, subject, publicKey, privateKey) {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject };
  const unsigned = `${base64UrlEncode(Buffer.from(JSON.stringify(header)))}.${base64UrlEncode(Buffer.from(JSON.stringify(payload)))}`;
  const keyObject = vapidPrivateKeyObject(publicKey, privateKey);
  const signature = signBuffer("sha256", Buffer.from(unsigned), { key: keyObject, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

function hmacSha256(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

// HKDF-Expand de um único bloco (suficiente pois só precisamos de saídas <= 32 bytes).
function hkdfExpandOneBlock(prk, info, length) {
  return hmacSha256(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

// Criptografia da mensagem conforme RFC 8291 (aes128gcm), o único
// content-encoding suportado pelos navegadores atuais para Web Push.
function encryptPayload(subscriptionKeys, plaintextBuffer) {
  const uaPublicKey = base64UrlDecode(subscriptionKeys.p256dh);
  const authSecret = base64UrlDecode(subscriptionKeys.auth);

  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublicKey = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublicKey);

  const salt = randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublicKey, asPublicKey]);
  const prkKey = hmacSha256(authSecret, sharedSecret);
  const ikm = hkdfExpandOneBlock(prkKey, keyInfo, 32);

  const prk = hmacSha256(salt, ikm);
  const cek = hkdfExpandOneBlock(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfExpandOneBlock(prk, Buffer.from("Content-Encoding: nonce\0"), 12);

  const paddedPlaintext = Buffer.concat([plaintextBuffer, Buffer.from([2])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(paddedPlaintext), cipher.final(), cipher.getAuthTag()]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);
  const header = Buffer.concat([salt, recordSize, Buffer.from([asPublicKey.length]), asPublicKey]);

  return Buffer.concat([header, ciphertext]);
}

export async function sendWebPush(subscription, payload, options = {}) {
  const config = getVapidConfig();
  if (!config) throw new WebPushError("VAPID não configurado (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes).", 0);
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new WebPushError("Assinatura de push inválida.", 0);
  }

  const endpointUrl = new URL(subscription.endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const jwt = signVapidJwt(audience, config.subject, config.publicKey, config.privateKey);

  const headers = {
    Authorization: `vapid t=${jwt}, k=${config.publicKey}`,
    TTL: String(options.ttl ?? DEFAULT_TTL_SECONDS)
  };
  if (options.urgency) headers.Urgency = options.urgency;
  if (options.topic) headers.Topic = options.topic;

  let body;
  if (payload !== undefined && payload !== null) {
    const plaintext = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
    if (plaintext.length > MAX_PAYLOAD_LENGTH) throw new WebPushError("Payload de push excede o tamanho máximo suportado.", 0);
    body = encryptPayload(subscription.keys, plaintext);
    headers["Content-Encoding"] = "aes128gcm";
    headers["Content-Type"] = "application/octet-stream";
  }

  const response = await fetch(subscription.endpoint, { method: "POST", headers, body });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new WebPushError(`Falha ao enviar push (${response.status}).`, response.status, detail);
  }

  return { ok: true, status: response.status };
}
