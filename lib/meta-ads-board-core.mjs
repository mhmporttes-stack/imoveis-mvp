// Regras puras da área Anúncios (pedido do dono, 2026-10-13). Sem banco,
// sem rede — testadas em tests/meta-ads-board.test.mjs.
// Limites de recomendação: relativos à própria conta (medianas dos últimos
// 30 dias), especificados pelo gestor-trafego em 2026-10-13. Os valores
// FALLBACK_* só entram quando há menos de 2 anúncios com resultado no tipo
// (eram as medianas reais da conta em 13/09–13/10/2026).

export const CONVERSATION_ACTION_TYPE = "onsite_conversion.messaging_conversation_started_7d";
export const LINK_CLICK_ACTION_TYPE = "link_click";

const WHATSAPP_OBJECTIVES = new Set(["OUTCOME_ENGAGEMENT", "MESSAGES"]);
const SIGNUP_OBJECTIVES = new Set(["OUTCOME_LEADS", "LEAD_GENERATION", "CONVERSIONS"]);

export const FALLBACK_BENCHMARKS = Object.freeze({
  costPerResult: { cadastro: 6.55, whatsapp: 5.54 },
  ctrP25: 0.84,
  cpmMedian: 10.66
});

const FREQUENCY_BAD = 2.0;
const FREQUENCY_WARN = 1.5;

// O tipo vem do OBJETIVO da campanha (nunca do número maior: há campanha de
// cadastro com algumas conversas). destination_type do conjunto confirma WhatsApp.
export function adKindFor({ objective, destinationType } = {}) {
  const destination = String(destinationType || "").toUpperCase();
  if (destination === "WHATSAPP" || destination === "MESSAGING_APPS") return "whatsapp";
  const value = String(objective || "").toUpperCase();
  if (WHATSAPP_OBJECTIVES.has(value)) return "whatsapp";
  if (SIGNUP_OBJECTIVES.has(value)) return "cadastro";
  return "outro";
}

export function addDaysIso(dateIso, days) {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function periodRange(period, todayIso) {
  const days = period === "today" ? 1 : period === "30d" ? 30 : 7;
  return { since: addDaysIso(todayIso, -(days - 1)), until: todayIso, days };
}

export function median(values) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
}

export function percentile(values, p) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const position = (list.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return list[lower] + (list[upper] - list[lower]) * (position - lower);
}

function actionValue(actions, actionType) {
  if (!Array.isArray(actions)) return 0;
  return actions.filter((action) => action?.action_type === actionType).reduce((sum, action) => sum + (Number(action?.value) || 0), 0);
}

// Soma as linhas diárias (nível anúncio) dentro de [since, until].
// Frequência diária não é somável: guardamos a maior do período só como
// reserva para quando a Meta não devolver a do período inteiro.
export function aggregateAdInsights(rows, { since, until } = {}) {
  const byAd = new Map();
  for (const row of rows || []) {
    if (since && row.date < since) continue;
    if (until && row.date > until) continue;
    const id = String(row.entity_id);
    const current = byAd.get(id) || { spend: 0, impressions: 0, clicks: 0, leads: 0, conversations: 0, linkClicks: 0, maxFrequency: null, daysWithSpend: 0 };
    const spend = Number(row.spend) || 0;
    current.spend += spend;
    current.impressions += Number(row.impressions) || 0;
    current.clicks += Number(row.clicks) || 0;
    current.leads += Number(row.leads) || 0;
    current.conversations += actionValue(row.actions_raw, CONVERSATION_ACTION_TYPE);
    current.linkClicks += actionValue(row.actions_raw, LINK_CLICK_ACTION_TYPE);
    if (row.frequency !== null && row.frequency !== undefined) {
      current.maxFrequency = Math.max(current.maxFrequency ?? 0, Number(row.frequency) || 0);
    }
    if (spend > 0) current.daysWithSpend += 1;
    byAd.set(id, current);
  }
  return byAd;
}

export function resultsFor(kind, totals) {
  if (!totals) return 0;
  if (kind === "whatsapp") return totals.conversations;
  if (kind === "cadastro") return totals.leads;
  return totals.leads + totals.conversations;
}

