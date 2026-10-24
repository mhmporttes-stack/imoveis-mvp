import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { isOwnerAdminEmail } from "./admin-auth";
import { confirmFreshTotp } from "./admin-two-factor";
import { unlockHenryLockWithPasskey } from "./henry-lock";
import { PASSKEY_WRONG_HOST_MESSAGE, isPasskeyEligible, passkeyDeviceName, resolvePasskeyRp } from "./admin-passkey-core.mjs";
import {
  buildPasskeyRegistrationOptions,
  buildPasskeyUnlockOptions,
  finishPasskeyRegistration,
  verifyPasskeyUnlock
} from "./admin-passkey-flow.mjs";

// Face ID / Windows Hello para DESBLOQUEAR a tela do Henry (REGRA OFICIAL — dono, 2026-10-24; docs/BUSINESS_RULES.md
// HENRY-LOCK "Face ID"). Só a conta do dono, só o Henry: o login do CRM NÃO muda. Banco: admin_passkeys (chave pública +
// contador) e admin_passkey_challenges (hash do desafio, uso único) — migration 20261024120000. A senha de 6 dígitos do
// Henry continua sempre valendo. Nunca loga chave, desafio nem resposta do aparelho.

const PASSKEYS = "admin_passkeys";
const CHALLENGES = "admin_passkey_challenges";
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);
const MISSING_TABLE_MESSAGE = "O Face ID ainda não foi ativado no banco (migration pendente).";

export class PasskeyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "PasskeyError";
    this.status = status;
  }
}

function db() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo nao configurado.");
  return supabase;
}

function raise(error) {
  if (MISSING_TABLE_CODES.has(error?.code)) throw new PasskeyError(MISSING_TABLE_MESSAGE, 503);
  throw error;
}

function unwrap(result) {
  if (!result.ok) throw new PasskeyError(result.error, result.status);
  return result;
}

// Mesmo critério do Henry (conta real do dono). requireHenryOwner já barra na rota; aqui é o reforço.
function ownerProfileId(auth) {
  if (!isPasskeyEligible({ ok: auth?.ok, isOwner: isOwnerAdminEmail(auth?.user?.email), accountSwitchMode: auth?.accountSwitchMode })) {
    throw new PasskeyError("O Face ID do Henry é só do dono, na conta dele.", 403);
  }
  const id = auth?.profile?.id || "";
  if (!id) throw new PasskeyError("Conta sem perfil no CRM: não dá para usar o Face ID.", 409);
  return id;
}

// Endereço do pedido → RP ID (www e sem www = domínio de produção; localhost só no next dev).
export function passkeyRpFromRequest(request) {
  const rp = resolvePasskeyRp({ hostname: request.nextUrl?.hostname, origin: request.nextUrl?.origin, production: process.env.NODE_ENV === "production" });
  if (!rp) throw new PasskeyError(PASSKEY_WRONG_HOST_MESSAGE, 400);
  return rp;
}

