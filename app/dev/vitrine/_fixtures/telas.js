// Telas do painel repaginadas no visual novo (frente C, 2026-10-22) — dados 100% fictícios, só para a vitrine (`next dev`).
// Cada bloco tem o mínimo para a tela desenhar o estado normal; o resto das chamadas cai no corpo vazio do mock-fetch.
const now = new Date();
const day = (offset, hour = 10) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, 0, 0);
  return d.toISOString();
};

export const users = [
  { id: "u1", name: "Ana Paula Ribeiro", role: "broker", status: "active", email: "ana@exemplo.test", phone: "14900000001", photoUrl: "", managerId: "u9", leadDistributionEnabled: true, createdAt: day(-200) },
  { id: "u2", name: "Bruno Henrique Lopes", role: "broker", status: "active", email: "bruno@exemplo.test", phone: "14900000002", photoUrl: "", managerId: "u9", leadDistributionEnabled: true, createdAt: day(-150) },
  { id: "u3", name: "Carla Mendes", role: "associate", status: "active", email: "carla@exemplo.test", phone: "14900000003", photoUrl: "", linkedBrokerId: "u1", createdAt: day(-90) },
  { id: "u9", name: "Gestora Demo", role: "manager", status: "active", email: "gestora@exemplo.test", phone: "14900000009", photoUrl: "", createdAt: day(-300) },
  { id: "u4", name: "Diego Fernandes", role: "broker", status: "inactive", email: "diego@exemplo.test", phone: "14900000004", photoUrl: "", managerId: "u9", createdAt: day(-60) }
];

const activities = [
  // Caso do print do dono (2026-10-23): follow-up atrasado com descrição longa e WhatsApp — detalhe abre com ?variante=Fernando.
  { id: "a0", clientId: "c0", clientCode: "CL-0000", clientName: "Fernando Demo Oliveira", phone: "(14) 99000-0123", scheduledActivityAt: day(0, 7), scheduledActivityType: "follow_up", activityType: "follow_up", scheduledActivityNote: "Cliente pediu retorno depois do almoço. Conferir se já separou os holerites dos últimos três meses e o extrato do FGTS. Falar sobre a simulação do Jardim Exemplo: entrada parcelada e valor da parcela que ficou dentro do que ele esperava. Se não atender, mandar mensagem no WhatsApp e tentar de novo no fim da tarde. Lembrar de perguntar se a esposa também vai compor renda.", note: "", activityStatus: "pending", status: "pending", responsibleUserId: "u1", responsibleName: "Ana Paula Ribeiro", priority: "important", source: "manual" },
  { id: "a1", clientId: "c1", clientName: "Fernanda Demo Ribeiro", scheduledActivityAt: day(0, 10), scheduledActivityType: "ligacao", activityType: "ligacao", scheduledActivityNote: "Retornar sobre a simulação", note: "Retornar sobre a simulação", activityStatus: "pending", status: "pending", responsibleUserId: "u1", responsibleName: "Ana Paula", priority: "high", source: "manual" },
  { id: "a2", clientId: "c2", clientName: "Joana Exemplo Souza", scheduledActivityAt: day(1, 14), scheduledActivityType: "visita", activityType: "visita", scheduledActivityNote: "Visita ao decorado", note: "Visita ao decorado", activityStatus: "pending", status: "pending", responsibleUserId: "u1", responsibleName: "Ana Paula", priority: "normal", source: "manual" },
  { id: "a3", clientId: "c3", clientName: "Marcos Teste", scheduledActivityAt: day(-1, 9), scheduledActivityType: "documentos", activityType: "documentos", scheduledActivityNote: "Cobrar holerites", note: "Cobrar holerites", activityStatus: "pending", status: "pending", responsibleUserId: "u2", responsibleName: "Bruno", priority: "normal", source: "manual" },
  { id: "a4", clientId: "c4", clientName: "Camila Teste Rodrigues", scheduledActivityAt: day(3, 16), scheduledActivityType: "reuniao", activityType: "reuniao", scheduledActivityNote: "Assinatura", note: "Assinatura", activityStatus: "pending", status: "pending", responsibleUserId: "u2", responsibleName: "Bruno", priority: "normal", source: "manual" }
];

const campaigns = [
  { id: "k1", name: "Anúncio Jardim Sul — outubro", kind: "campaign", destinationType: "roulette", brokerId: "", brokerName: "", link: "https://www.matheusmachadoimoveis.com.br/simulacao?c=demo1", status: "active", viewCount: 812, submissionCount: 64, clientCount: 58, createdAt: day(-20) },
  { id: "k2", name: "Panfleto feira do bairro", kind: "campaign", destinationType: "broker", brokerId: "u1", brokerName: "Ana Paula Ribeiro", link: "https://www.matheusmachadoimoveis.com.br/simulacao?c=demo2", status: "active", viewCount: 120, submissionCount: 9, clientCount: 9, createdAt: day(-8) },
  { id: "k3", name: "Indicação de clientes", kind: "campaign", destinationType: "roulette", brokerId: "", brokerName: "", link: "https://www.matheusmachadoimoveis.com.br/simulacao?c=demo3", status: "paused", viewCount: 40, submissionCount: 3, clientCount: 3, createdAt: day(-40) }
];

