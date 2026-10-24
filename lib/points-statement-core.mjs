// EXTRATO DOS PONTOS do corretor (card da Meta Diária da equipe, 2026-10-23). Funções PURAS
// (testes: tests/points-statement.test.mjs). NÃO existe fórmula de pontuação aqui: as linhas vêm de
// getPointsLedger (lib/performance-overview.js), que já é montado dos MESMOS eventos do Ranking
// (mesmo teto de prospecção, mesma regra "marco vale uma vez"). Este arquivo só filtra um corretor,
// traduz os motivos para português claro, reduz o nome do cliente ao primeiro nome e agrupa por dia.

export const POINTS_STATEMENT_LIMIT = 200;
export const POINTS_STATEMENT_PERIODS = Object.freeze(["today", "yesterday", "last7", "last30"]);
const TIME_ZONE = "America/Sao_Paulo";

export function normalizeStatementPeriod(value) {
  return POINTS_STATEMENT_PERIODS.includes(value) ? value : "today";
}

// Privacidade: só o primeiro nome (nunca telefone/sobrenome). Sem nome (ou nome que parece número) = "cliente".
export function firstNameOrClient(name) {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  if (!first || first === "—" || first === "-" || /\d/.test(first) || first.toLowerCase() === "cliente") return "cliente";
  return first;
}

const STATUS_LABELS = {
  "Cliente em atendimento": "Cliente passou para atendimento",
  "Simulação realizada": "Simulação realizada",
  "Documentação recebida": "Documentação recebida",
  "Cliente enviado para aprovação": "Enviado para aprovação",
  "Cliente aprovado": "Cliente aprovado",
  "Venda realizada": "Venda realizada"
};

const CAP_SUFFIX = " (teto do dia atingido)";
const MANUAL_PREFIX = "Ajuste manual — ";

function cleanNote(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

// Traduz uma linha do extrato (action/origin de getPointsLedger) para { kind, category, label, note }.
export function describeLedgerRow(row) {
  const rawAction = String(row?.action || "").trim();
  const origin = String(row?.origin || "").trim();

  if (origin === "Ajuste manual") {
    const note = cleanNote(row.note ?? (rawAction.startsWith(MANUAL_PREFIX) ? rawAction.slice(MANUAL_PREFIX.length) : rawAction));
    return { kind: "manual_adjustment", category: "Ajuste manual de pontos", label: "Ajuste do dono", note: note || "sem motivo informado" };
  }

  const capped = rawAction.endsWith(CAP_SUFFIX);
  const action = capped ? rawAction.slice(0, -CAP_SUFFIX.length) : rawAction;
  const capNote = capped ? "Teto de pontos de prospecção do dia atingido: o contato foi feito, mas não pontuou." : "";

  if (origin === "Mudança de status") {
    return { kind: "milestone", category: "Marco do cliente", label: STATUS_LABELS[action] || action, note: "" };
  }
  if (action === "Novo cliente cadastrado") {
    return { kind: "new_client", category: "Novo cliente", label: "Novo cliente cadastrado", note: "" };
  }
  if (action.startsWith("Prospecção — link pessoal")) {
    return { kind: "prospecting_link", category: "Prospecção", label: "Cliente entrou pelo link pessoal", note: capNote };
  }
  const attempt = /^Prospecção — (\d)ª tentativa$/.exec(action);
  if (attempt) {
    return { kind: "prospecting_attempt", category: "Prospecção", label: `${attempt[1]}ª tentativa de contato (Meta Diária)`, note: capNote };
  }
  if (action === "Prospecção — contato assumido") {
    return { kind: "prospecting_claim", category: "Prospecção", label: "Contato assumido na prospecção", note: capNote };
  }
  const bonus = /^Bônus de Meta Diária batida \((\d+)% da meta\)$/.exec(action);
  if (bonus) {
    return { kind: "goal_bonus", category: "Meta Diária", label: `Bônus por bater a Meta Diária (${bonus[1]}%)`, note: "" };
  }
  if (action === "Meta Diária não concluída") {
    return { kind: "goal_penalty", category: "Meta Diária", label: "Meta Diária não concluída (desconto)", note: "" };
  }
  const online = /^Tempo online — (\d+) min/.exec(action);
  if (online) {
    return { kind: "presence", category: "Presença no CRM", label: `Tempo online (${online[1]} min)`, note: action.includes("limitado a") ? "Limite diário de pontos de presença atingido." : "" };
  }
  if (action.startsWith("Mais tempo online")) {
    return { kind: "presence_top", category: "Presença no CRM", label: "Mais tempo online do dia", note: "" };
  }
  // Bônus da imobiliária (RAN-10, dono 2026-10-23) — texto montado em officeBonusEntries (lib/office-presence-bonus-core.mjs).
  const office = /^(Primeiro a chegar|Último a sair) na imobiliária(?: \(dividido entre (\d+)\))?$/.exec(action);
  if (office) {
    return { kind: office[1] === "Primeiro a chegar" ? "office_first_arrival" : "office_last_departure", category: "Presença na imobiliária", label: office[1], note: office[2] ? `Empate de menos de 3 minutos: 100 pontos divididos entre ${office[2]}.` : "" };
  }
  return { kind: "other", category: origin || "Pontos", label: action || "Lançamento de pontos", note: capNote };
}

function dayKey(iso) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(iso));
}

