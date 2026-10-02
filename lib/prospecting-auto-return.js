import "server-only";
import { CLIENT_STATUS } from "./client-status";
import { getSupabaseAdminClient } from "./supabase";

// 2 dias era curto demais para reativação: o corretor manda a mensagem pelo
// próprio WhatsApp (fora do CRM) e o cliente pode demorar bem mais que isso
// para responder. Enquanto o corretor não atualiza o status manualmente, o
// contato ainda é dele — o problema real é só devolver cedo demais, antes de
// dar tempo do cliente responder.
const ATTEMPT_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;
const RETURN_BLOCK_MS = 30 * 24 * 60 * 60 * 1000;

export async function autoReturnStaleProspectingContacts(now = new Date()) {
  const db = getSupabaseAdminClient();
  if (!db) return 0;

  const cutoff = new Date(now.getTime() - ATTEMPT_LIMIT_MS).toISOString();
  const { data: contacts, error } = await db.from("prospecting_contacts")
    .select("id, registration_id, assigned_user_id, last_attempt_at")
    .eq("status", "claimed")
    .lte("last_attempt_at", cutoff);
  if (error) throw error;
  if (!contacts?.length) return 0;

  const registrationIds = contacts.map((contact) => contact.registration_id).filter(Boolean);
  if (!registrationIds.length) return 0;
  const { data: registrations, error: registrationError } = await db.from("simulation_registrations")
    .select("id, status")
    .in("id", registrationIds);
  if (registrationError) throw registrationError;
  const pendingIds = new Set((registrations || []).filter((item) => item.status === CLIENT_STATUS.AWAITING_RETURN).map((item) => item.id));
  let stale = contacts.filter((contact) => contact.registration_id && pendingIds.has(contact.registration_id));
  if (!stale.length) return 0;

  // Cliente que RESPONDEU e ainda espera o corretor classificar (pendência
  // "Respostas da prospecção", lib/prospecting-reply.js) nunca volta para a
  // fila nem perde o responsável por inatividade (pedido do dono, 2026-10-02).
  const { listClientIdsWithOpenReplyAlert } = await import("./prospecting-reply");
  const awaitingClassification = await listClientIdsWithOpenReplyAlert(stale.map((contact) => contact.registration_id));
  stale = stale.filter((contact) => !awaitingClassification.has(contact.registration_id));
  if (!stale.length) return 0;

  const availableAfter = new Date(now.getTime() + RETURN_BLOCK_MS).toISOString();

  // last_broker_id precisa copiar o assigned_user_id de cada contato antes de
  // zerá-lo, e o update do Supabase aplica o mesmo valor a toda a seleção —
  // por isso agrupamos por assigned_user_id (normalmente poucos corretores)
  // em vez de fazer um update por contato.
  const groups = new Map();
  for (const contact of stale) {
    const key = contact.assigned_user_id || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(contact);
  }

  const returned = [];
  for (const [assignedUserId, group] of groups) {
    const { data: updatedRows, error: contactError } = await db.from("prospecting_contacts")
      .update({ status: "recent_attempt", assigned_user_id: null, last_broker_id: assignedUserId || null, available_after: availableAfter, updated_at: now.toISOString() })
      .in("id", group.map((contact) => contact.id))
      .eq("status", "claimed")
      .select("id");
    if (contactError) throw contactError;
    const returnedIds = new Set((updatedRows || []).map((row) => row.id));
    for (const contact of group) if (returnedIds.has(contact.id)) returned.push(contact);
  }
  if (!returned.length) return 0;

  // Encerrar o ciclo de tentativas nao significa arquivar o cliente.
  // Apenas libera o responsavel para que o contato siga a regra de retorno
  // da fila, mantendo o atendimento em "Tentando contato".
  const returnedRegistrationIds = [...new Set(returned.map((contact) => contact.registration_id))];
  const { error: clientError } = await db.from("simulation_registrations")
    .update({ responsible_user_id: null, last_status_change_at: now.toISOString() })
    .in("id", returnedRegistrationIds)
    .eq("status", CLIENT_STATUS.AWAITING_RETURN);
  if (clientError) throw clientError;

  const { error: historyError } = await db.from("prospecting_history").insert(
    returned.map((contact) => ({ contact_id: contact.id, registration_id: contact.registration_id, user_id: contact.assigned_user_id, event_type: "auto_returned", details: { availableAfter, reason: "attempt_timeout_7_days" } }))
  );
  if (historyError) throw historyError;

  return returned.length;
}

