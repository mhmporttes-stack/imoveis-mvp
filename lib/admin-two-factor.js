import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { getSupabaseAdminClient } from "./supabase";
import { decryptSecret, encryptSecret, hasSecretsEncryptionKey } from "./secrets-crypto";
import {
  DEVICE_REMEMBER_SECONDS,
  PENDING_ENROLLMENT_MS,
  SESSION_PROOF_SECONDS,
  buildDeviceProof,
  buildOtpauthUri,
  buildSessionProof,
  clearedFailureState,
  formatManualKey,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  isLocked,
  isValidDeviceProof,
  isValidSessionProof,
  nextFailureState,
  readSessionIdFromAccessToken,
  verifyTotpCode
} from "./admin-two-factor-core.mjs";

// Verificação em duas etapas da conta do dono (regra do dono, 2026-10-08). Parte pura em admin-two-factor-core.mjs.
// A exigência acontece no servidor, em lib/admin-auth.js (applyTwoFactorGuard): sem o 2º fator, nenhuma página/API do
// painel funciona para o dono. Nunca logar segredo nem código.

export const TWO_FACTOR_SESSION_COOKIE = "mm_admin_2fa";
export const TWO_FACTOR_DEVICE_COOKIE = "mm_admin_2fa_device";

const TABLE = "admin_two_factor";
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);
const LOCKED_MESSAGE = "Muitas tentativas erradas. Aguarde 10 minutos e tente de novo.";

// Chave dos cookies assinados: ADMIN_TWO_FACTOR_COOKIE_SECRET (opcional) ou, sem ela, derivada da service role
// (segredo que já existe no servidor). Trocar a chave só faz o sistema pedir o código de novo.
function getCookieKey() {
  const explicit = process.env.ADMIN_TWO_FACTOR_COOKIE_SECRET || "";
  if (explicit) return explicit;
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return base ? createHmac("sha256", base).update("mm-admin-two-factor-cookie-v1").digest("hex") : "";
}

function db() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo nao configurado.");
  return supabase;
}

function isMissingTable(error) {
  return Boolean(error && MISSING_TABLE_CODES.has(error.code));
}

async function loadRow(userId) {
  const { data, error } = await db().from(TABLE).select("*").eq("auth_user_id", userId).maybeSingle();
  if (error) return { error, missingTable: isMissingTable(error) };
  return { row: data || null };
}

async function updateRow(userId, patch) {
  const { error } = await db().from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq("auth_user_id", userId);
  if (error) throw new Error(`Nao foi possivel atualizar a verificacao em duas etapas: ${error.message}`);
}

function epochOf(row) {
  return Number(row?.device_epoch || 1);
}

// Usado pelo guard de lib/admin-auth.js a cada requisição do DONO (só dele). Não ativado => nada muda.
// Retorna { enabled, sessionProofValid, deviceProofValid } (a decisão fica em isSecondFactorMissing) ou { error }.
export async function checkOwnerSecondFactor({ userId, accessToken, sessionProof, deviceProof }) {
  const loaded = await loadRow(userId);
  // Tabela ainda não criada (migration pendente) => ninguém conseguiu ativar => nada a exigir.
  if (loaded.missingTable) return { enabled: false };
  if (loaded.error) return { error: "Nao foi possivel conferir a verificacao em duas etapas. Tente novamente." };
  const row = loaded.row;
  if (!row?.enabled) return { enabled: false };

  const key = getCookieKey();
  const nowMs = Date.now();
  const epoch = epochOf(row);
  const sessionId = readSessionIdFromAccessToken(accessToken);
  return {
    enabled: true,
    sessionProofValid: isValidSessionProof(sessionProof, { userId, sessionId, epoch, nowMs }, key),
    deviceProofValid: isValidDeviceProof(deviceProof, { userId, epoch, nowMs }, key)
  };
}

export async function getTwoFactorStatus(userId) {
  const loaded = await loadRow(userId);
  if (loaded.missingTable) return { available: false, enabled: false, reason: "A tabela da verificação em duas etapas ainda não foi criada no banco." };
  if (loaded.error) throw new Error(loaded.error.message);
  const row = loaded.row;
  return {
    available: hasSecretsEncryptionKey(),
    reason: hasSecretsEncryptionKey() ? "" : "A chave de cifragem do servidor (CRM_SECRETS_ENCRYPTION_KEY) não está configurada.",
    enabled: Boolean(row?.enabled),
    enabledAt: row?.enabled_at || null,
    recoveryCodesLeft: row?.enabled ? (row.recovery_code_hashes || []).length : 0
  };
}

