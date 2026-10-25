// Resumo positivo do Henry (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24, docs/BUSINESS_RULES.md HENRY-1 "Resumo
// positivo"): "se eu perguntar qual foi o desempenho da equipe hoje, eu quero que ele me fale apenas as coisas boas [...]
// Se não foi realizada nenhuma [simulação], ele não fala 'não foi realizada nenhuma simulação'."
//   - Resumo de desempenho (bom dia/relatório do dia, "como foi o dia/a semana", equipe, corretor, período): a FALA só
//     traz o que foi bom — número zero não se fala; parados, atrasados, sem atendimento, aguardando e quedas também não.
//     A TELA (detail) continua com os dados completos.
//   - Dia fraco (nada de bom para contar): UMA frase curta de ânimo, sem número, sem repetir no dia.
//   - Pergunta DIRETA de uma métrica ("quantas simulações hoje?"): responde o número, inclusive zero.
// Núcleo PURO (testes em tests/henry-positive-summary.test.mjs). Avisos operacionais (cliente novo/transferido,
// aniversariante, conversas aguardando quando perguntado) NÃO passam por aqui.

import { contagem, isFeminineWord } from "./pt-br-concordancia.mjs";
import { HENRY_SLOW_DAY_PHRASES, HENRY_SLOW_PERIOD_PHRASES } from "./henry-voice-persona.mjs";

const plainText = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// --- Pergunta direta de uma métrica x resumo de desempenho -------------------------------------------------------------
const METRIC = /\b(leads?|clientes? novos?|novos? clientes?|cadastros?|atendimentos?|atend(eu|eram|emos)|simulac\w*|simul(ou|aram|amos)|documentac\w*|aprovad\w*|aprovac\w*|vendas?|vend(eu|eram|emos)|pontos?|pontu\w*|prospecc\w*|prospect\w*|visitas?|reuni(ao|oes)|meta|ranking|posicao|colocacao|transferencias?)\b/;
const DIRECT = /\b(quant[oa]s?|qual (foi |e |eh )?(o |a )?(numero|total|quantidade|posicao|colocacao|percentual|porcentagem)|em que (posicao|lugar|colocacao)|(teve|tivemos|houve|rolou|fez|fizeram|saiu|sairam|bateu|bateram|entrou|entraram) (algum|alguma|alguns|algumas|a meta))\b/;
const STRONG_SUMMARY = /\b(desempenho|resumo|relatorio|balanco|panorama|novidades?|bom dia|boa tarde|boa noite|o que (rolou|teve de bom|aconteceu)|numeros)\b/;
const SOFT_SUMMARY = /\b(como (foi|foram|esta|estao|ta|tao|anda|andam|andou|vai|vao|ficou|ficaram|se saiu|se sairam|saiu))\b/;

// "direta" = pergunta de UMA métrica (ou poucas, nomeadas): responde o número, inclusive zero.
// "resumo" = desempenho geral (equipe, corretor, dia, período): só o positivo.
// "outra" = nem um nem outro (papo, cliente, música...): esta regra não se aplica.
export function henryQuestionKind(text) {
  const value = plainText(text);
  if (!value) return "outra";
  const metric = METRIC.test(value);
  if (metric && DIRECT.test(value)) return "direta";
  if (STRONG_SUMMARY.test(value)) return "resumo";
  // "como estão as vendas?" fala de UMA métrica → direta; "como foi a Carol no mês?" (sem métrica) → resumo.
  if (SOFT_SUMMARY.test(value)) return metric ? "direta" : "resumo";
  return metric ? "direta" : "outra";
}

export function isDirectMetricQuestion(text) {
  return henryQuestionKind(text) === "direta";
}

// Fala positiva? Tudo que não é pergunta direta de métrica (o "bom dia" chega sem pergunta = resumo).
export function wantsPositiveSummary(text) {
  return henryQuestionKind(text) !== "direta";
}

// --- Contagens -----------------------------------------------------------------------------------------------------------
// Só o que é maior que zero entra na fala positiva ("" para zero, vazio ou indisponível).
export function positiveCount(n, singular, plural, options) {
  const value = Number(n);
  return Number.isFinite(value) && value > 0 ? contagem(value, singular, plural, options) : "";
}

