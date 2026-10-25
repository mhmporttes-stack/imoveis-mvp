import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(corpo bruto, App Secret).
export function verifyHubSignature(rawBody, header, appSecret) {
  if (!appSecret || !header || !Buffer.isBuffer(rawBody)) return false;
  const value = String(header);
  if (!value.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(value.slice(7), expected);
}

export function hubSignature(rawBody, appSecret) {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}
