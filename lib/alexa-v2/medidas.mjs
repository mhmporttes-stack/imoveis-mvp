import { joinNames, percentText, plural } from "./text.mjs";

// Núcleo PURO das consultas POR CORRETOR (Alexa V3). Nenhuma métrica é
// recalculada aqui: os números chegam das mesmas fontes das telas
//   - Desempenho (getPerformanceOverview): linhas "team" por corretor e métricas do período;
//   - Meta Diária (getOwnerTeamDailyOverview): percentual, feito/total, prospecção da meta;
// já reduzidos e guardados em cache (overview-core.mjs / team-goal-core.mjs).
// Aqui só se ESCOLHE o corretor, se LÊ o campo certo e se monta a frase.

const sameBroker = (row, broker) =>
  Boolean(row) && ((broker?.id && row.id === broker.id) || (!broker?.id && broker?.name && String(row.name).toLowerCase() === String(broker.name).toLowerCase()));

export function findBrokerRow(payload, broker) {
  return (payload?.team || []).find((row) => sameBroker(row, broker)) || null;
}

export function findBrokerMeta(goal, broker) {
  const found = (goal?.brokers || []).find((row) => sameBroker(row, broker));
  if (!found) return null;
  const remaining = Math.max(0, found.total - found.done);
  return {
    percent: found.percent,
    done: found.done,
    total: found.total,
    remaining,
    hasGoal: found.total > 0,
    hit: found.total > 0 && found.percent >= 100,
    prospectingDone: found.prospectingDone,
    prospectingTarget: found.prospectingTarget,
    prospectingRemaining: Math.max(0, found.prospectingTarget - found.prospectingDone)
  };
}

// Posição no ranking do período (a lista já vem na ordem oficial do Ranking).
export function brokerPosition(payload, broker) {
  const ranking = payload?.ranking || [];
  const index = ranking.findIndex((row) => sameBroker(row, broker));
  if (index < 0) return null;
  return { position: index + 1, total: ranking.length, points: ranking[index].points };
}

// --- Medidas do Desempenho (movimentação no período) -----------------------------
// field = campo da linha do corretor; team = total do período (mesma fonte).
export const MEDIDAS = {
  prospeccoes: { field: "prospecting", team: (p) => p.metrics.prospecting, phrase: (n) => `fez ${plural(n, "prospecção", "prospecções")}`, zero: "não fez prospecção" },
  atendimentos: { field: "service", team: (p) => p.metrics.service, phrase: (n) => `iniciou ${plural(n, "atendimento", "atendimentos")}`, zero: "não iniciou atendimento" },
  simulacoes: { field: "simulation", team: (p) => p.metrics.simulation, phrase: (n) => `levou ${plural(n, "cliente", "clientes")} para simulação`, zero: "não levou cliente para simulação" },
  documentacao: { field: "documentation", team: (p) => p.funnel?.documentation, phrase: (n) => `levou ${plural(n, "cliente", "clientes")} para documentação`, zero: "não levou cliente para documentação" },
  aprovacao: { field: "approvalPending", team: (p) => p.metrics.approvalPending, phrase: (n) => `levou ${plural(n, "cliente", "clientes")} para aprovação`, zero: "não levou cliente para aprovação" },
  aprovados: { field: "approval", team: (p) => p.metrics.approval, phrase: (n) => `teve ${plural(n, "cliente aprovado", "clientes aprovados")}`, zero: "não teve cliente aprovado" },
  reunioes: { field: "meeting", team: (p) => p.funnel?.meeting, phrase: (n) => `levou ${plural(n, "cliente", "clientes")} para reunião`, zero: "não levou cliente para reunião" },
  vendas: { field: "sale", team: (p) => p.metrics.sale, phrase: (n) => `registrou ${plural(n, "venda", "vendas")}`, zero: "não registrou venda" },
  clientes_novos: { field: "newClients", team: (p) => p.metrics.newClients, phrase: (n) => `recebeu ${plural(n, "cliente novo", "clientes novos")}`, zero: "não recebeu cliente novo" }
};

export function measureValue(payload, measureKey, broker) {
  const measure = MEDIDAS[measureKey];
  if (!measure) return null;
  if (broker) {
    const row = findBrokerRow(payload, broker);
    return row ? Number(row[measure.field]) || 0 : null;
  }
  const value = measure.team(payload);
  return value == null ? null : Number(value) || 0;
}

