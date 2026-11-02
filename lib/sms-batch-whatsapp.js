import "server-only";
import { checkIndividualNumber, listIndividualSessionRowsByUser } from "./whatsapp-individual";
import { isGeneralAdminProfile, isOwnerAdminEmail } from "./admin-profiles";
import { WA_CHECK_TTL_DAYS, maskSmsPhone, pickWaCheckSession } from "./sms-batch-core.mjs";
import { WA_UNAVAILABLE, createWaCheckContext, markWaUnavailable } from "./sms-batch-wa-check.mjs";
import { phoneLookupCandidates, toBrazilianE164 } from "./phone-utils";

// Checagem de WhatsApp do Lote de SMS (dono, 2026-11-02) — ligação com o banco e com o whatsapp-individual-service.
// Regras e orquestração: lib/sms-batch-core.mjs e lib/sms-batch-wa-check.mjs. Só CONSULTA (rota check-number do serviço,
// Baileys onWhatsApp); nada é enviado, nenhum cliente/contato é alterado. Tabela: sms_batch_wa_checks (migration
// 20261102190000_sms_batch_wa_checks.sql) — cache de 30 dias, RLS ligado sem policy pública.

export const WA_CHECKS_TABLE = "sms_batch_wa_checks";
const isMissingTable = (error) => error?.code === "42P01" || error?.code === "PGRST205";
const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));

// Sessão conectada do dono (ou de outro admin geral) que faz a consulta. null = nenhuma conectada.
async function findCheckSession(client) {
  const { data, error } = await client.from("admin_users").select("id, email, role, status");
  if (error) throw error;
  const admins = (data || []).filter((row) => row.status !== "inactive" && isGeneralAdminProfile(row));
  if (!admins.length) return null;
  const byUser = await listIndividualSessionRowsByUser(admins.map((row) => row.id));
  return pickWaCheckSession(admins.map((row) => ({ userId: row.id, isOwner: isOwnerAdminEmail(row.email), rows: byUser.get(row.id) || [] })));
}

// Contexto de UMA rodada de checagem. Nunca lança: qualquer falha vira "indisponível" (a lista sai como antes).
export async function openWaCheck(client, { enabled = true } = {}) {
  const deps = {
    check: async (session, phone) => (await checkIndividualNumber(session.userId, { to: String(toBrazilianE164(phone) || phone).replace(/\D/g, ""), slot: session.slot })).exists,
    save: async (phone, hasWhatsapp) => {
      const { error } = await client.from(WA_CHECKS_TABLE).upsert({ phone_normalized: phone, has_whatsapp: hasWhatsapp, checked_at: new Date().toISOString() }, { onConflict: "phone_normalized" });
      if (error) throw error;
    }
  };
  if (!enabled) return createWaCheckContext({ session: null, deps, unavailable: WA_UNAVAILABLE.NO_SESSION });
  try {
    return createWaCheckContext({ session: await findCheckSession(client), deps });
  } catch (error) {
    console.warn("Lote de SMS: sessão para checar o WhatsApp não encontrada:", error?.message || error);
    return createWaCheckContext({ session: null, deps, unavailable: WA_UNAVAILABLE.SERVICE });
  }
}

// Linhas da cache dos telefones (qualquer forma de gravação); quem decide a validade é resolveWaCache (30 dias). Tabela ausente ou erro:
// marca o contexto como indisponível e devolve vazio (nada é bloqueado). `ctx` opcional (markSmsSent não consulta nada novo).
export async function loadWaCacheRows(client, phones, ctx = null) {
  const lookup = [...new Set(phones.flatMap((phone) => phoneLookupCandidates(phone)))];
  const rows = [];
  try {
    for (const part of chunk(lookup, 300)) {
      const { data, error } = await client.from(WA_CHECKS_TABLE).select("phone_normalized, has_whatsapp, checked_at").in("phone_normalized", part);
      if (error) throw error;
      rows.push(...(data || []));
    }
  } catch (error) {
    if (ctx) markWaUnavailable(ctx, isMissingTable(error) ? WA_UNAVAILABLE.NO_TABLE : WA_UNAVAILABLE.SERVICE);
    if (!isMissingTable(error)) console.warn("Lote de SMS: leitura da checagem de WhatsApp falhou:", error?.message || error);
    return [];
  }
  return rows;
}

// Aba "Sem WhatsApp" (só leitura): quem a checagem apontou sem conta nos últimos 30 dias. Nome vem do contato da base.
export async function listNoWhatsapp(client, { limit = 200 } = {}) {
  const since = new Date(Date.now() - WA_CHECK_TTL_DAYS * 86400000).toISOString();
  const { data, error, count } = await client.from(WA_CHECKS_TABLE).select("phone_normalized, checked_at", { count: "exact" }).eq("has_whatsapp", false).gte("checked_at", since).order("checked_at", { ascending: false }).limit(limit);
  if (error) {
    if (!isMissingTable(error)) console.warn("Lote de SMS: lista 'Sem WhatsApp' falhou:", error?.message || error);
    return { available: false, total: 0, items: [] };
  }
  const rows = data || [];
  const names = new Map();
  for (const part of chunk(rows.map((row) => row.phone_normalized), 200)) {
    const { data: contacts, error: contactsError } = await client.from("prospecting_contacts").select("name, phone_normalized").in("phone_normalized", part);
    if (contactsError) {
      console.warn("Lote de SMS: nomes da aba 'Sem WhatsApp' não carregaram:", contactsError.message);
      return { available: false, total: 0, items: [] };
    }
    for (const contact of contacts || []) if (!names.has(contact.phone_normalized)) names.set(contact.phone_normalized, contact.name || "");
  }
  return {
    available: true,
    total: count ?? rows.length,
    items: rows.map((row) => ({ id: row.phone_normalized, name: names.get(row.phone_normalized) || "", phoneMasked: maskSmsPhone(row.phone_normalized), checkedAt: row.checked_at }))
  };
}
