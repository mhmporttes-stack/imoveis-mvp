import { addDays, mondayOf } from "./alexa-v2/periods.mjs";
import { firstNameOf } from "./alexa-v2/text.mjs";

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

  const spokenParts = [];
  const opening = range?.spoken ? range.spoken[0].toLocaleUpperCase("pt-BR") + range.spoken.slice(1) : "No período";
  if (leads) {
    const origins = [];
    if (leads.ad) origins.push(`${leads.ad} de anúncio`);
    if (leads.marketplace) origins.push(`${leads.marketplace} do Marketplace`);
    spokenParts.push(leads.total ? `${opening} entraram ${plural(leads.total, "lead", "leads")}${origins.length ? `, ${joinPt(origins)}` : ""}.` : `${opening} não entrou nenhum lead.`);
  }
  if (funnel) {
    spokenParts.push(
      `No funil, ${plural(funnel.atendimento, "atendimento", "atendimentos")}, ${plural(funnel.simulacao, "simulação", "simulações")}, ${plural(funnel.documentacao, "documentação", "documentações")}, ${plural(funnel.aprovados, "aprovado", "aprovados")} e ${plural(funnel.vendas, "venda", "vendas")}.`
    );
  }
  const leader = ranking[0];
  const rankingSentence = leader ? `${firstNameOf(leader.name)} lidera o ranking com ${plural(num(leader.points), "ponto", "pontos")}` : "";
  const metaSentence = meta && num(meta.atividadesTotal) > 0 ? `a Meta Diária da equipe ficou em ${num(meta.metaPercent)}%` : "";
  if (rankingSentence || metaSentence) {
    const text = [rankingSentence, metaSentence].filter(Boolean).join(", e ");
    spokenParts.push(`${text[0].toLocaleUpperCase("pt-BR")}${text.slice(1)}.`);
  }
  const now = [];
  if (has(data.awaitingReply)) now.push(plural(num(data.awaitingReply), "cliente aguardando resposta", "clientes aguardando resposta"));
  if (has(data.cooledPending) && num(data.cooledPending) > 0) now.push(plural(num(data.cooledPending), "caso de cliente esfriado para você decidir", "casos de clientes esfriados para você decidir"));
  if (now.length) spokenParts.push(`Agora há ${joinPt(now)}.`);
  const trends = [];
  if (leads && previousLeads) trends.push(`os leads ${trendWord(leads.total, previousLeads.total)}`);
  if (funnel && previousFunnel) trends.push(`as vendas ${trendWord(funnel.vendas, previousFunnel.vendas)}`);
  if (trends.length) spokenParts.push(`Comparado ao período anterior, ${joinPt(trends)}.`);

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
      { label: "Clientes esfriados para você decidir", value: has(data.cooledPending) ? String(num(data.cooledPending)) : "—" },
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
  return { facts, spoken: spokenParts.slice(0, 5).join(" "), detail: { title, subtitle: range?.label || "", sections } };
}

