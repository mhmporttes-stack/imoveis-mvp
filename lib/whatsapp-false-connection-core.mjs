// "Conexão falsa" do WhatsApp individual (REGRA OFICIAL — dono, 2026-10-13): a sessão diz "conectado", mas o
// WhatsApp não entrega nada (caso Bruna Nº1: 500/428 em loop e 26 h sem receber). Regras PURAS (testes:
// tests/whatsapp-false-connection.test.mjs). Servidor: lib/whatsapp-false-connection.js (cron whatsapp-flows).
//
// SÓ COM EVIDÊNCIA DE FALHA (dono, 2026-10-23 — "toda hora aparece que o WhatsApp está conectado sem receber, com a opção
// de desconectar"): o alarme por SILÊNCIO (X horas sem receber) e por queda repetida acabou. Em 23/10 ele disparou 12 vezes
// para 5 números; em 8 as mensagens estavam entrando e saindo normalmente (corretor sem conversa é normal), e cada aviso
// levava o corretor a desconectar e ler o QR de novo — pareamento repetido é agravante de banimento (Caroline, 23/10).
// Evidência aceita (sempre medida DEPOIS da última (re)conexão do número):
//   - "unconfirmed_sends": ≥ 3 mensagens saíram por este número para ≥ 3 conversas diferentes, a mais antiga há ≥ 20 min,
//     e desde a primeira NADA voltou do WhatsApp (nenhuma recebida entrou, nenhum "entregue/lida" chegou);
//   - "pipeline_stuck": o vigia do serviço achou a fila de mensagens travada ≥ 2 vezes em 1 h (o reinício dele não
//     resolveu) e nada voltou desde a última.
// Ordem: evidência -> o CRM reinicia a sessão no serviço (mesmas credenciais, sem QR) -> só se a evidência continuar depois
// do reinício marca o número e avisa (corretor: 1 vez por episódio e no máximo 1 a cada 12 h por número).

export const FALSE_CONNECTION_ALERT_KEY = "whatsapp_false_connection";
export const FLAP_WINDOW_MS = 60 * 60 * 1000;
export const FLAP_STATUS_CODES = Object.freeze([500, 428]);
export const RECENT_DROPS_WINDOW_MS = 6 * 60 * 60 * 1000; // quedas 500/428 nas últimas 6 h (só para a desconexão automática)
export const BUSINESS_START_HOUR = 8;
export const BUSINESS_END_HOUR = 19;

export const EVIDENCE_REASONS = Object.freeze(["unconfirmed_sends", "pipeline_stuck"]);
export const MIN_CONNECTED_MS = 15 * 60 * 1000; // acabou de (re)conectar: não decide nada
export const SEND_WINDOW_MS = 90 * 60 * 1000; // envios considerados: dos últimos 90 min…
export const SEND_MIN_AGE_MS = 20 * 60 * 1000; // …com pelo menos 20 min (tempo para o "entregue" voltar)
export const MIN_UNCONFIRMED_SENDS = 3;
export const MIN_UNCONFIRMED_CONVERSATIONS = 3;
export const STUCK_WINDOW_MS = 60 * 60 * 1000;
export const MIN_STUCK_EVENTS = 2;
export const STUCK_SETTLE_MS = 10 * 60 * 1000; // espera depois do último travamento (o vigia já reiniciou)
export const RESTART_COOLDOWN_MS = 3 * 60 * 60 * 1000; // um reinício pedido pelo CRM vale por 3 h; depois disso tenta de novo antes de avisar
export const BROKER_ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // no máximo 1 aviso ao corretor por número a cada 12 h

// Marília = America/Sao_Paulo = UTC-3 o ano todo (sem horário de verão desde 2019).
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const toMs = (value) => {
  const time = typeof value === "number" ? value : new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? time : 0;
};

// Quantas horas ÚTEIS (seg–sex, 08–19 em Marília) existem entre dois instantes.
export function businessHoursBetween(fromValue, toValue) {
  const from = toMs(fromValue);
  const to = toMs(toValue);
  if (!from || to <= from) return 0;
  let total = 0;
  // Dia local de Marília = dia UTC deslocado em 3 h.
  let dayStart = Math.floor((from - SP_OFFSET_MS) / DAY_MS) * DAY_MS + SP_OFFSET_MS;
  for (; dayStart < to; dayStart += DAY_MS) {
    const weekday = new Date(dayStart - SP_OFFSET_MS).getUTCDay(); // 0 dom … 6 sáb
    if (weekday === 0 || weekday === 6) continue;
    const open = dayStart + BUSINESS_START_HOUR * HOUR_MS;
    const close = dayStart + BUSINESS_END_HOUR * HOUR_MS;
    const start = Math.max(open, from);
    const end = Math.min(close, to);
    if (end > start) total += end - start;
  }
  return total / HOUR_MS;
}

