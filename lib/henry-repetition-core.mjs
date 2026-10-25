// Repetição por SEMELHANÇA nas falas do Henry (dono, 2026-10-25: "o início dele é muito repetitivo: 'Ok, vou dar uma
// olhada nos números'. É tudo a mesma coisa. [...] A regra de não repetir não está funcionando: ele pode não falar
// exatamente a mesma coisa, mas muda uma palavra e fala a mesma frase." — docs/BUSINESS_RULES.md HENRY-1 "Sem repetir
// por semelhança"). Núcleo PURO (sem rede, testes em tests/henry-repetition.test.mjs). FONTE ÚNICA da medida de
// semelhança usada por:
//   - confirmação de escuta e frases de espera (pickListenAck/pickWaitPhrase, lib/henry-voice-narration.mjs);
//   - repertório do vocabulário (drawHenryRepertoire, lib/henry-voice-lexicon.mjs);
//   - abertura que o modelo gera (trimRepeatedOpening, aplicada em lib/henry-voice.js);
//   - relatório do Treino (analyzeHenryTraining, lib/henry-training-core.mjs).
// Como mede: texto normalizado (minúsculas, sem acento/pontuação) → palavras de CONTEÚDO, com as variações da mesma ideia
// juntadas num sinônimo canônico ("olhada/conferir/checar/ver" = VER; "números/dados/resultados/CRM" = DADOS; "vou/tô/
// deixa eu/bora" = VOU) e as muletas descartadas ("ok", "beleza", "aqui", "rapidinho"...). Semelhança = Jaccard dos
// conjuntos; "parecida" = Jaccard ≥ 0,6 ou um conjunto (2+ palavras) contido no outro. Sem palavra de conteúdo (só
// muleta: "Opa!", "Beleza."), parecida só se o texto normalizado for igual.

import { normalizeSpeechText } from "./henry-voice-core.mjs";

export const SIMILARITY_THRESHOLD = 0.6;

// Muletas: não carregam a ideia da frase (trocar uma pela outra é "a mesma frase").
const FILLERS = new Set(
  (
    "a o as os um uma uns umas de do da dos das no na nos nas em ao aos pra pro pras pros para por pelo pela com sem que e " +
    "ou mas se eu me mim te ti voce voces ele ela isso esse essa isto este esta nesse nessa nisso neste nesta esses essas " +
    "seu sua seus suas meu minha meus minhas teu tua ok okay okey beleza blz certo certinho show fechou fechado opa ah ahn " +
    "hum hmm uhum ok tranquilo perfeito entao bom bem pronto prontinho olha olhe so aqui ai la agora ja rapidinho rapido " +
    "logo jeito tipo assim mesmo muito bastante todo toda tudo direitinho certinho pouquinho pouco mais matheus chefe " +
    "patrao parceiro amigo querido ne viu sim claro"
  ).split(" ")
);

// Sinônimos canônicos (por início da palavra, depois da normalização). A 1ª regra que casar vence.
const CANON = [
  ["VOU", /^(vou|vamos|vamo|bora|deixa|deixe|deixo|to|tou|estou|tamo|estamos)$/],
  ["VER", /^(olh|confer|confir|chec|verific|ver$|vendo$|vejo$|veja$|espi|analis|revis|consult|pux|busc|procur|vascul|garimp|investig|apur|levant|examin|averigu|repass|passand|passar$|dou$|dar$|dando$|lend|ler$|leio$)/],
  ["DADOS", /^(numer|dado|resultad|informac|info$|crm$|sistema|relatori|planilh|ficha|cadastr|registr|historic)/],
  ["INSTANTE", /^(instant|segund|minut|moment|tiquinho|pouquinh)/],
  ["FALAR", /^(falo$|falar|conto$|contar|digo$|dizer|passo$|respond|trago$|trazer|mostr)/],
  ["MONTAR", /^(soma|soman|conta$|contas$|calcul|junt|organiz|separ|mont|fechand|fechar$)/]
];

