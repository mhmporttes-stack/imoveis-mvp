// Regras puras da área Anúncios (pedido do dono, 2026-10-13). Sem banco,
// sem rede — testadas em tests/meta-ads-board.test.mjs.
// Julgamento de cada anúncio (Bom/Atenção/Ruim/Aprendendo): especificação
// do gestor-trafego de 2026-10-13 (.claude/skills/auditar-trafego/references/
// regras-decisao.md), alinhada ao que ele orienta o dono: CLIENTE NO CRM manda,
// depois o custo por resultado da Meta; anúncio novo fica em aprendizado sem
// julgamento; frequência e CTR só explicam um custo ruim, nunca mudam a cor
// sozinhos. Usa janelas FIXAS (vida do anúncio até 30 dias, últimos 7 dias,
// tendência 3×4 dias), independentes do período escolhido na tela.
// FALLBACK_BENCHMARKS (médias ponderadas reais de 14/09–13/10/2026) só entram
// quando a conta tem menos de 10 clientes/resultados no tipo.

export const CONVERSATION_ACTION_TYPE = "onsite_conversion.messaging_conversation_started_7d";
export const LINK_CLICK_ACTION_TYPE = "link_click";

const WHATSAPP_OBJECTIVES = new Set(["OUTCOME_ENGAGEMENT", "MESSAGES"]);
const SIGNUP_OBJECTIVES = new Set(["OUTCOME_LEADS", "LEAD_GENERATION", "CONVERSIONS"]);

export const FALLBACK_BENCHMARKS = Object.freeze({
  crm: { cadastro: 12.13, whatsapp: 5.73 },
  meta: { cadastro: 3.06, whatsapp: 3.47 },
  ctrP25: 0.84,
  cpmAvg: 10.66
});

const LEARNING_DAYS = 7;

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