// Ranking de corretores por uma medida (só quem tem valor > 0), maior primeiro.
export function rankByMeasure(payload, measureKey) {
  const measure = MEDIDAS[measureKey];
  if (!measure) return [];
  return (payload?.team || [])
    .filter((row) => row.role !== "manager" && row.role !== "admin")
    .map((row) => ({ name: row.name, count: Number(row[measure.field]) || 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR"));
}

// --- Frases ---------------------------------------------------------------------
const cap = (text) => (text ? text[0].toLocaleUpperCase("pt-BR") + text.slice(1) : "");

export function articleFor(gender) {
  return gender === "female" ? "a" : gender === "male" ? "o" : "";
}

// "a Izabela" / "o Eduardo" / "Luan" (sem gênero cadastrado, só o nome).
export function subjectOf(name, gender) {
  const article = articleFor(gender);
  return article ? `${article} ${name}` : name;
}

function startSentence(subject) {
  return cap(subject);
}

// "A Izabela levou 3 clientes para simulação hoje." / "Ninguém ... " não usado.
export function measureSentence(measureKey, value, { name, gender, periodoSpoken }) {
  const measure = MEDIDAS[measureKey];
  const predicate = value > 0 ? measure.phrase(value) : `${periodoSpoken === "hoje" ? "ainda " : ""}${measure.zero}`;
  const subject = name ? startSentence(subjectOf(name, gender)) : "A equipe";
  return `${subject} ${predicate} ${periodoSpoken}.`;
}

const SUMMARY_ORDER = ["prospeccoes", "atendimentos", "simulacoes", "documentacao", "aprovacao", "aprovados", "reunioes"];

// "do dia", "da semana", "do mês"... (nunca "de esta semana").
export function rankingLabel(periodId, periodoSpoken) {
  return { hoje: "do dia", ontem: "de ontem", esta_semana: "da semana", semana_passada: "da semana passada", este_mes: "do mês", mes_passado: "do mês passado" }[periodId] || `de ${periodoSpoken}`;
}

// Resumo EXECUTIVO do corretor: meta, movimento (só o que tem número), venda,
// agenda e ranking. Não fala zero à toa.
export function composeBrokerSummary({ name, gender, periodId, periodoSpoken, row, meta, position, meetings }) {
  const subject = subjectOf(name, gender);
  const parts = [];

  if (meta?.hasGoal) {
    if (periodId === "hoje") {
      parts.push(
        meta.hit
          ? `Hoje ${subject} bateu a meta diária, com ${percentText(meta.percent)}.`
          : `Hoje ${subject} está com ${percentText(meta.percent)} da meta diária.${meta.remaining > 0 ? ` Faltam ${plural(meta.remaining, "ação", "ações")} para concluir.` : ""}`
      );
    } else {
      parts.push(`${cap(periodoSpoken)} ${subject} ${meta.hit ? "bateu" : "fechou com"} ${meta.hit ? "a meta diária, com " : ""}${percentText(meta.percent)}${meta.hit ? "" : " da meta diária"}.`);
    }
  }

  const activity = SUMMARY_ORDER.map((key) => ({ key, value: Number(row?.[MEDIDAS[key].field]) || 0 })).filter((item) => item.value > 0);
  const sales = Number(row?.sale) || 0;
  const lead = parts.length ? "" : `${cap(periodoSpoken)} ${subject} `;
  if (activity.length || sales > 0) {
    const phrases = activity.slice(0, 5).map((item) => MEDIDAS[item.key].phrase(item.value));
    if (sales > 0) phrases.push(MEDIDAS.vendas.phrase(sales));
    const sentence = joinNames(phrases);
    parts.push(lead ? `${lead}${sentence}.` : `${cap(sentence)}.`);
    if (sales === 0 && periodId === "hoje") parts.push("Ainda não registrou venda hoje.");
  } else if (!parts.length) {
    parts.push(`${cap(periodoSpoken)} ${subject} ${periodId === "hoje" ? "ainda não teve movimento" : "não teve movimento"}.`);
  }

  if (meetings > 0 && periodId === "hoje") parts.push(`Tem ${plural(meetings, "reunião", "reuniões")} hoje.`);

  if (position && (row?.points > 0 || position.points > 0)) {
    parts.push(`No ranking ${rankingLabel(periodId, periodoSpoken)} está em ${position.position}º lugar, com ${plural(position.points, "ponto", "pontos")}.`);
  }
  return parts.join(" ");
}

// Meta: percentual + o que falta (mesmos campos da Meta Diária).
export function metaSentence(meta, { name, gender, periodoSpoken, periodId }) {
  const who = name ? startSentence(subjectOf(name, gender)) : "O corretor";
  if (!meta) return `Não encontrei a meta de ${name || "esse corretor"}.`;
  if (!meta.hasGoal) return `${who} não tem meta definida ${periodoSpoken}.`;
  if (meta.hit) return `${who} bateu a meta ${periodoSpoken}, com ${percentText(meta.percent)}.`;
  const faltam = periodId === "hoje" && meta.remaining > 0 ? ` Faltam ${plural(meta.remaining, "ação", "ações")} para concluir.` : "";
  return `${who} está com ${percentText(meta.percent)} da meta ${periodoSpoken}.${faltam}`;
}

export function metaHitSentence(meta, { name, gender, periodoSpoken }) {
  const who = name ? startSentence(subjectOf(name, gender)) : "O corretor";
  if (!meta) return `Não encontrei a meta de ${name || "esse corretor"}.`;
  if (!meta.hasGoal) return `${who} não tem meta definida ${periodoSpoken}.`;
  return meta.hit
    ? `Sim, ${subjectOf(name, gender)} bateu a meta ${periodoSpoken}, com ${percentText(meta.percent)}.`
    : `Ainda não. ${who} está com ${percentText(meta.percent)} da meta ${periodoSpoken}.`;
}

// Comparação objetiva (sem opinião): uma linha por corretor.
export function compareLine(label, value) {
  return `${label}: ${value}`;
}
