// Meta Diária — fixtures 100% fictícias para a vitrine (somente `next dev`).
// Nenhum nome, telefone, e-mail ou número aqui vem do banco: tudo inventado,
// no formato exato devolvido por lib/daily-goal.js (getBrokerDailyGoal,
// getOwnerTeamDailyOverview, getOwnerBrokerDailyDetail), lib/daily-goal-auto.js
// (getDailyGoalAutoStatus, adminListDailyGoalAutoSettings,
// adminGetDailyGoalAutoHistory) e lib/admin-presence.js (getTeamPresence).
//
// Cenário (equipe fictícia em Marília/SP):
// - Ana Paula Ribeiro — adiantada (110%), online, automação rodando.
// - Bruno Henrique Lopes — no ritmo (63%); é o "corretor logado" da tela do corretor.
// - Carla Mendes — offline, automação pausada, WhatsApp desconectado.
// - Diego Fernandes — muito atrás (6%), carteira ativa no limite.
// - Elisa Martins — corretora nova, zero atividade.

import { buildCompensationNotice } from "../../../../lib/daily-goal-compensation-view-core.mjs";

/* ------------------------------ Utilitários ------------------------------ */

const TZ = "America/Sao_Paulo";

function todayInSaoPaulo(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(plainDate, amount) {
  const [y, m, d] = plainDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + amount));
  return date.toISOString().slice(0, 10);
}

function formatBR(plainDate) {
  const [y, m, d] = plainDate.split("-");
  return `${d}/${m}/${y}`;
}

