// Monitor de TAXA DE ENTREGA da automação da Meta Diária (WhatsApp individual) — REGRA OFICIAL (dono, 2026-10-04).
// Puro (sem banco, sem "server-only"): o acesso ao banco e o envio do e-mail entram por `deps` (injetáveis em teste).
// Testado em tests/daily-goal-delivery-monitor.test.mjs.
//
// O que faz: por corretor e por dia (America/Sao_Paulo), % de mensagens ENVIADAS PELA AUTOMAÇÃO (fila da Meta
// Diária, status "sent") que tiveram confirmação (`delivered_at` = 1º sinal do WhatsApp: 1 OU 2 tiques). Queda abaixo
// do limite (padrão 60%, com amostra mínima de 20) gera UM e-mail à gestora, no máximo um por corretor por dia.
//
// O que NÃO faz (de propósito): NÃO pausa nada, NÃO verifica denúncia, NÃO bloqueia a API. Só LÊ e AVISA. Só depois
// de 2–4 semanas de dados o dono decide se um dia vira pausa automática.
//
// Cuidados contra falso alarme: só conta mensagem enviada entre 1 h e 24 h atrás (dá tempo do recibo chegar);
// ignora domingo, envio fora da janela (06:30–15:30) e corretor com a sessão desconectada AGORA; mensagens enviadas
// ANTES da última queda da sessão também saem da conta (os recibos podem ter se perdido na queda). Limitação:
// só a ÚLTIMA queda é conhecida (whatsapp_individual_sessions.last_disconnect_at), não o histórico completo.

import { saoPauloDateMinutes } from "./daily-goal-auto-core.mjs";
import { WINDOW_START_MINUTES, WINDOW_END_MINUTES } from "./daily-goal-policy-core.mjs";

export const DELIVERY_ALERT_THRESHOLD_PERCENT = 60; // limiar TEMPORÁRIO (configurável)
export const DELIVERY_MIN_SAMPLE = 20;
export const DELIVERY_MIN_AGE_MS = 60 * 60 * 1000; // só mensagens com pelo menos 1 h
export const DELIVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // e no máximo 24 h
export const DELIVERY_MAX_ALERTS_PER_RUN = 5; // no máximo 5 e-mails por execução (primeiro deploy sem enxurrada)
export const DELIVERY_EVAL_INTERVAL_MS = 60 * 60 * 1000; // avaliação leve: no máximo 1 vez por hora
export const DELIVERY_CONFIG_SETTING_ID = "daily_goal_delivery_monitor";
export const DELIVERY_STATE_SETTING_ID = "daily_goal_delivery_monitor_state";

// Config opcional lida de crm_settings (sem exigir migration). Valor inválido volta ao padrão.
export function resolveMonitorConfig(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const threshold = Number(value.thresholdPercent);
  const sample = Number(value.minSample);
  const maxAlerts = Number(value.maxAlertsPerRun);
  return {
    thresholdPercent: Number.isFinite(threshold) && threshold > 0 && threshold <= 100 ? threshold : DELIVERY_ALERT_THRESHOLD_PERCENT,
    minSample: Number.isInteger(sample) && sample >= 1 ? sample : DELIVERY_MIN_SAMPLE,
    maxAlertsPerRun: Number.isInteger(maxAlerts) && maxAlerts >= 1 ? maxAlerts : DELIVERY_MAX_ALERTS_PER_RUN
  };
}

// Chave determinística do alerta (um por corretor por dia) — grava em crm_settings, a chave primária garante a unicidade.
export function deliveryAlertKey(date, brokerId) {
  return `delivery_alert:${date}:${brokerId}`;
}

