// Henry: clientes por ETAPA e por SUB-STATUS (situação) AGORA, da equipe ou de um corretor — os MESMOS números da tela
// Clientes (bug real, dono 2026-10-26: "Quantos clientes o Gabriel tem com status simulação enviada?" / "Simulação
// realizada" → "não tem nenhum cliente na etapa de simulação", com a tela mostrando aba Simulação 5 e "Simulação
// realizada" 2). Causa: o catálogo da Alexa conta a etapa `simulacao` como só "Aguardando simulação" (ETAPA_STATUSES,
// lib/alexa-v2/providers/funil.js) e não conhece sub-status; a tela conta a aba Simulação com 4 status.
// Regra daqui: etapa = aba da tela (CLIENT_STATUS_FILTER_GROUPS), sub-status = o filtro de status da tela
// (CLIENT_STATUS_OPTIONS, mesmos rótulos); os números vêm de getSimulationClientCounters (lib/henry-reports.js →
// loadHenryStageCounts). Aqui só se escolhe a etapa/situação e se monta a fala. Leitura que falhou nunca vira zero.

import { CLIENT_STATUS, CLIENT_STATUS_FILTER_GROUPS, CLIENT_STATUS_OPTIONS } from "./client-status.js";
import { clientFirstNameOf, firstNameOf } from "./alexa-v2/text.mjs";

// Etapa do Henry/Alexa (ETAPA_IDS) → aba da tela Clientes.
export const HENRY_STAGE_GROUP = Object.freeze({
  prospeccao: "prospecting",
  atendimento: "service",
  simulacao: "simulation",
  documentacao: "documentation",
  aprovacao: "approval",
  aprovados: "approved",
  reuniao: "meeting",
  venda: "sale"
});

const normalize = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const slugOf = (label) => normalize(label).replace(/\s+/g, "_");

// "Pago" não aparece na tela Clientes (some de todas as abas e contadores); "Todos" não é situação.
const SUBSTATUS_OPTIONS = CLIENT_STATUS_OPTIONS.filter((option) => option.value !== "all" && option.value !== CLIENT_STATUS.SALE_PAID);

// Ids falados ao modelo (campo `situacao` do consultar_crm): o rótulo da tela sem acento ("simulacao_realizada").
export const HENRY_SUBSTATUS = Object.freeze(SUBSTATUS_OPTIONS.map((option) => Object.freeze({ id: slugOf(option.label), status: option.value, label: option.label })));
export const HENRY_SUBSTATUS_IDS = HENRY_SUBSTATUS.map((item) => item.id);

const byId = new Map(HENRY_SUBSTATUS.map((item) => [item.id, item]));
const byStatus = new Map(HENRY_SUBSTATUS.map((item) => [item.status, item]));

export function henrySubStatus(value) {
  const key = String(value || "").trim();
  return byId.get(key) || byStatus.get(key) || null;
}

// Palavra do rótulo com plural opcional ("simulação realizada" casa "simulações realizadas").
function wordPattern(word) {
  if (word.endsWith("ao")) return `${word.slice(0, -2)}(?:ao|oes)`;
  return `${word}(?:s|es)?`;
}
const TEXT_PATTERNS = HENRY_SUBSTATUS
  .map((item) => ({ item, re: new RegExp(`(?:^| )${normalize(item.label).split(" ").map(wordPattern).join(" ")}(?: |$)`) }))
  // Rótulo mais longo primeiro ("documentação pendente" antes de qualquer pedaço).
  .sort((a, b) => b.item.label.length - a.item.label.length);

// Sub-status dito na pergunta, pelo rótulo da tela ("simulação realizada", "simulação enviada", "aguardando simulação"…).
export function henrySubStatusFromText(text) {
  const spoken = normalize(text);
  if (!spoken) return null;
  return TEXT_PATTERNS.find(({ re }) => re.test(spoken))?.item || null;
}

export function henryGroupOfStatus(status) {
  return CLIENT_STATUS_FILTER_GROUPS.find((group) => group.key !== "all" && group.statuses.includes(status)) || null;
}

const groupByKey = (key) => CLIENT_STATUS_FILTER_GROUPS.find((group) => group.key === key) || null;
const etapaOfGroup = (key) => Object.keys(HENRY_STAGE_GROUP).find((etapa) => HENRY_STAGE_GROUP[etapa] === key) || "";

// Pedido → { etapa, group, sub }. A situação dita (campo ou texto da pergunta) manda na etapa: é a mais específica.
export function resolveHenryStageRequest({ etapa = "", situacao = "", question = "" } = {}) {
  const sub = henrySubStatus(situacao) || henrySubStatusFromText(question);
  const subGroup = sub ? henryGroupOfStatus(sub.status) : null;
  const stageGroup = groupByKey(HENRY_STAGE_GROUP[etapa]);
  const group = subGroup || stageGroup;
  if (!group) return null;
  // Aba de um status só ("clientes aprovados" = aba Aprovados): é a etapa, não um sub-status.
  const onlyStatus = group.statuses.length === 1;
  return { etapa: etapaOfGroup(group.key) || etapa || "", group, sub: sub && !onlyStatus ? sub : null };
}

