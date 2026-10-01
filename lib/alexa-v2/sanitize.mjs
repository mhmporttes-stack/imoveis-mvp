import { containsSensitiveContent } from "../alexa-config-core.mjs";

// Última barreira antes de a Alexa falar: nada de telefone, e-mail, CPF,
// valores em reais, números longos ou palavras sensíveis. Se algo passar nas
// camadas anteriores por engano, a frase inteira é trocada por uma resposta
// neutra (nunca fala parcialmente um dado sensível).
const PHONE = /(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/;
const EMAIL = /\S+@\S+\.\S+/;

export const SAFE_FALLBACK = "Não posso falar isso por voz.";

export function isSafeToSpeak(text) {
  const value = String(text || "");
  if (!value.trim()) return false;
  if (containsSensitiveContent(value)) return false;
  if (PHONE.test(value) || EMAIL.test(value)) return false;
  return true;
}

export function sanitizeSpeech(text) {
  return isSafeToSpeak(text) ? String(text).replace(/\s+/g, " ").trim() : SAFE_FALLBACK;
}