// Depois da 3ª tentativa da Meta Diária, o cliente fica mais 24h disponível
// para a corretora que atendeu (pedido do dono, 2026-09-30) — tempo real pra
// ela ver uma resposta e mudar o status manualmente. Passadas as 24h sem
// nenhuma mudança de status, o contato "hiberna": sai do corretor e some da
// fila de prospecção por 30 dias (mesma trava de sempre — PRO-3), só depois
// volta para a base disponível para qualquer um.
const HIBERNATE_GRACE_MS = 24 * 60 * 60 * 1000;

export async function hibernateEndedDailyGoalRounds(now = new Date()) {
  const db = getSupabaseAdminClient();
  if (!db) return 0;

  // NUNCA partir de daily_goal_rounds primeiro: "ended_no_conversion" só
  // cresce (nunca volta a "active"), então esse filtro sozinho já pegava
  // 1600+ linhas históricas — o .in() gerado a partir disso estourava o
  // tamanho de URL da requisição e a Prospecção/o formulário público inteiro
  // (findMatchingRegistration usa a mesma função) quebrava com "Bad Request"
  // (bug real, 2026-09-30, corrigido no mesmo dia). Partir de
  // prospecting_contacts com status="claimed" mantém isso naturalmente
  // pequeno (só quem está com corretor agora), e o embed com
  // daily_goal_rounds!inner filtra a rodada encerrada no próprio banco, sem
  // nunca montar uma lista de ids gigante em memória.
  const cutoff = new Date(now.getTime() - HIBERNATE_GRACE_MS).toISOString();
  const { data: contacts, error: contactsError } = await db.from("prospecting_contacts")
    .select("id, registration_id, assigned_user_id, daily_goal_rounds!inner(status, ended_at)")
    .eq("status", "claimed")
    .eq("daily_goal_rounds.status", "ended_no_conversion")
    .lte("daily_goal_rounds.ended_at", cutoff);
  if (contactsError) throw contactsError;
  if (!contacts?.length) return 0;

  const registrationIds = contacts.map((contact) => contact.registration_id).filter(Boolean);
  if (!registrationIds.length) return 0;
  const { data: registrations, error: registrationError } = await db.from("simulation_registrations")
    .select("id, status")
    .in("id", registrationIds);
  if (registrationError) throw registrationError;
  const pendingIds = new Set((registrations || []).filter((item) => item.status === CLIENT_STATUS.AWAITING_RETURN).map((item) => item.id));
  let stale = contacts.filter((contact) => contact.registration_id && pendingIds.has(contact.registration_id));
  if (!stale.length) return 0;

  // Mesma regra do retorno automático (acima): cliente que RESPONDEU e ainda espera o corretor classificar
  // (pendência "Respostas da prospecção") não perde o responsável por inatividade — a resposta pode chegar
  // depois da 3ª tentativa, com a rodada já encerrada (auditoria incremental 2026-10-02).
  const { listClientIdsWithOpenReplyAlert } = await import("./prospecting-reply");
  const awaitingClassification = await listClientIdsWithOpenReplyAlert(stale.map((contact) => contact.registration_id));
  stale = stale.filter((contact) => !awaitingClassification.has(contact.registration_id));
  if (!stale.length) return 0;

  const availableAfter = new Date(now.getTime() + RETURN_BLOCK_MS).toISOString();

  const groups = new Map();
  for (const contact of stale) {
    const key = contact.assigned_user_id || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(contact);
  }

  const hibernated = [];
  for (const [assignedUserId, group] of groups) {
    const { data: updatedRows, error: contactError } = await db.from("prospecting_contacts")
      .update({ status: "recent_attempt", assigned_user_id: null, last_broker_id: assignedUserId || null, available_after: availableAfter, queue_sort_at: availableAfter, updated_at: now.toISOString() })
      .in("id", group.map((contact) => contact.id))
      .eq("status", "claimed")
      .select("id");
    if (contactError) throw contactError;
    const hibernatedIds = new Set((updatedRows || []).map((row) => row.id));
    for (const contact of group) if (hibernatedIds.has(contact.id)) hibernated.push(contact);
  }
  if (!hibernated.length) return 0;

  const hibernatedRegistrationIds = [...new Set(hibernated.map((contact) => contact.registration_id))];
  const { error: clientError } = await db.from("simulation_registrations")
    .update({ responsible_user_id: null, last_status_change_at: now.toISOString() })
    .in("id", hibernatedRegistrationIds)
    .eq("status", CLIENT_STATUS.AWAITING_RETURN);
  if (clientError) throw clientError;

  const { error: historyError } = await db.from("prospecting_history").insert(
    hibernated.map((contact) => ({ contact_id: contact.id, registration_id: contact.registration_id, user_id: contact.assigned_user_id, event_type: "daily_goal_round_hibernated", details: { availableAfter, reason: "grace_period_24h" } }))
  );
  if (historyError) throw historyError;

  return hibernated.length;
}
