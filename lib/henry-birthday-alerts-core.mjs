// Henry avisa aniversariante do dia (HENRY-1, REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24): "quando tiver um
// aniversariante, eu quero que ele fale: a cliente Bruna, atribuída ao Gabriel, faz aniversário hoje. Quer que eu envie uma
// mensagem para o Gabriel avisando? Se for meu, ele pode perguntar: quer que eu prepare uma mensagem para você enviar?"
// Regras PURAS (sem banco, sem rede). Servidor: lib/henry-birthday-alerts.js. Testes: tests/henry-birthday-alerts.test.mjs.
//
// - Aniversário = a MESMA regra da Agenda, da Alexa e do bom dia (isBirthdayOn: oldest_birth_date dia/mês, ano 1900 = sem
//   data, 29/02 → 28/02) — não crie outra.
// - Só clientes com responsável (o dono ou corretor/gestor/associado ATIVO); nunca Não contactar, arquivado nem Particular.
// - Aviso ao corretor = ÚNICA escrita do Henry no CRM: aviso INTERNO (Central de Alertas Informativo + push), nunca
//   mensagem ao cliente; só depois do "sim" do dono E do clique de confirmação na tela; 1 por cliente por dia (dedupe).
// - Cliente do próprio dono: o Henry só PREPARA o texto (copiar / abrir o WhatsApp) — nunca envia.

import { isBirthdayOn, firstName as safeFirstName } from "./alexa-config-core.mjs";
import { clientVoice } from "./henry-voice-client-alerts-core.mjs";
import { birthdayDraft } from "./henry-morning-core.mjs";
import { isSafeToSpeak } from "./alexa-v2/sanitize.mjs";
import { CLIENT_STATUS } from "./client-status.js";
import { toWhatsAppDigits } from "./phone-utils.js";

// Liga/desliga "Avisar aniversariantes" em Voz e personalidade: nasce LIGADO; só `birthdayAlerts: false` desliga.
export function henryBirthdayAlertsFromSetting(value) {
  return value?.birthdayAlerts !== false;
}

export const BIRTHDAY_EXCLUDED_STATUSES = Object.freeze([CLIENT_STATUS.ARCHIVED, CLIENT_STATUS.DO_NOT_CONTACT]);
export const BIRTHDAY_SUMMARY_NAMES = 4; // resumo falado: até 4 nomes, o resto vira "e mais N"
export const BIRTHDAY_NOTICE_SOURCE = "henry_birthday";
export const BIRTHDAY_ALERT_STEP = "birthday_alert"; // estado da pergunta (mesmo mecanismo dos passos do bom dia)
export const BIRTHDAY_NOTICE_TITLE = "Aniversário de cliente";

const ACTIVE = "active";
const fullKey = (name) => String(name || "").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");

export function birthdayEventKey(event) {
  return `birthday:${event?.clientId || ""}:${event?.day || ""}`;
}

// Dedupe do aviso ao corretor (crm_alert_deliveries recipient_id + dedupe_key): 1 por cliente por dia.
export function birthdayNoticeDedupeKey(clientId, day) {
  return `${BIRTHDAY_NOTICE_SOURCE}:${clientId}:${day}`;
}

// rows = [{ id, full_name, oldest_birth_date, status, private_contact_at, responsible_user_id, phone }] (escopo do dono);
// users = Map(id -> { id, name, gender, status }); ownerId = o dono. Devolve um evento por cliente (mesma pessoa repetida
// no mesmo responsável = um só, como birthdayFirstNames).
export function buildBirthdayEvents({ rows = [], users = new Map(), ownerId = "", dateKey = "" } = {}) {
  const events = [];
  const seenIds = new Set();
  const seenNames = new Set();
  for (const row of rows || []) {
    if (!row?.id || seenIds.has(row.id)) continue;
    if (!isBirthdayOn(row.oldest_birth_date, dateKey)) continue;
    if (BIRTHDAY_EXCLUDED_STATUSES.includes(row.status) || row.private_contact_at) continue;
    const receiverId = row.responsible_user_id || "";
    if (!receiverId) continue; // fila de espera / sem responsável: ninguém para avisar
    const own = Boolean(ownerId) && receiverId === ownerId;
    const user = users.get(receiverId);
    if (!own && (!user || user.status !== ACTIVE)) continue; // corretor inativo não recebe aviso
    const nameKey = `${receiverId}:${fullKey(row.full_name)}`;
    if (fullKey(row.full_name) && seenNames.has(nameKey)) continue;
    seenIds.add(row.id);
    seenNames.add(nameKey);
    events.push({ kind: "birthday", clientId: row.id, clientName: row.full_name || "", receiverId, own, day: dateKey, phone: row.phone || "" });
  }
  return events;
}

