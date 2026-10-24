// Envio automático da simulação automática (SIM-AUTO-ENVIO — REGRA OFICIAL DE NEGÓCIO, dono, 2026-10-23).
// Regras PURAS (testadas em tests/simulation-auto-send.test.mjs); leitura/envio em lib/simulation-auto-send.js.
//
// Todo cliente NOVO do formulário (site/anúncio) com a simulação automática gerada recebe o link da apresentação
// (`/s/<token>`, a MESMA mensagem do envio manual: só o link — buildPresentationSendMessage) sem ação humana:
//  - escreveu no WhatsApp OFICIAL (janela de 24 h aberta) → pelo Oficial;
//  - escreveu no WhatsApp individual do CORRETOR responsável → por esse número (o mesmo número da conversa, WA-15);
//  - não chamou ninguém → pelo WhatsApp individual (não oficial) DO DONO, iniciando a conversa;
//  - escreveu no Oficial mas a janela fechou (sem modelo aprovado; dono, 2026-10-23): fica com o responsável se ele tem
//    WhatsApp conectado; senão vai para a ROLETA (corretor on-line com WhatsApp conectado) e sai pelo WhatsApp individual
//    de quem recebeu. Ninguém on-line → ninguém recebe (dono, 2026-10-24: desconectado nunca recebe da roleta); o envio
//    fica pendente até alguém ficar on-line.
// Travas: nunca Não contactar/telefone bloqueado/arquivado/Particular/número da equipe; um envio por CADASTRO (reserva
// `simulation-auto-send:<id do cadastro>` no índice único de whatsapp_messages.meta_message_id — nunca por telefone);
// cadência anti-ban dos envios individuais (individualAutomationSendGate, lib/daily-goal-auto.js); falha registrada e
// nunca reenviada.

import { genderFromFirstName, speakableFirstName } from "./client-voice-audio-core.mjs";
import { OFFICIAL_WINDOW_SAFETY_MS, deferQuietHours } from "./whatsapp-form-reminder-core.mjs";
import { isHumanContactMessage } from "./human-contact-core.mjs";

export const AUTO_SIMULATION_SEND_KIND = "simulation_auto_send";

// Linha do tempo do cliente (client_journey_events, actor "sistema"). NÃO entram em ATTENDANCE_JOURNEY_EVENTS: envio
// automático não é atendimento humano (FUN-15f), nem no "presentation_sent" do envio manual.
export const AUTO_SEND_EVENTS = Object.freeze({
  scheduled: "simulation_auto_send_scheduled",
  sent: "simulation_auto_sent",
  pending: "simulation_auto_send_pending",
  failed: "simulation_auto_send_failed",
  skipped: "simulation_auto_send_skipped"
});

// Eventos que encerram o caso (nunca volta a tentar).
export const FINAL_AUTO_SEND_EVENTS = Object.freeze([AUTO_SEND_EVENTS.sent, AUTO_SEND_EVENTS.failed, AUTO_SEND_EVENTS.skipped]);

// Espera antes do 1º envio: dá tempo de o cliente tocar em "Receber minha simulação" (abre o Oficial com o código do
// atendimento) e o canal ser decidido pelo que ele fez. [COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO — A CONFIRMAR]
export const AUTO_SEND_DELAY_MS = 2 * 60 * 1000;
// Até quando o caso continua sendo tentado (janela de envio, intervalo, número aguardando). Depois disso fica como está
// (pendente visível na linha do tempo). [COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO — A CONFIRMAR]
export const AUTO_SEND_LOOKBACK_MS = 72 * 60 * 60 * 1000;
export const OFFICIAL_WINDOW_MS = 24 * 60 * 60 * 1000;

export function autoSendClaimKey(registrationId) {
  return `simulation-auto-send:${registrationId}`;
}

function ms(value) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

/**
 * Canal do envio. `official`/`broker` = conversa em que o CLIENTE escreveu ({ conversationId, lastInboundAt, slot? }) ou
 * null. A mensagem mais recente do cliente decide; empate fica com o número do corretor (conversa pessoal).
 * Resultado: { kind: "official" | "broker" | "official_closed" | "owner", conversationId?, slot? }.
 */
export function decideAutoSendChannel({ official = null, broker = null, nowMs = Date.now() } = {}) {
  const officialMs = ms(official?.lastInboundAt);
  const brokerMs = ms(broker?.lastInboundAt);
  if (brokerMs && brokerMs >= officialMs) return { kind: "broker", conversationId: broker.conversationId, slot: broker.slot || 1 };
  if (officialMs) {
    return nowMs - officialMs < OFFICIAL_WINDOW_MS
      ? { kind: "official", conversationId: official.conversationId }
      : { kind: "official_closed" };
  }
  return { kind: "owner" };
}

