import { addDays, mondayOf } from "./alexa-v2/periods.mjs";
import { firstNameOf } from "./alexa-v2/text.mjs";
import { isSafeToSpeak } from "./alexa-v2/sanitize.mjs";
import { isAutomaticSimulationSource } from "./simulation-status-lock-core.mjs";
import { joinPt as joinPositive, positiveCount, prunePositiveFacts, zeroCount } from "./henry-reports-positive-core.mjs";

// Henry: períodos longos, relatório semanal/mensal, consulta de corretor e busca de cliente (pedido do dono, 2026-10-22 —
// docs/BUSINESS_RULES.md HENRY-1). Núcleo PURO (testável, sem banco): interpreta o período em datas civis de São Paulo e
// MONTA a resposta a partir dos números que as funções do CRM já calculam (getPerformanceOverview → slimOverview,
// getOwnerTeamDailyOverview → slimTeamGoal, leadOriginBreakdown do Início). Nenhuma métrica nova é definida aqui: só se
// escolhe o período, se compara com o anterior e se escreve a frase falada (curta) e o detalhe da tela (lista).

export const HENRY_PERIOD_IDS = [
  "hoje",
  "ontem",
  "esta_semana",
  "semana_passada",
  "ultimos_7_dias",
  "ultimos_15_dias",
  "ultimos_30_dias",
  "ultimos_90_dias",
  "este_mes",
  "mes_passado",
  "intervalo"
];

export const HENRY_MAX_RANGE_DAYS = 366;

const ROLLING = { ultimos_7_dias: 7, ultimos_15_dias: 15, ultimos_30_dias: 30, ultimos_90_dias: 90 };
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const plain = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

export function countDays(startDate, endDate) {
  return Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86400000) + 1;
}

function monthStart(dateKey) {
  return `${dateKey.slice(0, 7)}-01`;
}

function monthEnd(dateKey) {
  const [year, month] = dateKey.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${dateKey.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

export function shortDateBR(dateKey) {
  const [, month, day] = String(dateKey).split("-");
  return `${day}/${month}`;
}

function spokenDate(dateKey) {
  const [, month, day] = String(dateKey).split("-").map(Number);
  return `${day} de ${MONTHS[month - 1]}`;
}

// { periodo, inicio?, fim? } + hoje (AAAA-MM-DD, São Paulo) → { id, startDate, endDate, days, label, spoken }.
// Período desconhecido = hoje. Intervalo: datas invertidas são trocadas, fim nunca passa de hoje, no máximo 366 dias.
export function resolveHenryPeriod(input = {}, today) {
  const id = HENRY_PERIOD_IDS.includes(input?.periodo) ? input.periodo : "hoje";
  let startDate = today;
  let endDate = today;
  let label = "Hoje";
  let spoken = "hoje";
  if (id === "ontem") {
    startDate = addDays(today, -1);
    endDate = startDate;
    label = "Ontem";
    spoken = "ontem";
  } else if (id === "esta_semana") {
    startDate = mondayOf(today);
    label = "Esta semana";
    spoken = "nesta semana";
  } else if (id === "semana_passada") {
    startDate = addDays(mondayOf(today), -7);
    endDate = addDays(startDate, 6);
    label = "Semana passada";
    spoken = "na semana passada";
  } else if (ROLLING[id]) {
    startDate = addDays(today, -(ROLLING[id] - 1));
    label = `Últimos ${ROLLING[id]} dias`;
    spoken = `nos últimos ${ROLLING[id]} dias`;
  } else if (id === "este_mes") {
    startDate = monthStart(today);
    label = "Este mês";
    spoken = "neste mês";
  } else if (id === "mes_passado") {
    endDate = addDays(monthStart(today), -1);
    startDate = monthStart(endDate);
    label = "Mês passado";
    spoken = "no mês passado";
  } else if (id === "intervalo") {
    let start = isDateKey(input?.inicio) ? input.inicio : today;
    let end = isDateKey(input?.fim) ? input.fim : start;
    if (start > end) [start, end] = [end, start];
    if (end > today) end = today;
    if (start > end) start = end;
    if (countDays(start, end) > HENRY_MAX_RANGE_DAYS) start = addDays(end, -(HENRY_MAX_RANGE_DAYS - 1));
    startDate = start;
    endDate = end;
    label = startDate === endDate ? shortDateBR(startDate) : `${shortDateBR(startDate)} a ${shortDateBR(endDate)}`;
    spoken = startDate === endDate ? `em ${spokenDate(startDate)}` : `de ${spokenDate(startDate)} a ${spokenDate(endDate)}`;
  }
  return { id, startDate, endDate, days: countDays(startDate, endDate), label: `${label} (${shortDateBR(startDate)}${startDate === endDate ? "" : ` a ${shortDateBR(endDate)}`})`, spoken };
}

// Período anterior para a comparação: mês corrente → os mesmos dias do mês anterior; mês passado → o mês antes dele;
// qualquer outro → a mesma quantidade de dias logo antes.
export function previousHenryPeriod(range) {
  if (range.id === "este_mes") {
    const lastMonthEnd = addDays(range.startDate, -1);
    const start = monthStart(lastMonthEnd);
    const sameDay = addDays(start, range.days - 1);
    const end = sameDay > lastMonthEnd ? lastMonthEnd : sameDay;
    return { id: "intervalo", startDate: start, endDate: end, days: countDays(start, end) };
  }
  if (range.id === "mes_passado") {
    const end = addDays(range.startDate, -1);
    const start = monthStart(end);
    return { id: "intervalo", startDate: start, endDate: monthEnd(end), days: countDays(start, end) };
  }
  const end = addDays(range.startDate, -1);
  const start = addDays(end, -(range.days - 1));
  return { id: "intervalo", startDate: start, endDate: end, days: range.days };
}

const NUMBER_WORDS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, vinte: 20, trinta: 30,
  quarenta: 40, quarentaecinco: 45, sessenta: 60, noventa: 90, cem: 100, cento: 100
};

function wordNumber(token) {
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] || 0;
}

function parseDayMonth(text, today) {
  const match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : Number(today.slice(0, 4));
  if (year < 100) year += 2000;
  const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!isDateKey(key) || new Date(`${key}T12:00:00Z`).getUTCDate() !== day) return null;
  return !match[3] && key > today ? `${year - 1}${key.slice(4)}` : key;
}

function rollingInput(days, today) {
  const key = { 7: "ultimos_7_dias", 15: "ultimos_15_dias", 30: "ultimos_30_dias", 90: "ultimos_90_dias" }[days];
  if (key) return { periodo: key };
  const n = Math.max(1, Math.min(HENRY_MAX_RANGE_DAYS, days));
  return { periodo: "intervalo", inicio: addDays(today, -(n - 1)), fim: today };
}

