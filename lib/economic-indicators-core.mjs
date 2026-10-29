// Indicadores Econômicos (pedido do dono, 2026-10-29 — docs/BUSINESS_RULES.md ECON-1). Regras PURAS (sem rede, sem banco):
// catálogo de séries oficiais, leitura das respostas do BCB (SGS e Olinda/taxaJuros) e do IBGE (SIDRA), acumulados,
// correção monetária, frescor da série, "O que mudou na economia?" e o texto dos alertas. Testes: tests/economic-indicators.test.mjs
// (com respostas reais gravadas em tests/fixtures/economic/). Nunca inventa número: sem dado = null + aviso.

// Códigos CONFIRMADOS por requisição real em 2026-10-29 (IPCA/INPC/IPCA-15 do SGS conferidos contra o SIDRA do IBGE, mesmo
// valor no mesmo mês). INCC, INCC-M e IGP-M são da FGV, republicados pelo BCB no SGS (a FGV não tem API pública aberta):
// o código respondeu, mas a conferência automática contra a própria FGV não é possível — a tela declara isso.
export const ECON_INDICATORS = Object.freeze([
  { code: "ipca", name: "IPCA", category: "inflation", source: "bcb_sgs", sourceRef: "433", sourceLabel: "IBGE (via BCB SGS 433)", unit: "%", kind: "monthly_rate", frequency: "monthly", correction: true, alert: true, relevantDelta: 0.25, description: "Inflação oficial do país (IBGE)." },
  { code: "ipca15", name: "IPCA-15", category: "inflation", source: "bcb_sgs", sourceRef: "7478", sourceLabel: "IBGE (via BCB SGS 7478)", unit: "%", kind: "monthly_rate", frequency: "monthly", correction: false, alert: true, relevantDelta: 0.25, description: "Prévia do IPCA, coletada até o meio do mês (IBGE)." },
  { code: "inpc", name: "INPC", category: "inflation", source: "bcb_sgs", sourceRef: "188", sourceLabel: "IBGE (via BCB SGS 188)", unit: "%", kind: "monthly_rate", frequency: "monthly", correction: true, alert: true, relevantDelta: 0.25, description: "Inflação para famílias de 1 a 5 salários mínimos (IBGE)." },
  { code: "incc", name: "INCC-DI", category: "inflation", source: "bcb_sgs", sourceRef: "192", sourceLabel: "FGV (republicado pelo BCB SGS 192)", unit: "%", kind: "monthly_rate", frequency: "monthly", correction: true, alert: true, relevantDelta: 0.25, description: "Custo da construção civil (FGV)." },
  { code: "inccm", name: "INCC-M", category: "inflation", source: "bcb_sgs", sourceRef: "7456", sourceLabel: "FGV (republicado pelo BCB SGS 7456)", unit: "%", kind: "monthly_rate", frequency: "monthly", correction: true, alert: true, relevantDelta: 0.25, description: "Custo da construção civil, versão de mercado (FGV)." },
  { code: "igpm", name: "IGP-M", category: "inflation", source: "bcb_sgs", sourceRef: "189", sourceLabel: "FGV (republicado pelo BCB SGS 189)", unit: "%", kind: "monthly_rate", frequency: "monthly", correction: true, alert: true, relevantDelta: 0.5, description: "Índice geral de preços, usado em muitos aluguéis (FGV)." },
  { code: "selic", name: "Selic (meta)", category: "interest", source: "bcb_sgs", sourceRef: "432", sourceLabel: "BCB (SGS 432)", unit: "% a.a.", kind: "level", frequency: "daily", correction: false, alert: true, alertOnChangeOnly: true, relevantDelta: 0.01, description: "Taxa básica de juros definida pelo Copom." },
  { code: "cdi", name: "CDI", category: "interest", source: "bcb_sgs", sourceRef: "4389", sourceLabel: "BCB (SGS 4389)", unit: "% a.a.", kind: "level", frequency: "daily", correction: false, alert: false, relevantDelta: 0.1, description: "Taxa dos depósitos interbancários, anualizada (base 252)." },
  { code: "tr", name: "TR", category: "interest", source: "bcb_sgs", sourceRef: "7811", sourceLabel: "BCB (SGS 7811)", unit: "%", kind: "monthly_rate", frequency: "monthly", correction: false, alert: true, relevantDelta: 0.05, description: "Taxa Referencial do mês, usada na correção do saldo de financiamentos e do FGTS." },
  { code: "desemprego", name: "Desemprego", category: "economy", source: "ibge_sidra", sourceRef: "t/6381/n1/all/v/4099", sourceLabel: "IBGE PNAD Contínua (SIDRA 6381)", unit: "%", kind: "level", frequency: "moving_quarter", correction: false, alert: true, relevantDelta: 0.3, description: "Taxa de desocupação (trimestre móvel)." },
  { code: "renda", name: "Renda média real", category: "economy", source: "ibge_sidra", sourceRef: "t/6390/n1/all/v/5933", sourceLabel: "IBGE PNAD Contínua (SIDRA 6390)", unit: "R$", kind: "level", frequency: "moving_quarter", correction: false, alert: false, relevantPct: 2, description: "Rendimento médio real habitual do trabalho (trimestre móvel)." },
  { code: "pib", name: "PIB", category: "economy", source: "ibge_sidra", sourceRef: "t/5932/n1/all/v/6564", sidraClassification: "c11255/90707", sourceLabel: "IBGE Contas Trimestrais (SIDRA 5932)", unit: "%", kind: "level", frequency: "quarterly", correction: false, alert: true, relevantDelta: 0.5, description: "Variação do PIB contra o trimestre imediatamente anterior (com ajuste sazonal)." }
]);

