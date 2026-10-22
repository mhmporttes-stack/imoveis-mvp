// Núcleo PURO (testável, sem banco) do assistente de voz "Henry" (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md
// HENRY-1). Usado pelo componente do navegador (components/henry/HenryVoiceAssistant.jsx) e pelo servidor (lib/henry-voice.js).
// Aqui moram: a palavra de chamada, a lista FECHADA de telas que o Henry pode abrir, quem pode usar, a limpeza da fala e a
// estimativa de custo. Nenhum número do CRM é calculado aqui — os dados vêm das fontes que já existem (Alexa V2, Início).
import { isSafeToSpeak } from "./alexa-v2/sanitize.mjs";

export const HENRY_NAME = "Henry";
export const HENRY_OWNER_SPOKEN_NAME = "Matheus";
export const HENRY_SETTING_ID = "henry_voice_assistant";
export const HENRY_MAX_QUESTION_LENGTH = 500;
export const HENRY_MAX_REPLY_LENGTH = 700;
export const HENRY_HISTORY_TURNS = 12; // ~6 trocas (pergunta + resposta) do modo conversa
export const HENRY_FALLBACK_REPLY = "Não posso falar isso por voz. Abra a tela correspondente no CRM.";

export function normalizeSpeechText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Palavra de chamada ----------------------------------------------------------------------------------------------
// O reconhecimento de fala do Chrome (pt-BR) escreve "Henry" de vários jeitos. Variações fortes contam sempre que vierem
// no começo da frase (sozinhas ou depois de uma saudação: "bom dia, Henry", "olá Henry", "ei Henry"). "Henrique" é nome
// comum de cliente ("o Henrique mandou os documentos"), então só conta como chamada DEPOIS de uma saudação ("oi,
// Henrique"). Nome no meio da frase nunca chama.
export const WAKE_WORDS_STRONG = ["henry", "henri", "enri", "enry", "henrri", "rienri", "henrry", "henrie"].map(normalizeSpeechText);
export const WAKE_WORDS_WEAK = ["henrique"];
const GREETING_TOKENS = new Set(["bom", "boa", "dia", "tarde", "noite", "ola", "oi", "oie", "ei", "hey", "e", "ai", "alo", "opa", "fala", "salve"]);
const GREETING_HEADS = new Set(["bom", "boa", "ola", "oi", "oie", "ei", "hey", "alo", "opa", "fala", "salve", "e"]);
// Sobras que não são pergunta ("Henry, tudo bem?") — viram o relatório do dia quando houve saudação.
const FILLER_TOKENS = new Set([...GREETING_TOKENS, "tudo", "bem", "beleza", "como", "vai", "voce", "esta", "ta", "por", "favor"]);
const MAX_GREETING_TOKENS = 4;

// Devolve { called, kind, question, greeted }:
//   kind "report"   → saudação sem pergunta ("bom dia, Henry") → relatório do dia;
//   kind "wake"     → só o nome ("Henry") → o Henry responde "Pode falar" e espera a pergunta;
//   kind "question" → nome + pergunta ("Henry, quantos clientes aguardam resposta?").
export function detectWakeWord(transcript) {
  const tokens = normalizeSpeechText(transcript).split(" ").filter(Boolean);
  const none = { called: false, kind: "", question: "", greeted: false };
  if (!tokens.length) return none;
  for (let index = 0; index < tokens.length && index <= MAX_GREETING_TOKENS; index += 1) {
    const token = tokens[index];
    const before = tokens.slice(0, index);
    const onlyGreetingBefore = before.every((word) => GREETING_TOKENS.has(word)) && (!before.length || GREETING_HEADS.has(before[0]));
    if (!onlyGreetingBefore) return none;
    const strong = WAKE_WORDS_STRONG.includes(token);
    const weak = WAKE_WORDS_WEAK.includes(token) && before.length > 0;
    if (!strong && !weak) {
      if (GREETING_TOKENS.has(token)) continue;
      return none;
    }
    const restTokens = tokens.slice(index + 1);
    const greeted = before.length > 0 || (restTokens.length > 0 && restTokens.every((word) => FILLER_TOKENS.has(word)) && restTokens.some((word) => GREETING_HEADS.has(word) || word === "dia" || word === "tarde" || word === "noite"));
    const onlyFiller = restTokens.every((word) => FILLER_TOKENS.has(word));
    if (!restTokens.length || onlyFiller) return { called: true, kind: greeted ? "report" : "wake", question: "", greeted };
    return { called: true, kind: "question", question: questionAfterWake(transcript, index + 1), greeted };
  }
  return none;
}