const aiEntries = Array.from({ length: 8 }, (_, index) => ({
  id: `ia${index}`,
  createdAt: day(-index, 11),
  brokerName: index % 2 ? "Ana Paula Ribeiro" : "Bruno Henrique Lopes",
  clientName: ["Fernanda Demo", "Joana Exemplo", "Marcos Teste", "Camila Teste"][index % 4],
  inputTokens: 12000 + index * 900,
  outputTokens: 1800 + index * 120,
  cacheReadTokens: 4000,
  cacheCreationTokens: 0,
  costUsd: 0.06 + index * 0.01,
  success: index !== 5,
  errorMessage: index === 5 ? "Arquivo ilegível (exemplo)" : ""
}));

const rules = [
  { id: "r1", name: "REDISTRIBUIÇÃO DE LEADS", enabled: true, triggerType: "client_form_submitted", delayValue: 10, delayUnit: "minutes", conditions: [], actions: [{ type: "return_to_round_robin" }], runCount: 214, lastRunAt: day(0, 9) },
  { id: "r2", name: "Lembrete de documentação", enabled: true, triggerType: "status_changed", delayValue: 2, delayUnit: "days", conditions: [], actions: [{ type: "notify_broker" }], runCount: 37, lastRunAt: day(-1, 15) },
  { id: "r3", name: "Cliente sem atividade futura", enabled: false, triggerType: "no_future_activity", delayValue: 3, delayUnit: "days", conditions: [], actions: [{ type: "notify_broker" }], runCount: 0, lastRunAt: null }
];

const notifications = [
  { id: "n1", title: "Novo cliente para você", description: "Fernanda Demo Ribeiro chegou pela roleta.", clientName: "Fernanda Demo Ribeiro", recipientName: "Ana Paula Ribeiro", scheduledAt: day(0, 9), readAt: null },
  { id: "n2", title: "Atividade atrasada", description: "Ligar para Marcos Teste (ontem, 09:00).", clientName: "Marcos Teste", recipientName: "Bruno Henrique Lopes", scheduledAt: day(-1, 9), readAt: day(-1, 12) }
];

export const props = {
  usuarios: { initialUsers: users, counts: { total: 5, active: 4, inactive: 1, broker: 3, manager: 1, associate: 1 }, canManageAllRoles: true, currentUserId: "u9" },
  campanhas: { initialCampaigns: campaigns, initialSummary: { views: 972, submissions: 76, simulation: 41, sale: 3, conversion: 0.078 }, brokers: users.filter((user) => user.role === "broker") },
  gastosIa: { initialEntries: aiEntries, usdBrlRate: 5.3 },
  metaGestao: { initialSettings: { quota: 10, wallet: { walletLimit: 30, blockOnLimit: true }, messages: {} } },
  automacoes: { initialRules: rules, users, whatsappTemplates: [] },
  notificacoes: { initialNotifications: notifications },
  prospeccao: {
    initialCompanyContacts: [
      { id: "p1", name: "Rafael Demo", phone: "14900000101", status: "available" },
      { id: "p2", name: "Luana Exemplo", phone: "14900000102", status: "available" },
      { id: "p3", name: "Tiago Fictício", phone: "14900000103", status: "claimed", assignedUserId: "u1" }
    ],
    isAdmin: true,
    isOwner: true,
    canPrintLists: true,
    users
  }
};

export const extras = {
  alterarConta: { users },
  regrasIa: { initialRules: [
    { id: "d1", title: "Holerite recente", category: "renda", instruction: "Aceitar holerites dos últimos 3 meses; pedir o mais recente se faltar.", active: true },
    { id: "d2", title: "Comprovante de residência", category: "residencia", instruction: "Conta de consumo em nome do titular ou do cônjuge, até 60 dias.", active: true },
    { id: "d3", title: "Certidão de casamento", category: "estado_civil", instruction: "Exigir apenas quando o estado civil for casado.", active: false }
  ] },
  guias: { initialGuides: [
    { id: "g1", name: "Primeiro contato (roleta)", description: "Roteiro para o cliente que acabou de chegar.", kind: "attendance", enabled: true, nodeCount: 12, publishedVersion: 3, hasUnpublishedChanges: false },
    { id: "g2", name: "Cliente sem resposta", description: "Retomada depois de 3 dias.", kind: "attendance", enabled: false, nodeCount: 6, publishedVersion: 1, hasUnpublishedChanges: true }
  ] },
  imoveis: { properties: [
    { id: "i1", code: "4358", name: "Casa 2 dormitórios — Jardim Sul", location: "Marília/SP", price: "R$ 235.000", isPublished: true, isDevelopment: false },
    { id: "i2", code: "4360", name: "Apartamento 2 dormitórios — Centro", location: "Marília/SP", price: "R$ 199.000", isPublished: false, isDevelopment: false },
    { id: "i3", code: "0012", name: "Residencial Demo", location: "Marília/SP", price: "R$ 210.000", isPublished: true, isDevelopment: true }
  ] }
};

export const routes = [
  { match: /^\/api\/calendar-activities/, response: () => ({ activities, clients: [], users, canViewTeam: true }) },
  { match: /^\/api\/campaigns/, response: () => ({ campaigns, summary: props.campanhas.initialSummary }) },
  { match: /^\/api\/prospecting/, response: () => [] }
];
