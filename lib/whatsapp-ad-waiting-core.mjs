// Cliente do ANÚNCIO de WhatsApp (click-to-WhatsApp) aguardando resposta ou formulário — regra do dono, 2026-10-09
// (BUSINESS_RULES WA-18). PURO, testado em tests/whatsapp-ad-waiting.test.mjs. Quem lê o banco e grava é
// lib/whatsapp-sponsored-lead.js.
//
// Quem clica no anúncio recebe a saudação e o link do formulário (Fluxo), é cadastrado em "Atendimento automático"
// com o DONO como responsável e NÃO vai para corretor nenhum (fora da roleta e da fila de espera). Entra na roleta
// quando (a) preenche o formulário, (b) RESPONDE depois das mensagens automáticas ou (c) fica em silêncio 3 h depois da 1ª
// mensagem automática (desde 2026-10-12, decideSilenceTransfer abaixo).

import { deferQuietHours } from "./whatsapp-form-reminder-core.mjs";

// Marca do cliente "segurado" (simulation_registrations.distribution_type, texto livre): não é "round_robin", então a
// REDISTRIBUIÇÃO DE LEADS nunca o toca; não tem pending_distribution_at, então a fila de espera também não.
export const AD_WAITING_DISTRIBUTION = "whatsapp_ad_waiting";

// "Respondeu" = mensagem do cliente (qualquer tipo, menos reação) DEPOIS da primeira mensagem automática da conversa
// (saudação/link). A mensagem que veio do anúncio (a que abre a conversa) vem antes da automação: não conta.
// `messages`: mensagens da conversa { direction, sender_type, message_type, status, message_at }.
export function hasRepliedAfterAutomation(messages = []) {
  const sorted = [...messages].filter((message) => message?.message_at).sort((a, b) => new Date(a.message_at) - new Date(b.message_at));
  const firstAutomation = sorted.find((message) => message.direction === "outbound" && message.sender_type === "automation" && message.status !== "failed");
  if (!firstAutomation) return false;
  const after = new Date(firstAutomation.message_at).getTime();
  return sorted.some((message) => message.direction === "inbound"
    && String(message.message_type || "text") !== "reaction"
    && new Date(message.message_at).getTime() > after);
}

const RELEASABLE_ON_REPLY = new Set(["automated_service"]);
const NEVER_RELEASE = new Set(["archived", "do_not_contact"]);

// Pode sair do "segurado" e ir para a roleta? Resposta e silêncio: só se ainda está em "Atendimento automático" (uma
// pessoa que já atendeu — status mudou — fica com o cliente). Formulário: o próprio formulário já mudou o status para
// "Aguardando simulação"; vale qualquer status menos arquivado/Não contactar.
export function canReleaseAdWaitingClient(client, { via = "reply" } = {}) {
  if (!client || client.distribution_type !== AD_WAITING_DISTRIBUTION) return false;
  if (NEVER_RELEASE.has(client.status)) return false;
  if (via === "reply" || via === "silence") return RELEASABLE_ON_REPLY.has(client.status);
  return true;
}

// Como o cliente saiu do "segurado": marca do histórico da roleta/linha do tempo e trecho do aviso ao corretor. Via
// desconhecida LANÇA (antes, tudo que não era formulário virava "respondeu" — rótulo falso para o silêncio).
const RELEASE_VIA = {
  form: { history: "anuncio_formulario", label: "preencheu o formulário" },
  reply: { history: "anuncio_resposta", label: "respondeu no WhatsApp" },
  silence: { history: "anuncio_silencio", label: "não respondeu às mensagens automáticas" }
};

export function adReleaseVia(via) {
  const found = RELEASE_VIA[via];
  if (!found) throw new Error(`Forma de liberação do cliente do anúncio desconhecida: ${via}`);
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------
// SILÊNCIO → ROLETA (regra do dono, 2026-10-12 — decisões 10 e 12 da Mesa do robô do Chat; altera a WA-18): quem não
// respondeu nem preencheu vai para a roleta 3 h depois da 1ª mensagem automática (A1), junto com o lembrete de 3 h; se
// cair entre 21h e 8h (America/Sao_Paulo), às 8 h (domingo igual; ninguém on-line = fila de espera). Só se ninguém da
// equipe escreveu nem mexeu na conversa (ROL-4d) e o cliente segue em "Atendimento automático". Sem mensagem ao cliente
// e sem aviso à gestão. Só daqui para frente: A1 a partir da publicação (SILENCE_TRANSFER_SINCE).
export const SILENCE_TRANSFER_DELAY_MS = 3 * 60 * 60 * 1000;
export const SILENCE_TRANSFER_SINCE = "2026-10-12T15:15:00.000Z"; // data de corte (publicação da Fase 2; não retroativo)

// 1ª mensagem automática da conversa que não falhou (a A1 do Fluxo do anúncio).
export function firstAutomationAt(messages = []) {
  const times = messages
    .filter((message) => message?.direction === "outbound" && message.sender_type === "automation" && message.status !== "failed" && message.message_at)
    .map((message) => new Date(message.message_at).getTime())
    .filter(Number.isFinite);
  return times.length ? Math.min(...times) : NaN;
}

// Entrada (já lida do banco):
//  client        { distribution_type, status, last_form_submitted_at, journey_type, private_contact_at }
//  conversation  { private_at, deleted_at, status, last_human_reply_at } da conversa do número oficial | null
//  messages      mensagens da conversa { direction, sender_type, message_type, status, message_at }
//  audits        ações de pessoas na conversa (assumir, atribuir, status, excluir…)
// Resultado: { action: "transfer" | "wait" | "skip", reason, dueAt? }.
export function decideSilenceTransfer({ client = null, conversation = null, messages = [], audits = [] } = {}, now = new Date()) {
  const skip = (reason) => ({ action: "skip", reason });
  if (!canReleaseAdWaitingClient(client, { via: "silence" })) return skip("nao_aguardando");
  if (client.last_form_submitted_at || client.journey_type) return skip("formulario_preenchido");
  if (client.private_contact_at) return skip("contato_particular");
  if (!conversation) return skip("sem_conversa");
  if (conversation.private_at) return skip("conversa_particular");
  if (conversation.deleted_at) return skip("conversa_excluida");
  if (conversation.status === "finished") return skip("conversa_finalizada");
  if (conversation.last_human_reply_at || messages.some((message) => message?.direction === "outbound" && message.sender_type === "user")) return skip("equipe_escreveu");
  if ((audits || []).length) return skip("equipe_mexeu");
  if (hasRepliedAfterAutomation(messages)) return skip("cliente_respondeu");
  const a1 = firstAutomationAt(messages);
  if (!Number.isFinite(a1)) return { action: "wait", reason: "sem_mensagem_automatica" };
  if (a1 < new Date(SILENCE_TRANSFER_SINCE).getTime()) return skip("antes_da_publicacao");
  const dueAt = new Date(deferQuietHours(a1 + SILENCE_TRANSFER_DELAY_MS));
  if (new Date(now).getTime() < dueAt.getTime()) return { action: "wait", reason: "aguardando_horario", dueAt };
  return { action: "transfer", reason: "silencio", dueAt };
}
