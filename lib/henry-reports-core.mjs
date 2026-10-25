import { addDays, mondayOf } from "./alexa-v2/periods.mjs";
import { clientFirstNameOf, firstNameOf } from "./alexa-v2/text.mjs";
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
  // "desse mês"/"desta semana" e "funil do mês"/"ranking da semana" (Treino, 2026-10-25) = o corrente.
  if (/\b(esta|essa|nesta|nessa|desta|dessa|da|na) semana\b/.test(value)) return { periodo: "esta_semana" };
  if (/\b(este|esse|neste|nesse|deste|desse|do|no) mes\b/.test(value)) return { periodo: "este_mes" };
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
  else if (leads) spokenParts.push(newClientsSentence(leads, opening));
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
  if (!positive && leads && previousLeads) trends.push(`os clientes novos ${trendWord(leads.total, previousLeads.total)}`);
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

  // Lead = cliente novo (REGRA OFICIAL, dono 2026-10-25): para o modelo, UM número só ("clientes_novos", definição do
  // Início = cadastros criados no período); o novosClientes do funil sai quando esse número existe (não vira "201 leads e
  // 198 clientes novos"). A tela (detail) continua igual.
  const funnelFacts = funnel && leads ? (({ novosClientes: _same, ...rest }) => rest)(funnel) : funnel;
  const facts = {
    periodo: range?.label || "",
    clientes_novos: leads ? { total: leads.total, anuncio: num(leads.ad), marketplace: num(leads.marketplace), outras: num(leads.other) } : "indisponível",
    funil: funnelFacts || "indisponível",
    ranking: data.overview ? ranking.slice(0, 5).map((row) => ({ nome: firstNameOf(row.name), pontos: num(row.points) })) : "indisponível",
    meta_diaria_equipe: meta ? `${num(meta.metaPercent)}%` : "indisponível",
    agora: { aguardando_resposta: has(data.awaitingReply) ? num(data.awaitingReply) : "indisponível", esfriados_para_decidir: has(data.cooledPending) ? num(data.cooledPending) : "indisponível" },
    periodo_anterior: previousFunnel || previousLeads ? { clientes_novos: previousLeads?.total ?? "indisponível", funil: previousFunnel || "indisponível" } : "indisponível"
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
    const total = positiveCount(num(leads.total), "cliente novo", "clientes novos");
    parts.push(`${opening} ${num(leads.total) === 1 ? "entrou" : "entraram"} ${total}${origins.length ? `, ${joinPositive(origins)}` : ""}.`);
  }
  if (funnel) {
    // Lead = cliente novo (dono, 2026-10-25): com a contagem do Início acima, o "clientes novos" do funil não se repete.
    const items = [
      leads ? "" : positiveCount(funnel.novosClientes, "cliente novo", "clientes novos"),
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
  if (leads && previousLeads && num(leads.total) > num(previousLeads.total)) ups.push(`os clientes novos ${trendWord(leads.total, previousLeads.total)}`);
  if (funnel && previousFunnel && funnel.vendas > previousFunnel.vendas) ups.push(`as vendas ${trendWord(funnel.vendas, previousFunnel.vendas)}`);
  if (ups.length) parts.push(`Comparado ao período anterior, ${joinPositive(ups)}.`);
  return parts;
}

// Métrica única pedida ("quantos clientes o Gabriel atendeu hoje?" → só atendimentos). Dono, 2026-10-22: "quando eu
// pergunto uma informação, ele passa outras que não são relevantes" — com `metrica`, o modelo recebe SÓ esse número.
// Ranking/pontuação de um PERÍODO (Treino do Henry, 2026-10-25: "como tá o ranking da semana?" virava "não dá pra trazer
// a semana por voz" — o catálogo da Alexa só tem ranking de hoje/ontem). Mesmo ranking da tela de Desempenho/Pontuação
// (getPerformanceOverview → slimOverview.ranking, quem não compete já fica de fora); aqui só se escreve a fala e a tela.
// "Hoje entraram 2 clientes novos, 1 de anúncio." — lead = cliente novo, UM número, definição do Início (REGRA OFICIAL,
// dono 2026-10-25: leadOriginBreakdown sobre os cadastros criados no período, no escopo de quem pergunta).
function newClientsSentence(leads, opening) {
  const origins = [];
  if (leads.ad) origins.push(`${leads.ad} de anúncio`);
  if (leads.marketplace) origins.push(`${leads.marketplace} do Marketplace`);
  return leads.total ? `${opening} ${leads.total === 1 ? "entrou" : "entraram"} ${plural(leads.total, "cliente novo", "clientes novos")}${origins.length ? `, ${joinPt(origins)}` : ""}.` : `${opening} não entrou nenhum cliente novo.`;
}

// "Quantos clientes novos entraram hoje?" (Treino 3, 2026-10-25: uma rodada disse 12 e as outras 2 no mesmo dia — o
// modelo escolhia o caminho): a pergunta direta usa SEMPRE a contagem do Início (leads = clientes novos). null = leitura
// falhou (nunca um zero falso).
// names (Treino 4, 2026-10-25: "me passa o nome deles" → "estão na tela de Clientes"): pedido dos nomes. Até
// HENRY_SPOKEN_NAMES_MAX clientes = os primeiros nomes falados (cliente sem nome real = "um sem nome", nunca "a Sem");
// mais que isso = a contagem e os nomes na tela. leads.names = primeiros nomes dos cadastros do período (loadHenryLeadOrigins).
export const HENRY_SPOKEN_NAMES_MAX = 5;
export function buildHenryNewClientsAnswer({ range, leads, names = false } = {}) {
  if (!leads || !Number.isFinite(Number(leads.total))) return null;
  const opening = range?.spoken ? range.spoken[0].toLocaleUpperCase("pt-BR") + range.spoken.slice(1) : "Hoje";
  if (!names || !leads.total) return newClientsSentence(leads, opening);
  const list = Array.isArray(leads.names) ? leads.names : null;
  if (!list || leads.total > HENRY_SPOKEN_NAMES_MAX) return `${newClientsSentence(leads, opening).replace(/\.$/, "")}; os nomes estão na tela.`;
  const named = list.filter(Boolean);
  const nameless = Math.max(0, leads.total - named.length);
  const parts = [...named, ...(nameless ? [nameless === 1 ? "um sem nome" : `${nameless} sem nome`] : [])];
  return leads.total === 1 ? `${opening} entrou ${parts[0] === "um sem nome" ? "um cliente sem nome" : parts[0]}.` : `${opening} entraram ${joinPt(parts)}.`;
}

// --- Cache pré-calculado (crm_metric_cache) para o Henry — Treino 4, 2026-10-25 -------------------------------------------
// Fora da validade da tela, o Henry ainda usa o número calculado há até 1 hora, sem dizer nada (a Alexa abre com "Última
// atualização há N minutos" — no Henry essa frase crua saía duplicada). Mais velho que isso: as leituras de período calculam
// na hora; o catálogo (que só lê o cache) ganha UMA menção natural no fim (henryStaleNote).
export const HENRY_CACHE_MAX_AGE_MINUTES = 60;
export function henryStaleNote(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= HENRY_CACHE_MAX_AGE_MINUTES) return "";
  const hours = Math.round(value / 60);
  return hours <= 1 ? "Esse número é de uma hora atrás." : `Esse número é de umas ${hours} horas atrás.`;
}

