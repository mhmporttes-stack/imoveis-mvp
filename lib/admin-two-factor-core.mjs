// Verificação em duas etapas (TOTP) da conta do dono — parte PURA (sem banco, sem Next), testada em
// tests/admin-two-factor.test.mjs. A parte com banco/cookies fica em lib/admin-two-factor.js.
// Regra do dono (2026-10-08): só a conta do dono (isOwnerAdminEmail) usa; opt-in; código de 6 dígitos de app
// autenticador; "lembrar este aparelho" por 30 dias; 8 códigos de recuperação de uso único.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW_STEPS = 1; // aceita o passo anterior e o seguinte (relógio do celular adiantado/atrasado)
export const RECOVERY_CODE_COUNT = 8;
export const MAX_FAILED_ATTEMPTS = 5;
export const FAILED_WINDOW_MS = 10 * 60 * 1000;
export const LOCK_DURATION_MS = 10 * 60 * 1000;
export const DEVICE_REMEMBER_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_PROOF_SECONDS = 7 * 24 * 60 * 60; // mesmo prazo do cookie de refresh do painel
export const PENDING_ENROLLMENT_MS = 30 * 60 * 1000;
export const TWO_FACTOR_REQUIRED_CODE = "TWO_FACTOR_REQUIRED";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
// Sem 0/O/1/I/L para não confundir quem digita o código de recuperação.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text) {
  const clean = String(text || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Chave base32 inválida.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function hotp(secretBuffer, counter, digits = TOTP_DIGITS, algorithm = "sha1") {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secretBuffer).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpStep(nowMs, period = TOTP_PERIOD_SECONDS) {
  return Math.floor(nowMs / 1000 / period);
}

export function normalizeTotpCode(code) {
  return String(code || "").replace(/\s/g, "");
}

// Confere o código dentro da janela ±1 passo. Recusa passo já usado (lastUsedStep) — o mesmo código não entra duas vezes.
// Retorna { ok, step } ou { ok:false, reason: "invalid" | "reused" }.
export function verifyTotpCode({ secretBase32, code, nowMs, lastUsedStep = null, window = TOTP_WINDOW_STEPS }) {
  const normalized = normalizeTotpCode(code);
  if (!/^\d{6}$/.test(normalized) || !secretBase32) return { ok: false, reason: "invalid" };
  const secret = base32Decode(secretBase32);
  const current = totpStep(nowMs);
  let reused = false;
  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    if (!safeEqual(hotp(secret, step), normalized)) continue;
    if (lastUsedStep !== null && lastUsedStep !== undefined && step <= Number(lastUsedStep)) {
      reused = true;
      continue;
    }
    return { ok: true, step };
  }
  return { ok: false, reason: reused ? "reused" : "invalid" };
}

export function buildOtpauthUri({ secretBase32, accountName, issuer = "Matheus Machado Imóveis" }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function formatManualKey(secretBase32) {
  return String(secretBase32 || "").match(/.{1,4}/g)?.join(" ") || "";
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = [];
  while (codes.length < count) {
    const bytes = randomBytes(12);
    let raw = "";
    for (const byte of bytes) raw += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

export function normalizeRecoveryCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Só o hash é guardado (o código aparece uma única vez, na ativação). O id do usuário entra como sal.
export function hashRecoveryCode(userId, code) {
  return createHash("sha256").update(`${userId}:${normalizeRecoveryCode(code)}`).digest("hex");
}

// ---------- Cookies assinados (prova de 2º fator da sessão e "lembrar este aparelho") ----------

export function signToken(payload, key) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readSignedToken(token, key) {
  if (!token || !key) return null;
  const [body, signature, extra] = String(token).split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", key).update(body).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function buildSessionProof({ userId, sessionId, epoch, nowMs }, key) {
  return signToken({ t: "s", u: userId, s: sessionId, e: epoch, x: Math.floor(nowMs / 1000) + SESSION_PROOF_SECONDS }, key);
}

export function buildDeviceProof({ userId, deviceId, epoch, nowMs }, key) {
  return signToken({ t: "d", u: userId, d: deviceId, e: epoch, x: Math.floor(nowMs / 1000) + DEVICE_REMEMBER_SECONDS }, key);
}

// Prova da sessão: mesmo usuário, mesma sessão de login do Supabase (claim session_id, que não muda no refresh),
// mesma "época" (desativar o 2FA ou gerar novos códigos troca a época) e dentro do prazo.
export function isValidSessionProof(token, { userId, sessionId, epoch, nowMs }, key) {
  const payload = readSignedToken(token, key);
  return Boolean(
    payload && payload.t === "s" && userId && sessionId &&
      payload.u === userId && payload.s === sessionId && payload.e === epoch && Number(payload.x) * 1000 > nowMs
  );
}

export function isValidDeviceProof(token, { userId, epoch, nowMs }, key) {
  const payload = readSignedToken(token, key);
  return Boolean(
    payload && payload.t === "d" && userId && payload.d &&
      payload.u === userId && payload.e === epoch && Number(payload.x) * 1000 > nowMs
  );
}

// Decide se a conta precisa do 2º fator nesta requisição. Só o dono, só com o 2FA ativado.
export function isSecondFactorMissing({ isOwner, enabled, sessionProofValid, deviceProofValid }) {
  if (!isOwner || !enabled) return false;
  return !(sessionProofValid || deviceProofValid);
}

// Lê o claim session_id de um access token JÁ VALIDADO pelo Supabase (não é verificação de assinatura).
export function readSessionIdFromAccessToken(accessToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(accessToken || "").split(".")[1] || "", "base64url").toString("utf8"));
    return String(payload?.session_id || "");
  } catch {
    return "";
  }
}

// ---------- Limite de tentativas: 5 erradas em 10 min bloqueiam por 10 min ----------

export function isLocked(state, nowMs) {
  return Boolean(state?.locked_until && new Date(state.locked_until).getTime() > nowMs);
}

export function nextFailureState(state, nowMs) {
  const windowStart = state?.failed_window_started_at ? new Date(state.failed_window_started_at).getTime() : 0;
  const inWindow = windowStart && nowMs - windowStart < FAILED_WINDOW_MS;
  const attempts = (inWindow ? Number(state?.failed_attempts || 0) : 0) + 1;
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    return { failed_attempts: 0, failed_window_started_at: null, locked_until: new Date(nowMs + LOCK_DURATION_MS).toISOString() };
  }
  return {
    failed_attempts: attempts,
    failed_window_started_at: inWindow ? state.failed_window_started_at : new Date(nowMs).toISOString(),
    locked_until: null
  };
}

export function clearedFailureState() {
  return { failed_attempts: 0, failed_window_started_at: null, locked_until: null };
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
