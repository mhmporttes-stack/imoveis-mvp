// Detecção ÚNICA do SERVIÇO do WhatsApp individual fora do ar (WA-13d, REGRA OFICIAL — dono, 2026-11-02). Regras PURAS
// (testes: tests/whatsapp-service-health.test.mjs). Leitura/gravação: lib/whatsapp-service-health.js.
//
// O sinal NUNCA é o status das sessões no banco (ficam "connected" velhos enquanto o serviço está parado). Sinais reais:
//  (1) lease (whatsapp_service_lease.heartbeat_at, renovado a cada ~15 s) sem renovar há mais de LEASE_DOWN_MS;
//  (2) GET /health do serviço falhou HEALTH_FAIL_STREAK vezes SEGUIDAS (leituras espaçadas — corte curto não conta);
//  (3) ao menos SEND_FAIL_COUNT envios do Chat falharam por rede (isServiceCommError) nos últimos SEND_FAIL_WINDOW_MS,
//      contando só os posteriores ao último /health ok (um /health ok mais novo desmente falha antiga).
// Histerese: depois de "fora do ar" só volta com /health ok E lease fresco (sem /health configurado: sem nenhum sinal).
import { isServiceCommError } from "./whatsapp-chat-assist-core.mjs";

export const LEASE_DOWN_MS = 3 * 60 * 1000; // 12 renovações perdidas seguidas (a do alerta WA-22 continua em 5 min)
// 2026-11-04: 3 falhas seguidas (era 2) e prazo de 8 s (era 3 s): pelo Funnel o /health leva 1–2 s e oscilava acima de 3 s, derrubando o
// "no ar" por 20–30 s e levando o botão WhatsApp ao WhatsApp Web com o serviço de pé (03/11 11:17–11:50 e 04/11 08:56).
export const HEALTH_FAIL_STREAK = 3;
export const HEALTH_FAIL_MIN_GAP_MS = 20 * 1000; // duas leituras quase simultâneas (instâncias diferentes) valem uma
export const SEND_FAIL_COUNT = 2;
export const SEND_FAIL_WINDOW_MS = 10 * 60 * 1000;
export const HEALTH_TIMEOUT_MS = 8000;
export const CACHE_UP_MS = 60 * 1000;
export const CACHE_DOWN_MS = 30 * 1000; // fora do ar: confere mais seguido para voltar logo ao Chat
export const SERVICE_HEALTH_SETTING_ID = "whatsapp_service_health";

export const SERVICE_DOWN_NOTICE = "WhatsApp do CRM fora do ar — abrindo o WhatsApp do celular";

const toMs = (value) => {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? time : null;
};

// Resposta do GET /health do serviço -> true quando está de pé E é o dono do lease (serving !== false).
export function isHealthResponseOk(payload) {
  return payload?.ok === true && payload?.serving !== false;
}

// Falhas de envio (linhas status = failed): só as de comunicação com o serviço contam.
export function countNetworkSendFailures(rows = [], { now = Date.now(), lastOkAt = null } = {}) {
  const from = Math.max(now - SEND_FAIL_WINDOW_MS, toMs(lastOkAt) || 0);
  return rows.filter((row) => {
    const at = toMs(row?.failed_at);
    return at && at > from && isServiceCommError(row?.error_message);
  }).length;
}

