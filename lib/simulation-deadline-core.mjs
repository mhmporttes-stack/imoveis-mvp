// Prazo da simulação na roleta (regra do dono, 2026-10-08): cliente que chega com os dados da simulação preenchidos
// (renda informada no cadastro) tem de ter a simulação feita em até 5 min depois que o corretor o recebe. A abordagem é
// a simulação: mandar WhatsApp sem simular NÃO segura o cliente. Simulação feita = status saiu de "Aguardando simulação"
// (condição da própria regra) ou existe uma simulação gravada para o cliente. Puro e testado
// (tests/simulation-deadline.test.mjs).

export function hasSimulationData(client) {
  return Number(client?.primary_monthly_income) > 0;
}

// Pode voltar para a roleta? Cliente com dados: só a simulação feita o segura. Sem dados: a regra antiga — contato por
// WhatsApp ou resposta no Chat seguram o cliente.
export function canReturnToRoulette(client, { hasSimulation = false, humanAttended = false } = {}) {
  if (client?.distribution_type !== "round_robin") return false;
  if (hasSimulationData(client)) return !hasSimulation;
  return !client?.last_whatsapp_contact_at && !humanAttended;
}

// Status em que a simulação ainda NÃO foi feita. Cliente com dados da simulação continua no prazo nesses status: mudar
// para "Em atendimento" sem simular não segura o cliente (caso real 2026-10-09: recebido 23:42, "Em atendimento" 37 s
// depois, nenhuma simulação). Para ele a condição "status = Aguardando simulação" da regra vira "status ainda antes da
// simulação". Cliente sem dados mantém as condições da regra como estão.
export const PRE_SIMULATION_STATUSES = ["pending", "automated_service", "in_service"];

// Não retroativo: só clientes recebidos depois desta correção (os que já estavam "Em atendimento" antes não são tirados
// de ninguém de uma vez; a gestão usa "Devolver para a roleta" se quiser).
export const PRE_SIMULATION_RULE_SINCE = "2026-10-09T09:22:00Z";

// Cliente do ANÚNCIO de WhatsApp que entrou na roleta ao RESPONDER (regra do dono, 2026-10-09 — WA-18) continua em
// "Atendimento automático" (não preencheu): para ele, "Aguardando simulação" da regra vale também para "Atendimento
// automático" — sem resposta do corretor no Chat em 5 min, volta para a roleta. Não retroativo.
export const AD_REPLY_RULE_SINCE = "2026-10-09T10:30:00Z";

function isAdReplyRouletteClient(client) {
  if (client?.acquisition_context?.kind !== "whatsapp_ad" || client?.status !== "automated_service") return false;
  const receivedAt = Date.parse(client?.responsible_changed_at || client?.created_at || "");
  return receivedAt >= Date.parse(AD_REPLY_RULE_SINCE);
}

export function rouletteRuleConditions(conditions = [], client) {
  if (!hasSimulationData(client)) {
    if (!isAdReplyRouletteClient(client)) return conditions;
    const pendingCondition = (conditions || []).some((condition) => condition?.type === "status_equals" && condition.value === "pending");
    return pendingCondition ? (conditions || []).filter((condition) => condition?.type !== "status_equals") : conditions;
  }
  const receivedAt = Date.parse(client?.responsible_changed_at || client?.created_at || "");
  if (!(receivedAt >= Date.parse(PRE_SIMULATION_RULE_SINCE))) return conditions;
  const others = (conditions || []).filter((condition) => condition?.type !== "status_equals");
  const pendingCondition = (conditions || []).some((condition) => condition?.type === "status_equals" && condition.value === "pending");
  if (!pendingCondition) return conditions;
  return PRE_SIMULATION_STATUSES.includes(client?.status) ? others : [{ type: "status_equals", value: "pending" }];
}
