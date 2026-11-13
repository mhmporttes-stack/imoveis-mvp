// Ajuda e chamados do painel (REGRA OFICIAL — dono, 2026-11-13). Regras puras (sem banco, sem "server-only"), testadas em
// tests/support-tickets.test.mjs. O botão "?" (components/support/SupportHelp.jsx) manda o chamado; o servidor
// (lib/support-tickets.js) junta o contexto; SÓ O DONO vê a fila e responde; o autor vê só os próprios chamados.
// Sem IA e sem serviço externo nesta fase: o print pode mostrar dados de clientes e fica em bucket privado.

export const TICKET_STATUS = Object.freeze({ OPEN: "open", ANSWERED: "answered", CLOSED: "closed" });
export const TICKET_STATUSES = Object.freeze(Object.values(TICKET_STATUS));
export const TICKET_STATUS_LABELS = Object.freeze({ open: "Aberto", answered: "Respondido", closed: "Encerrado" });

export const TICKET_KINDS = Object.freeze(["bug", "not_bug", "improvement"]);
export const TICKET_KIND_LABELS = Object.freeze({ bug: "Erro", not_bug: "Não é erro", improvement: "Melhoria" });

export const TICKET_DESCRIPTION_MIN = 5;
export const TICKET_DESCRIPTION_MAX = 2000;
export const TICKET_REPLY_MAX = 4000;

// Anexos: 1 a 3 imagens. Cada uma já chega reduzida do navegador (padrão do Chat: 1600 px, JPEG); o teto total fica
// abaixo do limite de corpo de requisição da Vercel (4,5 MB).
export const TICKET_MAX_IMAGES = 3;
export const TICKET_IMAGE_MAX_BYTES = 1_300_000;
export const TICKET_IMAGES_TOTAL_MAX_BYTES = 3_800_000;
export const TICKET_IMAGE_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

// Anti-spam por usuário na criação: no máximo 5 em 10 minutos e 20 por dia.
export const TICKET_RATE_LIMIT = Object.freeze({ perWindow: 5, windowMs: 10 * 60 * 1000, perDay: 20 });

export const SUPPORT_ERROR_BUFFER_SIZE = 5;
export const SUPPORT_SIGNED_URL_SECONDS = 120;
export const SUPPORT_TIME_ZONE = "America/Sao_Paulo";

// Instrução final fixa do "Copiar texto" (fala literal do dono, 2026-11-13).
export const SUPPORT_COPY_INSTRUCTION =
  "Investigue no CRM/banco se necessário e responda ao corretor em linguagem simples, curta e pronta para colar, dizendo se é erro, se não é erro (e a regra) ou se precisa de decisão do dono.";

const ROLE_LABELS = Object.freeze({ admin: "Administrador geral", manager: "Gestor", broker: "Corretor", associate: "Associado" });
export const supportRoleLabel = (role) => ROLE_LABELS[role] || "Corretor";

// ---------- Visibilidade (só o dono vê a fila) ----------

// Fila e resposta: SÓ o dono, conta REAL fora de "Alterar conta". Gestor e demais perfis NUNCA veem a fila de ninguém.
export function canSeeSupportQueue({ accountSwitchMode = false, isOwner = false } = {}) {
  return Boolean(isOwner) && !accountSwitchMode;
}

// Um chamado específico: o dono (pela fila) ou o próprio autor. Qualquer outro caso: não vê (a API responde 404).
export function canReadSupportTicket({ viewerId = "", queueViewer = false, ticket = null } = {}) {
  if (!ticket) return false;
  if (queueViewer) return true;
  return Boolean(viewerId) && ticket.created_by === viewerId;
}