export const BANK_RATES_CODE = "bank_rates";
export const BANK_RATES_SOURCE = "BCB — Taxas de juros por instituição (Olinda, TaxasJurosMensalPorMes)";
export const ECON_CATEGORIES = Object.freeze({ inflation: "Inflação e construção", interest: "Juros e crédito", economy: "Atividade, emprego e renda" });
export const CORRECTION_CODES = Object.freeze(ECON_INDICATORS.filter((item) => item.correction).map((item) => item.code));
export const HISTORY_START = "2019-01-01"; // backfill da 1ª coleta: 5+ anos

export function indicatorByCode(code) {
  return ECON_INDICATORS.find((item) => item.code === code) || null;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const pad = (n) => String(n).padStart(2, "0");

export function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || /^[.\-x…]+$/i.test(text)) return null; // SIDRA usa "-", "..", "x" para sem dado
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// ---------- Leitura das respostas oficiais ----------

// BCB SGS: [{ data: "dd/MM/yyyy", valor: "0.82" }] -> [{ reference_date: "yyyy-MM-dd", value }]
export function parseSgs(payload) {
  if (!Array.isArray(payload)) throw new Error("Resposta do SGS fora do formato esperado.");
  const rows = [];
  for (const item of payload) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(item?.data || ""));
    const value = parseNumber(item?.valor);
    if (!match || value === null) continue;
    rows.push({ reference_date: `${match[3]}-${match[2]}-${match[1]}`, value });
  }
  return sortAndDedupe(rows);
}

// IBGE SIDRA: 1ª linha = cabeçalho. D3C = período (AAAAMM para mês/trimestre móvel; AAAA0T para trimestre).
// Trimestre móvel e trimestre viram o ÚLTIMO mês do período (ex.: mai-jun-jul 2026 -> 2026-07-01; 2º tri -> 2026-06-01).
export function parseSidra(payload, frequency) {
  if (!Array.isArray(payload) || payload.length < 1) throw new Error("Resposta do SIDRA fora do formato esperado.");
  const rows = [];
  for (const item of payload.slice(1)) {
    const code = String(item?.D3C || "");
    const value = parseNumber(item?.V);
    if (!/^\d{6}$/.test(code) || value === null) continue;
    const year = Number(code.slice(0, 4));
    const part = Number(code.slice(4));
    const month = frequency === "quarterly" ? part * 3 : part;
    if (!(month >= 1 && month <= 12)) continue;
    rows.push({ reference_date: `${year}-${pad(month)}-01`, value, label: String(item?.D3N || "") || null });
  }
  return sortAndDedupe(rows);
}

// BCB Olinda TaxasJurosMensalPorMes: { value: [{ Modalidade, InstituicaoFinanceira, cnpj8, Posicao, TaxaJurosAoMes, TaxaJurosAoAno, anoMes }] }
export function parseOlindaRates(payload) {
  const list = Array.isArray(payload?.value) ? payload.value : null;
  if (!list) throw new Error("Resposta do BCB (taxas de juros) fora do formato esperado.");
  const seen = new Map();
  for (const item of list) {
    const month = /^(\d{4})-(\d{2})$/.exec(String(item?.anoMes || ""));
    const modality = String(item?.Modalidade || "").trim();
    const cnpj8 = String(item?.cnpj8 || "").trim();
    const rateMonth = parseNumber(item?.TaxaJurosAoMes);
    const rateYear = parseNumber(item?.TaxaJurosAoAno);
    if (!month || !modality || !cnpj8 || rateYear === null) continue;
    const row = { reference_month: `${month[1]}-${month[2]}-01`, modality, institution: String(item?.InstituicaoFinanceira || "").trim(), cnpj8, position: Number(item?.Posicao) || null, rate_month: rateMonth, rate_year: rateYear };
    seen.set(`${row.reference_month}|${modality}|${cnpj8}`, row);
  }
  return [...seen.values()];
}