export function deriveMetrics(kind, totals = {}, extras = {}) {
  const spend = round2(totals.spend || 0);
  const results = resultsFor(kind, totals);
  const impressions = totals.impressions || 0;
  const crmLeads = extras.crmLeads ?? 0;
  return {
    spend,
    results,
    costPerResult: results > 0 && kind !== "outro" ? round2(spend / results) : null,
    crmLeads,
    crmCostPerLead: crmLeads > 0 ? round2(spend / crmLeads) : null,
    reach: extras.reach ?? null,
    impressions,
    frequency: extras.frequency ?? totals.maxFrequency ?? null,
    clicks: totals.clicks || 0,
    linkClicks: totals.linkClicks || 0,
    ctr: impressions > 0 ? round2(((totals.clicks || 0) / impressions) * 100) : null,
    cpm: impressions > 0 ? round2((spend / impressions) * 1000) : null,
    cpc: totals.clicks > 0 ? round2(spend / totals.clicks) : null,
    leads: totals.leads || 0,
    conversations: totals.conversations || 0,
    daysWithSpend: totals.daysWithSpend || 0
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Medianas da conta nos últimos 30 dias. kindByAd: Map(adId -> kind).
export function computeBenchmarks(rows30, kindByAd) {
  const totals = aggregateAdInsights(rows30);
  const costs = { cadastro: [], whatsapp: [] };
  for (const [adId, total] of totals) {
    const kind = kindByAd.get(adId);
    if (kind !== "cadastro" && kind !== "whatsapp") continue;
    const results = resultsFor(kind, total);
    if (total.spend > 0 && results > 0) costs[kind].push(total.spend / results);
  }
  const dailyCtr = [];
  const dailyCpm = [];
  for (const row of rows30 || []) {
    const impressions = Number(row.impressions) || 0;
    if (impressions < 100 || !(Number(row.spend) > 0)) continue;
    dailyCtr.push(((Number(row.clicks) || 0) / impressions) * 100);
    dailyCpm.push(((Number(row.spend) || 0) / impressions) * 1000);
  }
  const pick = (list, fallback) => (list.length >= 2 ? median(list) : fallback);
  return {
    costPerResult: {
      cadastro: pick(costs.cadastro, FALLBACK_BENCHMARKS.costPerResult.cadastro),
      whatsapp: pick(costs.whatsapp, FALLBACK_BENCHMARKS.costPerResult.whatsapp)
    },
    ctrP25: dailyCtr.length >= 4 ? percentile(dailyCtr, 0.25) : FALLBACK_BENCHMARKS.ctrP25,
    cpmMedian: dailyCpm.length >= 2 ? median(dailyCpm) : FALLBACK_BENCHMARKS.cpmMedian,
    sample: { cadastro: costs.cadastro.length, whatsapp: costs.whatsapp.length, days: dailyCtr.length }
  };
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const DEC = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const money = (value) => BRL.format(value);

const TONE_RANK = { bad: 3, warn: 2, good: 1, neutral: 0 };

// Status do card + recomendações (frases curtas; sempre sugestão — a tela
// não tem nenhuma ação na Meta).
export function evaluateAd({ kind, metrics }, benchmarks) {
  const recs = [];
  const m = metrics;
  const bench = benchmarks || FALLBACK_BENCHMARKS;
  const costMedian = kind === "outro" ? null : bench.costPerResult?.[kind] ?? null;
  const resultWord = kind === "whatsapp" ? "conversa" : "lead";

  if (m.spend <= 0) {
    return { tone: "neutral", recommendations: [{ tone: "neutral", title: "Sem investimento no período", detail: "O anúncio não gastou nada nestes dias." }] };
  }

  const learning = (costMedian !== null && m.spend < costMedian) || m.daysWithSpend < 2;

  if (costMedian !== null && !learning) {
    if (m.results === 0 && m.spend >= 2 * costMedian) {
      recs.push({ tone: "bad", title: "Gastou sem trazer contato", detail: `${money(m.spend)} investidos e nenhum ${resultWord}. A média da conta é ${money(costMedian)} por ${resultWord}.` });
    } else if (m.costPerResult !== null && m.costPerResult > 1.5 * costMedian) {
      recs.push({ tone: "bad", title: "Custo alto", detail: `${money(m.costPerResult)} por ${resultWord}, mais de 50% acima da média da conta (${money(costMedian)}). Revise o criativo ou o público.` });
    } else if (m.costPerResult !== null && m.costPerResult > costMedian) {
      const percent = Math.round((m.costPerResult / costMedian - 1) * 100);
      recs.push({ tone: "warn", title: "Custo acima da média", detail: `${money(m.costPerResult)} por ${resultWord}, ${percent}% acima da média da conta (${money(costMedian)}).` });
    }
  }

  if (m.frequency !== null && m.frequency > FREQUENCY_BAD) {
    recs.push({ tone: "bad", title: "Mesmas pessoas vendo demais", detail: `Cada pessoa viu o anúncio ${DEC.format(m.frequency)} vezes. Acima de 2 o público cansa e o custo sobe.` });
  } else if (m.frequency !== null && m.frequency > FREQUENCY_WARN) {
    recs.push({ tone: "warn", title: "Público começando a cansar", detail: `Frequência de ${DEC.format(m.frequency)} vezes por pessoa. Acima de 2 vira problema.` });
  }

  if (m.impressions >= 300 && m.ctr !== null && bench.ctrP25 !== null && m.ctr < bench.ctrP25) {
    recs.push({ tone: "warn", title: "Pouca gente clicando", detail: `CTR de ${DEC.format(m.ctr)}%, entre os 25% piores da conta (abaixo de ${DEC.format(bench.ctrP25)}%). Vale testar outro criativo.` });
  }

  if (m.impressions >= 300 && m.cpm !== null && bench.cpmMedian && m.cpm > 2 * bench.cpmMedian) {
    recs.push({ tone: "warn", title: "Aparecer está caro", detail: `CPM de ${money(m.cpm)}, mais que o dobro da média da conta (${money(bench.cpmMedian)}).` });
  }

  const worst = recs.reduce((tone, rec) => (TONE_RANK[rec.tone] > TONE_RANK[tone] ? rec.tone : tone), "neutral");
  if (worst === "bad" || worst === "warn") return { tone: worst, recommendations: recs };

  if (learning) {
    return { tone: "neutral", recommendations: [{ tone: "neutral", title: "Ainda aprendendo", detail: "Pouco investimento ou poucos dias no período. Aguarde mais dados antes de decidir." }] };
  }

  if (kind === "outro") {
    return { tone: "neutral", recommendations: [{ tone: "neutral", title: "Anúncio de alcance ou tráfego", detail: "Este objetivo não gera lead direto, por isso não tem custo por lead." }] };
  }

  if (m.results >= 3 && m.crmLeads >= 1) {
    return { tone: "good", recommendations: [{ tone: "good", title: "Vencedor", detail: `Custo dentro da média e ${m.crmLeads} ${m.crmLeads === 1 ? "cliente" : "clientes"} no CRM. Candidato a mais verba (decisão sua).` }] };
  }
  return { tone: "good", recommendations: [{ tone: "good", title: "Manter", detail: `Custo dentro da média da conta (${money(costMedian)} por ${resultWord}).` }] };
}

const STATUS_LABELS = {
  ACTIVE: "Ativo na Meta",
  PAUSED: "Pausado",
  CAMPAIGN_PAUSED: "Campanha pausada",
  ADSET_PAUSED: "Conjunto pausado",
  ARCHIVED: "Arquivado",
  PENDING_REVIEW: "Em análise na Meta",
  DISAPPROVED: "Reprovado pela Meta",
  WITH_ISSUES: "Com problema na Meta",
  IN_PROCESS: "Em processamento",
  PENDING_BILLING_INFO: "Pagamento pendente",
  PREAPPROVED: "Pré-aprovado"
};

export function statusLabelFor(status) {
  return STATUS_LABELS[String(status || "").toUpperCase()] || String(status || "—");
}

// "SITE | Marília | PATROCINADO | Vídeo (API 18-55)" -> "Site · Vídeo"
export function shortCampaignName(name) {
  const parts = String(name || "").split("|").map((part) => part.replace(/\(.*?\)/g, "").trim()).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  const cap = (text) => (text.toUpperCase() === "WHATSAPP" ? "WhatsApp" : text.charAt(0).toUpperCase() + text.slice(1).toLowerCase());
  const first = parts[0].length <= 10 ? cap(parts[0]) : parts[0];
  return `${first} · ${parts[parts.length - 1]}`;
}