// Evidência de que o número NÃO está funcionando (nunca só a falta de mensagem).
// sends: [{ createdAt, conversationId }] mensagens que saíram por este número (sem histórico);
// lifeAt: último sinal de vida do WhatsApp neste número (recebida que entrou, "entregue" ou "lida" que chegou);
// stuckAts: horários dos `pipeline_stuck` do vigia do serviço; since: última (re)conexão do número.
// -> "unconfirmed_sends" | "pipeline_stuck" | null
export function detectFailureEvidence({ sends = [], lifeAt = null, stuckAts = [], since = null, now = Date.now() } = {}) {
  const start = toMs(since);
  const life = toMs(lifeAt);
  const stucks = (stuckAts || []).map(toMs).filter((time) => time && time >= start && time > now - STUCK_WINDOW_MS && time <= now).sort((a, b) => a - b);
  if (stucks.length >= MIN_STUCK_EVENTS) {
    const last = stucks[stucks.length - 1];
    if (now - last >= STUCK_SETTLE_MS && life < last) return "pipeline_stuck";
  }
  const window = (sends || [])
    .map((send) => ({ at: toMs(send?.createdAt), conversationId: send?.conversationId || "" }))
    .filter((send) => send.at && send.at >= start && send.at >= now - SEND_WINDOW_MS && send.at <= now - SEND_MIN_AGE_MS);
  if (window.length < MIN_UNCONFIRMED_SENDS) return null;
  if (new Set(window.map((send) => send.conversationId)).size < MIN_UNCONFIRMED_CONVERSATIONS) return null;
  const first = Math.min(...window.map((send) => send.at));
  return life >= first ? null : "unconfirmed_sends";
}

// O que fazer com um número agora. row: { status, last_connected_at, silent_since, silent_reason };
// lastRestartAt: último reinício pedido pelo CRM (telemetria `pipeline_restart` kind crm).
// -> { action: "none" | "hold" | "clear" | "restart" | "alert", reason? }
//   restart = tenta se recuperar sozinho (sem QR, sem marcar, sem avisar); alert = marca e avisa (recuperação falhou).
export function decideFalseConnectionStep({ row = null, evidence = null, lifeAt = null, lastRestartAt = null, now = Date.now() } = {}) {
  const marked = Boolean(row?.silent_since);
  if (!row || row.status !== "connected") return { action: marked ? "clear" : "none" };
  // Marca antiga (silêncio/queda, antes de 23/10) não vale mais: sai na hora.
  if (marked && !EVIDENCE_REASONS.includes(row.silent_reason)) return { action: "clear" };
  const connectedAt = toMs(row.last_connected_at);
  if (!connectedAt || now - connectedAt < MIN_CONNECTED_MS) return { action: "hold" };
  if (!evidence) {
    if (!marked) return { action: "none" };
    // Marcado: só sai quando o WhatsApp der sinal de vida ou o número reconectar depois da marca (a evidência
    // envelhecer sozinha não prova que voltou a funcionar).
    const since = toMs(row.silent_since);
    return toMs(lifeAt) > since || connectedAt > since ? { action: "clear" } : { action: "hold" };
  }
  if (marked) return { action: "alert", reason: evidence };
  // Travamento repetido: o vigia do serviço já reiniciou a sessão e não resolveu.
  if (evidence === "pipeline_stuck") return { action: "alert", reason: evidence };
  const restartedAt = toMs(lastRestartAt);
  if (!restartedAt || now - restartedAt >= RESTART_COOLDOWN_MS) return { action: "restart", reason: evidence };
  return { action: "alert", reason: evidence };
}

// Pode avisar o corretor deste número de novo? lastBrokerAlertAt: último aviso dele para este número (qualquer episódio).
export function canAlertBrokerAgain(lastBrokerAlertAt, now = Date.now()) {
  const last = toMs(lastBrokerAlertAt);
  return !last || now - last >= BROKER_ALERT_COOLDOWN_MS;
}

// Estado exibido na tela para o número de uma sessão: "down" (desconectado de verdade), "silent" (conexão falsa) ou "ok".
// "reconnecting"/"connecting" é tentativa automática: não pinta nada (evita piscar rosa a cada oscilação).
const DOWN_STATUSES = new Set(["disconnected", "error", "qr_required", "pairing_code_required"]);
export function sessionUiState(row) {
  if (!row) return "ok";
  const status = row.status || "disconnected";
  if (DOWN_STATUSES.has(status)) return "down";
  if (status === "connected" && row.silent_since) return "silent";
  return "ok";
}
export const isSessionImpaired = (state) => state === "down" || state === "silent";

