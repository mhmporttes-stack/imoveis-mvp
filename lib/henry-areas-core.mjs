// Henry: "acesso a tudo" (REGRA OFICIAL do dono, 2026-10-26 — HENRY-1 "Leitura ampla", reforço: "Faça um pente fino e veja o
// que o Henry ainda não tem acesso no CRM, depois libere tudo… ele deve ter acesso a tudo e todas as informações").
// Montagem PURA das áreas da ferramenta `consultar_area` (lib/henry-voice.js). Os números vêm das MESMAS funções das telas
// (lib/henry-areas.js) — aqui só se conta, ordena e escreve a fala curta + o detalhe da tela. Nenhuma métrica nova.
// Barreiras que continuam: voz nunca fala CPF/documento/telefone/e-mail; dinheiro na voz só para o dono (`ownerMoney`) e só
// como "N reais"; o detalhe da tela pode mostrar o dado completo (a fala é filtrada depois por safeHenryReply/isSafeToSpeak).

import { addDays, mondayOf } from "./alexa-v2/periods.mjs";
import { clientFirstNameOf, firstNameOf } from "./alexa-v2/text.mjs";
import { contagem } from "./pt-br-concordancia.mjs";
import { HENRY_PERIOD_IDS, countDays, resolveHenryPeriod, shortDateBR } from "./henry-reports-core.mjs";

export { HENRY_AREAS, HENRY_AREA_IDS } from "./henry-areas-catalog.mjs";
import { HENRY_AREAS } from "./henry-areas-catalog.mjs";
// Períodos da Agenda além dos do Henry: o futuro (a agenda é o único assunto com dias que ainda não vieram).
export const HENRY_AGENDA_PERIOD_IDS = ["amanha", "proximos_7_dias", "proxima_semana", "proximos_30_dias"];
export const HENRY_AREA_PERIOD_IDS = [...HENRY_PERIOD_IDS, ...HENRY_AGENDA_PERIOD_IDS];
const AGENDA_MAX_DAYS = 92;
const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

// Período de uma área: o pedido; sem pedido, o padrão da área. Agenda aceita futuro (amanhã, próximos dias, intervalo à
// frente, até 92 dias); as outras usam resolveHenryPeriod (nunca passam de hoje).
export function resolveAreaPeriod(area, input = {}, today) {
  const periodo = HENRY_AREA_PERIOD_IDS.includes(input?.periodo) ? input.periodo : HENRY_AREAS[area]?.periodo || "hoje";
  if (area === "agenda") {
    const future = (startDate, endDate, label, spoken) => ({ id: periodo, startDate, endDate, days: countDays(startDate, endDate), label: `${label} (${shortDateBR(startDate)}${startDate === endDate ? "" : ` a ${shortDateBR(endDate)}`})`, spoken });
    if (periodo === "amanha") return future(addDays(today, 1), addDays(today, 1), "Amanhã", "amanhã");
    if (periodo === "proximos_7_dias") return future(today, addDays(today, 6), "Próximos 7 dias", "nos próximos 7 dias");
    if (periodo === "proximos_30_dias") return future(today, addDays(today, 29), "Próximos 30 dias", "nos próximos 30 dias");
    if (periodo === "proxima_semana") {
      const start = addDays(mondayOf(today), 7);
      return future(start, addDays(start, 6), "Próxima semana", "na próxima semana");
    }
    if (periodo === "intervalo") {
      let start = isDateKey(input?.inicio) ? input.inicio : today;
      let end = isDateKey(input?.fim) ? input.fim : start;
      if (start > end) [start, end] = [end, start];
      if (countDays(start, end) > AGENDA_MAX_DAYS) end = addDays(start, AGENDA_MAX_DAYS - 1);
      return future(start, end, start === end ? shortDateBR(start) : `${shortDateBR(start)} a ${shortDateBR(end)}`, start === end ? `em ${shortDateBR(start)}` : `de ${shortDateBR(start)} a ${shortDateBR(end)}`);
    }
  }
  if (!HENRY_PERIOD_IDS.includes(periodo)) return resolveHenryPeriod({ periodo: "hoje" }, today);
  return resolveHenryPeriod({ periodo, inicio: input?.inicio, fim: input?.fim }, today);
}

