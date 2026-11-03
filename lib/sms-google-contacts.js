import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { isGeneralAdminAuth } from "./admin-profiles";
import { decryptSecret, encryptSecret } from "./secrets-crypto";
import { resolveSiteBaseUrl } from "./site-url.mjs";
import { hasContactsScope } from "./google-contacts-config-core.mjs";
import {
  GOOGLE_SMS_CODE,
  GOOGLE_SMS_GROUP_NAME,
  GOOGLE_SMS_SCOPE,
  GOOGLE_SMS_SETTING_ID,
  buildBatchCreateBody,
  chunkList,
  cleanGoogleError,
  describeGoogleSmsResult,
  isGoogleSmsAuthError,
  isStaleClaim,
  parseBatchCreateResponse,
  planGoogleSmsContacts,
  readGoogleSmsConfig,
  resolveGoogleSmsRedirectUri,
  signGoogleSmsState,
  verifyGoogleSmsState
} from "./sms-google-contacts-core.mjs";

// Lote de SMS -> Google Contatos (dono, 2026-11-03, PRO-18g). Uma única conta Google (a do dono) guarda os contatos do Lote
// (da equipe E dos corretores); o iPhone do dono sincroniza sozinho. Google People API via fetch, sem biblioteca.
// O refresh token fica CIFRADO (lib/secrets-crypto.js, AES-256-GCM) em crm_settings `google_contacts_connection` e NUNCA é
// devolvido ao navegador nem escrito em log. Integração PARALELA à de Google Contatos por corretor (lib/google-contacts.js):
// credenciais, tabela e rotas próprias — nenhuma das duas importa a outra.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const PEOPLE_API = "https://people.googleapis.com/v1";
const TABLE = "sms_batch_google_contacts";
const FETCH_TIMEOUT_MS = 25000;

export class GoogleSmsError extends Error {
  constructor(message, status = 400, code = "") {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

const isMissingTable = (error) => error?.code === "42P01" || error?.code === "PGRST205";

function secret() {
  return process.env.CRM_SECRETS_ENCRYPTION_KEY || "";
}

export function googleSmsRedirectUri() {
  return resolveGoogleSmsRedirectUri(resolveSiteBaseUrl(process.env.NEXT_PUBLIC_SITE_URL), process.env.GOOGLE_CONTACTS_REDIRECT_URI);
}

/* ------------------------------- Conexão (crm_settings) ------------------------------- */

async function readConnection() {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", GOOGLE_SMS_SETTING_ID).maybeSingle();
  if (error) throw error;
  return data?.setting_value || null;
}

async function writeConnection(value, userId) {
  const { error } = await db().from("crm_settings").upsert({
    id: GOOGLE_SMS_SETTING_ID,
    setting_value: value,
    updated_at: new Date().toISOString(),
    ...(userId ? { updated_by: userId } : {})
  }, { onConflict: "id" });
  if (error) throw error;
}

/** Estado para a tela (nunca devolve token nem credencial). Melhor esforço: falha vira "indisponível", não derruba o Lote. */
export async function getGoogleSmsStatus(auth) {
  const config = readGoogleSmsConfig();
  const status = { configured: config.configured, missing: config.missing, connected: false, needsReconnect: false, canConnect: Boolean(!auth?.accountSwitchMode && isGeneralAdminAuth(auth)) };
  if (!config.configured) return status;
  try {
    const connection = await readConnection();
    status.connected = Boolean(connection?.refresh_token_encrypted && connection.status === "connected");
    status.needsReconnect = Boolean(connection?.refresh_token_encrypted && connection.status === "error");
  } catch (error) {
    console.warn("Lote de SMS: estado do Google Contatos indisponível:", error?.message || error);
  }
  return status;
}

/* ------------------------------- OAuth ------------------------------- */

function requireConfig() {
  const config = readGoogleSmsConfig();
  if (!config.configured) throw new GoogleSmsError(`Google Contatos ainda não foi configurado no servidor (falta: ${config.missing.join(", ")}).`, 409, GOOGLE_SMS_CODE.NOT_CONFIGURED);
  return config;
}

/** URL do consentimento do Google. O state é preso ao admin real logado (anti-CSRF). */
export function buildGoogleSmsAuthUrl(userId) {
  const config = requireConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: googleSmsRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SMS_SCOPE,
    access_type: "offline", // necessário para o refresh_token
    prompt: "consent", // garante refresh_token também ao reconectar
    state: signGoogleSmsState({ userId, secret: secret() })
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function googleFetch(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

/** Retorno do Google (code + state): valida o state do admin logado, troca o código e guarda o refresh token cifrado. */
export async function completeGoogleSmsConnection({ code, state, userId }) {
  const config = requireConfig();
  if (!verifyGoogleSmsState(state, { userId, secret: secret() })) throw new GoogleSmsError("Link de conexão inválido ou expirado. Tente conectar de novo.", 400);
  const { response, payload } = await googleFetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: googleSmsRedirectUri(), grant_type: "authorization_code" })
  });
  if (!response.ok) throw new GoogleSmsError(cleanGoogleError(payload?.error_description || payload?.error || "O Google recusou o código."), 400);
  if (!payload.refresh_token) throw new GoogleSmsError("O Google não devolveu acesso contínuo. Revogue o app em myaccount.google.com/permissions e conecte de novo.", 400);
  if (payload.scope && !hasContactsScope(payload.scope)) throw new GoogleSmsError("A permissão de Contatos não foi liberada. Conecte de novo e deixe a opção marcada.", 400);
  await writeConnection({ status: "connected", refresh_token_encrypted: encryptSecret(payload.refresh_token), connected_at: new Date().toISOString(), connected_by: userId, last_error: null }, userId);
}

