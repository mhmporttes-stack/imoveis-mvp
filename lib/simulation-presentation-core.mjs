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
import { buildDocumentItemsFor } from "./simulation-presentation-documents.mjs";
import { buildPresentationModel } from "./simulacao-entrada/presentation-model.mjs";
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
  // As cenas do ramo de imóveis não têm relógio: quem avança é o cliente (botão, toque ou deslize).
  return { abertura: 4600, poder: 5600, formacao: 7000, parcelas: 7000, diferenca: 7500, proximo: 8000, validar: 6500, documentos: 8000 }[scene.id] || 6000;
}

/** O campo de subsídio do modelo foi preenchido (número, ou texto não vazio)? Em branco = sem informação. */
function subsidyInformed(model) {
  const value = model?.values?.subsidyValue;
  if (typeof value === "number") return Number.isFinite(value);
  return String(value ?? "").trim() !== "";
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
 * Roteiro principal (adaptativo): abertura · poder de compra · formação do valor · condição de pagamento (parcelas + taxa
 * de juros anual, se houver) · diferença de subsídio entre imóvel novo e usado (SÓ se os subsídios forem diferentes) ·
 * PRÓXIMO PASSO (o auto-avanço PARA aqui) · "esse é o próximo passo!" · documentos (lista final já personalizada).
 * Os imóveis sugeridos NÃO fazem parte do roteiro: vivem no ramo opcional (`buildPropertyBranch`).
 *
 * Os números das cenas 2 a 4 são os do modelo principal do PDF (o primeiro preenchido). Sem diferença de subsídio a
 * apresentação é NEUTRA: nenhuma palavra "novo"/"usado" aparece.
 *
 * @param {object} input
 * @param {object} input.simulation  simulação como devolvida por `getSimulation` (camelCase)
 */
export function buildPresentationScenes({ simulation = {} } = {}) {
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
  // Os DOIS modelos precisam ter o subsídio INFORMADO. O gerador copia financiamento e parcelas de um modelo para o outro
  // (SYNCED_MODEL_FIELDS), então uma simulação de um modelo só fica com o outro "preenchido" e o subsídio em branco: esse
  // branco NÃO é "R$ 0,00" e não pode virar uma diferença inventada. Zero digitado (0 / 0,00) conta como informado.
  if (novo && usado && subsidyInformed(novo) && subsidyInformed(usado) && cents(novo.totals.subsidy) !== cents(usado.totals.subsidy)) {
    scenes.push({
      id: "diferenca",
      novo: novo.totals.subsidy,
      usado: usado.totals.subsidy,
      difference: Math.abs(cents(novo.totals.subsidy) - cents(usado.totals.subsidy)) / 100,
      scenario: primary.type === "usado" ? "usado" : "novo"
    });
  }

  scenes.push({
    id: "proximo",
    firstName,
    dateLabel: formatDateBR(simulation.simulationDate || simulation.updatedAt || simulation.createdAt)
  });
  // Só acessíveis depois do botão VALIDAR SIMULAÇÃO (o player trava o avanço automático na cena "proximo").
  // Nenhuma mensagem é enviada nem dado gravado: é um avanço dentro da apresentação.
  scenes.push({ id: "validar", firstName });
  // Lista FINAL de documentos, resolvida aqui no servidor a partir do cadastro (ver simulation-presentation-documents.mjs).
  // Só texto sai daqui: o valor cru do cadastro (renda, estado civil, filhos) nunca entra na cena.
  scenes.push({ id: "documentos", items: buildDocumentItemsFor(simulation.registration) });

  return scenes.map((scene) => ({ ...scene, durationMs: sceneDurationMs(scene) }));
}

/**
 * RAMO OPCIONAL de imóveis sugeridos: uma cena por imóvel (todos, na ordem do cadastro), aberta pelo botão
 * IMÓVEL SUGERIDO / IMÓVEIS SUGERIDOS da cena "Próximo passo". Fora do roteiro principal (não entra em `scenes`).
 * Justificativa: a REAL cadastrada em "Por que este imóvel?" ou, quando o corretor não escreveu, o texto-padrão do dono
 * (`defaultReason` = DEFAULT_RECOMMENDATION_REASON do gerador/PDF; o mapper já o grava no lugar do vazio).
 */
export function buildPropertyBranch({ simulation = {}, defaultReason = "" } = {}) {
  const properties = (simulation.properties || []).filter((item) => collapse(item?.customName));
  const fallback = clip(defaultReason, 320);
  const primary = getRenderableSimulationModels(simulation).find((model) => simulationModelHasValues(model.values));
  return properties.map((property, index) => {
    const scene = {
      id: "imovel",
      name: clip(property.customName, 90),
      imageUrl: safeImageUrl(property.imageUrl),
      benefits: (property.benefits || []).map((benefit) => clip(benefit?.text, 90)).filter(Boolean).slice(0, MAX_BENEFITS),
      reason: clip(property.recommendationReason, 320) || fallback,
      position: index + 1,
      count: properties.length
    };
    // Condições financeiras DESTE imóvel (PRES-20): cena extra logo depois da cena do imóvel. Só existe com dado real.
    const valores = buildPropertyValues({ simulation, property, primary });
    return valores ? { ...scene, valores } : scene;
  });
}

const MAX_INSTALLMENT_BLOCKS = 3;

function positiveMoney(value) {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Valores do imóvel sugerido (cena "valores", PRES-20). Fonte ÚNICA: o resultado do motor de entrada que o Gerador já
 * calculou e SALVOU na simulação (`entry_simulation_snapshots`, o mesmo resultado da tela "Apresentação de valores do
 * empreendimento" e do PDF "Proposta de Valores") — nenhum cálculo financeiro novo aqui, só leitura e allowlist.
 * Devolve null (sem cena) quando: o imóvel não tem resultado salvo; o resultado é de OUTROS valores de financiamento/subsídio/FGTS
 * (simulação alterada depois do último "Salvar": nunca mostrar número velho); o motor o classificou como inviável; ou não há
 * valor do imóvel. Campo ausente/zero não aplicável é omitido. ATO: `ato` só existe quando o motor INFORMOU o número
 * (0 = sem ato, destacado pela tela; ausente = não informado, nunca vira "sem ato"); só faz sentido com entrada a pagar.
 * O `clienteSnapshot` (renda etc.) do resultado salvo NUNCA é copiado.
 */
export function buildPropertyValues({ simulation = {}, property = {}, primary = null } = {}) {
  const propertyId = collapse(property?.propertyId);
  if (!propertyId || !primary) return null;
  const snap = (Array.isArray(simulation.entrySimulationSnapshots) ? simulation.entrySimulationSnapshots : [])
    .find((item) => item && typeof item === "object" && item.empreendimentoId === propertyId);
  if (!snap) return null;

  // O resultado precisa ser dos MESMOS valores da simulação atual (mesmas entradas que o Gerador mandou ao motor).
  const client = snap.clienteSnapshot && typeof snap.clienteSnapshot === "object" ? snap.clienteSnapshot : null;
  if (cents(snap.financiamentoAprovado) !== cents(primary.totals.financing)) return null;
  if (cents(snap.subsidioMcmv) !== cents(primary.totals.subsidy)) return null;
  if (client && cents(client.fgtsDisponivel) !== cents(primary.totals.downPayment + primary.totals.fgts)) return null;
  if (snap.classificacao === "inviavel") return null;

  const valorImovel = positiveMoney(snap.valorImovel);
  if (!valorImovel) return null;

  const valores = { valorImovel };
  const financiamento = positiveMoney(snap.financiamentoAprovado);
  if (financiamento) valores.financiamento = financiamento;
  const desconto = positiveMoney(snap.totalDescontos);
  if (desconto) valores.desconto = desconto;
  const casaPaulista = positiveMoney(snap.casaPaulista);
  if (casaPaulista) valores.casaPaulista = casaPaulista;
  // Subsídio MCMV: só quando INFORMADO (> 0; em branco/zero não é benefício). O snapshot já foi conferido com o da simulação acima.
  const subsidio = positiveMoney(snap.subsidioMcmv);
  if (subsidio) valores.subsidio = subsidio;
  // Documentação gratuita: MESMA conta e MESMA regra da tela/PDF "Proposta de Valores" (presentation-model.mjs: 5% do valor do imóvel,
  // só quando o empreendimento/imóvel traz o benefício). Os diferenciais do imóvel na simulação entram como `propertyFeatures`.
  const docs = buildPresentationModel(snap, { propertyFeatures: (property.benefits || []).map((benefit) => benefit?.text).filter(Boolean) }).documentacaoGratuita;
  const documentacaoGratuita = docs.aplica ? positiveMoney(docs.valor) : 0;
  if (documentacaoGratuita) valores.documentacaoGratuita = documentacaoGratuita;
  // Total de descontos = só as linhas mostradas (desconto + Casa Paulista + subsídio + documentação), em centavos para não acumular erro.
  const totalDescontos = Math.round((desconto + casaPaulista + subsidio + documentacaoGratuita) * 100) / 100;
  if (totalDescontos) valores.totalDescontos = totalDescontos;

  const entradaTotal = positiveMoney(snap.entradaTotal);
  if (entradaTotal) {
    valores.entradaTotal = entradaTotal;
    const detalhe = snap.detalhePagamento && typeof snap.detalhePagamento === "object" ? snap.detalhePagamento : {};
    if (typeof detalhe.ato === "number" && Number.isFinite(detalhe.ato) && detalhe.ato >= 0) valores.ato = detalhe.ato;
    const parcelas = (Array.isArray(detalhe.blocos) ? detalhe.blocos : [])
      .map((bloco) => ({
        label: clip(bloco?.label, 40),
        quantidade: Number.isInteger(bloco?.parcelas) ? bloco.parcelas : 0,
        // mesmo valor da tela de valores do empreendimento: com juros quando o bloco os tem
        valor: positiveMoney(bloco?.valorParcelaComJuros) || positiveMoney(bloco?.valorParcela)
      }))
      .filter((bloco) => bloco.quantidade > 0 && bloco.valor > 0)
      .slice(0, MAX_INSTALLMENT_BLOCKS);
    if (parcelas.length) valores.parcelas = parcelas;
  }
  return valores;
}

/** DTO PÚBLICO (allowlist). Nada além disto sai do servidor. */
export function buildPublicPresentation(input) {
  const scenes = buildPresentationScenes(input);
  if (!scenes) return null;
  return { version: 2, scenes, branch: buildPropertyBranch(input) };
}

/**
 * Round 4: o DTO ganha UM booleano, `podeReceberLista` (há responsável ativo com WhatsApp válido?). Nunca o telefone nem o
 * link do corretor: o wa.me só sai na resposta do POST de confirmação (PRES-17, exceção a PRES-9).
 */
export function withReceiveListFlag(dto, canReceive) {
  return dto ? { ...dto, podeReceberLista: canReceive === true } : dto;
}

/** Campos permitidos no topo do DTO (os testes provam que nada fora disto sai). */
export const PUBLIC_DTO_FIELDS = ["version", "scenes", "branch", "podeReceberLista"];

/** Campos permitidos por cena (os testes provam que nada fora disto sai). */
export const PUBLIC_SCENE_FIELDS = {
  abertura: ["id", "firstName", "durationMs"],
  poder: ["id", "value", "durationMs"],
  formacao: ["id", "mode", "financing", "subsidy", "total", "durationMs"],
  parcelas: ["id", "first", "last", "interestRate", "durationMs"],
  diferenca: ["id", "novo", "usado", "difference", "scenario", "durationMs"],
  proximo: ["id", "firstName", "dateLabel", "durationMs"],
  validar: ["id", "firstName", "durationMs"],
  documentos: ["id", "items", "durationMs"]
};

/** Campos permitidos nas cenas do ramo de imóveis (`dto.branch`). */
export const PUBLIC_BRANCH_FIELDS = ["id", "name", "imageUrl", "benefits", "reason", "position", "count", "valores"];

/** Campos permitidos na cena de valores do imóvel (`dto.branch[].valores`, PRES-20) e em cada bloco de parcelas. */
export const PUBLIC_VALUES_FIELDS = ["valorImovel", "financiamento", "desconto", "casaPaulista", "subsidio", "documentacaoGratuita", "totalDescontos", "entradaTotal", "ato", "parcelas"];
export const PUBLIC_VALUES_INSTALLMENT_FIELDS = ["label", "quantidade", "valor"];

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