// Dedupe (indicador, referência): a última ocorrência vence (revisão da fonte).
export function sortAndDedupe(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.reference_date, row);
  return [...map.values()].sort((a, b) => a.reference_date.localeCompare(b.reference_date));
}

// Linhas que entram no banco (UNIQUE indicator_code + reference_date).
export function toValueRows(code, rows) {
  return sortAndDedupe(rows).map((row) => ({ indicator_code: code, reference_date: row.reference_date, value: row.value, reference_label: row.label || null }));
}

// Período novo = referência mais recente depois da coleta maior que a anterior. Primeira coleta (sem anterior) NÃO conta como
// divulgação nova (evita uma enxurrada de alertas no backfill).
export function detectNewReference(previousLatest, rows) {
  if (!rows?.length) return null;
  const latest = rows[rows.length - 1].reference_date;
  if (!previousLatest) return null;
  return latest > previousLatest ? latest : null;
}

// ---------- Datas e rótulos ----------

export function monthKey(date) {
  return String(date || "").slice(0, 7);
}

export function addMonths(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

export function referenceLabel(indicator, date, storedLabel = null) {
  if (!date) return "";
  const [y, m, d] = String(date).split("-").map(Number);
  const freq = indicator?.frequency;
  if (freq === "daily") return `${pad(d)}/${pad(m)}/${y}`;
  if (freq === "quarterly") return `${Math.ceil(m / 3)}º tri/${y}`;
  if (freq === "moving_quarter") {
    const start = addMonths(`${y}-${pad(m)}`, -2);
    const [sy, sm] = start.split("-").map(Number);
    return `${MONTHS[sm - 1]}${sy !== y ? `/${sy}` : ""}–${MONTHS[m - 1]}/${y}`;
  }
  return storedLabel && freq !== "monthly" ? storedLabel : `${MONTHS[m - 1]}/${y}`;
}

export function formatValue(indicator, value, { signed = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const v = Number(value);
  if (indicator?.unit === "R$") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
  const digits = indicator?.code === "tr" ? 4 : 2;
  const text = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: digits }).format(v);
  return `${signed && v > 0 ? "+" : ""}${text}${indicator?.unit === "% a.a." ? "% a.a." : "%"}`;
}

// ---------- Acumulados (juros compostos sobre as variações mensais) ----------

export function compound(rates) {
  return rates.reduce((factor, rate) => factor * (1 + Number(rate) / 100), 1);
}

// rows ordenadas, mensais. Acumulado no ano (jan..mês da última referência) e em 12 meses; exige todos os meses.
export function accumulatedStats(rows) {
  if (!rows?.length) return { latest: null, previous: null, ytd: null, twelveMonths: null };
  const byMonth = new Map(rows.map((row) => [monthKey(row.reference_date), Number(row.value)]));
  const latest = rows[rows.length - 1];
  const latestKey = monthKey(latest.reference_date);
  const collect = (keys) => (keys.every((key) => byMonth.has(key)) ? keys.map((key) => byMonth.get(key)) : null);
  const month = Number(latestKey.slice(5));
  const ytdRates = collect(Array.from({ length: month }, (_, i) => addMonths(latestKey, -(month - 1 - i))));
  const twelveRates = collect(Array.from({ length: 12 }, (_, i) => addMonths(latestKey, -(11 - i))));
  return {
    latest,
    previous: rows.length > 1 ? rows[rows.length - 2] : null,
    ytd: ytdRates ? round((compound(ytdRates) - 1) * 100, 4) : null,
    twelveMonths: twelveRates ? round((compound(twelveRates) - 1) * 100, 4) : null
  };
}

export function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(Number(value) * f) / f;
}

