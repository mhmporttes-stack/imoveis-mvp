// Origem "Click to WhatsApp" (anúncio patrocinado) — PURO, testado em tests/whatsapp-referral.test.mjs.
//
// A Meta entrega em messages[].referral (primeira mensagem de quem clicou no anúncio) campos como:
// source_url, source_id (ID do anúncio), source_type ("ad" | "post"), headline, body, media_type,
// image_url/video_url/thumbnail_url e ctwa_clid. Nada é obrigatório: qualquer campo pode faltar.

export const SPONSORED_LABEL = "WhatsApp — Anúncio patrocinado";
export const SPONSORED_KIND = "whatsapp_ad";

function clean(value, max = 500) {
  const text = String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim();
  return text ? text.slice(0, max) : "";
}

// Só ANÚNCIO patrocinado (source_type "ad"). "post" (CTA de publicação) não entra automaticamente
// na roleta. Sem source_type mas com identificadores de anúncio (ctwa_clid/source_id) = anúncio.
export function isSponsoredAdReferral(referral) {
  if (!referral || typeof referral !== "object") return false;
  const type = clean(referral.source_type, 20).toLowerCase();
  if (type) return type === "ad";
  return Boolean(clean(referral.ctwa_clid) || clean(referral.source_id));
}

// ID do anúncio (referral.source_id) SÓ quando o referral é de anúncio patrocinado e o ID tem o
// formato numérico da Meta — usado pelo Fluxo para acrescentar {{anuncio_id}} ao link de simulação
// (atribuição anúncio -> cadastro). Qualquer outra coisa (post, vazio, texto estranho): "".
export function adIdFromReferral(referral) {
  if (!isSponsoredAdReferral(referral)) return "";
  const id = clean(referral.source_id, 80);
  return /^[0-9]{5,30}$/.test(id) ? id : "";
}

// Campos do referral que vale guardar na origem do cliente (sem mídia/thumbnail).
export function sanitizeReferral(referral) {
  const source = referral && typeof referral === "object" ? referral : {};
  const result = {
    source_id: clean(source.source_id, 80),
    source_type: clean(source.source_type, 20).toLowerCase(),
    source_url: clean(source.source_url, 500),
    headline: clean(source.headline, 200),
    body: clean(source.body, 300),
    media_type: clean(source.media_type, 20),
    ctwa_clid: clean(source.ctwa_clid, 300)
  };
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value));
}

// Nome de exibição do WhatsApp usado como full_name de um cadastro automático (patrocinado, contato
// direto, resposta por palavra-chave/Fluxo) — nunca é digitado por um humano, então pode ser QUALQUER
// coisa: um emoji sozinho, "🙏", um número, uma frase de status. O banco tem uma checagem
// (`simulation_registrations_full_name_check`: `length(btrim(full_name)) > 1`) que rejeita nome de
// 0-1 caractere depois de aparado — sem essa mesma checagem aqui ANTES de tentar o INSERT, o cadastro
// automático falha silenciosamente pra sempre nesse contato (o erro do banco só aparece nos logs do
// servidor, a conversa fica "Não cadastrado"/"Sem corretor" indefinidamente, e o cron de reconciliação
// tenta de novo a cada minuto com o mesmo nome inválido, repetindo a mesma falha pra sempre).
export function sanitizeContactFullName(raw) {
  const trimmed = String(raw ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 160);
  return trimmed.length > 1 ? trimmed : "Cliente WhatsApp";
}

// Metadados gravados em client_origins.source_metadata (lidos pelo trigger no INSERT do cliente).
export function buildSponsoredOriginMetadata(referral, names = {}, extra = {}) {
  const meta = { channel: "whatsapp", entry: "click_to_whatsapp", referral: sanitizeReferral(referral) };
  for (const [key, value] of Object.entries(names || {})) {
    if (value) meta[key] = String(value);
  }
  return { ...meta, ...extra };
}

// Às vezes a Meta entrega a 1ª mensagem do clique no anúncio SEM referral (caso Luana, 2026-10-10: só a
// saudação de contato espontâneo saiu, sem o formulário). Nesses casos o texto pré-preenchido do anúncio
// ainda chega. Só vale como "veio do anúncio" para o GATILHO do fluxo na 1ª mensagem — não grava origem
// patrocinada nem mexe em roleta/atribuição (essas continuam exigindo o referral real).
const AD_PREFILL_TEXTS = [
  "ola vi o anuncio e quero fazer a simulacao do meu financiamento",
  "ola posso ter mais informacoes sobre isso",
  "ola posso saber mais informacoes sobre isto"
];

function normalizePrefill(value) {
  return String(value ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isAdPrefillText(text) {
  const normalized = normalizePrefill(text);
  if (!normalized) return false;
  // "Link:\n\n\nOlá! Posso ter mais informações sobre isso?" (prévia do link colada antes do texto) também conta.
  return AD_PREFILL_TEXTS.some((prefill) => normalized === prefill || normalized.endsWith(` ${prefill}`) && normalized.length - prefill.length <= 12);
}