// "Store" do fluxo (lib/admin-passkey-flow.mjs). Trocas condicionais = atômicas no Postgres.
const store = {
  async listCredentials(userId) {
    const { data, error } = await db().from(PASSKEYS).select("id, credential_id, transports, device_name, created_at, last_used_at").eq("user_id", userId).order("created_at");
    if (error) raise(error);
    return data || [];
  },
  async findCredential(userId, credentialId) {
    const { data, error } = await db().from(PASSKEYS).select("id, credential_id, public_key, counter, transports").eq("user_id", userId).eq("credential_id", credentialId).maybeSingle();
    if (error) raise(error);
    return data || null;
  },
  async insertCredential({ userId, credentialId, publicKey, counter, transports, deviceName }) {
    const { data, error } = await db()
      .from(PASSKEYS)
      .insert({ user_id: userId, credential_id: credentialId, public_key: publicKey, counter, transports, device_name: deviceName })
      .select("id, device_name, created_at")
      .single();
    if (error?.code === "23505") return { ok: false, status: 409, error: "Este aparelho já está cadastrado." };
    if (error) raise(error);
    return { ok: true, device: data };
  },
  async updateCounter({ id, userId, expectedCounter, newCounter, nowMs }) {
    const { data, error } = await db()
      .from(PASSKEYS)
      .update({ counter: newCounter, last_used_at: new Date(nowMs).toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("counter", expectedCounter)
      .select("id");
    if (error) raise(error);
    return (data || []).length > 0;
  },
  async saveChallenge({ userId, purpose, challengeHash, expiresAt, nowMs }) {
    // Limpeza dos desafios vencidos desta conta (curtos e de uso único: não há o que guardar).
    const { error: cleanError } = await db().from(CHALLENGES).delete().eq("user_id", userId).lt("expires_at", new Date(nowMs).toISOString());
    if (cleanError) raise(cleanError);
    const { error } = await db().from(CHALLENGES).insert({ user_id: userId, purpose, challenge_hash: challengeHash, expires_at: expiresAt });
    if (error) raise(error);
  },
  async consumeChallenge({ userId, purpose, challengeHash, nowMs }) {
    const nowIso = new Date(nowMs).toISOString();
    const { data, error } = await db()
      .from(CHALLENGES)
      .update({ used_at: nowIso })
      .eq("user_id", userId)
      .eq("purpose", purpose)
      .eq("challenge_hash", challengeHash)
      .is("used_at", null)
      .gt("expires_at", nowIso)
      .select("id");
    if (error) raise(error);
    return (data || []).length > 0;
  }
};

const publicDevice = (row) => ({ id: row.id, deviceName: row.device_name || "Aparelho", createdAt: row.created_at, lastUsedAt: row.last_used_at || null });

// Cartão do Henry e tela bloqueada: há aparelhos? (sem tabela = Face ID indisponível, a senha continua).
export async function getHenryPasskeyStatus(auth) {
  const userId = ownerProfileId(auth);
  try {
    const rows = await store.listCredentials(userId);
    return { available: true, devices: rows.map(publicDevice) };
  } catch (error) {
    if (error instanceof PasskeyError && error.status === 503) return { available: false, reason: error.message, devices: [] };
    throw error;
  }
}

// Cadastro, passo 1: código do app autenticador conferido AGORA (além da sessão já com senha + 2FA) → desafio.
export async function startHenryPasskeyRegistration(auth, { code, rp }) {
  const userId = ownerProfileId(auth);
  unwrap(await confirmFreshTotp(auth.user, code));
  const { options } = unwrap(
    await buildPasskeyRegistrationOptions({ store, rp, user: { id: userId, email: auth.user?.email || "", name: auth.profile?.name || "" } })
  );
  return options;
}

// Cadastro, passo 2: resposta do aparelho conferida; guarda só a chave pública.
export async function finishHenryPasskeyRegistration(auth, { response, rp, deviceName = "", userAgent = "" }) {
  const userId = ownerProfileId(auth);
  const { device } = unwrap(await finishPasskeyRegistration({ store, rp, userId, response, deviceName: passkeyDeviceName({ name: deviceName, userAgent }) }));
  console.info("[passkey] aparelho cadastrado para o Henry.");
  return publicDevice(device);
}

export async function removeHenryPasskey(auth, id) {
  const userId = ownerProfileId(auth);
  if (typeof id !== "string" || !id) throw new PasskeyError("Aparelho inválido.", 400);
  const { data, error } = await db().from(PASSKEYS).delete().eq("id", id).eq("user_id", userId).select("id");
  if (error) raise(error);
  if (!(data || []).length) throw new PasskeyError("Aparelho não encontrado.", 404);
  console.info("[passkey] aparelho removido.");
  return { removed: true };
}

// Desbloqueio do Henry, passo 1: desafio para os aparelhos desta conta.
export async function startHenryPasskeyUnlock(auth, { rp }) {
  const userId = ownerProfileId(auth);
  const { options } = unwrap(await buildPasskeyUnlockOptions({ store, rp, userId }));
  return options;
}

// Desbloqueio do Henry, passo 2: assinatura conferida → o mesmo que a senha certa (lib/henry-lock.js).
export async function finishHenryPasskeyUnlock(auth, { response, rp }) {
  const userId = ownerProfileId(auth);
  unwrap(await verifyPasskeyUnlock({ store, rp, userId, response }));
  return unlockHenryLockWithPasskey(auth);
}