function timeLabel(iso) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function formatStatementDayLabel(day, todayYmd = "") {
  if (!day) return "";
  if (todayYmd && day === todayYmd) return "Hoje";
  if (todayYmd) {
    const yesterday = new Date(`${todayYmd}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    if (day === yesterday.toISOString().slice(0, 10)) return "Ontem";
  }
  const date = new Date(`${day}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" }).format(date).replace(".", "");
  return `${day.slice(8, 10)}/${day.slice(5, 7)} (${weekday})`;
}

// rows = linhas de getPointsLedger JÁ filtradas para o corretor (ou todas + brokerId).
// total = soma de TODAS as linhas (é o que tem que bater com o selo); lines = só as `limit` mais recentes.
export function buildPointsStatement(rows, { brokerId = "", limit = POINTS_STATEMENT_LIMIT, todayYmd = "" } = {}) {
  const own = (Array.isArray(rows) ? rows : []).filter((row) => !brokerId || row.brokerId === brokerId);
  const sorted = own
    .map((row, index) => ({ row, index, ms: new Date(row.occurredAt).getTime() }))
    .filter((item) => Number.isFinite(item.ms))
    .sort((a, b) => b.ms - a.ms || a.index - b.index);

  const total = sorted.reduce((sum, item) => sum + (Number(item.row.points) || 0), 0);
  const dayTotals = new Map();
  for (const item of sorted) {
    const key = dayKey(item.row.occurredAt);
    dayTotals.set(key, (dayTotals.get(key) || 0) + (Number(item.row.points) || 0));
  }

  const shown = sorted.slice(0, Math.max(0, limit));
  const lines = shown.map((item, position) => {
    const described = describeLedgerRow(item.row);
    const isPerson = ["milestone", "new_client", "prospecting_link", "prospecting_attempt", "prospecting_claim"].includes(described.kind);
    return {
      id: `${item.row.occurredAt}|${position}`,
      occurredAt: item.row.occurredAt,
      day: dayKey(item.row.occurredAt),
      time: timeLabel(item.row.occurredAt),
      points: Number(item.row.points) || 0,
      kind: described.kind,
      category: described.category,
      label: described.label,
      note: described.note,
      person: isPerson ? firstNameOrClient(item.row.clientName) : ""
    };
  });

  const days = [];
  for (const line of lines) {
    let group = days[days.length - 1];
    if (!group || group.day !== line.day) {
      group = { day: line.day, label: formatStatementDayLabel(line.day, todayYmd), total: dayTotals.get(line.day) || 0, lines: [] };
      days.push(group);
    }
    group.lines.push(line);
  }

  const shownPoints = lines.reduce((sum, line) => sum + line.points, 0);
  return {
    total,
    count: sorted.length,
    shownCount: lines.length,
    truncated: sorted.length > lines.length,
    hiddenCount: sorted.length - lines.length,
    hiddenPoints: total - shownPoints,
    lines,
    days
  };
}
