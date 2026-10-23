// Tela Início (INI-1) — dados 100% fictícios no formato de lib/painel-inicio.js (getPainelInicio / getPainelInicioMes).
const base = {
  chatAvailable: true,
  assistant: {
    text: "Bom dia, Matheus. Hoje você tem 4 clientes aguardando resposta, 2 simulações a conferir e 1 atividade atrasada. Comece por Débora Lima, que espera resposta há 38 min.",
    urgent: { name: "Débora Lima", clientId: "demo-cliente-1" }
  },
  kpis: {
    leadsToday: { total: 14, ad: 9, marketplace: 3, other: 2 },
    response: { medianSeconds: 250, count: 37 },
    toReview: 2,
    docs: { total: 17, stale: 5, staleDays: 7 }
  },
  pending: { chat: 6, agenda: 1, newAttendances: 3, awaitingSimulation: 4, prospectingReplies: 2 }
};

const corretor = {
  ...base,
  assistant: {
    text: "Boa tarde, Bruna. Hoje você tem 2 clientes aguardando resposta e 1 simulação a conferir. Comece por Thiago Souza, que espera resposta há 12 min.",
    urgent: { name: "Thiago Souza", clientId: "demo-cliente-2" }
  },
  kpis: { leadsToday: { total: 3, ad: 2, marketplace: 1, other: 0 }, response: { medianSeconds: 160, count: 9 }, toReview: 1, docs: { total: 4, stale: 1, staleDays: 7 } },
  pending: { chat: 2, agenda: 0, newAttendances: 1, awaitingSimulation: 1, prospectingReplies: 0 }
};

const semNada = {
  ...base,
  assistant: { text: "Boa noite, Carol. Nada urgente agora: nenhum cliente esperando resposta, simulação a conferir ou atividade atrasada.", urgent: null },
  kpis: { leadsToday: { total: 0, ad: 0, marketplace: 0, other: 0 }, response: { medianSeconds: null, count: 0 }, toReview: 0, docs: { total: 0, stale: 0, staleDays: 7 } },
  pending: { chat: 0, agenda: 0, newAttendances: 0, awaitingSimulation: 0, prospectingReplies: 0 }
};

const month = {
  rangeLabel: "Este mês",
  approved: 11,
  sales: 7,
  bars: [
    ["service", "Atendimento", 312], ["simulation", "Simulação", 188], ["documentation", "Aguardando documentação", 96],
    ["approval", "Aguardando aprovação", 54], ["approved", "Cliente aprovado", 31], ["meeting", "Reunião", 14], ["sale", "Venda", 7]
  ].map(([key, label, value]) => ({ key, label, value, width: Math.round((value / 312) * 100) }))
};

// variante: "vazio" (dia sem pendências) ou "carregando" (mês ainda chegando).
export function dataFor(perfil, variante = "") {
  if (variante === "vazio") return { data: semNada, month: { ...month, approved: 0, sales: 0, bars: month.bars.map((bar) => ({ ...bar, value: 0, width: 0 })) } };
  if (perfil === "corretor" || perfil === "associado") return { data: corretor, month: { ...month, approved: 2, sales: 1 } };
  return { data: base, month };
}