// Recorta do texto ORIGINAL (com acentos) o que vem depois do nome, para a pergunta ir legível ao modelo.
function questionAfterWake(transcript, wordsToSkip) {
  const words = String(transcript || "").trim().split(/\s+/);
  let skipped = 0;
  let position = 0;
  while (position < words.length && skipped < wordsToSkip) {
    if (normalizeSpeechText(words[position])) skipped += 1;
    position += 1;
  }
  return words.slice(position).join(" ").replace(/^[\s,.;:!?-]+/, "").trim().slice(0, HENRY_MAX_QUESTION_LENGTH);
}

// Eco: o microfone ouve a própria voz do Henry. Frase reconhecida que é pedaço da última resposta é ignorada (vale para a
// janela de continuação sem o nome, logo depois de ele falar).
export function looksLikeEcho(transcript, lastReply) {
  const heard = normalizeSpeechText(transcript);
  const reply = normalizeSpeechText(lastReply);
  if (!heard || !reply) return false;
  if (reply.includes(heard)) return true;
  const words = heard.split(" ");
  const replyWords = new Set(reply.split(" "));
  const shared = words.filter((word) => replyWords.has(word)).length;
  return words.length >= 3 && shared / words.length >= 0.7;
}

// --- Quem pode usar ---------------------------------------------------------------------------------------------------
// Só o dono, na conta REAL (nunca em "Alterar conta"), e com o Henry ligado. Outros perfis: nada aparece e a rota recusa.
export function isHenryEligible({ ok, accountSwitchMode, isOwner } = {}) {
  return Boolean(ok && isOwner && !accountSwitchMode);
}

export function henryEnabledFromSetting(value) {
  return value?.disabled !== true; // nasce LIGADO: sem registro = ligado
}

// --- Telas que o Henry pode abrir (lista FECHADA) ----------------------------------------------------------------------
// O modelo só escolhe uma CHAVE; o caminho vem daqui. Rota fora da lista nunca é aberta.
export const HENRY_NAV_TARGETS = Object.freeze({
  inicio: { path: "/admin/inicio", label: "Início" },
  clientes: { path: "/admin/simulacoes", label: "Clientes" },
  chat: { path: "/admin/chat", label: "Chat" },
  chat_marketplace: { path: "/admin/chat/marketplace", label: "Chat do Marketplace" },
  meta_diaria: { path: "/admin/meta-diaria", label: "Meta Diária" },
  desempenho: { path: "/admin/desempenho", label: "Desempenho" },
  online: { path: "/admin/desempenho/online", label: "Online" },
  clientes_esfriados: { path: "/admin/desempenho/esfriados", label: "Clientes esfriados" },
  pontuacao: { path: "/admin/desempenho/pontuacao", label: "Pontuação" },
  relatorio_diario: { path: "/admin/relatorio-diario", label: "Relatório Diário" },
  agenda: { path: "/admin/calendario", label: "Agenda" },
  prospeccao: { path: "/admin/prospeccao", label: "Prospecção" },
  documentacao: { path: "/admin/documentacao", label: "Documentação" },
  financeiro: { path: "/admin/financeiro", label: "Financeiro" },
  corretores: { path: "/admin/corretores", label: "Corretores" },
  automacoes: { path: "/admin/automacoes", label: "Automações" },
  anuncios: { path: "/admin/anuncios", label: "Anúncios" },
  captacoes: { path: "/admin/captacoes", label: "Captações" },
  imoveis: { path: "/admin/imoveis", label: "Imóveis" },
  empreendimentos: { path: "/admin/empreendimentos", label: "Empreendimentos" },
  gastos_ia: { path: "/admin/gastos-ia", label: "Gastos de IA" },
  alexa: { path: "/admin/alexa", label: "Alexa e Henry" }
});
export const HENRY_NAV_KEYS = Object.keys(HENRY_NAV_TARGETS);

export function resolveHenryNavigation(key) {
  const target = Object.prototype.hasOwnProperty.call(HENRY_NAV_TARGETS, key) ? HENRY_NAV_TARGETS[key] : null;
  return target ? { key, path: target.path, label: target.label } : null;
}

// Defesa do lado do navegador: só segue caminho que esteja na lista (mesmo que a resposta venha adulterada).
export function isAllowedHenryPath(path) {
  return HENRY_NAV_KEYS.some((key) => HENRY_NAV_TARGETS[key].path === path);
}