// Chaves da Central: UMA entrega por episódio (silent_since) para o corretor e para a equipe — nada de lembrete repetido.
// O teto de 12 h por número (canAlertBrokerAgain) vale entre episódios.
export const brokerKeyPrefix = (keyId) => `wa_false_b:${keyId}:`;
export const brokerDedupeKey = (keyId, since) => `${brokerKeyPrefix(keyId)}${new Date(toMs(since) || 0).toISOString()}`;
export const staffKeyPrefix = (keyId) => `wa_false_s:${keyId}:`;
export const staffDedupeKey = (keyId, since) => `${staffKeyPrefix(keyId)}${new Date(toMs(since) || 0).toISOString()}`;

const REASON_TEXT = Object.freeze({
  unconfirmed_sends: "as mensagens enviadas não estão sendo confirmadas pelo WhatsApp",
  pipeline_stuck: "o WhatsApp parou de entregar as mensagens ao CRM"
});
const reasonText = (reason) => REASON_TEXT[reason] || REASON_TEXT.unconfirmed_sends;
// Texto antigo (13/10) gravado na definição do banco: mandava desconectar e ler o QR de cara. Se o dono não personalizou,
// vale o texto novo; texto personalizado na tela é respeitado.
export const LEGACY_DEFAULT_BODY = "O WhatsApp{numero} de {corretor} aparece como conectado, mas não está recebendo mensagens. Abra o ícone do WhatsApp no topo da tela, desconecte e conecte de novo pelo QR Code.";
const DEFAULT_BODY = "O WhatsApp{numero} de {corretor} está conectado, mas {motivo}. O CRM já tentou reconectar sozinho (sem QR Code) e não resolveu. Peça para conferir se o celular está ligado e com internet.";
const OWN_BODY = "Seu WhatsApp{numero} está conectado, mas {motivo}. O CRM já tentou reconectar sozinho e não resolveu. Confira se o celular está ligado e com internet. Se continuar, toque no ícone do WhatsApp no topo da tela.";

// Entregas: o corretor (texto em 2ª pessoa) e os destinatários da equipe (gestora + administradores).
// definition ausente = texto padrão ligado; definition.enabled === false = desligado pelo dono.
export function buildFalseConnectionDeliveries({ definition = null, brokerId, brokerName = "", slot = 1, staffIds = [], brokerKey, staffKey, reason = "unconfirmed_sends" } = {}) {
  if (!brokerId || definition?.enabled === false) return [];
  const numero = Number(slot) === 2 ? " (Número 2)" : "";
  const name = String(brokerName || "").trim() || "um corretor";
  const motivo = reasonText(reason);
  const title = definition?.title || "WhatsApp conectado, mas sem receber";
  const custom = definition?.body_template && definition.body_template !== LEGACY_DEFAULT_BODY ? definition.body_template : null;
  const template = custom || DEFAULT_BODY;
  const context = (extra) => ({ source: FALSE_CONNECTION_ALERT_KEY, broker_id: brokerId, slot: Number(slot) === 2 ? 2 : 1, reason, ...extra });
  const rows = [];
  if (brokerKey) {
    rows.push({
      definition_id: definition?.id || null, recipient_id: brokerId, kind: "important", title,
      body: OWN_BODY.replace(/\{numero\}/g, numero).replace(/\{motivo\}/g, motivo), context: context({ link: "/admin/chat", push_kind: "whatsapp_connection" }), dedupe_key: brokerKey
    });
  }
  if (staffKey) {
    for (const recipientId of [...new Set(staffIds)].filter((id) => id && id !== brokerId)) {
      rows.push({
        definition_id: definition?.id || null, recipient_id: recipientId, kind: "important", title,
        body: template.replace(/\{numero\}/g, numero).replace(/\{corretor\}/g, name).replace(/\{motivo\}/g, motivo), context: context({ link: "/admin/meta-diaria" }), dedupe_key: staffKey
      });
    }
  }
  return rows;
}

