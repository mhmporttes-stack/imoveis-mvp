// Apresentação interativa da simulação — regras PURAS (token, DTO público em allowlist, decisão de cenas).
//
// REGRAS (docs/BUSINESS_RULES.md PRES-1..PRES-14):
//  - O PDF da simulação NÃO é tocado. A apresentação lê a MESMA fonte do PDF
//    (`getRenderableSimulationModels` de lib/simulation-models.js; é o que SimulationGenerator usa para montar as páginas),
//    portanto os números são idênticos. Nenhum cálculo financeiro novo: só a soma já existente (`totals`) e leitura.
//  - O DTO é PÚBLICO (link sem login): é uma ALLOWLIST construída campo a campo. Nada de CPF, telefone/e-mail do
//    cliente, renda, nascimento, endereço, observações, notas internas, regras/descontos do empreendimento, ids internos,
//    status do funil, comissão. Só o primeiro nome do cliente.
import { randomBytes } from "node:crypto";
import { getRenderableSimulationModels, simulationModelHasValues, parseSimulationMoney } from "./simulation-models.js";
import { formatDateBR } from "./simulation-presentation-format.mjs";
import { readStoredInterestRate } from "./interest-rate.mjs";
export { PRESENTATION_GATED_SCENES } from "./simulation-presentation-gate.mjs";

// ---------- token ----------
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const PRESENTATION_TOKEN_LENGTH = 24; // 62^24 ≈ 2^143 (>= 128 bits)

/**
 * Gera o token público (24 caracteres base62, crypto.randomBytes, sem viés: descarta bytes >= 248).
 * Exige letra MAIÚSCULA + minúscula + dígito: assim nunca coincide com um ref curto de corretor (/s/{ref},
 * sempre minúsculo — lib/short-links.mjs) e o proxy distingue os dois só pelo formato.
 */
export function generatePresentationToken(randomBytesFn = randomBytes) {
  for (;;) {
    let token = "";
    while (token.length < PRESENTATION_TOKEN_LENGTH) {
      for (const byte of randomBytesFn(48)) {
        if (byte >= 248) continue; // 248 = 62 * 4 → módulo sem viés
        token += BASE62[byte % 62];
        if (token.length === PRESENTATION_TOKEN_LENGTH) break;
      }
    }
    if (isPresentationToken(token)) return token;
  }
}

export function isPresentationToken(value) {
  const text = String(value ?? "");
  return text.length === PRESENTATION_TOKEN_LENGTH && /^[A-Za-z0-9]+$/.test(text) && /[A-Z]/.test(text) && /[a-z]/.test(text) && /[0-9]/.test(text);
}

// ---------- helpers ----------
const MAX_BENEFITS = 6;
const PLACEHOLDER_IMAGES = new Set(["/assets/hero-marilia.png"]);

export function firstNameOf(fullName) {
  const first = String(fullName || "").replace(/\s+/g, " ").trim().split(" ")[0] || "";
  return first.slice(0, 40);
}