// --- Texto falado -----------------------------------------------------------------------------------------------------
// Tira marcação (markdown, listas), junta espaços e corta no limite; depois a MESMA barreira da Alexa (sem CPF, renda,
// telefone, e-mail, valores em reais, números longos): se algo passar, a resposta inteira vira a frase neutra.
export function cleanHenryReply(text) {
  const plain = String(text || "")
    .replace(/[*_#`>|]/g, " ")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= HENRY_MAX_REPLY_LENGTH) return plain;
  const cut = plain.slice(0, HENRY_MAX_REPLY_LENGTH);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return lastStop > 80 ? cut.slice(0, lastStop + 1) : `${cut.trim()}…`;
}

export function safeHenryReply(text) {
  const clean = cleanHenryReply(text);
  return clean && isSafeToSpeak(clean) ? clean : HENRY_FALLBACK_REPLY;
}

// "Bom dia, Matheus. Hoje você tem..." → "Bom dia, Matheus. Segue o relatório do dia. Hoje você tem..." (frase do dono).
// Com elogio (visão, HENRY-2): "Bom dia, Matheus. <elogio> Segue o relatório do dia. ...".
// address = "Como tratar o dono" (Voz e personalidade): troca só o nome da saudação ("Bom dia, chefe.").
export function withReportIntro(text, compliment = "", address = "") {
  const value = String(text || "").trim();
  const match = value.match(/^([^.]+\.)\s+(.+)$/);
  if (!match) return value;
  const extra = String(compliment || "").trim();
  const name = String(address || "").trim();
  const greeting = name ? match[1].replace(/^((?:bom dia|boa tarde|boa noite|ol[aá]|oi)\b[^,.]*),\s*[^,.]+\.$/i, `$1, ${name}.`) : match[1];
  return `${greeting}${extra ? ` ${extra}` : ""} Segue o relatório do dia. ${match[2]}`;
}

// "3 h 05 min" / "12 min" (texto da tela) → "3 horas e 5 minutos" / "12 minutos" para a voz.
export function speakableDurations(text) {
  const unit = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  return String(text || "")
    .replace(/(\d+) h (\d+) min\b/g, (_, h, m) => (Number(m) ? `${unit(Number(h), "hora", "horas")} e ${unit(Number(m), "minuto", "minutos")}` : unit(Number(h), "hora", "horas")))
    .replace(/(\d+) min\b/g, (_, m) => unit(Number(m), "minuto", "minutos"));
}

// Relatório do dia falado: a MESMA frase da tela Início. Para o dono, o resumo ampliado (INI-5, getPainelInicioDono →
// text: leads, equipe on-line, aguardando resposta, atenções) + aguardando documentos; sem ele (falhou), a frase do
// assistente do Início (getPainelInicio → assistant.text) + leads + documentos. Valor indisponível fica fora. Nenhuma
// conta nova. compliment = elogio da visão (já validado por parseComplimentReply), vai logo depois da saudação.
export function composeHenryDailyReport(inicio, { ownerText = "", compliment = "", address = "" } = {}) {
  const docs = inicio?.kpis?.docs?.total;
  const docsSentence = Number.isFinite(docs) && docs > 0 ? (docs === 1 ? "1 cliente aguarda documentos." : `${docs} clientes aguardam documentos.`) : "";
  const owner = String(ownerText || "").trim();
  if (owner) return speakableDurations(withReportIntro([owner, docsSentence].filter(Boolean).join(" "), compliment, address));
  let base = String(inicio?.assistant?.text || "").trim();
  if (!base) return "";
  // Falado em voz alta: do cliente que espera há mais tempo, só o primeiro nome (mesma regra da Alexa).
  const urgentName = String(inicio?.assistant?.urgent?.name || "").trim();
  const urgentFirst = urgentName.split(/\s+/)[0];
  if (urgentName && urgentFirst && urgentName !== urgentFirst) base = base.split(urgentName).join(urgentFirst);
  const extras = [];
  const leads = inicio?.kpis?.leadsToday?.total;
  if (Number.isFinite(leads)) extras.push(leads === 0 ? "Ainda não entrou nenhum lead hoje." : leads === 1 ? "Hoje entrou 1 lead." : `Hoje entraram ${leads} leads.`);
  if (docsSentence) extras.push(docsSentence);
  return speakableDurations(withReportIntro([base, ...extras].join(" "), compliment, address));
}

// --- Visão pela webcam (HENRY-2, dono 2026-10-22) -------------------------------------------------------------------
// Liga/desliga próprio, no MESMO registro do Henry (crm_settings henry_voice_assistant): nasce DESLIGADA.
export function henryVisionFromSetting(value) {
  return value?.vision === true;
}

// Pergunta com intenção visual ("o que é isso?", "Henry, olha isso") → o navegador captura 1 quadro da webcam.
const VISUAL_PATTERNS = [
  /\bo que (e|eh|seria) (isso|isto|esse|essa|este|esta|aqui)\b/,
  /\bque (e|eh) (isso|isto)\b/,
  /\b(olha|olhe|olhar|veja|ve|ver|repara|repare) (isso|isto|aqui|so|esse|essa|este|esta|pra mim|para mim|o que)\b/,
  /\bo que (voce )?(esta|ta) vendo\b/,
  /\bo que (voce )?ve\b/,
  /\b(que|qual) (objeto|coisa|marca|modelo|cor) (e|eh) (essa|esse|essa aqui|esse aqui|isso)\b/,
  /\bo que (eu )?(estou|to|tenho) (segurando|mostrando|na mao|nas maos|vestindo|usando)\b/,
  /\b(reconhece|identifica|sabe o que e) (isso|isto|esse|essa)\b/,
  /\bcomo (eu )?(estou|to) (hoje|vestido)\b/
];

export function isVisualQuestion(text) {
  const value = normalizeSpeechText(text);
  return Boolean(value) && VISUAL_PATTERNS.some((pattern) => pattern.test(value));
}

// O servidor só usa a imagem com a visão ligada e no "bom dia" ou numa pergunta com intenção visual.
export function shouldUseHenryImage({ vision, mode, question } = {}) {
  if (vision !== true) return false;
  return mode === "report" || isVisualQuestion(question);
}

// Imagem que o navegador manda: só JPEG em data URL, tamanho limitado (≈ 768 px, q 0,7 ≈ 60–150 KB). A imagem só
// existe na memória da requisição: nunca é gravada (banco, log, storage, console).
export const HENRY_IMAGE_MAX_BASE64 = 700_000;
export function parseHenryImage(dataUrl) {
  const value = typeof dataUrl === "string" ? dataUrl : "";
  const match = value.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1].length < 1000 || match[1].length > HENRY_IMAGE_MAX_BASE64) return null;
  return { mediaType: "image/jpeg", data: match[1] };
}

