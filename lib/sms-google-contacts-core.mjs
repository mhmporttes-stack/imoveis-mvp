import { toBrazilianE164 } from "./phone-utils.js";
import { smsContactName } from "./sms-batch-core.mjs";
import { hasContactsScope } from "./google-contacts-config-core.mjs";

// Lote de SMS -> Google Contatos do PRÓPRIO usuário (dono, 2026-11-03, PRO-18g). Usa a conexão Google Contatos que cada usuário
// já tem (lib/google-contacts.js, tabela google_contacts_connections). Regras PURAS (sem rede, sem banco, sem "server-only"):
// estado da conexão, corpo do people:batchCreateContacts e planejamento idempotente. A cola com o Google e o banco fica em
// lib/sms-google-contacts.js. Nome e telefone só trafegam servidor -> Google, nunca em link/GET.

export const GOOGLE_SMS_GROUP_NAME = "SMS lote";
export const GOOGLE_SMS_BATCH_SIZE = 50; // a API aceita até 200 por chamada; 50 = o lote do dia
export const GOOGLE_SMS_CLAIM_STALE_MS = 10 * 60 * 1000;

export const GOOGLE_SMS_CODE = {
  NOT_CONFIGURED: "GOOGLE_CONTACTS_NOT_CONFIGURED",
  NOT_CONNECTED: "GOOGLE_CONTACTS_NOT_CONNECTED",
  RECONNECT: "GOOGLE_CONTACTS_RECONNECT",
  TABLE_MISSING: "GOOGLE_CONTACTS_TABLE_MISSING"
};

/**
 * Estado da conexão do usuário (linha de google_contacts_connections) para a tela e para a ação.
 * connected = conectada, com sync ligado, token guardado e escopo de Contatos; needsReconnect = existe mas precisa refazer
 * (erro/expirada/sem permissão de Contatos). Sem linha ou desconectada: nenhum dos dois (tela pede "Conecte seu Google Contatos").
 */
export function googleSmsConnectionState(row, configured = true) {
  const hasToken = Boolean(row?.encrypted_refresh_token);
  const scopeOk = hasContactsScope(row?.scopes);
  const connected = Boolean(configured && hasToken && row.status === "connected" && row.sync_enabled && scopeOk);
  const needsReconnect = Boolean(hasToken && !connected && (row.status === "error" || row.status === "expired" || (row.status === "connected" && !scopeOk)));
  return { configured: Boolean(configured), connected, needsReconnect };
}

export function cleanGoogleError(message) {
  return String(message || "Erro do Google").replace(/\s+/g, " ").trim().slice(0, 140);
}

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
