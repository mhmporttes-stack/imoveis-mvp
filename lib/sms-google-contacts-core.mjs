import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { toBrazilianE164 } from "./phone-utils.js";
import { smsContactName } from "./sms-batch-core.mjs";

// Lote de SMS -> Google Contatos (dono, 2026-11-03, PRO-18g). Regras PURAS (sem rede, sem banco, sem "server-only"): config por
// variáveis de ambiente, state anti-CSRF do OAuth, corpo do people:batchCreateContacts e planejamento idempotente. A cola com
// o Google e o banco fica em lib/sms-google-contacts.js. Telefone e nome só trafegam servidor -> Google, nunca em link/GET.

export const GOOGLE_SMS_SETTING_ID = "google_contacts_connection";
export const GOOGLE_SMS_SCOPE = "https://www.googleapis.com/auth/contacts";
export const GOOGLE_SMS_GROUP_NAME = "SMS lote";
export const GOOGLE_SMS_BATCH_SIZE = 50; // a API aceita até 200 por chamada; 50 = o lote do dia
export const GOOGLE_SMS_CALLBACK_PATH = "/api/admin/google-contacts/callback";
export const GOOGLE_SMS_STATE_MAX_AGE_MS = 10 * 60 * 1000;
export const GOOGLE_SMS_CLAIM_STALE_MS = 10 * 60 * 1000;

export const GOOGLE_SMS_CODE = {
  NOT_CONFIGURED: "GOOGLE_CONTACTS_NOT_CONFIGURED",
  NOT_CONNECTED: "GOOGLE_CONTACTS_NOT_CONNECTED",
  RECONNECT: "GOOGLE_CONTACTS_RECONNECT",
  TABLE_MISSING: "GOOGLE_CONTACTS_TABLE_MISSING"
};

// Credenciais próprias desta integração (o dono as cria no Google Cloud). Nunca devolva estes valores ao navegador nem ao log.
export function readGoogleSmsConfig(env = process.env) {
  const clientId = String(env.GOOGLE_CONTACTS_CLIENT_ID || "").trim();
  const clientSecret = String(env.GOOGLE_CONTACTS_CLIENT_SECRET || "").trim();
  const encryptionKeyOk = Buffer.from(String(env.CRM_SECRETS_ENCRYPTION_KEY || ""), "hex").length === 32;
  const missing = [];
  if (!clientId) missing.push("GOOGLE_CONTACTS_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CONTACTS_CLIENT_SECRET");
  if (!encryptionKeyOk) missing.push("CRM_SECRETS_ENCRYPTION_KEY");
  return { configured: missing.length === 0, missing, clientId, clientSecret };
}

// Padrão: <site>/api/admin/google-contacts/callback. GOOGLE_CONTACTS_REDIRECT_URI (opcional) só vale se apontar para ESTA rota:
// a variável com o mesmo nome também é usada pela integração por corretor (/api/google-contacts/callback) e não pode confundir.
export function resolveGoogleSmsRedirectUri(siteBaseUrl, override = "") {
  const custom = String(override || "").trim();
  if (custom) {
    try {
      const url = new URL(custom);
      if (url.pathname.replace(/\/+$/, "") === GOOGLE_SMS_CALLBACK_PATH) return custom;
    } catch {
      // URL inválida: cai no padrão.
    }
  }
  return `${String(siteBaseUrl || "").replace(/\/+$/, "")}${GOOGLE_SMS_CALLBACK_PATH}`;
}

// ---- state anti-CSRF (assinado, preso ao admin que iniciou, vale 10 min) -----------------------------------------------

const stateKey = (secret) => createHash("sha256").update(`google-contacts-sms-state:${secret}`).digest();
const sign = (payload, secret) => createHmac("sha256", stateKey(secret)).update(payload).digest("hex");

export function signGoogleSmsState({ userId, secret, now = Date.now(), nonce = "" }) {
  if (!userId || !secret) throw new Error("State do Google sem usuário ou segredo.");
  const payload = `${userId}.${now}.${nonce || randomBytes(8).toString("hex")}`;
  return Buffer.from(`${payload}.${sign(payload, secret)}`).toString("base64url");
}