/** Oficial com a janela fechada (dono, 2026-10-23): responsável com WhatsApp conectado fica; senão, roleta. */
export function closedWindowRoute({ responsibleId = "", responsibleConnected = false } = {}) {
  return responsibleId && responsibleConnected ? { kind: "responsible", brokerId: responsibleId } : { kind: "roulette" };
}

/** Motivo para NUNCA enviar (final). null = pode seguir. */
export function autoSendSkipReason({ registration = null, doNotContactReason = null, isTeamPhone = false, phone = "", hasScenes = true } = {}) {
  if (!registration) return "cadastro_inexistente";
  const status = String(registration.status || "");
  if (status === "do_not_contact" || doNotContactReason) return "nao_contactar";
  if (status === "archived") return "arquivado";
  if (registration.private_contact_at) return "particular";
  if (!phone) return "sem_telefone";
  if (isTeamPhone) return "telefone_da_equipe";
  if (!hasScenes) return "simulacao_sem_valores";
  return null;
}

// Bloqueios passageiros da cadência anti-ban (janela 06:30–18:00, intervalo de 5 min, teto do dia, espera pós-conexão):
// o caso só espera a próxima rodada, sem poluir a linha do tempo.
const WAIT_REASONS = new Set([
  "fora_do_horario_extra",
  "fim_de_semana",
  "intervalo_minimo_politica",
  "pausa_programada_politica",
  "teto_diario_politica",
  "aguardando_apos_reconexao",
  "ja_enviado_nesta_rodada"
]);

export function isWaitReason(reason) {
  return WAIT_REASONS.has(String(reason || ""));
}

const REASON_TEXT = {
  nao_contactar: "cliente em Não contactar (telefone bloqueado)",
  arquivado: "cliente arquivado",
  particular: "contato marcado como Particular",
  sem_telefone: "cadastro sem telefone válido",
  telefone_da_equipe: "telefone de alguém da equipe",
  simulacao_sem_valores: "simulação sem valores",
  cadastro_inexistente: "cadastro não encontrado",
  sem_simulacao: "cadastro sem simulação",
  chat_desligado: "Chat do CRM desligado",
  oficial_nao_configurado: "WhatsApp oficial não configurado",
  envio_pessoal_desligado: "envio pelo WhatsApp pessoal desligado no CRM",
  acesso_whatsapp_bloqueado: "acesso ao WhatsApp bloqueado para o número que enviaria",
  automacao_pausada: "automação do número pausada (proteção anti-banimento)",
  whatsapp_nao_conectado: "nenhum número do WhatsApp conectado com \"Usar para disparo\"",
  numero_pausado: "número pausado pela proteção anti-banimento",
  sem_dono: "conta do dono não encontrada",
  sem_corretor_conectado: "nenhum corretor on-line com WhatsApp conectado para receber pela roleta",
  link_indisponivel: "link da apresentação indisponível",
  falha_envio: "o WhatsApp recusou ou não confirmou o envio"
};

export function autoSendReasonText(reason) {
  return REASON_TEXT[reason] || String(reason || "motivo desconhecido").replace(/_/g, " ");
}

const CHANNEL_TEXT = { official: "pelo WhatsApp oficial", broker: "pelo WhatsApp do corretor", owner: "pelo WhatsApp do Matheus", roulette: "pelo WhatsApp do corretor que recebeu pela roleta", responsible: "pelo WhatsApp do corretor responsável" };

export function autoSendJourneyText(outcome, { channel = "", reason = "" } = {}) {
  const via = CHANNEL_TEXT[channel] || "";
  if (outcome === "sent") return `Simulação enviada automaticamente${via ? ` ${via}` : ""}`;
  if (outcome === "failed") return `Envio automático da simulação falhou${via ? ` (${via})` : ""}: ${autoSendReasonText(reason)}. Não será reenviado sozinho.`;
  if (outcome === "skipped") return `Simulação não enviada automaticamente: ${autoSendReasonText(reason)}.`;
  if (outcome === "pending") return `Envio automático da simulação pendente: ${autoSendReasonText(reason)}.`;
  return "Envio automático da simulação programado";
}

// ── Lembrete "ficou alguma dúvida?" depois do envio automático (SIM-AUTO-ENVIO, REGRA OFICIAL DE NEGÓCIO — dono,
// 2026-10-23): "Depois que enviar a simulação, se o cliente responder, encerre o fluxo. Depois de 20 minutos, se o cliente
// não falar nada, envie uma mensagem". UM lembrete por cadastro, 20 min depois do envio, pela MESMA conversa (Oficial ou
// WhatsApp pessoal que mandou o link). Encerra (não envia) se, depois do envio, o cliente escreveu em qualquer conversa
// dele (reação não conta), alguém da equipe mandou mensagem humana (isHumanContactMessage), o status mudou por pessoa ou
// o cliente virou Não contactar/telefone bloqueado/arquivado/Particular. Entre 21h e 8h sai às 8 h (deferQuietHours, regra
// de 2026-10-12); saudação calculada na hora do envio real (getTimeGreeting). Mesmas travas do envio: cadência anti-ban,
// janela de 24 h no Oficial (fechada = não envia e registra), reserva `simulation-auto-followup:<id do cadastro>`.