// Access token novo a cada salvamento (uma chamada; o lote é pequeno). Token revogado/expirado -> conexão marcada com erro.
async function getAccessToken() {
  const config = requireConfig();
  const connection = await readConnection();
  if (!connection?.refresh_token_encrypted) throw new GoogleSmsError("O Google Contatos ainda não está conectado. Peça ao dono para conectar.", 409, GOOGLE_SMS_CODE.NOT_CONNECTED);
  let refreshToken;
  try {
    refreshToken = decryptSecret(connection.refresh_token_encrypted);
  } catch {
    await writeConnection({ ...connection, status: "error", last_error: "Token ilegível (chave de criptografia mudou)." });
    throw new GoogleSmsError("A conexão com o Google precisa ser refeita.", 409, GOOGLE_SMS_CODE.RECONNECT);
  }
  const { response, payload } = await googleFetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token" })
  });
  if (!response.ok) {
    if (isGoogleSmsAuthError(response.status, payload?.error)) {
      await writeConnection({ ...connection, status: "error", last_error: cleanGoogleError(payload?.error_description || payload?.error) });
      throw new GoogleSmsError("A conexão com o Google expirou ou foi revogada. Reconecte a conta.", 409, GOOGLE_SMS_CODE.RECONNECT);
    }
    throw new GoogleSmsError("O Google não respondeu agora. Tente de novo em instantes.", 502);
  }
  return payload.access_token;
}

/* ------------------------------- People API ------------------------------- */

