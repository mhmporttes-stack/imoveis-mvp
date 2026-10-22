// Fixture da tela "Chat Marketplace" (components/marketplace/MarketplaceChat.jsx, montado como em
// app/admin/chat/marketplace/page.jsx). Dados 100% FICTÍCIOS — nomes, anúncios e corretores inventados; sem fotos nem
// URLs externas. Formato espelha /api/admin/marketplace-chat/** (lib/marketplace-chat.js). Envios ficam em memória.

const T0 = Date.now();
const MIN = 60 * 1000;
const ago = (minutes) => new Date(T0 - minutes * MIN).toISOString();

const TEAM = [
  { id: "demo-user-diego", name: "Diego Arantes" },
  { id: "demo-user-camila", name: "Camila Rezende" }
];

const NOMES = ["Juliana Torres", "Marcos Vieira", "Patrícia Lemos", "Renato Faria", "Simone Castro", "André Nogueira", "Beatriz Ramos", "Cláudio Mendes", "Daniela Prates", "Eduardo Lins", "Fernanda Gil", "Gustavo Reis"];
const ANUNCIOS = ["Casa 2 quartos — Jardim Fictício", "Apartamento 2 dorm. — Residencial Exemplo", "Casa com quintal — Vila Demonstração"];

const conversations = NOMES.map((name, index) => {
  const assigned = index % 4 === 3 ? null : TEAM[index % 2];
  return {
    id: `demo-mkt-${index + 1}`,
    contactName: name,
    contactPhotoUrl: "",
    listingTitle: ANUNCIOS[index % ANUNCIOS.length],
    listingUrl: "",
    lastMessagePreview: index % 2 ? "Ainda está disponível?" : "Qual o valor da entrada?",
    lastMessageAt: ago(5 + index * 37),
    assignedName: assigned?.name || "",
    assignedUserId: assigned?.id || "",
    waiting: !assigned,
    unreadCount: index < 3 ? index + 1 : 0
  };
});

const messages = new Map();
function threadFor(id) {
  const conversation = conversations.find((item) => item.id === id) || conversations[0];
  if (!messages.has(conversation.id)) {
    messages.set(conversation.id, [
      { id: `${id}-1`, direction: "inbound", body: "Olá, ainda está disponível?", at: ago(60) },
      { id: `${id}-2`, direction: "outbound", senderName: conversation.assignedName || "Equipe", body: "Oi! Está sim. Posso te ajudar com a simulação do financiamento?", at: ago(55), statusLabel: "Enviada" },
      { id: `${id}-3`, internal: true, senderName: "Helena Prado", body: "Cliente pediu retorno depois das 18h.", at: ago(50) },
      { id: `${id}-4`, direction: "inbound", body: conversation.lastMessagePreview, at: ago(5) }
    ]);
  }
  return { conversation: { ...conversation, clientId: null, canInternal: true }, messages: messages.get(conversation.id) };
}

export function propsFor(perfil) {
  const manage = perfil === "admin" || perfil === "gestor";
  return { canEditSettings: perfil === "admin", canAssign: manage, canManageShortcuts: manage, viewerName: "Diego Arantes", team: manage ? TEAM : [], viewerKey: `vitrine-mkt:${perfil}` };
}

const idFrom = (url) => url.pathname.split("/")[5];

export const routes = [
  {
    method: "GET",
    match: /^\/api\/admin\/marketplace-chat\/conversations\?/,
    response: () => ({ ready: true, conversations, filters: ["unassigned"], extension: { lastSyncAt: ago(3) } })
  },
  {
    method: "GET",
    match: /^\/api\/admin\/marketplace-chat\/conversations\/[^/?]+$/,
    response: ({ url }) => threadFor(idFrom(url))
  },
  {
    method: "POST",
    match: /^\/api\/admin\/marketplace-chat\/conversations\/[^/]+\/(messages|internal)$/,
    response: ({ url, init }) => {
      const id = idFrom(url);
      const body = JSON.parse(init.body || "{}");
      const internal = url.pathname.endsWith("/internal");
      threadFor(id);
      messages.get(id).push(internal
        ? { id: `${id}-n${Date.now()}`, internal: true, senderName: "Helena Prado", body: body.text, at: new Date().toISOString() }
        : { id: `${id}-n${Date.now()}`, direction: "outbound", senderName: "Helena Prado", body: body.text, at: new Date().toISOString(), statusLabel: "Na fila" });
      return { ok: true };
    }
  },
  { method: "GET", match: /^\/api\/admin\/whatsapp-chat\/shortcuts/, response: { shortcuts: [] } }
];