export const AUTO_FOLLOWUP_KIND = "simulation_auto_followup";
export const AUTO_FOLLOWUP_DELAY_MS = 20 * 60 * 1000;

// Não entram em ATTENDANCE_JOURNEY_EVENTS: lembrete automático não é atendimento humano.
export const AUTO_FOLLOWUP_EVENTS = Object.freeze({
  scheduled: "simulation_auto_followup_scheduled",
  sent: "simulation_auto_followup_sent",
  cancelled: "simulation_auto_followup_cancelled",
  skipped: "simulation_auto_followup_skipped"
});
export const FINAL_AUTO_FOLLOWUP_EVENTS = Object.freeze([AUTO_FOLLOWUP_EVENTS.sent, AUTO_FOLLOWUP_EVENTS.cancelled, AUTO_FOLLOWUP_EVENTS.skipped]);

export function autoFollowupClaimKey(registrationId) {
  return `simulation-auto-followup:${registrationId}`;
}

/** Horário do lembrete: 20 min depois do envio; se cair entre 21h e 8h (São Paulo), às 8 h. */
export function autoFollowupDueAt(sentAt) {
  const sentMs = ms(sentAt);
  return sentMs ? new Date(deferQuietHours(sentMs + AUTO_FOLLOWUP_DELAY_MS)) : null;
}

/** Texto do dono: "Boa tarde, João, meu amigo, ficou alguma dúvida relacionada à simulação?" (sem nome/sexo incerto = "meu amigo"). */
export function buildAutoFollowupText(fullName, greeting) {
  const first = speakableFirstName(fullName);
  const friend = genderFromFirstName(first) === "female" ? "minha amiga" : "meu amigo";
  return `${greeting}, ${first ? `${first}, ` : ""}${friend}, ficou alguma dúvida relacionada à simulação?`;
}

// Mudança de status feita por PESSOA: changed_by é o e-mail de quem mudou; automação grava "sistema" (ou vazio).
function isPersonStatusChange(row) {
  return String(row?.changed_by || "").includes("@");
}

/**
 * Motivo para encerrar o lembrete (final). `messagesAfter` = mensagens de QUALQUER conversa do cliente depois do envio
 * ({ direction, sender_type, status, message_type, metadata }); `statusChangesAfter` = client_status_history depois do envio.
 */
export function autoFollowupCancelReason({ messagesAfter = [], statusChangesAfter = [] } = {}) {
  for (const message of messagesAfter || []) {
    if (message?.direction === "inbound" && String(message.message_type || "text") !== "reaction") return "cliente_respondeu";
  }
  for (const message of messagesAfter || []) {
    if (isHumanContactMessage({ direction: message?.direction, senderType: message?.sender_type, status: message?.status, messageType: message?.message_type, metadata: message?.metadata })) return "equipe_respondeu";
  }
  if ((statusChangesAfter || []).some(isPersonStatusChange)) return "status_alterado_pela_equipe";
  return null;
}

/** Janela de 24 h do Oficial aberta (com a folga de 5 min dos lembretes) desde a última mensagem do cliente. */
export function isOfficialWindowOpen(lastInboundAt, nowMs = Date.now()) {
  const inbound = ms(lastInboundAt);
  return Boolean(inbound) && nowMs < inbound + OFFICIAL_WINDOW_MS - OFFICIAL_WINDOW_SAFETY_MS;
}

const FOLLOWUP_REASON_TEXT = {
  cliente_respondeu: "o cliente respondeu",
  equipe_respondeu: "alguém da equipe falou com o cliente",
  status_alterado_pela_equipe: "o status foi alterado pela equipe",
  janela_fechada: "a janela de 24 h do WhatsApp oficial fechou",
  conversa_indisponivel: "a conversa do envio não está mais disponível",
  prazo_esgotado: "não foi possível enviar dentro do prazo (horário/cadência do número)"
};

export function autoFollowupJourneyText(outcome, { reason = "" } = {}) {
  const why = FOLLOWUP_REASON_TEXT[reason] || autoSendReasonText(reason);
  if (outcome === "sent") return "Lembrete \"ficou alguma dúvida?\" enviado automaticamente";
  if (outcome === "cancelled") return `Lembrete "ficou alguma dúvida?" cancelado: ${why}.`;
  if (outcome === "skipped") return `Lembrete "ficou alguma dúvida?" não enviado: ${why}.`;
  return "Lembrete \"ficou alguma dúvida?\" programado para 20 min depois da simulação (sai só se o cliente não responder)";
}
