// Rotas usadas por componentes compartilhados (menu, badges, status).
// Dados 100% fictícios.
export const routes = [
  { match: /^\/api\/admin\/crm-badge-counts/, response: { newAttendances: 2, awaitingSimulation: 1, agenda: 2 } },
  { match: /^\/api\/admin\/whatsapp-chat\/summary/, response: { unreadConversations: 4, unreadMessages: 9 } },
  { match: /^\/api\/admin\/whatsapp-individual\/status/, response: { status: "connected", connected: true } },
  { match: /^\/api\/google-contacts\/status/, response: { connected: true } },
  { match: /^\/api\/daily-goal\/top-ranking/, response: {} }
];