// Pessoa da equipe (artigos pelo admin_users.gender; sem gênero = só o nome).
function broker(user) {
  const first = safeFirstName(user?.name) || "o corretor";
  const g = user?.gender;
  return {
    first,
    name: g === "female" ? `a ${first}` : g === "male" ? `o ${first}` : first, // "para a Carol"
    to: g === "female" ? `à ${first}` : g === "male" ? `ao ${first}` : `a ${first}`, // "atribuída ao Gabriel"
    of: g === "female" ? `da ${first}` : g === "male" ? `do ${first}` : `de ${first}` // "Bruna, do Gabriel"
  };
}

const cap = (text) => (text ? text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1) : text);
const joinList = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`);

function brokerQuestion(brokerEvents, users) {
  const ids = [...new Set(brokerEvents.map((event) => event.receiverId))];
  return ids.length === 1 ? broker(users.get(ids[0])).name : "os corretores";
}

// Texto falado (depois do "pode falar" do chamado). Devolve { text, ask } — ask = termina na pergunta (o Henry espera o sim).
export function composeHenryBirthdayAlert(events = [], { users = new Map() } = {}) {
  const list = (events || []).filter((event) => event?.kind === "birthday");
  if (!list.length) return { text: "", ask: false };
  const own = list.filter((event) => event.own);
  const theirs = list.filter((event) => !event.own);
  const parts = [];
  if (list.length === 1) {
    const event = list[0];
    const c = clientVoice(event.clientName);
    if (event.own) {
      const yours = c.gender === "female" ? "que é sua" : "que é seu";
      parts.push(c.gender ? `${cap(c.art)}cliente ${c.name}, ${yours}, faz aniversário hoje.` : `${c.name}, que é cliente seu, faz aniversário hoje.`);
    } else {
      const b = broker(users.get(event.receiverId));
      if (c.gender) parts.push(`${cap(c.art)}cliente ${c.name}, atribuíd${c.o} ${b.to}, faz aniversário hoje.`);
      else parts.push(`${c.name}, cliente ${b.of}, faz aniversário hoje.`);
    }
  } else {
    const shown = list.slice(0, BIRTHDAY_SUMMARY_NAMES).map((event) => {
      const c = clientVoice(event.clientName);
      if (event.own) return `${c.name}, que é ${c.gender === "female" ? "sua" : "seu"}`;
      return `${c.name}, ${broker(users.get(event.receiverId)).of}`;
    });
    const extra = list.length - shown.length;
    parts.push(`Hoje tem ${list.length} aniversariantes: ${joinList(extra > 0 ? [...shown, `mais ${extra}`] : shown)}.`);
  }
  if (theirs.length && own.length) {
    parts.push(`Quer que eu avise ${brokerQuestion(theirs, users)} e prepare ${own.length === 1 ? "a sua mensagem" : "as suas mensagens"} para você enviar?`);
  } else if (theirs.length) {
    parts.push(`Quer que eu envie uma mensagem para ${brokerQuestion(theirs, users)} avisando?`);
  } else {
    parts.push(`Quer que eu prepare ${own.length === 1 ? "uma mensagem" : "as mensagens"} para você enviar?`);
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return isSafeToSpeak(text) ? { text, ask: true } : { text: "", ask: false };
}

// Aviso INTERNO ao corretor (Central de Alertas, Informativo + push henry_birthday). Nunca vai ao cliente.
export function birthdayNoticeBody(event) {
  const name = String(event?.clientName || "").trim() || "seu cliente";
  return `Hoje é aniversário de ${name}. Que tal mandar uma mensagem de parabéns? (Aviso do Matheus.)`;
}

export function buildBirthdayNoticeDeliveries(events = [], { sentBy = "", pushKind = "" } = {}) {
  return (events || [])
    .filter((event) => event?.kind === "birthday" && !event.own && event.receiverId && event.clientId && event.day)
    .map((event) => ({
      definition_id: null,
      recipient_id: event.receiverId,
      kind: "informative",
      title: BIRTHDAY_NOTICE_TITLE,
      body: birthdayNoticeBody(event),
      context: { source: BIRTHDAY_NOTICE_SOURCE, action: "notify_broker", client_id: event.clientId, day: event.day, sent_by: sentBy, via: "henry", link: "/admin/simulacoes", ...(pushKind ? { push_kind: pushKind } : {}) },
      dedupe_key: birthdayNoticeDedupeKey(event.clientId, event.day)
    }));
}

// Rascunho para o cliente do próprio dono (o Henry NUNCA envia): texto do bom dia (birthdayDraft) + link do WhatsApp com o
// texto pronto (só na tela). Telefone inválido = só copiar.
export function ownBirthdayDraft(event, signature = "Matheus") {
  const c = clientVoice(event?.clientName);
  const name = c.gender ? c.name : safeFirstName(event?.clientName) || "";
  const text = birthdayDraft(name, signature);
  const digits = toWhatsAppDigits(event?.phone || "");
  return { text, whatsappUrl: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : "" };
}

// Tela depois do "sim" (ou da ferramenta avisar_corretor_aniversario): lista, CONFIRMAÇÃO do aviso ao corretor (o envio só
// sai pelo botão) e rascunhos dos clientes do dono com copiar / abrir WhatsApp. notified = Set(clientId) já avisados hoje.
export function birthdayConfirmDetail(events = [], { users = new Map(), notified = new Set(), signature = "Matheus" } = {}) {
  const list = (events || []).filter((event) => event?.kind === "birthday");
  if (!list.length) return null;
  const theirs = list.filter((event) => !event.own);
  const own = list.filter((event) => event.own);
  const pending = theirs.filter((event) => !notified.has(event.clientId));
  const sections = [];
  if (theirs.length) {
    sections.push({
      title: "Aviso ao corretor",
      rows: theirs.map((event) => ({ label: event.clientName || "Cliente", value: broker(users.get(event.receiverId)).first, ...(notified.has(event.clientId) ? { note: "já avisado hoje" } : {}) }))
    });
  }
  if (own.length) {
    sections.push({
      title: "Sua mensagem",
      rows: own.map((event) => {
        const draft = ownBirthdayDraft(event, signature);
        return { label: event.clientName || "Cliente", value: "", note: draft.text, actions: [{ kind: "copy", text: draft.text, label: "Copiar" }, ...(draft.whatsappUrl ? [{ kind: "link", href: draft.whatsappUrl, label: "Abrir WhatsApp" }] : [])] };
      })
    });
  }
  const names = [...new Set(pending.map((event) => broker(users.get(event.receiverId)).name))];
  const confirm = pending.length
    ? {
        kind: "birthday_notice",
        clientIds: pending.map((event) => event.clientId),
        label: names.length === 1 ? `Enviar aviso para ${names[0]}` : "Enviar aviso aos corretores",
        note: "Vai só para a Central de Alertas e o celular do corretor. Nada vai ao cliente."
      }
    : null;
  return { title: "Aniversariantes de hoje", subtitle: own.length && !theirs.length ? "Rascunho — o Henry não envia nada" : "Confirme na tela antes de enviar", sections, ...(confirm ? { confirm } : {}) };
}

// Fala depois do "sim" (o envio ainda NÃO aconteceu: depende do botão).
export function birthdayConfirmReply(events = [], { users = new Map(), notified = new Set() } = {}) {
  const theirs = (events || []).filter((event) => event?.kind === "birthday" && !event.own);
  const pending = theirs.filter((event) => !notified.has(event.clientId));
  const own = (events || []).filter((event) => event?.kind === "birthday" && event.own);
  const parts = [];
  if (pending.length) parts.push(`Deixei o aviso para ${brokerQuestion(pending, users)} na tela. É só confirmar que eu envio.`);
  else if (theirs.length) parts.push(`O aviso para ${brokerQuestion(theirs, users)} já saiu hoje.`);
  if (own.length) parts.push(own.length === 1 ? "A sua mensagem está na tela, pra copiar ou abrir no WhatsApp." : "As suas mensagens estão na tela, pra copiar ou abrir no WhatsApp.");
  return parts.join(" ") || "Não achei aniversariante hoje agora.";
}

// Resultado do botão de confirmação.
export function birthdayNoticeResultText({ sent = [], already = [] } = {}) {
  const parts = [];
  if (sent.length) parts.push(sent.length === 1 ? `Pronto, avisei ${sent[0]}.` : `Pronto, avisei ${joinList(sent)}.`);
  if (already.length) parts.push(`O aviso para ${joinList(already)} já tinha saído hoje.`);
  return parts.join(" ") || "Nada para avisar agora.";
}

export { broker as birthdayBrokerName };
