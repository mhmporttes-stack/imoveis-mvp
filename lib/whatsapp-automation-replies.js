import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { buildBrokerSimulationLink, getAdminProfileById, getSiteBaseUrl } from "./admin-profiles";
import { canonicalWhatsappPhone, phoneLookupCandidates } from "./phone-utils";
import { keywordMatchesMessage } from "./whatsapp-keyword-match.mjs";

// Regras de resposta automática do WhatsApp Master: se o texto que o cliente
// manda contém a palavra-chave (como palavra inteira — "sim" não casa com
// "simulação") de alguma regra ativa, o sistema responde com
// a mensagem configurada e, se a regra pedir, já encaminha o contato pra
// roleta (mesmo mecanismo de distribuição round-robin usado em qualquer
// outro lugar do CRM — nunca uma fila paralela). Palavra-chave e texto de
// resposta são sempre editáveis pela tela; "sim"/"não" da semente inicial
// (migration) não têm nenhum significado especial no código.

function db() {
  return getSupabaseAdminClient();
}

function rowToRule(row) {
  return {
    id: row.id,
    keyword: row.keyword,
    responseMessage: row.response_message,
    forwardToRoleta: Boolean(row.forward_to_roleta),
    active: Boolean(row.active),
    displayOrder: row.display_order,
    triggeredCount: row.triggered_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listWhatsappAutomationReplies() {
  const { data, error } = await db()
    .from("whatsapp_automation_replies")
    .select("*")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToRule);
}

function cleanKeyword(value) {
  const text = String(value || "").trim().slice(0, 120);
  if (!text) throw new Error("Informe a palavra-chave da regra.");
  return text;
}

function cleanResponseMessage(value) {
  const text = String(value || "").trim().slice(0, 1000);
  if (!text) throw new Error("Informe a mensagem de resposta da regra.");
  return text;
}

export async function createWhatsappAutomationReply(payload, auth) {
  assertGeneralAdminOrManager(auth);
  const { data: maxRow } = await db().from("whatsapp_automation_replies").select("display_order").order("display_order", { ascending: false }).limit(1).maybeSingle();

  const { data, error } = await db().from("whatsapp_automation_replies").insert({
    keyword: cleanKeyword(payload.keyword),
    response_message: cleanResponseMessage(payload.responseMessage),
    forward_to_roleta: Boolean(payload.forwardToRoleta),
    active: payload.active === undefined ? true : Boolean(payload.active),
    display_order: (maxRow?.display_order ?? 0) + 1,
    created_by: auth?.profile?.id || null
  }).select("*").single();
  if (error) throw error;
  return rowToRule(data);
}

export async function updateWhatsappAutomationReply(id, payload, auth) {
  assertGeneralAdminOrManager(auth);
  const updates = {};
  if (payload.keyword !== undefined) updates.keyword = cleanKeyword(payload.keyword);
  if (payload.responseMessage !== undefined) updates.response_message = cleanResponseMessage(payload.responseMessage);
  if (payload.forwardToRoleta !== undefined) updates.forward_to_roleta = Boolean(payload.forwardToRoleta);
  if (payload.active !== undefined) updates.active = Boolean(payload.active);
  if (payload.displayOrder !== undefined) updates.display_order = Number(payload.displayOrder) || 0;

  const { data, error } = await db().from("whatsapp_automation_replies").update(updates).eq("id", id).select("*").single();
  if (error) throw error;
  return rowToRule(data);
}

export async function deleteWhatsappAutomationReply(id, auth) {
  assertGeneralAdminOrManager(auth);
  const { error } = await db().from("whatsapp_automation_replies").delete().eq("id", id);
  if (error) throw error;
  return { deleted: true };
}

// A primeira regra ativa (por display_order) cuja palavra-chave aparece como
// PALAVRA INTEIRA no texto recebido vence — "sim, quero!" bate com "sim", mas
// "simulação" não (comparação em lib/whatsapp-keyword-match.mjs).
export async function matchAutomationReply(messageText) {
  const { data, error } = await db()
    .from("whatsapp_automation_replies")
    .select("*")
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (error) throw error;

  for (const row of data || []) {
    if (keywordMatchesMessage(messageText, row.keyword)) return rowToRule(row);
  }
  return null;
}

export async function incrementAutomationReplyTriggerCount(id) {
  const { error } = await db().rpc("increment_whatsapp_automation_reply_count", { p_id: id });
  if (error) throw error;
}

// Encaminha uma resposta positiva de Disparo pra roleta: se o telefone já é
// cliente (em QUALQUER formato do número, com ou sem o 9º dígito), não cria
// duplicata nem reatribui sozinho (evita arrancar o cliente de quem já está
// atendendo ele) — só materializa um cadastro novo quando o telefone é realmente
// desconhecido do CRM, exatamente como um corretor entrando pela fila "equipe" no
// formulário público faz.
//
// A verificação "já existe?", a escolha do corretor da roleta e o INSERT do
// cliente acontecem numa ÚNICA função do banco (whatsapp_get_or_create_roulette_client),
// serializada por telefone: dois "sim" simultâneos do mesmo número criam UM cliente,
// e uma falha no insert não queima a vez de ninguém na fila.
//
// acquisition_context é lido pelo trigger de banco capture_client_journey no
// INSERT (mesmo mecanismo de todo cadastro novo) — grava a origem em
// client_origins e já registra o evento "created" na timeline sozinho; não
// duplicar isso com um logClientJourneyEvent manual aqui.
export async function materializeClientFromAutomationReply({ phone, name }) {
  const canonical = canonicalWhatsappPhone(phone);
  if (!canonical) return { registrationId: null, brokerProfile: null, alreadyExisted: false };

  const fullName = String(name || "").trim().slice(0, 160) || "Cliente WhatsApp";
  const { data, error } = await db().rpc("whatsapp_get_or_create_roulette_client", {
    p_candidates: phoneLookupCandidates(canonical),
    p_full_name: fullName,
    p_phone: canonical,
    p_phone_normalized: canonical,
    p_context: {
      kind: "whatsapp_reply",
      label: "Resposta automática de Disparo (WhatsApp)",
      actor: "sistema",
      destination: "roulette"
    }
  });
  if (error) throw error;

  const result = data || {};
  if (!result.registration_id) return { registrationId: null, brokerProfile: null, alreadyExisted: Boolean(result.already_existed) };
  if (result.already_existed) return { registrationId: result.registration_id, brokerProfile: null, alreadyExisted: true };

  const brokerProfile = result.broker_id ? await getAdminProfileById(result.broker_id) : null;
  return { registrationId: result.registration_id, brokerProfile, alreadyExisted: false };
}

// Substitui {{link_simulacao}} na resposta configurada: se a regra encaminhou
// o contato pra um corretor agora, usa o link PESSOAL desse corretor (o
// cliente cai consistentemente no mesmo corretor se abrir o link depois);
// senão usa o link público genérico.
export function buildAutomationResponseText(template, { brokerProfile } = {}) {
  const link = brokerProfile ? buildBrokerSimulationLink(brokerProfile) : `${getSiteBaseUrl()}/simulacao`;
  return String(template || "").replaceAll("{{link_simulacao}}", link);
}
