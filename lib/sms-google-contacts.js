import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getValidAccessToken } from "./google-contacts";
import { isGoogleContactsConfigured } from "./google-contacts-config";
import { isGoogleAuthorizationError } from "./google-contacts-config-core.mjs";
import {
  GOOGLE_SMS_CODE,
  GOOGLE_SMS_GROUP_NAME,
  buildBatchCreateBody,
  chunkList,
  cleanGoogleError,
  describeGoogleSmsResult,
  googleSmsConnectionState,
  isStaleClaim,
  parseBatchCreateResponse,
  planGoogleSmsContacts
} from "./sms-google-contacts-core.mjs";

// Lote de SMS -> Google Contatos (dono, 2026-11-03, PRO-18g). Cada usuário grava na conta Google que ELE já conectou
// (lib/google-contacts.js, google_contacts_connections): o dono no lote da equipe, cada corretor no lote dele. Nada de OAuth,
// token ou credencial novos: o token (cifrado) é lido e renovado por getValidAccessToken e nunca sai daqui. Só acrescenta a
// People API de lote (people:batchCreateContacts) e o rótulo "SMS lote".

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

// Motivos de getValidAccessToken (lib/google-contacts.js) -> resposta ao usuário.
const NOT_CONNECTED_PROBLEM = ["Conecte seu Google Contatos para salvar a lista.", 409, GOOGLE_SMS_CODE.NOT_CONNECTED];
const TOKEN_PROBLEM = {
  revogado: ["Sua conexão com o Google Contatos expirou. Reconecte.", 409, GOOGLE_SMS_CODE.RECONNECT],
  nao_conectado: NOT_CONNECTED_PROBLEM,
  sem_refresh_token: NOT_CONNECTED_PROBLEM
};

const isMissingTable = (error) => error?.code === "42P01" || error?.code === "PGRST205";