// Meia-noite de São Paulo (UTC-3, sem horário de verão desde 2019).
function zonedIso(plainDate) {
  return new Date(`${plainDate}T00:00:00-03:00`).toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

// Cópias fiéis das fórmulas de lib/daily-goal-progress.mjs (sem import, para
// a fixture continuar isolada): o percentual da vitrine bate com o do CRM.
function dailyGoalPercent(done, target) {
  if (target <= 0) return 0;
  if (done >= target) return 100 + Math.floor(done - target);
  return Math.min(99, Math.round((Math.max(0, done) / target) * 100));
}

function overallProgress({ prospectingDone = 0, prospectingTarget = 0, pendingDone = 0, pendingTotal = 0 }) {
  const pTarget = Math.max(0, prospectingTarget);
  const pDone = Math.max(0, prospectingDone);
  const qTotal = Math.max(0, pendingTotal);
  const qDone = Math.min(Math.max(0, pendingDone), qTotal);
  const required = pTarget + qTotal;
  const counted = Math.min(pDone, pTarget) + qDone;
  const percent = required <= 0 ? 0 : counted >= required ? 100 + Math.max(0, pDone - pTarget) : Math.min(99, Math.round((counted / required) * 100));
  return {
    required,
    done: counted + (counted >= required ? Math.max(0, pDone - pTarget) : 0),
    percent,
    prospecting: { done: pDone, target: pTarget, completed: pTarget > 0 && pDone >= pTarget },
    pending: { done: qDone, total: qTotal, remaining: qTotal - qDone, completed: qTotal > 0 && qDone >= qTotal }
  };
}

function divideOrNull(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

// Pseudoaleatório determinístico (mesmo valor no servidor e no cliente).
function noise(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const TODAY = todayInSaoPaulo();

/* ------------------------------- Corretores ------------------------------ */

const BROKERS = [
  { id: "vitrine-corretor-ana", name: "Ana Paula Ribeiro", presence: "online", minutesAgo: 1 },
  { id: "vitrine-corretor-bruno", name: "Bruno Henrique Lopes", presence: "away", minutesAgo: 9 },
  { id: "vitrine-corretor-carla", name: "Carla Mendes", presence: "offline", minutesAgo: 190 },
  { id: "vitrine-corretor-diego", name: "Diego Fernandes", presence: "online", minutesAgo: 2 },
  { id: "vitrine-corretor-elisa", name: "Elisa Martins", presence: "offline", minutesAgo: null }
];
const BROKER_BY_ID = new Map(BROKERS.map((broker, index) => [broker.id, { ...broker, index }]));

// Situação de HOJE de cada corretor (carteira, etapas, pendentes, funil).
// stages.*.total soma dayTarget; porMensagem bate com stages.*.done.
const TODAY_DATA = {
  "vitrine-corretor-ana": {
    prospectingDone: 40,
    pending: { total: 4, done: 4 },
    wallet: { current: 22, limit: 100, endedWorkedToday: 8, byAttempt: { first: 10, second: 7, third: 5 }, stages: { first: { done: 12, total: 12 }, second: { done: 10, total: 10 }, third: { done: 8, total: 8 } } },
    porMensagem: { 1: { abordados: 12, convertidos: 2 }, 2: { abordados: 10, convertidos: 1 }, 3: { abordados: 8, convertidos: 0 } },
    atendimentos: 6,
    simulacoes: 3,
    iniciaramCadencia: 12,
    convertidos: 3,
    pendingClients: []
  },
  "vitrine-corretor-bruno": {
    prospectingDone: 20,
    pending: { total: 5, done: 2 },
    wallet: { current: 27, limit: 100, endedWorkedToday: 3, byAttempt: { first: 12, second: 9, third: 6 }, stages: { first: { done: 8, total: 12 }, second: { done: 7, total: 10 }, third: { done: 3, total: 8 } } },
    porMensagem: { 1: { abordados: 8, convertidos: 1 }, 2: { abordados: 7, convertidos: 1 }, 3: { abordados: 3, convertidos: 0 } },
    atendimentos: 3,
    simulacoes: 1,
    iniciaramCadencia: 12,
    convertidos: 2,
    pendingClients: [
      { id: "vitrine-pend-b1", fullName: "Rosângela Vieira Prado", clientCode: "#C9412", daysWithoutContact: 9 },
      { id: "vitrine-pend-b2", fullName: "Wellington Sato", clientCode: "#C9388", daysWithoutContact: 6 },
      { id: "vitrine-pend-b3", fullName: "Tatiane Moura Lima", clientCode: "#C9455", daysWithoutContact: 4 }
    ]
  },
  "vitrine-corretor-carla": {
    prospectingDone: 12,
    pending: { total: 6, done: 1 },
    wallet: { current: 24, limit: 100, endedWorkedToday: 1, byAttempt: { first: 10, second: 8, third: 6 }, stages: { first: { done: 6, total: 10 }, second: { done: 4, total: 8 }, third: { done: 2, total: 7 } } },
    porMensagem: { 1: { abordados: 6, convertidos: 1 }, 2: { abordados: 4, convertidos: 0 }, 3: { abordados: 2, convertidos: 0 } },
    atendimentos: 1,
    simulacoes: 1,
    iniciaramCadencia: 10,
    convertidos: 1,
    pendingClients: [
      { id: "vitrine-pend-c1", fullName: "Gilberto Assunção", clientCode: "#C9201", daysWithoutContact: 15 },
      { id: "vitrine-pend-c2", fullName: "Priscila Nogueira", clientCode: "#C9233", daysWithoutContact: 11 },
      { id: "vitrine-pend-c3", fullName: "Marcos Vinícius Teles", clientCode: "#C9310", daysWithoutContact: 8 },
      { id: "vitrine-pend-c4", fullName: "Juliana Castro Reis", clientCode: "#C9347", daysWithoutContact: 5 },
      { id: "vitrine-pend-c5", fullName: "Sebastião Ferraz", clientCode: "#C9372", daysWithoutContact: 4 }
    ]
  },
  "vitrine-corretor-diego": {
    prospectingDone: 4,
    pending: { total: 9, done: 0 },
    wallet: { current: 60, limit: 60, endedWorkedToday: 1, byAttempt: { first: 30, second: 18, third: 12 }, stages: { first: { done: 2, total: 31 }, second: { done: 1, total: 18 }, third: { done: 1, total: 12 } } },
    porMensagem: { 1: { abordados: 2, convertidos: 0 }, 2: { abordados: 1, convertidos: 0 }, 3: { abordados: 1, convertidos: 0 } },
    atendimentos: 0,
    simulacoes: 0,
    iniciaramCadencia: 31,
    convertidos: 0,
    pendingClients: [
      { id: "vitrine-pend-d1", fullName: "Cleusa Aparecida Rocha", clientCode: "#C9104", daysWithoutContact: 23 },
      { id: "vitrine-pend-d2", fullName: "Rogério Tavares", clientCode: "#C9122", daysWithoutContact: 19 },
      { id: "vitrine-pend-d3", fullName: "Fernanda Okumura", clientCode: "#C9150", daysWithoutContact: 14 },
      { id: "vitrine-pend-d4", fullName: "Adriano Batista", clientCode: "#C9168", daysWithoutContact: 12 },
      { id: "vitrine-pend-d5", fullName: "Luciana Pires Gomes", clientCode: "#C9187", daysWithoutContact: 10 },
      { id: "vitrine-pend-d6", fullName: "Otávio Rezende", clientCode: "#C9214", daysWithoutContact: 7 },
      { id: "vitrine-pend-d7", fullName: "Kelly Cristina Alves", clientCode: "#C9259", daysWithoutContact: 6 },
      { id: "vitrine-pend-d8", fullName: "Nelson Hirata", clientCode: "#C9281", daysWithoutContact: 5 },
      { id: "vitrine-pend-d9", fullName: "Vanessa Duarte", clientCode: "#C9299", daysWithoutContact: 4 }
    ]
  },
  "vitrine-corretor-elisa": {
    prospectingDone: 0,
    pending: { total: 0, done: 0 },
    wallet: { current: 20, limit: 100, endedWorkedToday: 0, byAttempt: { first: 20, second: 0, third: 0 }, stages: { first: { done: 0, total: 20 }, second: { done: 0, total: 0 }, third: { done: 0, total: 0 } } },
    porMensagem: null,
    atendimentos: 0,
    simulacoes: 0,
    iniciaramCadencia: 0,
    convertidos: 0,
    pendingClients: []
  }
};

// Média diária (dia útil) para os períodos passados (ontem/7/30 dias).
const HISTORY_RATES = {
  "vitrine-corretor-ana": { quota: 30, done: 36, atend: 0.16, sim: 0.5, conv: 0.24, started: 12, metRate: 1 },
  "vitrine-corretor-bruno": { quota: 30, done: 26, atend: 0.13, sim: 0.4, conv: 0.17, started: 12, metRate: 0.55 },
  "vitrine-corretor-carla": { quota: 25, done: 17, atend: 0.1, sim: 0.45, conv: 0.11, started: 10, metRate: 0.3 },
  "vitrine-corretor-diego": { quota: 30, done: 6, atend: 0.08, sim: 0.3, conv: 0.03, started: 12, metRate: 0 },
  "vitrine-corretor-elisa": { quota: 20, done: 0, atend: 0, sim: 0, conv: 0, started: 0, metRate: 0 }
};

function walletFor(brokerId) {
  const base = TODAY_DATA[brokerId].wallet;
  const dayTarget = base.current + base.endedWorkedToday;
  return {
    current: base.current,
    limit: base.limit,
    blockOnLimit: true,
    available: Math.max(base.limit - base.current, 0),
    atLimit: base.current >= base.limit,
    byAttempt: { ...base.byAttempt },
    endedWorkedToday: base.endedWorkedToday,
    dayTarget,
    stages: clone(base.stages)
  };
}

/* --------------------- Visão do dono (TeamDailyPerformance) --------------------- */

function resolveRange(period) {
  const valid = ["today", "yesterday", "last7", "last30"].includes(period) ? period : "today";
  let startDate = TODAY;
  let endDate = TODAY;
  if (valid === "yesterday") { startDate = addDays(TODAY, -1); endDate = startDate; }
  else if (valid === "last7") startDate = addDays(TODAY, -6);
  else if (valid === "last30") startDate = addDays(TODAY, -29);
  const label = { today: "Hoje", yesterday: "Ontem", last7: "Últimos 7 dias", last30: "Últimos 30 dias" }[valid];
  return { period: valid, startDate, endDate, startIso: zonedIso(startDate), endIso: zonedIso(addDays(endDate, 1)), label };
}

function weekday(plainDate) {
  const [y, m, d] = plainDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Soma um período passado dia a dia (domingo sem meta; sábado meio período).
function historyTotals(brokerId, range) {
  const rates = HISTORY_RATES[brokerId];
  const brokerIndex = BROKER_BY_ID.get(brokerId).index;
  const totals = { previstas: 0, realizadas: 0, atendimentos: 0, simulacoes: 0, iniciaram: 0, convertidos: 0, porMensagem: { 1: { abordados: 0, convertidos: 0 }, 2: { abordados: 0, convertidos: 0 }, 3: { abordados: 0, convertidos: 0 } } };
  for (let day = range.startDate; day <= range.endDate; day = addDays(day, 1)) {
    if (day === TODAY) {
      // Dia corrente dentro de 7/30 dias: usa os números de hoje.
      const today = TODAY_DATA[brokerId];
      totals.previstas += walletFor(brokerId).dayTarget;
      totals.realizadas += today.prospectingDone;
      totals.atendimentos += today.atendimentos;
      totals.simulacoes += today.simulacoes;
      totals.iniciaram += today.iniciaramCadencia;
      totals.convertidos += today.convertidos;
      if (today.porMensagem) for (const n of [1, 2, 3]) { totals.porMensagem[n].abordados += today.porMensagem[n].abordados; totals.porMensagem[n].convertidos += today.porMensagem[n].convertidos; }
      continue;
    }
    const dow = weekday(day);
    if (dow === 0) continue;
    const factor = dow === 6 ? 0.5 : 1;
    const seed = brokerIndex * 1000 + Number(day.replaceAll("-", "")) % 997;
    const jitter = 0.8 + noise(seed) * 0.4;
    const done = Math.round(rates.done * factor * jitter);
    const started = Math.round(rates.started * factor);
    const converted = Math.round(started * rates.conv * (0.6 + noise(seed + 7) * 0.8));
    const atend = Math.round(done * rates.atend * (0.7 + noise(seed + 3) * 0.6));
    totals.previstas += Math.round(rates.quota * factor);
    totals.realizadas += done;
    totals.atendimentos += atend;
    totals.simulacoes += Math.min(atend, Math.round(atend * rates.sim + noise(seed + 5) * 0.6));
    totals.iniciaram += started;
    totals.convertidos += converted;
    // Divide as tentativas da cadência entre 1ª/2ª/3ª (o resto é prospecção manual).
    const cadence = Math.round(done * 0.85);
    const first = Math.round(cadence * 0.45);
    const second = Math.round(cadence * 0.33);
    const third = cadence - first - second;
    totals.porMensagem[1].abordados += first;
    totals.porMensagem[2].abordados += second;
    totals.porMensagem[3].abordados += third;
    totals.porMensagem[1].convertidos += Math.round(converted * 0.6);
    totals.porMensagem[2].convertidos += Math.round(converted * 0.3);
    totals.porMensagem[3].convertidos += converted - Math.round(converted * 0.6) - Math.round(converted * 0.3);
  }
  return totals;
}

function buildBroker(brokerId, range) {
  const broker = BROKER_BY_ID.get(brokerId);
  const isToday = range.startDate === TODAY && range.endDate === TODAY;
  let done;
  let total;
  let atendimentos;
  let simulacoes;
  let iniciaram;
  let convertidos;
  let porMensagem;
  let pendingProgress = null;

  if (isToday) {
    const today = TODAY_DATA[brokerId];
    done = today.prospectingDone;
    total = walletFor(brokerId).dayTarget;
    atendimentos = today.atendimentos;
    simulacoes = today.simulacoes;
    iniciaram = today.iniciaramCadencia;
    convertidos = today.convertidos;
    porMensagem = today.porMensagem ? clone(today.porMensagem) : null;
    pendingProgress = today.pending;
  } else {
    const totals = historyTotals(brokerId, range);
    done = totals.realizadas;
    total = totals.previstas;
    atendimentos = totals.atendimentos;
    simulacoes = totals.simulacoes;
    iniciaram = totals.iniciaram;
    convertidos = totals.convertidos;
    porMensagem = totals.realizadas ? totals.porMensagem : null;
  }

  const progress = overallProgress({ prospectingDone: done, prospectingTarget: total, pendingDone: pendingProgress?.done, pendingTotal: pendingProgress?.total });
  return {
    brokerId,
    name: broker.name,
    photoUrl: "",
    meta: { done: progress.done, total: progress.required, percent: progress.percent, prospecting: progress.prospecting, pending: pendingProgress ? progress.pending : null },
    funnel: {
      contatos: done,
      atendimentos,
      simulacoes,
      taxaAtendimento: divideOrNull(atendimentos, done),
      taxaSimulacao: divideOrNull(simulacoes, atendimentos)
    },
    conversao: iniciaram ? convertidos / iniciaram : null,
    porMensagem,
    iniciaramCadencia: iniciaram,
    convertidos,
    wallet: walletFor(brokerId)
  };
}

function buildTeamOverview(period) {
  const range = resolveRange(period);
  const brokers = BROKERS.map((broker) => buildBroker(broker.id, range))
    .sort((a, b) => b.meta.percent - a.meta.percent || b.meta.done - a.meta.done || a.name.localeCompare(b.name, "pt-BR"));
  const sum = (pick) => brokers.reduce((total, broker) => total + pick(broker), 0);
  const teamDone = sum((b) => b.meta.done);
  const teamTotal = sum((b) => b.meta.total);
  const contatos = sum((b) => b.funnel.contatos);
  const atendimentos = sum((b) => b.funnel.atendimentos);
  const simulacoes = sum((b) => b.funnel.simulacoes);
  return {
    range,
    summary: {
      metaPercent: dailyGoalPercent(teamDone, teamTotal),
      atividadesDone: teamDone,
      atividadesTotal: teamTotal,
      contatos,
      atendimentos,
      simulacoes,
      taxaAtendimento: divideOrNull(atendimentos, contatos),
      taxaSimulacao: divideOrNull(simulacoes, atendimentos),
      taxaReativacao: divideOrNull(sum((b) => b.convertidos), sum((b) => b.iniciaramCadencia))
    },
    brokers: brokers.map(({ iniciaramCadencia, convertidos, ...broker }) => broker)
  };
}

function buildBrokerDetail(brokerId, period) {
  const overview = buildTeamOverview(period);
  const broker = overview.brokers.find((row) => row.brokerId === brokerId) || null;
  if (!broker) return { error: "Corretor não encontrado." };
  const isToday = overview.range.startDate === TODAY && overview.range.endDate === TODAY;
  let pendingDetail = null;
  if (isToday) {
    const today = TODAY_DATA[brokerId];
    const remaining = today.pending.total - today.pending.done;
    pendingDetail = {
      total: today.pending.total,
      done: today.pending.done,
      remaining,
      frozenTotal: today.pending.total,
      frozenAt: new Date(`${TODAY}T00:01:00-03:00`).toISOString(),
      clients: today.pendingClients.slice(0, remaining),
      moreClients: Math.max(0, remaining - today.pendingClients.length)
    };
  }
  return {
    range: overview.range,
    isToday,
    pendingDetail,
    broker,
    teamRates: {
      taxaAtendimento: overview.summary.taxaAtendimento,
      taxaSimulacao: overview.summary.taxaSimulacao,
      conversao: overview.summary.taxaReativacao
    }
  };
}

export const teamOverview = buildTeamOverview("today");

/* ------------------------- Presença (/api/admin/presence) ------------------------- */

function buildPresence() {
  const now = Date.now();
  const order = { online: 0, away: 1, offline: 2 };
  const members = BROKERS.map((broker) => ({
    id: broker.id,
    name: broker.name,
    photoUrl: "",
    status: broker.presence,
    lastActivityAt: broker.minutesAgo == null ? null : new Date(now - broker.minutesAgo * 60000).toISOString()
  })).sort((a, b) => order[a.status] - order[b.status]);
  const counts = { online: 0, away: 0, offline: 0 };
  for (const member of members) counts[member.status] += 1;
  return { ...counts, members, generatedAt: new Date(now).toISOString() };
}

/* ------------------ Automação (/api/admin/daily-goal-auto e /auto) ------------------ */

const AUTO_DEFAULTS = {
  enabled: false, paused: false, pausedReason: "", consecutiveErrors: 0,
  warmupStartDate: null, dailyCapOverride: null,
  windowStartMinutes: 480, windowEndMinutes: 1140, minGapMinutes: 20, maxGapMinutes: 40,
  oscillateEnabled: false, oscillatePercent: 50,
  businessDaysOnly: true
};

const AUTO_BY_BROKER = {
  "vitrine-corretor-ana": {
    settings: { enabled: true, oscillateEnabled: true, oscillatePercent: 40 },
    sessionStatus: "connected", sentToday: 18, sentUnconfirmedToday: 2, pendingToday: 6, skippedToday: 1, errorToday: 0, canceledToday: 0,
    avgGapMinutes: 24.6, nextInMinutes: 14, sentTotal: 412, autoErrorTotal: 1,
    googleContactsStatus: "connected", googleContactsEmail: "ana.ribeiro@exemplo.com.br",
    lastIssue: { status: "skipped", reason: "lead_respondeu", minutesAgo: 75 }
  },
  "vitrine-corretor-bruno": {
    settings: { enabled: true },
    sessionStatus: "connected", sentToday: 9, sentUnconfirmedToday: 1, pendingToday: 8, skippedToday: 2, errorToday: 1, canceledToday: 0,
    avgGapMinutes: 31.2, nextInMinutes: 6, sentTotal: 238, autoErrorTotal: 2,
    googleContactsStatus: "disconnected", googleContactsEmail: "",
    lastIssue: { status: "error", reason: "falha_destinatario_1_3", minutesAgo: 40 }
  },
  "vitrine-corretor-carla": {
    settings: { enabled: true, paused: true, pausedReason: "Pausado pelo gestor — WhatsApp desconectado", consecutiveErrors: 3 },
    sessionStatus: "disconnected", sentToday: 3, sentUnconfirmedToday: 0, pendingToday: 0, skippedToday: 4, errorToday: 2, canceledToday: 5,
    avgGapMinutes: null, nextInMinutes: null, sentTotal: 157, autoErrorTotal: 4,
    googleContactsStatus: "expired", googleContactsEmail: "carla.mendes@exemplo.com.br",
    lastIssue: { status: "skipped", reason: "sessao_nao_conectada", minutesAgo: 190 }
  },
  "vitrine-corretor-diego": {
    settings: { enabled: true, dailyCapOverride: 30 },
    sessionStatus: "nunca_conectou", sentToday: 0, sentUnconfirmedToday: 0, pendingToday: 0, skippedToday: 6, errorToday: 0, canceledToday: 0,
    avgGapMinutes: null, nextInMinutes: null, sentTotal: 0, autoErrorTotal: 0,
    googleContactsStatus: "disconnected", googleContactsEmail: "",
    lastIssue: { status: "skipped", reason: "sessao_nao_conectada", minutesAgo: 20 }
  },
  "vitrine-corretor-elisa": {
    settings: {},
    sessionStatus: "qr_required", sentToday: 0, sentUnconfirmedToday: 0, pendingToday: 0, skippedToday: 0, errorToday: 0, canceledToday: 0,
    avgGapMinutes: null, nextInMinutes: null, sentTotal: 0, autoErrorTotal: 0,
    googleContactsStatus: "disconnected", googleContactsEmail: "",
    lastIssue: null
  }
};

function buildAutoList() {
  const now = Date.now();
  return BROKERS.map((broker) => {
    const auto = AUTO_BY_BROKER[broker.id];
    const settings = { ...AUTO_DEFAULTS, ...auto.settings };
    const plannedToday = auto.sentToday + auto.sentUnconfirmedToday + auto.pendingToday;
    const activities = walletFor(broker.id).current;
    const dailyCap = settings.dailyCapOverride ? Math.min(settings.dailyCapOverride, 100) : Math.min(100, plannedToday + activities);
    return {
      brokerId: broker.id,
      brokerName: broker.name,
      brokerPhotoUrl: "",
      ...settings,
      sessionStatus: auto.sessionStatus,
      sessionLastError: auto.sessionStatus === "disconnected" ? "Conexão encerrada pelo aparelho" : "",
      sessionLastConnectedAt: auto.sessionStatus === "nunca_conectou" || auto.sessionStatus === "qr_required" ? null : new Date(now - (auto.sessionStatus === "connected" ? 3 : 200) * 60 * 60000).toISOString(),
      sentToday: auto.sentToday,
      sentUnconfirmedToday: auto.sentUnconfirmedToday,
      pendingToday: auto.pendingToday,
      skippedToday: auto.skippedToday,
      errorToday: auto.errorToday,
      canceledToday: auto.canceledToday,
      plannedToday,
      avgGapMinutes: auto.avgGapMinutes,
      dailyCap,
      dailyCapReason: settings.dailyCapOverride ? "teto manual" : dailyCap === 100 ? "teto máximo de segurança" : "todas as atividades de hoje",
      nextDispatchAt: auto.nextInMinutes == null ? null : new Date(now + auto.nextInMinutes * 60000).toISOString(),
      sentTotal: auto.sentTotal,
      autoErrorTotal: auto.autoErrorTotal,
      lastIssue: auto.lastIssue ? { status: auto.lastIssue.status, reason: auto.lastIssue.reason, at: new Date(now - auto.lastIssue.minutesAgo * 60000).toISOString() } : null,
      googleContactsStatus: auto.googleContactsStatus,
      googleContactsEmail: auto.googleContactsEmail
    };
  });
}

// Status da automação do "corretor logado" (Bruno) — getDailyGoalAutoStatus.
function buildOwnAutoStatus() {
  const auto = AUTO_BY_BROKER[LOGGED_BROKER_ID];
  return {
    ...AUTO_DEFAULTS,
    ...auto.settings,
    sessionConnected: auto.sessionStatus === "connected",
    sentToday: auto.sentToday,
    pendingToday: auto.pendingToday
  };
}

const CONTACT_NAMES = [
  "Aline Ferreira Campos", "Benedito Correia", "Camila Yamamoto", "Douglas Peixoto", "Érica Santana",
  "Fábio Monteiro", "Gisele Barros", "Heitor Quintana", "Ingrid Saldanha", "Jonas Albuquerque",
  "Karina Lobo", "Leandro Cunha", "Mirela Toledo", "Natanael Brito", "Odete Fagundes",
  "Paulo Sérgio Neri", "Quésia Rangel", "Renato Iwasaki", "Simone Dantas", "Thiago Bezerra"
];

const HISTORY_SKIP_REASONS = ["lead_respondeu", "ja_teve_tentativa_hoje", "fora_da_janela", "sessao_nao_conectada", "falha_destinatario_1_3", "falha_infraestrutura"];

// adminGetDailyGoalAutoHistory — eventos da fila (enviadas, puladas, erro, pendentes).
function buildAutoHistory(url) {
  const brokerId = url.searchParams.get("brokerId") || "";
  const statusFilter = url.searchParams.get("status") || "";
  const attemptFilter = Number(url.searchParams.get("attemptNumber")) || null;
  const isWeek = Boolean(url.searchParams.get("from"));
  const auto = AUTO_BY_BROKER[brokerId];
  if (!auto) return { summary: { processadas: 0, enviadas: 0, aguardandoRetry: 0, erros: 0, puladas: 0 }, timeline: [] };

  const now = Date.now();
  const brokerIndex = BROKER_BY_ID.get(brokerId).index;
  const multiplier = isWeek ? 5 : 1;
  const plan = [
    ...Array(auto.sentToday * multiplier).fill("sent"),
    ...Array(auto.skippedToday * multiplier).fill("skipped"),
    ...Array(auto.errorToday * multiplier).fill("error"),
    ...Array(auto.pendingToday).fill("pending"),
    ...Array(auto.canceledToday * multiplier).fill("canceled")
  ];
  const span = isWeek ? 6 * 24 * 60 : 8 * 60;
  const rows = plan.map((status, index) => {
    const seed = brokerIndex * 100 + index;
    const attemptNumber = 1 + Math.floor(noise(seed) * 3);
    const minutesAgo = Math.round(((index + 1) / (plan.length + 1)) * span);
    return {
      id: `vitrine-fila-${brokerId}-${index}`,
      at: new Date(now - minutesAgo * 60000).toISOString(),
      brokerId,
      brokerName: BROKER_BY_ID.get(brokerId).name,
      contactName: CONTACT_NAMES[(index * 7 + brokerIndex) % CONTACT_NAMES.length],
      attemptNumber,
      variant: attemptNumber === 1 ? "A" : ["A", "B", "C"][Math.floor(noise(seed + 1) * 3)],
      status,
      reason: status === "sent" || status === "pending" ? "" : status === "canceled" ? "automacao_desligada" : HISTORY_SKIP_REASONS[Math.floor(noise(seed + 2) * HISTORY_SKIP_REASONS.length)],
      retry: status === "pending" && index % 3 === 0,
      scheduledFor: new Date(now - minutesAgo * 60000 - 60000).toISOString(),
      sentAt: status === "sent" ? new Date(now - minutesAgo * 60000).toISOString() : null,
      deliveredAt: status === "sent" ? new Date(now - minutesAgo * 60000 + 90000).toISOString() : null
    };
  }).filter((row) => (!statusFilter || row.status === statusFilter) && (!attemptFilter || row.attemptNumber === attemptFilter))
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  const summary = { processadas: rows.length, enviadas: 0, aguardandoRetry: 0, erros: 0, puladas: 0 };
  for (const row of rows) {
    if (row.status === "sent") summary.enviadas += 1;
    else if (row.status === "error") summary.erros += 1;
    else if (row.status === "skipped") summary.puladas += 1;
    else if (row.status === "pending" && row.retry) summary.aguardandoRetry += 1;
  }
  return { summary, timeline: rows.map(({ retry, ...row }) => row) };
}

/* --------------------- Tela do corretor (DailyGoalDashboard) --------------------- */

const LOGGED_BROKER_ID = "vitrine-corretor-bruno";
const LOGGED_BROKER_FIRST_NAME = "Bruno";

const MESSAGE_TEMPLATES = {
  1: { text: "{saudacao}, {primeiro_nome}, tudo bem?", allowPersonalization: false },
  2: { text: "Olá, {primeiro_nome}! Sou {nome_corretor}, associado do corretor Matheus Machado. Vi que há um tempo você recebeu um atendimento nosso sobre a compra do seu imóvel. Estou entrando em contato para saber como foi seu atendimento e se conseguiu avançar com a compra.", allowPersonalization: true },
  3: { text: "Oi, {primeiro_nome}! Passando rapidinho para saber se posso te ajudar em algo sobre a compra do seu imóvel. Se quiser retomar essa conversa, estou à disposição.", allowPersonalization: true }
};

function renderMessage(attemptNumber, fullName) {
  const template = MESSAGE_TEMPLATES[attemptNumber];
  const vars = { saudacao: greeting(), primeiro_nome: fullName.split(" ")[0], nome_corretor: BROKER_BY_ID.get(LOGGED_BROKER_ID).name };
  return template.text.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}

let roundSeq = 0;
function pendingCard(fullName, attemptNumber, clientCode) {
  roundSeq += 1;
  const id = `vitrine-rodada-${String(roundSeq).padStart(3, "0")}`;
  return {
    roundId: id,
    // Rodada nunca trabalhada ainda não tem cliente criado (client_id nulo).
    clientId: attemptNumber === 1 ? null : `vitrine-cliente-${roundSeq}`,
    fullName,
    clientCode: attemptNumber === 1 ? "" : clientCode,
    phone: `551490000${String(roundSeq).padStart(4, "0")}`,
    attemptNumber,
    previewMessage: renderMessage(attemptNumber, fullName),
    allowPersonalization: MESSAGE_TEMPLATES[attemptNumber].allowPersonalization
  };
}

function doneCard(fullName, attemptNumber, clientCode) {
  roundSeq += 1;
  return {
    roundId: `vitrine-rodada-${String(roundSeq).padStart(3, "0")}`,
    clientId: `vitrine-cliente-${roundSeq}`,
    fullName,
    clientCode,
    attemptNumber,
    completedToday: true
  };
}

// Bruno: 1ª 8/12 (4 pendentes, 1 de dia anterior), 2ª 7/10, 3ª 3/8 —
// idêntico a wallet.stages e ao card dele na visão do dono.
const NEW_PENDING = [
  pendingCard("Lorena Batista Gouveia", 1),
  pendingCard("Mateus Kenji Ono", 1),
  pendingCard("Patrícia Salles", 1),
  pendingCard("Reinaldo Coutinho", 1)
];
const NEW_DONE = [
  doneCard("Aline Ferreira Campos", 1, "#C9601"), doneCard("Benedito Correia", 1, "#C9602"),
  doneCard("Camila Yamamoto", 1, "#C9603"), doneCard("Douglas Peixoto", 1, "#C9604"),
  doneCard("Érica Santana", 1, "#C9605"), doneCard("Fábio Monteiro", 1, "#C9606"),
  doneCard("Gisele Barros", 1, "#C9607"), doneCard("Heitor Quintana", 1, "#C9608")
];
const SECOND_PENDING = [
  pendingCard("Ingrid Saldanha", 2, "#C9571"),
  pendingCard("Jonas Albuquerque", 2, "#C9574"),
  pendingCard("Karina Lobo", 2, "#C9580")
];
const SECOND_DONE = [
  doneCard("Leandro Cunha", 2, "#C9551"), doneCard("Mirela Toledo", 2, "#C9553"),
  doneCard("Natanael Brito", 2, "#C9556"), doneCard("Odete Fagundes", 2, "#C9559"),
  doneCard("Paulo Sérgio Neri", 2, "#C9562"), doneCard("Quésia Rangel", 2, "#C9565"),
  doneCard("Renato Iwasaki", 2, "#C9568")
];
const THIRD_PENDING = [
  pendingCard("Simone Dantas", 3, "#C9512"),
  pendingCard("Thiago Bezerra", 3, "#C9515"),
  pendingCard("Úrsula Freitas", 3, "#C9518"),
  pendingCard("Valdir Pacheco", 3, "#C9521"),
  pendingCard("Yasmin Coelho", 3, "#C9524")
];
const THIRD_DONE = [
  doneCard("Wagner Lacerda", 3, "#C9501"), doneCard("Xênia Prates", 3, "#C9504"),
  doneCard("Zélia Antunes", 3, "#C9507")
];

function buildBrokerGoal() {
  const today = TODAY_DATA[LOGGED_BROKER_ID];
  const wallet = walletFor(LOGGED_BROKER_ID);
  const progress = overallProgress({ prospectingDone: today.prospectingDone, prospectingTarget: wallet.dayTarget, pendingDone: today.pending.done, pendingTotal: today.pending.total });
  return {
    date: TODAY,
    total: wallet.dayTarget,
    done: NEW_DONE.length + SECOND_DONE.length + THIRD_DONE.length,
    quota: wallet.dayTarget,
    realizedToday: today.prospectingDone,
    percent: progress.percent,
    prospecting: progress.prospecting,
    pending: progress.pending,
    totalRequired: progress.required,
    wallet,
    groups: {
      new: { total: 12, done: NEW_DONE.length, clients: NEW_PENDING, doneToday: NEW_DONE, pendingToday: 3, pendingCarriedOver: 1 },
      second: { total: SECOND_DONE.length + SECOND_PENDING.length, done: SECOND_DONE.length, clients: SECOND_PENDING, doneToday: SECOND_DONE },
      third: { total: THIRD_DONE.length + THIRD_PENDING.length, done: THIRD_DONE.length, clients: THIRD_PENDING, doneToday: THIRD_DONE }
    }
  };
}

export const brokerGoal = buildBrokerGoal();

// Variantes FICTÍCIAS do aviso de compensação (PRO-14) — geradas pelo mesmo núcleo puro que a tela real usa.
const COMP_BASE = { baseStartMinutes: 390, baseEndMinutes: 1140, restrictionStatus: "validated" };
export const compensationVariants = [
  { label: "Validada, sem compensação ainda", notice: buildCompensationNotice({ ...COMP_BASE }) },
  { label: "Compensação +2h até 21:00, Meta em 100%", notice: buildCompensationNotice({ ...COMP_BASE, creditMinutes: 120, effectiveEndMinutes: 1260, goalComplete: true }) },
  { label: "Dia impactado", notice: buildCompensationNotice({ ...COMP_BASE, creditMinutes: 120, effectiveEndMinutes: 1260, impacted: true }) }
];

// Estado mutável da vitrine: registrar tentativa / salvar mensagem altera a
// cópia local e o GET /api/daily-goal seguinte devolve o novo estado.
let goalState = clone(brokerGoal);

const GROUP_BY_ATTEMPT = { 1: "new", 2: "second", 3: "third" };
const STAGE_BY_ATTEMPT = { 1: "first", 2: "second", 3: "third" };

function registerAttempt(roundId) {
  for (const key of ["new", "second", "third"]) {
    const group = goalState.groups[key];
    const index = group.clients.findIndex((client) => client.roundId === roundId);
    if (index < 0) continue;
    const [client] = group.clients.splice(index, 1);
    const n = client.attemptNumber;
    group.doneToday.unshift({
      roundId: client.roundId,
      clientId: client.clientId || `vitrine-cliente-novo-${client.roundId}`,
      fullName: client.fullName,
      clientCode: client.clientCode || `#C97${String(10 + group.doneToday.length).padStart(2, "0")}`,
      attemptNumber: n,
      completedToday: true
    });
    group.done += 1;
    if (key === "new") {
      if (group.pendingToday > 0) group.pendingToday -= 1;
      else if (group.pendingCarriedOver > 0) group.pendingCarriedOver -= 1;
    }
    goalState.done += 1;
    goalState.realizedToday += 1;
    const stage = goalState.wallet.stages[STAGE_BY_ATTEMPT[n]];
    stage.done = Math.min(stage.total, stage.done + 1);
    // 3ª tentativa encerra a rodada: sai da carteira, mas continua na meta do dia.
    if (n === 3) {
      goalState.wallet.current -= 1;
      goalState.wallet.byAttempt.third -= 1;
      goalState.wallet.endedWorkedToday += 1;
      goalState.wallet.available += 1;
      goalState.wallet.atLimit = goalState.wallet.current >= goalState.wallet.limit;
    }
    const progress = overallProgress({
      prospectingDone: goalState.realizedToday,
      prospectingTarget: goalState.quota,
      pendingDone: goalState.pending?.done,
      pendingTotal: goalState.pending?.total
    });
    goalState.percent = progress.percent;
    goalState.prospecting = progress.prospecting;
    goalState.pending = progress.pending;
    goalState.totalRequired = progress.required;
    return { attemptNumber: n, ended: n === 3 };
  }
  return null;
}

function readBody(init) {
  try {
    return JSON.parse(init?.body || "{}");
  } catch {
    return {};
  }
}

function saveTemplate(roundId, text) {
  for (const key of ["new", "second", "third"]) {
    const client = goalState.groups[key].clients.find((item) => item.roundId === roundId);
    if (!client) continue;
    if (!client.allowPersonalization) return { error: "Esta mensagem não pode ser personalizada." };
    client.previewMessage = String(text || "").trim();
    // Os outros cards da mesma etapa passam a usar o novo padrão (com o nome de cada um).
    const firstName = client.fullName.split(" ")[0];
    const template = client.previewMessage.split(firstName).join("{primeiro_nome}");
    for (const other of goalState.groups[key].clients) {
      if (other.roundId === roundId) continue;
      other.previewMessage = template.replace(/\{primeiro_nome\}/g, other.fullName.split(" ")[0]);
    }
    return { previewMessage: client.previewMessage };
  }
  return { error: "Este cliente não está mais disponível na sua Meta Diária." };
}

/* --------------------------------- Rotas --------------------------------- */

export const routes = [
  // Tela do corretor
  { match: /^\/api\/daily-goal(\?|$)/, response: () => clone(goalState) },
  {
    method: "POST",
    match: /^\/api\/daily-goal\/attempt(\?|$)/,
    delay: 350,
    response: ({ init }) => {
      const { roundId } = readBody(init);
      const result = registerAttempt(roundId);
      // whatsappUrl nulo de propósito: a vitrine nunca abre o WhatsApp de verdade
      // (o componente fecha a aba em branco que abriu no clique).
      return result ? { ...result, whatsappUrl: null } : { error: "Este cliente não está mais disponível na sua Meta Diária." };
    }
  },
  {
    method: "POST",
    match: /^\/api\/daily-goal\/message-override(\?|$)/,
    response: ({ init }) => {
      const { roundId, text } = readBody(init);
      return saveTemplate(roundId, text);
    }
  },
  { match: /^\/api\/daily-goal\/auto(\?|$)/, response: () => buildOwnAutoStatus() },
  { match: /^\/api\/daily-goal\/settings(\?|$)/, response: () => ({ quota: 20, messages: clone(MESSAGE_TEMPLATES), wallet: { walletLimit: 100, blockOnLimit: true } }) },

  // Visão do dono
  {
    match: /^\/api\/daily-goal\/team-overview\/([^/?]+)/,
    delay: 260,
    response: ({ url }) => {
      const brokerId = decodeURIComponent(url.pathname.split("/").pop());
      return buildBrokerDetail(brokerId, url.searchParams.get("period") || "today");
    }
  },
  {
    match: /^\/api\/daily-goal\/team-overview(\?|$)/,
    delay: 320,
    response: ({ url }) => buildTeamOverview(url.searchParams.get("period") || "today")
  },
  { match: /^\/api\/admin\/presence(\?|$)/, response: () => buildPresence() },
  { match: /^\/api\/admin\/daily-goal-auto\/history(\?|$)/, delay: 240, response: ({ url }) => buildAutoHistory(url) },
  { match: /^\/api\/admin\/daily-goal-auto(\?|$)/, response: () => ({ brokers: buildAutoList() }) },
  { method: "PATCH", match: /^\/api\/admin\/daily-goal-auto(\?|$)/, response: () => ({ brokers: buildAutoList() }) }
];

export const propsFor = () => ({});

// Mantido só para depuração no console do navegador (datas usadas pela fixture).
export const __vitrineInfo = { today: TODAY, todayLabel: formatBR(TODAY) };
