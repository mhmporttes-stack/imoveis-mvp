// Fixture da tela "Chat" (components/WhatsappChat.jsx, montado como em
// app/admin/chat/page.jsx). Dados 100% FICTÍCIOS — nomes, telefones (14) 90000-01xx,
// códigos e corretores inventados. Nenhum dado real, nenhuma URL externa.
//
// Formatos espelham o que as rotas devolvem hoje:
//  - conversa/mensagem: conversationRow/messageRow/getChatConversation (lib/whatsapp-chat.js)
//  - visão geral: getChatOverview; corretores: listChatBrokers/getChatBrokerCards
//  - guia: getGuideSession (lib/attendance-guides.js) + grafo de lib/attendance-guide-core.mjs
//  - campanhas: getBroadcastFinanceReport (item) / getBroadcastDetail (lib/whatsapp-broadcasts.js)
//
// O escopo por perfil (corretor/associado só veem conversas do Diego) é aplicado
// aqui lendo ?perfil= da URL da vitrine, imitando o filtro do servidor.
// Envios (texto/interno) e "marcar como lida" ficam em memória até recarregar a página.

import { ownSitePreview } from "@/lib/chat-link-preview-core.mjs";

const T0 = Date.now();
const MIN = 60 * 1000;
const ago = (minutes) => new Date(T0 - minutes * MIN).toISOString();
const WINDOW_MS = 24 * 60 * MIN;

// ---------------------------------------------------------------------------
// Equipe fictícia
// ---------------------------------------------------------------------------

const USERS = {
  admin: { id: "demo-user-admin", name: "Helena Prado", role: "admin" },
  gestor: { id: "demo-user-gestor", name: "Rafael Couto", role: "manager" },
  diego: { id: "demo-user-diego", name: "Diego Arantes", role: "broker" },
  camila: { id: "demo-user-camila", name: "Camila Rezende", role: "broker" },
  livia: { id: "demo-user-livia", name: "Lívia Nogueira", role: "associate" }
};
const USER_BY_ID = Object.fromEntries(Object.values(USERS).map((user) => [user.id, user]));

const CURRENT_USER_BY_PERFIL = {
  admin: USERS.admin,
  gestor: USERS.gestor,
  corretor: USERS.diego,
  associado: USERS.livia
};

function perfilAtual() {
  try {
    const value = new URLSearchParams(window.location.search).get("perfil");
    return CURRENT_USER_BY_PERFIL[value] ? value : "admin";
  } catch {
    return "admin";
  }
}

const canManagePerfil = (perfil) => perfil === "admin" || perfil === "gestor";

export function propsFor(perfil) {
  const user = CURRENT_USER_BY_PERFIL[perfil] || USERS.admin;
  return {
    canManage: canManagePerfil(perfil),
    canEditRules: perfil === "admin",
    currentUserId: user.id,
    initialClientId: ""
  };
}

// ---------------------------------------------------------------------------
// Clientes fictícios (formato de loadClientInfo)
// ---------------------------------------------------------------------------

const STATUS_META = {
  automated_service: { label: "Atendimento automático", stage: "" },
  pending: { label: "Aguardando simulação", stage: "" },
  completed: { label: "Simulação realizada", stage: "Simulação" },
  simulation_sent: { label: "Simulação enviada", stage: "Simulação" },
  in_service: { label: "Em atendimento", stage: "Atendimento" },
  awaiting_return: { label: "Tentando contato", stage: "" },
  documentation_pending: { label: "Aguardando documentação", stage: "Aguardando documentação" },
  approved: { label: "Cliente aprovado", stage: "Cliente aprovado" },
  meeting_pending: { label: "Aguardando reunião", stage: "Reunião" }
};

function client(id, name, code, phone, status, responsible, { simulationFilled = true, origin = "" } = {}) {
  return {
    id,
    name,
    code,
    phone,
    status,
    statusLabel: STATUS_META[status]?.label || status,
    simulationFilled,
    funnelStage: STATUS_META[status]?.stage || "",
    responsibleId: responsible?.id || null,
    responsibleName: responsible?.name || "",
    origin
  };
}

