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
import { SIMULATION_MODEL_TYPES, getRenderableSimulationModels, simulationModelHasValues, parseSimulationMoney } from "./simulation-models.js";
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

/** Máximo de fotos do imóvel passando no fundo da cena (celular: o resto só pesa na rede). */
export const MAX_PRESENTATION_IMAGES = 12;

/**
 * Fotos do cadastro do empreendimento (`properties.photos_json`) em URLs seguras, na ordem do cadastro e sem repetição.
 * `propertyPhotos` = { [propertyId]: lista bruta de fotos } (string, ou objeto com data/url/src/publicUrl). Foto embutida
 * (data:) nunca sai (peso e segurança): só https:// ou caminho do próprio site.
 */
export function livePropertyImages(propertyPhotos, propertyId) {
  const raw = propertyPhotos && typeof propertyPhotos === "object" ? propertyPhotos[collapse(propertyId)] : null;
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const urls = [];
  for (const photo of raw) {
    const source = typeof photo === "string" ? photo : photo?.data || photo?.url || photo?.src || photo?.publicUrl || "";
    const url = safeImageUrl(source);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= MAX_PRESENTATION_IMAGES) break;
  }
  return urls;
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
  // Roteiro de APROVAÇÃO (PRES-21): carimbo (pausa + impacto), valores aprovados e, se houver imóvel, a foto e os valores dele.
  // Poder de compra com DOIS valores (SAC x Price diferentes): cena mais longa, os dois valores entram um depois do outro.
  return { abertura: 4600, poder: scene.comparison ? 9500 : 5600, formacao: scene.comparison ? 10500 : 7000, parcelas: scene.comparison ? 9500 : 7000, diferenca: 7500, proximo: 8000, validar: 6500, documentos: 8000,
    aprovado: 5600, aprovValores: 9000, imovel: 9500, valores: 13000 }[scene.id] || 6000;
}

/** O campo de subsídio do modelo foi preenchido (número, ou texto não vazio)? Em branco = sem informação. */
function subsidyInformed(model) {
  const value = model?.values?.subsidyValue;
  if (typeof value === "number") return Number.isFinite(value);
  return String(value ?? "").trim() !== "";
}

// Entrada do tipo de imóvel que representa o tipo nas cenas (Price, o padrão; se só houver SAC, o SAC).
function entryOfType(filled, type) {
  return filled.find((model) => model.type === type && model.system !== "sac") || filled.find((model) => model.type === type);
}

/**
 * Comparativo SAC x Price (dono, 2026-10-08): só existe quando a MESMA simulação tem os dois sistemas preenchidos no
 * mesmo tipo de imóvel (o primeiro tipo, na ordem novo → usado, que tiver os dois). Com um sistema só, não há cena.
 * Só números já digitados (nenhum cálculo novo). Devolve { sac, price } ou null.
 */
export function systemComparison(filled) {
  for (const { key } of SIMULATION_MODEL_TYPES) {
    const sac = filled.find((model) => model.type === key && model.system === "sac");
    const price = filled.find((model) => model.type === key && model.system === "price");
    if (sac && price) return { sac: modelNumbers(sac), price: modelNumbers(price) };
  }
  return null;
}

