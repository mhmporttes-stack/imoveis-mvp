// Cliente do ANÚNCIO de WhatsApp (click-to-WhatsApp) aguardando resposta ou formulário — regra do dono, 2026-10-09
// (BUSINESS_RULES WA-18). PURO, testado em tests/whatsapp-ad-waiting.test.mjs. Quem lê o banco e grava é
// lib/whatsapp-ad-waiting.js.
//
// Quem clica no anúncio recebe a saudação e o link do formulário (Fluxo), é cadastrado em "Atendimento automático"
// com o DONO como responsável e NÃO vai para corretor nenhum (fora da roleta e da fila de espera). Entra na roleta
// quando (a) preenche o formulário ou (b) RESPONDE depois das mensagens automáticas.

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

// Pode sair do "segurado" e ir para a roleta? Resposta: só se ainda está em "Atendimento automático" (uma pessoa que já
// atendeu — status mudou — fica com o cliente). Formulário: o próprio formulário já mudou o status para "Aguardando
// simulação"; vale qualquer status menos arquivado/Não contactar.
export function canReleaseAdWaitingClient(client, { via = "reply" } = {}) {
  if (!client || client.distribution_type !== AD_WAITING_DISTRIBUTION) return false;
  if (NEVER_RELEASE.has(client.status)) return false;
  if (via === "reply") return RELEASABLE_ON_REPLY.has(client.status);
  return true;
}
