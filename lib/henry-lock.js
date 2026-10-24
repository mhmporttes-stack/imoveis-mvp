import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { createAlertDeliveries } from "./crm-alerts";
import { NOTIFICATION_KIND } from "./notification-policy-core.mjs";
import {
  HENRY_LOCK_COOKIE,
  HENRY_LOCK_COOKIE_MAX_AGE_SECONDS,
  evaluateHenryLock,
  henryLockFailure,
  henryLockWaitMessage,
  henryLockWaitSeconds,
  isValidHenryPin,
  normalizeIdleMinutes
} from "./henry-lock-core.mjs";
import { hashHenryPin, hashHenryUnlockToken, newHenryUnlockToken, verifyHenryPin } from "./henry-lock-crypto.mjs";

// Tela de bloqueio do Henry (REGRA OFICIAL — dono, 2026-10-23; docs/BUSINESS_RULES.md HENRY-LOCK). Estado no SERVIDOR
// (tabela henry_lock, migration 20261023233000): hash da senha, erros/esperas, bloqueado/desbloqueado, tela cheia e o hash
// do token do desbloqueio (cookie HttpOnly deste aparelho). Regras puras em henry-lock-core.mjs. Nunca loga a senha.

const TABLE = "henry_lock";
const db = () => getSupabaseAdminClient();

export class HenryLockError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.name = "HenryLockError";
    this.status = status;
    Object.assign(this, extra);
  }
}

// Tabela ainda não criada (migration não aplicada): a tela de bloqueio fica desligada (sem senha = como antes) e
// definir a senha avisa. Qualquer outro erro do banco sobe.
function isMissingTable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205" || /henry_lock/.test(String(error?.message || "")) && /does not exist|schema cache/.test(String(error?.message || ""));
}

async function readRow(userId) {
  if (!userId) return null;
  const { data, error } = await db().from(TABLE).select("*").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) {
      console.warn("[henry-lock] tabela henry_lock ausente (migration não aplicada): bloqueio desligado.");
      return null;
    }
    throw error;
  }
  return data || null;
}

async function updateRow(userId, patch, match = {}) {
  let query = db().from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq("user_id", userId);
  for (const [column, value] of Object.entries(match)) query = value === null ? query.is(column, null) : query.eq(column, value);
  const { data, error } = await query.select("user_id");
  if (error) throw error;
  return (data || []).length;
}

export function henryLockTokenHash(request) {
  return hashHenryUnlockToken(request?.cookies?.get?.(HENRY_LOCK_COOKIE)?.value || "");
}

function publicState(row, evaluated, now = Date.now()) {
  return {
    configured: evaluated.configured,
    locked: evaluated.locked,
    fullscreen: Boolean(row?.fullscreen),
    idleMinutes: normalizeIdleMinutes(row?.idle_minutes),
    waitSeconds: henryLockWaitSeconds(row, now)
  };
}

// Estado do bloqueio para este pedido. touch = pedido de interação (pergunta/toque na tela): desbloqueado na tela cheia
// → renova a inatividade. Inatividade estourada → grava locked_at (fica bloqueado até a senha).
export async function resolveHenryLock(auth, { tokenHash = "", clientLocked = false, touch = false } = {}) {
  const userId = auth?.profile?.id || "";
  const row = await readRow(userId);
  const now = Date.now();
  const evaluated = evaluateHenryLock(row, { tokenHash, now, clientLocked });
  if (evaluated.expire) {
    await updateRow(userId, { locked_at: new Date(now).toISOString(), unlock_token_hash: null });
    console.info("[henry-lock] bloqueado por inatividade.");
  } else if (touch && !evaluated.locked && row?.fullscreen) {
    await updateRow(userId, { last_activity_at: new Date(now).toISOString() });
  }
  return publicState(row, evaluated, now);
}

