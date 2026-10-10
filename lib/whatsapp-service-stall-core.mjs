// Alerta de SERVIÇO DO WHATSAPP PARADO (REGRA OFICIAL — dono, 2026-10-10, WA-22). Regras PURAS
// (testes: tests/whatsapp-service-stall.test.mjs). Servidor: lib/whatsapp-service-stall.js, chamado pelo cron
// existente `whatsapp-flows` (sem cron novo).
//
// Sinal: o microsserviço renova o lease (whatsapp_service_lease.heartbeat_at) a cada ~15 s (src/lease.js). Sem
// renovar há mais de STALL_THRESHOLD_MS = serviço fora do ar (crash, Railway parado, deploy que não voltou) — nenhum
// número de corretor está conectado de verdade, mesmo que o banco ainda diga 'connected'.
// Destinatários EXPLÍCITOS: administradores gerais ativos (AL-PRIV: nunca gestora/corretor por este caminho).
// Idempotência: 1 alerta por EPISÓDIO = o último heartbeat conhecido (mesmo travamento = mesma chave; UNIQUE da Central).

export const SERVICE_STALL_ALERT_KEY = "whatsapp_service_stalled";
// 20 renovações perdidas seguidas (renova a cada 15 s; TTL 60 s). Folga para deploy/restart normal do Railway.
export const STALL_THRESHOLD_MS = 5 * 60 * 1000;
export const STALL_KEY_PREFIX = "wa_svc_stalled:";
export const STALL_LINK = "/admin/meta-diaria";

const toMs = (value) => {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? time : null;
};

export const stallDedupeKey = (episodeIso) => `${STALL_KEY_PREFIX}${episodeIso}`;

// lease: { heartbeat_at } da linha whatsapp_service_lease (null = nunca criada: sem lease não há o que medir).
// -> { stalled: false } | { stalled: true, episode, minutes, dedupeKey }
export function decideServiceStall({ lease = null, now = Date.now(), thresholdMs = STALL_THRESHOLD_MS } = {}) {
  const heartbeat = toMs(lease?.heartbeat_at);
  if (!heartbeat) return { stalled: false };
  const silentMs = now - heartbeat;
  if (silentMs <= thresholdMs) return { stalled: false };
  const episode = new Date(heartbeat).toISOString();
  return { stalled: true, episode, minutes: Math.floor(silentMs / 60_000), dedupeKey: stallDedupeKey(episode) };
}

// Administradores gerais ativos (explícitos).
export function resolveServiceStallRecipients(users = []) {
  return [...new Set(users.filter((user) => user?.role === "admin" && user.status !== "inactive" && !user.disabled_at).map((user) => user.id))].filter(Boolean);
}

const DEFAULT_TITLE = "Serviço do WhatsApp parado";
const DEFAULT_BODY = "O serviço que mantém os WhatsApp dos corretores conectados não responde há {minutos} minutos (último sinal às {horario}). Nenhum número está recebendo ou enviando mensagens. Verifique o serviço no Railway.";

const horario = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replace(",", " às");
};

// Definição `whatsapp_service_stalled` (editável na Central): existente e desligada -> []; ausente (migration não
// aplicada) -> texto padrão, ligado. Variáveis: {minutos} {horario}.
export function buildServiceStallDeliveries({ definition = null, recipientIds = [], decision } = {}) {
  if (!decision?.stalled || definition?.enabled === false) return [];
  const body = (definition?.body_template || DEFAULT_BODY)
    .replace(/\{minutos\}/g, String(decision.minutes)).replace(/\{horario\}/g, horario(decision.episode));
  return [...new Set(recipientIds)].filter(Boolean).map((recipientId) => ({
    definition_id: definition?.id || null,
    recipient_id: recipientId,
    kind: definition?.kind === "informative" ? "informative" : "important",
    title: definition?.title || DEFAULT_TITLE,
    body,
    context: { source: SERVICE_STALL_ALERT_KEY, last_heartbeat_at: decision.episode, link: STALL_LINK },
    dedupe_key: decision.dedupeKey
  }));
}