// Avalia UM corretor. `rows` = linhas de daily_goal_auto_queue [{ source, status, sent_at, delivered_at }];
// `session` = { status, lastDisconnectAtMs }. Devolve { skipped } ou { groups: [{ date, evaluated, delivered, percent,
// enoughSample, belowThreshold }] } (um grupo por dia de São Paulo).
export function evaluateBrokerDelivery({ rows, nowMs, session, config = resolveMonitorConfig() }) {
  if (!session || session.status !== "connected") return { skipped: "sessao_desconectada" };
  const disconnectMs = Number.isFinite(session.lastDisconnectAtMs) ? session.lastDisconnectAtMs : null;
  const byDate = new Map();
  for (const row of rows || []) {
    if ((row.source || "meta") !== "meta" || row.status !== "sent") continue;
    const sentMs = new Date(row.sent_at || "").getTime();
    if (Number.isNaN(sentMs)) continue;
    const age = nowMs - sentMs;
    if (age < DELIVERY_MIN_AGE_MS || age > DELIVERY_MAX_AGE_MS) continue;
    const clock = saoPauloDateMinutes(sentMs);
    if (!clock || clock.weekday === 0) continue; // domingo
    if (clock.minutes < WINDOW_START_MINUTES || clock.minutes > WINDOW_END_MINUTES) continue; // fora do horário
    if (disconnectMs !== null && sentMs < disconnectMs) continue; // recibos podem ter se perdido na queda
    const group = byDate.get(clock.date) || { date: clock.date, evaluated: 0, delivered: 0 };
    group.evaluated += 1;
    if (row.delivered_at) group.delivered += 1;
    byDate.set(clock.date, group);
  }
  const groups = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((group) => {
    const percent = Math.round((group.delivered / group.evaluated) * 1000) / 10;
    const enoughSample = group.evaluated >= config.minSample;
    return { ...group, percent, enoughSample, belowThreshold: enoughSample && percent < config.thresholdPercent };
  });
  return { groups };
}

// Só o dia corrente e o anterior (fechado) entram — nunca histórico antigo (primeiro deploy sem enxurrada).
export function relevantDates(nowMs) {
  const today = saoPauloDateMinutes(nowMs);
  const yesterday = saoPauloDateMinutes(nowMs - 24 * 60 * 60 * 1000);
  return new Set([today?.date, yesterday?.date].filter(Boolean));
}

