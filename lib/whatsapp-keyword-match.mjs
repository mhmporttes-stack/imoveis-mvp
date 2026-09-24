// Comparação de palavra-chave das respostas automáticas do WhatsApp (pura, sem
// banco — testada em tests/whatsapp-keyword-match.test.mjs).
//
// A palavra-chave só vale como PALAVRA (ou sequência de palavras) inteira: "sim"
// casa com "Sim!", "sim, quero" e "pode ser sim", mas NÃO com "simulação",
// "assim" ou "simples". Antes era "contém": qualquer texto com "sim" dentro
// disparava a regra "sim" (criando cliente na roleta) — bug confirmado em produção.

export function normalizeForKeyword(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// "Sim, quero!" -> ["sim", "quero"] (pontuação e emoji separam palavras).
export function keywordTokens(value) {
  return normalizeForKeyword(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function keywordMatchesMessage(message, keyword) {
  const words = keywordTokens(keyword);
  const text = keywordTokens(message);
  if (!words.length || words.length > text.length) return false;
  for (let start = 0; start + words.length <= text.length; start += 1) {
    if (words.every((word, offset) => text[start + offset] === word)) return true;
  }
  return false;
}
