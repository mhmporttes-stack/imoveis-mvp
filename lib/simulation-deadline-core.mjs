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
