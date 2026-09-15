import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getOwnerTeamDailyOverview } from "./daily-goal";
import { getPerformanceOverview } from "./performance-overview";
import { listAdminProfiles } from "./admin-profiles";

// WhatsApp Manual: central de comunicação da gestão com a equipe ao longo
// da jornada do dia — Início do dia (motivar), Acompanhamento (incentivar
// com dado real do momento) e Fechamento (reconhecer o resultado do
// período). Só monta o TEXTO; quem manda de verdade é o dono/gestor, pelo
// próprio WhatsApp (abre a conversa já com a mensagem pronta).
//
// Dados 100% reaproveitados, nada calculado de novo:
// - ranking/pontos/prospecções/novos clientes/atendimentos/simulações/
//   documentações/aprovações/vendas/atividades: getPerformanceOverview
//   (lib/performance-overview.js) — MESMA fonte da tela Desempenho/Ranking.
// - meta diária (%/realizado/total): getOwnerTeamDailyOverview
//   (lib/daily-goal.js) — MESMA fonte da tela Meta Diária.
// Início do dia e Acompanhamento sempre olham "hoje" (só fazem sentido no
// dia corrente); Fechamento aceita hoje/últimos 7/últimos 30 dias, como já
// era antes desta expansão.

export const JOURNEY_STAGES = [
  {
    key: "inicio",
    label: "Início do dia",
    icon: "☀️",
    options: [
      { key: "inicio_motivacao", label: "Motivação do dia" },
      { key: "inicio_foco_meta", label: "Foco na meta" }
    ]
  },
  {
    key: "acompanhamento",
    label: "Acompanhamento",
    icon: "📈",
    options: [
      { key: "acompanhamento_auto", label: "Automática" },
      { key: "acompanhamento_incentivo", label: "Incentivo" },
      { key: "acompanhamento_evolucao", label: "Evolução" },
      { key: "acompanhamento_quase", label: "Meta quase concluída" },
      { key: "acompanhamento_superada", label: "Meta superada" }
    ]
  },
  {
    key: "fechamento",
    label: "Fechamento",
    icon: "✅",
    options: [
      { key: "fechamento_today", label: "Resumo diário" },
      { key: "fechamento_last7", label: "Resumo semanal" },
      { key: "fechamento_last30", label: "Resumo mensal" }
    ]
  }
];

// Todo tipo de mensagem REAL (o "acompanhamento_auto" não é um modelo em si
// — é um seletor que resolve pra um destes 4 conforme o percentual real do
// corretor, ver resolveMessageKey).
const MESSAGE_KIND_LABELS = {
  inicio_motivacao: "Início do dia — Motivação",
  inicio_foco_meta: "Início do dia — Foco na meta",
  acompanhamento_incentivo: "Acompanhamento — Incentivo",
  acompanhamento_evolucao: "Acompanhamento — Evolução",
  acompanhamento_quase: "Acompanhamento — Meta quase concluída",
  acompanhamento_superada: "Acompanhamento — Meta superada",
  fechamento_today: "Fechamento — Resumo diário",
  fechamento_last7: "Fechamento — Resumo semanal",
  fechamento_last30: "Fechamento — Resumo mensal"
};
const MESSAGE_KIND_KEYS = Object.keys(MESSAGE_KIND_LABELS);

// Ordem fixa de exibição dos "destaques" — só entra na mensagem quem tem
// valor > 0 (regra obrigatória: indicador zerado nunca aparece, e o bloco
// inteiro some se todos estiverem zerados). Singular/plural próprio pra não
// ler "1 atendimentos".
const INDICATOR_LABELS = [
  { key: "prospeccoes", singular: "prospecção", plural: "prospecções" },
  { key: "novos_clientes", singular: "novo cliente", plural: "novos clientes" },
  { key: "atendimentos", singular: "atendimento", plural: "atendimentos" },
  { key: "simulacoes", singular: "simulação", plural: "simulações" },
  { key: "documentacoes", singular: "documentação recebida", plural: "documentações recebidas" },
  { key: "aprovacoes", singular: "aprovação", plural: "aprovações" },
  { key: "vendas", singular: "venda", plural: "vendas" },
  { key: "atividades_realizadas", singular: "atividade concluída", plural: "atividades concluídas" },
  { key: "atividades_pendentes", singular: "atividade pendente", plural: "atividades pendentes" }
];