// Status da etapa (aba) ou só o da situação — para a lista de nomes, com os mesmos status da tela.
export function henryStageStatuses(request) {
  if (!request) return [];
  return request.sub ? [request.sub.status] : [...request.group.statuses];
}

// "com simulação realizada", "aguardando simulação", "em atendimento"…
const SUB_PHRASE = {
  [CLIENT_STATUS.APPROVED]: "aprovados",
  [CLIENT_STATUS.REJECTED]: "reprovados",
  [CLIENT_STATUS.AWAITING_RETURN]: "em tentativa de contato",
  [CLIENT_STATUS.RESEARCH_MO]: "com M.O de pesquisa"
};
export function henrySubStatusPhrase(sub) {
  if (!sub) return "";
  if (SUB_PHRASE[sub.status]) return SUB_PHRASE[sub.status];
  const lower = sub.label.toLocaleLowerCase("pt-BR");
  return /^(aguardando|em) /.test(lower) ? lower : `com ${lower}`;
}

const cap = (text) => (text ? text[0].toLocaleUpperCase("pt-BR") + text.slice(1) : "");
const clients = (n) => `${n} ${n === 1 ? "cliente" : "clientes"}`;
const joinPt = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`);
const subjectOf = (broker) => {
  const name = firstNameOf(broker?.name || "");
  if (!name) return "";
  return broker?.gender === "female" ? `a ${name}` : broker?.gender === "male" ? `o ${name}` : name;
};

// counters = { byGroup, byStatus } de getSimulationClientCounters (null = leitura falhou → null, nunca zero).
// rows (opcional, formato lista) = [{ full_name }] mais antigos primeiro.
export function buildHenryStageCountReport({ request, counters, broker = null, rows = null } = {}) {
  if (!request || !counters || typeof counters !== "object" || !counters.byGroup || !counters.byStatus) return null;
  const { group, sub } = request;
  const total = Number(counters.byGroup[group.key]);
  if (!Number.isFinite(total)) return null;
  const subCount = sub ? Number(counters.byStatus[sub.status]) || 0 : null;
  const who = subjectOf(broker);
  const stage = `na etapa ${group.label}`;
  const breakdown = group.statuses
    .map((status) => ({ sub: byStatus.get(status), n: Number(counters.byStatus[status]) || 0 }))
    .filter((item) => item.sub && item.n > 0);

  let spoken;
  if (!total) {
    spoken = who ? `${cap(who)} não tem nenhum cliente ${stage} agora.` : `Nenhum cliente ${stage} agora.`;
  } else {
    const head = who ? `${cap(who)} tem ${clients(total)} ${stage}` : `A equipe tem ${clients(total)} ${stage}`;
    if (sub) {
      spoken = `${head}; ${subCount ? subCount : "nenhum"} ${henrySubStatusPhrase(sub)}.`;
    } else if (breakdown.length > 1) {
      spoken = `${head}: ${joinPt(breakdown.map((item) => `${item.n} ${henrySubStatusPhrase(item.sub)}`))}.`;
    } else {
      spoken = `${head}.`;
    }
  }

  const names = Array.isArray(rows) ? rows.map((row) => clientFirstNameOf(row.full_name)).filter(Boolean).slice(0, 3) : [];
  const listCount = sub ? subCount : total;
  if (names.length && listCount) spoken += ` ${listCount === 1 || names.length === 1 ? "O mais antigo é" : "Os mais antigos são"} ${joinPt(names)}.`;

  const facts = {
    agora: true,
    fonte: "mesmos números da tela Clientes",
    ...(broker?.name ? { corretor: firstNameOf(broker.name) } : { escopo: "equipe" }),
    etapa: group.label,
    total_na_etapa: total,
    ...(sub ? { situacao: sub.label, total_na_situacao: subCount } : {}),
    por_situacao: Object.fromEntries(group.statuses.map((status) => [byStatus.get(status)?.label || status, Number(counters.byStatus[status]) || 0]))
  };
  const detail = {
    title: `Clientes em ${group.label}`,
    subtitle: broker?.name ? firstNameOf(broker.name) : "Equipe",
    sections: [
      { title: "Por situação", rows: group.statuses.map((status) => ({ label: byStatus.get(status)?.label || status, value: String(Number(counters.byStatus[status]) || 0) })) },
      ...(Array.isArray(rows) && rows.length ? [{ title: sub ? sub.label : "Mais antigos na etapa", rows: rows.slice(0, 30).map((row) => ({ label: String(row.full_name || "").trim() || "Cliente", value: row.broker || "" })) }] : [])
    ]
  };
  return { spoken, facts, detail };
}
