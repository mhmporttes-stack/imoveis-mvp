// Envio automático da simulação automática (SIM-AUTO-ENVIO — REGRA OFICIAL DE NEGÓCIO, dono, 2026-10-23).
// Regras PURAS (testadas em tests/simulation-auto-send.test.mjs); leitura/envio em lib/simulation-auto-send.js.
//
// Todo cliente NOVO do formulário (site/anúncio) com a simulação automática gerada recebe o link da apresentação
// (`/s/<token>`, a MESMA mensagem do envio manual: só o link — buildPresentationSendMessage) sem ação humana:
//  - escreveu no WhatsApp OFICIAL (janela de 24 h aberta) → pelo Oficial;
//  - escreveu no WhatsApp individual do CORRETOR responsável → por esse número (o mesmo número da conversa, WA-15);
//  - não chamou ninguém → pelo WhatsApp individual (não oficial) DO DONO, iniciando a conversa;
//  - escreveu no Oficial mas a janela fechou (sem modelo aprovado; dono, 2026-10-23): fica com o responsável se ele tem
//    WhatsApp conectado; senão vai para a ROLETA (corretor on-line com WhatsApp conectado; ninguém on-line → corretor
//    conectado mesmo off-line) e sai pelo WhatsApp individual de quem recebeu.
// Travas: nunca Não contactar/telefone bloqueado/arquivado/Particular/número da equipe; um envio por CADASTRO (reserva
// `simulation-auto-send:<id do cadastro>` no índice único de whatsapp_messages.meta_message_id — nunca por telefone);
// cadência anti-ban dos envios individuais (individualAutomationSendGate, lib/daily-goal-auto.js); falha registrada e
// nunca reenviada.

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

/**
 * Roleta do caso "janela fechada": on-line com WhatsApp conectado primeiro (a roleta de sempre, assignRoundRobinLead);
 * ninguém on-line → corretor com WhatsApp conectado mesmo off-line, o que está há mais tempo sem receber (liberado da
 * pausa de 10 min da ROL-2h). `offlineCandidates` = [{ id, lastReceivedAt }].
 */
export function pickOfflineConnectedBroker(offlineCandidates = []) {
  const sorted = [...(offlineCandidates || [])].filter((item) => item?.id)
    .sort((a, b) => ms(a.lastReceivedAt) - ms(b.lastReceivedAt) || String(a.id).localeCompare(String(b.id)));
  return sorted[0]?.id || null;
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
  sem_corretor_conectado: "nenhum corretor com WhatsApp conectado para receber pela roleta",
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