// Tom sempre positivo do Fechamento — nunca frase negativa pra quem está
// abaixo de 100% (reconhecimento do esforço + incentivo), elogio pra quem
// bate exatamente 100%, elogio mais forte pra quem supera (o percentual
// real aparece no texto, então quanto maior, mais forte soa sozinho — sem
// precisar de uma 3ª escala de intensidade). Texto próprio por período.
const PERIOD_TEXT = {
  today: {
    title: "Resumo do dia",
    highlightsTitle: "Seus destaques de hoje",
    rankingVerb: "Você encerrou o dia",
    opening: {
      above: "seu desempenho de hoje merece destaque! 🔥",
      exact: "fechamos o dia com um ótimo resultado! 👏",
      below: "hoje foi mais um passo importante na construção do seu resultado. 👏"
    },
    meta: {
      above: (percent) => `Você alcançou *${percent}% da sua meta*. Excelente resultado — você foi muito além do objetivo do dia.`,
      exact: () => "Você concluiu *100% da sua meta*, mostrando consistência e foco no trabalho.",
      below: () => "Você segue avançando e seu desempenho mostra que existe potencial para ir ainda mais longe."
    },
    closing: {
      above: "Parabéns por esse resultado. Esse ritmo mostra muita dedicação e potencial para crescer ainda mais. 🚀",
      exact: "Parabéns pelo desempenho. Continue assim, porque seu trabalho mostra força e constância. 🚀",
      below: "Continue firme. A constância de hoje é o que constrói os grandes resultados de amanhã. 💪"
    }
  },
  last7: {
    title: "Resumo da semana",
    highlightsTitle: "Destaques da semana",
    rankingVerb: "Você encerrou a semana",
    opening: {
      above: "sua semana teve um resultado muito forte! 🔥",
      exact: "você fechou a semana com consistência e foco. 👏",
      below: "sua semana contribuiu para a construção de um resultado sólido. 👏"
    },
    meta: {
      above: (percent) => `Você fechou a semana com *${percent}% da meta*. Resultado de destaque — sua evolução ao longo da semana mostra muita consistência.`,
      exact: () => "Você fechou a semana com *100% da meta concluída*, um resultado que mostra constância no seu trabalho.",
      below: () => "Sua semana faz parte da construção de um resultado maior — cada dia de trabalho soma para o seu crescimento."
    },
    closing: {
      above: "Parabéns pela semana de resultados fortes — esse ritmo mostra muita dedicação. 🚀",
      exact: "Parabéns pela semana consistente. Seguir nesse ritmo constrói resultados cada vez maiores. ✅",
      below: "Continue firme. Cada semana é um novo degrau na construção do seu resultado. 💪"
    }
  },
  last30: {
    title: "Resumo do mês",
    highlightsTitle: "Destaques do mês",
    rankingVerb: "Você encerrou o mês",
    opening: {
      above: "seu mês foi de resultados extraordinários! 🔥",
      exact: "você encerrou o mês com uma entrega muito consistente. 👏",
      below: "esse mês fez parte da sua evolução constante. 👏"
    },
    meta: {
      above: (percent) => `Você fechou o mês com *${percent}% da meta*. Um resultado de destaque que mostra a força do seu trabalho ao longo do ciclo.`,
      exact: () => "Você fechou o mês com *100% da meta concluída* — um ciclo de trabalho consistente do início ao fim.",
      below: () => "Esse mês faz parte da sua construção de resultados — cada ciclo é uma nova oportunidade de evoluir."
    },
    closing: {
      above: "Parabéns por fechar o mês com esse nível de entrega — resultado de quem trabalha com consistência. 🚀",
      exact: "Parabéns por fechar o mês com essa consistência. Esse é o tipo de trabalho que constrói resultados sólidos. ✅",
      below: "Encerramos mais um ciclo. Cada mês é uma nova oportunidade de crescer ainda mais — continue confiando no processo. 💪"
    }
  }
};