// Meta da equipe falada pelo Henry (Treino 4: "A meta da equipe está em 0 por cento. Ninguém bateu a meta ainda." era a
// frase do catálogo da Alexa, robótica). Números = os do catálogo (deriveMeta: metaPercent da equipe e quem bateu,
// lib/crm-metrics/team-goal-core.mjs); aqui só a fala. null = leitura falhou.
export function buildHenryTeamGoalSpeech({ percent, hitters = [], periodo = "hoje" } = {}) {
  if (percent === null || percent === undefined || !Number.isFinite(Number(percent))) return null;
  const pct = Math.round(Number(percent));
  const today = periodo !== "ontem";
  const list = Array.isArray(hitters) ? hitters : [];
  const names = list.map((item) => firstNameOf(item?.name)).filter(Boolean);
  const count = list.length;
  if (pct >= 100) return today ? `A equipe já bateu a meta de hoje, com ${pct} por cento.` : `Ontem a equipe bateu a meta, com ${pct} por cento.`;
  if (!count) {
    if (pct <= 0) return today ? "Ninguém bateu a meta ainda hoje; a equipe está zerada." : "Ontem ninguém bateu a meta; a equipe ficou zerada.";
    return today ? `A equipe está com ${pct} por cento da meta de hoje, e ninguém bateu ainda.` : `Ontem a equipe fez ${pct} por cento da meta, e ninguém bateu.`;
  }
  const verb = count === 1 ? (today ? "já bateu" : "bateu") : today ? "já bateram" : "bateram";
  const who = names.length === count && count <= 3 ? `${joinPt(names)} ${verb}` : `${plural(count, "corretor", "corretores")} ${verb}`;
  return today ? `A equipe está com ${pct} por cento da meta de hoje; ${who}.` : `Ontem a equipe fez ${pct} por cento da meta; ${who}.`;
}

// Tamanho da Meta Diária da equipe (Treino 5, 2026-10-25: "quanto a equipe precisa fechar por dia pra bater a meta?" →
// "Não tenho esse número fixo aqui"). Números do MESMO pré-cálculo/tela (slimTeamGoal de getOwnerTeamDailyOverview):
// summary.atividadesTotal = ações previstas (prospecção + pendentes, somando os corretores), atividadesDone = feitas;
// por corretor, broker.total. null = leitura falhou (nunca um zero falso).
export function buildHenryTeamGoalSizeSpeech({ goal = null, periodo = "hoje" } = {}) {
  if (!goal?.summary) return null;
  const total = num(goal.summary.atividadesTotal);
  const done = num(goal.summary.atividadesDone);
  const today = periodo !== "ontem";
  const withGoal = (goal.brokers || []).filter((broker) => num(broker.total) > 0);
  if (!total || !withGoal.length) return today ? "Hoje ainda não tem meta montada para a equipe." : "Ontem não teve meta montada para a equipe.";
  const each = Math.round(total / withGoal.length);
  const size = `${plural(total, "ação", "ações")} de prospecção e pendentes, umas ${each} por corretor`;
  if (!today) return `Ontem a meta da equipe somava ${size}; foram feitas ${done}.`;
  const left = Math.max(0, total - done);
  if (!left) return `A meta de hoje da equipe soma ${size}, e já está completa: foram feitas ${done}.`;
  return `A meta de hoje da equipe soma ${size}; já foram feitas ${done}, faltam ${left}.`;
}