// ---------- Calculadora de correção monetária ----------
// Fator = produto de (1 + variação/100) de cada mês de startMonth até endMonth, inclusive. Mês sem dado no meio = recusa
// (nunca interpola). Fim depois do último mês divulgado = corrige até o último divulgado e avisa. Correção ≠ juros.
export function computeCorrection({ amount, indicator, startMonth, endMonth, rows }) {
  const value = Number(amount);
  if (!(value > 0)) return { ok: false, error: "Informe um valor maior que zero." };
  if (!indicatorByCode(indicator)?.correction) return { ok: false, error: "Índice não disponível para correção." };
  if (!/^\d{4}-\d{2}$/.test(startMonth || "") || !/^\d{4}-\d{2}$/.test(endMonth || "")) return { ok: false, error: "Informe o mês inicial e o final." };
  if (startMonth > endMonth) return { ok: false, error: "O mês inicial precisa ser anterior ou igual ao final." };
  const byMonth = new Map((rows || []).map((row) => [monthKey(row.reference_date), Number(row.value)]));
  if (!byMonth.size) return { ok: false, error: "Ainda não há dados deste índice no CRM." };
  const keys = [...byMonth.keys()].sort();
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (startMonth < first) return { ok: false, error: `O CRM tem este índice a partir de ${labelMonth(first)}.` };
  if (startMonth > last) return { ok: false, error: `O último mês divulgado é ${labelMonth(last)}.` };
  const warnings = [];
  let effectiveEnd = endMonth;
  if (endMonth > last) {
    effectiveEnd = last;
    warnings.push(`Período incompleto: o índice só foi divulgado até ${labelMonth(last)}. A correção vai até esse mês.`);
  }
  const months = [];
  for (let key = startMonth; key <= effectiveEnd; key = addMonths(key, 1)) months.push(key);
  const missing = months.filter((key) => !byMonth.has(key));
  if (missing.length) return { ok: false, error: `Faltam dados oficiais de ${missing.map(labelMonth).join(", ")}. A correção não foi calculada.`, missing };
  const used = months.map((key) => ({ month: key, rate: byMonth.get(key) }));
  const factor = compound(used.map((item) => item.rate));
  const updated = value * factor;
  return {
    ok: true,
    amount: round(value, 2),
    factor: round(factor, 6),
    percent: round((factor - 1) * 100, 4),
    correction: round(updated - value, 2),
    updated: round(updated, 2),
    startMonth,
    endMonth: effectiveEnd,
    months: used,
    warnings
  };
}

export function labelMonth(key) {
  const [y, m] = String(key).split("-").map(Number);
  return `${MONTHS[m - 1]}/${y}`;
}

// ---------- Frescor ----------
// Idade máxima esperada da última referência (dias) por frequência, com folga para o calendário de divulgação.
const MAX_AGE_DAYS = { daily: 7, monthly: 75, moving_quarter: 110, quarterly: 200 };

export function freshness(indicator, { latestReference, lastSuccessAt, lastErrorAt, now = new Date() } = {}) {
  if (!latestReference) return lastErrorAt ? "error" : "empty";
  const ageDays = (now.getTime() - new Date(`${latestReference}T12:00:00Z`).getTime()) / 86400000;
  const failedAfterSuccess = lastErrorAt && (!lastSuccessAt || new Date(lastErrorAt) > new Date(lastSuccessAt));
  const collectAgeDays = lastSuccessAt ? (now.getTime() - new Date(lastSuccessAt).getTime()) / 86400000 : Infinity;
  if (failedAfterSuccess && collectAgeDays > 2) return "error";
  if (ageDays > (MAX_AGE_DAYS[indicator?.frequency] || 75)) return "stale";
  return "ok";
}

// ---------- "O que mudou na economia?" (texto determinístico; nunca causalidade) ----------

// [REGRA OFICIAL — dono, 2026-10-29] Seta de IPCA e INCC: queda = verde ("good"), alta = vermelha ("bad", "o juro/
// inflação subiu"), estável = neutra. Demais indicadores: sempre neutros.
export const TONED_DIRECTION_CODES = Object.freeze(["ipca", "incc"]);
export function directionTone(code, direction) {
  if (!TONED_DIRECTION_CODES.includes(code)) return "neutral";
  if (direction === "down") return "good";
  if (direction === "up") return "bad";
  return "neutral";
}

export function compareLatest(indicator, rows) {
  if (!rows || rows.length < 2) return null;
  let latest = rows[rows.length - 1];
  let previous = rows[rows.length - 2];
  // Série diária (Selic/CDI): compara com o último valor DIFERENTE, senão nunca haveria mudança a mostrar.
  if (indicator.frequency === "daily") {
    const idx = findLastChange(rows);
    if (idx < 0) return { indicator, latest, previous: null, direction: "stable", delta: 0, relevant: false, since: rows[0].reference_date };
    previous = rows[idx];
    latest = rows[rows.length - 1];
  }
  const delta = round(Number(latest.value) - Number(previous.value), 4);
  const pct = Number(previous.value) !== 0 ? (delta / Math.abs(Number(previous.value))) * 100 : null;
  const direction = Math.abs(delta) < 0.005 ? "stable" : delta > 0 ? "up" : "down";
  const relevant = direction !== "stable" && (indicator.relevantPct ? Math.abs(pct ?? 0) >= indicator.relevantPct : Math.abs(delta) >= (indicator.relevantDelta ?? Infinity));
  return { indicator, latest, previous, direction, delta, pct: pct === null ? null : round(pct, 2), relevant };
}