function canonical(word) {
  for (const [label, pattern] of CANON) if (pattern.test(word)) return label;
  return word;
}

// Conjunto de palavras de conteúdo (canônicas) de uma frase.
// Cache curto só na memória do processo (o sorteio do repertório compara centenas de expressões); nunca gravado.
const TOKEN_CACHE = new Map();
const TOKEN_CACHE_MAX = 5000;
export function phraseTokens(text) {
  const key = String(text || "");
  const cached = TOKEN_CACHE.get(key);
  if (cached) return cached;
  const tokens = computeTokens(key);
  if (TOKEN_CACHE.size >= TOKEN_CACHE_MAX) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(key, tokens);
  return tokens;
}

function computeTokens(text) {
  const words = normalizeSpeechText(text).split(" ").filter(Boolean);
  const out = new Set();
  for (const word of words) {
    if (FILLERS.has(word)) continue;
    const canon = canonical(word);
    if (canon !== word) out.add(canon);
    else if (word.length > 1 && !/^\d+$/.test(word)) out.add(word);
  }
  return out;
}

// 0 a 1. Sem palavra de conteúdo dos dois lados: 1 se o texto normalizado for igual, senão 0.
export function phraseSimilarity(a, b) {
  const ta = phraseTokens(a);
  const tb = phraseTokens(b);
  if (!ta.size || !tb.size) {
    const na = normalizeSpeechText(a);
    return na && na === normalizeSpeechText(b) ? 1 : 0;
  }
  let common = 0;
  for (const token of ta) if (tb.has(token)) common += 1;
  const jaccard = common / (ta.size + tb.size - common);
  const smaller = Math.min(ta.size, tb.size);
  // "Deixa eu ver" ⊂ "Deixa eu ver isso direitinho": a mesma frase com um enfeite.
  if (smaller >= 2 && common === smaller) return Math.max(jaccard, 0.8);
  return jaccard;
}

export function isSimilarPhrase(a, b, threshold = SIMILARITY_THRESHOLD) {
  if (!String(a || "").trim() || !String(b || "").trim()) return false;
  return phraseSimilarity(a, b) >= threshold;
}

export function isSimilarToAny(text, list = [], threshold = SIMILARITY_THRESHOLD) {
  return (list || []).some((item) => isSimilarPhrase(text, item, threshold));
}

// Agrupa por semelhança (o 1º de cada grupo representa): [{ text, count, items }] na ordem da 1ª aparição.
export function groupSimilar(items = [], threshold = SIMILARITY_THRESHOLD) {
  const groups = [];
  for (const item of items) {
    const text = String(item || "").trim();
    if (!text) continue;
    const group = groups.find((entry) => isSimilarPhrase(entry.text, text, threshold));
    if (group) {
      group.count += 1;
      group.items.push(text);
    } else groups.push({ text, count: 1, items: [text] });
  }
  return groups;
}

// Quantas frases de um banco dá para falar no mesmo dia sem nenhuma parecida com outra (escolha gulosa, na ordem).
export function distinctBySimilarity(texts = [], threshold = SIMILARITY_THRESHOLD) {
  const kept = [];
  for (const text of texts) if (!isSimilarToAny(text, kept, threshold)) kept.push(text);
  return kept;
}

// --- Abertura da resposta do modelo ---------------------------------------------------------------------------------------
// "Vou olhar/deixa eu ver/só um instante" numa RESPOSTA não faz sentido: quando o modelo responde, os dados já chegaram
// (a espera é das frases de espera). Curta (até 10 palavras) e sem número.
const PREAMBLE = /\b(vou|deixa eu|deixe eu|bora|vamos|vamo|to|estou|ja|so)\b.*\b(ver|verificar|olhar|olhada|olhadinha|conferir|conferida|checar|checada|analisar|puxar|consultar|buscar|procurar|espiar|espiada|pesquisar|levantar)\b|\b(so|um|uma) (um |uma )?(instante|instantinho|minutinho|segundinho|segundo|momento|momentinho)\b|\bja te (falo|digo|conto)\b|\b(to|estou) (verificando|olhando|conferindo|analisando|puxando|checando|vendo|procurando|buscando|consultando)\b/;
export function isPreambleOpening(text) {
  const value = normalizeSpeechText(text);
  if (!value || /\d/.test(String(text))) return false;
  if (value.split(" ").length > 10) return false;
  return PREAMBLE.test(value);
}

