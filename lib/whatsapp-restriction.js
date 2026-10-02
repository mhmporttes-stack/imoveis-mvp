import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import {
  decideAutoEnd, decideReport, decideResolve, decideValidation, canChangeRestriction, validationOriginFor,
  normalizeDisconnectCode, VALIDATION_VALIDATED, VALIDATION_REJECTED
} from "./whatsapp-restriction-core.mjs";

// Persistência do status operacional "WhatsApp restringido" (tabela
// whatsapp_restrictions + histórico append-only whatsapp_restriction_events).
// Regras puras em whatsapp-restriction-core.mjs. NÃO participa da elegibilidade
// da Prospecção.

const SESSION_EVENT_DEDUP_MS = 10 * 60 * 1000;
const RESTRICTION_COLUMNS = "id, user_id, reported_by, reported_at, validation_status, validation_origin, validated_by, validated_at, validation_reason, technical_code";

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Histórico append-only. Falha ao gravar o histórico nunca desfaz a ação principal.
async function appendEvent({ restrictionId = null, userId, eventType, actorId = null, origin = null, reason = null, technicalCode = null }) {
  const { error } = await db().from("whatsapp_restriction_events").insert({
    restriction_id: restrictionId, user_id: userId, event_type: eventType, actor_id: actorId, origin,
    reason: reason ? String(reason).slice(0, 500) : null, technical_code: technicalCode
  });
  if (error) console.error("Falha ao gravar o histórico da restrição do WhatsApp:", error.message);
}

export async function getOpenRestriction(userId) {
  if (!userId) return null;
  const { data, error } = await db().from("whatsapp_restrictions").select(RESTRICTION_COLUMNS)
    .eq("user_id", userId).is("ended_at", null).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Restrições abertas de vários corretores (mapa userId -> linha).
export async function listOpenRestrictions(userIds) {
  if (!userIds?.length) return new Map();
  const { data, error } = await db().from("whatsapp_restrictions").select(RESTRICTION_COLUMNS)
    .in("user_id", userIds).is("ended_at", null);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.user_id, row]));
}

// Todas as abertas (admin geral).
export async function listAllOpenRestrictions() {
  const { data, error } = await db().from("whatsapp_restrictions").select(RESTRICTION_COLUMNS).is("ended_at", null);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.user_id, row]));
}

async function closeRestriction(open, endReason, endedBy, { eventType, origin }) {
  const { data, error } = await db().from("whatsapp_restrictions")
    .update({ ended_at: new Date().toISOString(), end_reason: endReason, ended_by: endedBy })
    .eq("id", open.id).is("ended_at", null).select("id");
  if (error) throw error;
  if ((data || []).length) await appendEvent({ restrictionId: open.id, userId: open.user_id, eventType, actorId: endedBy, origin });
  return (data || []).length > 0;
}

// Encerra sozinha se a sessão está conectada. Chamado quando a sessão passa a
// "connected" (applyIndividualSessionStatus) e na leitura do status. Idempotente.
export async function endRestrictionIfConnected(userId, sessionStatus) {
  if (!userId || sessionStatus !== "connected") return false;
  const open = await getOpenRestriction(userId);
  const decision = decideAutoEnd({ sessionStatus, openRestriction: open });
  if (decision.action !== "close") return false;
  return closeRestriction(open, decision.end_reason, null, { eventType: "auto_ended", origin: "sistema" });
}

// Informa (só o próprio usuário). Nunca valida. -> { ok, result } | { ok:false, error, status }
export async function reportRestriction({ actorId, targetUserId, confirmed, sessionStatus }) {
  if (!canChangeRestriction({ actorId, targetUserId })) return { ok: false, status: 403, error: "Só o próprio corretor pode informar a restrição do seu WhatsApp." };
  const open = await getOpenRestriction(targetUserId);
  const decision = decideReport({ confirmed, sessionStatus, openRestriction: open });
  if (decision.action === "reject") {
    return decision.reason === "confirmation_required"
      ? { ok: false, status: 400, error: "Confirme que o seu WhatsApp está restringido." }
      : { ok: false, status: 409, error: "Seu WhatsApp está conectado; não há restrição a informar." };
  }
  if (decision.action === "noop") return { ok: true, result: "already_restricted", restriction: open };
  const { data, error } = await db().from("whatsapp_restrictions")
    .insert({ user_id: targetUserId, reported_by: actorId }).select(RESTRICTION_COLUMNS).single();
  if (error) {
    // corrida: o índice único parcial garante uma só aberta
    if (error.code === "23505") return { ok: true, result: "already_restricted", restriction: await getOpenRestriction(targetUserId) };
    throw error;
  }
  await appendEvent({ restrictionId: data.id, userId: targetUserId, eventType: "informed", actorId, origin: "corretor" });
  return { ok: true, result: "created", restriction: data };
}