// --- Auxiliares ----------------------------------------------------------------------------------------------------------
const count = (n, one, many, options) => contagem(Number(n) || 0, one, many, options);
const joinPt = (list) => {
  const items = list.filter(Boolean);
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
};
export const reaisSpoken = (value) => `${Math.round(Number(value) || 0).toLocaleString("pt-BR")} reais`;
export const dolaresSpoken = (value) => {
  const n = Number(value) || 0;
  return n > 0 && n < 1 ? "menos de 1 dólar" : `${Math.round(n).toLocaleString("pt-BR")} ${Math.round(n) === 1 ? "dólar" : "dólares"}`;
};
const brl = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
const usd = (value) => `US$ ${(Number(value) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const WHEN = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
export function whenText(iso) {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? WHEN.format(new Date(time)).replace(", ", " às ") : "";
}
const dayText = (iso) => (Number.isFinite(Date.parse(iso)) ? DAY.format(new Date(Date.parse(iso))) : "");
const dayKeyOf = (iso) => {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
  return parts;
};
export const inRange = (iso, range) => {
  const key = dayKeyOf(iso);
  return Boolean(key) && key >= range.startDate && key <= range.endDate;
};
const topCounts = (items, keyOf) => {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (key) map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "pt-BR"));
};
const detail = (title, subtitle, sections) => ({ title, subtitle, sections: sections.filter((section) => section && section.rows.length) });
const emptyRows = (rows, label = "Nada encontrado") => (rows.length ? rows : [{ label, value: "" }]);
const ACTIVITY_TYPES = { follow_up: "retorno", reuniao: "reunião", reunião: "reunião", ligacao: "ligação", visita: "visita", documentos: "documentos", outro: "atividade" };
const activityTypeLabel = (type, title = "") => {
  const key = String(type || "").toLowerCase();
  if (key.startsWith("reuni")) return "reunião";
  return ACTIVITY_TYPES[key] || (title ? String(title).slice(0, 40) : "atividade");
};

// --- Agenda (Agenda do CRM: calendar_activities + atividade do card, as mesmas duas fontes da tela) ---------------------
// activities: [{ at, type, title, status: "pending"|"completed"|"rescheduled", clientName, brokerId }]
export function buildHenryAgendaReport({ activities = [], range, brokerName = () => "", onlyBroker = "", now = Date.now() } = {}) {
  const list = (Array.isArray(activities) ? activities : []).filter((item) => Number.isFinite(Date.parse(item?.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const pending = list.filter((item) => item.status === "pending");
  const done = list.filter((item) => item.status === "completed");
  const late = pending.filter((item) => Date.parse(item.at) < now);
  const upcoming = pending.filter((item) => Date.parse(item.at) >= now);
  const who = onlyBroker ? ` de ${firstNameOf(onlyBroker)}` : " da equipe";
  const describe = (item) => {
    const client = clientFirstNameOf(item.clientName);
    const broker = onlyBroker ? "" : firstNameOf(brokerName(item.brokerId));
    return `${activityTypeLabel(item.type, item.title)}${client ? ` com ${client}` : ""}${broker ? ` (${broker})` : ""} ${whenText(item.at)}`.trim();
  };
  let spoken;
  if (!list.length) spoken = `Não há atividades na agenda${who} ${range.spoken}.`;
  else {
    const parts = [count(list.length, "atividade", "atividades")];
    const split = [pending.length ? count(pending.length, "pendente", "pendentes") : "", done.length ? count(done.length, "concluída", "concluídas") : "", late.length ? count(late.length, "atrasada", "atrasadas") : ""].filter(Boolean);
    spoken = `Na agenda${who} ${range.spoken} há ${parts[0]}${split.length ? ` (${joinPt(split)})` : ""}.`;
    const next = upcoming.slice(0, 3).map(describe);
    if (next.length) spoken += ` ${next.length === 1 ? "A próxima" : "As próximas"}: ${joinPt(next)}.`;
  }
  const byBroker = topCounts(list, (item) => brokerName(item.brokerId) || "Sem responsável");
  return {
    spoken,
    facts: { periodo: range.label, total: list.length, pendentes: pending.length, concluidas: done.length, atrasadas: late.length, por_corretor: Object.fromEntries(byBroker.slice(0, 12)), proximas: upcoming.slice(0, 5).map(describe) },
    detail: detail("Agenda", `${range.label}${onlyBroker ? ` · ${onlyBroker}` : ""}`, [
      { title: "Atividades", rows: emptyRows(list.slice(0, 60).map((item) => ({ label: `${activityTypeLabel(item.type, item.title)}${item.clientName ? ` · ${item.clientName}` : ""}`, value: whenText(item.at), note: [onlyBroker ? "" : brokerName(item.brokerId), item.status === "completed" ? "concluída" : Date.parse(item.at) < now ? "atrasada" : "pendente"].filter(Boolean).join(" · ") }))) },
      onlyBroker ? null : { title: "Por corretor", rows: byBroker.map(([name, n]) => ({ label: name, value: String(n) })) }
    ])
  };
}

// --- Contagens da tela Clientes (getSimulationClientCounters: as MESMAS abas e números da lista) ------------------------
// groups: [{ key, label, count }]; byStatus: { status: n }; statusLabel(status)
export function buildHenryClientTabsReport({ groups = [], byStatus = {}, statusLabel = (value) => value, onlyBroker = "" } = {}) {
  const who = onlyBroker ? ` de ${firstNameOf(onlyBroker)}` : "";
  const get = (key) => Number(groups.find((group) => group.key === key)?.count) || 0;
  const archived = Number(byStatus.archived) || 0;
  const doNotContact = Number(byStatus.do_not_contact) || 0;
  const main = groups.filter((group) => !["all", "archived"].includes(group.key) && Number(group.count) > 0).map((group) => `${group.label.toLowerCase()} ${group.count}`);
  const spoken = `Na tela Clientes${who}, a aba Todos tem ${count(get("all"), "cliente", "clientes")}${main.length ? ` (${joinPt(main.slice(0, 6))})` : ""}. Arquivados: ${archived}; Não contactar: ${doNotContact}.`;
  const statusRows = Object.entries(byStatus).filter(([, n]) => Number(n) > 0).sort((a, b) => b[1] - a[1]).map(([status, n]) => ({ label: statusLabel(status), value: String(n) }));
  return {
    spoken,
    facts: { abas: Object.fromEntries(groups.map((group) => [group.label, Number(group.count) || 0])), arquivados: archived, nao_contactar: doNotContact, motivo: "o motivo de cada arquivado/Não contactar está no histórico do cliente (historico_cliente)" },
    detail: detail("Clientes por aba", onlyBroker || "Equipe", [
      { title: "Abas", rows: groups.map((group) => ({ label: group.label, value: String(Number(group.count) || 0) })) },
      { title: "Por etapa", rows: statusRows }
    ])
  };
}

// Documentação/CCA a partir das MESMAS contagens por etapa: aguardando documentação, documentos pendentes, enviados para
// análise (approval_pending = envio à CCA) e o resto da etapa Aprovação, aprovados.
export function buildHenryDocumentationReport({ byStatus = {}, statusLabel = (value) => value, onlyBroker = "" } = {}) {
  const n = (key) => Number(byStatus[key]) || 0;
  const who = onlyBroker ? ` de ${firstNameOf(onlyBroker)}` : "";
  const waiting = n("documentation");
  const pendingDocs = n("documents_pending");
  const sent = n("approval_pending");
  const approvalOthers = ["income_commitment", "cancellation_letter", "research_mo", "restriction", "shielding", "rejected"].reduce((total, key) => total + n(key), 0);
  const approved = n("approved");
  const spoken = `Documentação${who} agora: ${count(waiting, "cliente aguardando documentação", "clientes aguardando documentação")}, ${count(pendingDocs, "com documento pendente", "com documentos pendentes")} e ${count(sent, "enviado para análise", "enviados para análise")} na CCA${approvalOthers ? `; mais ${approvalOthers} na etapa de aprovação com outra situação` : ""}. Aprovados: ${approved}.`;
  const keys = ["documentation", "documents_pending", "approval_pending", "income_commitment", "cancellation_letter", "research_mo", "restriction", "shielding", "rejected", "approved"];
  return {
    spoken,
    facts: { aguardando_documentacao: waiting, documentos_pendentes: pendingDocs, enviados_para_analise_cca: sent, aprovacao_outras_situacoes: approvalOthers, aprovados: approved, detalhe_por_cliente: "documentos e CCA de um cliente: buscar_clientes" },
    detail: detail("Documentação e CCA", onlyBroker || "Equipe", [{ title: "Agora", rows: keys.map((key) => ({ label: statusLabel(key), value: String(n(key)) })) }])
  };
}

// --- Histórico (linha do tempo) de um cliente: getPrivateJourney + títulos de lib/journey-event-labels.mjs -------------
// events: [{ title, description, at }]
export function buildHenryClientHistoryReport({ clientName = "", events = [], spokenCount = 4 } = {}) {
  const list = (Array.isArray(events) ? events : []).filter((event) => event?.title);
  const name = clientFirstNameOf(clientName) || "do cliente";
  const spokenItems = list.slice(0, spokenCount).map((event) => `${event.title}${dayText(event.at) ? ` em ${dayText(event.at)}` : ""}`);
  const spoken = list.length ? `Histórico ${name === "do cliente" ? name : `de ${name}`}, do mais recente: ${joinPt(spokenItems)}.${list.length > spokenCount ? " O resto está na tela." : ""}` : `Não achei movimentações no histórico ${name === "do cliente" ? name : `de ${name}`}.`;
  return {
    spoken,
    facts: { cliente: clientFirstNameOf(clientName), movimentacoes: list.slice(0, 15).map((event) => ({ titulo: event.title, quando: whenText(event.at) })) },
    detail: detail(`Histórico · ${clientName || "Cliente"}`, `${list.length} movimentações`, [{ title: "Linha do tempo", rows: emptyRows(list.map((event) => ({ label: event.title, value: whenText(event.at), note: event.description || "" }))) }])
  };
}

// --- Etiquetas (listTags + contagens da lista filtradas pela etiqueta) --------------------------------------------------
export function buildHenryTagsReport({ tags = [], query = "", match = null, groups = [] } = {}) {
  const names = (Array.isArray(tags) ? tags : []).map((tag) => tag?.name).filter(Boolean);
  if (match) {
    const total = groups.reduce((sum, group) => (group.key === "all" ? sum : sum + (Number(group.count) || 0)), 0);
    const parts = groups.filter((group) => group.key !== "all" && Number(group.count) > 0).map((group) => `${group.label.toLowerCase()} ${group.count}`);
    return {
      spoken: `A etiqueta ${match.name} está em ${count(total, "cliente", "clientes")}${parts.length ? ` (${joinPt(parts.slice(0, 5))})` : ""}.`,
      facts: { etiqueta: match.name, clientes: total, por_aba: Object.fromEntries(groups.map((group) => [group.label, Number(group.count) || 0])) },
      detail: detail(`Etiqueta ${match.name}`, `${total} clientes`, [{ title: "Por aba", rows: groups.map((group) => ({ label: group.label, value: String(Number(group.count) || 0) })) }])
    };
  }
  const spoken = query
    ? `Não achei a etiqueta "${String(query).slice(0, 40)}". ${names.length ? `Algumas que existem: ${joinPt(names.slice(0, 5))}.` : ""}`.trim()
    : `O CRM tem ${count(names.length, "etiqueta", "etiquetas")}${names.length ? `, como ${joinPt(names.slice(0, 5))}` : ""}.`;
  return { spoken, facts: { total: names.length, etiquetas: names.slice(0, 40) }, detail: detail("Etiquetas", `${names.length} etiquetas`, [{ title: "Etiquetas", rows: emptyRows(names.map((name) => ({ label: name, value: "" }))) }]) };
}

// --- Financeiro detalhado (só o dono): vendas da tela Financeiro (calculateFinancialTotals por venda) + Saúde -----------
// sales: [{ saleDate, saleValue, grossCommission, receivedTotal, receivableTotal, brokerName, clientName, financialStatus }]
// expenses: buildExpensePanel(...) ou null
export function buildHenryFinanceDetailReport({ sales = [], expenses = null, range, onlyBroker = "" } = {}) {
  const all = Array.isArray(sales) ? sales : [];
  const inPeriod = all.filter((sale) => sale.saleDate && sale.saleDate >= range.startDate && sale.saleDate <= range.endDate);
  const sum = (list, key) => list.reduce((total, sale) => total + (Number(sale[key]) || 0), 0);
  const sold = sum(inPeriod, "saleValue");
  const gross = sum(inPeriod, "grossCommission");
  const receivable = sum(all, "receivableTotal");
  const who = onlyBroker ? ` de ${firstNameOf(onlyBroker)}` : "";
  let spoken = inPeriod.length
    ? `${range.spoken[0].toUpperCase()}${range.spoken.slice(1)}, ${count(inPeriod.length, "venda", "vendas")}${who}: ${reaisSpoken(sold)} vendidos e ${reaisSpoken(gross)} de comissão bruta.`
    : `Nenhuma venda${who} registrada ${range.spoken}.`;
  spoken += ` Ainda a receber de todas as vendas${who}: ${reaisSpoken(receivable)}.`;
  if (expenses && !onlyBroker) spoken += ` Despesas ${range.spoken}: ${reaisSpoken(expenses.totalPaid?.amount)} pagas e ${reaisSpoken(expenses.totalToPay?.amount)} a pagar${expenses.overdue?.count ? `, ${count(expenses.overdue.count, "vencida", "vencidas")}` : ""}.`;
  const byBroker = new Map();
  for (const sale of inPeriod) {
    const key = sale.brokerName || "Sem corretor";
    const current = byBroker.get(key) || { vendas: 0, valor: 0 };
    byBroker.set(key, { vendas: current.vendas + 1, valor: current.valor + (Number(sale.saleValue) || 0) });
  }
  return {
    spoken,
    facts: { periodo: range.label, vendas: inPeriod.length, valor_vendido: Math.round(sold), comissao_bruta: Math.round(gross), a_receber_total: Math.round(receivable), despesas: expenses && !onlyBroker ? { pagas: Math.round(expenses.totalPaid?.amount || 0), a_pagar: Math.round(expenses.totalToPay?.amount || 0), vencidas: expenses.overdue?.count || 0 } : null, por_corretor: Object.fromEntries([...byBroker].map(([name, value]) => [name, value.vendas])) },
    detail: detail("Financeiro detalhado", `${range.label}${onlyBroker ? ` · ${onlyBroker}` : ""}`, [
      { title: "Vendas do período", rows: emptyRows(inPeriod.map((sale) => ({ label: `${sale.clientName || "Cliente"} · ${sale.brokerName || "—"}`, value: brl(sale.saleValue), note: `${sale.saleDate.split("-").reverse().join("/")} · comissão ${brl(sale.grossCommission)} · a receber ${brl(sale.receivableTotal)}` })), "Nenhuma venda no período") },
      { title: "Totais", rows: [{ label: "Valor vendido", value: brl(sold) }, { label: "Comissão bruta", value: brl(gross) }, { label: "A receber (todas as vendas)", value: brl(receivable) }] },
      expenses && !onlyBroker ? { title: "Despesas (Saúde)", rows: [{ label: "Pagas no período", value: brl(expenses.totalPaid?.amount) }, { label: "A pagar", value: brl(expenses.totalToPay?.amount) }, { label: "Vencidas", value: `${expenses.overdue?.count || 0} · ${brl(expenses.overdue?.amount)}` }, ...(expenses.upcoming || []).slice(0, 8).map((item) => ({ label: item.description || "Despesa", value: item.dueDate ? item.dueDate.split("-").reverse().join("/") : "", note: item.statusLabel || "" }))] } : null
    ])
  };
}

// --- Gerador de Links (listCampaigns: as MESMAS visitas, envios, clientes e funil da tela) -------------------------------
export function buildHenryCampaignsReport({ campaigns = [], summary = {}, range } = {}) {
  const list = (Array.isArray(campaigns) ? campaigns : []).filter((item) => item && (item.submissionCount || item.viewCount || item.clientCount));
  const top = [...list].sort((a, b) => (b.submissionCount || 0) - (a.submissionCount || 0) || (b.viewCount || 0) - (a.viewCount || 0)).slice(0, 3);
  const spoken = list.length
    ? `Nos links de campanha ${range.spoken}: ${count(summary.views, "visita", "visitas")}, ${count(summary.submissions, "envio", "envios")} do formulário, ${count(summary.clients, "cliente", "clientes")}, ${count(summary.simulation, "simulação", "simulações")} e ${count(summary.sale, "venda", "vendas")}. ${top.length ? `Os que mais trouxeram: ${joinPt(top.map((item) => `${item.name} com ${item.submissionCount || 0}`))}.` : ""}`.trim()
    : `Nenhum link de campanha teve movimento ${range.spoken}.`;
  return {
    spoken,
    facts: { periodo: range.label, visitas: summary.views || 0, envios: summary.submissions || 0, clientes: summary.clients || 0, simulacoes: summary.simulation || 0, vendas: summary.sale || 0, campanhas: top.map((item) => ({ nome: item.name, envios: item.submissionCount || 0, visitas: item.viewCount || 0, corretor: firstNameOf(item.brokerName) })) },
    detail: detail("Links de campanha", range.label, [{ title: "Campanhas", rows: emptyRows([...list].sort((a, b) => (b.submissionCount || 0) - (a.submissionCount || 0)).slice(0, 40).map((item) => ({ label: item.name || "Campanha", value: `${item.submissionCount || 0} envios`, note: `${item.viewCount || 0} visitas · ${item.clientCount || 0} clientes · ${item.funnel?.simulation || 0} simulações · ${item.funnel?.sale || 0} vendas${item.brokerName ? ` · ${item.brokerName}` : " · roleta"}` }))) }])
  };
}

// --- Tráfego Meta (getAdsBoard sem renovar miniaturas: só lê o que a sincronização já gravou) ---------------------------
export function adsBoardPeriodFor(range) {
  if (range?.id === "hoje") return { period: "today", spoken: "hoje" };
  if ((range?.days || 0) <= 7) return { period: "7d", spoken: "nos últimos 7 dias" };
  return { period: "30d", spoken: "nos últimos 30 dias" };
}
export function buildHenryTrafficReport({ board = null, periodSpoken = "", ownerMoney = false } = {}) {
  if (!board?.configured) return { spoken: "A conta de anúncios da Meta não está configurada no CRM.", facts: { configurado: false }, detail: null };
  const ads = Array.isArray(board.ads) ? board.ads : [];
  const summary = board.summary || {};
  const crmLeads = ads.reduce((total, ad) => total + (Number(ad.metrics?.crmLeads) || 0), 0);
  const top = [...ads].filter((ad) => Number(ad.metrics?.spend) > 0).sort((a, b) => b.metrics.spend - a.metrics.spend)[0];
  const money = ownerMoney
    ? `gasto de ${reaisSpoken(summary.spend)}, ${count(summary.results, "resultado", "resultados")}${summary.costPerResult ? `, ${reaisSpoken(summary.costPerResult)} por resultado` : ""}`
    : count(summary.results, "resultado", "resultados");
  const spoken = `Nos anúncios ${periodSpoken}: ${money}, ${count(crmLeads, "cliente que entrou no CRM", "clientes que entraram no CRM")} e ${count(summary.activeCount, "anúncio ativo", "anúncios ativos")}.${top ? ` O que mais gastou foi ${top.campaignShort || top.name}.` : ""}`;
  return {
    spoken,
    facts: { periodo: periodSpoken, gasto: ownerMoney ? summary.spend || 0 : "na tela", resultados: summary.results || 0, custo_por_resultado: ownerMoney ? summary.costPerResult : "na tela", clientes_no_crm: crmLeads, anuncios_ativos: summary.activeCount || 0, sincronizado: board.syncedAtLabel || "" },
    detail: detail("Anúncios da Meta", `${periodSpoken}${board.syncedAtLabel ? ` · ${board.syncedAtLabel}` : ""}`, [
      { title: "Resumo", rows: [{ label: "Gasto", value: brl(summary.spend) }, { label: "Resultados", value: String(summary.results || 0) }, { label: "Custo por resultado", value: summary.costPerResult ? brl(summary.costPerResult) : "—" }, { label: "Clientes no CRM", value: String(crmLeads) }, { label: "Anúncios ativos", value: String(summary.activeCount || 0) }] },
      { title: "Anúncios", rows: ads.slice(0, 30).map((ad) => ({ label: ad.name, value: brl(ad.metrics?.spend), note: `${ad.statusLabel || ""} · ${ad.metrics?.results || 0} resultados · ${ad.metrics?.crmLeads || 0} no CRM${ad.metrics?.costPerResult ? ` · ${brl(ad.metrics.costPerResult)}/resultado` : ""}` })) }
    ])
  };
}

// --- Roleta (listLeadDistributionDashboard: a mesma tela da roleta em Automações) ---------------------------------------
const PRESENCE_ONLINE = new Set(["online"]);
export function buildHenryRouletteReport({ dashboard = null, range, onlyBroker = "" } = {}) {
  const brokers = (dashboard?.brokers || []).filter((broker) => broker.status !== "inactive");
  const enabled = brokers.filter((broker) => broker.enabled);
  const online = enabled.filter((broker) => PRESENCE_ONLINE.has(broker.presence));
  const history = (dashboard?.history || []).filter((item) => inRange(item.createdAt, range) && (!onlyBroker || item.toUserName === onlyBroker || item.fromUserName === onlyBroker));
  const received = topCounts(history, (item) => item.toUserName);
  const spokenReceived = received.slice(0, 4).map(([name, n]) => `${firstNameOf(name)} ${n}`);
  const spoken = `Na roleta, ${count(enabled.length, "pessoa está", "pessoas estão")} com a distribuição ligada e ${`${online.length} on-line agora`}${online.length ? ` (${joinPt(online.slice(0, 5).map((broker) => firstNameOf(broker.name)))})` : ""}. ${history.length ? `${range.spoken[0].toUpperCase()}${range.spoken.slice(1)}, ${count(history.length, "distribuição", "distribuições")}${spokenReceived.length ? `: ${joinPt(spokenReceived)}` : ""}.` : `Nenhuma distribuição ${range.spoken} no histórico recente.`}`;
  return {
    spoken,
    facts: { distribuicao_ligada: enabled.map((broker) => firstNameOf(broker.name)), online_agora: online.map((broker) => firstNameOf(broker.name)), distribuicoes_no_periodo: history.length, recebidos_por_pessoa: Object.fromEntries(received), observacao: "histórico = as últimas 100 distribuições da tela" },
    detail: detail("Roleta", range.label, [
      { title: "Fila da roleta", rows: emptyRows(enabled.map((broker) => ({ label: broker.name, value: broker.presence === "online" ? "on-line" : broker.presence === "away" ? "ausente" : "off-line", note: `${broker.clientCount} clientes` }))) },
      { title: "Distribuições do período", rows: emptyRows(history.slice(0, 40).map((item) => ({ label: `${item.clientName || "Cliente"} → ${item.toUserName}`, value: whenText(item.createdAt), note: [item.sourceLabel, item.fromUserName ? `de ${item.fromUserName}` : ""].filter(Boolean).join(" · ") }))) }
    ])
  };
}

// --- Marketplace e Messenger (listMarketplaceListings + listMarketplaceConversations + sinal da extensão) --------------
export function buildHenryMarketplaceReport({ listings = [], conversations = [], extension = null, onlyBroker = "", now = Date.now() } = {}) {
  const byStatus = topCounts(listings, (item) => item.status);
  const n = (status) => byStatus.find(([key]) => key === status)?.[1] || 0;
  const convs = (Array.isArray(conversations) ? conversations : []).filter((item) => !onlyBroker || item.assignedName === onlyBroker);
  const messenger = convs.filter((item) => item.channel === "messenger").length;
  const waiting = convs.filter((item) => item.waiting).length;
  const unread = convs.reduce((total, item) => total + (Number(item.unreadCount) || 0), 0);
  const perBroker = topCounts(convs, (item) => item.assignedName || "");
  const lastSync = extension?.lastSyncAt ? Math.round((now - Date.parse(extension.lastSyncAt)) / 60000) : null;
  const who = onlyBroker ? ` de ${firstNameOf(onlyBroker)}` : "";
  let spoken = onlyBroker ? "" : `No Marketplace: ${count(n("published"), "anúncio publicado", "anúncios publicados")}, ${count(n("pending"), "na fila", "na fila")}${n("failed") ? ` e ${count(n("failed"), "com falha", "com falha")}` : ""}. `;
  spoken += `Conversas${who}: ${convs.length}${messenger ? ` (${messenger} do Messenger)` : ""}, ${count(waiting, "esperando na roleta", "esperando na roleta")} e ${count(unread, "mensagem não lida", "mensagens não lidas")}.`;
  if (!onlyBroker && perBroker.length) spoken += ` Por corretor: ${joinPt(perBroker.slice(0, 4).map(([name, value]) => `${firstNameOf(name)} ${value}`))}.`;
  if (!onlyBroker && Number.isFinite(lastSync)) spoken += ` A extensão leu há ${count(Math.max(lastSync, 0), "minuto", "minutos")}.`;
  return {
    spoken: spoken.trim(),
    facts: { anuncios: Object.fromEntries(byStatus), conversas: convs.length, messenger, esperando_roleta: waiting, nao_lidas: unread, por_corretor: Object.fromEntries(perBroker), extensao_minutos_desde_leitura: lastSync, observacao: "conversas = as 200 mais recentes da tela" },
    detail: detail("Marketplace e Messenger", onlyBroker || "Equipe", [
      onlyBroker ? null : { title: "Anúncios", rows: byStatus.map(([status, value]) => ({ label: status, value: String(value) })) },
      { title: "Conversas recentes", rows: emptyRows(convs.slice(0, 30).map((item) => ({ label: `${item.contactName || "Contato"}${item.listingTitle ? ` · ${item.listingTitle}` : ""}`, value: item.assignedName || (item.waiting ? "na roleta" : "sem corretor"), note: `${item.channel === "messenger" ? "Messenger" : "Marketplace"} · ${whenText(item.lastMessageAt)}${item.unreadCount ? ` · ${item.unreadCount} não lidas` : ""}` }))) }
    ])
  };
}

// --- Academia (gestão da equipe: listTeam, o mesmo resumo da aba Equipe do editor) --------------------------------------
export function buildHenryAcademyReport({ enabled = true, team = null, onlyBroker = "" } = {}) {
  if (!enabled || !team) return { spoken: "A Academia está desligada no CRM.", facts: { ligada: false }, detail: null };
  const members = (team.members || []).filter((member) => !onlyBroker || member.name === onlyBroker);
  if (onlyBroker) {
    const member = members[0];
    const rows = member?.enrollments || [];
    const spoken = !member ? `Não achei ${firstNameOf(onlyBroker)} na Academia.` : rows.length ? `${firstNameOf(member.name)} na Academia: ${joinPt(rows.map((item) => `${item.trackTitle} com ${item.percent} por cento${item.status === "completed" ? ", concluída" : item.overdue ? ", atrasada" : ""}`))}.` : `${firstNameOf(member.name)} ainda não tem formação na Academia.`;
    return { spoken, facts: { pessoa: firstNameOf(onlyBroker), formacoes: rows.map((item) => ({ trilha: item.trackTitle, percentual: item.percent, situacao: item.status, atrasada: item.overdue })) }, detail: detail(`Academia · ${onlyBroker}`, "", [{ title: "Formações", rows: emptyRows(rows.map((item) => ({ label: item.trackTitle, value: `${item.percent}%`, note: `${item.lessonsDone}/${item.lessonsTotal} aulas${item.overdue ? " · atrasada" : ""}${item.certificate ? " · certificado" : ""}` }))) }]) };
  }
  const summary = team.summary || {};
  const spoken = `Na Academia: ${count(summary.people, "pessoa", "pessoas")}, ${count(summary.withEnrollment, "com formação", "com formação")}; ${count(summary.completed, "formação concluída", "formações concluídas")}, ${count(summary.inProgress, "em andamento", "em andamento")}${summary.overdue ? ` e ${count(summary.overdue, "atrasada", "atrasadas")}` : ""}.`;
  return {
    spoken,
    facts: { pessoas: summary.people || 0, com_formacao: summary.withEnrollment || 0, concluidas: summary.completed || 0, em_andamento: summary.inProgress || 0, atrasadas: summary.overdue || 0, por_pessoa: members.slice(0, 30).map((member) => ({ nome: firstNameOf(member.name), percentual: member.enrollments[0]?.percent ?? null })) },
    detail: detail("Academia", "Equipe", [{ title: "Pessoas", rows: emptyRows(members.map((member) => ({ label: member.name, value: member.enrollments.length ? `${member.enrollments[0].percent}%` : "sem formação", note: member.enrollments.map((item) => `${item.trackTitle}${item.overdue ? " (atrasada)" : ""}`).join(" · ") }))) }])
  };
}

// --- Automações e fluxos (listAutomationRules + listWhatsappFlows) -------------------------------------------------------
export function buildHenryAutomationsReport({ rules = [], flows = [] } = {}) {
  const on = rules.filter((rule) => rule.enabled);
  const activeFlows = flows.filter((flow) => flow.status === "active");
  const live = flows.reduce((total, flow) => total + (Number(flow.liveSessions) || 0), 0);
  const lastRun = on.map((rule) => rule.lastRunAt).filter(Boolean).sort().at(-1);
  const spoken = `Automações: ${count(on.length, "regra ligada", "regras ligadas")} de ${rules.length}${lastRun ? `, a última rodou ${whenText(lastRun)}` : ""}. Fluxos do WhatsApp: ${count(activeFlows.length, "ativo", "ativos")} de ${flows.length}${live ? `, com ${count(live, "conversa em andamento", "conversas em andamento")}` : ""}.`;
  return {
    spoken,
    facts: { regras_ligadas: on.map((rule) => rule.name), regras_total: rules.length, fluxos_ativos: activeFlows.map((flow) => flow.name), conversas_em_fluxo: live, observacao: "falhas de cada execução não aparecem nesta leitura; o histórico de cada fluxo está na tela Automações" },
    detail: detail("Automações", "", [
      { title: "Regras", rows: emptyRows(rules.map((rule) => ({ label: rule.name, value: rule.enabled ? "ligada" : "desligada", note: `${rule.runCount || 0} execuções${rule.lastRunAt ? ` · última ${whenText(rule.lastRunAt)}` : ""}` }))) },
      { title: "Fluxos do WhatsApp", rows: emptyRows(flows.map((flow) => ({ label: flow.name, value: flow.status === "active" ? "ativo" : flow.status === "paused" ? "pausado" : "rascunho", note: `${flow.triggeredCount || 0} disparos · ${flow.liveSessions || 0} em andamento` }))) }
    ])
  };
}

// --- Central de Alertas: definições (admin geral) + os alertas do PRÓPRIO dono (alerta é privado do destinatário) -------
export function buildHenryAlertsReport({ definitions = [], mine = { items: [], pending: 0 } } = {}) {
  const on = definitions.filter((item) => item.enabled);
  const items = Array.isArray(mine?.items) ? mine.items : [];
  const spoken = `Na Central de Alertas há ${count(on.length, "alerta ligado", "alertas ligados")} de ${definitions.length}. Seus avisos dos últimos 30 dias: ${items.length}${mine?.pending ? `, ${count(mine.pending, "sem ciência", "sem ciência")}` : ""}${items[0]?.title ? `; o mais recente: ${items[0].title}` : ""}.`;
  return {
    spoken,
    facts: { alertas_ligados: on.map((item) => item.title || item.key), seus_avisos_30_dias: items.length, sem_ciencia: mine?.pending || 0, recentes: items.slice(0, 5).map((item) => item.title), observacao: "alertas de outras pessoas são privados delas (regra do dono)" },
    detail: detail("Central de Alertas", "", [
      { title: "Seus avisos (30 dias)", rows: emptyRows(items.slice(0, 30).map((item) => ({ label: item.title || "Aviso", value: whenText(item.createdAt), note: item.acknowledged ? "ciente" : "pendente" }))) },
      { title: "Alertas configurados", rows: emptyRows(definitions.map((item) => ({ label: item.title || item.key, value: item.enabled ? "ligado" : "desligado", note: item.kind === "important" ? "Importante" : "Informativo" }))) }
    ])
  };
}

// --- Mensagem do dia (getDailyMessageSettings + listDailyMessageDispatchHistory) -----------------------------------------
const MESSAGE_TYPES = { biblical: "bíblica", reflection: "reflexão", alternate: "alternando bíblica e reflexão" };
export function buildHenryDailyMessageReport({ settings = {}, dispatches = [] } = {}) {
  const last = dispatches[0];
  const spoken = `A mensagem do dia está ${settings.enabled ? "ligada" : "desligada"}${settings.enabled ? `, sai às ${settings.startTime}, tipo ${MESSAGE_TYPES[settings.contentType] || settings.contentType}` : ""}.${last ? ` O último envio foi ${whenText(last.createdAt)}: ${count(last.recipients, "pessoa", "pessoas")}, ${last.completed} concluíram.` : ""}`;
  return {
    spoken,
    facts: { ligada: Boolean(settings.enabled), horario: settings.startTime || "", tipo: MESSAGE_TYPES[settings.contentType] || "", ultimos_envios: dispatches.slice(0, 5).map((item) => ({ quando: whenText(item.createdAt), pessoas: item.recipients, concluiram: item.completed })) },
    detail: detail("Mensagem do dia", settings.enabled ? `ligada · ${settings.startTime}` : "desligada", [{ title: "Últimos envios", rows: emptyRows(dispatches.slice(0, 15).map((item) => ({ label: String(item.card?.mainText || "Mensagem").slice(0, 90), value: whenText(item.createdAt), note: `${item.recipients} pessoas · ${item.completed} concluíram` }))) }])
  };
}

// --- Pontuação (listCurrentScoringRules + listManualAdjustments): o que vale cada ação e os ajustes manuais ---------------
export function buildHenryScoringReport({ rules = [], adjustments = [], range } = {}) {
  const active = rules.filter((rule) => rule.active && !rule.unit);
  const total = adjustments.reduce((sum, item) => sum + (Number(item.points) || 0), 0);
  const spoken = `Pontos por ação: ${joinPt(active.slice(0, 8).map((rule) => `${rule.label.toLowerCase()} ${rule.points}`))}. Ajustes manuais ${range.spoken}: ${adjustments.length}${adjustments.length ? `, somando ${total} pontos` : ""}.`;
  return {
    spoken,
    facts: { regras: Object.fromEntries(rules.map((rule) => [rule.label, rule.active ? rule.points : "desligada"])), ajustes_manuais: adjustments.slice(0, 20).map((item) => ({ corretor: firstNameOf(item.brokerName), pontos: item.points, motivo: String(item.reason || "").slice(0, 80) })) },
    detail: detail("Pontuação", range.label, [
      { title: "Regras vigentes", rows: rules.map((rule) => ({ label: rule.label, value: rule.active ? `${rule.points}${rule.unit ? ` ${rule.unit}` : " pts"}` : "desligada", note: rule.description || "" })) },
      { title: "Ajustes manuais", rows: emptyRows(adjustments.slice(0, 40).map((item) => ({ label: `${item.brokerName} · ${item.points > 0 ? "+" : ""}${item.points}`, value: whenText(item.createdAt), note: `${item.reason || ""} · por ${item.createdByName}` }))) }
    ])
  };
}

// --- Equipe (listAdminProfiles: a tela Corretores/Usuários) — sem telefone nem e-mail -----------------------------------
const ROLE_LABELS = { admin: "administrador", manager: "gestor", broker: "corretor", associate: "associado" };
const ROLE_PLURALS = { admin: "administradores", manager: "gestores", broker: "corretores", associate: "associados" };
export function buildHenryTeamReport({ profiles = [], onlyBroker = "" } = {}) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const active = profiles.filter((profile) => profile.status !== "inactive");
  const describe = (profile) => ({
    nome: profile.name,
    cargo: ROLE_LABELS[profile.role] || profile.role,
    gestor: byId.get(profile.managerId)?.name || "",
    corretor_vinculado: byId.get(profile.linkedBrokerId)?.name || "",
    creci: profile.hasCreci,
    roleta_ligada: profile.leadDistributionEnabled,
    ativo: profile.status !== "inactive"
  });
  if (onlyBroker) {
    const profile = profiles.find((item) => item.name === onlyBroker);
    if (!profile) return { spoken: `Não achei ${firstNameOf(onlyBroker)} na equipe.`, facts: {}, detail: null };
    const info = describe(profile);
    const spoken = `${firstNameOf(profile.name)} é ${info.cargo}${info.ativo ? "" : " (inativo)"}${info.gestor ? `, da equipe de ${firstNameOf(info.gestor)}` : ""}${info.corretor_vinculado ? `, vinculado a ${firstNameOf(info.corretor_vinculado)}` : ""}, ${info.creci ? "com CRECI" : "sem CRECI"} e com a roleta ${info.roleta_ligada ? "ligada" : "desligada"}.`;
    return { spoken, facts: info, detail: detail(profile.name, info.cargo, [{ title: "Cadastro", rows: [{ label: "Cargo", value: info.cargo }, { label: "Gestor", value: info.gestor || "—" }, { label: "Corretor vinculado", value: info.corretor_vinculado || "—" }, { label: "CRECI", value: info.creci ? "sim" : "não" }, { label: "Roleta", value: info.roleta_ligada ? "ligada" : "desligada" }, { label: "Situação", value: info.ativo ? "ativo" : "inativo" }] }]) };
  }
  const roles = topCounts(active, (profile) => profile.role);
  const managers = active.filter((profile) => profile.role === "manager");
  const spoken = `A equipe tem ${count(active.length, "pessoa ativa", "pessoas ativas")}: ${joinPt(roles.map(([role, n]) => count(n, ROLE_LABELS[role] || role, ROLE_PLURALS[role] || role)))}.${managers.length ? ` ${managers.length === 1 ? "Gestor" : "Gestores"}: ${joinPt(managers.map((profile) => firstNameOf(profile.name)))}.` : ""}`;
  return {
    spoken,
    facts: { ativos: active.length, inativos: profiles.length - active.length, por_cargo: Object.fromEntries(roles.map(([role, n]) => [ROLE_LABELS[role] || role, n])), pessoas: active.map(describe) },
    detail: detail("Equipe", `${active.length} ativos`, [{ title: "Pessoas", rows: profiles.map((profile) => { const info = describe(profile); return { label: profile.name, value: info.cargo, note: [info.gestor ? `gestor: ${info.gestor}` : "", info.corretor_vinculado ? `vinculado a ${info.corretor_vinculado}` : "", info.creci ? "CRECI" : "", info.roleta_ligada ? "roleta ligada" : "", info.ativo ? "" : "inativo"].filter(Boolean).join(" · ") }; }) }])
  };
}

// --- Captações (listCaptacoes) — sem telefone/e-mail do proprietário; preço só na tela --------------------------------
const CAPTACAO_STATUS = { nova: "nova", em_analise: "em análise", aprovada_publicacao: "aprovada para publicação", publicada: "publicada", descartada: "descartada" };
export function buildHenryCaptacoesReport({ captacoes = [], range } = {}) {
  const inPeriod = captacoes.filter((item) => inRange(item.createdAt, range));
  const byStatus = topCounts(captacoes, (item) => item.status);
  const recent = inPeriod.slice(0, 3).map((item) => [item.propertyType || "imóvel", item.neighborhood ? `no ${item.neighborhood}` : ""].filter(Boolean).join(" "));
  const spoken = `${range.spoken[0].toUpperCase()}${range.spoken.slice(1)} chegaram ${count(inPeriod.length, "captação", "captações")}${recent.length ? `: ${joinPt(recent)}` : ""}. No total: ${joinPt(byStatus.slice(0, 4).map(([status, n]) => `${n} ${CAPTACAO_STATUS[status] || status}`))}.`;
  return {
    spoken,
    facts: { periodo: range.label, no_periodo: inPeriod.length, por_situacao: Object.fromEntries(byStatus.map(([status, n]) => [CAPTACAO_STATUS[status] || status, n])) },
    detail: detail("Captações", range.label, [{ title: "Do período", rows: emptyRows(inPeriod.slice(0, 40).map((item) => ({ label: `${item.propertyType || "Imóvel"}${item.neighborhood ? ` · ${item.neighborhood}` : ""}${item.city ? ` · ${item.city}` : ""}`, value: CAPTACAO_STATUS[item.status] || item.status, note: `${item.ownerName || ""} · ${whenText(item.createdAt)}${item.intendedPrice ? ` · ${brl(item.intendedPrice)}` : ""}` }))) }])
  };
}

// --- Gastos de IA (getAiUsageReport: as últimas 1.000 chamadas da tela) --------------------------------------------------
export function buildHenryAiCostReport({ entries = [], range, ownerMoney = false } = {}) {
  const inPeriod = entries.filter((item) => inRange(item.createdAt, range));
  const total = inPeriod.reduce((sum, item) => sum + (Number(item.costUsd) || 0), 0);
  const failures = inPeriod.filter((item) => item.success === false).length;
  const byFeature = new Map();
  for (const item of inPeriod) byFeature.set(item.feature, (byFeature.get(item.feature) || 0) + (Number(item.costUsd) || 0));
  const top = [...byFeature].sort((a, b) => b[1] - a[1]);
  const oldest = entries.at(-1)?.createdAt;
  const truncated = entries.length >= 1000 && oldest && dayKeyOf(oldest) > range.startDate;
  const spoken = `Gastos de IA ${range.spoken}: ${ownerMoney ? `${dolaresSpoken(total)} em ` : ""}${count(inPeriod.length, "chamada", "chamadas")}${failures ? `, ${count(failures, "falha", "falhas", { genero: "f" })}` : ""}${top[0] ? `; o que mais gastou foi ${top[0][0].replace(/_/g, " ")}` : ""}.${truncated ? " A tela guarda só as últimas mil chamadas, então o começo do período pode faltar." : ""}`;
  return {
    spoken,
    facts: { periodo: range.label, custo_usd: ownerMoney ? Math.round(total * 100) / 100 : "na tela", chamadas: inPeriod.length, falhas: failures, por_recurso_usd: ownerMoney ? Object.fromEntries(top.map(([feature, value]) => [feature, Math.round(value * 100) / 100])) : "na tela", incompleto: Boolean(truncated) },
    detail: detail("Gastos de IA", range.label, [{ title: "Por recurso", rows: emptyRows(top.map(([feature, value]) => ({ label: feature, value: usd(value) }))) }])
  };
}

// --- Reentradas por anúncio (getAdReentryReport) --------------------------------------------------------------------------
export function buildHenryReentriesReport({ report = null, range } = {}) {
  const brokers = report?.brokers || [];
  const total = report?.total || 0;
  const spoken = total ? `${range.spoken[0].toUpperCase()}${range.spoken.slice(1)}, ${count(total, "cliente voltou", "clientes voltaram")} por anúncio já sendo cliente: ${joinPt(brokers.slice(0, 4).map((group) => `${group.total} de ${firstNameOf(group.brokerName) || group.brokerName}`))}.` : `Nenhuma reentrada por anúncio ${range.spoken}.`;
  return {
    spoken,
    facts: { total, por_corretor: Object.fromEntries(brokers.map((group) => [group.brokerName, group.total])) },
    detail: detail("Reentradas por anúncio", range.label, brokers.map((group) => ({ title: `${group.brokerName} (${group.total})`, rows: group.clients.slice(0, 20).map((client) => ({ label: client.clientName, value: whenText(client.at), note: client.campaignName || "" })) })))
  };
}

// --- Bases pessoais de prospecção (listBrokerBasesSummary, visão do dono) -------------------------------------------------
export function buildHenryProspectingBasesReport({ bases = [] } = {}) {
  const withContacts = bases.filter((item) => item.contactCount > 0);
  const total = bases.reduce((sum, item) => sum + (Number(item.contactCount) || 0), 0);
  const spoken = withContacts.length ? `As bases pessoais de prospecção somam ${count(total, "contato", "contatos")}: ${joinPt(withContacts.slice(0, 5).map((item) => `${firstNameOf(item.name)} ${item.contactCount}`))}.` : "Nenhum corretor colocou contatos na própria base de prospecção.";
  return { spoken, facts: { total, por_corretor: Object.fromEntries(bases.map((item) => [item.name, item.contactCount])) }, detail: detail("Bases de prospecção", `${total} contatos`, [{ title: "Por corretor", rows: emptyRows(bases.map((item) => ({ label: item.name, value: String(item.contactCount) }))) }]) };
}
