// Alerta de SESSÃO DO WHATSAPP QUE EXIGE INTERVENÇÃO HUMANA (gestão do corretor afetado + administrador).
// [COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO — pedido do dono em 2026-10-04; não é regra de negócio ainda registrada em BUSINESS_RULES]
// Regras PURAS (testes: tests/whatsapp-session-attention.test.mjs). Servidor: lib/whatsapp-session-attention.js.
//
// Estados que o microsserviço grava (whatsapp-individual-service/src/session-lifecycle.js) e que ESTE alerta cobre:
//   status 'error'  + last_error 'needs_attention:<motivo>: …'  -> a reconexão automática PAROU (403/440/411/desconhecido)
//   status 'error'  + last_error 'needs_attention:retry_limit: …' -> limite de reconexões esgotado
//   status 'disconnected' + last_error 'qr_expired'  -> QR sem escanear; SÓ alerta se a conta JÁ esteve conectada
//     (QR de uma primeira conexão que ninguém escaneou NÃO é incidente).
// NÃO cobre (de propósito):
//   'reconnecting' / retry agendado ........ tentativa automática normal do sistema
//   401 'disconnected' + 'logged_out' ...... já avisado pelo alerta `whatsapp_connection` (connected/reconnecting -> disconnected)
//   'qr_required' / 'connecting' / 'pairing_code_required' .. só existem depois de o corretor PEDIR a conexão (ação humana em curso)
// A decisão usa o `error` do EVENTO que chegou, nunca o last_error antigo gravado (que sobrevive a um 'connected').

import { renderAlertTemplate } from "./crm-alerts-core.mjs";
import { resolveResponsibleManager } from "./whatsapp-connection-alert-core.mjs";

export const WHATSAPP_SESSION_ATTENTION_KEY = "whatsapp_session_attention";
export const ATTENTION_STATE = Object.freeze({ NEEDS_ATTENTION: "needs_attention", RETRY_LIMIT: "retry_limit", QR_EXPIRED: "qr_expired" });
export const NEEDS_ATTENTION_PREFIX = "needs_attention:";
// Rota REAL: Meta Diária (visão da equipe) mostra o estado do WhatsApp de cada corretor para admin/gestora.
export const ATTENTION_LINK = "/admin/meta-diaria";
// Mesma situação do mesmo corretor não volta a alertar dentro desta janela (anti-flapping de conectar/falhar).
export const ATTENTION_COOLDOWN_MS = 10 * 60 * 1000;

const STATE_LABELS = Object.freeze({
  [ATTENTION_STATE.NEEDS_ATTENTION]: "conexão interrompida",
  [ATTENTION_STATE.RETRY_LIMIT]: "reconexão automática esgotada",
  [ATTENTION_STATE.QR_EXPIRED]: "QR Code expirado"
});

// Motivo (português simples) + ação. Sem códigos técnicos, sem texto cru do serviço.
const REASON_TEXT = Object.freeze({
  forbidden: {
    motivo: "O WhatsApp recusou a conexão e o sistema parou de tentar para não piorar.",
    acao: "Verifique o aparelho e o número do corretor antes de pedir para conectar de novo."
  },
  connection_replaced: {
    motivo: "Outra conexão assumiu essa sessão do WhatsApp.",
    acao: "Confirme com o corretor que só um aparelho usa essa conta e peça para conectar de novo."
  },
  multidevice_mismatch: {
    motivo: "O WhatsApp informou incompatibilidade com o aparelho do corretor.",
    acao: "Peça ao corretor para atualizar o WhatsApp no celular e conectar de novo."
  },
  unrecognized_code: {
    motivo: "O WhatsApp encerrou a conexão por um motivo que o sistema não conhece e parou de tentar.",
    acao: "Peça ao corretor para conectar de novo; se repetir, avise o suporte."
  },
  retry_limit: {
    motivo: "O sistema tentou reconectar várias vezes e não conseguiu.",
    acao: "Veja se o celular do corretor está com internet e o WhatsApp aberto, e peça para conectar de novo."
  },
  qr_expired: {
    motivo: "O código de conexão expirou sem ser escaneado.",
    acao: "Peça ao corretor para gerar um novo QR Code e escanear no celular."
  }
});

const iso = (value) => {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : "";
};

// Extrai o motivo de 'needs_attention:<motivo>: <texto>'. Motivo fora do padrão vira 'unrecognized_code'.
export function parseAttentionReason(error) {
  const text = String(error || "");
  if (!text.startsWith(NEEDS_ATTENTION_PREFIX)) return "";
  const slug = text.slice(NEEDS_ATTENTION_PREFIX.length).split(":")[0].trim();
  return /^[a-z0-9_]{1,40}$/.test(slug) ? slug : "unrecognized_code";
}

