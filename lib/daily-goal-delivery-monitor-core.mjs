// Monitor de TAXA DE ENTREGA da automação da Meta Diária (WhatsApp individual) — REGRA OFICIAL (dono, 2026-10-04).
// Puro (sem banco, sem "server-only"): o acesso ao banco e o envio do e-mail entram por `deps` (injetáveis em teste).
// Testado em tests/daily-goal-delivery-monitor.test.mjs.
//
// O que faz: por corretor e por dia (America/Sao_Paulo), % de mensagens ENVIADAS PELA AUTOMAÇÃO (fila da Meta
// Diária, status "sent") que tiveram confirmação (`delivered_at` = 1º sinal do WhatsApp: 1 OU 2 tiques). Queda abaixo
// do limite (padrão 60%, com amostra mínima de 20) gera UM e-mail à gestora, no máximo um por corretor por dia.
//
// TENDÊNCIA (dono, 2026-10-10, só alerta — também NÃO pausa): além do limite fixo, avisa a gestora (a) quando a taxa do
// dia cai MAIS de 20 pontos abaixo da média dos 7 dias anteriores do PRÓPRIO corretor e (b) quando as últimas 10
// mensagens seguidas (já com 1 h para o recibo chegar) não tiveram nenhum tique.
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
export const TREND_DROP_POINTS = 20; // queda (em pontos percentuais) vs. a média dos dias anteriores do corretor
export const TREND_BASELINE_DAYS = 7;
export const TREND_BASELINE_MIN_DAYS = 3; // dias anteriores com amostra mínima para existir uma "média"
export const TREND_BASELINE_MIN_SAMPLE = 10; // mensagens avaliadas por dia anterior
export const NO_TICK_STREAK = 10; // últimas N mensagens seguidas sem nenhum tique
export const DELIVERY_CONFIG_SETTING_ID = "daily_goal_delivery_monitor";
export const DELIVERY_STATE_SETTING_ID = "daily_goal_delivery_monitor_state";

// Config opcional lida de crm_settings (sem exigir migration). Valor inválido volta ao padrão.
export function resolveMonitorConfig(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const threshold = Number(value.thresholdPercent);
  const sample = Number(value.minSample);
  const maxAlerts = Number(value.maxAlertsPerRun);
  const dropPoints = Number(value.trendDropPoints);
  const streak = Number(value.noTickStreak);
  return {
    trendDropPoints: Number.isFinite(dropPoints) && dropPoints > 0 && dropPoints < 100 ? dropPoints : TREND_DROP_POINTS,
    trendBaselineDays: TREND_BASELINE_DAYS,
    trendBaselineMinDays: TREND_BASELINE_MIN_DAYS,
    trendBaselineMinSample: TREND_BASELINE_MIN_SAMPLE,
    noTickStreak: Number.isInteger(streak) && streak >= 3 ? streak : NO_TICK_STREAK,
    thresholdPercent: Number.isFinite(threshold) && threshold > 0 && threshold <= 100 ? threshold : DELIVERY_ALERT_THRESHOLD_PERCENT,
    minSample: Number.isInteger(sample) && sample >= 1 ? sample : DELIVERY_MIN_SAMPLE,
    maxAlertsPerRun: Number.isInteger(maxAlerts) && maxAlerts >= 1 ? maxAlerts : DELIVERY_MAX_ALERTS_PER_RUN
  };
}

// Chave determinística do alerta (um por corretor por dia) — grava em crm_settings, a chave primária garante a unicidade.
export function deliveryAlertKey(date, brokerId) {
  return `delivery_alert:${date}:${brokerId}`;
}

// Mensagem da automação (Meta Diária, "sent") que entra na conta: 1–24 h de idade (ou sem teto de idade para o
// histórico), fora de domingo, dentro do horário (06:30–15:30) e depois da última queda da sessão.
// -> { sentMs, date } | null
function qualifyingRow(row, { nowMs, disconnectMs, maxAgeMs = DELIVERY_MAX_AGE_MS }) {
  if ((row.source || "meta") !== "meta" || row.status !== "sent") return null;
  const sentMs = new Date(row.sent_at || "").getTime();
  if (Number.isNaN(sentMs)) return null;
  const age = nowMs - sentMs;
  if (age < DELIVERY_MIN_AGE_MS || age > maxAgeMs) return null;
  const clock = saoPauloDateMinutes(sentMs);
  if (!clock || clock.weekday === 0) return null; // domingo
  if (clock.minutes < WINDOW_START_MINUTES || clock.minutes > WINDOW_END_MINUTES) return null; // fora do horário
  if (disconnectMs !== null && sentMs < disconnectMs) return null; // recibos podem ter se perdido na queda
  return { sentMs, date: clock.date };
}