const SENTENCE = /^(.+?[.!?…]+)(\s+|$)/;
const CLAUSE_BREAK = /[,;:—]\s+/g;
// Prefixos de oração da frase ("Ok" · "Ok, vou dar uma olhada nos números") com o que sobra depois de cada um.
function clausePrefixes(sentence) {
  const out = [];
  for (const match of sentence.matchAll(CLAUSE_BREAK)) {
    const head = sentence.slice(0, match.index).trim();
    const tail = sentence.slice(match.index + match[0].length).trim();
    if (head && tail) out.push({ head, tail });
  }
  return out;
}
const wordsIn = (text) => String(text || "").trim().split(/\s+/).filter(Boolean).length;
const upperFirst = (text) => (text ? text[0].toLocaleUpperCase("pt-BR") + text.slice(1) : text);

// Pedaço que pode sair: "vou olhar" (até 10 palavras) ou reação curta parecida com uma abertura de hoje — até 3 palavras
// de conteúdo, sem número e sem nome próprio no meio (assim "A Carol tá na frente" nunca some).
function droppable(piece, usedOpenings) {
  if (!piece || /\d/.test(piece) || wordsIn(piece) > 10) return false;
  if (isPreambleOpening(piece)) return true;
  if (phraseTokens(piece).size > 3 || /\s\p{Lu}/u.test(piece.trim())) return false;
  return isSimilarToAny(piece, usedOpenings);
}

// Tira do começo da resposta a abertura repetida (parecida com uma de hoje) ou de "vou olhar" — frase inteira ou só a
// oração antes da vírgula —, enquanto sobrar resposta (2+ palavras). allowEmpty: pedaço parcial do stream (a 1ª frase
// antecipada): pode sobrar vazio = "ainda não há o que mandar para a voz".
export function trimRepeatedOpening(text, usedOpenings = [], { allowEmpty = false } = {}) {
  let rest = String(text || "").trim();
  for (let step = 0; step < 3 && rest; step += 1) {
    const sentence = rest.match(SENTENCE);
    const first = sentence ? sentence[1] : rest;
    const after = sentence ? rest.slice(sentence[0].length).trim() : "";
    if (droppable(first.replace(/[.!?…]+$/, ""), usedOpenings) && (allowEmpty || wordsIn(after) >= 2)) {
      rest = upperFirst(after);
      continue;
    }
    const clause = clausePrefixes(first).find(({ head, tail }) => droppable(head, usedOpenings) && wordsIn(tail) >= 2);
    if (clause) {
      rest = upperFirst(`${clause.tail}${after ? ` ${after}` : ""}`.trim());
      continue;
    }
    break;
  }
  return rest;
}

// Aberturas das respostas de hoje (o que a semelhança compara): de cada resposta, a 1ª oração curta (até 6 palavras,
// "Opa" de "Opa, entraram…") e a 1ª frase (até 10 palavras). As mais recentes no fim.
export function openingSentencesFrom(turns = [], max = 30) {
  const out = [];
  for (const turn of turns || []) {
    if (turn?.role !== "assistant" || !turn.text) continue;
    const text = String(turn.text).trim();
    const sentence = text.match(SENTENCE);
    const first = (sentence ? sentence[1] : text).replace(/[.!?…]+$/, "").trim();
    const clause = clausePrefixes(first)[0];
    if (clause && wordsIn(clause.head) <= 6) out.push(clause.head);
    if (first) out.push(first.split(/\s+/).slice(0, 10).join(" "));
  }
  return out.slice(-max);
}