function modelNumbers(model) {
  return {
    financing: model.totals.financing,
    subsidy: model.totals.subsidy,
    total: model.totals.total,
    first: parseSimulationMoney(model.values.firstInstallment),
    last: parseSimulationMoney(model.values.lastInstallment),
    term: Number(model.values.termMonths) || 0
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

  // Comparativo SAC x Price: só com os dois sistemas preenchidos (decisão do servidor).
  const comparison = systemComparison(filled);

  if (numbers.total > 0) {
    // Se SAC e Price liberam poder de compra DIFERENTE (comparado em centavos), a cena mostra os dois valores, um depois do outro.
    const differs = comparison && Math.round(comparison.sac.total * 100) !== Math.round(comparison.price.total * 100);
    scenes.push(differs
      ? { id: "poder", value: numbers.total, comparison: { sac: comparison.sac.total, price: comparison.price.total } }
      : { id: "poder", value: numbers.total });
    // "Como esse valor é formado" SÓ existe quando há subsídio (dono, 2026-10-08): é uma explicação (financiamento + subsídio).
    // Só financiamento (ou só subsídio) apenas repetiria o poder de compra da cena anterior, então não há cena.
    const parts = [numbers.financing > 0 ? "financiamento" : "", numbers.subsidy > 0 ? "subsidio" : ""].filter(Boolean);
    const anySubsidy = comparison && (comparison.sac.subsidy > 0 || comparison.price.subsidy > 0);
    const partsDiffer = comparison && (cents(comparison.sac.financing) !== cents(comparison.price.financing) || cents(comparison.sac.subsidy) !== cents(comparison.price.subsidy));
    const formation = { id: "formacao", mode: parts.length === 2 ? "soma" : parts[0] || "financiamento", financing: numbers.financing, subsidy: numbers.subsidy, total: numbers.total };
    if (anySubsidy && partsDiffer) {
      // SAC e Price com valores diferentes e algum subsídio: a cena mostra a formação dos dois, um depois do outro.
      const pick = (model) => ({ financing: model.financing, subsidy: model.subsidy, total: model.total });
      scenes.push({ ...formation, comparison: { sac: pick(comparison.sac), price: pick(comparison.price) } });
    } else if (parts.length === 2) {
      scenes.push(formation);
    }
  }

  if (numbers.first > 0 || numbers.last > 0) {
    // SAC e Price com parcelas diferentes: a cena mostra primeira e última parcela de CADA sistema, um depois do outro
    // (substitui a antiga cena "comparativo": poder de compra, formação e parcelas já mostram os dois sistemas).
    // Prazo (meses) e taxa de juros também aparecem na cena; o prazo é de cada sistema.
    const parcelasDiffer = comparison && (cents(comparison.sac.first) !== cents(comparison.price.first) || cents(comparison.sac.last) !== cents(comparison.price.last) || comparison.sac.term !== comparison.price.term)
      && (comparison.sac.first > 0 || comparison.sac.last > 0 || comparison.price.first > 0 || comparison.price.last > 0);
    const scene = { id: "parcelas", first: numbers.first, last: numbers.last, term: numbers.term, interestRate };
    const pickParcelas = (model) => ({ first: model.first, last: model.last, term: model.term });
    if (parcelasDiffer) scene.comparison = { sac: pickParcelas(comparison.sac), price: pickParcelas(comparison.price) };
    scenes.push(scene);
  }

  // A ÚNICA diferença entre imóvel novo e usado que a apresentação mostra é o subsídio (comparado em centavos, como o
  // PDF). Subsídio igual (inclusive os dois zerados) ou só um modelo preenchido: sem cena e sem as palavras novo/usado.
  const novo = entryOfType(filled, "novo");
  const usado = entryOfType(filled, "usado");
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
export function buildPropertyBranch({ simulation = {}, defaultReason = "", entryResults = {}, propertyPhotos = {} } = {}) {
  const properties = (simulation.properties || []).filter((item) => collapse(item?.customName));
  const fallback = clip(defaultReason, 320);
  return properties.map((property, index) => {
    // Fotos ATUAIS do cadastro do empreendimento (lidas na hora de abrir o link, então o link já enviado acompanha as edições
    // do cadastro). Sem fotos no cadastro (ou falha na leitura), vale a foto gravada na simulação, como antes.
    const images = livePropertyImages(propertyPhotos, property.propertyId);
    const scene = {
      id: "imovel",
      name: clip(property.customName, 90),
      imageUrl: images[0] || safeImageUrl(property.imageUrl),
      images,
      benefits: (property.benefits || []).map((benefit) => clip(benefit?.text, 90)).filter(Boolean).slice(0, MAX_BENEFITS),
      reason: clip(property.recommendationReason, 320) || fallback,
      position: index + 1,
      count: properties.length
    };
    // Condições financeiras DESTE imóvel (PRES-20): cena extra logo depois da cena do imóvel. Só existe com dado real.
    const entry = entryResults && typeof entryResults === "object" ? entryResults[collapse(property?.propertyId)] : null;
    const valores = buildPropertyValues({ entry });
    return valores ? { ...scene, valores } : scene;
  });
}

const MAX_INSTALLMENT_BLOCKS = 3;

function positiveMoney(value) {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Valores do imóvel sugerido (cena "valores", PRES-20). Fonte ÚNICA: o resultado do motor de entrada que a tela do card do
 * cliente → Empreendimento ("Apresentação de valores do empreendimento") e o PDF "Proposta de Valores" mostram — o servidor
 * roda o MESMO motor, sobre a simulação ATUAL e as regras cadastradas do empreendimento (`lib/simulation-presentation-entry.js`),
 * e entrega aqui `entry = { result, features }` (resultado do motor + diferenciais do cadastro do empreendimento). Nenhum
 * cálculo financeiro novo aqui, só leitura e allowlist. Como o resultado é calculado na hora, nunca há número velho.
 * Devolve null (sem cena) quando: o imóvel não tem resultado (sem regras de entrada cadastradas) ou não há valor do imóvel.
 * Resultado "inviável" pela regra (ex.: entrada acima do limite parcelável num empreendimento sem ato) TAMBÉM vira cena, com
 * o ato que o motor calculou (decisão do dono 2026-10-06: o cliente vê o valor à vista necessário). Campo ausente/zero não aplicável é omitido. ATO: `ato` só existe quando o motor INFORMOU
 * o número (0 = sem ato, destacado pela tela; ausente = não informado, nunca vira "sem ato"); só faz sentido com entrada a pagar.
 * O `clienteSnapshot` (renda etc.) do resultado NUNCA é copiado.
 */
export function buildPropertyValues({ entry = null } = {}) {
  const snap = entry && typeof entry === "object" && entry.result && typeof entry.result === "object" ? entry.result : null;
  if (!snap) return null;

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
  // só quando o cadastro do empreendimento traz o benefício). Os diferenciais do cadastro entram como `propertyFeatures`,
  // exatamente como a tela do card (`selected.features`) e o PDF (`property.features`).
  const features = Array.isArray(entry.features) ? entry.features : [];
  const docs = buildPresentationModel(snap, { propertyFeatures: features }).documentacaoGratuita;
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

/**
 * Apresentação de CRÉDITO APROVADO (PRES-21, chave manual no CRM; independente da etapa do funil). Mesmo link, outro roteiro:
 * pausa curta + carimbo "CRÉDITO APROVADO" · valores do financiamento (financiamento, subsídio se houver, parcela e taxa de
 * juros) · e, SÓ quando a simulação tem imóvel definido, a cena do imóvel e a dos valores dele (mesmo motor do card, PRES-20).
 * Sem "Próximo passo", sem lista de documentos, sem botão de contato (decisão do dono). Os números são os ATUAIS da simulação:
 * o corretor os corrige para os da aprovação. Mesma allowlist das cenas da simulação; nada de renda/CPF/ids.
 */
export function buildApprovalPresentation(input = {}) {
  const simulation = input.simulation || {};
  const filled = getRenderableSimulationModels(simulation).filter((model) => simulationModelHasValues(model.values));
  if (!filled.length) return null;
  const numbers = modelNumbers(filled[0]);
  const scenes = [{ id: "aprovado", firstName: firstNameOf(simulation.clientName) }];
  const values = { id: "aprovValores", financing: numbers.financing, subsidy: numbers.subsidy, first: numbers.first, last: numbers.last, interestRate: readStoredInterestRate(simulation.interestRateAnnual) };
  if (values.financing > 0 || values.subsidy > 0 || values.first > 0) scenes.push(values);
  for (const item of buildPropertyBranch(input)) {
    const { valores, ...property } = item;
    scenes.push(property);
    if (valores) scenes.push({ ...valores, id: "valores", name: property.name, position: property.position, count: property.count });
  }
  return { version: 2, mode: "aprovacao", scenes: scenes.map((scene) => ({ ...scene, durationMs: sceneDurationMs(scene) })), branch: [] };
}

/** Campos do DTO de aprovação e das cenas exclusivas dele (os testes provam que nada fora disto sai). */
export const APPROVAL_DTO_FIELDS = ["version", "mode", "scenes", "branch"];
export const APPROVAL_SCENE_FIELDS = {
  aprovado: ["id", "firstName", "durationMs"],
  aprovValores: ["id", "financing", "subsidy", "first", "last", "interestRate", "durationMs"]
};

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
  poder: ["id", "value", "comparison", "durationMs"],
  formacao: ["id", "mode", "financing", "subsidy", "total", "comparison", "durationMs"],
  parcelas: ["id", "first", "last", "term", "interestRate", "comparison", "durationMs"],
  diferenca: ["id", "novo", "usado", "difference", "scenario", "durationMs"],
  proximo: ["id", "firstName", "dateLabel", "durationMs"],
  validar: ["id", "firstName", "durationMs"],
  documentos: ["id", "items", "durationMs"]
};

/** Campos permitidos nas cenas do ramo de imóveis (`dto.branch`). */
export const PUBLIC_BRANCH_FIELDS = ["id", "name", "imageUrl", "images", "benefits", "reason", "position", "count", "valores"];

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
