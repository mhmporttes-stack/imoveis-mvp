import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase";
import { canonicalWhatsappPhone } from "./phone-utils";
import { buildGoogleContactName } from "./google-contacts-name.mjs";
import { encryptSecret, decryptSecret } from "./secrets-crypto";
import {
  getGoogleClientId,
  getGoogleClientSecret,
  getGoogleContactsRedirectUri,
  isGoogleContactsConfigured,
  GOOGLE_CONTACTS_SCOPES
} from "./google-contacts-config";

// Integração Google Contacts (People API) por corretor — pedido do dono,
// 2026-10-01. PARALELA ao WhatsApp individual (lib/whatsapp-individual.js):
// nunca importa nem é importada por ele, nunca toca em
// whatsapp_individual_sessions/daily_goal_auto_queue/daily_goal_rounds fora
// do necessário para o pré-envio (ver o hook em dispatchOneForBroker, em
// lib/daily-goal-auto.js). Um erro aqui NUNCA derruba a sessão WhatsApp —
// toda função best-effort devolve {success:false, ...} em vez de lançar
// quando chamada pelo caminho automático.

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const PEOPLE_CREATE_CONTACT_ENDPOINT = "https://people.googleapis.com/v1/people:createContact";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

const GLOBAL_SETTINGS_ID = "google_contacts_global";
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 min — tempo de sobra pro corretor concluir o consentimento Google.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

/* ------------------------------- OAuth state (CSRF) ------------------------------- */

// State assinado (HMAC) em vez de guardado em tabela — sem estado extra no
// banco, verificável sozinho no callback (broker_id + timestamp + assinatura).
// Mesma chave de lib/secrets-crypto.js (CRM_SECRETS_ENCRYPTION_KEY), usada
// aqui só para assinar (HMAC), nunca para cifrar este valor.
function signState(brokerId) {
  const payload = `${brokerId}.${Date.now()}`;
  const key = process.env.CRM_SECRETS_ENCRYPTION_KEY || "";
  const signature = createHmac("sha256", key).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

function verifyState(state) {
  try {
    const decoded = Buffer.from(String(state || ""), "base64url").toString("utf8");
    const [brokerId, ts, signature] = decoded.split(".");
    if (!brokerId || !ts || !signature) return null;
    const key = process.env.CRM_SECRETS_ENCRYPTION_KEY || "";
    const expected = createHmac("sha256", key).update(`${brokerId}.${ts}`).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    if (Date.now() - Number(ts) > STATE_MAX_AGE_MS) return null;
    return brokerId;
  } catch {
    return null;
  }
}

/* ------------------------------- Config global ------------------------------- */

export async function getGoogleContactsGlobalEnabled() {
  const { data } = await db().from("crm_settings").select("setting_value").eq("id", GLOBAL_SETTINGS_ID).maybeSingle();
  return data?.setting_value?.enabled !== false; // default true (indisponível só por falta de env, ver isGoogleContactsConfigured)
}

/* ------------------------------- OAuth: conectar ------------------------------- */

// Chamado pela rota GET /api/google-contacts/connect (navegação direta do
// navegador, não fetch) — devolve a URL do Google pra onde a rota redireciona.
export function buildGoogleAuthUrl(brokerId) {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: getGoogleContactsRedirectUri(),
    response_type: "code",
    scope: GOOGLE_CONTACTS_SCOPES,
    access_type: "offline", // necessário para ganhar refresh_token
    prompt: "consent", // garante refresh_token mesmo em reconexão (Google só manda na 1ª concessão sem isso)
    include_granted_scopes: "true",
    state: signState(brokerId)
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: getGoogleClientId(),
      client_secret: getGoogleClientSecret(),
      redirect_uri: getGoogleContactsRedirectUri(),
      grant_type: "authorization_code"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error_description || payload?.error || "Falha ao trocar o código pelo token do Google.");
  return payload; // { access_token, refresh_token, expires_in, scope, token_type, id_token }
}

async function fetchGoogleAccountEmail(accessToken) {
  const response = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || "Falha ao identificar a conta Google.");
  return { email: payload?.email || "", googleAccountId: payload?.sub || "" };
}

