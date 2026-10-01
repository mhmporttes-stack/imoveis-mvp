// Mensagens internas de supervisão — dados 100% fictícios, estado em
// memória (some ao recarregar). Gestor = "vitrine-gestor".
const ME = "vitrine-gestor";
const minutes = (value) => new Date(Date.now() - value * 60000).toISOString();

const PEOPLE = {
  "vitrine-gestor": { id: "vitrine-gestor", name: "Matheus Machado", photoUrl: "" },
  "vitrine-corretor-ana": { id: "vitrine-corretor-ana", name: "Ana Paula Ribeiro", photoUrl: "" },
  "vitrine-corretor-bruno": { id: "vitrine-corretor-bruno", name: "Bruno Henrique Lopes", photoUrl: "" }
};

let seq = 0;
function message(senderId, recipientId, body, extra = {}) {
  seq += 1;
  return {
    id: `vitrine-sup-${seq}`,
    senderId, recipientId, body,
    kind: "message", requiresAck: false, ackStatus: "none", inReplyTo: "",
    state: "seen", deliveredAt: minutes(1), seenAt: minutes(1), respondedAt: null,
    createdAt: minutes(5),
    ...extra
  };
}

const store = [
  message(ME, "vitrine-corretor-ana", "Ana, prioriza hoje os retornos da 2ª tentativa antes das 11h, por favor.", { requiresAck: true, ackStatus: "acknowledged", state: "acknowledged", createdAt: minutes(95) }),
  message("vitrine-corretor-ana", ME, "OK", { kind: "ack", createdAt: minutes(93) }),
  message(ME, "vitrine-corretor-ana", "Conseguiu falar com o casal do Jardim Itaipu?", { requiresAck: true, ackStatus: "replied", state: "replied", createdAt: minutes(30) }),
  message("vitrine-corretor-ana", ME, "Consegui sim! Eles vêm amanhã às 10h para a simulação com a documentação completa.", { kind: "reply", seenAt: null, createdAt: minutes(4) }),
  message(ME, "vitrine-corretor-bruno", "Bruno, lembra de atualizar o status dos atendimentos de ontem.", { requiresAck: true, ackStatus: "pending", state: "delivered", seenAt: null, createdAt: minutes(12) })
];

const pendingForBroker = [
  { id: "vitrine-pend-1", body: "Bom dia! Hoje a meta da equipe está em 62%. Foca nos retornos pendentes antes do almoço e me avisa se precisar de ajuda com alguma simulação.", createdAt: minutes(0.3), sender: PEOPLE[ME] },
  { id: "vitrine-pend-2", body: "Cliente Rogério ligou procurando você — retorna pra ele ainda hoje.", createdAt: minutes(0.2), sender: PEOPLE[ME] },
  { id: "vitrine-pend-3", body: "Reunião rápida às 17h no escritório.", createdAt: minutes(0.1), sender: PEOPLE[ME] }
].map((item) => ({ ...item, kind: "message", requiresAck: true, ackStatus: "pending", state: "delivered", mine: false, senderId: ME }));

const view = (item) => ({ ...item, mine: item.senderId === ME });
const parse = (init) => { try { return JSON.parse(init?.body || "{}"); } catch { return {}; } };

export const routes = [
  {
    match: /^\/api\/admin\/supervision-messages\/unread/,
    response: () => {
      const counts = {};
      for (const item of store) if (item.recipientId === ME && !item.seenAt) counts[item.senderId] = (counts[item.senderId] || 0) + 1;
      return { counts, topic: "" };
    }
  },
  {
    method: "POST",
    match: /^\/api\/admin\/supervision-messages\/read/,
    response: ({ init }) => {
      const { userId } = parse(init);
      for (const item of store) if (item.senderId === userId && item.recipientId === ME) item.seenAt = new Date().toISOString();
      return { ok: true };
    }
  },
  {
    match: /^\/api\/admin\/supervision-messages\/pending/,
    response: () => ({ topic: "", messages: pendingForBroker.slice() })
  },
  { method: "POST", match: /^\/api\/admin\/supervision-messages\/[^/]+\/seen/, response: { ok: true } },
  {
    method: "POST",
    match: /^\/api\/admin\/supervision-messages\/[^/]+\/respond/,
    delay: 450,
    response: ({ url }) => {
      const id = url.pathname.split("/")[4];
      const index = pendingForBroker.findIndex((item) => item.id === id);
      if (index >= 0) pendingForBroker.splice(index, 1);
      return { ok: true };
    }
  },
  {
    match: /^\/api\/admin\/supervision-messages\?/,
    response: ({ url }) => {
      const userId = url.searchParams.get("userId");
      const messages = store.filter((item) => [item.senderId, item.recipientId].includes(userId)).map(view);
      return { partner: PEOPLE[userId] || { id: userId, name: "Corretor", photoUrl: "" }, messages, hasMore: false };
    }
  },
  {
    method: "POST",
    match: /^\/api\/admin\/supervision-messages(\?|$)/,
    delay: 350,
    response: ({ init }) => {
      const { recipientId, body } = parse(init);
      const created = message(ME, recipientId, String(body || "").trim(), { requiresAck: true, ackStatus: "pending", state: "sent", seenAt: null, deliveredAt: null, createdAt: new Date().toISOString() });
      store.push(created);
      return { message: view(created) };
    }
  }
];