function findLastChange(rows) {
  const last = Number(rows[rows.length - 1].value);
  for (let i = rows.length - 2; i >= 0; i -= 1) if (Number(rows[i].value) !== last) return i;
  return -1;
}

export function describeChange(change) {
  if (!change) return "";
  const { indicator, latest, previous, direction, delta } = change;
  const now = `${formatValue(indicator, latest.value)} (${referenceLabel(indicator, latest.reference_date, latest.reference_label)})`;
  if (!previous) return `${indicator.name}: ${now}, sem mudança no período disponível.`;
  const before = `${formatValue(indicator, previous.value)} (${referenceLabel(indicator, previous.reference_date, previous.reference_label)})`;
  if (direction === "stable") return `${indicator.name}: ${now}, igual a ${before}.`;
  const word = direction === "up" ? "acima de" : "abaixo de";
  const diff = indicator.unit === "R$" ? `${change.pct > 0 ? "+" : ""}${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(change.pct)}%` : `${delta > 0 ? "+" : ""}${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(delta)} p.p.`;
  return `${indicator.name}: ${now}, ${word} ${before} (${diff}).`;
}

export function buildWhatChanged(seriesByCode) {
  const changes = ECON_INDICATORS.map((indicator) => compareLatest(indicator, seriesByCode[indicator.code])).filter(Boolean);
  const pick = (dir) => changes.filter((c) => c.direction === dir).map((c) => ({ code: c.indicator.code, text: describeChange(c), relevant: c.relevant }));
  return { up: pick("up"), down: pick("down"), stable: pick("stable"), relevant: changes.filter((c) => c.relevant).map((c) => c.indicator.code) };
}

// ---------- Alertas (Central de Alertas existente, Informativo, sem push) ----------

export function economicAlertDedupeKey(code, referenceDate) {
  return `econ:${code}:${referenceDate}`;
}

// Gera o alerta de uma divulgação nova (ou, na Selic, de mudança de valor). null = nada a avisar.
export function buildEconomicAlert(indicator, rows, newReference) {
  if (!indicator?.alert || !newReference || !rows?.length) return null;
  const change = compareLatest(indicator, rows);
  if (indicator.alertOnChangeOnly) {
    if (!change?.previous || change.direction === "stable" || change.latest.reference_date !== newReference) return null;
    // Uma vez por mudança: a chave é a data em que o valor novo apareceu pela primeira vez.
    const firstNew = rows.find((row) => row.reference_date > change.previous.reference_date);
    return { title: `${indicator.name} mudou`, body: describeChange(change), dedupe_key: economicAlertDedupeKey(indicator.code, firstNew.reference_date), relevant: true };
  }
  const latest = rows[rows.length - 1];
  if (latest.reference_date !== newReference) return null;
  const body = change ? describeChange(change) : `${indicator.name}: ${formatValue(indicator, latest.value)} (${referenceLabel(indicator, latest.reference_date, latest.reference_label)}).`;
  return { title: `${change?.relevant ? "Variação relevante: " : "Novo dado: "}${indicator.name}`, body, dedupe_key: economicAlertDedupeKey(indicator.code, newReference), relevant: Boolean(change?.relevant) };
}

// Preferências: sem linha = padrão do indicador (ligado para os que alertam). Retorna os ids que querem o alerta.
export function recipientsForIndicator(users, preferences, code) {
  const off = new Set((preferences || []).filter((p) => p.indicator_code === code && p.enabled === false).map((p) => p.user_id));
  return (users || []).filter((user) => user.id && user.status !== "inactive" && ["admin", "manager", "broker", "associate"].includes(user.role) && !off.has(user.id)).map((user) => user.id);
}

// ---------- Comparativo de bancos ----------

export function bankComparison(rows, modality) {
  const list = (rows || []).filter((row) => row.modality === modality);
  if (!list.length) return { month: null, items: [] };
  const month = list.map((row) => row.reference_month).sort().at(-1);
  return { month, items: list.filter((row) => row.reference_month === month).sort((a, b) => a.rate_year - b.rate_year) };
}

// ---------- Radar (card do cabeçalho) ----------

export function radarItem(indicator, rows) {
  if (!rows?.length) return { code: indicator.code, name: indicator.name, value: null };
  const change = compareLatest(indicator, rows);
  const latest = rows[rows.length - 1];
  return { code: indicator.code, name: indicator.name, value: Number(latest.value), label: formatValue(indicator, latest.value), reference: referenceLabel(indicator, latest.reference_date), direction: change?.direction || null };
}

// ---------- Tira do Radar (dono, 2026-10-29 — ECON-2) ----------
// Mini-cards da tira do cabeçalho: Selic, Caixa + média dos bancos, TR, INCC-DI, IPCA, renda OU desemprego e MCMV (cadastro
// manual). Tudo daqui é puro: o servidor (lib/economic-indicators.js getEconomicRadar) só lê o banco e chama estas funções.

