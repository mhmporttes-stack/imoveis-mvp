// Aba "Sem resposta" dos Chats (WhatsApp e Marketplace) — WA-38 (dono, 2026-10-30).
// Conversa cuja ÚLTIMA mensagem do cliente é um encerramento curto ("ok", "obrigado", "👍", só emoji) ou uma negativa que
// não segue em atendimento ("não tenho interesse", "já comprei", "pare de mandar") sai SÓ da aba (e do contador dela).
// Nada é enviado, nada muda status/tags; o cliente escrever outra coisa traz a conversa de volta (é a última mensagem).
// Regras puras (sem banco): mesma decisão no servidor do WhatsApp, no do Marketplace e na tela de configuração.
//
// Casamento (nunca "contém" solto para encerramento):
//  - encerramento: a mensagem INTEIRA é uma sequência de frases da lista (ex.: "ok obrigado", "combinado, obrigada"),
//    podendo ter cumprimento/conectivo em volta ("boa tarde, obrigada") — cumprimento sozinho NÃO é encerramento;
//  - negativa: a frase da lista aparece inteira (por palavras) numa mensagem curta (até NEGATIVE_MAX_WORDS palavras);
//  - só emoji/pontuação (sem letra nem número) = encerramento;
//  - "?" em qualquer lugar = pergunta → nunca sai da aba ("ok, mas qual o valor?").
// Lista padrão escolhida pelas mensagens reais recebidas (análise de 2026-10-30, ver docs/BUSINESS_RULES.md WA-38).

export const NEGATIVE_MAX_WORDS = 16;
export const PHRASE_MAX_LENGTH = 80;
export const PHRASE_LIST_MAX = 200;

export const DEFAULT_CLOSING_PHRASES = Object.freeze([
  "ok", "okay", "certo", "ta", "ta bom", "tabom", "ta bem", "ta otimo", "beleza", "blz", "bele", "combinado", "fechado",
  "entendi", "tendi", "ata", "ah ta", "show", "top", "perfeito", "otimo", "joia", "valeu", "vlw", "tmj", "pode deixar",
  "deixa comigo", "obrigado", "obrigada", "obg", "obgd", "obrigadao", "muito obrigado", "muito obrigada", "obrigado mesmo",
  "agradeco", "grato", "grata", "por nada", "de nada", "imagina", "magina", "disponha", "amem", "gracas a deus",
  "deus abencoe", "deus te abencoe", "fica com deus", "fica em paz", "boa semana", "bom fim de semana", "bom trabalho",
  "ate mais", "ate logo", "ate amanha", "tchau", "kkk", "haha", "rs", "figurinha",
  // negativas curtas que só valem como mensagem inteira ("não quero perder essa" segue na aba)
  "sair", "nao quero", "nao quero mais", "nao preciso", "nao preciso mais", "desisti", "parei"
]);

export const DEFAULT_NEGATIVE_PHRASES = Object.freeze([
  "nao tenho interesse", "nao tenho mais interesse", "sem interesse", "nao estou interessado",
  "nao estou interessada", "nao tenho interesse no momento", "ja comprei", "comprei um imovel", "ja tenho casa", "ja tenho imovel", "ja resolvi",
  "pare de mandar", "para de mandar", "pare de me mandar", "para de me mandar", "nao me mande mais",
  "nao mande mais", "me tira da lista", "remover meu numero", "numero errado", "foi engano"
]);

// Cumprimentos/conectivos que podem acompanhar um encerramento, mas sozinhos NÃO encerram ("bom dia" pede resposta).
export const CLOSING_FILLERS = Object.freeze([
  "bom dia", "boa tarde", "boa noite", "oi", "ola", "e", "mas", "mais", "muito", "mt", "entao", "ah", "a", "sim", "ne",
  "pra voce", "pra vc", "tambem", "tb", "tbm", "viu", "amigo", "amiga", "querido", "querida"
]);

// minúsculas, sem acento, sem pontuação/emoji, espaços únicos; letras repetidas viram uma ("obrigadaaa", "blzz", "kkkkk").
export function normalizeClosingText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/([a-z])\1+/g, "$1")
    .trim()
    .replace(/\s+/g, " ");
}

// Lista vinda da tela/banco → frases normalizadas, sem repetição, sem vazias, com teto.
export function sanitizePhraseList(list) {
  const items = Array.isArray(list) ? list : String(list || "").split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const raw of items) {
    const phrase = normalizeClosingText(String(raw || "").slice(0, PHRASE_MAX_LENGTH));
    if (!phrase || seen.has(phrase)) continue;
    seen.add(phrase);
    out.push(phrase);
    if (out.length >= PHRASE_LIST_MAX) break;
  }
  return out;
}

export function defaultClosingConfig() {
  return { closing: sanitizePhraseList(DEFAULT_CLOSING_PHRASES), negative: sanitizePhraseList(DEFAULT_NEGATIVE_PHRASES) };
}

// Config salva (ou nada) → config pronta para o classificador. Sem config salva = padrão.
export function resolveClosingConfig(saved) {
  if (!saved || typeof saved !== "object") return defaultClosingConfig();
  return {
    closing: sanitizePhraseList(saved.closing),
    negative: sanitizePhraseList(saved.negative)
  };
}

// A sequência de palavras é coberta só por frases da lista + conectivos, com ao menos UMA frase da lista?
function coveredByPhrases(words, phrases, fillers) {
  const split = (list) => list.map((item) => item.split(" ")).sort((a, b) => b.length - a.length);
  const main = split(phrases);
  const extra = split(fillers);
  const memo = new Map();
  const walk = (index, hasMain) => {
    if (index === words.length) return hasMain;
    const key = `${index}:${hasMain}`;
    if (memo.has(key)) return memo.get(key);
    let ok = false;
    for (const [tokens, isMain] of [...main.map((t) => [t, true]), ...extra.map((t) => [t, false])]) {
      if (tokens.length && tokens.every((token, offset) => words[index + offset] === token) && walk(index + tokens.length, hasMain || isMain)) {
        ok = true;
        break;
      }
    }
    memo.set(key, ok);
    return ok;
  };
  return walk(0, false);
}

function containsPhrase(words, phrase) {
  const tokens = phrase.split(" ");
  for (let start = 0; start + tokens.length <= words.length; start += 1) {
    if (tokens.every((token, offset) => words[start + offset] === token)) return true;
  }
  return false;
}

// "closing" | "negative" | "" (fica na aba).
export function classifyClosingMessage(text, config = defaultClosingConfig()) {
  const raw = String(text || "").trim();
  if (!raw || raw.includes("?")) return "";
  const normalized = normalizeClosingText(raw);
  if (!normalized) return "closing"; // só emoji/pontuação ("👍", "🙏🏼🙏🏼", "☺️😘")
  const words = normalized.split(" ");
  const fillers = sanitizePhraseList(CLOSING_FILLERS);
  const closing = Array.isArray(config?.closing) ? config.closing : [];
  const negative = Array.isArray(config?.negative) ? config.negative : [];
  if (closing.length && coveredByPhrases(words, closing, fillers)) return "closing";
  if (words.length <= NEGATIVE_MAX_WORDS && negative.some((phrase) => phrase && containsPhrase(words, phrase))) return "negative";
  return "";
}

export function isClosingMessage(text, config) {
  return classifyClosingMessage(text, config) !== "";
}