// Um corretor no período: as linhas DELE no Desempenho (slimOverview.team) e na Meta (slimTeamGoal.brokers), posição no
// ranking. stats = 1 ou 2 números para o cardzinho da cena.
export function buildHenryBrokerReport({ broker, range, overview, teamGoal } = {}) {
  const row = (overview?.team || []).find((item) => item.id === broker?.id) || null;
  const metaRow = (teamGoal?.brokers || []).find((item) => item.id === broker?.id) || null;
  const rankingIndex = (overview?.ranking || []).findIndex((item) => item.id === broker?.id);
  const name = firstNameOf(broker?.name) || "O corretor";
  const spokenParts = [];
  if (row) {
    spokenParts.push(
      `${name} ${range?.spoken || "no período"}: ${plural(num(row.service), "atendimento", "atendimentos")}, ${plural(num(row.simulation), "simulação", "simulações")}, ${plural(num(row.approval), "aprovado", "aprovados")} e ${plural(num(row.sale), "venda", "vendas")}.`
    );
    spokenParts.push(`Fez ${plural(num(row.points), "ponto", "pontos")}${rankingIndex >= 0 ? ` e está em ${rankingIndex + 1}º no ranking` : ""}.`);
  }
  if (metaRow && num(metaRow.total) > 0) spokenParts.push(`A Meta Diária ficou em ${num(metaRow.percent)}%.`);
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
  return {
    facts: row
      ? { corretor: name, periodo: range?.label || "", atendimentos: num(row.service), simulacoes: num(row.simulation), documentacao: num(row.documentation), aprovados: num(row.approval), vendas: num(row.sale), pontos: num(row.points), posicao_ranking: rankingIndex >= 0 ? rankingIndex + 1 : "fora do ranking", meta_diaria: metaRow && num(metaRow.total) > 0 ? `${num(metaRow.percent)}%` : "sem meta no período" }
      : { corretor: name, periodo: range?.label || "", aviso: "sem números deste corretor no período" },
    spoken: spokenParts.join(" "),
    stats: stats.slice(0, 2),
    detail: { title: name, subtitle: range?.label || "", sections: [{ title: "No período", rows }] }
  };
}

// Busca de cliente por nome: só leitura, só o que a tela de Clientes já mostra (etapa, responsável, último contato,
// próxima atividade). Nunca CPF/documento; telefone só com withPhone (o dono pediu) e só na TELA (a voz nunca fala
// telefone: a barreira safeHenryReply derruba a frase inteira).
export function sanitizeClientSearchTerm(value) {
  return String(value || "")
    .replace(/[,()*%_\\]/g, " ")
    .replace(/\d/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export function buildHenryClientSearch({ term = "", rows = [], statusLabel = (value) => value, brokerName = () => "", formatDate = (value) => value, withPhone = false } = {}) {
  const list = rows.slice(0, 8).map((row) => ({
    nome: String(row.full_name || "Cliente").trim(),
    primeiroNome: firstNameOf(row.full_name) || "Cliente",
    etapa: statusLabel(row.status) || "—",
    responsavel: brokerName(row.responsible_user_id) || "sem responsável",
    ultimoContato: row.last_whatsapp_contact_at ? formatDate(row.last_whatsapp_contact_at) : "sem contato registrado",
    etapaDesde: row.last_status_change_at ? formatDate(row.last_status_change_at) : "",
    proximaAtividade: row.scheduled_activity_at && !row.scheduled_activity_completed_at ? formatDate(row.scheduled_activity_at) : "",
    telefone: withPhone ? String(row.phone || "") : ""
  }));
  const facts = {
    busca: term,
    encontrados: rows.length,
    clientes: list.map((item) => ({ primeiro_nome: item.primeiroNome, etapa: item.etapa, responsavel: firstNameOf(item.responsavel) || item.responsavel, ultimo_contato: item.ultimoContato }))
  };
  const spoken = !list.length
    ? `Não achei nenhum cliente com o nome ${term}.`
    : list.length === 1
      ? `${list[0].primeiroNome} está em ${list[0].etapa}, com ${firstNameOf(list[0].responsavel) || list[0].responsavel}; último contato ${list[0].ultimoContato}.`
      : `Achei ${list.length} clientes com esse nome. Os detalhes estão na tela.`;
  const detail = {
    title: `Clientes: “${term}”`,
    subtitle: list.length ? `${plural(list.length, "resultado", "resultados")}` : "Nenhum resultado",
    sections: list.map((item) => ({
      title: item.nome,
      rows: [
        { label: "Etapa", value: item.etapa, note: item.etapaDesde ? `desde ${item.etapaDesde}` : "" },
        { label: "Responsável", value: item.responsavel },
        { label: "Último contato", value: item.ultimoContato },
        ...(item.proximaAtividade ? [{ label: "Próxima atividade", value: item.proximaAtividade }] : []),
        ...(item.telefone ? [{ label: "Telefone", value: item.telefone }] : [])
      ]
    }))
  };
  return { facts, spoken, detail };
}
