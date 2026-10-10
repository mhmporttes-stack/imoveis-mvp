import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { createAlertDeliveries, getAlertDefinition } from "./crm-alerts";
import {
  NUMBER_PAUSED_ALERT_KEY, QUEUE_PROBLEM_ALERT_KEY, REPEATED_ERROR_LIMIT,
  pausedAlertDeliveries, queueProblemDeliveries, resolveProtectionRecipients, findStuckPendingItems, consecutiveErrorStreak,
  stuckDedupeKey, repeatedErrorDedupeKey, isExpectedHold
} from "./daily-goal-protection-core.mjs";

// Avisos da proteção anti-banimento da Meta Diária (REGRA OFICIAL — dono, 2026-10-10). Regras puras em
// daily-goal-protection-core.mjs. Entrega pela Central de Alertas (crm_alert_definitions / crm_alert_deliveries,
// idempotente por destinatário + dedupe_key). Destinatários: o corretor + a gestora responsável.
// Sem a definição no banco (migration 20261010130000 ainda não aplicada) NADA é entregue e o motivo é registrado no
// log (não é silencioso); a pausa em si não depende do alerta.

const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

async function loadUsers() {
  const { data, error } = await db().from("admin_users").select("id, name, role, status, manager_id, linked_broker_id, disabled_at");
  if (error) throw error;
  return data || [];
}

// Número pausado por 403/logout: aviso IMPORTANTE ao corretor e à gestora. -> { alerted, reason }
// Lança em erro de banco (o chamador mantém o número como "ainda sem aviso" e tenta de novo no próximo ciclo).
export async function notifyNumberPaused({ brokerId, slot, kind, episodeAt }) {
  const definition = await getAlertDefinition(NUMBER_PAUSED_ALERT_KEY);
  if (!definition?.enabled) {
    warnOnce(`paused:${definition ? "off" : "missing"}`, `Alerta ${NUMBER_PAUSED_ALERT_KEY}: ${definition ? "definição desligada" : "definição ausente (migration 20261010130000 não aplicada)"} — pausa feita, sem aviso na Central.`);
    return { alerted: false, reason: definition ? "definicao_desligada" : "definicao_ausente" };
  }
  const users = await loadUsers();
  const recipientIds = resolveProtectionRecipients(users, brokerId);
  if (!recipientIds.length) return { alerted: false, reason: "sem_destinatario" };
  const broker = users.find((user) => user.id === brokerId);
  const deliveries = pausedAlertDeliveries({ definition, recipientIds, brokerId, brokerName: broker?.name, slot, kind, episodeAt });
  const created = await createAlertDeliveries(deliveries);
  return { alerted: created.length > 0, reason: created.length ? "ok" : "duplicado" };
}

const MINUTE_MS = 60 * 1000;

// Item parado (pendente há mais de 2 h dentro da janela de envio) e erros seguidos do mesmo tipo (mais de 5):
// avisa a gestora e o corretor, UMA vez por episódio (dia + tipo). Só LÊ a fila e AVISA — nada é pausado, cancelado
// ou reenviado. Chamado pelo cron depois do ciclo do corretor; o chamador captura e registra qualquer exceção.
// `windowStartMs/windowEndMs` = janela efetiva de HOJE; `dispatchSkipped` = motivo do ciclo (retenção esperada
// — teto, janela, intervalo, pausa — não conta como item parado).
export async function checkQueueHealth({ brokerId, brokerName, today, nowMs = Date.now(), windowStartMs, windowEndMs, sendingDay = true, dispatchSkipped = "" }) {
  const definition = await getAlertDefinition(QUEUE_PROBLEM_ALERT_KEY);
  if (!definition?.enabled) {
    warnOnce(`queue:${definition ? "off" : "missing"}`, `Alerta ${QUEUE_PROBLEM_ALERT_KEY}: ${definition ? "definição desligada" : "definição ausente (migration 20261010130000 não aplicada)"} — sem aviso na Central.`);
    return { alerted: 0, reason: definition ? "definicao_desligada" : "definicao_ausente" };
  }
  const problems = [];

  if (!isExpectedHold(dispatchSkipped)) {
    const cutoff = new Date(nowMs - 2 * 60 * MINUTE_MS).toISOString();
    const { data: pending, error } = await db().from("daily_goal_auto_queue")
      .select("id, scheduled_for").eq("broker_id", brokerId).eq("status", "pending").lte("scheduled_for", cutoff).limit(50);
    if (error) throw error;
    const stuck = findStuckPendingItems(pending || [], { nowMs, windowStartMs, windowEndMs, sendingDay });
    if (stuck.count) {
      const hours = Math.floor(stuck.oldestOverdueMs / (60 * MINUTE_MS));
      problems.push({
        problem: "stuck",
        dedupeKey: stuckDedupeKey(brokerId, today),
        motivo: `${stuck.count} mensagem(ns) da fila está(ão) parada(s) há mais de ${Math.max(2, hours)} h dentro do horário de envio sem sair. Confira a conexão do WhatsApp e a aba Automação (Gestão > Meta Diária).`
      });
    }
  }

  const { data: recent, error: recentError } = await db().from("daily_goal_auto_queue")
    .select("status, skip_reason, last_error, sent_at, updated_at")
    .eq("broker_id", brokerId).in("status", ["sent", "error"]).order("updated_at", { ascending: false }).limit(REPEATED_ERROR_LIMIT + 7);
  if (recentError) throw recentError;
  const streak = consecutiveErrorStreak((recent || []).map((row) => ({ ...row, at: row.updated_at || row.sent_at })));
  if (streak.exceeded) {
    problems.push({
      problem: "repeated_errors",
      dedupeKey: repeatedErrorDedupeKey(brokerId, streak.typeKey, today),
      motivo: `${streak.count} erros seguidos do mesmo tipo (${streak.typeKey.replace(/_/g, " ")}) nos envios automáticos. Confira o histórico em Gestão > Meta Diária > Automação.`
    });
  }
  if (!problems.length) return { alerted: 0, reason: "sem_problema" };

  const users = await loadUsers();
  const recipientIds = resolveProtectionRecipients(users, brokerId);
  if (!recipientIds.length) return { alerted: 0, reason: "sem_destinatario" };
  const deliveries = problems.flatMap((item) => queueProblemDeliveries({ definition, recipientIds, brokerId, brokerName, problem: item.problem, motivo: item.motivo, dedupeKey: item.dedupeKey }));
  const created = await createAlertDeliveries(deliveries);
  return { alerted: created.length, reason: created.length ? "ok" : "duplicado" };
}
