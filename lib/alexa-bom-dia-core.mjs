// Núcleo PURO (testável) do "Bom dia no primeiro acesso" da Alexa (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md
// INI-4). Monta a fala SÓ com os números que a tela Início já calcula (lib/painel-inicio.js → getPainelInicio): nenhuma
// conta nova mora aqui. Só contagens e primeiro nome — nunca telefone, CPF, renda ou valores.
import { OWNER_SPOKEN_NAME, containsSensitiveContent, firstName, greetingForMinutes, saoPauloDateKey } from "./alexa-config-core.mjs";
import { INVOCATION_NAME } from "./alexa-v2/model-core.mjs";

// speakAlexa (lib/alexa-voice.js) corta em 400 caracteres: a fala é montada para caber inteira.
export const BRIEFING_MAX_LENGTH = 400;

function count(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function joinPt(parts) {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

// Espera falada: "12 minutos", "2 horas", "3 dias" (sem "h"/"min", que a Alexa leria letra a letra).
export function spokenWait(minutes) {
  if (!Number.isFinite(minutes) || minutes < 1) return "";
  if (minutes < 60) return plural(minutes, "minuto", "minutos");
  if (minutes < 24 * 60) return plural(Math.floor(minutes / 60), "hora", "horas");
  return plural(Math.floor(minutes / (24 * 60)), "dia", "dias");
}

function leadsSentence(leads) {
  if (!leads || !Number.isFinite(leads.total)) return "";
  if (leads.total <= 0) return "Ainda não entrou nenhum lead hoje.";
  const origins = [];
  if (count(leads.ad)) origins.push({ n: leads.ad, text: "de anúncio" });
  if (count(leads.marketplace)) origins.push({ n: leads.marketplace, text: "do Marketplace" });
  if (count(leads.other)) origins.push({ n: leads.other, text: leads.other === 1 ? "de outra origem" : "de outras origens" });
  const head = leads.total === 1 ? "Hoje entrou 1 lead" : `Hoje entraram ${leads.total} leads`;
  if (origins.length === 1) return `${head}, ${leads.total === 1 ? "" : "todos "}${origins[0].text}.`;
  if (!origins.length) return `${head}.`;
  return `${head}: ${joinPt(origins.map((item) => `${item.n} ${item.text}`))}.`;
}

function awaitingSentence(awaitingReply, urgent, withName) {
  const n = count(awaitingReply);
  if (!n) return "";
  const head = n === 1 ? "1 cliente aguarda resposta" : `${n} clientes aguardam resposta`;
  const name = withName ? firstName(urgent?.name) : "";
  if (!name) return `${head}.`;
  const wait = spokenWait(urgent?.waitingMinutes);
  return `${head}; comece por ${name}${wait ? `, que espera há ${wait}` : ""}.`;
}

function pendingSentence({ toReview, overdue, docs }) {
  const parts = [];
  if (count(toReview)) parts.push(plural(toReview, "simulação a conferir", "simulações a conferir"));
  if (count(overdue)) parts.push(plural(overdue, "atividade atrasada", "atividades atrasadas"));
  if (count(docs)) parts.push(plural(docs, "cliente aguardando documentos", "clientes aguardando documentos"));
  return parts.length ? `Há ${joinPt(parts)}.` : "";
}

// A pergunta final. Com a skill interativa (lib/alexa-skill.js, invocação INVOCATION_NAME), convida a abrir a skill —
// o Voice Monkey só anuncia, não abre conversa; quem responde é o dono pela skill. Sem invocação, pergunta retórica.
export function closingQuestion(invocation = INVOCATION_NAME) {
  return invocation ? `Quer os detalhes? É só dizer: Alexa, abrir ${invocation}.` : "Por onde vamos começar?";
}

// data: { minutesOfDay, leads: {total, ad, marketplace, other}|null, awaitingReply, urgent: {name, waitingMinutes}|null,
// toReview, overdue, docs, arrivalCovered, invocation, address }. Valor null = indisponível → fica fora da fala.
// arrivalCovered: a rotina "Chegada ao escritório" já falou (ou vai falar) o resumo hoje → só o bom dia, sem repetir.
export function composeFirstAccessBriefing(data = {}) {
  const greeting = greetingForMinutes(Number.isFinite(data.minutesOfDay) ? data.minutesOfDay : 480);
  const address = data.address === undefined ? OWNER_SPOKEN_NAME : data.address;
  const head = address ? `${greeting}, ${address}.` : `${greeting}.`;
  const question = closingQuestion(data.invocation === undefined ? INVOCATION_NAME : data.invocation);

  if (data.arrivalCovered) return `${head} O resumo de hoje já saiu na chegada ao escritório; os números atualizados estão na tela Início.`;

  const build = (withName) => {
    const body = [leadsSentence(data.leads), awaitingSentence(data.awaitingReply, data.urgent, withName), pendingSentence(data)].filter(Boolean);
    if (!count(data.awaitingReply) && !pendingSentence(data)) body.push("Nada urgente agora.");
    // Corta do fim para o começo (a pergunta fica sempre) até caber no limite da fala.
    const kept = [head, ...body];
    let text = [...kept, question].join(" ");
    while (text.length > BRIEFING_MAX_LENGTH && kept.length > 1) {
      kept.pop();
      text = [...kept, question].join(" ");
    }
    return text;
  };

  // Nome do cliente que pareça dado sensível (ex.: "Renda") sai da fala; se ainda assim for sensível, não fala nada.
  const withName = build(true);
  if (!containsSensitiveContent(withName)) return withName;
  const withoutName = build(false);
  return containsSensitiveContent(withoutName) ? "" : withoutName;
}

// Converte o retorno de getPainelInicio (lib/painel-inicio.js) na entrada da fala — os MESMOS números da tela Início.
export function briefingInputFromInicio(inicio, { minutesOfDay, arrivalCovered = false } = {}) {
  const kpis = inicio?.kpis || {};
  return {
    minutesOfDay,
    arrivalCovered,
    leads: kpis.leadsToday || null,
    awaitingReply: inicio?.awaitingReply ?? null,
    urgent: inicio?.assistant?.urgent || null,
    toReview: kpis.toReview ?? null,
    overdue: inicio?.overdue ?? null,
    docs: kpis.docs ? kpis.docs.total : null
  };
}

// A rotina "Chegada ao escritório" (lib/alexa-arrival.js, alexa_arrival_state) já cobre o resumo de hoje? Sim quando
// falou com sucesso hoje (data de São Paulo) ou quando a chegada de hoje está registrada e a fala ainda vai sair.
export function arrivalCoversToday(state, today) {
  if (!state || !today) return false;
  if (state.pending_run_at && state.last_arrival_date === today) return true;
  return state.last_run_status === "ok" && Boolean(state.last_run_at) && saoPauloDateKey(new Date(state.last_run_at)) === today;
}