// Elogio do "Bom dia, Henry": regras do dono no prompt + checagem no código (o código é a barreira, o prompt orienta).
export const COMPLIMENT_SKIP_TOKEN = "PULAR";
export const COMPLIMENT_MEMORY = 7;
const COMPLIMENT_FORBIDDEN = /\b(corpo|peso|magr\w*|gord\w*|barriga|rosto|cara|pele|idade|jovem|velh\w*|anos|cabel\w*|careca|calv\w*|barba|bigode|olhos?|sorriso|dentes|nariz|bonit\w*|lind\w*|feio|feia|musculos\w*|forte|acima do peso|emagrec\w*|engord\w*|rug\w*|maquiagem|tatuag\w*|pesco\w*|bra[cç]\w*|pernas?|m[aã]os?)\b/i;
const COMPLIMENT_CRITIQUE = /\b(mas|por[eé]m|poderia|deveria|ficaria melhor|n[aã]o combina|estranh\w*|amassad\w*|manchad\w*|feio|bagun[cç]\w*)\b/i;

// address = "Como tratar o dono" já sanitizado (henry-voice-style.mjs); só troca o vocativo — as regras do elogio não mudam
// e o campo livre "Detalhes do jeito de falar" NUNCA entra aqui.
export function buildComplimentPrompt(recent = [], { address = "" } = {}) {
  const avoid = (Array.isArray(recent) ? recent : []).filter(Boolean).slice(-COMPLIMENT_MEMORY);
  const name = String(address || "").replace(/["\n\r]/g, " ").trim().slice(0, 40) || HENRY_OWNER_SPOKEN_NAME;
  return `Você é o Henry, assistente do Matheus (corretor de imóveis). A imagem é um quadro da webcam dele agora, no "bom dia".
Escreva UMA frase curta (até 14 palavras), em português do Brasil, simpática e DISCRETA, como um colega que comenta de passagem, elogiando só ROUPA e ACESSÓRIOS — UMA peça ou acessório visível: cor da camisa, relógio, calça, óculos, corte da roupa ou combinação de cores.
Tom leve e sincero, sem exagero: nada de superlativos nem bajulação ("incrível", "impecável", "espetacular", "de respeito", "arrasou", "perfeito", "show"). Ex. do tom: "Gostei dessa camisa azul, combinou bem com o relógio."
Chame-o de "${name}". Não cumprimente (o bom dia já foi dito). Não faça pergunta.
NUNCA comente corpo, peso, rosto, pele, idade, cabelo, barba ou qualquer característica física, e nunca faça crítica, ressalva ou sugestão.
Sem emoji, sem aspas. Elogie a peça, não a pessoa (evite "bonito" e "lindo").
Se a imagem estiver escura, borrada, sem ninguém, ou sem roupa/acessório reconhecível, responda exatamente: ${COMPLIMENT_SKIP_TOKEN}
${avoid.length ? `Não repita o mesmo foco nem a mesma frase destes elogios recentes:\n${avoid.map((item) => `- ${item}`).join("\n")}` : ""}`.trim();
}

// Resposta do modelo → frase falável, ou "" (pula o elogio em silêncio).
export function parseComplimentReply(text) {
  const value = cleanHenryReply(text).replace(/^["“]|["”]$/g, "").trim();
  if (!value || value.toUpperCase().includes(COMPLIMENT_SKIP_TOKEN)) return "";
  const first = (value.match(/^[^.!?]*[.!?]/) || [value])[0].trim();
  if (first.length < 12 || first.length > 140) return "";
  if (COMPLIMENT_FORBIDDEN.test(first) || COMPLIMENT_CRITIQUE.test(first) || first.includes("?")) return "";
  return isSafeToSpeak(first) ? first : "";
}

export function rememberCompliment(recent, text) {
  const list = (Array.isArray(recent) ? recent : []).filter((item) => typeof item === "string" && item.trim());
  if (!text) return list.slice(-COMPLIMENT_MEMORY);
  return [...list, text].slice(-COMPLIMENT_MEMORY);
}

// Pergunta com imagem: instrução extra para o modelo.
export const VISION_QUESTION_NOTE =
  "A pergunta veio com uma imagem: é um quadro da webcam do Matheus agora. Identifique ou descreva o que ele está mostrando em 1 ou 2 frases curtas. " +
  "Não comente corpo, rosto, pele, idade nem cabelo de ninguém, não identifique pessoas pelo rosto e não leia em voz alta documentos, números ou dados pessoais que aparecerem.";

// Histórico curto que o navegador manda para dar contexto ("e ontem?"). Só papel + texto, cortado; nada é gravado.
export function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  const turns = history
    .filter((turn) => turn && (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string" && turn.text.trim())
    .slice(-HENRY_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, text: turn.text.trim().slice(0, HENRY_MAX_REPLY_LENGTH) }));
  while (turns.length && turns[0].role !== "user") turns.shift();
  // A API exige papéis alternados: junta repetidos.
  const merged = [];
  for (const turn of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) last.text = `${last.text} ${turn.text}`.slice(0, HENRY_MAX_REPLY_LENGTH * 2);
    else merged.push({ ...turn });
  }
  if (merged.length && merged[merged.length - 1].role === "user") merged.pop(); // a pergunta atual entra depois
  return merged;
}