async function readConnection(userId) {
  const { data, error } = await db().from("google_contacts_connections").select("status, sync_enabled, scopes, encrypted_refresh_token").eq("broker_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Estado para a tela (nunca devolve token). Melhor esforço: falha vira "indisponível", não derruba o Lote. */
export async function getGoogleSmsStatus(auth) {
  const userId = auth?.profile?.id;
  const configured = isGoogleContactsConfigured();
  if (!userId) return googleSmsConnectionState(null, configured);
  try {
    return googleSmsConnectionState(await readConnection(userId), configured);
  } catch (error) {
    console.warn("Lote de SMS: estado do Google Contatos indisponível:", error?.message || error);
    return googleSmsConnectionState(null, configured);
  }
}

async function peopleCall(accessToken, path, init = {}) {
  const response = await fetch(`${PEOPLE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Erro ${response.status} do Google.`;
    if (isGoogleAuthorizationError(response.status, `${payload?.error?.status || ""} ${message}`)) throw new GoogleSmsError("A permissão do Google acabou. Reconecte seu Google Contatos.", 409, GOOGLE_SMS_CODE.RECONNECT);
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

function checkTable(result) {
  if (result.error) {
    if (isMissingTable(result.error)) throw new GoogleSmsError("Falta liberar a tabela do Google Contatos no banco (migration pendente).", 409, GOOGLE_SMS_CODE.TABLE_MISSING);
    throw result.error;
  }
  return result.data;
}

/**
 * Salva, na conta Google do PRÓPRIO usuário (`auth.profile.id`), os contatos da lista atual (`items` = saída de loadSmsBatch com
 * includePhones; escopo do lote e regra do Wi-Fi já aplicados por quem chamou). Idempotente por usuário + contato (PK composta,
 * reivindicada ANTES de chamar o Google — dois toques seguidos não duplicam). Erro de um contato não derruba os demais.
 */
export async function saveSmsContactsToGoogle(auth, items = []) {
  const userId = auth?.profile?.id;
  if (!userId) throw new GoogleSmsError("Usuário sem perfil para salvar contatos.", 403);
  if (!isGoogleContactsConfigured()) throw new GoogleSmsError("O Google Contatos ainda não está configurado no servidor.", 409, GOOGLE_SMS_CODE.NOT_CONFIGURED);
  const state = googleSmsConnectionState(await readConnection(userId), true);
  if (state.needsReconnect) throw new GoogleSmsError("Sua conexão com o Google Contatos expirou. Reconecte.", 409, GOOGLE_SMS_CODE.RECONNECT);
  if (!state.connected) throw new GoogleSmsError("Conecte seu Google Contatos para salvar a lista.", 409, GOOGLE_SMS_CODE.NOT_CONNECTED);

  const client = db();
  const ids = [...new Set(items.map((item) => String(item?.id || "")).filter(Boolean))];
  const existing = ids.length ? checkTable(await client.from(TABLE).select("contact_id, resource_name, created_at").eq("user_id", userId).in("contact_id", ids)) || [] : [];
  // Reivindicação antiga e nunca concluída (processo caiu no meio) é refeita; a recente é de outro toque em andamento.
  const stale = existing.filter((row) => isStaleClaim(row));
  if (stale.length) checkTable(await client.from(TABLE).delete().eq("user_id", userId).in("contact_id", stale.map((row) => row.contact_id)).is("resource_name", null));
  const blocked = new Set(existing.filter((row) => !stale.includes(row)).map((row) => row.contact_id));
  const plan = planGoogleSmsContacts(items, blocked);
  const result = { created: 0, alreadySaved: plan.alreadySaved, invalid: plan.invalid, failed: [] };

  if (plan.toCreate.length) {
    // Token de acesso pelo helper existente (renova pelo refresh token; revogado/expirado marca a conexão com erro).
    const token = await getValidAccessToken(userId);
    if (!token.ok) {
      const [message, status, code] = TOKEN_PROBLEM[token.reason] || ["O Google não respondeu agora. Tente de novo em instantes.", 502, ""];
      throw new GoogleSmsError(message, status, code);
    }
    const accessToken = token.accessToken;
    const group = await ensureGroup(accessToken);
    for (const part of chunkList(plan.toCreate)) {
      // Reivindica atomicamente: só cria no Google quem este toque conseguiu inserir (ON CONFLICT DO NOTHING).
      const claimed = new Set((checkTable(await client.from(TABLE).upsert(part.map((contact) => ({ user_id: userId, contact_id: contact.id })), { onConflict: "user_id,contact_id", ignoreDuplicates: true }).select("contact_id")) || []).map((row) => row.contact_id));
      result.alreadySaved += part.length - claimed.size;
      const mine = part.filter((contact) => claimed.has(contact.id));
      if (!mine.length) continue;
      const release = async (contactIds) => {
        if (contactIds.length) await client.from(TABLE).delete().eq("user_id", userId).in("contact_id", contactIds).is("resource_name", null);
      };
      try {
        const payload = await peopleCall(accessToken, "/people:batchCreateContacts", { method: "POST", body: JSON.stringify(buildBatchCreateBody(mine, group)) });
        const parsed = parseBatchCreateResponse(mine, payload);
        for (const row of parsed.created) {
          const { error } = await client.from(TABLE).update({ resource_name: row.resourceName }).eq("user_id", userId).eq("contact_id", row.id);
          if (error) console.error("Lote de SMS: contato criado no Google mas não registrado:", error.message || error);
        }
        await release(parsed.failed.map((row) => row.id));
        result.created += parsed.created.length;
        result.failed.push(...parsed.failed);
      } catch (error) {
        await release(mine.map((contact) => contact.id));
        if (error?.code === GOOGLE_SMS_CODE.RECONNECT) {
          // Mesmo tratamento do Google Contatos da Meta Diária: permissão ausente/revogada marca a conexão com erro ("Requer reconexão").
          await client.from("google_contacts_connections").update({ status: "error", last_error: "Permissão de Contatos ausente. Reconecte a conta Google e libere o acesso aos contatos.", updated_at: new Date().toISOString() }).eq("broker_id", userId);
          throw error;
        }
        result.failed.push(...mine.map((contact) => ({ id: contact.id, name: contact.name, error: cleanGoogleError(error?.message) })));
      }
    }
  }
  return { ...result, failedCount: result.failed.length, message: describeGoogleSmsResult({ created: result.created, alreadySaved: result.alreadySaved, failed: result.failed.length }) };
}
