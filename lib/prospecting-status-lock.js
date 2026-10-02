import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { isGeneralAdminAuth } from "./admin-profiles";
import { PROSPECTING_STATUS_LOCK_MESSAGE, decideProspectingStatusLock, isStatusAdvance } from "./prospecting-status-lock-core.mjs";

// Trava de status da Prospecção (regras em lib/prospecting-status-lock-core.mjs).
// Barreira no SERVIDOR: chamada antes de qualquer gravação nos caminhos em que
// alguém da equipe muda o status (ficha/card/lista, botão "Em atendimento" da
// prospecção, envio à CCA). Mudanças automáticas sem usuário (formulário
// preenchido pelo próprio cliente, automações do CRM) não passam por aqui.
// Corretor/gestor não acessam o banco direto (RLS sem policy pública), então
// essas rotas são a única porta.

export class ProspectingStatusLockError extends Error {
  constructor() {
    super(PROSPECTING_STATUS_LOCK_MESSAGE);
    this.name = "ProspectingStatusLockError";
    this.status = 409;
    this.code = "PROSPECTING_STATUS_LOCKED";
  }
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

export async function isClientProspectingLocked(clientId, clientStatus) {
  if (!clientId || clientStatus !== "awaiting_return") return false;
  const { data: round, error } = await db().from("daily_goal_rounds")
    .select("id, status, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!decideProspectingStatusLock({ clientStatus, round, automatedOutreach: true, replied: false })) return false;

  const [autoAttempts, extraItems, replies] = await Promise.all([
    db().from("daily_goal_attempts").select("id", { count: "exact", head: true }).eq("round_id", round.id).eq("origin", "auto"),
    db().from("daily_goal_auto_queue").select("id", { count: "exact", head: true }).eq("round_id", round.id).eq("source", "extra").in("status", ["pending", "sending", "sent"]),
    db().from("prospecting_reply_alerts").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("kind", "reply").gte("last_message_at", round.created_at)
  ]);
  for (const result of [autoAttempts, extraItems, replies]) if (result.error) throw result.error;

  return decideProspectingStatusLock({
    clientStatus,
    round,
    automatedOutreach: (autoAttempts.count || 0) > 0 || (extraItems.count || 0) > 0,
    replied: (replies.count || 0) > 0
  });
}

// Admin geral REAL (fora do "Alterar conta") pode destravar — saída de
// emergência para resposta que não chegou ao CRM (ex.: cliente respondeu por
// outro número). Em "Alterar conta" vale a regra do corretor emulado.
function canOverrideLock(auth) {
  return Boolean(auth?.ok && !auth.accountSwitchMode && isGeneralAdminAuth(auth));
}

export async function assertProspectingStatusChangeAllowed({ clientId, currentStatus, nextStatus, auth }) {
  if (!isStatusAdvance({ currentStatus, nextStatus })) return;
  if (canOverrideLock(auth)) return;
  if (await isClientProspectingLocked(clientId, currentStatus)) throw new ProspectingStatusLockError();
}