// status/error do EVENTO novo; prev = linha ANTES da gravação ({ status, last_connected_at }) ou null.
// -> { state, reason } | null
export function classifySessionAttention({ status = "", error = "", prev = null } = {}) {
  if (status === "error") {
    const reason = parseAttentionReason(error);
    if (!reason) return null; // 'error' sem o selo do microsserviço: não é o caso tratado aqui
    return { state: reason === "retry_limit" ? ATTENTION_STATE.RETRY_LIMIT : ATTENTION_STATE.NEEDS_ATTENTION, reason };
  }
  if (status === "disconnected" && String(error || "") === "qr_expired") {
    // Só quem já esteve conectada e agora exige QR novo; primeira conexão abandonada não é incidente.
    if (!iso(prev?.last_connected_at)) return null;
    return { state: ATTENTION_STATE.QR_EXPIRED, reason: "qr_expired" };
  }
  return null;
}

// Prefixo de todas as chaves deste alerta de UM corretor (consulta de cooldown e encerramento).
export const attentionKeyPrefix = (userId) => `wa_attn:${userId}:`;
export const attentionReasonPrefix = (userId, reason) => `wa_attn:${userId}:${reason}:`;

// Ocorrência = corretor + motivo + a conexão (last_connected_at) em cujo contexto o problema surgiu.
// Mesmo evento repetido (retry do webhook, poll, evento duplo) = mesma chave. Conexão nova que cai de novo,
// ou motivo diferente = chave nova. Conta que nunca conectou: uma ocorrência por motivo/dia.
export function attentionDedupeKey(userId, reason, prev = null, now = Date.now()) {
  const episode = iso(prev?.last_connected_at) || `nunca:${iso(now).slice(0, 10)}`;
  return `${attentionReasonPrefix(userId, reason)}${episode}`;
}

// Destinatários EXPLÍCITOS: gestora responsável (ativa) + administradores gerais ativos. Nunca o corretor
// afetado (padrão do alerta whatsapp_connection) nem outras equipes.
export function resolveAttentionRecipients(users = [], userId = "") {
  const ids = new Set();
  const managerId = resolveResponsibleManager(users, userId);
  if (managerId) ids.add(managerId);
  for (const user of users) {
    if (user?.role === "admin" && user.status !== "inactive" && !user.disabled_at) ids.add(user.id);
  }
  return [...ids];
}

// Já alertou este corretor/motivo há pouco? (lastAt = created_at do último alerta desse corretor+motivo)
export function inAttentionCooldown(lastAt, now = Date.now()) {
  if (!lastAt) return false;
  const time = new Date(lastAt).getTime();
  return Number.isFinite(time) && now - time < ATTENTION_COOLDOWN_MS;
}

const horario = (at) => {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replace(",", " às");
};

export const DEFAULT_ATTENTION_TITLE = "WhatsApp precisa de atenção";
export const DEFAULT_ATTENTION_BODY = "WhatsApp de {corretor}: {estado} ({horario}). {motivo} {acao}";

// Texto do alerta (variáveis: corretor, estado, motivo, acao, horario). Nome do corretor, nunca telefone.
export function describeAttention({ classification, brokerName, at = Date.now(), template = DEFAULT_ATTENTION_BODY } = {}) {
  const text = REASON_TEXT[classification?.reason] || REASON_TEXT.unrecognized_code;
  return renderAlertTemplate(template || DEFAULT_ATTENTION_BODY, {
    corretor: String(brokerName || "").trim() || "um corretor",
    estado: STATE_LABELS[classification?.state] || STATE_LABELS[ATTENTION_STATE.NEEDS_ATTENTION],
    motivo: text.motivo,
    acao: text.acao,
    horario: horario(at)
  });
}

// Uma entrega por destinatário. Definição desligada/ausente -> []. O tipo (informativo/importante) vem da definição.
export function buildAttentionDeliveries({ definition, recipientIds = [], brokerId, brokerName, classification, dedupeKey, at = Date.now() } = {}) {
  if (!definition?.enabled || !brokerId || !classification || !dedupeKey) return [];
  const kind = definition.kind === "informative" ? "informative" : "important";
  const body = describeAttention({ classification, brokerName, at, template: definition.body_template });
  return [...new Set(recipientIds)].filter(Boolean).map((recipientId) => ({
    definition_id: definition.id || null,
    recipient_id: recipientId,
    kind,
    title: definition.title || DEFAULT_ATTENTION_TITLE,
    body,
    context: {
      source: WHATSAPP_SESSION_ATTENTION_KEY, state: classification.state, reason: classification.reason,
      broker_id: brokerId, occurred_at: iso(at), link: ATTENTION_LINK
    },
    dedupe_key: dedupeKey
  }));
}