export const RADAR_BANK_MODALITY_PATTERN = /mercado - Prefixado$/; // mesma modalidade padrão do comparativo da aba
export const CAIXA_CNPJ8 = "00360305";
export const RADAR_HISTORY_MONTHS = 12;
export const RADAR_SPARK_MONTHS = 6;
export const MCMV_SETTINGS_ID = "econ_radar_mcmv";

const SP_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
export function saoPauloDay(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : SP_DAY.format(date);
}

// Nome curto da fonte oficial (BCB, IBGE ou FGV — INCC/IGP-M são da FGV, republicados pelo BCB).
export function sourceShort(indicator) {
  const label = String(indicator?.sourceLabel || "");
  if (label.startsWith("FGV")) return "FGV";
  if (label.startsWith("IBGE")) return "IBGE";
  return label.startsWith("BCB") ? "BCB" : "";
}

// Pontos mensais para gráfico: série mensal/trimestre móvel = o próprio valor; diária = último valor de cada mês.
export function monthlyPoints(indicator, rows, months = RADAR_HISTORY_MONTHS) {
  const byMonth = new Map();
  for (const row of rows || []) byMonth.set(monthKey(row.reference_date), row);
  return [...byMonth.values()]
    .sort((a, b) => a.reference_date.localeCompare(b.reference_date))
    .slice(-months)
    .map((row) => ({ date: row.reference_date, value: Number(row.value), label: referenceLabel(indicator, row.reference_date, row.reference_label) }));
}

// Índice da linha em que a divulgação mais recente entrou (diária: 1º dia com o valor novo; senão a última linha). -1 = nenhuma.
function releaseIndex(indicator, rows) {
  if (!rows?.length) return -1;
  if (indicator?.frequency !== "daily") return rows.length - 1;
  const idx = findLastChange(rows);
  return idx < 0 ? -1 : idx + 1;
}

// Quando o CRM recebeu a divulgação mais recente (fetched_at da linha, que o upsert da coleta nunca reescreve).
export function releaseCollectedAt(indicator, rows) {
  const idx = releaseIndex(indicator, rows);
  return idx < 0 ? null : rows[idx].fetched_at || null;
}

// Selo "mudou hoje": a divulgação mais recente entrou hoje (São Paulo) E a anterior entrou em outro dia — na 1ª coleta
// (backfill) tudo entra no mesmo dia e nada ganha selo, igual aos alertas (detectNewReference). Selic: só quando o valor muda.
export function releasedToday(indicator, rows, today) {
  const idx = releaseIndex(indicator, rows);
  if (idx < 1) return false;
  const day = saoPauloDay(rows[idx].fetched_at);
  return Boolean(day) && day === today && saoPauloDay(rows[idx - 1].fetched_at) !== today;
}

// Renda média real ou desemprego: o de referência mais recente; empate = renda (capacidade de pagamento).
export function pickLaborCode(rendaRows, desempregoRows) {
  const r = rendaRows?.at(-1)?.reference_date || "";
  const d = desempregoRows?.at(-1)?.reference_date || "";
  if (!r && !d) return null;
  return d > r ? "desemprego" : "renda";
}

// Nome curto no mini-card (o nome completo vai no detalhe e no leitor de tela).
const RADAR_SHORT_NAMES = Object.freeze({ selic: "Selic", renda: "Renda real" });

export function radarTile(indicator, rows, { today = "" } = {}) {
  const base = radarItem(indicator, rows);
  const history = monthlyPoints(indicator, rows);
  const stats = indicator.kind === "monthly_rate" ? accumulatedStats(rows) : null;
  const twelve = stats?.twelveMonths ?? null;
  return {
    ...base,
    name: RADAR_SHORT_NAMES[indicator.code] || base.name,
    fullName: indicator.name,
    unit: indicator.unit,
    tone: directionTone(indicator.code, base.direction),
    twelveMonths: twelve,
    twelveMonthsLabel: twelve === null ? null : formatValue(indicator, twelve),
    history,
    spark: history.slice(-RADAR_SPARK_MONTHS).map((p) => p.value),
    source: sourceShort(indicator),
    sourceLabel: indicator.sourceLabel,
    description: indicator.description,
    collectedAt: releaseCollectedAt(indicator, rows),
    releasedToday: releasedToday(indicator, rows, today)
  };
}

const RATE_YEAR = { unit: "% a.a." };