// Abrir a tela cheia, "Henry, bloqueia", botão do cadeado ou inatividade na tela: bloqueia (todos os aparelhos).
export async function engageHenryLock(auth) {
  const userId = auth?.profile?.id || "";
  const row = await readRow(userId);
  if (!row?.pin_hash) return { configured: false, locked: false };
  const now = new Date().toISOString();
  await updateRow(userId, { locked_at: row.locked_at || now, fullscreen: true, unlock_token_hash: null });
  return { configured: true, locked: true };
}

// Saiu da tela cheia DESBLOQUEADO: o Henry pequeno volta ao comportamento de antes. Bloqueado não sai (409).
export async function leaveHenryFullscreen(auth, { tokenHash = "" } = {}) {
  const userId = auth?.profile?.id || "";
  const row = await readRow(userId);
  const evaluated = evaluateHenryLock(row, { tokenHash });
  if (!evaluated.configured) return { configured: false, locked: false };
  if (evaluated.locked) {
    if (evaluated.expire) await updateRow(userId, { locked_at: new Date().toISOString(), unlock_token_hash: null });
    throw new HenryLockError("A tela está bloqueada. Digite a senha para sair.", 409, { locked: true });
  }
  await updateRow(userId, { fullscreen: false });
  return { configured: true, locked: false };
}

// Aviso ao dono a cada espera por erro de senha: Central de Alertas (Importante) + push, o canal que já existe para ele
// (push só porque o contexto declara push_kind henry_lockout, lib/notification-policy-core.mjs). Nunca lança.
async function notifyHenryLockout(userId, { failures, lockedUntil, waitMs }) {
  try {
    const minutes = Math.round(waitMs / 60000);
    await createAlertDeliveries([
      {
        definition_id: null,
        recipient_id: userId,
        kind: "important",
        title: "Henry: senha errada várias vezes",
        body: `Erraram a senha da tela do Henry ${failures} vezes seguidas. Novas tentativas só daqui a ${minutes} min. Se não foi você, troque a senha no cartão do Henry (Alexa e Henry).`,
        context: { source: "henry_lock", action: "lockout", failures, link: "/admin/alexa", push_kind: NOTIFICATION_KIND.HENRY_LOCKOUT },
        dedupe_key: `henry_lock:${userId}:${lockedUntil}`
      }
    ]);
  } catch (error) {
    console.warn(`[henry-lock] aviso de senha errada não enviado (${error?.name || "erro"}).`);
  }
}

// Erro de senha contado no servidor (troca só se a contagem ainda for a lida: dois pedidos ao mesmo tempo não contam um).
async function registerFailure(userId, row) {
  let current = row;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = henryLockFailure(current);
    const changed = await updateRow(userId, { failed_attempts: next.failed_attempts, locked_until: next.locked_until }, { failed_attempts: Number(current.failed_attempts) || 0 });
    if (changed) {
      if (next.notify) {
        console.warn(`[henry-lock] ${next.failed_attempts} erros seguidos: espera de ${Math.round(next.waitMs / 1000)} s.`);
        await notifyHenryLockout(userId, { failures: next.failed_attempts, lockedUntil: next.locked_until, waitMs: next.waitMs });
      }
      return next;
    }
    current = (await readRow(userId)) || current;
  }
  throw new HenryLockError("Não consegui conferir a senha agora. Tente de novo.", 503);
}

function waitError(seconds) {
  return new HenryLockError(henryLockWaitMessage(seconds), 429, { waitSeconds: seconds });
}

async function checkPin(userId, row, pin) {
  const waitSeconds = henryLockWaitSeconds(row);
  if (waitSeconds) throw waitError(waitSeconds);
  if (verifyHenryPin(pin, row.pin_hash)) return true;
  const next = await registerFailure(userId, row);
  if (next.waitMs) throw waitError(Math.ceil(next.waitMs / 1000));
  throw new HenryLockError("Senha incorreta.", 401, { attemptsLeft: next.attemptsLeft });
}