// Modelos padrão, editáveis em "Configurar mensagens" (crm_settings). Os
// tokens {destaques}, {meta_bloco}, {abertura}, {fechamento} e
// {ranking_frase} são "compostos": o próprio sistema decide o conteúdo
// (tom, presença/ausência) — o admin só escolhe ONDE eles aparecem no
// texto, nunca o valor em si, porque é exatamente aí que moram as regras
// obrigatórias (nunca indicador zerado, nunca frase negativa). Cada um já
// vem com sua própria quebra de linha quando tem conteúdo, e vira "" (sem
// deixar buraco) quando não se aplica.
const TEMPLATE_DEFAULTS = {
  inicio_motivacao:
    "*Bom dia, {corretor}! ☀️*\n\nHoje começa uma nova oportunidade de construir um grande resultado.\n\nCada contato, cada atendimento e cada ação pode fazer diferença no seu dia.\n\nMantenha o ritmo, cuide de cada oportunidade e faça acontecer. 🚀\n\n*Vamos pra cima!*",

  inicio_foco_meta:
    "*Bom dia, {corretor}! 🎯*\n\n{meta_bloco}\n\nComece com intensidade, mantenha a constância durante o dia e trate cada oportunidade como importante.\n\nVocê tem capacidade para construir um excelente resultado hoje. 🚀",

  acompanhamento_incentivo:
    "*{corretor}, seguimos construindo o dia! 💪*\n\nAinda temos tempo para avançar bastante e cada novo contato pode fazer diferença no resultado de hoje.\n\nVocê já colocou o dia em movimento. Agora é manter intensidade e constância nessa próxima etapa. 🚀{destaques}",

  acompanhamento_evolucao:
    "*{corretor}, ótimo avanço até aqui! 👏*\n\nVocê já alcançou *{meta_percentual} da sua meta* e ainda temos bastante oportunidade pela frente.{destaques}\n\nContinue nesse ritmo. Você está construindo um ótimo resultado. 🚀",

  acompanhamento_quase:
    "*{corretor}, falta muito pouco! 🔥*\n\nVocê já alcançou *{meta_percentual} da sua meta*.\n\nO resultado está muito perto e ainda temos tempo para ir além.{destaques}\n\nMantenha o ritmo. Está nas suas mãos concluir e superar essa meta. 🚀",

  acompanhamento_superada:
    "*{corretor}, meta concluída! 🔥*\n\nVocê já alcançou *{meta_percentual} da sua meta* e ainda temos parte do dia pela frente.\n\nExcelente trabalho até aqui. Agora a oportunidade é ampliar ainda mais esse resultado. 🚀{destaques}",

  fechamento_today: "*Resumo do dia*\n\n{corretor}, {abertura}{meta_bloco}{destaques}\n\n*Ranking*\n{ranking_frase}\n\n{fechamento}",
  fechamento_last7: "*Resumo da semana*\n\n{corretor}, {abertura}{meta_bloco}{destaques}\n\n*Ranking*\n{ranking_frase}\n\n{fechamento}",
  fechamento_last30: "*Resumo do mês*\n\n{corretor}, {abertura}{meta_bloco}{destaques}\n\n*Ranking*\n{ranking_frase}\n\n{fechamento}"
};

// Mesmas variáveis já existentes + os 5 tokens compostos (documentados
// acima). Usado tanto pra popular a legenda em "Configurar mensagens"
// quanto pra validar que ninguém salve um modelo com {token} inexistente.
export const MANUAL_SUMMARY_VARIABLES = [
  { key: "corretor", label: "Nome do corretor" },
  { key: "periodo", label: "Período (ex.: Hoje, Últimos 7 dias)" },
  { key: "posicao_ranking", label: "Posição no ranking (ex.: 2º)" },
  { key: "pontos", label: "Pontos no período" },
  { key: "meta_percentual", label: "% da meta concluída" },
  { key: "meta_realizada", label: "Quantidade realizada da meta" },
  { key: "meta_total", label: "Quantidade total da meta" },
  { key: "prospeccoes", label: "Prospecções realizadas" },
  { key: "novos_clientes", label: "Novos clientes" },
  { key: "atendimentos", label: "Atendimentos" },
  { key: "simulacoes", label: "Simulações" },
  { key: "documentacoes", label: "Documentações recebidas" },
  { key: "aprovacoes", label: "Aprovações" },
  { key: "vendas", label: "Vendas" },
  { key: "atividades_realizadas", label: "Atividades concluídas" },
  { key: "atividades_pendentes", label: "Atividades pendentes" },
  { key: "destaques", label: "Bloco de destaques (automático — some se não houver indicador > 0)" },
  { key: "meta_bloco", label: "Bloco da meta (automático — texto muda conforme o momento/percentual)" },
  { key: "abertura", label: "Frase de abertura (automática — tom conforme o percentual)" },
  { key: "fechamento", label: "Frase de fechamento (automática — tom conforme o percentual)" },
  { key: "ranking_frase", label: "Frase do ranking (automática)" }
];
const VALID_VARIABLE_KEYS = new Set(MANUAL_SUMMARY_VARIABLES.map((variable) => variable.key));

