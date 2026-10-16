// Rotas usadas por componentes compartilhados (menu, badges, status).
// Dados 100% fictícios.
export const routes = [
  { match: /^\/api\/admin\/crm-badge-counts/, response: { newAttendances: 2, awaitingSimulation: 1, agenda: 2 } },
  { match: /^\/api\/admin\/whatsapp-chat\/summary/, response: { unreadConversations: 4, unreadMessages: 9 } },
  { match: /^\/api\/admin\/whatsapp-individual\/status/, response: { status: "connected", connected: true } },
  { match: /^\/api\/google-contacts\/status/, response: { connected: true } },
  { match: /^\/api\/daily-goal\/top-ranking/, response: {} },
  // Sino (NotificationHistoryButton) e caixinha "Clientes que esfriaram" (CooledClientsInbox) — dados fictícios.
  { match: /^\/api\/admin\/alerts\/history/, response: { items: [], pending: 3 } },
  {
    match: /^\/api\/admin\/cooled-clients\/inbox/,
    response: {
      items: [
        { id: "cc-demo-1", clientName: "Cliente Fictício A", stageLabel: "Em atendimento", clientPhone: "", brokerName: "Corretor Demo", firstReason: "Cliente pediu para retornar na semana que vem.", actions: ["transfer", "status", "return"] },
        { id: "cc-demo-2", clientName: "Cliente Fictício B", stageLabel: "Simulação enviada", clientPhone: "", brokerName: "Corretor Demo", firstReason: "Aguardando o cliente separar os documentos.", actions: ["transfer", "status"] }
      ],
      statusOptions: []
    }
  }
];
