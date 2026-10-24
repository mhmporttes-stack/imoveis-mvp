// Janelinha de CLIENTE NOVO na tela (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24, CLI-16). Parte pura (testada em
// tests/client-popup-core.test.mjs); leitura no servidor em lib/client-popups.js, tela em components/client-popups/.
//
// Quais clientes viram janelinha: a MESMA definição de "cliente que chegou a um corretor" do aviso do Henry
// (buildClientAlertEvent: roleta, fila de espera, redistribuição, fila de reativação do FUN-15l, Marketplace, transferência
// manual/do próprio corretor, link pessoal) + o cadastro feito para ele por outra pessoa/sistema (cadastro manual, campanha
// com corretor fixo, WhatsApp) — nunca o que ele mesmo cadastrou nem o contato da Prospecção/Meta Diária que ele assumiu.
// Só os ainda SEM atendimento desde o recebimento (lib/client-attendance*) e só das últimas 12 h.
import { buildClientAlertEvent } from "./henry-voice-client-alerts-core.mjs";
import { CLIENT_POPUP_KIND } from "./client-popup-view-core.mjs";

export { CLIENT_POPUP_KIND };

export const CLIENT_POPUP_LOOKBACK_MS = 12 * 60 * 60 * 1000; // abriu o CRM depois de um tempo fora: só as últimas ~12 h
export const CLIENT_POPUP_OVERLAP_MS = 60 * 1000; // relê o último minuto (registro gravado no limite do cursor)
export const CLIENT_POPUP_ATTENDANCE_GRACE_MS = 30 * 1000; // efeitos do próprio cadastro (etiqueta, origem) não contam


const MARKETPLACE_ORIGIN = "facebook_marketplace";
const PROSPECTING_ORIGIN = "prospecting";

function ms(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : NaN;
}

// Início da leitura: sem cursor (abriu a tela) = últimas 12 h; com cursor = desde o cursor menos 1 min, nunca antes de 12 h.
export function clientPopupWindowStart(sinceIso, now = Date.now()) {
  const floor = now - CLIENT_POPUP_LOOKBACK_MS;
  const since = ms(sinceIso);
  if (!Number.isFinite(since) || since > now) return new Date(floor).toISOString();
  return new Date(Math.max(floor, since - CLIENT_POPUP_OVERLAP_MS)).toISOString();
}

// De quem são os clientes que viram janelinha (escopo no SERVIDOR). Corretor/gestor/admin: só os dele (o mesmo escopo
// privado das notificações, AUT-9 — gestor e admin não recebem os da equipe). Associado: os dele e os do corretor ao qual
// está vinculado. "Alterar conta": nenhum (como a Central de Alertas e a Supervisão).
export function clientPopupReceiverIds({ profileId = "", role = "", linkedBrokerId = "", accountSwitchMode = false } = {}) {
  if (accountSwitchMode || !profileId) return [];
  if (role === "associate") return [...new Set([profileId, linkedBrokerId].filter(Boolean))];
  return [profileId];
}

function originKind(registration) {
  return String(registration?.acquisition_context?.kind || "");
}

// Cadastrado pela própria pessoa que está vendo (cadastro manual, "Adicionar ao CRM" do Chat): não é cliente que "chegou".
function createdByViewer(registration, viewerEmail) {
  const actor = String(registration?.acquisition_context?.actor || "").trim().toLowerCase();
  const email = String(viewerEmail || "").trim().toLowerCase();
  return Boolean(actor && email && actor === email);
}

export function clientPopupOrigin(registration) {
  const label = String(registration?.acquisition_context?.label || "").trim();
  if (label) return label.length > 80 ? `${label.slice(0, 79)}…` : label;
  return originKind(registration) === MARKETPLACE_ORIGIN ? "Facebook Marketplace" : "Cadastro no CRM";
}