export async function startTwoFactorEnrollment(user) {
  if (!hasSecretsEncryptionKey()) return fail(503, "A chave de cifragem do servidor (CRM_SECRETS_ENCRYPTION_KEY) não está configurada.");
  const loaded = await loadRow(user.id);
  if (loaded.missingTable) return fail(503, "A tabela da verificação em duas etapas ainda não foi criada no banco.");
  if (loaded.error) throw new Error(loaded.error.message);
  if (loaded.row?.enabled) return fail(409, "A verificação em duas etapas já está ativada.");

  const secret = generateTotpSecret();
  const nowIso = new Date().toISOString();
  const { error } = await db().from(TABLE).upsert(
    {
      auth_user_id: user.id,
      email: String(user.email || "").toLowerCase(),
      pending_secret_encrypted: encryptSecret(secret),
      pending_created_at: nowIso,
      updated_at: nowIso
    },
    { onConflict: "auth_user_id" }
  );
  if (error) throw new Error(`Nao foi possivel iniciar a ativacao: ${error.message}`);

  const otpauthUri = buildOtpauthUri({ secretBase32: secret, accountName: user.email });
  const qrSvg = await QRCode.toString(otpauthUri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { ok: true, otpauthUri, qrSvg, manualKey: formatManualKey(secret) };
}

export async function confirmTwoFactorEnrollment(user, code, accessToken) {
  const loaded = await loadRow(user.id);
  if (loaded.error) throw new Error(loaded.error.message);
  const row = loaded.row;
  if (!row || row.enabled) return fail(409, "Comece a ativação de novo.");
  const nowMs = Date.now();
  if (isLocked(row, nowMs)) return fail(429, LOCKED_MESSAGE);
  if (!row.pending_secret_encrypted || !row.pending_created_at || nowMs - new Date(row.pending_created_at).getTime() > PENDING_ENROLLMENT_MS) {
    return fail(409, "A ativação expirou. Clique em ativar de novo para gerar outro QR Code.");
  }

  const pendingSecret = decryptSecret(row.pending_secret_encrypted);
  const result = verifyTotpCode({ secretBase32: pendingSecret, code, nowMs, lastUsedStep: row.last_used_step });
  if (!result.ok) return registerFailure(row, nowMs, "Código incorreto. Confira o app autenticador e digite o código atual.");

  const recoveryCodes = generateRecoveryCodes();
  const epoch = epochOf(row) + 1;
  await updateRow(user.id, {
    enabled: true,
    enabled_at: new Date(nowMs).toISOString(),
    secret_encrypted: row.pending_secret_encrypted,
    pending_secret_encrypted: null,
    pending_created_at: null,
    last_used_step: result.step,
    recovery_code_hashes: recoveryCodes.map((item) => hashRecoveryCode(user.id, item)),
    device_epoch: epoch,
    ...clearedFailureState()
  });
  return { ok: true, recoveryCodes, cookies: buildCookies(user.id, epoch, accessToken, false, nowMs) };
}

// Login: código do app (mode "totp") ou código de recuperação (mode "recovery").
export async function verifySecondFactor(user, { code, mode, remember, accessToken }) {
  const loaded = await loadRow(user.id);
  if (loaded.error) throw new Error(loaded.error.message);
  const row = loaded.row;
  if (!row?.enabled) return fail(409, "A verificação em duas etapas não está ativada para esta conta.");
  const checked = await checkCode(user.id, row, code, mode);
  if (!checked.ok) return checked;
  return { ok: true, cookies: buildCookies(user.id, epochOf(row), accessToken, Boolean(remember), Date.now()) };
}

export async function disableTwoFactor(user, { code, mode }) {
  const loaded = await loadRow(user.id);
  if (loaded.error) throw new Error(loaded.error.message);
  const row = loaded.row;
  if (!row?.enabled) return fail(409, "A verificação em duas etapas já está desativada.");
  const checked = await checkCode(user.id, row, code, mode);
  if (!checked.ok) return checked;
  await updateRow(user.id, {
    enabled: false,
    enabled_at: null,
    secret_encrypted: null,
    pending_secret_encrypted: null,
    pending_created_at: null,
    recovery_code_hashes: [],
    device_epoch: epochOf(row) + 1,
    ...clearedFailureState()
  });
  return { ok: true };
}

// Novos códigos de recuperação: os antigos e TODOS os aparelhos lembrados deixam de valer; a sessão atual continua.
export async function regenerateRecoveryCodes(user, { code, mode, accessToken }) {
  const loaded = await loadRow(user.id);
  if (loaded.error) throw new Error(loaded.error.message);
  const row = loaded.row;
  if (!row?.enabled) return fail(409, "A verificação em duas etapas não está ativada.");
  const checked = await checkCode(user.id, row, code, mode);
  if (!checked.ok) return checked;
  const recoveryCodes = generateRecoveryCodes();
  const epoch = epochOf(row) + 1;
  await updateRow(user.id, {
    recovery_code_hashes: recoveryCodes.map((item) => hashRecoveryCode(user.id, item)),
    device_epoch: epoch
  });
  return { ok: true, recoveryCodes, cookies: buildCookies(user.id, epoch, accessToken, false, Date.now()) };
}

async function checkCode(userId, row, code, mode) {
  const nowMs = Date.now();
  if (isLocked(row, nowMs)) return fail(429, LOCKED_MESSAGE);

  if (mode === "recovery") {
    const { data, error } = await db().rpc("admin_two_factor_consume_recovery_code", {
      p_auth_user_id: userId,
      p_code_hash: hashRecoveryCode(userId, code)
    });
    if (error) throw new Error(`Nao foi possivel conferir o codigo de recuperacao: ${error.message}`);
    if (data !== true) return registerFailure(row, nowMs, "Código de recuperação inválido ou já usado.");
    await updateRow(userId, clearedFailureState());
    return { ok: true };
  }

  const secret = decryptSecret(row.secret_encrypted);
  const result = verifyTotpCode({ secretBase32: secret, code, nowMs, lastUsedStep: row.last_used_step });
  if (!result.ok) {
    return registerFailure(row, nowMs, result.reason === "reused" ? "Este código já foi usado. Aguarde o próximo código no app." : "Código incorreto. Confira o app autenticador e digite o código atual.");
  }
  // Grava o passo usado só se ainda for maior que o último (duas requisições com o mesmo código: só uma entra).
  const lastStepFilter = `last_used_step.is.null,last_used_step.lt.${result.step}`;
  const { data, error } = await db()
    .from(TABLE)
    .update({ last_used_step: result.step, ...clearedFailureState(), updated_at: new Date(nowMs).toISOString() })
    .eq("auth_user_id", userId)
    .or(lastStepFilter)
    .select("auth_user_id");
  if (error) throw new Error(`Nao foi possivel registrar o codigo: ${error.message}`);
  if (!data?.length) return registerFailure(row, nowMs, "Este código já foi usado. Aguarde o próximo código no app.");
  return { ok: true };
}

async function registerFailure(row, nowMs, message) {
  const next = nextFailureState(row, nowMs);
  await updateRow(row.auth_user_id, next);
  return fail(next.locked_until ? 429 : 400, next.locked_until ? LOCKED_MESSAGE : message);
}

function buildCookies(userId, epoch, accessToken, remember, nowMs) {
  const key = getCookieKey();
  const sessionId = readSessionIdFromAccessToken(accessToken);
  if (!key || !sessionId) throw new Error("Nao foi possivel registrar a verificacao desta sessao.");
  return {
    sessionProof: buildSessionProof({ userId, sessionId, epoch, nowMs }, key),
    deviceProof: remember ? buildDeviceProof({ userId, deviceId: randomBytes(16).toString("hex"), epoch, nowMs }, key) : ""
  };
}

function fail(status, error) {
  return { ok: false, status, error };
}

function cookieOptions(request, maxAge) {
  const secure = request?.nextUrl?.protocol === "https:" || process.env.VERCEL === "1";
  return { httpOnly: true, path: "/", sameSite: "lax", secure, maxAge };
}

export function setTwoFactorCookies(response, request, cookies) {
  if (cookies?.sessionProof) response.cookies.set(TWO_FACTOR_SESSION_COOKIE, cookies.sessionProof, cookieOptions(request, SESSION_PROOF_SECONDS));
  if (cookies?.deviceProof) response.cookies.set(TWO_FACTOR_DEVICE_COOKIE, cookies.deviceProof, cookieOptions(request, DEVICE_REMEMBER_SECONDS));
}

export function clearTwoFactorCookies(response, request, { includeDevice = false } = {}) {
  response.cookies.set(TWO_FACTOR_SESSION_COOKIE, "", cookieOptions(request, 0));
  if (includeDevice) response.cookies.set(TWO_FACTOR_DEVICE_COOKIE, "", cookieOptions(request, 0));
}
