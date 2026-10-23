import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { isResponsibleSideConversation } from "./chat-contact-signal-core.mjs";
import { loadAssociateBrokerMap } from "./chat-contact-signal";
import {
  ATTENDANCE_JOURNEY_EVENTS,
  collectLatest,
  isPersonJourneyEvent,
  isPersonSimulation,
  isPersonStatusChange,
  marketplaceReplyTimes
} from "./client-attendance-core.mjs";

// Último atendimento do cliente dentro de uma janela (regra do dono de 2026-10-16 e lista de sinais em
// lib/client-attendance-core.mjs). SÓ LEITURA: junta registros que já existem; nada é gravado no cliente.
// Quem usa: lista de Clientes (card, filtros "Pendentes"/"Sem contato há +3 dias", contadores), Desempenho
// (contadores de pendentes/sem contato), congelamento dos pendentes da Meta Diária e casos novos de cliente esfriado.
// NÃO é usado na baixa da pendência do dia (evaluateDailyGoalPending usa só loadPersonStatusChangeByClient abaixo).

const CHUNK = 150;
const PAGE = 1000;

function getDb(supabase) {
  const db = supabase || getSupabaseAdminClient();
  if (!db) throw new Error("Supabase administrativo não configurado.");
  return db;
}

// Lê todas as páginas; com `clientIds`, em lotes por cliente.
async function readAll(db, build, clientIds, clientColumn) {
  const rows = [];
  const parts = clientIds ? [] : [null];
  if (clientIds) for (let index = 0; index < clientIds.length; index += CHUNK) parts.push(clientIds.slice(index, index + CHUNK));
  for (const part of parts) {
    for (let from = 0; ; from += PAGE) {
      let query = build(db);
      if (part) query = query.in(clientColumn, part);
      const { data, error } = await query.order("id").range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  }
  return rows;
}

function windowed(query, column, sinceIso, untilIso) {
  const next = query.gte(column, sinceIso);
  return untilIso ? next.lte(column, untilIso) : next;
}

// Chat do Marketplace ainda não criado no banco (migration 20261020180000): sem esse sinal.
function isMissingTable(error) {
  return Boolean(error) && (error.code === "42P01" || error.code === "PGRST205");
}

// [REGRA OFICIAL — dono, 2026-10-22, MKT-2h] Saída do Marketplace que responde ao cliente, depois da entrega da conversa
// (marketplaceReplyTimes). Conversas ligadas a cliente, entregues e com atividade desde sinceIso; as mensagens são lidas
// inteiras (até untilIso) porque a mensagem do cliente que a saída responde pode ser anterior à janela.
async function loadMarketplaceReplies(db, { sinceIso, untilIso, ids }) {
  try {
    const conversations = await readAll(db, (d) => d.from("marketplace_conversations").select("id, client_id, assigned_at").not("client_id", "is", null).not("assigned_at", "is", null).gte("last_message_at", sinceIso), ids, "client_id");
    if (!conversations.length) return [];
    const messages = await readAll(db, (d) => {
      const query = d.from("marketplace_messages").select("id, conversation_id, direction, status, message_at, created_at");
      return untilIso ? query.lte("message_at", untilIso) : query;
    }, conversations.map((row) => row.id), "conversation_id");
    const byConversation = new Map();
    for (const message of messages) {
      if (!byConversation.has(message.conversation_id)) byConversation.set(message.conversation_id, []);
      byConversation.get(message.conversation_id).push(message);
    }
    return conversations.flatMap((conversation) => marketplaceReplyTimes(conversation, byConversation.get(conversation.id) || []).map((at) => ({ clientId: conversation.client_id, at })));
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

// Map(clientId -> ISO do último atendimento entre sinceIso e untilIso). `clientIds` opcional restringe a busca.
export async function loadRecentAttendanceByClient(supabase, { sinceIso, untilIso = null, clientIds = null } = {}) {
  const db = getDb(supabase);
  const ids = clientIds ? [...new Set(clientIds.filter(Boolean))] : null;
  const result = new Map();
  if (ids && !ids.length) return result;
  const range = { sinceMs: Date.parse(sinceIso), untilMs: untilIso ? Date.parse(untilIso) : Infinity };

  const [statusRows, journeyRows, createdActivities, completedActivities, simulations, legacyCompleted, conversations, marketplaceReplies] = await Promise.all([
    // 1) Mudança de status feita por pessoa (qualquer direção).
    readAll(db, (d) => windowed(d.from("client_status_history").select("id, client_id, changed_at, changed_by, source"), "changed_at", sinceIso, untilIso), ids, "client_id"),
    // 2) Ações da pessoa na linha do tempo (etiqueta, dados/observações, atividade, documentos, CCA, apresentação...).
    readAll(db, (d) => windowed(d.from("client_journey_events").select("id, client_id, event_type, occurred_at, actor, actor_role").in("event_type", ATTENDANCE_JOURNEY_EVENTS), "occurred_at", sinceIso, untilIso), ids, "client_id"),
    // 3) Atividade criada por pessoa (agendamento feito pelo próprio cliente pelo link não tem created_by).
    readAll(db, (d) => windowed(d.from("calendar_activities").select("id, client_id, created_at").not("client_id", "is", null).not("created_by", "is", null), "created_at", sinceIso, untilIso), ids, "client_id"),
    // 4) Atividade concluída.
    readAll(db, (d) => windowed(d.from("calendar_activities").select("id, client_id, completed_at").not("client_id", "is", null), "completed_at", sinceIso, untilIso), ids, "client_id"),
    // 5) Simulação criada por pessoa da equipe (created_by = e-mail).
    readAll(db, (d) => windowed(d.from("simulations").select("id, registration_id, created_at, created_by").not("registration_id", "is", null), "created_at", sinceIso, untilIso), ids, "registration_id"),
    // 6) Atividade antiga do card concluída.
    readAll(db, (d) => windowed(d.from("simulation_registrations").select("id, scheduled_activity_completed_at"), "scheduled_activity_completed_at", sinceIso, untilIso), ids, "id"),
    // 7) Mensagem RECEBIDA do cliente no Chat (a enviada pelo responsável já está em last_whatsapp_contact_at).
    readAll(db, (d) => windowed(d.from("whatsapp_conversations").select("id, client_id, session_user_id:account_user_id, last_inbound_at, deleted_at, private_at").not("client_id", "is", null).is("deleted_at", null).is("private_at", null), "last_inbound_at", sinceIso, untilIso), ids, "client_id"),
    // 8) Nossa resposta no Chat do Marketplace, inclusive escrita direto no Facebook (MKT-2h, dono, 2026-10-22).
    loadMarketplaceReplies(db, { sinceIso, untilIso, ids })
  ]);

  for (const row of statusRows) if (isPersonStatusChange(row)) collectLatest(result, row.client_id, row.changed_at, range);
  for (const row of journeyRows) if (isPersonJourneyEvent(row)) collectLatest(result, row.client_id, row.occurred_at, range);
  for (const row of createdActivities) collectLatest(result, row.client_id, row.created_at, range);
  for (const row of completedActivities) collectLatest(result, row.client_id, row.completed_at, range);
  for (const row of simulations) if (isPersonSimulation(row)) collectLatest(result, row.registration_id, row.created_at, range);
  for (const row of legacyCompleted) collectLatest(result, row.id, row.scheduled_activity_completed_at, range);
  for (const row of marketplaceReplies) collectLatest(result, row.clientId, row.at, range);

  if (conversations.length) {
    const conversationClientIds = [...new Set(conversations.map((row) => row.client_id))];
    const responsibleById = new Map();
    for (let index = 0; index < conversationClientIds.length; index += CHUNK) {
      const { data, error } = await db.from("simulation_registrations").select("id, responsible_user_id").in("id", conversationClientIds.slice(index, index + CHUNK));
      if (error) throw error;
      for (const row of data || []) responsibleById.set(row.id, row.responsible_user_id || "");
    }
    const associates = await loadAssociateBrokerMap(db);
    for (const row of conversations) {
      if (!responsibleById.has(row.client_id)) continue;
      if (isResponsibleSideConversation(row, responsibleById.get(row.client_id), associates)) collectLatest(result, row.client_id, row.last_inbound_at, range);
    }
  }
  return result;
}

// Map(clientId -> ISO da última mudança de status feita por PESSOA entre sinceIso e untilIso) — o mesmo sinal 1) acima
// (isPersonStatusChange: automáticas do sistema fora). Usado pela Meta Diária: [REGRA OFICIAL — dono, 2026-10-16]
// "mudar a etapa do cliente também deve resolver a pendência do dia?" -> "sim" (evaluateDailyGoalPending).
export async function loadPersonStatusChangeByClient(supabase, { sinceIso, untilIso = null, clientIds } = {}) {
  const db = getDb(supabase);
  const ids = [...new Set((clientIds || []).filter(Boolean))];
  const result = new Map();
  if (!ids.length) return result;
  const range = { sinceMs: Date.parse(sinceIso), untilMs: untilIso ? Date.parse(untilIso) : Infinity };
  const rows = await readAll(db, (d) => windowed(d.from("client_status_history").select("id, client_id, changed_at, changed_by, source"), "changed_at", sinceIso, untilIso), ids, "client_id");
  for (const row of rows) if (isPersonStatusChange(row)) collectLatest(result, row.client_id, row.changed_at, range);
  return result;
}

// Para os filtros de banco da lista ("Pendentes", "Sem contato há +3 dias"): ids que o filtro pela coluna de contato
// marcaria como "3 dias sem contato" mas que tiveram atendimento depois de `cutoffIso` — só esses precisam sair (lista
// curta, cabe no filtro `not in`).
export async function listAttendanceExclusionIds(supabase, cutoffIso) {
  const db = getDb(supabase);
  const recent = await loadRecentAttendanceByClient(db, { sinceIso: cutoffIso });
  const ids = [...recent.keys()];
  const result = [];
  for (let index = 0; index < ids.length; index += CHUNK) {
    const { data, error } = await db
      .from("simulation_registrations")
      .select("id")
      .in("id", ids.slice(index, index + CHUNK))
      .or(`last_whatsapp_contact_at.lt.${cutoffIso},and(last_whatsapp_contact_at.is.null,created_at.lt.${cutoffIso})`);
    if (error) throw error;
    result.push(...(data || []).map((row) => row.id));
  }
  return result;
}