// Clientes esperando numa etapa (Treino 5: "e os vinte esperando? isso não pode ficar parado" → "só consigo ver de hoje e
// de ontem"). rows = clientes da etapa AGORA (mesmos status da tela Clientes), mais antigos na etapa primeiro (since = a
// última troca de etapa). Fala: quantos e até 3 primeiros nomes com o tempo na etapa; a tela recebe a lista.
// Treino 6 (2026-10-25: "20 aprovados" do funil do mês x "9 aprovados esperando" → "eu tinha errado o número"): a fala diz
// que é quem CONTINUA na etapa HOJE — nunca soa como o mesmo número do funil de um período.
const STAGE_SPOKEN = {
  aprovados: { stage: "na etapa aprovado", zero: "Hoje nenhum cliente continua na etapa aprovado esperando." },
  aprovacao: { stage: "aguardando aprovação", zero: "Hoje nenhum cliente está aguardando aprovação." },
  documentacao: { stage: "na etapa de documentação", zero: "Hoje nenhum cliente está na etapa de documentação." },
  simulacao: { stage: "aguardando simulação", zero: "Hoje nenhum cliente está aguardando simulação." }
};
// Dias de calendário (São Paulo) entre a troca de etapa e hoje.
const SP_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const daysSince = (iso, todayKey) => {
  const at = Date.parse(iso || "");
  if (!Number.isFinite(at) || !isDateKey(todayKey)) return null;
  const since = Date.parse(`${SP_DAY.format(new Date(at))}T12:00:00Z`);
  return Math.max(0, Math.round((Date.parse(`${todayKey}T12:00:00Z`) - since) / 86400000));
};
const daysText = (days) => (days === null ? "" : days === 0 ? "desde hoje" : days === 1 ? "há 1 dia" : `há ${days} dias`);
export function buildHenryStageWaitingReport({ etapa = "", total = null, rows = [], today = "", stageLabel = "" } = {}) {
  const words = STAGE_SPOKEN[etapa];
  if (!words || total === null || total === undefined || !Number.isFinite(Number(total))) return null;
  const count = Number(total);
  if (!count) return { spoken: words.zero, detail: null, facts: { total: 0 } };
  const oldest = (rows || [])
    .map((row) => ({ name: clientFirstNameOf(row.full_name), days: daysSince(row.since, today), full: String(row.full_name || "").trim(), broker: row.broker || "" }))
    .filter((row) => row.name)
    .slice(0, 3);
  const waiting = etapa === "aprovados" || etapa === "documentacao" ? ", esperando" : "";
  const head = count === 1 ? `Hoje 1 cliente continua ${words.stage}${waiting}` : `Hoje ${count} clientes continuam ${words.stage}${waiting}`;
  const named = oldest.map((row) => [row.name, daysText(row.days)].filter(Boolean).join(" "));
  const spoken = named.length ? `${head}; ${count === 1 ? "é" : named.length === 1 ? "o mais antigo na etapa é" : "os mais antigos na etapa são"} ${joinPt(named)}.` : `${head}; os nomes estão na tela.`;
  const detail = {
    title: stageLabel ? `Clientes em ${stageLabel}` : "Clientes na etapa",
    subtitle: `${count} cliente${count === 1 ? "" : "s"} · mais antigos na etapa primeiro`,
    sections: [{ title: "Esperando", rows: (rows || []).slice(0, 30).map((row) => ({ label: String(row.full_name || "").trim() || "Cliente", value: [daysText(daysSince(row.since, today)), row.broker].filter(Boolean).join(" · ") })) }]
  };
  return { spoken, detail, facts: { total: count, agora: true, mais_antigos: oldest.map((row) => ({ nome: row.name, dias_na_etapa: row.days })) } };
}

// Parados da equipe (Treino 8, 2026-10-25: "quem tá há mais tempo sem retorno no CRM?" → parados + conversas, 11,8 s):
// data = o mesmo do catálogo sem_contato ({ count, days, items: [{ name }] }, mais antigos primeiro). Fala: quantos e os 3
// mais antigos (primeiro nome; cliente sem nome real fica de fora); a lista vai para a tela.
export function buildHenryStaleClientsSpeech(data) {
  if (!data || !Number.isFinite(Number(data.count))) return null;
  const count = Number(data.count);
  const days = Number(data.days) || 3;
  if (!count) return { spoken: `Nenhum cliente está há mais de ${days} dias sem contato.`, detail: null };
  const items = Array.isArray(data.items) ? data.items : [];
  const names = items.map((item) => clientFirstNameOf(item.name)).filter(Boolean).slice(0, 3);
  const head = count === 1 ? `Tem 1 cliente há mais de ${days} dias sem contato` : `São ${count} clientes há mais de ${days} dias sem contato`;
  const who = names.length ? (count === 1 ? `: ${names[0]}` : `; os que estão há mais tempo são ${joinPt(names)}`) : "";
  const spoken = `${head}${who}.${count > names.length ? " A lista toda está na tela." : ""}`;
  const detail = { title: "Clientes sem contato", subtitle: `${count} cliente${count === 1 ? "" : "s"} · há mais de ${days} dias · mais antigos primeiro`, sections: [{ title: "Sem contato", rows: items.slice(0, 30).map((item) => ({ label: String(item.name || "").trim() || "Cliente", value: "" })) }] };
  return { spoken, detail };
}

// "a Bruna" / "o Gabriel" / "Luan" (sem gênero cadastrado, só o nome) — mesma regra da Alexa (subjectOf, medidas.mjs).
const withArticle = (name, gender) => (gender === "female" ? `a ${name}` : gender === "male" ? `o ${name}` : name);

export function buildHenryRankingReport({ range, overview } = {}) {
  if (!overview) return null;
  const ranking = (overview.ranking || []).filter((row) => num(row.points) > 0);
  const when = range?.spoken || "no período";
  const label = range?.label || "";
  if (!ranking.length) {
    return {
      spoken: `Ninguém pontuou ${when}.`,
      facts: { periodo: label, ranking: [] },
      detail: { title: "Ranking e pontuação", subtitle: label, sections: [{ title: "Pontos", rows: [{ label: "Ninguém pontuou no período", value: "0" }] }] }
    };
  }
  const named = ranking.map((row) => ({ name: firstNameOf(row.name) || "Corretor", gender: row.gender || "", points: num(row.points) }));
  const [leader, second, third] = named;
  const opening = when[0].toLocaleUpperCase("pt-BR") + when.slice(1);
  // Treino 4 (2026-10-25): "Hoje o Gabriel lidera, com a Bruna em segundo" — fala de gente, não "1º Gabriel e 2º Bruna".
  const followers = second ? `; ${withArticle(second.name, second.gender)} vem em segundo, com ${second.points}${third ? `, e ${withArticle(third.name, third.gender)} em terceiro, com ${third.points}` : ""}` : "";
  const spoken = `${opening}, ${withArticle(leader.name, leader.gender)} lidera o ranking, com ${plural(leader.points, "ponto", "pontos")}${followers}.`;
  return {
    spoken,
    facts: { periodo: label, ranking: named.slice(0, 5).map((row) => ({ nome: row.name, pontos: row.points })) },
    detail: { title: "Ranking e pontuação", subtitle: label, sections: [{ title: "Pontos", rows: named.slice(0, 10).map((row, index) => ({ label: `${index + 1}º ${row.name}`, value: `${row.points} pts` })) }] }
  };
}

