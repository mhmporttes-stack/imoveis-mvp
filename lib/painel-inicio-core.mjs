// Núcleo PURO (testável) da tela "Início" (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md INI-1).
// Só monta números e frases a partir de dados que as fontes já existentes entregam (lib/painel-inicio.js):
// nenhuma definição nova de funil, contato humano ou pendência mora aqui.
import { isHumanContactMessage } from "./human-contact-core.mjs";
import { hasPaidMediaEvidence } from "./lead-origin.js";

// TEMPO DE RESPOSTA (MET-6, REGRA OFICIAL do dono, 2026-10-03): mensagem do cliente -> primeira resposta HUMANA
// seguinte na mesma conversa, em tempo bruto. "Humana" = isHumanContactMessage (fonte única do contato humano).
// Várias mensagens seguidas do cliente contam a partir da PRIMEIRA (é dali que ele está esperando).
// messages: linhas de whatsapp_messages (conversation_id, direction, sender_type, status, message_type, metadata, message_at).
// Devolve os intervalos em segundos.
export function responseGapsSeconds(messages = []) {
  const byConversation = new Map();
  for (const message of messages) {
    if (!message?.conversation_id) continue;
    if (!byConversation.has(message.conversation_id)) byConversation.set(message.conversation_id, []);
    byConversation.get(message.conversation_id).push(message);
  }
  const gaps = [];
  for (const list of byConversation.values()) {
    list.sort((a, b) => new Date(a.message_at) - new Date(b.message_at));
    let waitingSince = null;
    for (const message of list) {
      const at = new Date(message.message_at).getTime();
      if (!Number.isFinite(at)) continue;
      if (message.direction === "inbound") {
        if (String(message.message_type || "") === "reaction") continue; // reação não é pergunta esperando resposta
        if (waitingSince === null) waitingSince = at;
        continue;
      }
      const human = isHumanContactMessage({
        direction: message.direction,
        senderType: message.sender_type,
        status: message.status,
        messageType: message.message_type,
        metadata: message.metadata
      });
      if (human && waitingSince !== null) {
        if (at >= waitingSince) gaps.push(Math.round((at - waitingSince) / 1000));
        waitingSince = null;
      }
    }
  }
  return gaps;
}

// MET-6: reportar MEDIANA e n (nunca média — cauda longa).
export function medianOf(values = []) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : Math.round((list[middle - 1] + list[middle]) / 2);
}

export function summarizeResponseTimes(messages = []) {
  const gaps = responseGapsSeconds(messages);
  return { medianSeconds: medianOf(gaps), count: gaps.length };
}

// "4 min 10 s", "45 s", "1 h 05 min".
export function formatDurationSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${seconds} s`;
  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) {
    const rest = seconds % 60;
    return rest ? `${totalMinutes} min ${rest} s` : `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} h ${String(minutes).padStart(2, "0")} min`;
}

// "Há quanto tempo espera": minutos -> "12 min", "2 h 05 min", "3 dias".
export function formatWaitMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return "";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
  const days = Math.floor(minutes / (24 * 60));
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

// Origem dos leads de hoje a partir do acquisition_context gravado no cadastro (o mesmo que vai para client_origins).
// Anúncio = mesma evidência da aba "Patrocinado" da lista de Clientes (SPONSORED_ORIGIN_FILTER, lib/simulation-list-query.js:
// anúncio de WhatsApp + hasPaidMediaEvidence); Marketplace = origem
// facebook_marketplace (MKT-2); o resto fica junto em "outras origens".
export function leadOriginBreakdown(rows = []) {
  const result = { total: 0, ad: 0, marketplace: 0, other: 0 };
  for (const row of rows) {
    const context = row?.acquisition_context && typeof row.acquisition_context === "object" ? row.acquisition_context : {};
    const kind = String(context.kind || "");
    result.total += 1;
    if (kind === "facebook_marketplace") result.marketplace += 1;
    else if (kind === "whatsapp_ad" || hasPaidMediaEvidence(kind, context.metadata || {})) result.ad += 1;
    else result.other += 1;
  }
  return result;
}

export function leadOriginHint(breakdown) {
  if (!breakdown?.total) return "nenhum cadastro novo hoje";
  const parts = [];
  if (breakdown.ad) parts.push(`${breakdown.ad} anúncio`);
  if (breakdown.marketplace) parts.push(`${breakdown.marketplace} Marketplace`);
  if (breakdown.other) parts.push(`${breakdown.other} ${breakdown.other === 1 ? "outra origem" : "outras origens"}`);
  return parts.join(" · ");
}

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function joinPt(parts) {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

// Frase do "assistente" (sem IA): só com os números recebidos. Item com valor null (fonte indisponível para o perfil,
// ex.: Chat bloqueado) fica fora da frase. urgent = { name, waitingMinutes } do cliente com a espera mais antiga.
export function buildAssistantText({ greeting = "Olá", firstName = "", awaitingReply = null, toReview = null, overdue = null, urgent = null } = {}) {
  const hello = firstName ? `${greeting}, ${firstName}.` : `${greeting}.`;
  const parts = [];
  if (awaitingReply) parts.push(plural(awaitingReply, "cliente aguardando resposta", "clientes aguardando resposta"));
  if (toReview) parts.push(plural(toReview, "simulação a conferir", "simulações a conferir"));
  if (overdue) parts.push(plural(overdue, "atividade atrasada", "atividades atrasadas"));
  if (!parts.length) return `${hello} Nada urgente agora: nenhum cliente esperando resposta, simulação a conferir ou atividade atrasada.`;
  let text = `${hello} Hoje você tem ${joinPt(parts)}.`;
  const name = String(urgent?.name || "").trim();
  if (awaitingReply && name) {
    const wait = formatWaitMinutes(urgent.waitingMinutes);
    text += ` Comece por ${name}${wait ? `, que espera resposta há ${wait}` : ""}.`;
  }
  return text;
}

export function firstNameOf(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

// Faixas do "Funil do mês" a partir de getPerformanceOverview().funnel (fonte canônica, MET-4/MET-12), sem a base
// "Prospecção". width = proporção da maior etapa (só para desenhar a barra).
export function funnelBars(funnel = []) {
  const stages = (funnel || []).filter((stage) => stage && stage.key !== "clients");
  const max = Math.max(1, ...stages.map((stage) => Number(stage.value) || 0));
  return stages.map((stage) => ({ key: stage.key, label: stage.label, value: Number(stage.value) || 0, width: Math.round(((Number(stage.value) || 0) / max) * 100) }));
}