function groupByDate(rows, context) {
  const byDate = new Map();
  for (const row of rows || []) {
    const q = qualifyingRow(row, context);
    if (!q) continue;
    const group = byDate.get(q.date) || { date: q.date, evaluated: 0, delivered: 0 };
    group.evaluated += 1;
    if (row.delivered_at) group.delivered += 1;
    byDate.set(q.date, group);
  }
  return byDate;
}

const disconnectOf = (session) => (Number.isFinite(session?.lastDisconnectAtMs) ? session.lastDisconnectAtMs : null);
const roundPercent = (delivered, evaluated) => Math.round((delivered / evaluated) * 1000) / 10;

// Avalia UM corretor. `rows` = linhas de daily_goal_auto_queue [{ source, status, sent_at, delivered_at }];
// `session` = { status, lastDisconnectAtMs }. Devolve { skipped } ou { groups: [{ date, evaluated, delivered, percent,
// enoughSample, belowThreshold }] } (um grupo por dia de São Paulo).
export function evaluateBrokerDelivery({ rows, nowMs, session, config = resolveMonitorConfig() }) {
  if (!session || session.status !== "connected") return { skipped: "sessao_desconectada" };
  const byDate = groupByDate(rows, { nowMs, disconnectMs: disconnectOf(session) });
  const groups = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((group) => {
    const percent = roundPercent(group.delivered, group.evaluated);
    const enoughSample = group.evaluated >= config.minSample;
    return { ...group, percent, enoughSample, belowThreshold: enoughSample && percent < config.thresholdPercent };
  });
  return { groups };
}

function shiftDate(date, days) {
  const base = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(base) ? "" : new Date(base + days * 86400000).toISOString().slice(0, 10);
}

