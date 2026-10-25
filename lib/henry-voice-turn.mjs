// Leitura do pedido do dono ANTES e DEPOIS do modelo (Treino 2 do Henry, rodada de 2026-10-25 em crm_settings
// henry_training_reports — docs/BUSINESS_RULES.md HENRY-1, docs/INCIDENTES.md). Núcleo PURO (sem rede), usado por
// lib/henry-voice.js (dica da resposta, rodada extra, troca da resposta repetida) e lib/henry-training-core.mjs (achados
// "pergunta_ignorada" e "repetiu_apos_reclamacao") — a mesma regra nos dois, nada de critério paralelo:
//   - henryQuestionPart: a parte do pedido que é pergunta do CRM ("bota uma música tranquila e depois me diz quantos
//     clientes novos" → "me diz quantos clientes novos"; "e aí, beleza? como tá o movimento hoje?" → a pergunta);
//   - replyAnswersQuestion: a resposta tem conteúdo (número, "nenhum/ninguém", "na tela", falha dita, pergunta de qual);
//   - isHenryComplaint / henryRepeatedAfterComplaint: "não foi isso que eu perguntei" e a resposta repetida depois dela;
//   - henryResumeTopic: "bora voltar pro funil" → o assunto e a pergunta dele de antes sobre ele;
//   - henryTurnHint: a instrução "Nesta resposta: …" que vai ao modelo.

import { isCrmQuestion, normalizeSpeechText } from "./henry-voice-core.mjs";
import { MUSIC_REQUEST_CONNECTOR, isMusicRequest } from "./henry-voice-narration.mjs";
import { HENRY_COMPLAINT_REPLIES, isHenryGreeting } from "./henry-voice-persona.mjs";
import { isSimilarPhrase, isSimilarToAny } from "./henry-repetition-core.mjs";