const TEMPLATES_SETTING_ID = "whatsapp_manual_templates";
const PERIOD_VALUES = ["today", "last7", "last30"];

function normalizePeriod(period) {
  return PERIOD_VALUES.includes(period) ? period : "today";
}

function pickMetaTier(percent) {
  if (percent > 100) return "above";
  if (percent === 100) return "exact";
  return "below";
}

// Faixas do Acompanhamento automático — ajustável aqui caso o dono peça
// outro corte, sem mexer no resto da lógica.
function pickAcompanhamentoKind(percent) {
  if (percent >= 100) return "acompanhamento_superada";
  if (percent >= 80) return "acompanhamento_quase";
  if (percent >= 50) return "acompanhamento_evolucao";
  return "acompanhamento_incentivo";
}

// "acompanhamento_auto" nunca é o modelo final — sempre resolve pra um dos
// 4 reais, conforme o percentual de CADA corretor (mensagem individual,
// nunca o mesmo texto genérico pra todos). Corretor sem meta configurada
// hoje nunca recebe um modelo que menciona percentual — cai em Incentivo,
// o único que não depende de meta_percentual.
function resolveMessageKey(requestedKey, row) {
  if (requestedKey === "acompanhamento_auto") {
    return row.meta.hasMeta ? pickAcompanhamentoKind(row.meta.percent) : "acompanhamento_incentivo";
  }
  if (requestedKey.startsWith("acompanhamento_") && !row.meta.hasMeta) return "acompanhamento_incentivo";
  return requestedKey;
}

function resolvePeriodForKey(messageKey) {
  if (messageKey.startsWith("fechamento_")) return messageKey.replace("fechamento_", "");
  return "today";
}

function buildDestaquesBlock(row, title) {
  const lines = INDICATOR_LABELS
    .map(({ key, singular, plural }) => {
      const count = row.indicators[key] || 0;
      return { count, label: count === 1 ? singular : plural };
    })
    .filter((item) => item.count > 0)
    .map((item) => `• ${item.count} ${item.label}`);
  return lines.length ? `\n\n*${title}*\n${lines.join("\n")}` : "";
}

function buildBaseVariables(row, periodLabel) {
  return {
    corretor: row.name,
    periodo: periodLabel || "",
    posicao_ranking: `${row.rankingPosition}º`,
    pontos: String(row.points),
    meta_percentual: row.meta.hasMeta ? `${row.meta.percent}%` : "",
    meta_realizada: row.meta.hasMeta ? String(row.meta.done) : "",
    meta_total: row.meta.hasMeta ? String(row.meta.total) : "",
    prospeccoes: String(row.indicators.prospeccoes),
    novos_clientes: String(row.indicators.novos_clientes),
    atendimentos: String(row.indicators.atendimentos),
    simulacoes: String(row.indicators.simulacoes),
    documentacoes: String(row.indicators.documentacoes),
    aprovacoes: String(row.indicators.aprovacoes),
    vendas: String(row.indicators.vendas),
    atividades_realizadas: String(row.indicators.atividades_realizadas),
    atividades_pendentes: String(row.indicators.atividades_pendentes)
  };
}