// TENDÊNCIA (dono, 2026-10-10) — só alerta, nunca pausa. `groups` = resultado de evaluateBrokerDelivery (dia atual e
// anterior); `history` = linhas do corretor dos últimos ~8 dias; `rows` = as de 1–24 h (para a sequência sem tique).
// (a) queda: taxa do dia (amostra suficiente e AINDA acima do limite fixo — abaixo dele o alerta do limite já cobre)
//     mais de `trendDropPoints` pontos abaixo da média ponderada dos 7 dias anteriores do próprio corretor (exige
//     `trendBaselineMinDays` dias anteriores com `trendBaselineMinSample` mensagens cada);
// (b) sequência: as `noTickStreak` mensagens mais recentes (já com 1 h para o recibo) sem nenhum tique.
// -> [{ type: "trend" | "streak", date, ... }]
export function evaluateBrokerTrends({ groups = [], history = [], rows = [], nowMs, session, config = resolveMonitorConfig() }) {
  if (!session || session.status !== "connected") return [];
  const disconnectMs = disconnectOf(session);
  const alerts = [];

  const past = [...groupByDate(history, { nowMs, disconnectMs, maxAgeMs: Infinity }).values()];
  for (const group of groups) {
    if (!group.enoughSample || group.belowThreshold) continue;
    const from = shiftDate(group.date, -config.trendBaselineDays);
    const base = past.filter((day) => day.date < group.date && day.date >= from && day.evaluated >= config.trendBaselineMinSample);
    if (base.length < config.trendBaselineMinDays) continue;
    const baseEvaluated = base.reduce((sum, day) => sum + day.evaluated, 0);
    const baselinePercent = roundPercent(base.reduce((sum, day) => sum + day.delivered, 0), baseEvaluated);
    const drop = Math.round((baselinePercent - group.percent) * 10) / 10;
    if (drop > config.trendDropPoints) {
      alerts.push({ type: "trend", date: group.date, percent: group.percent, evaluated: group.evaluated, delivered: group.delivered, baselinePercent, baselineDays: base.length, drop });
    }
  }

  const recent = (rows || [])
    .map((row) => ({ row, q: qualifyingRow(row, { nowMs, disconnectMs }) }))
    .filter((item) => item.q)
    .sort((a, b) => b.q.sentMs - a.q.sentMs)
    .slice(0, config.noTickStreak);
  if (recent.length >= config.noTickStreak && recent.every((item) => !item.row.delivered_at)) {
    alerts.push({ type: "streak", date: recent[0].q.date, count: recent.length });
  }
  return alerts;
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

const NO_PAUSE_GUIDE = (brokerName) => `O que fazer: confira se o celular de ${brokerName} está ligado, com internet e com o WhatsApp conectado ao CRM. Se quiser pausar os disparos dessa pessoa, vá em Gestão > Meta Diária > aba Automação, no cartão de ${brokerName}, e clique em "Pausar". Para voltar, clique em "Retomar".`;

function wrapEmail(subject, paragraphs) {
  const text = paragraphs.join("\n\n");
  const html = `<div style="font-family:Arial,sans-serif;color:#0d2b4f;line-height:1.6;max-width:620px">${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</div>`;
  return { subject, text, html };
}

const pt = (n) => String(n).replace(".", ",");

// E-mail da QUEDA de tendência (dono, 2026-10-10). Só aviso: nada é pausado.
export function buildTrendAlertEmail({ recipientName = "", brokerName, date, percent, baselinePercent, baselineDays, drop, evaluated, delivered }) {
  const dateBr = formatDateBr(date);
  return wrapEmail(`Queda na entrega do WhatsApp: ${brokerName} (${pt(percent)}% em ${dateBr})`, [
    `Olá${recipientName ? `, ${recipientName}` : ""}.`,
    `A taxa de entrega das mensagens automáticas (Meta Diária) de ${brokerName} no dia ${dateBr} ficou em ${pt(percent)}%, ${pt(drop)} pontos abaixo da média dos últimos ${baselineDays} dias dela(e) (${pt(baselinePercent)}%).`,
    `Foram avaliadas ${evaluated} mensagens enviadas entre 1 e 24 horas atrás; ${delivered} tiveram confirmação de entrega (pelo menos 1 tique no WhatsApp).`,
    "Uma queda forte e repentina costuma aparecer antes de um bloqueio ou restrição do número, mas também pode ser celular desligado, sem internet ou recibos atrasados. É só um aviso: NADA foi pausado automaticamente.",
    NO_PAUSE_GUIDE(brokerName),
    "Este aviso é enviado no máximo uma vez por corretor por dia. Mensagem automática do CRM da Matheus Machado Imóveis."
  ]);
}

// E-mail da SEQUÊNCIA sem nenhum tique (dono, 2026-10-10). Só aviso: nada é pausado.
export function buildNoTickAlertEmail({ recipientName = "", brokerName, date, count }) {
  const dateBr = formatDateBr(date);
  return wrapEmail(`Nenhuma mensagem confirmada: ${brokerName} (${count} seguidas, até ${dateBr})`, [
    `Olá${recipientName ? `, ${recipientName}` : ""}.`,
    `As últimas ${count} mensagens automáticas (Meta Diária) de ${brokerName}, enviadas há mais de 1 hora, ficaram SEM nenhum tique de confirmação do WhatsApp (nem 1 tique).`,
    "Isso pode indicar que o número está bloqueado ou restrito, mas também pode ser celular desligado ou sem internet, ou a conexão do CRM instável. É só um aviso: NADA foi pausado automaticamente.",
    NO_PAUSE_GUIDE(brokerName),
    "Este aviso é enviado no máximo uma vez por corretor por dia. Mensagem automática do CRM da Matheus Machado Imóveis."
  ]);
}

export const deliveryTrendKey = (date, brokerId) => `delivery_trend:${date}:${brokerId}`;
export const deliveryStreakKey = (date, brokerId) => `delivery_streak:${date}:${brokerId}`;

// Orquestração do monitor. `deps` (todos injetáveis; nenhuma chamada real em teste):
//  loadConfig() -> objeto cru | null            loadState() -> { lastRunMs } | null     saveState(state)
//  loadBrokers() -> [{ id, name, managerId }]   loadSessions(ids) -> Map(id -> { status, lastDisconnectAtMs })
//  loadQueueRows(sinceIso, untilIso) -> [{ broker_id, source, status, sent_at, delivered_at }]
//  loadHistoryRows(sinceIso, untilIso) -> idem, ~8 dias (OPCIONAL: sem ela não há alerta de tendência)
//  loadRecipients(broker) -> [{ email, name }]  claimAlert(key, payload) -> boolean (false = já alertado)
//  releaseAlert(key)                            sendEmail({ to, subject, text, html }) -> { sent: true } | { skipped, reason }
export async function runDeliveryMonitor({ nowMs = Date.now(), deps, force = false }) {
  const clock = saoPauloDateMinutes(nowMs);
  if (!clock) return { skipped: "relogio_invalido" };
  if (clock.weekday === 0) return { skipped: "domingo" };
  const state = await deps.loadState();
  if (!force && state?.lastRunMs && nowMs - state.lastRunMs < DELIVERY_EVAL_INTERVAL_MS) return { skipped: "avaliado_ha_menos_de_1h" };

  const config = resolveMonitorConfig(await deps.loadConfig());
  const brokers = await deps.loadBrokers();
  const untilIso = new Date(nowMs - DELIVERY_MIN_AGE_MS).toISOString();
  const rows = await deps.loadQueueRows(new Date(nowMs - DELIVERY_MAX_AGE_MS).toISOString(), untilIso);
  // Histórico dos 7 dias anteriores (+1 de folga) só para a tendência; falha aqui nunca derruba o alerta do limite fixo.
  let historyRows = [];
  let historyError = null;
  if (deps.loadHistoryRows) {
    try {
      historyRows = await deps.loadHistoryRows(new Date(nowMs - (config.trendBaselineDays + 1) * DELIVERY_MAX_AGE_MS).toISOString(), untilIso);
    } catch (error) {
      historyError = String(error?.message || error).slice(0, 200);
    }
  }
  const sessions = await deps.loadSessions(brokers.map((broker) => broker.id));
  const dates = relevantDates(nowMs);

  const summary = { evaluatedBrokers: 0, ignored: {}, alerts: [], trendAlerts: [], pendingAlerts: 0, failed: [], ...(historyError ? { historyError } : {}) };

  // Reserva a marca (1 alerta por chave), manda o e-mail a cada destinatária e libera a marca se algo falhar.
  const dispatchAlert = async ({ broker, key, payload, buildEmail, onSent }) => {
    if (summary.alerts.length + summary.trendAlerts.length >= config.maxAlertsPerRun) { summary.pendingAlerts += 1; return; }
    const claimed = await deps.claimAlert(key, { brokerId: broker.id, ...payload, alertedAt: new Date(nowMs).toISOString() });
    if (!claimed) return; // já alertado hoje para este corretor
    try {
      const recipients = await deps.loadRecipients(broker);
      if (!recipients.length) throw new Error("sem destinatário (gestora) cadastrado");
      for (const recipient of recipients) {
        const sent = await deps.sendEmail({ to: recipient.email, ...buildEmail(recipient) });
        if (!sent?.sent) throw new Error(`e-mail não enviado (${sent?.reason || "sem detalhe"})`);
      }
      onSent();
    } catch (error) {
      // Libera a marca para a próxima avaliação tentar de novo — nunca perde o alerta em silêncio.
      await deps.releaseAlert(key);
      summary.failed.push({ brokerId: broker.id, date: payload.date, error: String(error?.message || error).slice(0, 200) });
    }
  };

  for (const broker of brokers) {
    const brokerRows = rows.filter((row) => row.broker_id === broker.id);
    const session = sessions.get(broker.id);
    const result = evaluateBrokerDelivery({ rows: brokerRows, nowMs, session, config });
    if (result.skipped) { summary.ignored[broker.id] = result.skipped; continue; }
    summary.evaluatedBrokers += 1;
    for (const group of result.groups) {
      if (!group.belowThreshold || !dates.has(group.date)) continue;
      await dispatchAlert({
        broker,
        key: deliveryAlertKey(group.date, broker.id),
        payload: { date: group.date, percent: group.percent, evaluated: group.evaluated, delivered: group.delivered },
        buildEmail: (recipient) => buildDeliveryAlertEmail({ recipientName: recipient.name, brokerName: broker.name, date: group.date, percent: group.percent, evaluated: group.evaluated, delivered: group.delivered, thresholdPercent: config.thresholdPercent }),
        onSent: () => summary.alerts.push({ brokerId: broker.id, date: group.date, percent: group.percent, evaluated: group.evaluated })
      });
    }
    if (!deps.loadHistoryRows) continue;
    const trends = evaluateBrokerTrends({
      groups: result.groups.filter((group) => dates.has(group.date)),
      history: historyRows.filter((row) => row.broker_id === broker.id),
      rows: brokerRows, nowMs, session, config
    });
    for (const trend of trends) {
      if (!dates.has(trend.date)) continue;
      const base = { broker, onSent: () => summary.trendAlerts.push({ brokerId: broker.id, type: trend.type, date: trend.date }) };
      if (trend.type === "trend") {
        await dispatchAlert({ ...base, key: deliveryTrendKey(trend.date, broker.id), payload: trend, buildEmail: (recipient) => buildTrendAlertEmail({ ...trend, recipientName: recipient.name, brokerName: broker.name }) });
      } else {
        await dispatchAlert({ ...base, key: deliveryStreakKey(trend.date, broker.id), payload: trend, buildEmail: (recipient) => buildNoTickAlertEmail({ ...trend, recipientName: recipient.name, brokerName: broker.name }) });
      }
    }
  }
  await deps.saveState({ lastRunMs: nowMs, lastRunAt: new Date(nowMs).toISOString(), summary });
  return summary;
}