const plain = (text) => normalizeSpeechText(text).replace(/\b(henry|henri|enri)\b/g, " ").replace(/\s+/g, " ").trim();
const quote = (text, max = 160) => String(text || "").replace(/\s+/g, " ").replace(/"/g, "'").trim().slice(0, max);

// --- Partes do pedido ------------------------------------------------------------------------------------------------
// Música + outra coisa: o que vem depois do conector ("e depois", "e me diz", "e já"...).
export function musicRequestRest(text) {
  const value = plain(text);
  const match = MUSIC_REQUEST_CONNECTOR.exec(value);
  return match ? value.slice(match.index + match[0].length).trim() : "";
}

// Cumprimento no começo ("e aí, beleza?", "bom dia", "oi, tudo bem?") → tira para sobrar a pergunta.
const GREETING_HEAD = /^(?:(?:oi|ola|opa|e ai|eai|fala|salve|bom dia|boa tarde|boa noite|beleza|blz|suave|tudo (?:bem|bom|certo|joia|tranquilo|em ordem)|como (?:voce )?(?:esta|vai)|e voce|meu (?:querido|amigo|parceiro)|chefe|patrao)\b\s*)+/;
export function stripGreetingHead(text) {
  return plain(text).replace(GREETING_HEAD, "").trim();
}

export function startsWithGreeting(text) {
  const value = plain(text);
  return Boolean(value) && GREETING_HEAD.test(value) && value.replace(GREETING_HEAD, "").trim().length > 0;
}

// A parte que é pergunta do CRM ("" = não há): saudação pura não tem; música só a parte depois do conector.
export function henryQuestionPart(text) {
  const value = plain(text);
  if (!value || isHenryGreeting(text)) return "";
  if (isMusicRequest(text)) {
    const rest = musicRequestRest(value);
    return rest && isCrmQuestion(rest) ? rest : "";
  }
  const question = stripGreetingHead(value) || value;
  return isCrmQuestion(question) ? question : "";
}

// --- A resposta respondeu? -------------------------------------------------------------------------------------------
// Conteúdo = número; contagem por extenso; "nenhum/ninguém/todos/zerado"; detalhes na tela; falha dita ("não consegui");
// ou pergunta de esclarecimento ("qual deles?"). "Quer que eu traga o número?" NÃO é esclarecimento.
const ANSWER_WORDS = /\b(nenhum|nenhuma|ninguem|zero|zerad[oa]s?|todos|todas|todo mundo|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|na tela|nao consegui|nao achei|nao tem|vazio)\b/;
const ONE_COUNT = /\b(um|uma) (client|simulac|vend|atendiment|aprovad|corretor|lead|document|convers|visit|reuni|imove|empreendiment)/;
const CLARIFY = /\b(qual|quais|de qual|qual deles|qual delas|quem|de quem|que periodo|qual periodo|voce quer dizer|seria (o|a|do|da))\b/;
export function isClarifyingQuestion(reply) {
  return String(reply || "")
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => /\?\s*["”')]*$/.test(sentence.trim()))
    .map((sentence) => normalizeSpeechText(sentence))
    .some((value) => CLARIFY.test(value) && !/\bquer que eu\b/.test(value));
}
export function replyAnswersQuestion(reply) {
  const raw = String(reply || "").trim();
  if (!raw) return false;
  if (/\d/.test(raw)) return true;
  const value = normalizeSpeechText(raw);
  return ANSWER_WORDS.test(value) || ONE_COUNT.test(value) || isClarifyingQuestion(raw);
}

// Instrução da rodada extra quando a parte-pergunta do pedido ficou sem resposta (uma vez por pedido).
export function henryUnansweredRetry(part) {
  return `[Sistema] Ainda falta responder esta parte do pedido dele: "${quote(part)}". Use agora a ferramenta certa e responda SÓ essa parte, com o número, numa frase curta — sem repetir o que você já disse e sem perguntar se ele quer o número.`;
}

// --- Reclamação ------------------------------------------------------------------------------------------------------
const COMPLAINT = /\b(nao (?:foi|e|era) (?:bem )?(?:isso|essa|esse|o que eu (?:perguntei|pedi|quis|queria))|nao perguntei (?:isso|isso ai)|nao pedi isso|nao era bem isso|(?:ta|esta|voce ta|voce esta|tu ta) repetindo|repetiu (?:a mesma coisa|de novo)|mesma coisa de novo|errou de novo|nao entendeu|entendeu errado|ta errado|resposta errada)\b/;
export function isHenryComplaint(text) {
  return COMPLAINT.test(normalizeSpeechText(text));
}

const digitsOf = (text) => (String(text || "").match(/\d+(?:[.,]\d+)?/g) || []).join(" ");
// Resposta à reclamação parecida com a anterior: mesma frase (semelhança, lib/henry-repetition-core.mjs) ou os mesmos
// números sem pergunta nenhuma ("Foram 3 vendas" → "Então, foram 3 vendas este mês.").
export function henryRepeatedAfterComplaint(reply, previous) {
  const now = String(reply || "").trim();
  const before = String(previous || "").trim();
  if (!now || !before) return false;
  if (isSimilarPhrase(now, before)) return true;
  const digits = digitsOf(now);
  return Boolean(digits) && digits === digitsOf(before) && !/\?/.test(now);
}

// Troca da resposta repetida: uma das frases de reconhecimento, fora das parecidas com as de hoje.
export function pickComplaintReply(said = [], random = Math.random) {
  const fresh = HENRY_COMPLAINT_REPLIES.filter((reply) => !isSimilarToAny(reply, said));
  const list = fresh.length ? fresh : HENRY_COMPLAINT_REPLIES;
  return list[Math.min(list.length - 1, Math.floor(Math.max(0, Math.min(0.9999, Number(random()) || 0)) * list.length))];
}

// --- Retomar um assunto ----------------------------------------------------------------------------------------------
const TOPICS = "funil|ranking|meta diaria|meta|agenda|clientes|cliente|whatsapp|chat|vendas|venda|financeiro|relatorio|simulacoes|simulacao|documentacao|corretores|corretor|pontuacao|imoveis|imovel|empreendimentos|empreendimento";
const RESUME = new RegExp(`\\b(?:volt\\w*|retom\\w*|de volta)\\b(?: \\w+){0,2}? (?:pro|pra|para o|para a|ao|a|o|no|na|com o|com a|aquele|aquela) (?:assunto (?:do|da|de) )?(${TOPICS})\\b`);
export function henryResumeTopic(text, turns = []) {
  const match = RESUME.exec(plain(text));
  if (!match) return null;
  const topic = match[1];
  const stem = topic.split(" ")[0].slice(0, 5);
  const own = plain(text);
  const previous = [...(Array.isArray(turns) ? turns : [])]
    .reverse()
    .find((turn) => turn?.role === "user" && turn.text && plain(turn.text) !== own && plain(turn.text).includes(stem) && !RESUME.test(plain(turn.text)));
  return { topic, previous: previous ? quote(previous.text) : "" };
}

// --- Dica desta resposta ---------------------------------------------------------------------------------------------
// turns = conversa de hoje ({ role, text }) até ANTES desta fala; lastAssistant = a última resposta do Henry.
export function henryTurnHint({ text = "", lastAssistant = "", turns = [] } = {}) {
  const hints = [];
  if (isHenryComplaint(text) && lastAssistant) {
    const lastUser = [...turns].reverse().find((turn) => turn?.role === "user" && turn.text && !isHenryComplaint(turn.text));
    hints.push(`ele disse que a sua última resposta ("${quote(lastAssistant)}") NÃO era o que ele perguntou: não repita essa resposta nem o mesmo número; peça desculpa em poucas palavras e pergunte o que ele queria saber${lastUser ? ` — ou, se a pergunta dele ("${quote(lastUser.text)}") tiver outra leitura óbvia, responda essa outra leitura com a ferramenta` : ""}`);
    return hints.join("; ");
  }
  const resume = henryResumeTopic(text, turns);
  if (resume) {
    hints.push(`ele quer VOLTAR ao assunto "${resume.topic}"${resume.previous ? ` (a pergunta dele sobre isso foi "${resume.previous}")` : ""}: responda de novo sobre ${resume.topic}, com o mesmo período que ele tinha pedido, usando a ferramenta; não fale do assunto mais recente e não abra tela`);
  }
  if (isMusicRequest(text)) {
    const part = henryQuestionPart(text);
    if (part) hints.push(`pedido com DUAS partes — a música E "${quote(part)}": chame spotify E a ferramenta da outra parte; confirme a música em poucas palavras e responda a outra parte com o número`);
  } else if (startsWithGreeting(text) && !isHenryGreeting(text) && henryQuestionPart(text)) {
    hints.push(`ele te cumprimentou E fez uma pergunta ("${quote(stripGreetingHead(text))}"): no máximo um cumprimento de 2 ou 3 palavras e RESPONDA a pergunta com a ferramenta ("movimento"/"como tá o dia" = relatorio_do_dia); não pergunte como ele está`);
  }
  return hints.join("; ");
}