// Funil de um PERÍODO (Treino 2 do Henry, 2026-10-25: "como tá o funil desse mês?" → "só consigo ver de hoje ou de ontem
// por voz" — o funil do catálogo da Alexa é a fotografia de AGORA, sem período). FUNIL-PAINEL (docs/METRICAS_FUNIL.md
// MET-4): o funil cumulativo do mesmo getPerformanceOverview do Desempenho (funnelOf → slimOverview), nenhuma conta nova.
// positive (resumo positivo, HENRY-1 2026-10-24): a fala omite as etapas zeradas; nada de bom → slowDayPhrase (weak).
const FUNNEL_STAGES = [
  ["prospeccao", "cliente no funil", "clientes no funil"],
  ["atendimento", "atendimento", "atendimentos"],
  ["simulacao", "simulação", "simulações"],
  ["documentacao", "em documentação", "em documentação"],
  ["enviadosAprovacao", "enviado para aprovação", "enviados para aprovação"],
  ["aprovados", "aprovado", "aprovados"],
  ["vendas", "venda", "vendas"]
];
export const HENRY_FUNNEL_PERIOD_NOTE = "cada etapa conta quem PASSOU por ela no período (ex.: aprovados no mês); não é quem está parado/esperando nela agora — esses vêm de consultar_crm assunto etapa, formato lista. Nunca chame os aprovados do período de 'esperando'.";
// Gargalo do funil (Treino 7, 2026-10-25: em 3 respostas seguidas o Henry disse "entre aprovação e venda", "entre enviados e
// aprovados" e "na documentação" — o modelo escolhia a etapa). Conta DETERMINÍSTICA: a maior queda proporcional entre duas
// etapas consecutivas do funil de vendas (atendimento → simulação → documentação → enviados → aprovados → vendas; a
// prospecção não entra: é outra régua), só com a etapa de cima > 0. Empate = a primeira (mais cedo no funil). Os mesmos
// números → sempre o mesmo gargalo. null = nenhuma etapa perde gente.
const BOTTLENECK_STAGES = FUNNEL_STAGES.filter(([key]) => key !== "prospeccao");
const STAGE_NAMES = { atendimento: "atendimento", simulacao: "simulação", documentacao: "documentação", enviadosAprovacao: "envio para aprovação", aprovados: "aprovação", vendas: "venda" };
export function henryFunnelBottleneck(funnel) {
  if (!funnel) return null;
  let best = null;
  for (let index = 1; index < BOTTLENECK_STAGES.length; index += 1) {
    const [fromKey, fromOne, fromMany] = BOTTLENECK_STAGES[index - 1];
    const [toKey, toOne, toMany] = BOTTLENECK_STAGES[index];
    const from = num(funnel[fromKey]);
    const to = num(funnel[toKey]);
    if (from <= 0 || to >= from) continue;
    const drop = (from - to) / from;
    if (!best || drop > best.drop) best = { drop, from, to, fromKey, toKey, fromOne, fromMany, toOne, toMany };
  }
  if (!best) return null;
  const percent = Math.round(best.drop * 100);
  return {
    de: best.fromKey,
    para: best.toKey,
    etapa: `entre ${STAGE_NAMES[best.fromKey]} e ${STAGE_NAMES[best.toKey]}`,
    de_quantidade: best.from,
    para_quantidade: best.to,
    queda_percentual: percent,
    // Treino 9: a frase curta que fecha a fala do funil pedido ("me fala do funil"), no lugar de oferecer o gargalo.
    curta: `O gargalo tá entre ${STAGE_NAMES[best.fromKey]} e ${STAGE_NAMES[best.toKey]}, uma queda de ${percent}%.`,
    frase: `O gargalo tá entre ${STAGE_NAMES[best.fromKey]} e ${STAGE_NAMES[best.toKey]}: de ${plural(best.from, best.fromOne, best.fromMany)} ${best.to === 0 ? `não saiu ${zeroCount(best.toOne)}` : `saíram só ${plural(best.to, best.toOne, best.toMany)}`}, uma queda de ${percent}%.`
  };
}