const PHONE = (n) => `55149000001${String(n).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Conversas (linhas "cruas", convertidas em conversationRow a cada chamada para
// o "há X min" andar sozinho)
// ---------------------------------------------------------------------------

const CONVERSATIONS = [
  {
    id: "demo-conv-01",
    phone: PHONE(1),
    name: "Juliana F.",
    status: "in_service",
    unread: 2,
    lastMin: 13,
    lastDir: "inbound",
    preview: "O comprovante pode ser conta de luz no nome da minha mãe?",
    lastInboundMin: 13,
    assigned: USERS.diego,
    account: "diego",
    client: client("demo-cli-01", "Juliana Ferreira Demo", "MM-90101", PHONE(1), "documentation_pending", USERS.diego, { origin: "Link do corretor" }),
    guideKind: "organic",
    formFilledMin: 24 * 60 + 50
  },
  {
    id: "demo-conv-02",
    phone: PHONE(2),
    name: "Marcos",
    status: "open",
    unread: 3,
    lastMin: 47,
    lastDir: "inbound",
    preview: "Alguém pode me responder? Queria saber da entrada",
    lastInboundMin: 47,
    assigned: null,
    account: "camila",
    client: client("demo-cli-02", "Marcos Vinícius Teste", "MM-90102", PHONE(2), "pending", USERS.camila, { simulationFilled: false, origin: "Site" }),
    guideKind: "organic"
  },
  {
    id: "demo-conv-03",
    phone: PHONE(3),
    name: "Patrícia",
    status: "open",
    unread: 1,
    lastMin: 4,
    lastDir: "inbound",
    preview: "Olá! Tenho interesse e queria mais informações.",
    lastInboundMin: 4,
    assigned: null,
    account: "official",
    origin: { kind: "meta_ad", referral: { source_type: "ad", headline: "Sua casa própria em Marília com subsídio", body: "Simule grátis pelo WhatsApp" } },
    client: client("demo-cli-03", "Patrícia Lopes Exemplo", "MM-90103", PHONE(3), "automated_service", USERS.diego, { simulationFilled: false, origin: "Anúncio WhatsApp (Meta)" }),
    guideKind: "lead"
  },
  {
    id: "demo-conv-04",
    phone: PHONE(4),
    name: "Paulo",
    status: "open",
    unread: 1,
    lastMin: 22,
    lastDir: "inbound",
    preview: "[Imagem]",
    lastInboundMin: 22,
    assigned: null,
    account: "official",
    client: null,
    guideKind: "organic"
  },
  {
    id: "demo-conv-05",
    phone: PHONE(5),
    name: "Rodrigo",
    status: "in_service",
    unread: 0,
    lastMin: 5 * 60,
    lastDir: "outbound",
    preview: "Rodrigo, conseguiu olhar a simulação que te mandei?",
    lastInboundMin: 7 * 60,
    assigned: USERS.camila,
    account: "camila",
    client: client("demo-cli-05", "Rodrigo Almeida Fictício", "MM-90105", PHONE(5), "simulation_sent", USERS.camila, { origin: "Indicação" }),
    guideKind: "organic"
  },
  {
    id: "demo-conv-06",
    phone: PHONE(6),
    name: "Fernanda",
    status: "finished",
    unread: 0,
    lastMin: 26 * 60,
    lastDir: "inbound",
    preview: "[Áudio]",
    lastInboundMin: 26 * 60,
    assigned: USERS.diego,
    account: "diego",
    client: client("demo-cli-06", "Fernanda Souza Demo", "MM-90106", PHONE(6), "approved", USERS.diego, { origin: "Instagram" }),
    guideKind: "organic"
  },
  {
    id: "demo-conv-07",
    phone: PHONE(7),
    name: "Gustavo",
    status: "in_service",
    unread: 0,
    lastMin: 40,
    lastDir: "outbound",
    preview: "[Documento]",
    lastInboundMin: 55,
    assigned: USERS.gestor,
    account: "official",
    client: client("demo-cli-07", "Gustavo Henrique Teste", "MM-90107", PHONE(7), "meeting_pending", USERS.gestor, { origin: "Site" }),
    guideKind: "organic"
  },
  {
    id: "demo-conv-08",
    phone: PHONE(8),
    name: "Sandra",
    status: "in_service",
    unread: 0,
    lastMin: 30 * 60,
    lastDir: "outbound",
    preview: "Oi Sandra! Ainda tem interesse em sair do aluguel este ano?",
    lastInboundMin: 2 * 24 * 60 + 90,
    assigned: USERS.diego,
    account: "diego",
    client: client("demo-cli-08", "Sandra Ribeiro Exemplo", "MM-90108", PHONE(8), "awaiting_return", USERS.diego, { origin: "Prospecção" }),
    guideKind: "prospecting"
  },
  {
    id: "demo-conv-09",
    phone: PHONE(9),
    name: "Carlos",
    status: "in_service",
    unread: 1,
    lastMin: 3,
    lastDir: "inbound",
    preview: "Pode ser amanhã depois das 18h?",
    lastInboundMin: 3,
    assigned: USERS.admin,
    account: "official",
    client: client("demo-cli-09", "Carlos Eduardo Fictício", "MM-90109", PHONE(9), "in_service", USERS.admin, { origin: "Site" }),
    guideKind: "organic"
  },
  {
    id: "demo-conv-10",
    phone: PHONE(10),
    name: "Aline",
    status: "in_service",
    unread: 0,
    lastMin: 22 * 60,
    lastDir: "outbound",
    preview: "Aline, separei duas opções no Jardim Demo. Posso te mandar?",
    lastInboundMin: 22 * 60 + 35,
    assigned: USERS.camila,
    account: "camila",
    client: client("demo-cli-10", "Aline Martins Demo", "MM-90110", PHONE(10), "completed", USERS.camila, { origin: "Campanha de disparo" }),
    guideKind: "organic"
  }
];

// Estado em memória (só desta aba da vitrine).
const readIds = new Set();
const extraMessages = {}; // conversationId -> mensagens enviadas pela vitrine

function accountInfo(key) {
  if (!key) return null;
  if (key === "official") return { channel: "whatsapp_cloud_api", userId: null, name: "WhatsApp Oficial", photoUrl: "" };
  const user = USERS[key];
  return { channel: "whatsapp_individual", userId: user.id, name: user.name, photoUrl: "" };
}

function waitingInfo(status, lastAt, lastDir) {
  if (status === "finished" || !lastAt) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(lastAt).getTime()) / MIN));
  if (lastDir === "inbound") return { kind: "awaiting_us", minutes, level: minutes >= 30 ? "late" : minutes >= 10 ? "warn" : "ok" };
  if (lastDir === "outbound" && minutes >= 180) return { kind: "contact_silent", minutes, level: "warn" };
  return null;
}

function windowInfo(lastInboundAt) {
  const lastMs = lastInboundAt ? new Date(lastInboundAt).getTime() : 0;
  const expiresMs = lastMs + WINDOW_MS;
  return { open: Boolean(lastMs) && expiresMs > Date.now(), expiresAt: lastMs ? new Date(expiresMs).toISOString() : null };
}

function conversationView(spec) {
  const extras = extraMessages[spec.id] || [];
  const lastExtra = [...extras].reverse().find((message) => !message.internal);
  const lastMessageAt = lastExtra ? lastExtra.at : ago(spec.lastMin);
  const lastDir = lastExtra ? "outbound" : spec.lastDir;
  const preview = lastExtra ? lastExtra.body.replace(/\s+/g, " ").slice(0, 140) : spec.preview;
  const lastInboundAt = ago(spec.lastInboundMin);
  const brokerUser = spec.assigned || (spec.client?.responsibleId ? USER_BY_ID[spec.client.responsibleId] : null);
  return {
    id: spec.id,
    phone: spec.phone,
    name: spec.name,
    photoUrl: "",
    status: spec.status,
    unreadCount: readIds.has(spec.id) ? 0 : spec.unread,
    lastMessageAt,
    lastMessagePreview: preview,
    lastMessageDirection: lastDir,
    lastInboundAt,
    window: windowInfo(lastInboundAt),
    origin: spec.origin || {},
    client: spec.client,
    broker: brokerUser ? { id: brokerUser.id, name: brokerUser.name, assigned: Boolean(spec.assigned) } : null,
    assignedUserId: spec.assigned?.id || null,
    account: accountInfo(spec.account),
    waiting: waitingInfo(spec.status, lastMessageAt, lastDir)
  };
}

// Corretor e associado só veem conversas atribuídas ao Diego ou de clientes dele
// (associado Lívia é vinculado ao Diego). Admin/gestor veem tudo.
function visibleConversations() {
  const perfil = perfilAtual();
  const rows = CONVERSATIONS.map(conversationView);
  if (canManagePerfil(perfil)) return rows;
  const brokerId = USERS.diego.id;
  return rows.filter((row) => row.assignedUserId === brokerId || row.client?.responsibleId === brokerId);
}

function byRecent(a, b) {
  return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
}

function listConversations({ url }) {
  const params = url.searchParams;
  const filter = params.get("filter") || "all";
  const term = (params.get("q") || "").trim().toLowerCase();
  const brokerId = params.get("brokerId") || "";
  let rows = visibleConversations().sort(byRecent);
  if (brokerId) rows = rows.filter((row) => row.assignedUserId === brokerId || row.client?.responsibleId === brokerId);
  if (filter === "unread") rows = rows.filter((row) => row.unreadCount > 0);
  else if (filter === "awaiting") rows = rows.filter((row) => row.lastMessageDirection === "outbound" && row.status !== "finished");
  else if (filter === "waiting_us") rows = rows.filter((row) => row.lastMessageDirection === "inbound" && row.status !== "finished");
  else if (filter === "silent") rows = rows.filter((row) => row.waiting?.kind === "contact_silent");
  else if (filter !== "all") rows = rows.filter((row) => row.status === filter);
  if (term) {
    const digits = term.replace(/\D/g, "");
    rows = rows.filter((row) => `${row.name} ${row.client?.name || ""}`.toLowerCase().includes(term) || (digits && row.phone.includes(digits)));
  }
  return { conversations: rows };
}

function summary() {
  const rows = visibleConversations();
  const unread = rows.filter((row) => row.unreadCount > 0);
  const waiting = rows.filter((row) => row.waiting?.kind === "awaiting_us");
  return {
    unreadConversations: unread.length,
    unreadMessages: unread.reduce((sum, row) => sum + row.unreadCount, 0),
    awaitingReply: waiting.filter((row) => row.waiting.level !== "ok").length,
    awaitingLate: waiting.filter((row) => row.waiting.level === "late").length,
    topic: null // sem canal em tempo real na vitrine
  };
}

function overview({ url }) {
  const params = url.searchParams;
  const broker = params.get("broker") || "";
  const situation = params.get("situation") || "";
  const term = (params.get("q") || "").trim().toLowerCase();
  let rows = visibleConversations();
  if (term) rows = rows.filter((row) => `${row.client?.name || ""} ${row.name} ${row.broker?.name || ""}`.toLowerCase().includes(term) || row.phone.includes(term.replace(/\D/g, "") || "#"));
  if (broker === "none") rows = rows.filter((row) => !row.broker);
  else if (broker) rows = rows.filter((row) => row.broker?.id === broker);
  const counts = {
    total: rows.length,
    awaitingLate: rows.filter((row) => row.waiting?.kind === "awaiting_us" && row.waiting.level === "late").length,
    awaitingWarn: rows.filter((row) => row.waiting?.kind === "awaiting_us" && row.waiting.level === "warn").length,
    silent: rows.filter((row) => row.waiting?.kind === "contact_silent").length,
    noBroker: rows.filter((row) => !row.broker && row.status !== "finished").length,
    inService: rows.filter((row) => row.status === "in_service").length
  };
  if (situation === "awaiting_us") rows = rows.filter((row) => row.waiting?.kind === "awaiting_us" && row.waiting.level !== "ok");
  else if (situation === "contact_silent") rows = rows.filter((row) => row.waiting?.kind === "contact_silent");
  else if (situation === "no_broker") rows = rows.filter((row) => !row.broker && row.status !== "finished");
  else if (situation === "in_service") rows = rows.filter((row) => row.status === "in_service");
  else if (situation === "finished") rows = rows.filter((row) => row.status === "finished");
  const severity = (row) => (row.waiting?.kind === "awaiting_us" && row.waiting.level === "late" ? 0 : row.waiting?.kind === "awaiting_us" && row.waiting.level === "warn" ? 1 : row.waiting?.kind === "contact_silent" ? 2 : 3);
  rows.sort((a, b) => severity(a) - severity(b) || byRecent(a, b));
  return { rows, counts };
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

// Áudio de demonstração: WAV de 3 s gerado aqui (sem arquivo nem URL externa).
let cachedAudio = "";
function demoAudioDataUri() {
  if (cachedAudio) return cachedAudio;
  const rate = 8000;
  const samples = rate * 3;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, 36 + samples, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  text(36, "data"); view.setUint32(40, samples, true);
  // Tom suave (440 Hz, volume baixo) com fade — só para o player ter o que tocar.
  for (let i = 0; i < samples; i += 1) {
    const envelope = Math.min(1, i / 800, (samples - i) / 800);
    bytes[44 + i] = 128 + Math.round(10 * envelope * Math.sin((2 * Math.PI * 440 * i) / rate));
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  cachedAudio = `data:audio/wav;base64,${btoa(binary)}`;
  return cachedAudio;
}

// Prévia de link do próprio site como o servidor monta (ownSitePreview), com a imagem servida localmente.
function sitePreview(url) {
  const preview = ownSitePreview(url);
  return preview ? { ...preview, image: preview.image.replace("https://www.matheusmachadoimoveis.com.br", "") } : null;
}

function msg(id, minutesAgo, direction, body, extra = {}) {
  const at = ago(minutesAgo);
  const outbound = direction === "outbound";
  const internal = direction === "internal";
  const senderType = extra.senderType || (internal || outbound ? "user" : "customer");
  const status = extra.status || (outbound ? "read" : internal ? "sent" : "received");
  return {
    id,
    direction,
    internal,
    senderType,
    sentByName: senderType === "user" ? extra.sentByName || "" : "",
    type: extra.type || "text",
    body,
    status,
    errorCode: extra.errorCode || "",
    errorMessage: extra.errorMessage || "",
    templateName: "",
    media: extra.media || null,
    shortcut: extra.shortcut || "",
    buttons: extra.buttons || [],
    linkLabel: extra.linkLabel || "",
    linkUrl: extra.linkUrl || "",
    linkPreview: extra.linkUrl ? sitePreview(extra.linkUrl) : null,
    linkPreviewUrl: extra.linkPreviewUrl || "",
    automationKind: senderType === "automation" ? extra.automationKind || "" : "",
    at,
    sentAt: outbound ? at : null,
    deliveredAt: outbound && ["delivered", "read"].includes(status) ? at : null,
    readAt: outbound && status === "read" ? at : null,
    metaMessageId: internal ? "" : `wamid.DEMO${id.replace(/\W/g, "")}`,
    reactions: extra.reactions || [],
    replyToMessageId: extra.replyTo ? `wamid.DEMO${extra.replyTo.replace(/\W/g, "")}` : "",
    // Ações por mensagem (lib/whatsapp-message-actions.mjs, calculadas no servidor):
    // todas as conversas da vitrine simulam o WhatsApp individual.
    refId: internal ? "" : `wamid.DEMO${id.replace(/\W/g, "")}`,
    channel: "whatsapp_individual",
    editedAt: extra.editedAt || null,
    revoked: Boolean(extra.revoked),
    revokedBy: extra.revoked || "",
    originalBody: extra.originalBody || "",
    canReply: !internal && status !== "failed" && !extra.revoked,
    canReact: !internal && status !== "failed" && !extra.revoked,
    canEdit: outbound && senderType === "user" && status !== "failed" && !extra.revoked && (extra.type || "text") === "text" && minutesAgo <= 15,
    canDelete: outbound && senderType === "user" && status !== "failed" && !extra.revoked && minutesAgo <= 48 * 60
  };
}

function juliannaMessages(perfil) {
  const diego = USERS.diego.name;
  const admin = perfil === "admin";
  return [
    msg("m01-01", 26 * 60 + 40, "inbound", "Oi, boa tarde! Vi a divulgação das casas de 2 quartos na zona sul de Marília. Ainda tem unidade?"),
    msg("m01-02", 26 * 60 + 39, "outbound", "Olá! 😊 Recebemos sua mensagem. Em instantes um corretor da nossa equipe vai te atender.", { senderType: "automation", automationKind: "flow" }),
    msg("m01-03", 26 * 60 + 20, "outbound", "Oi Juliana, tudo bem? Aqui é o Diego, corretor da equipe. Tem sim! São casas de 2 dormitórios dentro do Minha Casa Minha Vida. Posso fazer uma simulação pra você?", { sentByName: diego }),
    msg("m01-04", 26 * 60 + 5, "inbound", "Pode sim! Eu trabalho registrada, ganho uns R$ 2.800, e meu marido faz uns bicos de pedreiro."),
    msg("m01-05", 26 * 60, "outbound", "Preenche esse formulário rapidinho que eu já calculo o subsídio e a parcela pra vocês 👇", { sentByName: diego, shortcut: "Link de simulação", linkLabel: "Fazer minha simulação", linkUrl: "https://www.matheusmachadoimoveis.com.br/s/diego" }),
    msg("m01-06", 24 * 60 + 50, "inbound", "Pronto, preenchi!"),
    msg("m01-07", 24 * 60 + 30, "outbound", "Perfeito! Pela simulação, a estimativa é de subsídio na faixa de R$ 40 mil e parcela perto de R$ 690 — o valor final depende da análise da Caixa. Quer seguir com a documentação?", { sentByName: diego, buttons: ["Quero seguir", "Tenho dúvidas"] }),
    msg("m01-08", 24 * 60 + 25, "internal", "Renda do cônjuge é informal — pedir extrato bancário dos últimos 3 meses junto com os holerites dela.", { sentByName: diego }),
    msg("m01-09", 3 * 60, "inbound", "Bom dia Diego! Quero seguir sim. Quais documentos eu preciso mandar?"),
    msg("m01-10", 2 * 60 + 55, "outbound", "Bom dia! Vou precisar de:\n• RG e CPF de vocês dois\n• Certidão de casamento\n• Comprovante de residência atualizado\n• 3 últimos holerites\n• Carteira de trabalho digital (PDF)\nPode mandar por aqui mesmo, foto bem nítida.", { sentByName: diego }),
    msg("m01-11", 2 * 60, "inbound", "RG frente", { type: "image", media: { url: "/assets/hero-marilia.png", mime: "image/png", name: "rg-frente-demo.png", size: 184320, state: "stored", inbound: true }, reactions: [{ sender: "team", emoji: "👍" }] }),
    msg("m01-12", 60 + 55, "inbound", "", { type: "audio", media: { url: demoAudioDataUri(), mime: "audio/wav", name: "", size: 24044, state: "stored", inbound: false } }),
    msg("m01-13", 60 + 30, "outbound", "Recebi! A foto ficou ótima. Só falta o comprovante de residência e os holerites.", { sentByName: diego, status: "delivered", replyTo: "m01-11" }),
    msg("m01-14", 60 + 28, "outbound", "Consegue me mandar ainda hoje?", { sentByName: diego, status: "failed", errorCode: admin ? "131047" : "", errorMessage: admin ? "Sessão do WhatsApp individual desconectada no momento do envio (demonstração)." : "" }),
    msg("m01-15", 14, "inbound", "Mando sim, só chegar em casa"),
    msg("m01-15b", 13.8, "inbound", "", { revoked: "customer" }),
    msg("m01-16", 13, "inbound", "O comprovante pode ser conta de luz no nome da minha mãe? Moro com ela"),
    msg("m01-17", 6, "outbound", "Pode sim! Conta de luz no nome da sua mãe serve, junto com uma declaração de que você mora com ela.", { sentByName: diego, status: "delivered", replyTo: "m01-16", editedAt: ago(5), originalBody: admin ? "Pode sim! Conta de luz serve." : "" }),
    msg("m01-18", 5, "outbound", "", { sentByName: diego, status: "delivered", type: "video", media: { url: "/vitrine-demo-gif.mp4", mime: "video/mp4", name: "gif.mp4", gif: true } }),
    msg("m01-19", 4, "outbound", "", { sentByName: diego, status: "sent", revoked: "team", originalBody: admin ? "Mensagem enviada por engano" : "" })
  ];
}

const SHORT_THREADS = {
  "demo-conv-02": () => [
    msg("m02-01", 70, "inbound", "Oi, quero saber como funciona o financiamento pela Caixa"),
    msg("m02-02", 69, "outbound", "Olá! 😊 Recebemos sua mensagem. Em instantes um corretor da nossa equipe vai te atender.", { senderType: "automation", automationKind: "flow" }),
    msg("m02-02b", 68, "outbound", "Para eu fazer a sua simulação, preencha o formulário abaixo. Leva menos de 2 minutos 👇", { senderType: "automation", automationKind: "flow", linkLabel: "Preencher formulário", linkUrl: "https://www.matheusmachadoimoveis.com.br/c/demo01" }),
    msg("m02-03", 55, "inbound", "Precisa ter entrada?"),
    msg("m02-04", 47, "inbound", "Alguém pode me responder? Queria saber da entrada")
  ],
  "demo-conv-03": () => [
    msg("m03-01", 5, "inbound", "Olá! Tenho interesse e queria mais informações.", { buttons: [] }),
    msg("m03-02", 5, "outbound", "Oi! Que bom ter você aqui 🏡 Me conta: você já tem o seu primeiro imóvel?", { senderType: "automation", automationKind: "flow", buttons: ["Ainda não", "Já tenho"] }),
    msg("m03-03", 4, "inbound", "Ainda não", { type: "button" })
  ],
  "demo-conv-04": () => [
    msg("m04-01", 23, "inbound", "Boa tarde"),
    msg("m04-02", 22, "inbound", "Boa tarde, vocês trabalham com casa usada também?")
  ],
  "demo-conv-05": () => [
    msg("m05-00", 7 * 60 + 20, "outbound", "", { sentByName: USERS.camila.name, type: "document", media: { url: "/vitrine-demo-simulacao.pdf", mime: "application/pdf", name: "Simulacao-Rodrigo-Demo.pdf", size: 173056, state: "stored", inbound: false } }),
    msg("m05-00b", 7 * 60 + 19, "outbound", "Segue a simulação. Se preferir, dá pra ver também em https://www.exemplo.com.br/simulacao-demo", { sentByName: USERS.camila.name, linkPreviewUrl: "https://www.exemplo.com.br/simulacao-demo" }),
    msg("m05-01", 7 * 60, "inbound", "Oi Camila, recebi o PDF, vou mostrar pra minha esposa"),
    msg("m05-02", 6 * 60 + 50, "outbound", "Ótimo! Qualquer dúvida sobre os valores eu explico por aqui ou numa ligação rápida.", { sentByName: USERS.camila.name }),
    msg("m05-03", 5 * 60, "outbound", "Rodrigo, conseguiu olhar a simulação que te mandei?", { sentByName: USERS.camila.name, status: "delivered" })
  ],
  "demo-conv-06": () => [
    msg("m06-01", 27 * 60, "outbound", "Fernanda, saiu a aprovação na Caixa! 🎉 Vou te ligar pra combinar a assinatura.", { sentByName: USERS.diego.name }),
    msg("m06-02", 26 * 60, "inbound", "Muito obrigada, Diego! Até a assinatura 🙏")
  ],
  "demo-conv-07": () => [
    msg("m07-01", 60, "outbound", "Gustavo, podemos marcar a visita ao decorado?", { sentByName: USERS.gestor.name }),
    msg("m07-02", 55, "inbound", "Pode ser quinta de manhã?"),
    msg("m07-03", 40, "outbound", "Combinado, quinta às 10h no plantão do residencial.", { sentByName: USERS.gestor.name })
  ],
  "demo-conv-08": () => [
    msg("m08-01", 2 * 24 * 60 + 90, "inbound", "Agora não consigo falar, depois te chamo"),
    msg("m08-02", 30 * 60, "outbound", "Oi Sandra! Ainda tem interesse em sair do aluguel este ano?", { sentByName: USERS.diego.name, status: "delivered" })
  ],
  "demo-conv-09": () => [
    msg("m09-01", 30, "outbound", "Carlos, consigo te mostrar a planta e os valores numa chamada de 15 minutos. Qual o melhor horário?", { sentByName: USERS.admin.name }),
    msg("m09-02", 3, "inbound", "Pode ser amanhã depois das 18h?")
  ],
  "demo-conv-10": () => [
    msg("m10-01", 22 * 60 + 35, "inbound", "Oi! Recebi a mensagem da campanha. Quero ver opções perto do centro"),
    msg("m10-02", 22 * 60, "outbound", "Aline, separei duas opções no Jardim Demo. Posso te mandar?", { sentByName: USERS.camila.name })
  ]
};

function conversationDetail({ url }) {
  const id = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop());
  const spec = CONVERSATIONS.find((item) => item.id === id);
  if (!spec || !visibleConversations().some((row) => row.id === id)) return { __status: 404 };
  // Paginação "?before=": a vitrine não tem mensagens mais antigas.
  if (url.searchParams.get("before")) return { conversation: null, messages: [], hasMore: false };
  const perfil = perfilAtual();
  // Mensagem interna: só quem pode gerenciar a conversa (admin/gestor ou o dono da conversa).
  const canInternal = canManagePerfil(perfil) || (perfil === "corretor" && (spec.assigned?.id === USERS.diego.id || spec.client?.responsibleId === USERS.diego.id));
  const base = id === "demo-conv-01" ? juliannaMessages(perfil) : (SHORT_THREADS[id] || (() => []))();
  const messages = [...base, ...(extraMessages[id] || [])].filter((message) => canInternal || !message.internal);
  return {
    conversation: { ...conversationView(spec), canInternal },
    messages,
    hasMore: false
  };
}

function pushMessage(id, message) {
  if (!extraMessages[id]) extraMessages[id] = [];
  extraMessages[id].push(message);
  return message;
}

async function readBody(init) {
  try {
    return JSON.parse(init?.body || "{}");
  } catch {
    return {};
  }
}

function conversationIdFrom(url) {
  return url.pathname.split("/")[5] || "";
}

function newMessage(direction, text) {
  const user = CURRENT_USER_BY_PERFIL[perfilAtual()];
  const id = `demo-sent-${Date.now()}`;
  const at = new Date().toISOString();
  return {
    ...msg(id, 0, direction, text, { sentByName: user.name, status: direction === "internal" ? "sent" : "sent" }),
    at,
    sentAt: direction === "outbound" ? at : null
  };
}

// ---------------------------------------------------------------------------
// Guia de Atendimento (grafo no formato de lib/attendance-guide-core.mjs)
// ---------------------------------------------------------------------------

function guideGraph(prefix, opening) {
  return {
    nodes: [
      { id: "start", type: "start", x: 40, y: 140, data: {} },
      {
        id: `${prefix}-abertura`, type: "card", x: 300, y: 140,
        data: {
          title: "Abertura: entender o momento do cliente",
          phase: "abertura",
          guidance: "Apresente-se pelo nome e descubra se é o primeiro imóvel. Não fale de valores antes de entender a renda.",
          argument: "",
          message: opening,
          entry: false,
          options: [
            { id: "o1", label: "Primeiro imóvel, quer simular" },
            { id: "o2", label: "Acha que não tem renda suficiente" },
            { id: "o3", label: "Só pesquisando por enquanto" }
          ]
        }
      },
      {
        id: `${prefix}-simular`, type: "card", x: 600, y: 40,
        data: {
          title: "Enviar o link de simulação",
          phase: "solucionar",
          guidance: "Se o cliente já preencheu o formulário, use a simulação dele — não mande o link de novo.",
          argument: "A simulação mostra o subsídio e a parcela estimada em poucos minutos.",
          message: "Perfeito, [Nome]! Preenche esse formulário rapidinho que eu já calculo o subsídio e a parcela pra você: [Link]",
          entry: false,
          options: [
            { id: "o1", label: "Preencheu" },
            { id: "o2", label: "Não respondeu" }
          ]
        }
      },
      {
        id: `${prefix}-renda`, type: "card", x: 600, y: 160,
        data: {
          title: "Objeção: “não tenho renda suficiente”",
          phase: "objecao",
          guidance: "Investigue a renda familiar total (cônjuge, renda informal). Nunca prometa aprovação.",
          argument: "No programa a renda da família toda conta, inclusive renda informal comprovada por extrato.",
          message: "[Nome], muita gente acha isso e se surpreende! Aqui conta a renda da família toda. Me conta: quem mora com você também trabalha?",
          entry: false,
          options: [{ id: "o1", label: "Tem renda complementar" }]
        }
      },
      {
        id: `${prefix}-retorno`, type: "followup", x: 900, y: 140,
        data: {
          title: "Definir próximo passo e data de retorno",
          guidance: "Todo atendimento pendente termina com um próximo passo combinado e uma data para voltar a falar com o cliente.",
          message: "Combinado, [Nome]! Te chamo no dia que combinamos para seguirmos.",
          defaultDays: 1,
          activityType: "follow_up"
        }
      },
      { id: `${prefix}-fim`, type: "end", x: 1200, y: 140, data: { title: "Atendimento encerrado", guidance: "", outcome: "Cliente encaminhado para documentação" } }
    ],
    edges: [
      { id: "e1", from: "start", port: "next", to: `${prefix}-abertura` },
      { id: "e2", from: `${prefix}-abertura`, port: "o1", to: `${prefix}-simular` },
      { id: "e3", from: `${prefix}-abertura`, port: "o2", to: `${prefix}-renda` },
      { id: "e4", from: `${prefix}-abertura`, port: "o3", to: `${prefix}-retorno` },
      { id: "e5", from: `${prefix}-simular`, port: "o1", to: `${prefix}-fim` },
      { id: "e6", from: `${prefix}-simular`, port: "o2", to: `${prefix}-retorno` },
      { id: "e7", from: `${prefix}-renda`, port: "o1", to: `${prefix}-simular` }
    ]
  };
}

const GUIDES = [
  { id: "demo-guide-lead", name: "Lead de anúncio (patrocinado)", kind: "lead", graph: guideGraph("lead", "Oi [Nome]! Aqui é [o_a] [Corretor], [cargo_corretor]. Vi que você chamou pelo nosso anúncio 😊 Você está buscando o seu primeiro imóvel?") },
  { id: "demo-guide-organic", name: "Atendimento orgânico", kind: "organic", graph: guideGraph("org", "Oi [Nome], tudo bem? Aqui é [o_a] [Corretor], [cargo_corretor]. Como posso te ajudar a conquistar a casa própria?") },
  { id: "demo-guide-prosp", name: "Prospecção / reativação", kind: "prospecting", graph: guideGraph("prosp", "Oi [Nome]! Aqui é [o_a] [Corretor]. Faz um tempo que conversamos — ainda tem o plano de sair do aluguel?") }
];
const KIND_LABEL = { prospecting: "Prospecção", lead: "Lead", organic: "Orgânico" };

function guideSession({ url }) {
  const conversationId = url.searchParams.get("conversationId") || "";
  const spec = CONVERSATIONS.find((item) => item.id === conversationId);
  if (!spec) return { __status: 404 };
  const user = CURRENT_USER_BY_PERFIL[perfilAtual()];
  const female = /a$/i.test(user.name.split(" ")[0]);
  const kind = spec.guideKind || "organic";
  const autoGuide = GUIDES.find((guide) => guide.kind === kind) || GUIDES[1];
  const requested = url.searchParams.get("guideId");
  const chosen = GUIDES.find((guide) => guide.id === requested) || autoGuide;
  const firstCard = chosen.graph.nodes.find((node) => node.type === "card");
  // Conversa da Juliana: "continuando de onde parou" (já passou pela abertura).
  const resumed = conversationId === "demo-conv-01" && chosen.id === autoGuide.id;
  const simulate = chosen.graph.nodes.find((node) => node.id.endsWith("-simular"));
  const state = resumed
    ? { guideId: chosen.id, nodeId: simulate.id, stack: [], path: [{ guideId: chosen.id, nodeId: firstCard.id, stack: [], label: "Primeiro imóvel, quer simular" }] }
    : { guideId: chosen.id, nodeId: firstCard.id, stack: [], path: [] };
  return {
    kind,
    kindLabel: KIND_LABEL[kind],
    autoGuideId: autoGuide.id,
    guides: GUIDES.map((guide) => ({ id: guide.id, name: guide.name, kind: guide.kind })),
    guide: { id: chosen.id, name: chosen.name, kind: chosen.kind, version: 3 },
    graphs: { [chosen.id]: chosen.graph },
    state,
    resumed,
    client: { id: spec.client?.id || null, name: spec.client?.name || spec.name || "" },
    broker: {
      name: user.name,
      simulationLink: `exemplo.invalid/simular?ref=${user.id.replace("demo-user-", "")}`,
      vars: { o_a: female ? "a" : "o", cargo_corretor: female ? "corretora" : "corretor" }
    },
    formFilledAt: spec.formFilledMin ? ago(spec.formFilledMin) : null,
    autoKinds: ["prospecting", "lead", "organic"]
  };
}

// ---------------------------------------------------------------------------
// Corretores, atalhos e campanhas
// ---------------------------------------------------------------------------

function brokersList() {
  return {
    brokers: [
      { id: USERS.camila.id, name: USERS.camila.name, role: "broker", online: true },
      { id: USERS.diego.id, name: USERS.diego.name, role: "broker", online: true },
      { id: USERS.admin.id, name: USERS.admin.name, role: "admin", online: false },
      { id: USERS.livia.id, name: USERS.livia.name, role: "associate", online: false },
      { id: USERS.gestor.id, name: USERS.gestor.name, role: "manager", online: true }
    ]
  };
}

function brokerCards() {
  const rows = CONVERSATIONS.map(conversationView);
  const cardFor = (user, status) => {
    const mine = rows.filter((row) => row.assignedUserId === user.id || row.client?.responsibleId === user.id);
    return {
      id: user.id,
      name: user.name,
      photoUrl: "",
      lastActivityAt: ago(5),
      status,
      counts: {
        unread: mine.filter((row) => row.unreadCount > 0).length,
        awaiting: mine.filter((row) => row.lastMessageDirection === "inbound" && row.status !== "finished").length,
        active: mine.filter((row) => row.status === "in_service").length
      }
    };
  };
  return {
    brokers: [
      cardFor(USERS.diego, "connected"),
      cardFor(USERS.camila, "reconnecting"),
      cardFor(USERS.gestor, "connected"),
      cardFor(USERS.livia, "disconnected"),
      cardFor(USERS.admin, "qr_required")
    ]
  };
}

const SHORTCUTS = [
  { id: "demo-sc-1", kind: "simulation_link", label: "Link de simulação", body: "Preenche esse formulário rapidinho que eu já calculo o subsídio e a parcela pra você 👇", mediaUrl: "", mediaName: "", mediaMime: "", sortOrder: 1, active: true },
  { id: "demo-sc-2", kind: "text", label: "Lista de documentos", body: "Documentos para a análise de crédito:\n• RG e CPF\n• Comprovante de residência\n• 3 últimos holerites\n• Carteira de trabalho digital", mediaUrl: "", mediaName: "", mediaMime: "", sortOrder: 2, active: true },
  { id: "demo-sc-3", kind: "image", label: "Tabela de subsídio (imagem)", body: "Veja como funciona o subsídio do programa:", mediaUrl: "/assets/simulation-subsidy-icon.png", mediaName: "subsidio-demo.png", mediaMime: "image/png", sortOrder: 3, active: true },
  { id: "demo-sc-4", kind: "text", label: "Boas-vindas", body: "Oi! Tudo bem? Sou da equipe de atendimento e vou te ajudar a conquistar a casa própria 🏡", mediaUrl: "", mediaName: "", mediaMime: "", sortOrder: 4, active: true }
];

const CAMPAIGNS = [
  {
    id: "demo-bc-1", campaignName: "Reativação — setembro (demo)", templateName: "reativacao_casa_propria_demo", category: "marketing", categoryLabel: "Marketing", isMarketing: true,
    status: "completed", createdAt: ago(3 * 24 * 60), startedAt: ago(3 * 24 * 60 - 5), selected: 120, sent: 118, delivered: 112, read: 87, failed: 2,
    billable: 112, unitRate: 0.35, totalCost: 39.2, costPerSent: 0.3322, replied: 14, linkViews: 22, registrations: 5,
    deliveredRate: 0.949, readRate: 0.777, replyRate: 0.119, costPerReply: 2.8, costPerRegistration: 7.84
  },
  {
    id: "demo-bc-2", campaignName: "Lembrete de documentação (demo)", templateName: "lembrete_documentos_demo", category: "utility", categoryLabel: "Utilidade", isMarketing: false,
    status: "completed", createdAt: ago(26 * 60), startedAt: ago(26 * 60 - 2), selected: 18, sent: 18, delivered: 18, read: 15, failed: 0,
    billable: 18, unitRate: 0.04, totalCost: 0.72, costPerSent: 0.04, replied: 6, linkViews: 0, registrations: 0,
    deliveredRate: 1, readRate: 0.833, replyRate: 0.333, costPerReply: 0.12, costPerRegistration: null
  }
];

function broadcastDetail({ url }) {
  const id = url.pathname.split("/").pop();
  const campaign = CAMPAIGNS.find((item) => item.id === id) || CAMPAIGNS[0];
  const recipients = [
    { n: 10, name: "Aline Martins Demo", status: "read", replied: true, conversationId: "demo-conv-10" },
    { n: 5, name: "Rodrigo Almeida Fictício", status: "read", replied: true, conversationId: "demo-conv-05" },
    { n: 11, name: "Teresa Campos Exemplo", status: "delivered", replied: false },
    { n: 12, name: "Vagner Lima Teste", status: "read", replied: false },
    { n: 13, name: "Bianca Rocha Demo", status: "failed", replied: false, errorMessage: "Número sem WhatsApp" },
    { n: 14, name: "Otávio Mendes Fictício", status: "sent", replied: false }
  ];
  return {
    broadcast: {
      id: campaign.id,
      campaignName: campaign.campaignName,
      templateName: campaign.templateName,
      templateCategory: campaign.category,
      status: campaign.status,
      createdAt: campaign.createdAt,
      startedAt: campaign.startedAt,
      campaignLink: "",
      messages: recipients.map((item, index) => ({
        id: `${campaign.id}-msg-${index + 1}`,
        name: item.name,
        phone: PHONE(item.n),
        status: item.status,
        errorMessage: item.errorMessage || "",
        queuedAt: campaign.startedAt,
        sentAt: item.status === "failed" ? null : campaign.startedAt,
        deliveredAt: ["delivered", "read"].includes(item.status) ? campaign.startedAt : null,
        readAt: item.status === "read" ? campaign.startedAt : null,
        failedAt: item.status === "failed" ? campaign.startedAt : null,
        replied: item.replied,
        repliedAt: item.replied ? ago(22 * 60 + 35) : null,
        conversationId: item.conversationId || null
      }))
    }
  };
}

// ---------------------------------------------------------------------------
// Rotas (a primeira que casar vence — mais específicas primeiro)
// ---------------------------------------------------------------------------

const CONV = "^\\/api\\/admin\\/whatsapp-chat\\/conversations\\/[^/?]+";

// O mock-fetch não aceita status dinâmico; {__status} vira um erro legível.
function withNotFound(handler) {
  return async (ctx) => {
    const body = await handler(ctx);
    if (body?.__status === 404) return { error: "Conversa não encontrada." };
    return body;
  };
}

export const routes = [
  // Resumo (sobrepõe o de comum.js, para bater com a lista desta tela)
  { match: /^\/api\/admin\/whatsapp-chat\/summary/, response: summary },

  // Lista, detalhe e ações da conversa
  { match: /^\/api\/admin\/whatsapp-chat\/conversations(\?|$)/, response: listConversations },
  { method: "POST", match: new RegExp(`${CONV}\\/read`), response: ({ url }) => {
    const id = conversationIdFrom(url);
    const perfil = perfilAtual();
    const spec = CONVERSATIONS.find((item) => item.id === id);
    // Admin/gestor supervisionando conversa que não é deles não marca como lida (markChatConversationRead).
    if (canManagePerfil(perfil) && spec?.assigned?.id !== CURRENT_USER_BY_PERFIL[perfil].id) return { ok: true, marked: false };
    readIds.add(id);
    return { ok: true, marked: true };
  } },
  { method: "POST", match: new RegExp(`${CONV}\\/messages`), response: async ({ url, init }) => {
    const body = await readBody(init);
    return { message: pushMessage(conversationIdFrom(url), newMessage("outbound", String(body.text || ""))) };
  } },
  { method: "POST", match: new RegExp(`${CONV}\\/internal`), response: async ({ url, init }) => {
    const body = await readBody(init);
    return { message: pushMessage(conversationIdFrom(url), newMessage("internal", String(body.text || ""))) };
  } },
  { method: "POST", match: new RegExp(`${CONV}\\/media\\/upload-target`), response: { path: "sent/direct/demo/arquivo.mp4", signedUrl: "/api/dev-upload-demo" } },
  { method: "POST", match: new RegExp(`${CONV}\\/media`), response: { message: { id: "demo-media-sent", status: "sent" } } },
  { method: "PATCH", match: new RegExp(`${CONV}\\/messages\\/[^/?]+`), response: { message: { id: "demo-edit", status: "sent" } } },
  { method: "DELETE", match: new RegExp(`${CONV}\\/messages\\/[^/?]+`), response: { message: { id: "demo-delete", revoked: true } } },
  { method: "POST", match: new RegExp(`${CONV}\\/shortcut`), response: async ({ url, init }) => {
    const body = await readBody(init);
    const shortcut = SHORTCUTS.find((item) => item.id === body.shortcutId);
    const message = newMessage("outbound", shortcut?.body || "");
    message.shortcut = shortcut?.label || "";
    if (shortcut?.kind === "simulation_link") message.linkLabel = "Fazer minha simulação";
    return { message: pushMessage(conversationIdFrom(url), message) };
  } },
  { method: "POST", match: new RegExp(`${CONV}\\/template`), response: { message: { id: "demo-template-sent", status: "sent" } } },
  { method: "POST", match: new RegExp(`${CONV}\\/reactions`), response: { reaction: { emoji: "👍", status: "sent" } } },
  { method: "POST", match: new RegExp(`${CONV}\\/assign`), response: { ok: true, transferred: false } },
  { method: "POST", match: new RegExp(`${CONV}\\/add-client`), response: { ok: true, clientId: "demo-cli-novo" }, status: 201 },
  { method: "PATCH", match: new RegExp(`${CONV}(\\?|$)`), response: { ok: true } },
  { method: "DELETE", match: new RegExp(`${CONV}(\\?|$)`), response: { ok: true } },
  { match: new RegExp(`${CONV}(\\?|$)`), response: withNotFound(conversationDetail) },
  { method: "POST", match: /^\/api\/admin\/whatsapp-chat\/open-client/, response: { conversationId: "demo-conv-01" } },
  // Prévia de link externo: a vitrine não acessa a internet — sem prévia (o balão mostra só o link azul).
  { match: /^\/api\/admin\/whatsapp-chat\/link-preview/, response: { preview: null } },

  // Subvisões
  { match: /^\/api\/admin\/whatsapp-chat\/overview/, response: overview },
  { match: /^\/api\/admin\/whatsapp-chat\/brokers/, response: brokersList },
  { match: /^\/api\/admin\/whatsapp-chat\/broker-cards/, response: brokerCards },
  { match: /^\/api\/admin\/whatsapp-chat\/shortcuts/, response: { shortcuts: SHORTCUTS } },
  { method: "POST", match: /^\/api\/admin\/whatsapp-chat\/shortcuts/, response: { shortcut: SHORTCUTS[3] } },
  { method: "DELETE", match: /^\/api\/admin\/whatsapp-chat\/shortcuts\//, response: { ok: true } },
  { match: /^\/api\/admin\/whatsapp-chat\/templates/, response: { templates: [] } },
  { match: /^\/api\/admin\/whatsapp-broadcasts\/finance/, response: { items: CAMPAIGNS, canEditPricing: true } },
  { match: /^\/api\/admin\/whatsapp-broadcasts\/[^/?]+/, response: broadcastDetail },

  // Guia de Atendimento
  { match: /^\/api\/admin\/attendance-guides\/session/, response: withNotFound(guideSession) },
  { method: "PUT", match: /^\/api\/admin\/attendance-guides\/session/, response: { ok: true } },
  { method: "DELETE", match: /^\/api\/admin\/attendance-guides\/session/, response: { ok: true } },
  { method: "POST", match: /^\/api\/calendar-activities/, response: { activity: { id: "demo-activity-1" } } },

  // Documentação a partir do Chat (sem relatórios prévios: o botão "Relatórios" fica oculto)
  { match: /^\/api\/admin\/client-documents\/batches\/[^/?]+/, response: { batch: { id: "demo-batch-1", status: "analyzed" } } },
  { match: /^\/api\/admin\/client-documents\/batches/, response: { batches: [] } },
  { method: "POST", match: /^\/api\/admin\/client-documents\/from-chat/, response: { batch: { id: "demo-batch-1", status: "analyzed" } } },

  // Painel de contato: muda status do cliente
  { method: "PATCH", match: /^\/api\/simulation-registrations\/[^/?]+/, response: { ok: true } }
];
