// RESPOSTA FORA DO HORÁRIO no número Oficial (regra do dono, 2026-10-12 — decisão 12 da Mesa do robô do Chat, dossiê
// §2-B). PURO, testado em tests/whatsapp-after-hours-core.test.mjs; a leitura e o envio ficam em
// lib/whatsapp-after-hours.js (chamado pelo webhook, lib/whatsapp-master.js, DEPOIS dos Fluxos/palavra-chave).
//
// Horário de atendimento: segunda a sábado, 8h–19h (America/Sao_Paulo, -03:00 fixo — o Brasil não tem horário de verão
// desde 2019). Fora dele, quem escreve (texto, áudio, imagem, vídeo ou documento — nunca reação, figurinha ou toque em
// botão) recebe UMA resposta por período fechado (noite / fim de semana), só enquanto ninguém da equipe respondeu na
// conversa e nenhuma outra automação falou nesse período (A1/D/E fora do horário já trazem o horário). Quem não
// preencheu recebe o botão do formulário; quem já preencheu, só o texto. Nunca: Não contactar, arquivado, Particular,
// número da equipe.

import { AFTER_HOURS_REPLY_KIND, usableFirstName } from "./whatsapp-form-reminder-core.mjs";

export { AFTER_HOURS_REPLY_KIND };

export const OPEN_WEEKDAYS = new Set([1, 2, 3, 4, 5, 6]); // segunda a sábado
export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 19;
export const AFTER_HOURS_BUTTON_LABEL = "Fazer simulação";
// Tipos de mensagem do cliente que recebem a resposta (os da Cloud API).
export const AFTER_HOURS_MESSAGE_TYPES = new Set(["text", "audio", "image", "video", "document"]);

const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Frase de horário (FH) do dossiê.
export const BUSINESS_HOURS_PHRASE = "Nosso atendimento é de segunda a sábado, das 8h às 19h; fora desse horário, a equipe responde assim que possível. Se esse horário não der pra você, é só avisar que a gente combina outro.";

function localParts(ms) {
  const local = new Date(ms - SAO_PAULO_OFFSET_MS); // campos UTC = hora local de São Paulo
  return { weekday: local.getUTCDay(), hour: local.getUTCHours(), midnight: Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + SAO_PAULO_OFFSET_MS };
}

export function isWithinOfficeHours(date = new Date()) {
  const { weekday, hour } = localParts(new Date(date).getTime());
  return OPEN_WEEKDAYS.has(weekday) && hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

// Período fechado em que `date` está: { start, end } (start = último fechamento às 19h de um dia de atendimento; end =
// próxima abertura às 8h). Dentro do horário: null.
export function closedPeriod(date = new Date()) {
  const ms = new Date(date).getTime();
  if (!Number.isFinite(ms) || isWithinOfficeHours(ms)) return null;
  const { midnight } = localParts(ms);
  let start = null;
  for (let back = 0; back <= 7 && start === null; back += 1) {
    const dayMidnight = midnight - back * DAY_MS;
    if (OPEN_WEEKDAYS.has(localParts(dayMidnight).weekday) && dayMidnight + CLOSE_HOUR * HOUR_MS <= ms) start = dayMidnight + CLOSE_HOUR * HOUR_MS;
  }
  let end = null;
  for (let ahead = 0; ahead <= 7 && end === null; ahead += 1) {
    const dayMidnight = midnight + ahead * DAY_MS;
    if (OPEN_WEEKDAYS.has(localParts(dayMidnight).weekday) && dayMidnight + OPEN_HOUR * HOUR_MS > ms) end = dayMidnight + OPEN_HOUR * HOUR_MS;
  }
  return { start: new Date(start), end: new Date(end) };
}

// Chave da reserva (whatsapp_messages.meta_message_id, índice único): uma resposta por conversa e período fechado.
export function afterHoursClaimKey(conversationId, periodStart) {
  return `after-hours:${conversationId}:${new Date(periodStart).toISOString()}`;
}

export function buildAfterHoursText(fullName, { formFilled = false } = {}) {
  const first = usableFirstName(fullName);
  const opening = `Recebemos sua mensagem${first ? `, ${first}` : ""}! ${BUSINESS_HOURS_PHRASE}`;
  return formFilled ? opening : `${opening} Se quiser adiantar, a simulação não pede CPF e não consulta seu nome:`;
}

// Já preencheu o formulário? (cliente da conversa ou qualquer cadastro com o telefone — mesma leitura do lembrete.)
export function hasFilledForm(client, phoneRegistrations = []) {
  return [client, ...(phoneRegistrations || [])].some((row) => row && (row.last_form_submitted_at || row.journey_type));
}

// Entrada (já lida do banco):
//  messageType          tipo da mensagem recebida (Cloud API)
//  conversation         { id, status, deleted_at, private_at, last_human_reply_at } da conversa do número oficial | null
//  client               { status, last_form_submitted_at, journey_type, private_contact_at } | null
//  phoneRegistrations   cadastros com o telefone [{ last_form_submitted_at, journey_type }]
//  automationInPeriod   já saiu (ou está saindo) alguma mensagem automática nesta conversa neste período fechado
//  isTeamPhone, doNotContactReason
// Resultado: { action: "send" | "skip", reason, claimKey?, withButton? }.
export function decideAfterHoursReply(input = {}, now = new Date()) {
  const { messageType = "", conversation = null, client = null } = input;
  const skip = (reason) => ({ action: "skip", reason });
  if (!AFTER_HOURS_MESSAGE_TYPES.has(String(messageType))) return skip("tipo_sem_resposta");
  const period = closedPeriod(now);
  if (!period) return skip("dentro_do_horario");
  if (input.isTeamPhone) return skip("numero_da_equipe");
  if (!conversation?.id) return skip("sem_conversa");
  if (conversation.private_at || client?.private_contact_at) return skip("conversa_particular");
  if (conversation.deleted_at) return skip("conversa_excluida");
  if (conversation.status === "finished") return skip("conversa_finalizada");
  if (client?.status === "archived") return skip("cliente_arquivado");
  if (input.doNotContactReason || client?.status === "do_not_contact") return skip("nao_contactar");
  if (conversation.last_human_reply_at) return skip("pessoa_ja_respondeu");
  if (input.automationInPeriod) return skip("automacao_no_periodo");
  return {
    action: "send",
    reason: "fora_do_horario",
    claimKey: afterHoursClaimKey(conversation.id, period.start),
    periodStart: period.start,
    withButton: !hasFilledForm(client, input.phoneRegistrations)
  };
}