/** true só se a assinatura confere, o state é do MESMO usuário logado e ainda está no prazo. */
export function verifyGoogleSmsState(state, { userId, secret, now = Date.now(), maxAgeMs = GOOGLE_SMS_STATE_MAX_AGE_MS }) {
  try {
    if (!state || !userId || !secret) return false;
    const parts = Buffer.from(String(state), "base64url").toString("utf8").split(".");
    if (parts.length !== 4) return false;
    const [stateUser, issuedAt, nonce, signature] = parts;
    const expected = Buffer.from(sign(`${stateUser}.${issuedAt}.${nonce}`, secret));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    if (stateUser !== userId) return false;
    const age = now - Number(issuedAt);
    return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
  } catch {
    return false;
  }
}

// ---- Erros do Google ---------------------------------------------------------------------------------------------------

// Token revogado/expirado ou permissão faltando: só se resolve reconectando a conta.
export function isGoogleSmsAuthError(status, message = "") {
  const text = String(message || "");
  if (Number(status) === 401) return true;
  return /invalid_grant|insufficient (authentication )?scopes?|permission_denied|unauthenticated/i.test(text);
}

export function cleanGoogleError(message) {
  return String(message || "Erro do Google").replace(/\s+/g, " ").trim().slice(0, 140);
}

// ---- Planejamento e corpo do batchCreate -------------------------------------------------------------------------------

/** Itens da lista -> contatos a salvar. Sem telefone válido: fica de fora (`invalid`). Repetido na lista: conta uma vez. */
export function planGoogleSmsContacts(items = [], alreadySavedIds = new Set()) {
  const saved = alreadySavedIds instanceof Set ? alreadySavedIds : new Set(alreadySavedIds);
  const seen = new Set();
  const toCreate = [];
  let alreadySaved = 0;
  let invalid = 0;
  for (const item of items) {
    const id = String(item?.id || "");
    const phone = toBrazilianE164(item?.phone);
    if (!id || !phone) {
      invalid += 1;
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    if (saved.has(id)) {
      alreadySaved += 1;
      continue;
    }
    toCreate.push({ id, name: smsContactName(item.name), phone });
  }
  return { toCreate, alreadySaved, invalid };
}

export function chunkList(list, size = GOOGLE_SMS_BATCH_SIZE) {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));
}

/** Corpo do `people:batchCreateContacts` (mesma ordem de `contacts`; a resposta volta nessa ordem). */
export function buildBatchCreateBody(contacts, groupResourceName = "") {
  return {
    contacts: contacts.map((contact) => ({
      contactPerson: {
        names: [{ givenName: contact.name }],
        phoneNumbers: [{ value: contact.phone, type: "mobile" }],
        ...(groupResourceName ? { memberships: [{ contactGroupMembership: { contactGroupResourceName: groupResourceName } }] } : {})
      }
    })),
    readMask: "names,phoneNumbers"
  };
}

/** Resposta do batchCreate -> { created: [{id, resourceName}], failed: [{id, name, error}] }, casando por posição. */
export function parseBatchCreateResponse(contacts, payload) {
  const rows = Array.isArray(payload?.createdPeople) ? payload.createdPeople : [];
  const created = [];
  const failed = [];
  contacts.forEach((contact, index) => {
    const row = rows[index];
    const resourceName = row?.person?.resourceName || "";
    if (resourceName) created.push({ id: contact.id, resourceName });
    else failed.push({ id: contact.id, name: contact.name, error: cleanGoogleError(row?.status?.message || "O Google não confirmou este contato.") });
  });
  return { created, failed };
}

/** Reivindicação antiga e nunca concluída (o processo caiu no meio): pode ser refeita. */
export function isStaleClaim(row, now = Date.now(), staleMs = GOOGLE_SMS_CLAIM_STALE_MS) {
  return !row?.resource_name && now - new Date(row?.created_at || 0).getTime() > staleMs;
}

/** Texto do resumo para a tela (singular/plural). */
export function describeGoogleSmsResult({ created = 0, alreadySaved = 0, failed = 0 } = {}) {
  const parts = [];
  if (created) parts.push(`${created} ${created === 1 ? "contato salvo" : "contatos salvos"}`);
  if (alreadySaved) parts.push(`${alreadySaved} já ${alreadySaved === 1 ? "estava salvo" : "estavam salvos"}`);
  if (failed) parts.push(`${failed} ${failed === 1 ? "não foi salvo" : "não foram salvos"}`);
  if (!parts.length) return "Nenhum contato para salvar.";
  return `${parts.join(" · ")}.${created ? " Em alguns minutos aparecem no iPhone." : ""}`;
}
