// Lote de SMS: link único por contato (dono, 2026-11-03, PRO-18f) — geração do token (servidor) e acesso à tabela
// sms_batch_links. Só usa o client do Supabase recebido (testado com banco falso em tests/sms-batch-links.test.mjs).
// Tolerância: sem a tabela (migration 20261103120000 pendente) as gravações viram "pulado" e as leituras voltam vazias — o Lote
// funciona como antes. Qualquer OUTRO erro do banco sobe (quem chama decide; nada é engolido aqui).
import { createHmac } from "node:crypto";
import { SMS_TOKEN_LENGTH, cleanSmsToken } from "./sms-batch-token-core.mjs";

export const SMS_LINKS_TABLE = "sms_batch_links";
const CHUNK = 200;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));

export function isMissingLinksTable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

// Segredo do servidor que já existe (mesmo padrão de lib/supervision-messages.js); nunca vai ao cliente.
export function smsLinkSecret(env = process.env) {
  return env?.SUPABASE_SERVICE_ROLE_KEY || "";
}

// Token determinístico do contato (HMAC-SHA256 do id, 10 caracteres base32). Sem segredo ou sem id: "" (link segue sem token).
export function smsTokenForContact(contactId, secret = smsLinkSecret()) {
  const id = String(contactId || "").trim();
  if (!id || !secret) return "";
  const digest = createHmac("sha256", String(secret)).update(`sms-batch-link:v1:${id}`).digest();
  let token = "";
  for (let index = 0; index < SMS_TOKEN_LENGTH; index += 1) token += BASE32[digest[index] % 32];
  return token;
}

// Lê o resultado: tabela ausente => null com `missing`; outro erro sobe.
function read(result) {
  if (result.error) {
    if (isMissingLinksTable(result.error)) return { missing: true, data: null };
    throw result.error;
  }
  return { missing: false, data: result.data };
}

/**
 * Chamado quando o envio é GRAVADO (markSmsSent). Idempotente: cria a linha do token; se já existe para o MESMO contato,
 * só atualiza campanha/quem enviou/telefone (cliques e cadastro ficam como estão); se o token já é de OUTRO contato
 * (colisão de 50 bits, improvável) não sobrescreve. Devolve { status: "created" | "updated" | "kept" | "collision" | "skipped" }.
 */
export async function recordSmsLink(client, { token, contactId, phone, campaignId = null, sentBy = null, now = new Date() } = {}) {
  const clean = cleanSmsToken(token);
  if (!clean || !contactId || !phone) return { status: "skipped" };
  const found = read(await client.from(SMS_LINKS_TABLE).select("token, contact_id, campaign_id, sent_by, phone_normalized").eq("token", clean).maybeSingle());
  if (found.missing) return { status: "skipped" };
  const row = found.data;
  if (!row) {
    const inserted = read(await client.from(SMS_LINKS_TABLE).insert({ token: clean, contact_id: contactId, phone_normalized: phone, campaign_id: campaignId, sent_by: sentBy, created_at: now.toISOString() }));
    return { status: inserted.missing ? "skipped" : "created" };
  }
  if (row.contact_id && row.contact_id !== contactId) return { status: "collision" };
  if (row.campaign_id === campaignId && row.sent_by === sentBy && row.phone_normalized === phone) return { status: "kept" };
  read(await client.from(SMS_LINKS_TABLE).update({ contact_id: contactId, phone_normalized: phone, campaign_id: campaignId, sent_by: sentBy }).eq("token", clean));
  return { status: "updated" };
}

/**
 * Clique no link do contato (formulário aberto no navegador, via /api/campaigns/track-view). Token inválido, desconhecido ou
 * tabela ausente: não faz nada e não dá erro. Devolve { counted: boolean }. A contagem é lida-e-gravada com trava otimista
 * em click_count (uma repetição) para não perder cliques simultâneos.
 */