// Texto falado → { periodo, inicio?, fim? } (ou null quando não fala de período). Usado quando o modelo não manda o
// período e nos testes. "Relatório semanal" = últimos 7 dias; "mensal" = últimos 30 dias (os dois comparados com a
// janela anterior do mesmo tamanho); "semana passada"/"mês passado"/"este mês" valem como foram ditos.
export function henryPeriodFromText(text, today) {
  const value = plain(text);
  if (!value) return null;
  const range = /\bde (\d{1,2}\/\d{1,2}(?:\/\d{2,4})?) (?:a|ate) (\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/.exec(value);
  if (range) {
    const inicio = parseDayMonth(range[1], today);
    const fim = parseDayMonth(range[2], today);
    if (inicio && fim) return { periodo: "intervalo", inicio, fim };
  }
  const rolling = /\bult(?:imos|imas) (\d+|[a-z]+) (dias|semanas|meses)\b/.exec(value);
  if (rolling) {
    const n = wordNumber(rolling[1]);
    if (n) return rollingInput(rolling[2] === "dias" ? n : rolling[2] === "semanas" ? n * 7 : n * 30, today);
  }
  if (/\btrimestre\b/.test(value)) return { periodo: "ultimos_90_dias" };
  if (/\bsemana (passada|anterior)\b/.test(value)) return { periodo: "semana_passada" };
  if (/\bmes (passado|anterior)\b/.test(value)) return { periodo: "mes_passado" };
  if (/\bultima semana\b/.test(value)) return { periodo: "ultimos_7_dias" };
  if (/\bultimo mes\b/.test(value)) return { periodo: "ultimos_30_dias" };
  if (/\b(esta|essa|nesta|nessa) semana\b/.test(value)) return { periodo: "esta_semana" };
  if (/\b(este|esse|neste|nesse) mes\b/.test(value)) return { periodo: "este_mes" };
  if (/\bsemanal\b/.test(value)) return { periodo: "ultimos_7_dias" };
  if (/\bmensal\b/.test(value)) return { periodo: "ultimos_30_dias" };
  if (/\bontem\b/.test(value)) return { periodo: "ontem" };
  if (/\bhoje\b/.test(value)) return { periodo: "hoje" };
  return null;
}

// "relatorio semanal" / "mensal" / período livre → tipo do relatório (título da tela e narração).
export function henryReportKind(input = {}, range) {
  if (input?.tipo === "semanal" || input?.tipo === "mensal") return input.tipo;
  if (["esta_semana", "semana_passada", "ultimos_7_dias"].includes(range?.id)) return "semanal";
  if (["este_mes", "mes_passado", "ultimos_30_dias"].includes(range?.id)) return "mensal";
  return "periodo";
}

// --- Montagem ---------------------------------------------------------------------------------------------------------
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const has = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function joinPt(parts) {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

export function deltaText(current, previous) {
  if (!has(previous)) return "";
  const cur = num(current);
  const prev = num(previous);
  if (cur === prev) return "igual";
  if (!prev) return `antes 0`;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct > 0 ? "+" : ""}${pct}% (antes ${prev})`;
}

function trendWord(current, previous) {
  if (!has(previous)) return "";
  const cur = num(current);
  const prev = num(previous);
  if (cur === prev) return "ficaram iguais";
  if (!prev) return "subiram";
  const pct = Math.round(Math.abs(((cur - prev) / prev) * 100));
  return cur > prev ? `subiram ${pct}%` : `caíram ${pct}%`;
}

export function funnelOf(overview) {
  if (!overview?.metrics) return null;
  return {
    atendimento: num(overview.metrics.service),
    simulacao: num(overview.metrics.simulation),
    documentacao: num(overview.funnel?.documentation),
    enviadosAprovacao: num(overview.metrics.approvalPending),
    aprovados: num(overview.metrics.approval),
    vendas: num(overview.metrics.sale),
    prospeccao: num(overview.metrics.prospecting),
    novosClientes: num(overview.metrics.newClients)
  };
}

// data = {
//   kind, range, previousRange,
//   overview, previousOverview (slimOverview), teamGoal (slimTeamGoal | null), leads, previousLeads (leadOriginBreakdown | null),
//   awaitingReply, cooledPending (números de AGORA, ou null se a fonte falhou)
// }
// → { facts (para o modelo), spoken (3 a 5 frases), detail (tela: seções com linhas) }. Fonte que falhou = fora da frase e
// "indisponível" na tela (nunca um zero falso).
// positive (padrão; REGRA OFICIAL, dono 2026-10-24 — resumo positivo): a fala e os números do modelo só trazem o que foi
// bom (sem zero, sem aguardando/frios, só tendência de alta); nada de bom → slowDayPhrase (frase de ânimo) e weak = true.
// positive: false = pergunta direta de uma métrica (o número sai, inclusive zero). A tela (detail) é a mesma nos dois.
export function buildHenryPeriodReport(data = {}) {
  const { kind = "periodo", range, previousRange } = data;
  const funnel = funnelOf(data.overview);
  const previousFunnel = funnelOf(data.previousOverview);
  const leads = data.leads || null;
  const previousLeads = data.previousLeads || null;
  const ranking = (data.overview?.ranking || []).filter((row) => num(row.points) > 0);
  const meta = data.teamGoal?.summary || null;
  const metaBrokers = [...(data.teamGoal?.brokers || [])].filter((row) => num(row.total) > 0).sort((a, b) => num(b.percent) - num(a.percent));
  const attention = data.overview?.attention || null;
  const positive = data.positive !== false;

  const spokenParts = [];
  const opening = range?.spoken ? range.spoken[0].toLocaleUpperCase("pt-BR") + range.spoken.slice(1) : "No período";
  if (positive) spokenParts.push(...positivePeriodSentences({ opening, leads, previousLeads, funnel, previousFunnel, ranking, meta }));
  else if (leads) {
    const origins = [];
    if (leads.ad) origins.push(`${leads.ad} de anúncio`);
    if (leads.marketplace) origins.push(`${leads.marketplace} do Marketplace`);
    spokenParts.push(leads.total ? `${opening} entraram ${plural(leads.total, "lead", "leads")}${origins.length ? `, ${joinPt(origins)}` : ""}.` : `${opening} não entrou nenhum lead.`);
  }
  if (!positive && funnel) {
    spokenParts.push(
      `No funil, ${plural(funnel.atendimento, "atendimento", "atendimentos")}, ${plural(funnel.simulacao, "simulação", "simulações")}, ${plural(funnel.documentacao, "documentação", "documentações")}, ${plural(funnel.aprovados, "aprovado", "aprovados")} e ${plural(funnel.vendas, "venda", "vendas")}.`
    );
  }
  const leader = ranking[0];
  const rankingSentence = leader ? `${firstNameOf(leader.name)} lidera o ranking com ${plural(num(leader.points), "ponto", "pontos")}` : "";
  const metaSentence = meta && num(meta.atividadesTotal) > 0 ? `a Meta Diária da equipe ficou em ${num(meta.metaPercent)}%` : "";
  if (!positive && (rankingSentence || metaSentence)) {
    const text = [rankingSentence, metaSentence].filter(Boolean).join(", e ");
    spokenParts.push(`${text[0].toLocaleUpperCase("pt-BR")}${text.slice(1)}.`);
  }
  const now = [];
  if (has(data.awaitingReply)) now.push(plural(num(data.awaitingReply), "cliente aguardando resposta", "clientes aguardando resposta"));
  if (has(data.cooledPending) && num(data.cooledPending) > 0) now.push(plural(num(data.cooledPending), "caso de cliente frio para você decidir", "casos de clientes frios para você decidir"));
  if (!positive && now.length) spokenParts.push(`Agora há ${joinPt(now)}.`);
  const trends = [];
  if (!positive && leads && previousLeads) trends.push(`os leads ${trendWord(leads.total, previousLeads.total)}`);
  if (!positive && funnel && previousFunnel) trends.push(`as vendas ${trendWord(funnel.vendas, previousFunnel.vendas)}`);
  if (trends.length) spokenParts.push(`Comparado ao período anterior, ${joinPt(trends)}.`);
  const weak = positive && !spokenParts.length;
  if (weak && data.slowDayPhrase) spokenParts.push(String(data.slowDayPhrase));

  const title = kind === "semanal" ? "Relatório semanal" : kind === "mensal" ? "Relatório mensal" : "Relatório do período";
  const unavailable = [{ label: "Indisponível agora", value: "—" }];
  const sections = [];
  sections.push({
    title: "Leads por origem",
    rows: leads
      ? [
          { label: "Total", value: String(leads.total), note: previousLeads ? deltaText(leads.total, previousLeads.total) : "" },
          { label: "Anúncio", value: String(num(leads.ad)) },
          { label: "Marketplace", value: String(num(leads.marketplace)) },
          { label: "Outras origens", value: String(num(leads.other)) }
        ]
      : unavailable
  });
  sections.push({
    title: "Funil",
    rows: funnel
      ? [
          ["Atendimento", "atendimento"],
          ["Simulação", "simulacao"],
          ["Documentação", "documentacao"],
          ["Enviados para aprovação", "enviadosAprovacao"],
          ["Aprovados", "aprovados"],
          ["Vendas", "vendas"]
        ].map(([label, key]) => ({ label, value: String(funnel[key]), note: previousFunnel ? deltaText(funnel[key], previousFunnel[key]) : "" }))
      : unavailable
  });
  sections.push({
    title: "Ranking e pontuação",
    rows: data.overview ? (ranking.length ? ranking.slice(0, 10).map((row, index) => ({ label: `${index + 1}º ${firstNameOf(row.name)}`, value: `${num(row.points)} pts` })) : [{ label: "Ninguém pontuou no período", value: "0" }]) : unavailable
  });
  sections.push({
    title: "Meta Diária",
    rows: meta
      ? [
          { label: "Equipe", value: `${num(meta.metaPercent)}%`, note: `${num(meta.atividadesDone)} de ${num(meta.atividadesTotal)} atividades` },
          ...metaBrokers.slice(0, 12).map((row) => ({ label: firstNameOf(row.name), value: `${num(row.percent)}%` }))
        ]
      : unavailable
  });
  sections.push({
    title: "Atenção agora",
    rows: [
      { label: "Clientes aguardando resposta", value: has(data.awaitingReply) ? String(num(data.awaitingReply)) : "—" },
      { label: "Clientes frios para você decidir", value: has(data.cooledPending) ? String(num(data.cooledPending)) : "—" },
      { label: "Sem contato há mais de 3 dias", value: attention ? String(num(attention.staleContact)) : "—" },
      { label: "Aguardando ação do corretor", value: attention ? String(num(attention.awaitingAction)) : "—" }
    ]
  });
  if (previousRange && (previousFunnel || previousLeads)) {
    sections.push({
      title: `Comparação com ${shortDateBR(previousRange.startDate)} a ${shortDateBR(previousRange.endDate)}`,
      rows: [
        ...(leads && previousLeads ? [{ label: "Leads", value: String(leads.total), note: deltaText(leads.total, previousLeads.total) }] : []),
        ...(funnel && previousFunnel
          ? [
              { label: "Prospecção", value: String(funnel.prospeccao), note: deltaText(funnel.prospeccao, previousFunnel.prospeccao) },
              { label: "Atendimentos", value: String(funnel.atendimento), note: deltaText(funnel.atendimento, previousFunnel.atendimento) },
              { label: "Simulações", value: String(funnel.simulacao), note: deltaText(funnel.simulacao, previousFunnel.simulacao) },
              { label: "Aprovados", value: String(funnel.aprovados), note: deltaText(funnel.aprovados, previousFunnel.aprovados) },
              { label: "Vendas", value: String(funnel.vendas), note: deltaText(funnel.vendas, previousFunnel.vendas) }
            ]
          : [])
      ]
    });
  }

  const facts = {
    periodo: range?.label || "",
    leads: leads ? { total: leads.total, anuncio: num(leads.ad), marketplace: num(leads.marketplace), outras: num(leads.other) } : "indisponível",
    funil: funnel || "indisponível",
    ranking: data.overview ? ranking.slice(0, 5).map((row) => ({ nome: firstNameOf(row.name), pontos: num(row.points) })) : "indisponível",
    meta_diaria_equipe: meta ? `${num(meta.metaPercent)}%` : "indisponível",
    agora: { aguardando_resposta: has(data.awaitingReply) ? num(data.awaitingReply) : "indisponível", esfriados_para_decidir: has(data.cooledPending) ? num(data.cooledPending) : "indisponível" },
    periodo_anterior: previousFunnel || previousLeads ? { leads: previousLeads?.total ?? "indisponível", funil: previousFunnel || "indisponível" } : "indisponível"
  };
  // Cena "comparativo" do Henry (barras lado a lado): os MESMOS números da seção de comparação, já prontos; sem período
  // anterior (ou fonte que falhou) → null e a cena usa os números da fala.
  const chartRows = [];
  if (leads && previousLeads) chartRows.push({ label: "Leads", current: num(leads.total), previous: num(previousLeads.total) });
  if (funnel && previousFunnel) {
    for (const [label, key] of [["Atendimentos", "atendimento"], ["Simulações", "simulacao"], ["Aprovados", "aprovados"], ["Vendas", "vendas"]]) {
      chartRows.push({ label, current: num(funnel[key]), previous: num(previousFunnel[key]) });
    }
  }
  const chart = chartRows.length && previousRange
    ? { currentLabel: range?.label || "Período", previousLabel: `${shortDateBR(previousRange.startDate)} a ${shortDateBR(previousRange.endDate)}`, rows: chartRows }
    : null;
  return { facts: positive ? prunePositiveFacts(facts) : facts, spoken: spokenParts.slice(0, 5).join(" "), detail: { title, subtitle: range?.label || "", sections }, chart, weak };
}

// Frases do resumo positivo do período: só o que passou de zero; tendência só quando subiu.
function positivePeriodSentences({ opening, leads, previousLeads, funnel, previousFunnel, ranking, meta }) {
  const parts = [];
  if (leads && num(leads.total) > 0) {
    const origins = [];
    if (num(leads.ad) > 0) origins.push(`${num(leads.ad)} de anúncio`);
    if (num(leads.marketplace) > 0) origins.push(`${num(leads.marketplace)} do Marketplace`);
    const total = positiveCount(num(leads.total), "lead", "leads");
    parts.push(`${opening} ${num(leads.total) === 1 ? "entrou" : "entraram"} ${total}${origins.length ? `, ${joinPositive(origins)}` : ""}.`);
  }
  if (funnel) {
    const items = [
      positiveCount(funnel.novosClientes, "cliente novo", "clientes novos"),
      positiveCount(funnel.atendimento, "atendimento", "atendimentos"),
      positiveCount(funnel.simulacao, "simulação", "simulações"),
      positiveCount(funnel.documentacao, "cliente em documentação", "clientes em documentação"),
      positiveCount(funnel.aprovados, "aprovado", "aprovados"),
      positiveCount(funnel.vendas, "venda", "vendas")
    ].filter(Boolean);
    if (items.length) parts.push(`Foram ${joinPositive(items)}.`);
  }
  const leader = ranking[0];
  const rankingSentence = leader ? `${firstNameOf(leader.name)} lidera o ranking com ${positiveCount(num(leader.points), "ponto", "pontos")}` : "";
  const metaSentence = meta && num(meta.atividadesTotal) > 0 && num(meta.metaPercent) > 0 ? `a Meta Diária da equipe ficou em ${num(meta.metaPercent)}%` : "";
  if (rankingSentence || metaSentence) {
    const text = [rankingSentence, metaSentence].filter(Boolean).join(", e ");
    parts.push(`${text[0].toLocaleUpperCase("pt-BR")}${text.slice(1)}.`);
  }
  const ups = [];
  if (leads && previousLeads && num(leads.total) > num(previousLeads.total)) ups.push(`os leads ${trendWord(leads.total, previousLeads.total)}`);
  if (funnel && previousFunnel && funnel.vendas > previousFunnel.vendas) ups.push(`as vendas ${trendWord(funnel.vendas, previousFunnel.vendas)}`);
  if (ups.length) parts.push(`Comparado ao período anterior, ${joinPositive(ups)}.`);
  return parts;
}

// Métrica única pedida ("quantos clientes o Gabriel atendeu hoje?" → só atendimentos). Dono, 2026-10-22: "quando eu
// pergunto uma informação, ele passa outras que não são relevantes" — com `metrica`, o modelo recebe SÓ esse número.
export const HENRY_BROKER_METRICS = Object.freeze({
  atendimentos: { field: "service", one: "atendimento", many: "atendimentos" },
  simulacoes: { field: "simulation", one: "simulação", many: "simulações" },
  documentacao: { field: "documentation", one: "cliente em documentação", many: "clientes em documentação" },
  enviados_aprovacao: { field: "approvalPending", one: "enviado para aprovação", many: "enviados para aprovação" },
  aprovados: { field: "approval", one: "aprovado", many: "aprovados" },
  vendas: { field: "sale", one: "venda", many: "vendas" },
  pontos: { field: "points", one: "ponto", many: "pontos" },
  novos_clientes: { field: "newClients", one: "cliente novo", many: "clientes novos" },
  prospeccao: { field: "prospecting", one: "prospecção", many: "prospecções" },
  ranking: { special: "ranking" },
  meta: { special: "meta" }
});
export const HENRY_BROKER_METRIC_IDS = Object.keys(HENRY_BROKER_METRICS);

function focusedBrokerReport({ metric, name, range, row, metaRow, rankingIndex }) {
  const spec = HENRY_BROKER_METRICS[metric];
  const when = range?.spoken || "no período";
  if (spec.special === "ranking") {
    const position = rankingIndex >= 0 ? rankingIndex + 1 : null;
    return {
      facts: { corretor: name, periodo: range?.label || "", posicao_ranking: position ?? "fora do ranking" },
      spoken: position ? `${name} está em ${position}º no ranking ${when}.` : `${name} não aparece no ranking ${when}.`,
      stats: position ? [{ label: "no ranking", value: `${position}º` }] : []
    };
  }
  if (spec.special === "meta") {
    const has = metaRow && num(metaRow.total) > 0;
    return {
      facts: { corretor: name, periodo: range?.label || "", meta_diaria: has ? `${num(metaRow.percent)}%` : "sem meta no período" },
      spoken: has ? `A Meta Diária ${name === "O corretor" ? "dele" : `de ${name}`} ficou em ${num(metaRow.percent)}% ${when}.` : `${name} não teve Meta Diária ${when}.`,
      stats: has ? [{ label: "meta", value: `${num(metaRow.percent)}%` }] : []
    };
  }
  const value = row ? num(row[spec.field]) : null;
  return {
    facts: { corretor: name, periodo: range?.label || "", [metric]: value ?? "sem números deste corretor no período" },
    // Pergunta direta: o número sai, inclusive zero ("Gabriel não teve nenhuma simulação hoje." — dono, 2026-10-24).
    spoken: value === null ? `Não achei números de ${name} ${when}.` : value === 0 ? `${name} não teve ${zeroCount(spec.one)} ${when}.` : `${name} teve ${plural(value, spec.one, spec.many)} ${when}.`,
    stats: value === null ? [] : [{ label: spec.many, value: String(value) }]
  };
}

// Um corretor no período: as linhas DELE no Desempenho (slimOverview.team) e na Meta (slimTeamGoal.brokers), posição no
// ranking. stats = 1 ou 2 números para o cardzinho da cena. metric = só um indicador (fala e números só dele; o detalhe
// completo continua na tela).
// positive (padrão, resumo do corretor — dono, 2026-10-24): a fala só traz o que passou de zero; nada → slowDayPhrase e
// weak = true. positive: false = fala completa (pergunta direta sem métrica reconhecida). Com metric = pergunta direta.
export function buildHenryBrokerReport({ broker, range, overview, teamGoal, metric = "", positive = true, slowDayPhrase = "" } = {}) {
  const row = (overview?.team || []).find((item) => item.id === broker?.id) || null;
  const metaRow = (teamGoal?.brokers || []).find((item) => item.id === broker?.id) || null;
  const rankingIndex = (overview?.ranking || []).findIndex((item) => item.id === broker?.id);
  const name = firstNameOf(broker?.name) || "O corretor";
  const spokenParts = [];
  if (row && positive) {
    const items = [
      positiveCount(num(row.service), "atendimento", "atendimentos"),
      positiveCount(num(row.simulation), "simulação", "simulações"),
      positiveCount(num(row.approval), "aprovado", "aprovados"),
      positiveCount(num(row.sale), "venda", "vendas")
    ].filter(Boolean);
    if (items.length) spokenParts.push(`${name} ${range?.spoken || "no período"}: ${joinPositive(items)}.`);
    if (num(row.points) > 0) spokenParts.push(`${items.length ? "Fez" : `${name} fez`} ${positiveCount(num(row.points), "ponto", "pontos")}${rankingIndex >= 0 ? ` e está em ${rankingIndex + 1}º no ranking` : ""}.`);
  } else if (row) {
    spokenParts.push(
      `${name} ${range?.spoken || "no período"}: ${plural(num(row.service), "atendimento", "atendimentos")}, ${plural(num(row.simulation), "simulação", "simulações")}, ${plural(num(row.approval), "aprovado", "aprovados")} e ${plural(num(row.sale), "venda", "vendas")}.`
    );
    spokenParts.push(`Fez ${plural(num(row.points), "ponto", "pontos")}${rankingIndex >= 0 ? ` e está em ${rankingIndex + 1}º no ranking` : ""}.`);
  }
  if (metaRow && num(metaRow.total) > 0 && (!positive || num(metaRow.percent) > 0)) spokenParts.push(`A Meta Diária ${positive && !spokenParts.length ? `de ${name} ` : ""}ficou em ${num(metaRow.percent)}%.`);
  const weak = positive && Boolean(row) && !spokenParts.length;
  if (weak && slowDayPhrase) spokenParts.push(String(slowDayPhrase));
  const stats = [];
  if (row) stats.push({ label: "pontos", value: String(num(row.points)) });
  if (metaRow && num(metaRow.total) > 0) stats.push({ label: "meta", value: `${num(metaRow.percent)}%` });
  else if (row) stats.push({ label: "vendas", value: String(num(row.sale)) });
  const rows = row
    ? [
        ["Novos clientes", row.newClients],
        ["Prospecção", row.prospecting],
        ["Atendimento", row.service],
        ["Simulação", row.simulation],
        ["Documentação", row.documentation],
        ["Enviados para aprovação", row.approvalPending],
        ["Aprovados", row.approval],
        ["Vendas", row.sale],
        ["Pontos", row.points],
        ["Atividades concluídas", row.completedActivities],
        ["Atividades atrasadas (agora)", row.overdueActivities],
        ["Sem contato há mais de 3 dias (agora)", row.staleContact]
      ].map(([label, value]) => ({ label, value: String(num(value)) }))
    : [{ label: "Sem números deste corretor no período", value: "—" }];
  if (rankingIndex >= 0) rows.push({ label: "Posição no ranking", value: `${rankingIndex + 1}º` });
  if (metaRow && num(metaRow.total) > 0) rows.push({ label: "Meta Diária", value: `${num(metaRow.percent)}%`, note: `${num(metaRow.done)} de ${num(metaRow.total)}` });
  // Posição no ranking do período (selo do card na cena) só quando a pergunta envolve ranking/pontos ou é o resumo.
  const position = rankingIndex >= 0 && (!metric || metric === "ranking" || metric === "pontos") ? rankingIndex + 1 : null;
  const withPosition = position ? { position } : {};
  if (HENRY_BROKER_METRICS[metric]) {
    const focused = focusedBrokerReport({ metric, name, range, row, metaRow, rankingIndex });
    return { ...focused, ...withPosition, detail: { title: name, subtitle: range?.label || "", sections: [{ title: "No período", rows }] } };
  }
  const fullFacts = row
      ? { corretor: name, periodo: range?.label || "", atendimentos: num(row.service), simulacoes: num(row.simulation), documentacao: num(row.documentation), aprovados: num(row.approval), vendas: num(row.sale), pontos: num(row.points), posicao_ranking: rankingIndex >= 0 ? rankingIndex + 1 : "fora do ranking", meta_diaria: metaRow && num(metaRow.total) > 0 ? `${num(metaRow.percent)}%` : "sem meta no período" }
      : { corretor: name, periodo: range?.label || "", aviso: "sem números deste corretor no período" };
  return {
    ...withPosition,
    facts: positive && row ? prunePositiveFacts(fullFacts) : fullFacts,
    weak,
    spoken: spokenParts.join(" "),
    stats: stats.slice(0, 2),
    detail: { title: name, subtitle: range?.label || "", sections: [{ title: "No período", rows }] }
  };
}

// --- Clientes (pedido do dono, 2026-10-23: "pedi o status de 3 clientes e ele disse que não consegue") --------------------
// buscar_clientes: VÁRIOS nomes/telefones de uma vez; para cada um, etapa, responsável, último atendimento, próxima
// atividade, simulação (feita/enviada), documentos, CCA, origem e as 3 últimas movimentações — tudo pelas MESMAS fontes da
// ficha (lida em lib/henry-reports.js). Só leitura. Nunca CPF/documento; telefone só com withPhone e só na TELA (a voz
// nunca fala telefone: a barreira safeHenryReply derruba a frase). Vários com o mesmo nome → até 3 opções e a pergunta.
export const HENRY_MAX_CLIENT_QUERIES = 6;
export const HENRY_CLIENT_ROWS_PER_QUERY = 6;
export const HENRY_CLIENT_OPTIONS = 3;

export function sanitizeClientSearchTerm(value) {
  return String(value || "")
    .replace(/[,()*%_\\]/g, " ")
    .replace(/\d/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

const phoneDigits = (value) => String(value || "").replace(/\D/g, "");

// Entrada do modelo → consultas { kind: "name"|"phone", term, label, broker }. Aceita { clientes: [{ nome, telefone,
// corretor }] } e o formato antigo { nome }. Nome com 8+ dígitos é telefone. Sem repetição, no máximo 6.
export function henryClientQueries(input = {}) {
  const items = Array.isArray(input?.clientes) ? input.clientes : input?.nome || input?.telefone ? [input] : [];
  const out = [];
  const seen = new Set();
  for (const item of items.slice(0, HENRY_MAX_CLIENT_QUERIES * 2)) {
    const raw = typeof item === "string" ? { nome: item } : item || {};
    const digits = phoneDigits(raw.telefone) || (phoneDigits(raw.nome).length >= 8 ? phoneDigits(raw.nome) : "");
    const broker = sanitizeClientSearchTerm(raw.corretor).slice(0, 40);
    const query = digits.length >= 8
      ? { kind: "phone", term: digits.slice(-13), label: "esse telefone", broker }
      : { kind: "name", term: sanitizeClientSearchTerm(raw.nome), label: sanitizeClientSearchTerm(raw.nome), broker };
    if (query.kind === "name" && query.term.length < 2) continue;
    const key = `${query.kind}:${plain(query.term)}:${plain(broker)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(query);
    if (out.length >= HENRY_MAX_CLIENT_QUERIES) break;
  }
  return out;
}

// Quais linhas valem para a consulta: filtro pelo corretor dito ("o da Carol" casa Carolina, pelo começo do nome); nome completo igual a um só → ele.
export function pickClientMatches(query, rows = [], brokerName = () => "") {
  let list = Array.isArray(rows) ? rows : [];
  if (query?.broker) {
    const wanted = plain(query.broker).split(" ")[0];
    const filtered = wanted.length < 3 ? [] : list.filter((row) => plain(brokerName(row.responsible_user_id)).split(" ").some((word) => word.startsWith(wanted)));
    if (filtered.length) list = filtered;
  }
  if (query?.kind === "name" && list.length > 1) {
    const exact = list.filter((row) => plain(row.full_name) === plain(query.term));
    if (exact.length === 1) return exact;
  }
  return list;
}

// Etapa na VOZ: a etiqueta da tela, salvo quando ela tem palavra que a barreira da fala derruba ("Comprometimento de
// renda") — aí a fala diz que a etapa está na tela (antes a resposta INTEIRA virava "Não posso falar isso por voz").
export function speakableStage(label, isSafe = isSafeToSpeak) {
  const value = String(label || "").trim();
  return value && isSafe(value) ? `em ${value}` : "numa etapa que deixei na tela";
}

// Simulação: real (com valor, não automática) / automática / rascunho; "enviada" vem da prova única (FUN-13).
export function describeSimulation({ rows = [], sent = null, isAutomatic = isAutomaticSimulationSource } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const real = list.some((row) => !isAutomatic(row?.created_by) && (Number(row?.financing_value || 0) > 0 || Number(row?.subsidy_value || 0) > 0));
  const auto = list.some((row) => isAutomatic(row?.created_by));
  const sentText = sent === true ? "enviada" : sent === false ? "ainda não enviada" : "envio não conferido";
  if (real) return `Feita, ${sentText}`;
  if (auto) return `Automática do site, ${sentText}`;
  return list.length ? "Só rascunho, sem valores" : "Sem simulação";
}

// Documentos: o lote mais recente (status do lote + contagem do checklist que a análise já gravou).
export function describeDocuments(batch) {
  if (!batch) return "Nenhum documento enviado";
  const files = Number(batch.total_files) || 0;
  const filesText = files ? `${plural(files, "arquivo", "arquivos")}, ` : "";
  if (batch.status === "uploading" || batch.status === "processing") return `${filesText}análise em andamento`;
  if (batch.status === "failed") return `${filesText}a análise falhou`;
  if (batch.analysisSkipped === true && batch.status !== "analyzed") return `${filesText}guardados sem análise da IA`;
  if (batch.status === "analyzed") {
    const problems = ["pending", "illegible", "divergence", "needsConfirmation"].reduce((sum, key) => sum + (Number(batch[key]) || 0), 0);
    const conform = Number(batch.conform) || 0;
    return `${filesText}${plural(conform, "conforme", "conformes")}${problems ? ` e ${plural(problems, "com pendência", "com pendência")}` : ", sem pendência"}`;
  }
  return `${filesText}recebidos`;
}

// Análise da CCA: a passagem aberta (client_cca_status_history, getCurrentCcaStatus).
export function describeCca(entry, formatDate = (value) => value) {
  if (!entry) return "Não enviado à CCA";
  const name = entry.cca?.name || "CCA";
  const stage = entry.status?.label ? ` — ${entry.status.label}` : "";
  return `${name}${stage}${entry.enteredAt ? ` desde ${formatDate(entry.enteredAt)}` : ""}`;
}

// Em qual WhatsApp está a conversa (dono, 2026-10-24: "ela está no número da API oficial ou no meu pessoal?"). channels =
// listClientChatChannels (lib/whatsapp-chat.js — escopo e canal do Chat, mais recente primeiro). viewerId = quem pergunta
// (o "seu" pessoal). Sem telefone. null = não conferido (falhou), [] = sem conversa no Chat.
export function describeChatChannels(channels, { viewerId = "", formatDate = (value) => value } = {}) {
  if (!Array.isArray(channels)) return { onde: "não conferido", conversas: [], text: "não conferido" };
  if (!channels.length) return { onde: "sem conversa no Chat", conversas: [], text: "Sem conversa no Chat" };
  const label = (item) => {
    if (item.official) return "número oficial";
    const number = item.numberLabel || `Número ${item.slot === 2 ? 2 : 1}`;
    if (viewerId && item.ownerId === viewerId) return `seu WhatsApp pessoal (${number})`;
    return `WhatsApp pessoal de ${firstNameOf(item.ownerName) || "um corretor"} (${number})`;
  };
  const fromWhom = (item) => {
    if (item.lastMessageDirection === "inbound") return "do cliente";
    if (item.lastMessageDirection === "outbound") return !item.official && viewerId && item.ownerId === viewerId ? "sua" : "da equipe";
    return "";
  };
  const conversas = channels.map((item) => {
    const who = fromWhom(item);
    const when = item.lastMessageAt ? formatDate(item.lastMessageAt) : "";
    return { canal: label(item), ultima_mensagem: when || "sem mensagem", de_quem: who || "não registrado" };
  });
  const places = [...new Set(conversas.map((item) => item.canal))];
  const onde = places.length === 1 ? `no ${places[0]}` : `em ${places.length} WhatsApps: ${places.map((place) => `no ${place}`).join(" e ")}`;
  const text = conversas.map((item) => `${item.canal[0].toLocaleUpperCase("pt-BR")}${item.canal.slice(1)}${item.ultima_mensagem !== "sem mensagem" ? ` — última mensagem ${item.de_quem !== "não registrado" ? `${item.de_quem} ` : ""}${item.ultima_mensagem}` : ""}`).join("; ");
  return { onde, conversas, text };
}

const sentenceCase = (title) => {
  const text = String(title || "").toLocaleLowerCase("pt-BR").replace(/\bcca\b/g, "CCA");
  return text ? text[0].toLocaleUpperCase("pt-BR") + text.slice(1) : "";
};

// Uma consulta de cliente → bloco da tela + fatos (modelo) + frase (voz). detail(row) = dados já lidos daquele cliente.
function clientBlock(row, info = {}, { statusLabel, brokerName, formatDate, withPhone, isSafe }) {
  const firstName = firstNameOf(row.full_name) || "Cliente";
  const stage = statusLabel(row.status) || "—";
  const broker = brokerName(row.responsible_user_id) || "sem responsável";
  const brokerFirst = firstNameOf(broker) || broker;
  const lastContact = info.lastContactAt ? formatDate(info.lastContactAt) : "sem contato registrado";
  const next = info.nextActivity ? `${info.nextActivity.title || "Atividade"} — ${formatDate(info.nextActivity.at)}${info.nextActivity.overdue ? " (atrasada)" : ""}` : "nenhuma";
  const movements = (info.events || []).slice(0, 3);
  const facts = {
    primeiro_nome: firstName,
    etapa: stage,
    etapa_falada: speakableStage(stage, isSafe),
    responsavel: brokerFirst,
    ultimo_contato: lastContact,
    proxima_atividade: next,
    simulacao: info.simulation || "não conferida",
    documentos: info.documents || "não conferidos",
    cca: info.cca || "não conferida",
    origem: info.origin || "não registrada",
    whatsapp: info.chat ? { onde: info.chat.onde, conversas: info.chat.conversas } : { onde: "não conferido", conversas: [] },
    ultimas_movimentacoes: movements.map((event) => `${sentenceCase(event.title)}${event.at ? ` (${formatDate(event.at)})` : ""}`)
  };
  const rows = [
    { label: "Etapa", value: stage, note: row.last_status_change_at ? `desde ${formatDate(row.last_status_change_at)}` : "" },
    { label: "Responsável", value: broker },
    { label: "Último contato", value: lastContact },
    { label: "Próxima atividade", value: next },
    { label: "Simulação", value: facts.simulacao },
    { label: "Documentos", value: facts.documentos },
    { label: "Análise CCA", value: facts.cca },
    { label: "Origem", value: facts.origem },
    { label: "WhatsApp", value: info.chat?.text || "não conferido" },
    ...movements.map((event) => ({ label: sentenceCase(event.title), value: event.description || "", note: event.at ? formatDate(event.at) : "" })),
    ...(withPhone && row.phone ? [{ label: "Telefone", value: String(row.phone) }] : [])
  ];
  const spoken = `${firstName} está ${facts.etapa_falada}, com ${brokerFirst}; último contato ${lastContact}.`;
  return { facts, spoken, section: { title: String(row.full_name || firstName).trim(), rows } };
}

function optionOf(row, { statusLabel, brokerName, isSafe }) {
  const parts = String(row.full_name || "").trim().split(/\s+/);
  const first = firstNameOf(row.full_name) || "Cliente";
  const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1].charAt(0).toLocaleUpperCase("pt-BR")}.` : "";
  const broker = firstNameOf(brokerName(row.responsible_user_id)) || "sem responsável";
  const stage = statusLabel(row.status) || "";
  return { nome: `${first}${lastInitial}`, corretor: broker, etapa: stage, falado: `${first}${lastInitial}, com ${broker}, ${speakableStage(stage, isSafe)}` };
}

export function buildHenryClientsReport({ results = [], statusLabel = (value) => value, brokerName = () => "", formatDate = (value) => value, withPhone = false, isSafe = isSafeToSpeak } = {}) {
  const ctx = { statusLabel, brokerName, formatDate, withPhone, isSafe };
  const facts = [];
  const spokenFound = [];
  const spokenMissing = [];
  const spokenAsk = [];
  const sections = [];
  for (const { query, rows = [], details = new Map() } of results) {
    if (!rows.length) {
      facts.push({ busca: query.label, encontrados: 0 });
      spokenMissing.push(query.kind === "phone" ? "Não achei nenhum cliente com esse telefone." : `Não achei nenhum cliente com o nome ${query.label}.`);
      sections.push({ title: query.kind === "phone" ? "Telefone pesquisado" : `“${query.label}”`, rows: [{ label: "Resultado", value: "Nenhum cliente encontrado" }] });
      continue;
    }
    if (rows.length > 1) {
      const options = rows.slice(0, HENRY_CLIENT_OPTIONS).map((row) => optionOf(row, ctx));
      const more = rows.length - options.length;
      facts.push({ busca: query.label, encontrados: rows.length, varios_clientes: options.map(({ falado, ...option }) => option) });
      spokenAsk.push(`Achei ${rows.length} clientes com o nome ${query.label}: ${options.map((option) => option.falado).join("; ")}${more > 0 ? `; e mais ${more}` : ""}. Qual deles?`);
      sections.push({ title: `“${query.label}”: ${plural(rows.length, "cliente", "clientes")}`, rows: options.map((option) => ({ label: option.nome, value: option.etapa || "—", note: option.corretor })) });
      continue;
    }
    const block = clientBlock(rows[0], details.get(rows[0].id) || {}, ctx);
    facts.push({ busca: query.label, encontrados: 1, cliente: block.facts });
    spokenFound.push(block.spoken);
    sections.push(block.section);
  }
  const spoken = [...spokenFound, ...spokenMissing, ...spokenAsk].join(" ") || "Me diga o nome ou o telefone do cliente.";
  const found = facts.filter((item) => item.encontrados === 1).length;
  return {
    facts,
    spoken,
    ambiguous: spokenAsk.length > 0,
    detail: { title: results.length === 1 ? "Cliente" : "Clientes", subtitle: `${plural(found, "encontrado", "encontrados")} de ${plural(results.length, "busca", "buscas")}`, sections }
  };
}

// --- Chat: conversas aguardando resposta por corretor (getChatSummary byBroker, a mesma conta do Início) ----------------
export function buildHenryAwaitingReport({ total = 0, late = 0, groups = [], brokerName = () => "", onlyBrokerId = "" } = {}) {
  const list = (Array.isArray(groups) ? groups : []).filter((group) => !onlyBrokerId || group.brokerId === onlyBrokerId);
  const named = list.map((group) => ({ corretor: firstNameOf(brokerName(group.brokerId)) || "Sem corretor", aguardando: Number(group.count) || 0, mais_antigo: group.oldest?.name ? firstNameOf(group.oldest.name) : "", espera_minutos: group.oldest?.waitingMinutes ?? null }));
  const count = onlyBrokerId ? named.reduce((sum, item) => sum + item.aguardando, 0) : Number(total) || 0;
  const spoken = onlyBrokerId
    ? count ? `${named[0]?.corretor || "Esse corretor"} tem ${plural(count, "conversa", "conversas")} aguardando resposta.` : "Esse corretor não tem conversa aguardando resposta."
    : count ? `${plural(count, "conversa aguarda", "conversas aguardam")} resposta${late ? `, ${plural(late, "atrasada", "atrasadas")}` : ""}${named.length ? `; ${named.slice(0, 3).map((item) => `${item.corretor} com ${item.aguardando}`).join(", ")}` : ""}.` : "Nenhuma conversa aguardando resposta agora.";
  const waitText = (minutes) => (Number.isFinite(minutes) ? (minutes >= 60 ? `há ${Math.floor(minutes / 60)} h` : `há ${minutes} min`) : "");
  return {
    facts: { aguardando_resposta: count, atrasadas: onlyBrokerId ? undefined : Number(late) || 0, por_corretor: named },
    spoken,
    detail: { title: "Conversas aguardando resposta", subtitle: plural(count, "conversa", "conversas"), sections: [{ title: "Por corretor", rows: named.length ? named.map((item) => ({ label: item.corretor, value: String(item.aguardando), note: item.mais_antigo ? `mais antiga: ${item.mais_antigo} ${waitText(item.espera_minutos)}`.trim() : "" })) : [{ label: "Nenhuma", value: "0" }] }] }
  };
}

// Conversa de UM cliente: quantidades e últimas datas; resumo da IA só se JÁ existir em cache (nunca gera um novo).
// chat = describeChatChannels (em qual WhatsApp está cada conversa), quando já lido.
export function buildHenryConversationReport({ clientName = "", conversations = [], formatDate = (value) => value, chat = null } = {}) {
  const first = firstNameOf(clientName) || "o cliente";
  const list = Array.isArray(conversations) ? conversations : [];
  if (!list.length) return { facts: { conversas: 0 }, spoken: `Não achei conversa de ${first} no Chat.`, detail: { title: `Conversa: ${first}`, subtitle: "Sem conversa no Chat", sections: [] } };
  const latest = (key) => list.map((row) => row[key]).filter(Boolean).sort().at(-1) || "";
  const unread = list.reduce((sum, row) => sum + (Number(row.unread_count) || 0), 0);
  const lastInbound = latest("last_inbound_at");
  const lastReply = latest("last_human_reply_at");
  const summaryRow = list.filter((row) => row.ai_summary?.text).sort((a, b) => String(b.ai_summary.generated_at || "").localeCompare(String(a.ai_summary.generated_at || "")))[0];
  const summary = summaryRow ? { texto: String(summaryRow.ai_summary.text).slice(0, 1200), gerado_em: formatDate(summaryRow.ai_summary.generated_at), desatualizado: summaryRow.ai_summary.last_message_at !== summaryRow.last_message_at } : null;
  const facts = {
    conversas: list.length,
    nao_lidas: unread,
    ultima_mensagem_do_cliente: lastInbound ? formatDate(lastInbound) : "nenhuma",
    ultima_resposta_da_equipe: lastReply ? formatDate(lastReply) : "nenhuma",
    resumo_em_cache: summary,
    ...(chat ? { whatsapp: { onde: chat.onde, conversas: chat.conversas } } : {})
  };
  const spoken = `${first} escreveu por último ${facts.ultima_mensagem_do_cliente}; a equipe respondeu por último ${facts.ultima_resposta_da_equipe}.`;
  const rows = [
    { label: "Conversas", value: String(list.length) },
    ...(chat ? [{ label: "WhatsApp", value: chat.text }] : []),
    { label: "Não lidas", value: String(unread) },
    { label: "Última mensagem do cliente", value: facts.ultima_mensagem_do_cliente },
    { label: "Última resposta da equipe", value: facts.ultima_resposta_da_equipe },
    ...(summary ? [{ label: "Resumo (IA, já gerado)", value: summary.texto, note: `${summary.gerado_em}${summary.desatualizado ? " · há mensagens depois dele" : ""}` }] : [{ label: "Resumo", value: "Ainda não gerado (gere no Chat)" }])
  ];
  return { facts, spoken, detail: { title: `Conversa: ${first}`, subtitle: plural(list.length, "conversa", "conversas"), sections: [{ title: "Chat", rows }] } };
}

// --- Financeiro resumido (só o dono): calculateReceivableMetrics da tela do Financeiro ---------------------------------
// Na voz: reais inteiros por extenso numérico ("12.500 reais"; nunca "R$", que a barreira derruba). Na tela: BRL.
const reaisSpoken = (value) => `${Math.round(Number(value) || 0).toLocaleString("pt-BR")} reais`;
const brl = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
export function buildHenryFinanceReport(metrics = {}) {
  const received = Number(metrics.receivedThisMonth) || 0;
  const expected = Number(metrics.expectedThisMonth) || 0;
  const overdue = Number(metrics.overdueBeforeMonth) || 0;
  const spoken = `Neste mês já entraram ${reaisSpoken(received)} e estão previstos mais ${reaisSpoken(expected)}${overdue ? `; ${reaisSpoken(overdue)} de meses anteriores ainda sem confirmação` : ""}.`;
  return {
    facts: { recebido_no_mes: Math.round(received), previsto_a_receber_no_mes: Math.round(expected), vencido_de_meses_anteriores: Math.round(overdue), proximos_30_dias: Math.round(Number(metrics.next30) || 0) },
    spoken,
    detail: { title: "Financeiro do mês", subtitle: "Mesma conta da tela Financeiro", sections: [{ title: "Recebimentos", rows: [
      { label: "Recebido neste mês", value: brl(received) },
      { label: "A receber neste mês", value: brl(expected) },
      { label: "Vencidas de meses anteriores", value: brl(overdue) },
      { label: "Próximos 30 dias", value: brl(metrics.next30) }
    ] }] }
  };
}

// --- Presença hoje: quem chegou na imobiliária (getTeamPresence — o painel Supervisão › Online) ------------------------
export function buildHenryPresenceReport({ members = [], ownerAtOffice = null, ownerId = "", formatTime = (value) => value } = {}) {
  const team = (Array.isArray(members) ? members : []).filter((member) => member && member.id !== ownerId);
  const here = team.filter((member) => member.office?.active || member.office?.here);
  const names = here.map((member) => firstNameOf(member.name)).filter(Boolean);
  const head = names.length ? `Na imobiliária hoje: ${names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names.at(-1)}` : names[0]}.` : "Ninguém da equipe chegou na imobiliária hoje.";
  const owner = ownerAtOffice === true ? " Você também está aí." : "";
  return {
    facts: { na_imobiliaria: here.map((member) => ({ nome: firstNameOf(member.name), chegou: member.office?.firstSeenAt ? formatTime(member.office.firstSeenAt) : "", no_wifi_agora: Boolean(member.office?.here) })), dono_na_imobiliaria: ownerAtOffice },
    spoken: `${head}${owner}`,
    detail: { title: "Presença hoje", subtitle: plural(here.length, "pessoa", "pessoas"), sections: [{ title: "Na imobiliária", rows: here.length ? here.map((member) => ({ label: member.name, value: member.office?.here ? "no Wi-Fi agora" : "chegou hoje", note: member.office?.firstSeenAt ? `chegou ${formatTime(member.office.firstSeenAt)}` : "" })) : [{ label: "Ninguém", value: "" }] }] }
  };
}