// Plano curto a partir do gargalo (Treino 8, 2026-10-25: "cadê o plano pra subir essa taxa?" → recusa). Duas ações
// práticas fixas por etapa do gargalo (recomendação curta, permitida pela persona; nenhum número inventado). Com quem está
// parado AGORA na etapa de cima do gargalo (loadHenryStageClients): quantos e os 2 mais antigos, só primeiro nome.
// stage = a etapa do "e os vinte esperando?" (ETAPA_STATUSES), só quando a correspondência é direta.
const BOTTLENECK_PLAN = {
  atendimento: { stage: "simulacao", first: "chamar quem está aguardando simulação", second: "fazer a simulação já no primeiro atendimento" },
  simulacao: { stage: "", first: "pedir os documentos logo depois de mandar a simulação", second: "retomar quem simulou e ainda não mandou documento" },
  documentacao: { stage: "documentacao", first: "cobrar os documentos que faltam de quem está na documentação", second: "conferir a pasta antes de enviar, para não voltar com pendência" },
  enviadosAprovacao: { stage: "aprovacao", first: "revisar a documentação antes de mandar para análise", second: "acompanhar com a CCA quem está aguardando aprovação" },
  aprovados: { stage: "aprovados", first: "chamar os aprovados que ainda não compraram", second: "levar cada um para visita ou proposta ainda esta semana" }
};
export function henryBottleneckStage(gargalo) {
  return BOTTLENECK_PLAN[gargalo?.de]?.stage || "";
}
// stage = { total, rows: [{ full_name }] } (mais antigos primeiro) ou null.
export function henryBottleneckPlan(gargalo, stage = null) {
  const plan = BOTTLENECK_PLAN[gargalo?.de];
  if (!gargalo || !plan) return { spoken: "Nenhuma etapa do funil perdeu gente no período; o plano é manter o ritmo e seguir atendendo rápido.", acoes: [] };
  const total = stage && Number.isFinite(Number(stage.total)) ? Number(stage.total) : null;
  const names = (stage?.rows || []).map((row) => clientFirstNameOf(row.full_name)).filter(Boolean).slice(0, 2);
  const who = total && plan.stage ? `: ${total === 1 ? "é 1" : `são ${total}`}${names.length ? `, começando por ${joinPt(names)}` : ""}` : "";
  const first = `${plan.first}${who}`;
  return {
    spoken: `O gargalo tá ${gargalo.etapa}. Primeiro, ${first}. Depois, ${plan.second}.`,
    acoes: [first, plan.second]
  };
}

// Treino 11 (2026-10-25: depois de "Foi mal. Neste mês, o gargalo tá entre aprovação e venda…", "Cara, você tá falando a
// mesma coisa de novo." → "Foi mal. Você queria o quê: vendas, funil ou ranking?"): o gargalo que a fala anterior JÁ disse
// ("entre <etapa> e …", as mesmas palavras de STAGE_NAMES) → a etapa de quem está parado AGORA na etapa de cima (a mesma
// de henryBottleneckStage). "" = a fala não trazia gargalo, ou a etapa de cima não tem lista (simulação).
const BOTTLENECK_FROM_SPEECH = /\bgargalo\b.*?\bentre (envio para aprovacao|aprovacao|documentacao|simulacao|atendimento) e\b/;
const STAGE_KEY_BY_NAME = Object.fromEntries(Object.entries(STAGE_NAMES).map(([key, name]) => [plain(name), key]));
export function henryBottleneckStageFromSpeech(text) {
  const match = BOTTLENECK_FROM_SPEECH.exec(plain(text).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " "));
  return match ? BOTTLENECK_PLAN[STAGE_KEY_BY_NAME[match[1]]]?.stage || "" : "";
}

export const HENRY_BOTTLENECK_NOTE ="gargalo = a maior queda proporcional entre etapas seguidas, já calculada; fale SÓ esse gargalo, com os números dele, e nunca escolha outra etapa — se ele perguntar de novo ('não fecha', 'onde tá travando'), é o MESMO gargalo com outras palavras";

// diagnosis (pergunta "onde tá o gargalo/onde a gente tá errando"): a sugestão de fala é a frase do gargalo.
// bottleneckLine (Treino 9, "me fala do funil" → "Quer que eu veja em qual etapa a gente mais perde gente?"): a fala do funil
// pedido termina com o gargalo calculado numa frase curta, sem perguntar.
export function buildHenryFunnelReport({ range, overview, positive = false, slowDayPhrase = "", diagnosis = false, bottleneckLine = false } = {}) {
  const funnel = funnelOf(overview);
  if (!funnel) return null;
  const when = range?.spoken || "no período";
  const label = range?.label || "";
  const opening = when[0].toLocaleUpperCase("pt-BR") + when.slice(1);
  const bottleneck = henryFunnelBottleneck(funnel);
  const parts = FUNNEL_STAGES.map(([key, one, many]) => {
    const value = num(funnel[key]);
    if (positive) return positiveCount(value, one, many);
    return value === 0 && key !== "prospeccao" ? "" : plural(value, one, many);
  }).filter(Boolean);
  const weak = positive && !parts.length;
  const listed = weak ? String(slowDayPhrase || "") : parts.length ? `${opening}, o funil teve ${joinPt(parts)}.` : `${opening}, o funil ficou zerado.`;
  const spoken = diagnosis ? (bottleneck ? `${opening}, ${bottleneck.frase.charAt(0).toLocaleLowerCase("pt-BR")}${bottleneck.frase.slice(1)}` : `${opening}, nenhuma etapa do funil perdeu gente.`) : bottleneckLine && bottleneck && !weak ? `${listed} ${bottleneck.curta}` : listed;
  // Treino 6: "aprovados" do funil = quem PASSOU pela aprovação no período, não quem está esperando agora (etapa).
  const facts = { periodo: label, ...Object.fromEntries(FUNNEL_STAGES.map(([key]) => [key, num(funnel[key])])), como_ler: HENRY_FUNNEL_PERIOD_NOTE };
  // Resumo positivo (sem diagnóstico pedido) não leva o gargalo: queda é o negativo que a fala omite (HENRY-1).
  const withBottleneck = { ...facts, gargalo: bottleneck || "nenhuma etapa perdeu gente no período", como_usar_gargalo: HENRY_BOTTLENECK_NOTE };
  return {
    spoken,
    facts: positive && !diagnosis ? prunePositiveFacts(facts) : withBottleneck,
    weak: diagnosis ? false : weak,
    detail: {
      title: "Funil",
      subtitle: label,
      sections: [{ title: "Etapas (funil do Desempenho)", rows: FUNNEL_STAGES.map(([key, , many]) => ({ label: many[0].toLocaleUpperCase("pt-BR") + many.slice(1), value: String(num(funnel[key])) })) }]
    }
  };
}