// Desbloqueio: senha certa → token novo (cookie HttpOnly deste aparelho), inatividade começa agora, erros zerados.
export async function unlockHenryLock(auth, pin) {
  const userId = auth?.profile?.id || "";
  if (!isValidHenryPin(pin)) throw new HenryLockError("Digite os 6 dígitos.", 400);
  const row = await readRow(userId);
  if (!row?.pin_hash) throw new HenryLockError("Defina a senha no cartão do Henry primeiro.", 409);
  await checkPin(userId, row, pin);
  console.info("[henry-lock] desbloqueado.");
  return grantHenryUnlock(userId, row);
}

// Face ID / Windows Hello (REGRA OFICIAL — dono, 2026-10-24; HENRY-LOCK "Face ID"): chamado SÓ depois que a assinatura
// do aparelho foi conferida no servidor (lib/admin-passkeys.js). Mesmo efeito da senha certa: desbloqueia, token novo do
// aparelho, inatividade recomeça, erros e espera zerados. Sem senha definida não existe bloqueio para desfazer.
export async function unlockHenryLockWithPasskey(auth) {
  const userId = auth?.profile?.id || "";
  const row = await readRow(userId);
  if (!row?.pin_hash) throw new HenryLockError("Defina a senha no cartão do Henry primeiro.", 409);
  console.info("[henry-lock] desbloqueado por Face ID.");
  return grantHenryUnlock(userId, row);
}

async function grantHenryUnlock(userId, row) {
  const token = newHenryUnlockToken();
  const now = new Date().toISOString();
  await updateRow(userId, { locked_at: null, fullscreen: true, unlock_token_hash: hashHenryUnlockToken(token), last_activity_at: now, failed_attempts: 0, locked_until: null });
  return { token, state: { configured: true, locked: false, fullscreen: true, idleMinutes: normalizeIdleMinutes(row.idle_minutes), waitSeconds: 0 } };
}

// Definir/trocar a senha (cartão do Henry). Trocar exige a senha atual (erros contam igual ao desbloqueio).
export async function setHenryLockPin(auth, { pin, currentPin = "" } = {}) {
  const userId = auth?.profile?.id || "";
  if (!isValidHenryPin(pin)) throw new HenryLockError("A senha precisa ter exatamente 6 dígitos.", 400);
  const row = await readRow(userId);
  if (row?.pin_hash) {
    if (!isValidHenryPin(currentPin)) throw new HenryLockError("Digite a senha atual (6 dígitos) para trocar.", 400);
    await checkPin(userId, row, currentPin);
  }
  const now = new Date().toISOString();
  const patch = { pin_hash: hashHenryPin(pin), pin_set_at: now, failed_attempts: 0, locked_until: null };
  if (row) await updateRow(userId, patch);
  else {
    const { error } = await db().from(TABLE).insert({ user_id: userId, ...patch, idle_minutes: normalizeIdleMinutes(), locked_at: null, fullscreen: false, updated_at: now });
    if (error) {
      if (isMissingTable(error)) throw new HenryLockError("A tela de bloqueio ainda não foi ativada no banco (migration pendente).", 503);
      throw error;
    }
  }
  console.info(`[henry-lock] senha ${row?.pin_hash ? "trocada" : "definida"}.`);
  return { configured: true };
}

export async function setHenryLockIdle(auth, minutes) {
  const userId = auth?.profile?.id || "";
  const row = await readRow(userId);
  if (!row?.pin_hash) throw new HenryLockError("Defina a senha primeiro.", 409);
  const idleMinutes = normalizeIdleMinutes(minutes);
  await updateRow(userId, { idle_minutes: idleMinutes });
  return { idleMinutes };
}

export function henryLockCookieOptions({ clear = false } = {}) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/admin/henry",
    maxAge: clear ? 0 : HENRY_LOCK_COOKIE_MAX_AGE_SECONDS
  };
}