// Processa o retorno do Google (code + state) — valida CSRF, troca o código,
// identifica a conta e salva a conexão. Chamado pela rota de callback.
export async function completeGoogleOAuthConnection({ code, state }) {
  const brokerId = verifyState(state);
  if (!brokerId) throw new Error("Link de conexão inválido ou expirado. Tente conectar novamente.");

  const tokens = await exchangeCodeForTokens(code);
  if (!tokens.refresh_token) {
    // Acontece se o corretor já tinha autorizado antes e o Google não
    // reemitiu o refresh_token (raro com prompt=consent, mas possível) —
    // sem ele não dá pra manter a sessão sem reconectar todo dia.
    throw new Error("O Google não devolveu permissão de acesso contínuo. Revogue o acesso em myaccount.google.com/permissions e tente conectar de novo.");
  }
  const { email, googleAccountId } = await fetchGoogleAccountEmail(tokens.access_token);

  const now = new Date().toISOString();
  const { error } = await db().from("google_contacts_connections").upsert({
    broker_id: brokerId,
    google_account_email: email,
    google_account_id: googleAccountId,
    encrypted_refresh_token: encryptSecret(tokens.refresh_token),
    encrypted_access_token: tokens.access_token ? encryptSecret(tokens.access_token) : null,
    access_token_expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
    scopes: tokens.scope || GOOGLE_CONTACTS_SCOPES,
    status: "connected",
    sync_enabled: true,
    connected_at: now,
    disconnected_at: null,
    last_error: null,
    updated_at: now
  }, { onConflict: "broker_id" });
  if (error) throw error;

  return { brokerId, email };
}

/* ------------------------------- Status/leitura ------------------------------- */

function rowToPublicStatus(row) {
  if (!row) return { status: "disconnected", email: "", syncEnabled: false, connectedAt: null, lastError: "" };
  return {
    status: row.status,
    email: row.google_account_email || "",
    syncEnabled: Boolean(row.sync_enabled),
    connectedAt: row.connected_at,
    lastError: row.status === "error" ? row.last_error || "" : ""
  };
}

// Nunca devolve token nenhum — segurança (pedido do dono: "nunca retornar
// access_token/refresh_token pela API do frontend").
export async function getGoogleContactsStatusForBroker(brokerId) {
  const { data } = await db().from("google_contacts_connections").select("*").eq("broker_id", brokerId).maybeSingle();
  return { ...rowToPublicStatus(data), configured: isGoogleContactsConfigured() };
}

// Status de vários corretores de uma vez (painel do gestor) — mesmo padrão
// de listIndividualSessionStatuses em lib/whatsapp-individual.js.
export async function listGoogleContactsStatuses(brokerIds) {
  if (!brokerIds?.length) return new Map();
  const { data, error } = await db().from("google_contacts_connections")
    .select("broker_id, status, google_account_email, sync_enabled")
    .in("broker_id", brokerIds);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.broker_id, {
    status: row.status,
    email: row.google_account_email || "",
    syncEnabled: Boolean(row.sync_enabled)
  }]));
}

/* ------------------------------- Desconectar ------------------------------- */