// Imóveis e empreendimentos cadastrados (Treino 2, 2026-10-25: "dá uma olhada naquele imóvel que a gente falou ontem" →
// "Não tenho acesso aos imóveis pela voz"; regra HENRY-1 "Leitura ampla": o Henry lê todo o CRM). Linhas = listProperties
// (lib/properties.js, a mesma lista das telas Imóveis/Empreendimentos). Preço só na TELA (a voz não fala valores em reais
// fora do financeiro). Sem nome dito ou mais de um achado → a pergunta "qual deles?" com até 3 nomes.
export const HENRY_PROPERTY_OPTIONS = 3;
const PROPERTY_STOPWORDS = new Set(["imovel", "imoveis", "empreendimento", "empreendimentos", "casa", "casas", "apartamento", "apartamentos", "aquele", "aquela", "naquele", "naquela", "esse", "essa", "nesse", "nessa", "gente", "falou", "falamos", "falei", "olhada", "o", "a", "do", "da", "de", "no", "na", "em", "que", "ontem", "hoje"]);
const searchText = (value) => plain(value).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const propertyText = (value, max = 60) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export function buildHenryPropertiesReport({ properties = [], query = "", tipo = "" } = {}) {
  const list = (Array.isArray(properties) ? properties : []).filter((item) => item && propertyText(item.name));
  const scoped = tipo === "empreendimento" ? list.filter((item) => item.isDevelopment) : tipo === "imovel" ? list.filter((item) => !item.isDevelopment) : list;
  const tokens = searchText(query).split(" ").filter((token) => token.length >= 2 && !PROPERTY_STOPWORDS.has(token));
  const haystack = (item) => searchText([item.name, item.code, item.builder, item.location, item.region, item.type].map((value) => propertyText(value, 120)).join(" "));
  const matches = tokens.length ? scoped.filter((item) => tokens.every((token) => haystack(item).includes(token))) : scoped;
  const kindOf = (item) => (item.isDevelopment ? "empreendimento" : "imóvel");
  const fact = (item) => ({
    nome: propertyText(item.name),
    tipo: kindOf(item),
    ...(propertyText(item.builder) ? { construtora: propertyText(item.builder) } : {}),
    ...(propertyText(item.location || item.region) ? { local: propertyText(item.location || item.region) } : {}),
    ...(propertyText(item.bedrooms, 10) ? { quartos: propertyText(item.bedrooms, 10) } : {}),
    ...(propertyText(item.area, 20) ? { area: propertyText(item.area, 20) } : {}),
    ...(propertyText(item.delivery, 40) ? { entrega: propertyText(item.delivery, 40) } : {}),
    ...(propertyText(item.status, 40) ? { situacao: propertyText(item.status, 40) } : {}),
    publicado_no_site: item.isPublished !== false
  });
  const rows = (items) => items.slice(0, 15).map((item) => ({ label: propertyText(item.name, 80), value: [kindOf(item), propertyText(item.location || item.region, 40)].filter(Boolean).join(" · "), note: propertyText(item.price, 40) }));
  const detail = (title, items) => ({ title: "Imóveis e empreendimentos", subtitle: title, sections: [{ title, rows: items.length ? rows(items) : [{ label: "Nenhum cadastrado", value: "—" }] }] });
  if (matches.length === 1 && tokens.length) {
    const item = fact(matches[0]);
    const where = item.local ? `, em ${item.local}` : "";
    const rooms = item.quartos ? `, ${item.quartos} quartos` : "";
    const delivery = item.entrega ? `, entrega ${item.entrega}` : "";
    return { found: true, spoken: `${item.nome} é ${item.tipo === "imóvel" ? "um imóvel" : "um empreendimento"}${item.construtora ? ` da ${item.construtora}` : ""}${where}${rooms}${delivery}.`, facts: { imovel: item }, detail: detail(item.nome, matches) };
  }
  const options = (matches.length ? matches : scoped).slice(0, HENRY_PROPERTY_OPTIONS).map((item) => propertyText(item.name));
  const total = scoped.length;
  if (tokens.length && !matches.length) {
    return { ambiguous: true, spoken: `Não achei imóvel com esse nome.${options.length ? ` Tenho ${joinPt(options)}, por exemplo. Qual deles?` : ""}`, facts: { encontrados: 0, opcoes: options, total }, detail: detail("Cadastrados", scoped) };
  }
  return {
    ambiguous: true,
    spoken: total ? `Tenho ${plural(matches.length, "imóvel cadastrado", "imóveis cadastrados")}${options.length ? `, como ${joinPt(options)}` : ""}. Qual deles?` : "Não tem imóvel cadastrado.",
    facts: { encontrados: matches.length, opcoes: options, total },
    detail: detail(tokens.length ? "Achados" : "Cadastrados", matches)
  };
}

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

