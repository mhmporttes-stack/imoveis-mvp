import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { decideAutoEnd, decideReport, decideResolve, canChangeRestriction } from "./whatsapp-restriction-core.mjs";

// Persistência do status operacional "WhatsApp restringido" (tabela
// whatsapp_restrictions, histórico). Regras puras em whatsapp-restriction-core.mjs.
// NÃO participa da elegibilidade da Prospecção.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

export async function getOpenRestriction(userId) {
  if (!userId) return null;
  const { data, error } = await db().from("whatsapp_restrictions").select("id, user_id, reported_by, reported_at")
    .eq("user_id", userId).is("ended_at", null).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Restrições abertas de vários corretores (mapa userId -> linha).
export async function listOpenRestrictions(userIds) {
  if (!userIds?.length) return new Map();
  const { data, error } = await db().from("whatsapp_restrictions").select("id, user_id, reported_by, reported_at")
    .in("user_id", userIds).is("ended_at", null);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.user_id, row]));
}

async function closeRestriction(userId, endReason, endedBy = null) {
  const { error } = await db().from("whatsapp_restrictions")
    .update({ ended_at: new Date().toISOString(), end_reason: endReason, ended_by: endedBy })
    .eq("user_id", userId).is("ended_at", null);
  if (error) throw error;
}

// Encerra sozinha se a sessão está conectada. Chamado quando a sessão passa a
// "connected" (applyIndividualSessionStatus) e na leitura do status. Idempotente.
export async function endRestrictionIfConnected(userId, sessionStatus) {
  if (!userId || sessionStatus !== "connected") return false;
  const open = await getOpenRestriction(userId);
  const decision = decideAutoEnd({ sessionStatus, openRestriction: open });
  if (decision.action !== "close") return false;
  await closeRestriction(userId, decision.end_reason, null);
  return true;
}

// Marca (só o próprio usuário). -> { ok, result } | { ok:false, error, status }
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
    .insert({ user_id: targetUserId, reported_by: actorId }).select("id, user_id, reported_by, reported_at").single();
  if (error) {
    // corrida: o índice único parcial garante uma só aberta
    if (error.code === "23505") return { ok: true, result: "already_restricted", restriction: await getOpenRestriction(targetUserId) };
    throw error;
  }
  return { ok: true, result: "created", restriction: data };
}

export async function resolveRestriction({ actorId, targetUserId }) {
  if (!canChangeRestriction({ actorId, targetUserId })) return { ok: false, status: 403, error: "Só o próprio corretor pode encerrar a restrição do seu WhatsApp." };
  const decision = decideResolve({ openRestriction: await getOpenRestriction(targetUserId) });
  if (decision.action === "noop") return { ok: true, result: "not_restricted" };
  await closeRestriction(targetUserId, decision.end_reason, actorId);
  return { ok: true, result: "resolved" };
}