// prev: estado gravado { status, since, healthFails, lastFailAt, lastOkAt } | null.
// lease: { heartbeat_at } | null (sem lease = nada a medir). ping: true | false | null (null = /health não medido).
// failureRows: linhas { failed_at, error_message } de whatsapp_messages recentes.
// -> { status, down, since, healthFails, lastFailAt, lastOkAt, reasons, transition: null | { type: "down"|"up", since, at } }
export function evaluateServiceHealth({ prev = null, now = Date.now(), lease = null, ping = null, failureRows = [] } = {}) {
  const wasDown = prev?.status === "down";
  const heartbeat = toMs(lease?.heartbeat_at);
  const leaseStale = Boolean(heartbeat) && now - heartbeat > LEASE_DOWN_MS;

  const lastOkAt = ping === true ? new Date(now).toISOString() : prev?.lastOkAt || null;
  let healthFails = Number(prev?.healthFails) || 0;
  let lastFailAt = prev?.lastFailAt || null;
  if (ping === true) healthFails = 0;
  else if (ping === false) {
    const gapOk = !toMs(lastFailAt) || now - toMs(lastFailAt) >= HEALTH_FAIL_MIN_GAP_MS;
    if (gapOk) { healthFails += 1; lastFailAt = new Date(now).toISOString(); }
  }

  const reasons = [];
  if (leaseStale) reasons.push("lease");
  if (healthFails >= HEALTH_FAIL_STREAK) reasons.push("health");
  if (countNetworkSendFailures(failureRows, { now, lastOkAt }) >= SEND_FAIL_COUNT) reasons.push("send_failures");

  // Voltou = /health ok (e lease fresco). Sem /health configurado, voltou = nenhum sinal restante.
  let down;
  if (wasDown) down = ping === null ? reasons.length > 0 : !(ping === true && !leaseStale);
  else down = reasons.length > 0;

  const since = down
    ? (wasDown ? prev.since || new Date(now).toISOString() : (leaseStale && heartbeat ? new Date(heartbeat).toISOString() : new Date(now).toISOString()))
    : null;
  let transition = null;
  if (down && !wasDown) transition = { type: "down", since, at: new Date(now).toISOString() };
  else if (!down && wasDown) transition = { type: "up", since: prev.since || null, at: new Date(now).toISOString() };

  return { status: down ? "down" : "up", down, since, healthFails, lastFailAt, lastOkAt, reasons: down ? (reasons.length ? reasons : ["aguardando_health"]) : [], transition };
}

// Estado que vale a pena gravar (só muda de verdade em queda/volta/contagem de /health — nunca a cada leitura).
export function shouldPersistHealth(prev, next) {
  if (!prev) return next.down || next.healthFails > 0;
  return prev.status !== next.status || (Number(prev.healthFails) || 0) !== next.healthFails;
}

export function toPersistedHealth(next) {
  return { status: next.status, since: next.since, healthFails: next.healthFails, lastFailAt: next.lastFailAt, lastOkAt: next.lastOkAt };
}

const horario = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
};

// Avisos ao dono na Central (informativos, sem OK). Um por episódio: a chave leva o início do episódio.
export const SERVICE_DOWN_EPISODE_KEY_PREFIX = "wa_svc_unreachable:ep:";
export const SERVICE_BACK_EPISODE_KEY_PREFIX = "wa_svc_back:";

export function buildEpisodeNotice(transition, { leaseEpisodeKey = null } = {}) {
  if (!transition?.since) return null;
  if (transition.type === "down") {
    return {
      title: "Serviço do WhatsApp fora do ar",
      body: `Serviço do WhatsApp fora do ar desde ${horario(transition.since)}. Enquanto isso, o botão WhatsApp abre o app/WhatsApp Web do celular. Confira o computador do WhatsApp (serviço MM WhatsApp dos corretores).`,
      // Queda por lease usa a MESMA chave do alerta de serviço parado (WA-22): um aviso só por episódio.
      dedupeKey: leaseEpisodeKey || `${SERVICE_DOWN_EPISODE_KEY_PREFIX}${transition.since}`,
      source: "whatsapp_service_unreachable"
    };
  }
  return {
    title: "Serviço do WhatsApp voltou",
    body: `O serviço do WhatsApp voltou às ${horario(transition.at)} (estava fora do ar desde ${horario(transition.since)}). O botão WhatsApp voltou a abrir o Chat do CRM.`,
    dedupeKey: `${SERVICE_BACK_EPISODE_KEY_PREFIX}${transition.since}`,
    source: "whatsapp_service_back"
  };
}