// --- Comparação entre corretores (dono, 2026-10-25: "qual corretor mais realizou simulações?" → o Henry não conseguiu) ----
// comparar_corretores: TODOS os corretores do Desempenho por corretor (slimOverview.team — as MESMAS linhas que o
// consultar_corretor lê para um corretor só) ordenados por UMA métrica do período; pontos = o ranking do período
// (slimOverview.ranking, o mesmo do ranking_periodo). Nenhuma métrica nova: só ordena e escreve a frase. A fala traz o 1º
// (empate = os empatados) e os 2 seguintes com números; a tabela completa vai para a tela. Pergunta direta: número sai.
export const HENRY_COMPARE_METRIC_IDS = HENRY_BROKER_METRIC_IDS.filter((id) => !HENRY_BROKER_METRICS[id].special);
const COMPARE_VERB = { novos_clientes: "recebeu", pontos: "fez", prospeccao: "fez" };
const COMPARE_SPOKEN_MAX = 3;
// Treino 8: posição pedida ("quem ficou em segundo?" = position 2) e "e os outros?" (others = quem vem depois dos líderes).
const ORDINAL_SPOKEN = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono", "décimo"];
export function buildHenryBrokerComparison({ range, overview, metric = "", order = "mais", position = null, others = false } = {}) {
  const spec = HENRY_BROKER_METRICS[metric];
  if (!overview || !spec || spec.special) return null;
  const fewest = order === "menos";
  // Só corretores (dono, 2026-10-25: "Sim, apenas os corretores") — gestor, dono e associado ficam fora da comparação.
  const brokerIds = new Set((overview.team || []).filter((row) => row.role === "broker").map((row) => row.id).filter(Boolean));
  const source = (metric === "pontos" ? overview.ranking || [] : overview.team || [])
    .filter((row) => (metric === "pontos" ? brokerIds.has(row.id) : row.role === "broker"));
  const rows = source
    .map((row) => ({ name: firstNameOf(row.name) || "Corretor", fullName: String(row.fullName || row.name || "").trim(), gender: row.gender || "", value: num(row[spec.field]) }))
    .sort((a, b) => (fewest ? a.value - b.value : b.value - a.value) || a.name.localeCompare(b.name, "pt-BR"));
  const when = range?.spoken || "no período";
  const label = range?.label || "";
  const opening = when[0].toLocaleUpperCase("pt-BR") + when.slice(1);
  const verb = COMPARE_VERB[metric] || "teve";
  const none = zeroCount(spec.one).split(" ")[0]; // "nenhum"/"nenhuma"
  const qty = (value) => (value === 0 ? none : String(value));
  const who = (row) => withArticle(row.name, row.gender);
  let spoken;
  if (!rows.length) spoken = `Não achei corretores com números ${when}.`;
  else if (rows.every((row) => row.value === 0)) spoken = `${opening}, ninguém ${verb} ${spec.one}.`;
  else if (Number.isInteger(position) && position >= 1) {
    const row = rows[position - 1];
    const ordinal = ORDINAL_SPOKEN[position] || `${position}º`;
    if (!row) spoken = `${opening}, só ${plural(rows.length, "corretor aparece", "corretores aparecem")} em ${spec.many}; não tem ${ordinal} lugar.`;
    else {
      const tied = rows.filter((other) => other !== row && other.value === row.value);
      const tiedWord = row.gender === "female" ? "empatada" : "empatado";
      const tie = tied.length && tied.length <= 2 ? `, ${tiedWord} com ${joinPt(tied.map(who))}` : tied.length ? `, ${tiedWord} com mais ${tied.length}` : "";
      spoken = `${opening}, em ${ordinal} lugar em ${spec.many} ficou ${who(row)}, com ${qty(row.value)}${tie}.`;
    }
  } else if (others) {
    const leaders = rows.filter((row) => row.value === rows[0].value);
    const next = rows.slice(leaders.length, leaders.length + COMPARE_SPOKEN_MAX).filter((row) => fewest || row.value > 0);
    const rest = rows.length - leaders.length - next.length;
    spoken = next.length
      ? `${opening}, depois ${next.length === 1 ? "vem" : "vêm"} ${joinPt(next.map((row) => `${who(row)}, com ${qty(row.value)}`))}${rest > 0 ? "; o resto está na tela" : ""}.`
      : `${opening}, depois ${leaders.length === 1 ? `${who(leaders[0])}` : "dos líderes"} ninguém mais ${verb} ${spec.one}.`;
  } else {
    const leaders = rows.filter((row) => row.value === rows[0].value);
    const head = leaders.length === 1
      ? `${opening}, quem ${verb} ${fewest ? "menos" : "mais"} ${spec.many} foi ${who(leaders[0])}, com ${qty(leaders[0].value)}`
      : leaders.length <= COMPARE_SPOKEN_MAX
        ? `${opening}, ${joinPt(leaders.map(who))} empataram com ${fewest ? "menos" : "mais"} ${spec.many}, ${qty(leaders[0].value)} cada`
        : `${opening}, ${leaders.length} corretores empataram com ${fewest ? "menos" : "mais"} ${spec.many}, ${qty(leaders[0].value)} cada; a lista está na tela`;
    const followers = leaders.length <= COMPARE_SPOKEN_MAX
      ? rows.slice(leaders.length, COMPARE_SPOKEN_MAX).filter((row) => fewest || row.value > 0)
      : [];
    const tail = followers.length === 1
      ? `; depois vem ${who(followers[0])}, com ${qty(followers[0].value)}`
      : followers.length === 2
        ? `; depois vêm ${who(followers[0])}, com ${qty(followers[0].value)}, e ${who(followers[1])}, com ${qty(followers[1].value)}`
        : "";
    spoken = `${head}${tail}.`;
  }
  const title = spec.many[0].toLocaleUpperCase("pt-BR") + spec.many.slice(1);
  return {
    spoken,
    facts: { periodo: label, metrica: spec.many, ordem: fewest ? "menos" : "mais", corretores: rows.slice(0, 10).map((row) => ({ nome: row.name, [metric]: row.value })) },
    detail: {
      title: `${title} por corretor`,
      subtitle: label,
      sections: [{ title: fewest ? "Do menor para o maior" : "Do maior para o menor", rows: rows.length ? rows.map((row, index) => ({ label: `${index + 1}º ${row.fullName || row.name}`, value: String(row.value) })) : [{ label: "Sem corretores no período", value: "—" }] }]
    }
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
// context.recentText = o que o Henry falou há pouco na conversa (memória do dia); context.statusLabel = rótulo da etapa.
export function pickClientMatches(query, rows = [], brokerName = () => "", context = {}) {
  let list = Array.isArray(rows) ? rows : [];
  if (query?.broker) {
    const wanted = plain(query.broker).split(" ")[0];
    const filtered = wanted.length < 3 ? [] : list.filter((row) => plain(brokerName(row.responsible_user_id)).split(" ").some((word) => word.startsWith(wanted)));
    if (filtered.length) list = filtered;
  }
  if (query?.kind === "name" && list.length > 1) {
    const exact = list.filter((row) => plain(row.full_name) === plain(query.term));
    if (exact.length === 1) return exact;
    const cued = clientFromConversation(query, list, context);
    if (cued) return [cued];
  }
  return list;
}

// Desempate pela conversa (Treino 6, 2026-10-25: depois da lista dos aprovados "…a Jeniffer é a mais antiga", "começa pela
// Jeniffer" → "Achei duas Jenifferes: uma arquivada e outra aprovada. Qual?"). O nome tem que ter sido FALADO pelo Henry há
// pouco: (1) a frase que citou o nome fala da etapa de UM só deles ("aprovados" → o "Cliente aprovado") → ele; (2) senão, um
// só não arquivado (fora Arquivado/Não contactar) → ele. Continua ambíguo → null (pergunta qual, como sempre).
const CLIENT_INACTIVE_STATUSES = new Set(["archived", "do_not_contact"]);
const STAGE_GENERIC_WORDS = new Set(["cliente", "aguardando", "realizada", "realizado", "pendente"]);
const wordsOnly = (text) => plain(text).replace(/[^a-z0-9]+/g, " ").trim();
function stageWordPattern(label) {
  const words = wordsOnly(label).split(" ").filter((word) => word.length >= 5 && !STAGE_GENERIC_WORDS.has(word));
  if (!words.length) return null;
  return new RegExp(`\\b(?:${words.map((word) => `${word.replace(/[oa]$/, "")}[oa]?s?`).join("|")})\\b`);
}
export function clientFromConversation(query, rows = [], { recentText = "", statusLabel = null } = {}) {
  const term = wordsOnly(query?.term).split(" ")[0] || "";
  if (term.length < 3 || !recentText) return null;
  const stem = term.slice(0, Math.min(5, term.length));
  const sentences = String(recentText)
    .split(/[.!?…;\n]+/)
    .map(wordsOnly)
    .filter((sentence) => sentence.split(" ").some((word) => word.startsWith(stem)));
  if (!sentences.length) return null;
  if (typeof statusLabel === "function") {
    const byStage = rows.filter((row) => {
      const pattern = stageWordPattern(statusLabel(row.status));
      return pattern && sentences.some((sentence) => pattern.test(sentence));
    });
    if (byStage.length === 1) return byStage[0];
  }
  const active = rows.filter((row) => !CLIENT_INACTIVE_STATUSES.has(row.status));
  return active.length === 1 ? active[0] : null;
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
  const firstName = clientFirstNameOf(row.full_name) || "Cliente sem nome";
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
  const first = clientFirstNameOf(row.full_name) || "Cliente sem nome";
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
// Treino 8 (2026-10-25: "117 conversas aguardam resposta, 117 atrasadas; Matheus com 24, Jennyfer com 23, Ketlin com 17."):
// fala de gente — "São 117 conversas esperando resposta, todas atrasadas. Você tem 24, a Jennyfer 23 e a Ketlin 17." O
// dono (ownerId = quem pergunta) é "você", nunca o nome dele na 3ª pessoa. Tela com os nomes, como antes.
export function buildHenryAwaitingReport({ total = 0, late = 0, groups = [], brokerName = () => "", brokerGender = () => "", ownerId = "", onlyBrokerId = "" } = {}) {
  const list = (Array.isArray(groups) ? groups : []).filter((group) => !onlyBrokerId || group.brokerId === onlyBrokerId);
  const named = list.map((group) => ({ corretor: firstNameOf(brokerName(group.brokerId)) || "Sem corretor", aguardando: Number(group.count) || 0, mais_antigo: group.oldest?.name ? firstNameOf(group.oldest.name) : "", espera_minutos: group.oldest?.waitingMinutes ?? null, ...(ownerId && group.brokerId === ownerId ? { voce: true } : {}) }));
  const count = onlyBrokerId ? named.reduce((sum, item) => sum + item.aguardando, 0) : Number(total) || 0;
  const lateCount = Number(late) || 0;
  const lateText = !lateCount ? "" : lateCount >= count ? (count === 1 ? ", atrasada" : count === 2 ? ", as duas atrasadas" : ", todas atrasadas") : `, ${plural(lateCount, "atrasada", "atrasadas")}`;
  const withBroker = list.map((group, index) => ({ ...named[index], id: group.brokerId })).filter((item) => item.aguardando > 0).slice(0, 3);
  // Treino 9 ("Você tem 24, a Jennyfer 23 e Ketlin 17." — a Ketlin sem gênero no cadastro): artigo em TODOS os nomes da
  // lista ou em nenhum — algum corretor falado sem admin_users.gender → nenhum leva artigo.
  const spokenBrokers = withBroker.filter((item) => !item.voce && item.corretor !== "Sem corretor");
  const articles = spokenBrokers.every((item) => ["female", "male"].includes(brokerGender(item.id)));
  const spokenItem = (item, index) => {
    if (item.voce) return index === 0 ? `Você tem ${item.aguardando}` : `você ${item.aguardando}`;
    if (item.corretor === "Sem corretor") return `${item.aguardando} sem corretor`;
    const name = articles ? withArticle(item.corretor, brokerGender(item.id)) : item.corretor;
    return index === 0 ? `${name.charAt(0).toLocaleUpperCase("pt-BR")}${name.slice(1)} tem ${item.aguardando}` : `${name} ${item.aguardando}`;
  };
  const head = count === 1 ? `Tem 1 conversa esperando resposta${lateText}.` : `São ${count} conversas esperando resposta${lateText}.`;
  const onlyOwner = onlyBrokerId && ownerId && onlyBrokerId === ownerId;
  const spoken = onlyBrokerId
    ? count ? `${onlyOwner ? "Você" : named[0]?.corretor || "Esse corretor"} tem ${plural(count, "conversa", "conversas")} esperando resposta.` : onlyOwner ? "Você não tem conversa esperando resposta." : "Esse corretor não tem conversa esperando resposta."
    : count ? `${head}${withBroker.length ? ` ${joinPt(withBroker.map(spokenItem))}.` : ""}` : "Nenhuma conversa esperando resposta agora.";
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