async function peopleCall(accessToken, path, init = {}) {
  const { response, payload } = await googleFetch(`${PEOPLE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}) }
  });
  if (!response.ok) {
    const message = payload?.error?.message || `Erro ${response.status} do Google.`;
    if (isGoogleSmsAuthError(response.status, `${payload?.error?.status || ""} ${message}`)) throw new GoogleSmsError("A permissão do Google acabou. Reconecte a conta.", 409, GOOGLE_SMS_CODE.RECONNECT);
    throw new GoogleSmsError(cleanGoogleError(message), 502);
  }
  return payload;
}

// Rótulo "SMS lote": reaproveita o que existe (por nome) ou cria. Permite achar/apagar o lote inteiro no Google Contatos.
async function ensureGroup(accessToken) {
  let pageToken = "";
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({ pageSize: "200", groupFields: "name,groupType", ...(pageToken ? { pageToken } : {}) });
    const data = await peopleCall(accessToken, `/contactGroups?${query.toString()}`);
    const found = (data.contactGroups || []).find((group) => group.groupType === "USER_CONTACT_GROUP" && group.name === GOOGLE_SMS_GROUP_NAME);
    if (found?.resourceName) return found.resourceName;
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  const created = await peopleCall(accessToken, "/contactGroups", { method: "POST", body: JSON.stringify({ contactGroup: { name: GOOGLE_SMS_GROUP_NAME } }) });
  if (!created.resourceName) throw new GoogleSmsError("Não foi possível criar o rótulo \"SMS lote\" no Google.", 502);
  return created.resourceName;
}

/* ------------------------------- Salvar a lista ------------------------------- */

function checkTable(result) {
  if (result.error) {
    if (isMissingTable(result.error)) throw new GoogleSmsError("Falta liberar a tabela do Google Contatos no banco (migration pendente).", 409, GOOGLE_SMS_CODE.TABLE_MISSING);
    throw result.error;
  }
  return result.data;
}

/**
 * Salva na conta Google conectada os contatos da lista atual (`items` = saída de loadSmsBatch com includePhones; o escopo e a
 * regra do Wi-Fi já foram aplicados por quem chamou). Idempotente: contato já salvo não é recriado (PK contact_id, reivindicada
 * ANTES de chamar o Google — dois toques seguidos não duplicam). Erro de um contato não derruba os demais.
 */
export async function saveSmsContactsToGoogle(items = []) {
  requireConfig();
  const connection = await readConnection();
  if (!connection?.refresh_token_encrypted) throw new GoogleSmsError("O Google Contatos ainda não está conectado. Peça ao dono para conectar.", 409, GOOGLE_SMS_CODE.NOT_CONNECTED);
  if (connection.status === "error") throw new GoogleSmsError("A conexão com o Google expirou ou foi revogada. Reconecte a conta.", 409, GOOGLE_SMS_CODE.RECONNECT);

  const client = db();
  const ids = [...new Set(items.map((item) => String(item?.id || "")).filter(Boolean))];
  const existing = ids.length ? checkTable(await client.from(TABLE).select("contact_id, resource_name, created_at").in("contact_id", ids)) || [] : [];
  // Reivindicação antiga e nunca concluída (processo caiu no meio) é refeita; a recente é de outro toque em andamento.
  const stale = existing.filter((row) => isStaleClaim(row));
  if (stale.length) checkTable(await client.from(TABLE).delete().in("contact_id", stale.map((row) => row.contact_id)).is("resource_name", null));
  const blocked = new Set(existing.filter((row) => !stale.includes(row)).map((row) => row.contact_id));
  const plan = planGoogleSmsContacts(items, blocked);
  const result = { created: 0, alreadySaved: plan.alreadySaved, invalid: plan.invalid, failed: [] };

  if (plan.toCreate.length) {
    const accessToken = await getAccessToken();
    const group = await ensureGroup(accessToken);
    for (const part of chunkList(plan.toCreate)) {
      // Reivindica atomicamente: só cria no Google quem este toque conseguiu inserir (ON CONFLICT DO NOTHING).
      const claimed = new Set((checkTable(await client.from(TABLE).upsert(part.map((contact) => ({ contact_id: contact.id })), { onConflict: "contact_id", ignoreDuplicates: true }).select("contact_id")) || []).map((row) => row.contact_id));
      result.alreadySaved += part.length - claimed.size;
      const mine = part.filter((contact) => claimed.has(contact.id));
      if (!mine.length) continue;
      const release = async (contactIds) => {
        if (contactIds.length) await client.from(TABLE).delete().in("contact_id", contactIds).is("resource_name", null);
      };
      try {
        const payload = await peopleCall(accessToken, "/people:batchCreateContacts", { method: "POST", body: JSON.stringify(buildBatchCreateBody(mine, group)) });
        const parsed = parseBatchCreateResponse(mine, payload);
        for (const row of parsed.created) {
          const { error } = await client.from(TABLE).update({ resource_name: row.resourceName }).eq("contact_id", row.id);
          if (error) console.error("Lote de SMS: contato criado no Google mas não registrado:", error.message || error);
        }
        await release(parsed.failed.map((row) => row.id));
        result.created += parsed.created.length;
        result.failed.push(...parsed.failed);
      } catch (error) {
        await release(mine.map((contact) => contact.id));
        if (error?.code === GOOGLE_SMS_CODE.RECONNECT) {
          await writeConnection({ ...connection, status: "error", last_error: "Permissão do Google recusada ao salvar contatos." });
          throw error;
        }
        result.failed.push(...mine.map((contact) => ({ id: contact.id, name: contact.name, error: cleanGoogleError(error?.message) })));
      }
    }
  }
  return { ...result, failedCount: result.failed.length, message: describeGoogleSmsResult({ created: result.created, alreadySaved: result.alreadySaved, failed: result.failed.length }) };
}