export async function disconnectGoogleContactsForBroker(brokerId) {
  const { data: row } = await db().from("google_contacts_connections").select("encrypted_refresh_token").eq("broker_id", brokerId).maybeSingle();
  if (row?.encrypted_refresh_token) {
    try {
      const refreshToken = decryptSecret(row.encrypted_refresh_token);
      await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(refreshToken)}`, { method: "POST" });
    } catch (revokeError) {
      // Best-effort: mesmo se a revogação no Google falhar, a integração
      // fica desconectada no CRM (o corretor pode revogar manualmente em
      // myaccount.google.com/permissions se precisar).
      console.warn("Falha ao revogar o token do Google (best-effort):", revokeError?.message || revokeError);
    }
  }
  const { error } = await db().from("google_contacts_connections").update({
    status: "disconnected",
    sync_enabled: false,
    encrypted_refresh_token: null,
    encrypted_access_token: null,
    access_token_expires_at: null,
    disconnected_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq("broker_id", brokerId);
  if (error) throw error;
}

/* ------------------------------- Access token válido ------------------------------- */

// Renova o access_token só quando necessário (expira em <=60s ou já
// expirado) — nunca chama o Google em toda mensagem (pedido do dono:
// "não adicionar latência desnecessária ao envio"). invalid_grant (refresh
// token revogado/expirado) marca a conexão como 'error' pra aparecer "Requer
// reconexão" no painel, sem nunca tocar no WhatsApp.
async function getValidAccessToken(brokerId) {
  const { data: row, error } = await db().from("google_contacts_connections").select("*").eq("broker_id", brokerId).maybeSingle();
  if (error) throw error;
  if (!row || row.status !== "connected" || !row.sync_enabled) return { ok: false, reason: "nao_conectado" };
  if (!row.encrypted_refresh_token) return { ok: false, reason: "sem_refresh_token" };

  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  if (row.encrypted_access_token && expiresAt - Date.now() > 60000) {
    return { ok: true, accessToken: decryptSecret(row.encrypted_access_token) };
  }

  try {
    const refreshToken = decryptSecret(row.encrypted_refresh_token);
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: getGoogleClientId(),
        client_secret: getGoogleClientSecret(),
        grant_type: "refresh_token"
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const isRevoked = payload?.error === "invalid_grant";
      await db().from("google_contacts_connections").update({
        status: isRevoked ? "error" : row.status,
        last_error: payload?.error_description || payload?.error || "Falha ao renovar o token do Google.",
        updated_at: new Date().toISOString()
      }).eq("broker_id", brokerId);
      return { ok: false, reason: isRevoked ? "revogado" : "falha_renovacao" };
    }
    await db().from("google_contacts_connections").update({
      encrypted_access_token: encryptSecret(payload.access_token),
      access_token_expires_at: new Date(Date.now() + (payload.expires_in || 3600) * 1000).toISOString(),
      status: "connected",
      last_error: null,
      updated_at: new Date().toISOString()
    }).eq("broker_id", brokerId);
    return { ok: true, accessToken: payload.access_token };
  } catch (networkError) {
    return { ok: false, reason: "erro_rede", error: networkError?.message || String(networkError) };
  }
}

/* ------------------------------- People API: criar contato ------------------------------- */

async function createGoogleContact(accessToken, { name, phone }) {
  const response = await fetch(PEOPLE_CREATE_CONTACT_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      names: [{ givenName: name }],
      phoneNumbers: [{ value: phone, type: "mobile" }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Falha ao criar contato no Google (status ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return { resourceName: payload?.resourceName || "", contactId: (payload?.resourceName || "").replace("people/", "") };
}

/* ------------------------------- Função central ------------------------------- */

// ensureClientInBrokerContacts({ brokerId, clientId, phone, name }) ->
// { success, status, contactId, error }. Idempotente: chamar 10x pro mesmo
// broker+telefone resulta em 1 único contato.
//
// Concorrência (pedido do dono: "duas tarefas do mesmo cliente executadas
// simultaneamente -> somente um contato criado"): antes de chamar o Google,
// reivindica a linha de sincronização de forma ATÔMICA —
// unique(broker_id, normalized_phone) em google_contact_sync rejeita
// (23505) a 2ª tentativa concorrente de INSERT, e a transição de status
// 'failed' -> 'syncing' (retry) só é aceita se a linha ainda estiver
// 'failed' no exato momento do UPDATE (.eq("sync_status","failed")) — o
// perdedor da corrida nunca chega a chamar people:createContact.
export async function ensureClientInBrokerContacts({ brokerId, clientId, phone, name }) {
  const normalizedPhone = canonicalWhatsappPhone(phone);
  if (!normalizedPhone) return { success: false, status: "failed", error: "Contato sem telefone válido." };
  // Só o contato do Google leva o prefixo "Cliente" — `name` (nome do CRM)
  // não é alterado em lugar nenhum.
  const contactName = buildGoogleContactName(name, normalizedPhone);
  const now = new Date().toISOString();

  // 1) Banco local primeiro — nunca chama o Google se já sabemos que está sincronizado.
  const { data: existing } = await db().from("google_contact_sync")
    .select("*").eq("broker_id", brokerId).eq("normalized_phone", normalizedPhone).maybeSingle();
  if (existing?.sync_status === "synced" && existing.google_resource_name) {
    return { success: true, status: "synced", contactId: existing.google_resource_name };
  }

  // 2) Reivindica a linha (claim atômico) antes de chamar o Google.
  const claimed = await claimSyncRow({ brokerId, clientId, normalizedPhone, existing, now });
  if (!claimed) return { success: false, status: "failed", error: "Sincronização já em andamento por outro processo — tenta de novo no próximo ciclo." };

  const tokenResult = await getValidAccessToken(brokerId);
  if (!tokenResult.ok) {
    await finishSyncAttempt({ brokerId, normalizedPhone, attempts: claimed.attempts, status: "failed", error: `Google não disponível (${tokenResult.reason}).` });
    return { success: false, status: "failed", error: `Conexão Google indisponível (${tokenResult.reason}).` };
  }

  try {
    const created = await createGoogleContact(tokenResult.accessToken, { name: contactName, phone: normalizedPhone });
    await finishSyncAttempt({ brokerId, normalizedPhone, attempts: claimed.attempts, status: "synced", resourceName: created.resourceName, contactId: created.contactId });
    return { success: true, status: "synced", contactId: created.resourceName };
  } catch (createError) {
    await finishSyncAttempt({ brokerId, normalizedPhone, attempts: claimed.attempts, status: "failed", error: createError?.message || String(createError) });
    return { success: false, status: "failed", error: createError?.message || String(createError) };
  }
}

async function claimSyncRow({ brokerId, clientId, normalizedPhone, existing, now }) {
  if (!existing) {
    const { error } = await db().from("google_contact_sync").insert({
      broker_id: brokerId, client_id: clientId || null, normalized_phone: normalizedPhone,
      sync_status: "syncing", attempts: 1, updated_at: now
    });
    if (error) {
      if (error.code === "23505") return null; // outro processo acabou de criar a linha primeiro
      throw error;
    }
    return { attempts: 1 };
  }
  if (existing.sync_status === "syncing") {
    // 'syncing' preso há mais de 2 min é de um processo que provavelmente
    // caiu no meio do caminho (crash entre o claim e o resultado) — sem
    // isso, a linha ficaria travada pra sempre e o cliente nunca mais
    // seria sincronizado. Só reivindica de novo depois desse prazo.
    const staleMs = Date.now() - new Date(existing.updated_at).getTime();
    if (staleMs < 2 * 60 * 1000) return null;
  }
  const nextAttempts = (existing.attempts || 0) + 1;
  const { data, error } = await db().from("google_contact_sync")
    .update({ sync_status: "syncing", client_id: clientId || existing.client_id, attempts: nextAttempts, updated_at: now })
    .eq("broker_id", brokerId).eq("normalized_phone", normalizedPhone).eq("sync_status", existing.sync_status)
    .select("id").maybeSingle();
  if (error) throw error;
  if (!data) return null; // outro processo já mudou o status entre a leitura e agora
  return { attempts: nextAttempts };
}

async function finishSyncAttempt({ brokerId, normalizedPhone, attempts, status, resourceName, contactId, error }) {
  const now = new Date().toISOString();
  const patch = { sync_status: status, attempts, last_error: error || null, updated_at: now };
  if (status === "synced") {
    patch.google_resource_name = resourceName;
    patch.google_contact_id = contactId;
    patch.synced_at = now;
  }
  const { error: updateError } = await db().from("google_contact_sync").update(patch)
    .eq("broker_id", brokerId).eq("normalized_phone", normalizedPhone);
  if (updateError) console.error("Falha ao registrar sincronização do Google Contacts:", updateError.message || updateError);
}

// Usado pelo pré-envio (lib/daily-goal-auto.js): decide SE vale a pena
// sequer tentar sincronizar antes deste corretor mandar mensagem.
export async function isGoogleContactsSyncEnabledForBroker(brokerId) {
  if (!isGoogleContactsConfigured()) return false;
  const globalEnabled = await getGoogleContactsGlobalEnabled();
  if (!globalEnabled) return false;
  const { data } = await db().from("google_contacts_connections").select("status, sync_enabled").eq("broker_id", brokerId).maybeSingle();
  return Boolean(data?.sync_enabled && data.status === "connected");
}

// Métricas simples pro card do corretor (pedido do dono: "Contatos
// sincronizados: X", sem dashboard complexo).
export async function getGoogleContactsSyncCounts(brokerId) {
  const { data } = await db().from("google_contact_sync").select("sync_status").eq("broker_id", brokerId);
  const counts = { synced: 0, pending: 0, failed: 0 };
  for (const row of data || []) {
    if (row.sync_status === "synced") counts.synced += 1;
    else if (row.sync_status === "failed") counts.failed += 1;
    else counts.pending += 1;
  }
  return counts;
}