// Caixa + média simples das instituições na modalidade padrão. rows = econ_bank_rates de ~13 meses (uma modalidade).
export function radarBankTile(rows, { today = "" } = {}) {
  const list = (rows || []).filter((row) => row.rate_year !== null && Number.isFinite(Number(row.rate_year)));
  if (!list.length) return null;
  const months = [...new Set(list.map((row) => row.reference_month))].sort().slice(-RADAR_HISTORY_MONTHS);
  const caixa = [];
  const average = [];
  const fetchedByMonth = new Map();
  for (const month of months) {
    const inMonth = list.filter((row) => row.reference_month === month);
    const label = labelMonth(monthKey(month));
    const c = inMonth.find((row) => row.cnpj8 === CAIXA_CNPJ8);
    if (c) caixa.push({ date: month, value: Number(c.rate_year), label });
    average.push({ date: month, value: round(inMonth.reduce((sum, row) => sum + Number(row.rate_year), 0) / inMonth.length, 2), label, count: inMonth.length });
    fetchedByMonth.set(month, inMonth.map((row) => row.fetched_at).filter(Boolean).sort()[0] || null);
  }
  const lastMonth = months.at(-1);
  const prevMonth = months.at(-2);
  const caixaLatest = caixa.at(-1)?.date === lastMonth ? caixa.at(-1) : null;
  const avgLatest = average.at(-1);
  const series = caixaLatest ? caixa : average;
  const main = series.at(-1);
  const before = series.at(-2);
  const delta = before ? round(main.value - before.value, 4) : null;
  const collectedAt = fetchedByMonth.get(lastMonth) || null;
  const day = saoPauloDay(collectedAt);
  return {
    code: "financiamento",
    name: caixaLatest ? "Caixa (financ.)" : "Bancos (financ.)",
    value: main.value,
    label: formatValue(RATE_YEAR, main.value),
    reference: labelMonth(monthKey(lastMonth)),
    direction: delta === null ? null : Math.abs(delta) < 0.005 ? "stable" : delta > 0 ? "up" : "down",
    tone: "neutral",
    unit: "% a.a.",
    caixa: caixaLatest ? { value: caixaLatest.value, label: formatValue(RATE_YEAR, caixaLatest.value) } : null,
    average: { value: avgLatest.value, label: formatValue(RATE_YEAR, avgLatest.value), count: avgLatest.count },
    history: series,
    averageHistory: average,
    spark: series.slice(-RADAR_SPARK_MONTHS).map((p) => p.value),
    source: "BCB",
    sourceLabel: BANK_RATES_SOURCE,
    description: "Taxa média ao ano das operações de financiamento imobiliário (taxas de mercado, prefixado) informada pelas instituições ao Banco Central. Média de mercado, não é a taxa oferecida a um cliente.",
    collectedAt,
    releasedToday: Boolean(day) && day === today && Boolean(prevMonth) && saoPauloDay(fetchedByMonth.get(prevMonth)) !== today
  };
}

// ---------- MCMV (cadastro manual do admin geral em crm_settings) ----------
// Só aparece quando cadastrado, sempre com a portaria e a data. O CRM não busca nem calcula nada do MCMV.
export const MCMV_MAX_FAIXAS = 6;
function moneyOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim().replace(/^R\$\s*/, "");
  // Aceita "264000", "264.000", "R$ 264.000,50" e "2850,5" (jeito brasileiro de digitar).
  const normalized = text.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, "").replace(",", ".") : text;
  const n = typeof value === "number" ? value : Number(normalized);
  return Number.isFinite(n) && n > 0 ? round(n, 2) : Number.NaN;
}

export function normalizeMcmvSettings(input) {
  const faixasIn = Array.isArray(input?.faixas) ? input.faixas : [];
  const faixas = [];
  for (const [i, raw] of faixasIn.entries()) {
    const nome = String(raw?.nome || "").trim();
    const rendaAte = moneyOrNull(raw?.rendaAte);
    const tetoImovel = moneyOrNull(raw?.tetoImovel);
    if (!nome && rendaAte === null && tetoImovel === null) continue;
    if (!nome || nome.length > 40) return { ok: false, error: `Faixa ${i + 1}: informe um nome de até 40 caracteres.` };
    if (Number.isNaN(rendaAte) || Number.isNaN(tetoImovel)) return { ok: false, error: `Faixa ${i + 1}: os valores precisam ser números maiores que zero.` };
    if (rendaAte === null && tetoImovel === null) return { ok: false, error: `Faixa ${i + 1}: informe a renda máxima ou o teto do imóvel.` };
    faixas.push({ nome, rendaAte, tetoImovel });
  }
  if (!faixas.length) return { ok: true, value: null }; // sem faixa = cadastro apagado (some do Radar)
  if (faixas.length > MCMV_MAX_FAIXAS) return { ok: false, error: `No máximo ${MCMV_MAX_FAIXAS} faixas.` };
  const portaria = String(input?.portaria || "").trim();
  const portariaData = String(input?.portariaData || "").trim();
  if (portaria.length < 3 || portaria.length > 120) return { ok: false, error: "Informe a portaria (ex.: Portaria MCID nº 000/2026)." };
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(portariaData);
  const valid = parsed && new Date(`${portariaData}T12:00:00Z`).toISOString().slice(0, 10) === portariaData;
  if (!valid) return { ok: false, error: "Informe a data da portaria." };
  return { ok: true, value: { faixas, portaria, portariaData } };
}