// ---------- Texto e privacidade ----------

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const CPF = /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g;
const PHONE = /(\+?\d[\d\s().-]{7,}\d)/g;
const LONG_DIGITS = /\d{6,}/g;
const TOKEN = /\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\b/gi;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Mensagem de erro de JS pode carregar dado pessoal (nome na URL, telefone, token): tira o que parece pessoal e corta.
export function scrubSensitive(text, max = 160) {
  const clean = String(text ?? "")
    .replace(UUID, "[id]")
    .replace(EMAIL, "[e-mail]")
    .replace(CPF, "[número]")
    .replace(PHONE, "[número]")
    .replace(LONG_DIGITS, "[número]")
    .replace(TOKEN, "[código]")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// Só o caminho da tela (sem consulta/âncora, que podem trazer dado de cliente); ids viram ":id".
export function normalizePathname(value) {
  let path = String(value ?? "").trim();
  path = path.split(/[?#]/)[0];
  if (!path.startsWith("/")) path = path ? `/${path}` : "/";
  path = path.replace(UUID, ":id").replace(/\/\d{4,}(?=\/|$)/g, "/:id");
  return path.slice(0, 160);
}

export function validateTicketDescription(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length < TICKET_DESCRIPTION_MIN) return { ok: false, value: text, error: "Conte o que está acontecendo (pelo menos algumas palavras)." };
  if (text.length > TICKET_DESCRIPTION_MAX) return { ok: false, value: text, error: `Texto muito longo (máximo ${TICKET_DESCRIPTION_MAX} caracteres).` };
  return { ok: true, value: text, error: "" };
}

export function validateTicketReply(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: false, value: text, error: "Escreva a resposta." };
  if (text.length > TICKET_REPLY_MAX) return { ok: false, value: text, error: `Resposta muito longa (máximo ${TICKET_REPLY_MAX} caracteres).` };
  return { ok: true, value: text, error: "" };
}

export const isTicketKind = (value) => TICKET_KINDS.includes(value);
export const isTicketStatus = (value) => TICKET_STATUSES.includes(value);

// ---------- Contexto ----------

// "iPhone · Safari" — o navegador completo não precisa ir para a fila.
export function summarizeDevice(userAgent = "") {
  const ua = String(userAgent || "");
  const system = /iPhone|iPad|iPod/i.test(ua) ? (/iPad/i.test(ua) ? "iPad" : "iPhone") : /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Aparelho desconhecido";
  const browser = /Edg\//i.test(ua) ? "Edge" : /OPR\/|Opera/i.test(ua) ? "Opera" : /CriOS|Chrome\//i.test(ua) ? "Chrome" : /FxiOS|Firefox\//i.test(ua) ? "Firefox" : /Safari\//i.test(ua) ? "Safari" : "navegador desconhecido";
  return `${system} · ${browser}`;
}

// Últimos erros de JS vindos do navegador (não confiável): no máximo 5, texto limpo de dado pessoal.
export function sanitizeErrorList(list, { max = SUPPORT_ERROR_BUFFER_SIZE } = {}) {
  if (!Array.isArray(list)) return [];
  return list.slice(-max).map((entry) => ({
    kind: entry?.kind === "promise" ? "promise" : "error",
    message: scrubSensitive(entry?.message, 160),
    at: Number.isFinite(Number(entry?.at)) ? new Date(Number(entry.at)).toISOString() : ""
  })).filter((entry) => entry.message);
}

// O servidor monta o contexto: `user` vem da sessão (confiável); `client` vem do navegador (sanitizado).
export function buildTicketContext({ user = {}, client = {}, now = new Date() } = {}) {
  const viewport = client.viewport && Number(client.viewport.width) > 0 && Number(client.viewport.height) > 0
    ? `${Math.round(Number(client.viewport.width))}x${Math.round(Number(client.viewport.height))}`
    : "";
  return {
    user: {
      id: user.id || "",
      name: scrubSensitive(user.name, 80),
      role: user.role || "",
      roleLabel: supportRoleLabel(user.role),
      viaAccountSwitch: Boolean(user.viaAccountSwitch),
      realId: user.viaAccountSwitch ? user.realId || "" : "",
      realName: user.viaAccountSwitch ? scrubSensitive(user.realName, 80) : ""
    },
    screen: { path: normalizePathname(client.pathname), title: scrubSensitive(client.title, 120) },
    device: { summary: summarizeDevice(client.userAgent), viewport, userAgent: scrubSensitive(client.userAgent, 200) },
    capturedAt: new Date(now).toISOString(),
    timeZone: SUPPORT_TIME_ZONE,
    errors: sanitizeErrorList(client.errors)
  };
}

export function formatSupportTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: SUPPORT_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date).replace(",", " às");
}