function buildComposedTokens(row, messageKey) {
  const tokens = {};

  if (messageKey === "inicio_foco_meta") {
    tokens.meta_bloco = row.meta.hasMeta
      ? `Mais um dia começando e a sua meta já está definida.\n\n*Meta de hoje*\n${row.meta.total} ${row.meta.total === 1 ? "atividade" : "atividades"}`
      : "Mais um dia começando, cheio de oportunidades para você aproveitar.";
    return tokens;
  }

  if (messageKey.startsWith("acompanhamento_")) {
    tokens.destaques = buildDestaquesBlock(row, "Destaques até agora");
    return tokens;
  }

  if (messageKey.startsWith("fechamento_")) {
    const periodKey = resolvePeriodForKey(messageKey);
    const period = PERIOD_TEXT[periodKey];
    const tier = row.meta.hasMeta ? pickMetaTier(row.meta.percent) : "below";
    tokens.abertura = period.opening[tier];
    tokens.fechamento = period.closing[tier];
    tokens.meta_bloco = row.meta.hasMeta ? `\n\n*Meta*\n${period.meta[tier](row.meta.percent)}` : "";
    tokens.destaques = buildDestaquesBlock(row, period.highlightsTitle);
    const pointsLabel = row.points === 1 ? "ponto" : "pontos";
    tokens.ranking_frase = `${period.rankingVerb} em *${row.rankingPosition}º lugar*, com *${row.points} ${pointsLabel}*.`;
    return tokens;
  }

  return tokens;
}

function renderTokens(template, variables) {
  return String(template || "").replace(/\{([a-z_]+)\}/g, (match, key) => (key in variables ? variables[key] : match));
}