const BRL0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const formatBrl = (value) => BRL0.format(Number(value));
export const brDateLabel = (iso) => String(iso || "").split("-").reverse().join("/");

export function radarMcmvTile(settings) {
  if (!settings?.faixas?.length || !settings.portariaData || !settings.portaria) return null;
  const tetos = settings.faixas.map((f) => f.tetoImovel).filter((n) => n > 0);
  const rendas = settings.faixas.map((f) => f.rendaAte).filter((n) => n > 0);
  return {
    code: "mcmv",
    name: tetos.length ? "MCMV · teto" : "MCMV · renda até",
    fullName: "Minha Casa Minha Vida",
    value: null,
    label: formatBrl(tetos.length ? Math.max(...tetos) : Math.max(...rendas)),
    reference: `portaria ${brDateLabel(settings.portariaData)}`,
    direction: null,
    tone: "neutral",
    faixas: settings.faixas,
    portaria: settings.portaria,
    portariaData: settings.portariaData,
    source: "Portaria",
    sourceLabel: `${settings.portaria}, de ${brDateLabel(settings.portariaData)} (cadastrado à mão pelo administrador geral)`,
    description: "Faixas e teto do Minha Casa Minha Vida conforme a portaria cadastrada pelo administrador. O enquadramento de cada cliente depende da análise do banco.",
    history: [],
    spark: [],
    collectedAt: null,
    releasedToday: false
  };
}

// ---------- "Como isso afeta a parcela" (texto pronto para WhatsApp) ----------
// Só os números oficiais já mostrados no Radar; nunca promete aprovação, taxa ou valor de parcela.
export const BRAND_SIGNATURE = "Matheus Machado Corretor de Imóveis";

export function buildInstallmentMessage(tiles, { sign = true } = {}) {
  const by = Object.fromEntries((tiles || []).filter((t) => t?.label && t.label !== "—").map((t) => [t.code, t]));
  const lines = [];
  if (by.selic) lines.push(`• Selic (juros básicos do país): ${by.selic.label}, em ${by.selic.reference} (BCB).`);
  if (by.financiamento) {
    const f = by.financiamento;
    const parts = [f.caixa ? `Caixa ${f.caixa.label}` : null, `média dos bancos ${f.average.label}`].filter(Boolean).join("; ");
    lines.push(`• Financiamento imobiliário, taxa média de mercado de ${f.reference}: ${parts} (BCB). É média de mercado, não a taxa de uma proposta.`);
  }
  if (by.tr) lines.push(`• TR de ${by.tr.reference}: ${by.tr.label}. É a taxa usada na correção do saldo de financiamentos (BCB).`);
  if (by.incc) lines.push(`• INCC-DI (custo da construção) em ${by.incc.reference}: ${by.incc.label}${by.incc.twelveMonthsLabel ? `; ${by.incc.twelveMonthsLabel} em 12 meses` : ""} (FGV).`);
  if (by.ipca) lines.push(`• IPCA (inflação oficial) em ${by.ipca.reference}: ${by.ipca.label}${by.ipca.twelveMonthsLabel ? `; ${by.ipca.twelveMonthsLabel} em 12 meses` : ""} (IBGE).`);
  if (by.renda) lines.push(`• Renda média real do trabalho (${by.renda.reference}): ${by.renda.label} (IBGE).`);
  if (by.desemprego) lines.push(`• Desemprego (${by.desemprego.reference}): ${by.desemprego.label} (IBGE).`);
  if (by.mcmv) lines.push(`• Minha Casa Minha Vida, ${by.mcmv.name.replace("MCMV · ", "")}: ${by.mcmv.label} (${by.mcmv.portaria}, de ${brDateLabel(by.mcmv.portariaData)}).`);
  if (!lines.length) return "";
  return [
    "Os números oficiais que influenciam a parcela do financiamento:",
    "",
    ...lines,
    "",
    "A taxa e a parcela de cada pessoa dependem da análise de crédito do banco, da renda e do imóvel. Se quiser, faço uma simulação com os seus dados, sem compromisso.",
    ...(sign ? ["", BRAND_SIGNATURE] : [])
  ].join("\n");
}
