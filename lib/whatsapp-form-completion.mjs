import { keywordMatchesMessage, normalizeForKeyword } from "./whatsapp-keyword-match.mjs";

// Contato "pós-formulário": o cliente acabou de preencher o formulário público e toca
// em "Receber minha simulação" (tela final), que abre o WhatsApp oficial com esta
// mensagem pronta. Ele JÁ tem cadastro e corretor — não deve receber boas-vindas, menu
// nem a resposta automática por palavra-chave (a regra "Simulação" respondia com o link
// genérico do site). Só o fluxo dedicado "Formulário concluído" pode tratar esse contato.
// Puro (sem banco): testado em tests/whatsapp-form-completion.test.mjs.

export const FORM_COMPLETION_MESSAGE = "Olá, preenchi meu cadastro. Gostaria de receber a minha simulação.";

const FORM_COMPLETION_PHRASES = ["preenchi meu cadastro", "receber a minha simulacao", "receber minha simulacao"];

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
export function filterFlowsForPostFormContact(flows, { isFormMessage = false, recentForm = false } = {}) {
  if (isFormMessage) return flows.filter((flow) => isFormCompletionFlowTrigger(flow.published_trigger));
  if (recentForm) return flows.filter((flow) => flow.published_trigger?.type === "keyword");
  return flows;
}

// A resposta automática antiga por palavra-chave nunca responde a esse contato.
export function shouldSuppressKeywordReply({ isFormMessage = false, recentForm = false } = {}) {
  return Boolean(isFormMessage || recentForm);
}