// Texto do botão "Copiar texto" da ficha (dono): contexto + descrição + a instrução final fixa.
export function formatTicketText(ticket) {
  const context = ticket?.context || {};
  const user = context.user || {};
  const lines = [];
  lines.push(`Corretor: ${user.name || ticket?.author_name || "não informado"}`);
  lines.push(`Perfil: ${user.roleLabel || supportRoleLabel(user.role)}${user.viaAccountSwitch ? ` (aberto em "Alterar conta" por ${user.realName || "administrador"})` : ""}`);
  lines.push(`Tela: ${context.screen?.title ? `${context.screen.title} — ` : ""}${context.screen?.path || ticket?.screen_path || "não informada"}`);
  lines.push(`Horário: ${formatSupportTime(ticket?.created_at || context.capturedAt) || "não informado"} (Brasília)`);
  lines.push(`Aparelho: ${context.device?.summary || "não informado"}${context.device?.viewport ? ` (${context.device.viewport})` : ""}`);
  const errors = Array.isArray(context.errors) ? context.errors : [];
  lines.push("Erros recentes da tela:");
  if (!errors.length) lines.push("- nenhum registrado");
  for (const error of errors) lines.push(`- ${error.kind === "promise" ? "[promessa rejeitada] " : ""}${error.message}`);
  lines.push("");
  lines.push("O que o corretor escreveu:");
  lines.push(String(ticket?.description || "").trim());
  lines.push("");
  lines.push(SUPPORT_COPY_INSTRUCTION);
  return lines.join("\n");
}

// ---------- Anexos ----------

// files: [{ size, type }] já reduzidos pelo navegador. A assinatura real do arquivo é conferida no servidor (image-signature).
export function validateTicketImages(files = []) {
  if (files.length > TICKET_MAX_IMAGES) return { ok: false, error: `Anexe no máximo ${TICKET_MAX_IMAGES} imagens.` };
  let total = 0;
  for (const file of files) {
    if (!TICKET_IMAGE_TYPES.includes(file?.type)) return { ok: false, error: "Anexe apenas imagens (JPG, PNG ou WEBP)." };
    const size = Number(file?.size) || 0;
    if (size <= 0) return { ok: false, error: "Uma das imagens veio vazia." };
    if (size > TICKET_IMAGE_MAX_BYTES) return { ok: false, error: "Uma das imagens ficou grande demais. Tente um print menor." };
    total += size;
  }
  if (total > TICKET_IMAGES_TOTAL_MAX_BYTES) return { ok: false, error: "As imagens somadas ficaram grandes demais. Anexe menos imagens." };
  return { ok: true, error: "" };
}

export const ticketImageExtension = (type) => (type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg");

// Fila do navegador (galeria, câmera e colar): acrescenta até o limite, nunca troca o que já está lá.
export function addTicketImages(current = [], incoming = [], max = TICKET_MAX_IMAGES) {
  const room = Math.max(0, max - current.length);
  const accepted = incoming.slice(0, room);
  return { items: [...current, ...accepted], rejected: incoming.length - accepted.length };
}

// ---------- Anti-spam ----------

// createdAts: datas (ISO/Date) dos chamados recentes do usuário (últimas 24 h).
export function checkTicketRateLimit(createdAts = [], now = new Date(), limits = TICKET_RATE_LIMIT) {
  const nowMs = new Date(now).getTime();
  const times = createdAts.map((value) => new Date(value).getTime()).filter((value) => Number.isFinite(value) && value <= nowMs).sort((a, b) => b - a);
  const inDay = times.filter((time) => nowMs - time < 24 * 60 * 60 * 1000);
  if (inDay.length >= limits.perDay) return { ok: false, reason: "day", retryAfterSec: Math.ceil((inDay[limits.perDay - 1] + 24 * 60 * 60 * 1000 - nowMs) / 1000) };
  const inWindow = times.filter((time) => nowMs - time < limits.windowMs);
  if (inWindow.length >= limits.perWindow) return { ok: false, reason: "window", retryAfterSec: Math.ceil((inWindow[limits.perWindow - 1] + limits.windowMs - nowMs) / 1000) };
  return { ok: true, reason: "", retryAfterSec: 0 };
}

export function rateLimitMessage(check) {
  if (check?.ok) return "";
  const minutes = Math.max(1, Math.ceil((check?.retryAfterSec || 60) / 60));
  return check?.reason === "day" ? "Você já enviou muitos chamados hoje. Tente novamente amanhã." : `Você enviou vários chamados seguidos. Tente de novo em ${minutes} min.`;
}

// ---------- Aviso ao corretor ----------

export function buildReplyNotice(replyText = "") {
  const text = String(replyText || "").trim().replace(/\s+/g, " ");
  return { title: "Respondemos ao seu chamado", description: text.length > 200 ? `${text.slice(0, 199)}…` : text };
}

// Ao abrir "Meus chamados" a partir do aviso (?ajuda=meus).
export const SUPPORT_NOTICE_LINK = "/admin/simulacoes?ajuda=meus";
