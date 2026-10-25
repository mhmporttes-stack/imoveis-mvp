import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { recordClientStatusChange } from "./client-status-history";
import { isTransferredCandidate, TRANSFERRED_AWAITING_EXCLUDED_STATUSES } from "./transferred-awaiting-core.mjs";
import {
  PREVIOUS_STATUS_TAG_COLOR,
  TRANSFER_STATUS_REASON,
  TRANSFER_STATUS_SOURCE,
  TRANSFER_TARGET_STATUS,
  planPreviousStatusTags,
  planTransferStatus
} from "./transfer-status-core.mjs";

// Ponto ÚNICO da regra "transferido vai para Tentando contato + etiqueta do status anterior" (REGRA OFICIAL — dono,
// 2026-10-25; regras puras em lib/transfer-status-core.mjs). Chamado DEPOIS que a troca de responsável foi gravada, por
// todos os caminhos de transferência (trava: tests/transfer-status.test.mjs). `auth` = quem fez a transferência: com
// usuário, o histórico fica no nome do perfil efetivo (regra de "Alterar conta": ação operacional fica com o emulado);
// sem usuário (roleta, filas, rotinas), "sistema". Nunca pontua nem conta como atendimento (source automática).

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

async function applyPreviousStatusTag(clientId, tagName) {
  const { addSystemTagToClient } = await import("./client-tags");
  const { tag } = await addSystemTagToClient(clientId, tagName, PREVIOUS_STATUS_TAG_COLOR);
  const { data, error } = await db().from("client_tags").select("tag_id, tag:tags(id, normalized_name)").eq("client_id", clientId);
  if (error) throw error;
  const currentTags = (data || []).map((row) => ({ id: row.tag?.id || row.tag_id, normalizedName: row.tag?.normalized_name || "" }));
  const { removeIds } = planPreviousStatusTags({ currentTags, targetTagId: tag.id });
  if (removeIds.length) {
    const { error: removeError } = await db().from("client_tags").delete().eq("client_id", clientId).in("tag_id", removeIds);
    if (removeError) throw removeError;
  }
  return tag;
}

export async function applyTransferStatusRule({ clientId, auth = null } = {}) {
  if (!clientId) return { applied: false, reason: "sem_cliente" };
  const supabase = db();
  const { data: client, error } = await supabase.from("simulation_registrations").select("id, status").eq("id", clientId).maybeSingle();
  if (error) throw error;
  if (!client) return { applied: false, reason: "cliente_nao_encontrado" };

  const plan = planTransferStatus(client.status);
  if (!plan.change) return { applied: false, reason: plan.reason };

  const at = new Date().toISOString();
  // Só se o status ainda é o lido: alguém que mudou a etapa no meio do caminho vence.
  const { data: moved, error: updateError } = await supabase.from("simulation_registrations")
    .update({ status: TRANSFER_TARGET_STATUS, last_status_change_at: at })
    .eq("id", clientId)
    .eq("status", client.status)
    .select("id");
  if (updateError) throw updateError;
  if (!moved?.length) return { applied: false, reason: "status_mudou" };

  await recordClientStatusChange({
    supabase,
    clientId,
    previousStatus: client.status,
    newStatus: TRANSFER_TARGET_STATUS,
    changedAt: at,
    changedBy: auth?.ok ? auth.user?.email || "sistema" : "sistema",
    source: TRANSFER_STATUS_SOURCE
  });
  const tag = await applyPreviousStatusTag(clientId, plan.tagName);
  const { logClientJourneyEvent, resolveActorSnapshot } = await import("./client-journey");
  await logClientJourneyEvent({
    clientId,
    eventType: "status_reason",
    actor: resolveActorSnapshot(auth),
    details: { newStatus: TRANSFER_TARGET_STATUS, previousStatus: client.status, reason: `${TRANSFER_STATUS_REASON}: etapa anterior guardada na etiqueta "${tag.name}"`, source: TRANSFER_STATUS_SOURCE }
  });
  return { applied: true, previousStatus: client.status, tagName: tag.name };
}

// Para os caminhos em que a transferência JÁ foi gravada e a resposta não pode virar erro: a falha fica no log do
// servidor (console.error) e o cliente entra na rotina dos atuais (`runTransferStatusBackfill`) se ainda estiver sem
// atendimento.
export async function applyTransferStatusRuleAfterTransfer({ clientId, auth = null }) {
  try {
    return await applyTransferStatusRule({ clientId, auth });
  } catch (error) {
    console.error("[transferência] falha ao mudar o cliente para Tentando contato:", clientId, error?.message || error);
    return { applied: false, reason: "erro", error: error?.message || String(error) };
  }
}

// Atuais (pedido do dono, 2026-10-25): transferidos que o novo responsável ainda NÃO atendeu desde o recebimento — mesma
// definição do card "Novos atendimentos" (CLI-7b: isTransferredCandidate + listClientIdsWithHumanAttendance sem `ever`).
// `apply: false` (padrão) só conta; `apply: true` aplica a regra em cada um (idempotente: quem já está em Tentando
// contato ou fora das etapas da regra não muda).
export async function runTransferStatusBackfill({ apply = false, limit = 5000 } = {}) {
  const supabase = db();
  const rows = [];
  for (let from = 0; rows.length < limit; from += 1000) {
    const { data, error } = await supabase.from("simulation_registrations")
      .select("id, full_name, status, responsible_user_id, previous_responsible_user_id, responsible_changed_at, pending_distribution_at, private_contact_at")
      .not("previous_responsible_user_id", "is", null)
      .not("responsible_changed_at", "is", null)
      .is("pending_distribution_at", null)
      .is("private_contact_at", null)
      .not("status", "in", `(${TRANSFERRED_AWAITING_EXCLUDED_STATUSES.join(",")})`)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const candidates = rows.filter(isTransferredCandidate);
  const { listClientIdsWithHumanAttendance } = await import("./whatsapp-attendance");
  const unattended = [];
  for (let index = 0; index < candidates.length; index += 150) {
    const chunk = candidates.slice(index, index + 150);
    const attended = await listClientIdsWithHumanAttendance(chunk);
    for (const client of chunk) if (!attended.has(client.id)) unattended.push(client);
  }

  const summary = { transferredAwaiting: unattended.length, toChange: 0, byStatus: {}, skipped: {}, applied: 0, failed: 0, apply: Boolean(apply) };
  for (const client of unattended) {
    const plan = planTransferStatus(client.status);
    if (!plan.change) {
      summary.skipped[plan.reason] = (summary.skipped[plan.reason] || 0) + 1;
      continue;
    }
    summary.toChange += 1;
    summary.byStatus[client.status] = (summary.byStatus[client.status] || 0) + 1;
    if (!apply) continue;
    const result = await applyTransferStatusRuleAfterTransfer({ clientId: client.id, auth: null });
    if (result.applied) summary.applied += 1;
    else if (result.reason === "erro") summary.failed += 1;
  }
  return summary;
}