// Referências da conta nos últimos 30 dias, por tipo, sempre MÉDIA PONDERADA
// (gasto total ÷ total), nunca mediana por anúncio.
// crmCountByAd: Map(adId -> clientes do CRM em 30 dias).
export function computeBenchmarks(rows30, kindByAd, crmCountByAd = new Map()) {
  const totals = aggregateAdInsights(rows30);
  const acc = { cadastro: { spend: 0, results: 0, crm: 0 }, whatsapp: { spend: 0, results: 0, crm: 0 } };
  for (const [adId, total] of totals) {
    const kind = kindByAd.get(adId);
    if (!acc[kind]) continue;
    acc[kind].spend += total.spend;
    acc[kind].results += resultsFor(kind, total);
    acc[kind].crm += crmCountByAd.get(adId) || 0;
  }
  const dailyCtr = [];
  let impressions = 0;
  let spend = 0;
  for (const row of rows30 || []) {
    const rowImpressions = Number(row.impressions) || 0;
    if (rowImpressions >= 100 && Number(row.spend) > 0) dailyCtr.push(((Number(row.clicks) || 0) / rowImpressions) * 100);
    impressions += rowImpressions;
    spend += Number(row.spend) || 0;
  }
  const ratio = (kind, field, fallback) => (acc[kind][field] >= 10 ? acc[kind].spend / acc[kind][field] : fallback);
  return {
    crm: { cadastro: ratio("cadastro", "crm", FALLBACK_BENCHMARKS.crm.cadastro), whatsapp: ratio("whatsapp", "crm", FALLBACK_BENCHMARKS.crm.whatsapp) },
    meta: { cadastro: ratio("cadastro", "results", FALLBACK_BENCHMARKS.meta.cadastro), whatsapp: ratio("whatsapp", "results", FALLBACK_BENCHMARKS.meta.whatsapp) },
    ctrP25: dailyCtr.length >= 4 ? percentile(dailyCtr, 0.25) : FALLBACK_BENCHMARKS.ctrP25,
    cpmAvg: impressions >= 1000 ? (spend / impressions) * 1000 : FALLBACK_BENCHMARKS.cpmAvg
  };
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const DEC = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const money = (value) => BRL.format(value);

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

function countDatesIn(dates, since, until) {
  return (dates || []).filter((date) => date >= since && date <= until).length;
}

// Últimos 3 dias completos (sem hoje) contra os 4 anteriores.
export function adTrend({ kind, rows, crmDates, today }) {
  const recent = { since: addDaysIso(today, -3), until: addDaysIso(today, -1) };
  const before = { since: addDaysIso(today, -7), until: addDaysIso(today, -4) };
  const r = aggregateAdInsights(rows, recent).values().next().value;
  const b = aggregateAdInsights(rows, before).values().next().value;
  const trend = { ctrDrop: false, costUp: false, crmUp: false, crmStable: false };
  if (!r || !b) return trend;
  if (r.impressions >= 1000 && b.impressions >= 1000 && b.clicks > 0) {
    const ctrR = r.clicks / r.impressions;
    const ctrB = b.clicks / b.impressions;
    trend.ctrDrop = ctrR <= ctrB * 0.75;
  }
  const resR = resultsFor(kind, r);
  const resB = resultsFor(kind, b);
  if (resR >= 3 && resB >= 3) trend.costUp = r.spend / resR >= (b.spend / resB) * 1.4;
  const crmR = countDatesIn(crmDates, recent.since, recent.until);
  const crmB = countDatesIn(crmDates, before.since, before.until);
  if (crmR >= 3 && crmB >= 3) {
    trend.crmUp = r.spend / crmR >= (b.spend / crmB) * 1.4;
    trend.crmStable = !trend.crmUp;
  }
  return trend;
}

const rec = (tone, title, detail = "") => ({ tone, title, detail });

// Julgamento de UM anúncio. rows: linhas diárias do anúncio (até 30 dias);
// crmDates: datas (AAAA-MM-DD) dos clientes do CRM atribuídos ao anúncio;
// freq7: frequência dos últimos 7 dias pelo alcance real (null se a Meta não
// devolveu — a maior diária subestima e nunca é usada para alertar).
// Devolve { tone, recommendations: [principal, nota?] } (no máximo 1 alerta + 1 nota).
export function judgeAd({ status, kind, rows = [], crmDates = [], freq7 = null, today }, bench = FALLBACK_BENCHMARKS) {
  const metaStatus = String(status || "").toUpperCase();
  if (metaStatus === "DISAPPROVED" || metaStatus === "WITH_ISSUES") {
    return { tone: "bad", recommendations: [rec("bad", "Reprovado ou com problema na Meta", "Corrija no Gerenciador de Anúncios.")] };
  }
  if (metaStatus !== "ACTIVE") {
    return { tone: "neutral", label: "Pausado", recommendations: [rec("neutral", "Pausado", "Fora do ar na Meta. Os números são do período escolhido.")] };
  }

  if (kind === "outro") {
    return { tone: "neutral", recommendations: [rec("neutral", "Anúncio de alcance", "Este objetivo não gera cliente direto, por isso não tem custo por lead.")] };
  }

  const spentDays = rows.filter((row) => Number(row.spend) > 0).map((row) => row.date).sort();
  if (!spentDays.length) {
    return { tone: "neutral", label: "Aprendendo", recommendations: [rec("neutral", "Ainda sem investimento", "O anúncio ainda não gastou nada.")] };
  }
  const firstSpend = spentDays[0];
  const age = daysBetween(firstSpend, today) + 1;
  const life = aggregateAdInsights(rows, { since: firstSpend, until: today }).values().next().value;
  const lifeResults = resultsFor(kind, life);
  const lifeCrm = countDatesIn(crmDates, firstSpend, today);
  const benchCrm = bench.crm?.[kind] ?? FALLBACK_BENCHMARKS.crm[kind];
  const benchMeta = bench.meta?.[kind] ?? FALLBACK_BENCHMARKS.meta[kind];
  const resultWord = kind === "whatsapp" ? "conversa" : "lead";

  // 1. Aprendizado: frequência, CTR, CPM e custo da Meta são ignorados.
  if (age < LEARNING_DAYS || life.spend < 3 * benchCrm) {
    const day = `dia ${Math.min(age, LEARNING_DAYS)} de ${LEARNING_DAYS}`;
    if (lifeResults === 0 && lifeCrm === 0 && life.spend >= 3 * benchCrm) {
      return { tone: "warn", recommendations: [rec("warn", "Ainda sem nenhum contato", `${money(life.spend)} investidos sem ${resultWord}. Confira o link e o anúncio.`)] };
    }
    if (lifeResults >= 5 && lifeCrm >= 3 && life.spend / lifeCrm <= benchCrm) {
      return { tone: "good", recommendations: [rec("good", "Começou bem — não mexa ainda", `Em aprendizado (${day}), já com ${lifeCrm} clientes no CRM.`)] };
    }
    return { tone: "neutral", label: "Aprendendo", recommendations: [rec("neutral", "Em aprendizado — não mexa", `A Meta ainda está aprendendo (${day}). Mexer agora reinicia o aprendizado.`)] };
  }

  const w7 = aggregateAdInsights(rows, { since: addDaysIso(today, -6), until: today }).values().next().value || { spend: 0, impressions: 0, clicks: 0, leads: 0, conversations: 0 };
  const crm7 = countDatesIn(crmDates, addDaysIso(today, -6), today);
  const results7 = resultsFor(kind, w7);
  const trend = adTrend({ kind, rows, crmDates, today });
  const ctr7 = w7.impressions > 0 ? (w7.clicks / w7.impressions) * 100 : null;
  const cpm7 = w7.impressions > 0 ? (w7.spend / w7.impressions) * 1000 : null;

  const causes = [];
  if (ctr7 !== null && w7.impressions >= 1000 && ctr7 < bench.ctrP25) causes.push("pouca gente clicando");
  if (cpm7 !== null && w7.impressions >= 1000 && cpm7 > 2 * bench.cpmAvg) causes.push("aparecer está caro");
  if (freq7 !== null && freq7 >= 3) causes.push(`as mesmas pessoas já viram ${DEC.format(freq7)} vezes`);
  const causeText = causes.length ? ` Provável causa: ${causes.join(", ")}.` : "";

  let main;
  let costRatio = null;
  // 2. Resultado no CRM manda quando há pelo menos 3 clientes nos 7 dias.
  if (crm7 >= 3) {
    const crmCost = w7.spend / crm7;
    costRatio = crmCost / benchCrm;
    const fact = `${money(crmCost)} por cliente no CRM (média da conta ${money(benchCrm)}).`;
    if (costRatio <= 0.8 && crm7 >= 5 && (freq7 === null || freq7 < 3.5)) {
      main = rec("good", "Vencedor", `${fact} Pode receber até 20% a mais de verba, duplicando o conjunto (decisão sua).`);
    } else if (costRatio <= 1.3) {
      main = rec("good", "Manter", `${fact}`);
    } else if (costRatio <= 1.8) {
      main = rec("warn", "Cliente saindo mais caro", `${fact}${causeText}`);
    } else {
      main = rec("bad", "Cliente caro demais", `${fact} Troque o criativo ou pause.${causeText}`);
    }
  } else if (crm7 === 0 && w7.spend >= 3 * benchCrm) {
    // 3. Sem cliente no CRM.
    const tracked = kind !== "cadastro" || countDatesIn(crmDates, addDaysIso(today, -29), today) > 0;
    main = tracked
      ? rec("bad", "Gastou sem trazer cliente", `${money(w7.spend)} em 7 dias e nenhum cliente no CRM.${causeText}`)
      : rec("neutral", "Sem rastreio no CRM", "Nenhum cadastro chegou com o código deste anúncio. Confira as UTMs do link.");
  } else {
    // 3b. Pouca amostra no CRM: custo por resultado da Meta, com tolerância maior.
    if (results7 === 0) {
      main = rec("neutral", "Poucos dados nos últimos 7 dias", "Ainda não dá para julgar pelo custo.");
    } else {
      const metaCost = w7.spend / results7;
      costRatio = metaCost / benchMeta;
      const fact = `${money(metaCost)} por ${resultWord} (média da conta ${money(benchMeta)}).`;
      if (costRatio <= 1.5) main = rec("good", "Manter", fact);
      else if (costRatio <= 2.5) main = rec("warn", "Custo por contato alto", `${fact}${causeText}`);
      else main = rec("bad", "Custo por contato muito alto", `${fact}${causeText}`);
    }
  }

  let note = null;
  // 4. Tendência.
  if (main.tone === "good" && trend.crmUp) {
    main = rec("warn", "Clientes ficando mais caros nos últimos dias", `${main.detail}${causeText}`);
  } else if ((trend.costUp || trend.ctrDrop) && trend.crmStable) {
    note = rec("neutral", "A Meta mostra queda, mas o CRM segue bem", "Custo ou cliques pioraram nos últimos 3 dias, sem afetar os clientes no CRM.");
  } else if ((trend.costUp || trend.ctrDrop) && main.tone === "good" && crm7 < 3) {
    main = rec("warn", "Desempenho caindo nos últimos dias", `${trend.costUp ? "O custo por contato subiu" : "Menos gente clicando"} nos últimos 3 dias.`);
  }

  // 5. Frequência: nunca muda a cor sozinha.
  if (freq7 !== null) {
    const costBad = costRatio !== null && costRatio > 1.3;
    if (freq7 >= 4 && costBad) {
      main = rec("bad", "Público saturado — troque o criativo", `As mesmas pessoas já viram ${DEC.format(freq7)} vezes e o custo subiu.`);
    } else if (freq7 >= 3 && (trend.ctrDrop || trend.costUp || costBad) && main.tone === "good") {
      main = rec("warn", "Público cansando — prepare criativo novo", `As mesmas pessoas já viram ${DEC.format(freq7)} vezes e o desempenho começou a cair.`);
    } else if (freq7 >= 3.5 && main.tone === "good" && !note) {
      note = rec("neutral", "Frequência alta", `As mesmas pessoas já viram ${DEC.format(freq7)} vezes. Tenha um criativo reserva.`);
    }
  }

  return { tone: main.tone, recommendations: note ? [main, note] : [main] };
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