// --- Custo (estimativa, registrada em "Gastos de IA") ----------------------------------------------------------------
// Claude Haiku 5.5 (prompts < 100 mil tokens): US$ 0,10 / milhão de entrada, US$ 0,50 / milhão de saída.
export const HENRY_PRICE_INPUT_PER_MTOK = 0.1;
export const HENRY_PRICE_OUTPUT_PER_MTOK = 0.5;
// Voz (OpenAI gpt-4o-mini-tts): ~US$ 0,015 por minuto falado; ~900 caracteres por minuto em português.
export const HENRY_TTS_USD_PER_MINUTE = 0.015;
const TTS_CHARS_PER_MINUTE = 900;

export function estimateHenryModelCostUsd({ inputTokens = 0, outputTokens = 0 } = {}) {
  return (Number(inputTokens) || 0) / 1e6 * HENRY_PRICE_INPUT_PER_MTOK + (Number(outputTokens) || 0) / 1e6 * HENRY_PRICE_OUTPUT_PER_MTOK;
}

// Imagem no Claude: ~ (largura × altura) / 750 tokens de entrada (768 × 576 ≈ 590 tokens ≈ US$ 0,00006 no Haiku 5.5).
export function estimateImageTokens(width = 768, height = 576) {
  return Math.ceil((Number(width) * Number(height)) / 750);
}

export function estimateHenryTtsCostUsd(text) {
  return (String(text || "").length / TTS_CHARS_PER_MINUTE) * HENRY_TTS_USD_PER_MINUTE;
}