export async function resolveRestriction({ actorId, targetUserId }) {
  if (!canChangeRestriction({ actorId, targetUserId })) return { ok: false, status: 403, error: "Só o próprio corretor pode encerrar a restrição do seu WhatsApp." };
  const open = await getOpenRestriction(targetUserId);
  const decision = decideResolve({ openRestriction: open });
  if (decision.action === "noop") return { ok: true, result: "not_restricted" };
  await closeRestriction(open, decision.end_reason, actorId, { eventType: "resolved", origin: "corretor" });
  return { ok: true, result: "resolved" };
}

const VALIDATION_REFUSALS = {
  forbidden: [403, "Você não pode validar a restrição deste corretor."],
  invalid_verdict: [400, "Ação inválida."],
  not_restricted: [409, "Este corretor não tem restrição aberta."],
  already_connected: [409, "O WhatsApp deste corretor já está conectado."],
  already_validated: [409, "Esta restrição já foi validada."]
};

// Validação ADMINISTRATIVA ("Validar restrição" / "Não validar"). `actor` vem do
// guard (admin geral efetivo ou gestora); `validatedById` é o admin REAL (ação
// administrativa não é atribuída ao corretor emulado em "Alterar conta").
// -> { ok, result } | { ok:false, status, error }
export async function validateRestriction({ actor, validatedById, targetUserId, verdict, reason = "", sessionStatus = null }) {
  const origin = validationOriginFor({
    actorId: actor?.id, actorRole: actor?.role, isGeneralAdmin: Boolean(actor?.isGeneralAdmin), targetUserId, managedUserIds: actor?.managedUserIds || []
  });
  const open = origin ? await getOpenRestriction(targetUserId) : null;
  const decision = decideValidation({ verdict, origin, openRestriction: open, sessionStatus });
  if (decision.action === "refuse") {
    const [status, error] = VALIDATION_REFUSALS[decision.reason] || [400, "Não foi possível validar."];
    return { ok: false, status, error };
  }
  if (decision.action === "noop") return { ok: true, result: "already_validated" };
  const now = new Date().toISOString();
  const note = reason ? String(reason).slice(0, 500) : null;
  const patch = decision.action === "validate"
    ? { validation_status: VALIDATION_VALIDATED, validation_origin: origin, validated_by: validatedById, validated_at: now, validation_reason: note }
    : { validation_status: VALIDATION_REJECTED, validation_origin: origin, validated_by: validatedById, validated_at: now, validation_reason: note,
        ended_at: now, end_reason: decision.end_reason, ended_by: validatedById };
  // Condição no UPDATE: só age sobre restrição ainda aberta e ainda "informada" (idempotente/corrida).
  const { data, error } = await db().from("whatsapp_restrictions").update(patch)
    .eq("id", open.id).is("ended_at", null).eq("validation_status", "informed").select("id");
  if (error) throw error;
  if (!(data || []).length) return { ok: true, result: "no_change" };
  await appendEvent({ restrictionId: open.id, userId: targetUserId, eventType: decision.action === "validate" ? "validated" : "rejected", actorId: validatedById, origin, reason: note });
  return { ok: true, result: decision.action === "validate" ? "validated" : "rejected" };
}

// Histórico (append-only) de um corretor, mais recente primeiro.
export async function listRestrictionHistory(userId, limit = 100) {
  const { data, error } = await db().from("whatsapp_restriction_events")
    .select("id, restriction_id, event_type, actor_id, origin, reason, technical_code, created_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// Instrumentação (só REGISTRO, nunca decisão): evento de sessão com o código de
// desconexão informado pelo microsserviço. Falha aqui nunca derruba o status.
export async function recordSessionEvent(userId, { status, statusCode, message, output }) {
  const code = normalizeDisconnectCode(statusCode);
  if (!userId || (code === null && !message)) return;
  // Anti-inundação: uma sessão presa num laço de reconexão (ex.: 403 a cada ~10 s) repete o
  // mesmo evento; só grava de novo se mudou (status/código/mensagem) ou passou 10 min.
  const since = new Date(Date.now() - SESSION_EVENT_DEDUP_MS).toISOString();
  const { data: last } = await db().from("whatsapp_session_events").select("status, status_code, error_message")
    .eq("user_id", userId).gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (last && last.status === (status || null) && last.status_code === code && last.error_message === (message ? String(message).slice(0, 300) : null)) return;
  const { error } = await db().from("whatsapp_session_events").insert({
    user_id: userId, status: status || null, status_code: code,
    error_message: message ? String(message).slice(0, 300) : null,
    output: output && typeof output === "object" ? output : null
  });
  if (error) console.error("Falha ao gravar o evento de sessão do WhatsApp:", error.message);
}