// Zero numa pergunta direta: "nenhuma simulação" / "nenhum atendimento" (gênero pela 1ª palavra).
export function zeroCount(singular) {
  const head = String(singular || "").split(/\s+/)[0];
  return `${isFeminineWord(head) ? "nenhuma" : "nenhum"} ${singular}`;
}

export function joinPt(parts = []) {
  const list = parts.filter(Boolean);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

// --- Filtro da frase pronta (catálogo da Alexa no Henry: resumo, desempenho, equipe, corretor) --------------------------
// A frase é compartilhada com a Alexa (que não muda); no Henry, num resumo, sai o que é negativo ou zero.
const NEGATIVE = /\b(nenhum\w*|ninguem|nao|aguard\w*|atenc\w*|parad\w*|atrasad\w*|sem (atendimento|contato|prospec\w*|resposta|movimento|meta)|frio\w*|esfriad\w*|desconect\w*|falta\w*|faltam|pendenc\w*|pendente\w*|vazi[oa]|cair\w*|caiu|queda|perd\w*|ocios\w*)\b/;
const ZERO = /(^|[\s:(])0(?=[\s%,.;)]|$)|\bzero\b/;

function splitSentences(text) {
  return String(text || "").split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
}

// Item de lista com zero sai ("Hoje: 0 clientes novos, 12 prospecções e 1 aprovação." → "Hoje: 12 prospecções e 1
// aprovação."); sem item nenhum, a frase sai inteira.
function dropZeroItems(sentence) {
  const end = /[.!?]$/.test(sentence) ? sentence.slice(-1) : "";
  const body = end ? sentence.slice(0, -1) : sentence;
  const colon = body.indexOf(": ");
  const prefix = colon >= 0 ? body.slice(0, colon + 2) : "";
  const list = colon >= 0 ? body.slice(colon + 2) : body;
  const items = list.split(/,\s+|\s+e\s+/).map((item) => item.trim()).filter(Boolean);
  const kept = items.filter((item) => !ZERO.test(plainText(item)) && !ZERO.test(item));
  if (!kept.length) return "";
  return `${prefix}${joinPt(kept)}${end}`;
}

export function positiveSpeech(text) {
  const kept = [];
  for (const sentence of splitSentences(text)) {
    const plain = plainText(sentence);
    if (NEGATIVE.test(plain)) continue;
    const clean = ZERO.test(sentence) ? dropZeroItems(sentence) : sentence;
    if (clean) kept.push(clean);
  }
  return kept.join(" ");
}

// Só a saudação ("Bom dia, Matheus.") não conta como algo bom para contar.
const GREETING_ONLY = /^(bom dia|boa tarde|boa noite|ola|oi)\b[^.!?]*[.!?]?$/i;
export function hasPositiveContent(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  return splitSentences(value).some((sentence) => !GREETING_ONLY.test(plainText(sentence)) || /\d/.test(sentence));
}

// --- Números para o modelo no resumo: sem zeros e sem os itens negativos (o que falhou continua "indisponível") ----------
const NEGATIVE_FACT_KEYS = new Set(["agora", "aguardando_resposta", "esfriados_para_decidir", "atrasadas", "sem_contato", "periodo_anterior", "aviso"]);
export function prunePositiveFacts(value) {
  if (Array.isArray(value)) return value.map(prunePositiveFacts).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (NEGATIVE_FACT_KEYS.has(key)) continue;
      const next = prunePositiveFacts(item);
      if (next === undefined) continue;
      if (next && typeof next === "object" && !Array.isArray(next) && !Object.keys(next).length) continue;
      out[key] = next;
    }
    return out;
  }
  if (typeof value === "number" && value <= 0) return undefined;
  // "indisponível" fica: a fonte falhou e o modelo não pode tratar como zero nem como "nada".
  if (typeof value === "string" && (/^0%?$/.test(value) || /^sem /.test(value) || value === "fora do ranking")) return undefined;
  return value;
}