// Colapsa quebras de linha extras que sobram quando um token composto
// resolve vazio (ex.: sem meta configurada) — nunca deixa "buraco" visível
// no meio da mensagem.
function cleanupSpacing(text) {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function buildMessageForRow(row, requestedKey, periodLabel, templates) {
  const resolvedKey = resolveMessageKey(requestedKey, row);
  const variables = { ...buildBaseVariables(row, periodLabel), ...buildComposedTokens(row, resolvedKey) };
  const template = templates[resolvedKey] || TEMPLATE_DEFAULTS[resolvedKey] || "";
  return { message: cleanupSpacing(renderTokens(template, variables)), resolvedKey };
}

// Uma única chamada a getPerformanceOverview + getOwnerTeamDailyOverview já
// traz TODA a equipe de uma vez — "gerar para todos" não custa mais caro
// que gerar para 1 corretor, só usa a mesma resposta pra montar N mensagens.
async function computeManualSummaryTeamData(period) {
  const periodKey = normalizePeriod(period);
  const ownerAuth = { ok: true, user: { email: "mhmporttes@gmail.com" }, profile: { id: "", role: "admin" } };

  const [overview, dailyOverview, profiles] = await Promise.all([
    getPerformanceOverview({ period: periodKey }, ownerAuth),
    getOwnerTeamDailyOverview({ period: periodKey }, ownerAuth),
    listAdminProfiles()
  ]);

  const metaByBroker = new Map(dailyOverview.brokers.map((broker) => [broker.brokerId, broker.meta]));
  const phoneById = new Map(profiles.map((profile) => [profile.id, profile.phone || ""]));

  const rows = overview.ranking.map((row, index) => {
    const brokerId = row.profile.id;
    const meta = metaByBroker.get(brokerId) || { done: 0, total: 0, percent: 0 };

    return {
      brokerId,
      name: row.profile.name || "Corretor",
      phone: phoneById.get(brokerId) || "",
      rankingPosition: index + 1,
      points: row.points || 0,
      meta: { hasMeta: meta.total > 0, percent: meta.percent || 0, done: meta.done || 0, total: meta.total || 0 },
      indicators: {
        prospeccoes: row.prospecting || 0,
        novos_clientes: row.newClients || 0,
        atendimentos: row.service || 0,
        simulacoes: row.simulation || 0,
        documentacoes: row.documentation || 0,
        aprovacoes: row.approval || 0,
        vendas: row.sale || 0,
        atividades_realizadas: row.completedActivities || 0,
        atividades_pendentes: row.awaitingAction || 0
      }
    };
  });

  return { periodLabel: overview.range.label, rows };
}

export async function getManualMessageTemplates() {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from("crm_settings").select("setting_value").eq("id", TEMPLATES_SETTING_ID).maybeSingle();
  if (error) throw error;
  return { ...TEMPLATE_DEFAULTS, ...(data?.setting_value || {}) };
}

// Nunca aceita salvar um modelo com variável desconhecida — evita "modelo
// quebrado": melhor recusar o salvamento do que gerar {token_invalido}
// literal na mensagem depois.
export function validateManualMessageTemplate(template) {
  const text = String(template || "");
  const tokens = [...text.matchAll(/\{([a-z_]+)\}/g)].map((match) => match[1]);
  const invalidTokens = [...new Set(tokens.filter((token) => !VALID_VARIABLE_KEYS.has(token)))];
  return { valid: invalidTokens.length === 0 && text.trim().length > 0, invalidTokens };
}

export async function saveManualMessageTemplate(messageKey, template) {
  if (!MESSAGE_KIND_KEYS.includes(messageKey)) throw new Error("Tipo de mensagem inválido.");
  const { valid, invalidTokens } = validateManualMessageTemplate(template);
  if (!valid) {
    throw new Error(
      invalidTokens.length
        ? `Variável desconhecida no modelo: ${invalidTokens.map((token) => `{${token}}`).join(", ")}`
        : "A mensagem não pode ficar vazia."
    );
  }

  const current = await getManualMessageTemplates();
  const next = { ...current, [messageKey]: template };
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("crm_settings").upsert({
    id: TEMPLATES_SETTING_ID,
    setting_value: next,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
  return next;
}

export async function buildManualWhatsappSummary({ brokerId, messageKey, period }) {
  const key = MESSAGE_KIND_KEYS.includes(messageKey) || messageKey === "acompanhamento_auto"
    ? messageKey
    : `fechamento_${normalizePeriod(period)}`;
  const { periodLabel, rows } = await computeManualSummaryTeamData(resolvePeriodForKey(key));
  const row = rows.find((item) => item.brokerId === brokerId);
  if (!row) throw new Error("Corretor não encontrado.");

  const templates = await getManualMessageTemplates();
  const { message, resolvedKey } = buildMessageForRow(row, key, periodLabel, templates);

  return { message, brokerName: row.name, phone: row.phone, periodLabel, messageKind: resolvedKey };
}

export async function buildManualWhatsappSummaryForAll({ messageKey, period }) {
  const key = MESSAGE_KIND_KEYS.includes(messageKey) || messageKey === "acompanhamento_auto"
    ? messageKey
    : `fechamento_${normalizePeriod(period)}`;
  const { periodLabel, rows } = await computeManualSummaryTeamData(resolvePeriodForKey(key));
  const templates = await getManualMessageTemplates();

  return {
    periodLabel,
    items: rows.map((row) => {
      const { message, resolvedKey } = buildMessageForRow(row, key, periodLabel, templates);
      return { brokerId: row.brokerId, brokerName: row.name, phone: row.phone, message, messageKind: resolvedKey };
    })
  };
}

// Histórico: só registra "aberto" (o clique real em Abrir WhatsApp) e,
// separadamente, "marcado como enviado" (ação manual explícita depois) —
// nunca "enviado" de verdade, já que o CRM não tem como saber se a
// mensagem foi de fato enviada dentro do WhatsApp de terceiros.
// message_kind identifica qual das 9 mensagens foi essa (ex.:
// "acompanhamento_evolucao"), pro histórico mostrar "Acompanhamento —
// Evolução" em vez de só o período.
export async function logManualWhatsappAction({ brokerId, performedBy, messageKind, action }) {
  if (!["opened", "marked_sent"].includes(action)) throw new Error("Ação de histórico inválida.");
  const kind = MESSAGE_KIND_KEYS.includes(messageKind) ? messageKind : "fechamento_today";
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("whatsapp_manual_log").insert({
    broker_id: brokerId,
    performed_by: performedBy || null,
    summary_type: resolvePeriodForKey(kind),
    message_kind: kind,
    action
  });
  if (error) throw error;
}

export async function listManualWhatsappLog({ limit = 20 } = {}) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_manual_log")
    .select("id, broker_id, performed_by, summary_type, message_kind, action, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 100));
  if (error) throw error;

  const profiles = (data || []).length ? await listAdminProfiles() : [];
  const nameById = new Map(profiles.map((profile) => [profile.id, profile.name]));

  return (data || []).map((row) => ({
    id: row.id,
    brokerName: nameById.get(row.broker_id) || "Corretor",
    performedByName: nameById.get(row.performed_by) || "",
    messageKindLabel: MESSAGE_KIND_LABELS[row.message_kind] || MESSAGE_KIND_LABELS[`fechamento_${row.summary_type}`] || row.summary_type,
    action: row.action,
    createdAt: row.created_at
  }));
}
