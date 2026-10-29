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