// Destino do clique: Messenger → a conversa do Marketplace; cliente que chegou pelo WhatsApp → o Chat naquela conversa;
// o resto → a ficha do cliente na lista de Clientes. Só caminhos que as telas já aceitam (?conversa=, ?client=, ?clientId=).
const UUID = /^[0-9a-f-]{36}$/i;
export function clientPopupHref({ kind, clientId = "", conversationId = "", originKind: origin = "" } = {}) {
  if (kind === CLIENT_POPUP_KIND.MESSENGER) {
    return UUID.test(conversationId) ? `/admin/chat/marketplace?conversa=${conversationId}` : "/admin/chat/marketplace";
  }
  if (!UUID.test(clientId)) return "/admin/simulacoes";
  if (String(origin).startsWith("whatsapp")) return `/admin/chat?client=${clientId}`;
  return `/admin/simulacoes?clientId=${clientId}`;
}

// Uma janelinha por recebimento (cliente + quem recebeu + quando): transferido de novo mais tarde = janelinha nova.
export function clientPopupKey({ clientId = "", receiverId = "", at = "" } = {}) {
  const time = ms(at);
  return `${clientId}:${receiverId}:${Number.isFinite(time) ? time : ""}`;
}

// Uma janelinha (ou null). registration/steps/lastAttendanceAt = loadClientArrivals (lib/client-arrival-events.js).
export function buildClientPopup({ registration, steps = [], lastAttendanceAt = "", fromIso = "", receiverIds = [], viewerEmail = "", conversationId = "", now = Date.now() } = {}) {
  if (!registration?.id || !receiverIds.includes(registration.responsible_user_id)) return null;
  const origin = originKind(registration);
  let event = buildClientAlertEvent({ registration, steps, fromIso, attended: false, requireFresh: true, now });
  // Cadastrado para ele sem passar por entrega registrada (cadastro manual de outra pessoa, campanha com corretor fixo,
  // WhatsApp pessoal): conta como cliente novo se o cadastro está na janela.
  if (!event && !steps.length && ms(registration.created_at) >= ms(fromIso)) {
    event = { clientId: registration.id, clientName: registration.full_name || "", receiverId: registration.responsible_user_id, kind: "new", path: [registration.responsible_user_id], at: registration.created_at };
  }
  if (!event) return null;
  // Cliente "novo" que a própria pessoa cadastrou ou que veio da Prospecção/Meta Diária (contato que ela assumiu) não é
  // cliente que chegou. Transferido conta sempre (inclusive o da Prospecção que esfriou e foi para outro, FUN-15l).
  if (event.kind !== "transfer" && (registration.prospecting_contact_id || origin === PROSPECTING_ORIGIN || createdByViewer(registration, viewerEmail))) return null;
  const receivedAt = ms(event.at);
  if (!Number.isFinite(receivedAt) || receivedAt > now + 60 * 1000) return null;
  // Atendido depois de recebido (o que o corretor anterior fez não conta para quem recebeu).
  if (ms(lastAttendanceAt) > receivedAt + CLIENT_POPUP_ATTENDANCE_GRACE_MS) return null;

  const kind = origin === MARKETPLACE_ORIGIN ? CLIENT_POPUP_KIND.MESSENGER : event.kind === "transfer" ? CLIENT_POPUP_KIND.TRANSFER : CLIENT_POPUP_KIND.NEW;
  const fromUserId = event.path.length >= 2 ? event.path[event.path.length - 2] : "";
  return {
    key: clientPopupKey({ clientId: registration.id, receiverId: registration.responsible_user_id, at: event.at }),
    kind,
    clientId: registration.id,
    clientName: registration.full_name || "Cliente",
    origin: clientPopupOrigin(registration),
    fromUserId: event.kind === "transfer" ? fromUserId : "",
    at: new Date(receivedAt).toISOString(),
    href: clientPopupHref({ kind, clientId: registration.id, conversationId, originKind: origin })
  };
}