// --- Dia fraco: frase curta de ânimo, sem número, sem repetir no dia -----------------------------------------------------
// turns = memória do dia (henry_day_memory); frase que já saiu numa resposta de hoje não volta (todas usadas → sorteia
// qualquer uma diferente da última).
export function pickSlowDayPhrase({ today = true, turns = [], random = Math.random } = {}) {
  const bank = today ? HENRY_SLOW_DAY_PHRASES : HENRY_SLOW_PERIOD_PHRASES;
  const said = (turns || []).filter((turn) => turn?.role === "assistant" && turn.text).map((turn) => plainText(turn.text));
  const unused = bank.filter((phrase) => !said.some((text) => text.includes(plainText(phrase))));
  const last = [...bank].reverse().find((phrase) => said.some((text) => text.includes(plainText(phrase))));
  const pool = unused.length ? unused : bank.filter((phrase) => phrase !== last);
  const source = pool.length ? pool : bank;
  const index = Math.min(source.length - 1, Math.floor(Math.max(0, Math.min(0.9999, Number(random()) || 0)) * source.length));
  return source[index];
}

// Período de hoje? (o banco do dia fala em "hoje/amanhã"; os outros períodos usam o banco de período).
export function isTodayRange(range) {
  return !range || range.id === "hoje";
}

// --- Relatório do dia ("bom dia, Henry") só com o que foi bom --------------------------------------------------------------
// greeting = 1ª frase do texto do Início ("Bom dia, Matheus."); leadsToday = leads de hoje; rows = equipe do Início do
// dono (presença e Meta do dia); extras = loadHenryMorningExtras (clientes novos desde ontem, simulações automáticas e
// envios). Leitura que falhou (null) fica fora, nunca vira zero. Devolve { text, positive } — positive = false quando não
// há nada de bom para contar (o chamador acrescenta a frase de ânimo).
// Lead e cliente novo são a MESMA coisa (REGRA OFICIAL, dono 2026-10-25: "Leads e clientes novos são a mesma coisa. Pode
// falar '201 novos clientes'"): a fala traz UM item só, "N clientes novos", pela definição do Início (leadsToday = cadastros
// criados hoje, loadLeadsToday em lib/painel-inicio.js). Sem esse número (leitura falhou ou zero), vale o "desde ontem"
// do bom dia (mesma contagem com a janela começando ontem) — nunca os dois.
export function composePositiveDailyFacts({ leadsToday = null, rows = null, extras = null } = {}) {
  const parts = [];
  const today = positiveCount(leadsToday, "cliente novo", "clientes novos");
  if (today) parts.push(Number(leadsToday) === 1 ? `Hoje já entrou ${today}.` : `Hoje já entraram ${today}.`);
  if (extras) {
    const newClients = today ? "" : positiveCount(extras.newClients, "cliente novo", "clientes novos");
    if (newClients) parts.push(`Desde ontem ${Number(extras.newClients) === 1 ? "entrou" : "entraram"} ${newClients} no CRM.`);
    const autoSimulations = Number.isFinite(extras.newClients) && extras.newClients > 0 ? positiveCount(extras.autoSimulations, "simulação automática", "simulações automáticas") : "";
    if (autoSimulations) parts.push(`Já ${Number(extras.autoSimulations) === 1 ? "saiu" : "saíram"} ${autoSimulations} pelo site.`);
    const sends = positiveCount(extras.autoSimulationSends, "cliente", "clientes");
    if (sends) parts.push(`Já enviei a simulação para ${sends}.`);
  }
  if (Array.isArray(rows)) {
    const online = rows.filter((row) => row?.presence === "online").length;
    const onlineText = positiveCount(online, "pessoa da equipe", "pessoas da equipe");
    if (onlineText) parts.push(`${onlineText[0].toLocaleUpperCase("pt-BR")}${onlineText.slice(1)} já ${online === 1 ? "está" : "estão"} on-line.`);
    const hit = rows.filter((row) => Number.isFinite(row?.metaPercent) && row.metaPercent >= 100).length;
    const hitText = positiveCount(hit, "corretor", "corretores");
    if (hitText) parts.push(`${hitText[0].toLocaleUpperCase("pt-BR")}${hitText.slice(1)} já ${hit === 1 ? "bateu" : "bateram"} a Meta Diária.`);
  }
  return { text: parts.join(" "), positive: parts.length > 0 };
}

export function greetingOf(text) {
  const match = String(text || "").trim().match(/^([^.!?]+[.!?])/);
  return match ? match[1] : "";
}