function collapse(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function clip(text, max) {
  const value = collapse(text);
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function cents(value) {
  return Math.round(parseSimulationMoney(value) * 100);
}

/** Só https:// ou caminho do próprio site; nunca data: URI, javascript: ou a imagem-padrão do site. */
export function safeImageUrl(value) {
  const url = String(value ?? "").trim();
  if (!url || url.length > 800 || PLACEHOLDER_IMAGES.has(url)) return "";
  if (/^https:\/\//i.test(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return "";
}

/** Tempo de cada cena (ms): base + leitura proporcional ao texto, para o auto-avanço nunca atropelar a leitura. */
export function sceneDurationMs(scene) {
  const base = { abertura: 4600, poder: 5600, formacao: 7000, parcelas: 7000, diferenca: 7500, imovel: 7000, porque: 4500, proximo: 8000, validar: 6500, documentos: 8000 }[scene.id] || 6000;
  let chars = 0;
  if (scene.id === "porque") chars = String(scene.reason || "").length;
  if (scene.id === "imovel") chars = (scene.benefits || []).join(" ").length;
  return base + Math.min(chars * 45, 9000);
}

function modelNumbers(model) {
  return {
    financing: model.totals.financing,
    subsidy: model.totals.subsidy,
    total: model.totals.total,
    first: parseSimulationMoney(model.values.firstInstallment),
    last: parseSimulationMoney(model.values.lastInstallment)
  };
}

/**
 * Cenas a partir dos dados REAIS da simulação. Devolve null quando a simulação ainda não tem valores
 * (nada a apresentar).
 *
 * Ordem (adaptativa): abertura · poder de compra · formação do valor · condição de pagamento (parcelas + taxa de juros
 * anual, se houver) · diferença de subsídio entre imóvel novo e usado (SÓ se os subsídios forem diferentes) · imóvel
 * sugerido · por que este imóvel · próximo passo · "esse é o próximo passo!" · documentos.
 *
 * Os números das cenas 2 a 4 são os do modelo principal do PDF (o primeiro preenchido). Sem diferença de subsídio a
 * apresentação é NEUTRA: nenhuma palavra "novo"/"usado" aparece.
 *
 * @param {object} input
 * @param {object} input.simulation  simulação como devolvida por `getSimulation` (camelCase)
 * @param {string} [input.defaultReason]  texto-padrão de "por que este imóvel" (DEFAULT_RECOMMENDATION_REASON), que NÃO é justificativa real
 */
export function buildPresentationScenes({ simulation = {}, defaultReason = "" } = {}) {
  const filled = getRenderableSimulationModels(simulation).filter((model) => simulationModelHasValues(model.values));
  if (!filled.length) return null;

  const primary = filled[0];
  const numbers = modelNumbers(primary);
  const firstName = firstNameOf(simulation.clientName);
  const interestRate = readStoredInterestRate(simulation.interestRateAnnual);
  const scenes = [];

  scenes.push({ id: "abertura", firstName });

  if (numbers.total > 0) {
    scenes.push({ id: "poder", value: numbers.total });
    const parts = [numbers.financing > 0 ? "financiamento" : "", numbers.subsidy > 0 ? "subsidio" : ""].filter(Boolean);
    scenes.push({
      id: "formacao",
      // soma: financiamento + subsídio; financiamento/subsidio: um só componente (sem destacar zero)
      mode: parts.length === 2 ? "soma" : parts[0] || "financiamento",
      financing: numbers.financing,
      subsidy: numbers.subsidy,
      total: numbers.total
    });
  }

  if (numbers.first > 0 || numbers.last > 0) {
    scenes.push({ id: "parcelas", first: numbers.first, last: numbers.last, interestRate });
  }

  // A ÚNICA diferença entre imóvel novo e usado que a apresentação mostra é o subsídio (comparado em centavos, como o
  // PDF). Subsídio igual (inclusive os dois zerados) ou só um modelo preenchido: sem cena e sem as palavras novo/usado.
  const novo = filled.find((model) => model.type === "novo");
  const usado = filled.find((model) => model.type === "usado");
  if (novo && usado && cents(novo.totals.subsidy) !== cents(usado.totals.subsidy)) {
    scenes.push({
      id: "diferenca",
      novo: novo.totals.subsidy,
      usado: usado.totals.subsidy,
      difference: Math.abs(cents(novo.totals.subsidy) - cents(usado.totals.subsidy)) / 100,
      scenario: primary.type === "usado" ? "usado" : "novo"
    });
  }

  const property = (simulation.properties || []).find((item) => collapse(item?.customName));
  if (property) {
    const benefits = (property.benefits || []).map((benefit) => clip(benefit?.text, 90)).filter(Boolean).slice(0, MAX_BENEFITS);
    scenes.push({ id: "imovel", name: clip(property.customName, 90), imageUrl: safeImageUrl(property.imageUrl), benefits });

    const reason = collapse(property.recommendationReason);
    // Justificativa REAL cadastrada para o imóvel (campo "Por que este imóvel?" do gerador). O texto-padrão que o
    // sistema grava quando o corretor não escreve nada não é justificativa real → sem cena.
    if (reason && reason !== collapse(defaultReason)) scenes.push({ id: "porque", reason: clip(reason, 320) });
  }

  scenes.push({
    id: "proximo",
    firstName,
    dateLabel: formatDateBR(simulation.simulationDate || simulation.updatedAt || simulation.createdAt)
  });
  // Só acessíveis depois do botão VALIDAR SIMULAÇÃO (o player trava o avanço automático na cena "proximo").
  // Nenhuma mensagem é enviada nem dado gravado: é um avanço dentro da apresentação.
  scenes.push({ id: "validar", firstName });
  scenes.push({ id: "documentos" });

  return scenes.map((scene) => ({ ...scene, durationMs: sceneDurationMs(scene) }));
}

/** DTO PÚBLICO (allowlist). Nada além disto sai do servidor. */
export function buildPublicPresentation(input) {
  const scenes = buildPresentationScenes(input);
  if (!scenes) return null;
  return { version: 1, scenes };
}

/** Campos permitidos por cena (os testes provam que nada fora disto sai). */
export const PUBLIC_SCENE_FIELDS = {
  abertura: ["id", "firstName", "durationMs"],
  poder: ["id", "value", "durationMs"],
  formacao: ["id", "mode", "financing", "subsidy", "total", "durationMs"],
  parcelas: ["id", "first", "last", "interestRate", "durationMs"],
  diferenca: ["id", "novo", "usado", "difference", "scenario", "durationMs"],
  imovel: ["id", "name", "imageUrl", "benefits", "durationMs"],
  porque: ["id", "reason", "durationMs"],
  proximo: ["id", "firstName", "dateLabel", "durationMs"],
  validar: ["id", "firstName", "durationMs"],
  documentos: ["id", "durationMs"]
};

// ---------- evento (endpoint público) ----------
export const EVENT_TYPES = ["abriu", "cena", "concluiu"];
const EVENT_KEYS = new Set(["tipo", "cena", "nova"]);
const BOT_PATTERN = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|headless|lighthouse|curl|wget|python-requests|monitor|uptime/i;

/** Bot óbvio (ou sem user-agent): o evento é descartado sem erro. O user-agent nunca é gravado. */
export function isLikelyBot(userAgent = "") {
  const ua = String(userAgent || "");
  return !ua || BOT_PATTERN.test(ua);
}

/** Valida o corpo do POST de evento. Allowlist estrita: chave desconhecida ou tipo fora da lista → null. */
export function parsePresentationEvent(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (Object.keys(body).some((key) => !EVENT_KEYS.has(key))) return null;
  if (!EVENT_TYPES.includes(body.tipo)) return null;
  let cena = null;
  if (body.cena !== undefined && body.cena !== null) {
    if (!Number.isInteger(body.cena) || body.cena < 1 || body.cena > 32) return null;
    cena = body.cena;
  }
  if (body.tipo !== "abriu" && cena === null) return null;
  if (body.nova !== undefined && typeof body.nova !== "boolean") return null;
  return { tipo: body.tipo, cena, nova: body.tipo === "abriu" && body.nova === true };
}

/** Limite de taxa simples (janela deslizante em memória, por chave; sem IP). `allow(key)` → true se pode seguir. */
export function createRateLimiter({ limit = 60, windowMs = 60_000, maxKeys = 2000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return function allow(key) {
    const t = now();
    const recent = (hits.get(key) || []).filter((time) => t - time < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(t);
    hits.delete(key);
    hits.set(key, recent);
    if (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return true;
  };
}

// ---------- tolerância à migration ausente ----------
/** Tabela/função da apresentação ainda inexistente (migration 20261005120000 não aplicada). */
export function isPresentationSchemaMissing(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "").toLowerCase();
  if (["42P01", "42883", "PGRST205", "PGRST202"].includes(code)) return true;
  return message.includes("simulation_presentation") && (message.includes("does not exist") || message.includes("schema cache"));
}
