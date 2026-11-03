import { keywordMatchesMessage, normalizeForKeyword } from "./whatsapp-keyword-match.mjs";
import { getTimeGreeting } from "./daily-report-range.mjs";
import { smsFirstName } from "./sms-batch-core.mjs";

// Contato "pós-formulário": o cliente acabou de preencher o formulário público e toca
// em "Receber minha simulação" (tela final), que abre o WhatsApp oficial com esta
// mensagem pronta. Ele JÁ tem cadastro e corretor — não deve receber boas-vindas, menu
// nem a resposta automática por palavra-chave (a regra "Simulação" respondia com o link
// genérico do site). Só o fluxo dedicado "Formulário concluído" pode tratar esse contato.
// Puro (sem banco): testado em tests/whatsapp-form-completion.test.mjs.

export const FORM_COMPLETION_MESSAGE = "Olá, preenchi meu cadastro. Gostaria de receber a minha simulação.";

// Mensagem com o nome (dono, 2026-11-03, PRO-18h): "Bom dia, meu nome é Maria. Só para reforçar: preenchi meu cadastro e
// gostaria de receber a minha simulação." Saudação pela fonte única getTimeGreeting (hora do clique, São Paulo). Sem nome
// confiável (smsFirstName: sem número/emoji/"Cliente"...) sai o texto de sempre. CONTINUA contendo as frases de
// FORM_COMPLETION_PHRASES ("preenchi meu cadastro", "receber a minha simulação") — é por elas que o fluxo "Formulário
// concluído", a SIM-AUTO-ENVIO e o contato direto reconhecem a mensagem; o código do atendimento é acrescentado depois
// (withContactCode) e extraído como antes. Não mude as frases sem mexer em FORM_COMPLETION_PHRASES e no modelo do fluxo.
export function buildFormCompletionMessage({ firstName = "", now = new Date() } = {}) {
  const name = smsFirstName(firstName);
  if (!name) return FORM_COMPLETION_MESSAGE;
  return `${getTimeGreeting(now)}, meu nome é ${name}. Só para reforçar: preenchi meu cadastro e gostaria de receber a minha simulação.`;
}

export const FORM_COMPLETION_PHRASES = ["preenchi meu cadastro", "receber a minha simulacao", "receber minha simulacao"];

// Janela em que um cadastro recém-criado pelo formulário conta como "acabou de preencher".
export const RECENT_FORM_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isFormCompletionMessage(text) {
  return keywordMatchesMessage(text, "preenchi meu cadastro");
}

// O fluxo é o dedicado ao pós-formulário se alguma palavra-chave dele é uma das frases
// da mensagem do botão (é assim que o modelo "Formulário concluído" é montado).
export function isFormCompletionFlowTrigger(trigger) {
  if (trigger?.type !== "keyword") return false;
  return (trigger.keywords || []).some((word) => FORM_COMPLETION_PHRASES.includes(normalizeForKeyword(word)));
}

// Quais dos fluxos que casaram podem rodar:
//  - mensagem do botão pós-formulário: SÓ o fluxo dedicado;
//  - cliente que acabou de preencher o formulário (escreveu outra coisa): gatilhos
//    automáticos (qualquer mensagem, primeira mensagem, anúncio) não disparam; palavra-chave
//    continua valendo (pedido explícito dele);
//  - demais casos: nada muda.
//  - mensagem com o CÓDIGO do atendimento (botões do link, dono 2026-10-20, caso real: pedido da lista respondido com o menu
//    de boas-vindas): cliente já cadastrado — o pedido da lista não dispara fluxo nenhum (a lista sai sozinha,
//    lib/documents-list-auto.js); as demais mensagens com código só aceitam palavra-chave (nunca boas-vindas/menu).
export function filterFlowsForPostFormContact(flows, { isFormMessage = false, recentForm = false, codedContact = false, documentsListRequest = false } = {}) {
  if (documentsListRequest) return [];
  if (isFormMessage) return flows.filter((flow) => isFormCompletionFlowTrigger(flow.published_trigger));
  if (recentForm || codedContact) return flows.filter((flow) => flow.published_trigger?.type === "keyword");
  return flows;
}

// A resposta automática antiga por palavra-chave nunca responde a esse contato.
export function shouldSuppressKeywordReply({ isFormMessage = false, recentForm = false, codedContact = false } = {}) {
  return Boolean(isFormMessage || recentForm || codedContact);
}