function formatDateBr(date) {
  const [year, month, day] = String(date).split("-");
  return `${day}/${month}/${year}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Texto do e-mail à gestora, em português simples. Sem telefone nem conteúdo de cliente.
export function buildDeliveryAlertEmail({ recipientName = "", brokerName, date, percent, evaluated, delivered, thresholdPercent }) {
  const dateBr = formatDateBr(date);
  const subject = `Alerta de entrega do WhatsApp: ${brokerName} (${String(percent).replace(".", ",")}% em ${dateBr})`;
  const paragraphs = [
    `Olá${recipientName ? `, ${recipientName}` : ""}.`,
    `A taxa de entrega das mensagens automáticas (Meta Diária) de ${brokerName} no dia ${dateBr} ficou em ${String(percent).replace(".", ",")}%, abaixo do limite de alerta de ${thresholdPercent}%.`,
    `Foram avaliadas ${evaluated} mensagens enviadas entre 1 e 24 horas atrás; ${delivered} tiveram confirmação de entrega (pelo menos 1 tique no WhatsApp).`,
    "Isso pode ser sinal de bloqueio ou de restrição do número, mas também pode ser apenas celular desligado ou sem internet, ou recibos que ainda não chegaram (podem levar horas). Por isso é só um aviso: NADA foi pausado automaticamente.",
    `O que fazer: confira se o celular de ${brokerName} está ligado, com internet e com o WhatsApp conectado ao CRM. Se quiser pausar os disparos dessa pessoa, vá em Gestão > Meta Diária > aba Automação, no cartão de ${brokerName}, e clique em "Pausar". Para voltar, clique em "Retomar".`,
    "Este aviso é enviado no máximo uma vez por corretor por dia. Mensagem automática do CRM da Matheus Machado Imóveis."
  ];
  const text = paragraphs.join("\n\n");
  const html = `<div style="font-family:Arial,sans-serif;color:#0d2b4f;line-height:1.6;max-width:620px">${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</div>`;
  return { subject, text, html };
}

// Orquestração do monitor. `deps` (todos injetáveis; nenhuma chamada real em teste):
//  loadConfig() -> objeto cru | null            loadState() -> { lastRunMs } | null     saveState(state)
//  loadBrokers() -> [{ id, name, managerId }]   loadSessions(ids) -> Map(id -> { status, lastDisconnectAtMs })
//  loadQueueRows(sinceIso, untilIso) -> [{ broker_id, source, status, sent_at, delivered_at }]
//  loadRecipients(broker) -> [{ email, name }]  claimAlert(key, payload) -> boolean (false = já alertado)
//  releaseAlert(key)                            sendEmail({ to, subject, text, html }) -> { sent: true } | { skipped: true, reason }
export async function runDeliveryMonitor({ nowMs = Date.now(), deps, force = false }) {
  const clock = saoPauloDateMinutes(nowMs);
  if (!clock) return { skipped: "relogio_invalido" };
  if (clock.weekday === 0) return { skipped: "domingo" };
  const state = await deps.loadState();
  if (!force && state?.lastRunMs && nowMs - state.lastRunMs < DELIVERY_EVAL_INTERVAL_MS) return { skipped: "avaliado_ha_menos_de_1h" };

  const config = resolveMonitorConfig(await deps.loadConfig());
  const brokers = await deps.loadBrokers();
  const rows = await deps.loadQueueRows(new Date(nowMs - DELIVERY_MAX_AGE_MS).toISOString(), new Date(nowMs - DELIVERY_MIN_AGE_MS).toISOString());
  const sessions = await deps.loadSessions(brokers.map((broker) => broker.id));
  const dates = relevantDates(nowMs);

  const summary = { evaluatedBrokers: 0, ignored: {}, alerts: [], pendingAlerts: 0, failed: [] };
  for (const broker of brokers) {
    const result = evaluateBrokerDelivery({ rows: rows.filter((row) => row.broker_id === broker.id), nowMs, session: sessions.get(broker.id), config });
    if (result.skipped) { summary.ignored[broker.id] = result.skipped; continue; }
    summary.evaluatedBrokers += 1;
    for (const group of result.groups) {
      if (!group.belowThreshold || !dates.has(group.date)) continue;
      if (summary.alerts.length >= config.maxAlertsPerRun) { summary.pendingAlerts += 1; continue; }
      const key = deliveryAlertKey(group.date, broker.id);
      const claimed = await deps.claimAlert(key, { brokerId: broker.id, date: group.date, percent: group.percent, evaluated: group.evaluated, delivered: group.delivered, alertedAt: new Date(nowMs).toISOString() });
      if (!claimed) continue; // já alertado hoje para este corretor
      try {
        const recipients = await deps.loadRecipients(broker);
        if (!recipients.length) throw new Error("sem destinatário (gestora) cadastrado");
        for (const recipient of recipients) {
          const email = buildDeliveryAlertEmail({ recipientName: recipient.name, brokerName: broker.name, date: group.date, percent: group.percent, evaluated: group.evaluated, delivered: group.delivered, thresholdPercent: config.thresholdPercent });
          const sent = await deps.sendEmail({ to: recipient.email, ...email });
          if (!sent?.sent) throw new Error(`e-mail não enviado (${sent?.reason || "sem detalhe"})`);
        }
        summary.alerts.push({ brokerId: broker.id, date: group.date, percent: group.percent, evaluated: group.evaluated });
      } catch (error) {
        // Libera a marca para a próxima avaliação tentar de novo — nunca perde o alerta em silêncio.
        await deps.releaseAlert(key);
        summary.failed.push({ brokerId: broker.id, date: group.date, error: String(error?.message || error).slice(0, 200) });
      }
    }
  }
  await deps.saveState({ lastRunMs: nowMs, lastRunAt: new Date(nowMs).toISOString(), summary });
  return summary;
}