export async function recordSmsLinkClick(client, token, now = new Date()) {
  const clean = cleanSmsToken(token);
  if (!clean) return { counted: false };
  const nowIso = now.toISOString();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const found = read(await client.from(SMS_LINKS_TABLE).select("token, click_count, first_clicked_at").eq("token", clean).maybeSingle());
    if (found.missing || !found.data) return { counted: false };
    const current = Number(found.data.click_count) || 0;
    const patch = { click_count: current + 1, last_clicked_at: nowIso, ...(found.data.first_clicked_at ? {} : { first_clicked_at: nowIso }) };
    const updated = read(await client.from(SMS_LINKS_TABLE).update(patch).eq("token", clean).eq("click_count", current).select("token"));
    if (updated.missing) return { counted: false };
    if ((updated.data || []).length) return { counted: true, clickCount: current + 1 };
  }
  return { counted: false };
}

/**
 * Cadastro de cliente que veio por este token: liga o cliente à linha (só a primeira vez — não reatribui nada). Token
 * desconhecido/tabela ausente: não faz nada. Devolve { linked: boolean }.
 */
export async function linkSmsRegistration(client, token, registrationId, now = new Date(), campaignId = "") {
  const clean = cleanSmsToken(token);
  if (!clean || !registrationId) return { linked: false };
  // Só liga se o cadastro veio pela MESMA campanha do SMS (um token velho no cookie não vira cadastro de outro link).
  let query = client.from(SMS_LINKS_TABLE).update({ registration_id: registrationId, registered_at: now.toISOString() }).eq("token", clean).is("registration_id", null);
  if (campaignId) query = query.eq("campaign_id", campaignId);
  const updated = read(await query.select("token"));
  return { linked: Boolean(updated.data?.length) };
}

/**
 * Contato do token para o formulário curto (PRO-18h): { name, phone } (nome da base + telefone para o qual o SMS foi enviado) ou
 * null (token inválido/desconhecido, tabela ausente, contato apagado). SERVIDOR apenas: o resultado completo nunca vai ao
 * navegador (a rota pública devolve só `smsContactView`).
 */
export async function readSmsContact(client, token) {
  const clean = cleanSmsToken(token);
  if (!clean) return null;
  const link = read(await client.from(SMS_LINKS_TABLE).select("contact_id, phone_normalized").eq("token", clean).maybeSingle());
  if (link.missing || !link.data?.contact_id) return null;
  const contact = (await client.from("prospecting_contacts").select("name").eq("id", link.data.contact_id).maybeSingle());
  if (contact.error) throw contact.error;
  if (!contact.data) return null;
  return { name: contact.data.name || "", phone: link.data.phone_normalized || "" };
}

/** Quem clicou: linhas com ao menos 1 clique nas campanhas informadas (mais recente primeiro). Tabela ausente: []. */
export async function listSmsClickers(client, campaignIds = []) {
  const ids = [...new Set(campaignIds.filter(Boolean))];
  if (!ids.length) return [];
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = read(await client.from(SMS_LINKS_TABLE).select("token, contact_id, phone_normalized, campaign_id, first_clicked_at, last_clicked_at, click_count, registration_id, registered_at").in("campaign_id", ids).gt("click_count", 0).order("last_clicked_at", { ascending: false }).range(from, from + 999));
    if (page.missing) return [];
    rows.push(...(page.data || []));
    if (!page.data || page.data.length < 1000) break;
  }
  return rows;
}

/** Linhas ligadas a cadastros de cliente: Map(registration_id -> linha). Tabela ausente: Map vazio. */
export async function listSmsLinksByRegistration(client, registrationIds = []) {
  const map = new Map();
  for (const part of chunk([...new Set(registrationIds.filter(Boolean))], CHUNK)) {
    const result = read(await client.from(SMS_LINKS_TABLE).select("token, contact_id, phone_normalized, registration_id").in("registration_id", part));
    if (result.missing) return new Map();
    for (const row of result.data || []) map.set(row.registration_id, row);
  }
  return map;
}