// Desconexão automática (REGRA OFICIAL — dono, 2026-10-13): número marcado por SILÊNCIO que também cai com 500/428 repetidas
// vezes (reconexão automática que não resolve nada, caso Bruna Nº1) deixa de fingir que está conectado: o CRM usa o "desconectar"
// de sempre (sai da sessão, apaga as credenciais e para as reconexões); o número só volta quando o corretor ler o QR Code.
// Desde 2026-10-23 só vale para número marcado por EVIDÊNCIA de falha (o reinício sem QR já foi tentado e não resolveu);
// silêncio sozinho nunca mais marca (em 23/10 o silêncio desconectou o Eduardo duas vezes com as mensagens funcionando).
export const AUTO_DISCONNECT_MIN_DROPS_6H = 3;
export const AUTO_DISCONNECT_GRACE_MS = 30 * 60 * 1000; // tempo marcado antes (um sinal de vida nesse prazo desmarca)
export const AUTO_DISCONNECT_ERROR = "silent_auto_disconnect";
export function shouldAutoDisconnect({ verdict = null, recentDrops = 0, silentSince = null, now = Date.now() } = {}) {
  if (!verdict?.suspect || !EVIDENCE_REASONS.includes(verdict.reason)) return false;
  if (Number(recentDrops) < AUTO_DISCONNECT_MIN_DROPS_6H) return false;
  const since = toMs(silentSince);
  return Boolean(since) && now - since >= AUTO_DISCONNECT_GRACE_MS;
}

export const autoDisconnectKeyPrefix = (keyId) => `wa_false_x:${keyId}:`;
export const autoDisconnectKey = (keyId, since) => `${autoDisconnectKeyPrefix(keyId)}${new Date(toMs(since) || 0).toISOString()}`;

// Aviso ao corretor de que o CRM desconectou o número (ele só precisa ler o QR Code de novo).
export function buildAutoDisconnectDelivery({ definition = null, brokerId, slot = 1, dedupeKey } = {}) {
  if (!brokerId || !dedupeKey || definition?.enabled === false) return null;
  const numero = Number(slot) === 2 ? " (Número 2)" : "";
  return {
    definition_id: definition?.id || null, recipient_id: brokerId, kind: "important", title: "Seu WhatsApp foi desconectado",
    body: `Seu WhatsApp${numero} aparecia como conectado, mas não estava recebendo mensagens, então foi desconectado. Toque no ícone do WhatsApp no topo da tela e leia o QR Code de novo.`,
    context: { source: FALSE_CONNECTION_ALERT_KEY, action: "auto_disconnect", broker_id: brokerId, slot: Number(slot) === 2 ? 2 : 1, link: "/admin/chat", push_kind: "whatsapp_connection" },
    dedupe_key: dedupeKey
  };
}

// Mesma conta de WhatsApp ligada nos DOIS números do mesmo corretor (caso Ketlin, 2026-10-15: Nº1 e Nº2 "trabalho" com o mesmo
// telefone). Cada mensagem chega em uma das duas sessões, as conversas se duplicam por número e as respostas citadas perdem a
// original. Regra: uma conta só pode estar ligada UMA vez por corretor; o número de menor ordem fica e os outros são desconectados.
// rows: linhas de whatsapp_individual_sessions { user_id, slot, status, phone_number }. -> linhas a desconectar.
export const DUPLICATE_NUMBER_ERROR = "same_number_other_slot";
export function findDuplicateNumberSessions(rows = []) {
  const groups = new Map();
  for (const row of rows || []) {
    const phone = String(row?.phone_number || "").replace(/\D/g, "");
    if (!row?.user_id || !phone || row.status !== "connected") continue;
    const key = `${row.user_id}:${phone}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const extra = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (Number(a.slot) || 1) - (Number(b.slot) || 1));
    extra.push(...sorted.slice(1));
  }
  return extra;
}

export const duplicateNumberKey = (keyId) => `wa_dup:${keyId}`;
export function buildDuplicateNumberDelivery({ brokerId, keepSlot = 1, slot = 2, dedupeKey } = {}) {
  if (!brokerId || !dedupeKey) return null;
  const keep = Number(keepSlot) === 2 ? "Número 2" : "Número 1";
  const gone = Number(slot) === 2 ? "Número 2" : "Número 1";
  return {
    definition_id: null, recipient_id: brokerId, kind: "important", title: "Mesmo WhatsApp conectado duas vezes",
    body: `O WhatsApp que você conectou no ${gone} é o mesmo do ${keep}. Conectar a mesma conta duas vezes duplica as conversas e embaralha as respostas, então o ${gone} foi desconectado. Para usar um segundo número, conecte no ${gone} um WhatsApp de outro chip.`,
    context: { source: FALSE_CONNECTION_ALERT_KEY, action: "duplicate_number", broker_id: brokerId, slot: Number(slot) === 2 ? 2 : 1, link: "/admin/chat", push_kind: "whatsapp_connection" },
    dedupe_key: dedupeKey
  };
}
