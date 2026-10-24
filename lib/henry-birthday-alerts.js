import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { applyResponsibleUserScope } from "./admin-access";
import { createAlertDeliveries } from "./crm-alerts";
import { saoPauloDateKey } from "./alexa-config-core.mjs";
import { normalizeSpeechText } from "./henry-voice-core.mjs";
import { NOTIFICATION_KIND } from "./notification-policy-core.mjs";
import {
  BIRTHDAY_EXCLUDED_STATUSES,
  BIRTHDAY_NOTICE_SOURCE,
  birthdayBrokerName,
  birthdayConfirmDetail,
  birthdayConfirmReply,
  birthdayEventKey,
  birthdayNoticeDedupeKey,
  birthdayNoticeResultText,
  buildBirthdayEvents,
  buildBirthdayNoticeDeliveries
} from "./henry-birthday-alerts-core.mjs";

// Henry avisa aniversariante do dia (HENRY-1, dono 2026-10-24). Leitura no escopo do dono (admin geral = todos) pela MESMA
// regra de aniversário da Agenda/Alexa/bom dia (isBirthdayOn sobre oldest_birth_date; 1900-01-01 = sem data). A única
// escrita é sendHenryBirthdayNotices: aviso INTERNO ao corretor (Central de Alertas Informativo + push henry_birthday),
// chamada só pelo botão de confirmação da tela, idempotente (1 por cliente por dia, dedupe da Central). Nunca envia nada
// ao cliente. Regras puras: lib/henry-birthday-alerts-core.mjs.

const PAGE = 1000;
const MAX_PAGES = 20;
const CACHE_MS = 10 * 60 * 1000; // a consulta periódica do aviso (30 s) relê no máximo a cada 10 min
const NO_BIRTH_DATE = "1900-01-01"; // MANUAL_DEFAULT_BIRTH_DATE (lib/simulation-registrations.js)
const COLUMNS = "id, full_name, oldest_birth_date, status, private_contact_at, responsible_user_id, phone";
const cache = new Map();

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

async function loadBirthdayRows(auth) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = db()
      .from("simulation_registrations")
      .select(COLUMNS)
      .not("oldest_birth_date", "is", null)
      .neq("oldest_birth_date", NO_BIRTH_DATE)
      .not("status", "in", `(${BIRTHDAY_EXCLUDED_STATUSES.join(",")})`)
      .is("private_contact_at", null)
      .not("responsible_user_id", "is", null)
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    query = applyResponsibleUserScope(query, auth);
    const { data, error } = await query;
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

// Aniversariantes de hoje no escopo de quem pergunta (o dono), com quem avisar. { day, events, users }.
export async function loadTodayBirthdays(auth, { fresh = false } = {}) {
  const ownerId = auth?.profile?.id || "";
  const day = saoPauloDateKey();
  const key = `${ownerId}:${day}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const rows = await loadBirthdayRows(auth);
  const ids = [...new Set(rows.map((row) => row.responsible_user_id).filter((id) => id && id !== ownerId))];
  let users = new Map();
  if (ids.length) {
    const { data, error } = await db().from("admin_users").select("id, name, gender, status").in("id", ids);
    if (error) throw error;
    users = new Map((data || []).map((user) => [user.id, user]));
  }
  const value = { day, events: buildBirthdayEvents({ rows, users, ownerId, dateKey: day }), users };
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  return value;
}

// Clientes de hoje cujo corretor JÁ foi avisado (mesma dedupe_key do envio).
async function loadNotifiedClientIds(events) {
  const theirs = events.filter((event) => !event.own);
  if (!theirs.length) return new Set();
  const keys = theirs.map((event) => birthdayNoticeDedupeKey(event.clientId, event.day));
  const { data, error } = await db().from("crm_alert_deliveries").select("dedupe_key").in("dedupe_key", keys);
  if (error) throw error;
  const done = new Set((data || []).map((row) => row.dedupe_key));
  return new Set(theirs.filter((event) => done.has(birthdayNoticeDedupeKey(event.clientId, event.day))).map((event) => event.clientId));
}

// Consulta periódica do aviso: aniversariantes de hoje ainda não anunciados (seen = chaves birthday:<id>:<dia> do navegador).
export async function pollBirthdayEvents(auth, { seen = [] } = {}) {
  const { day, events } = await loadTodayBirthdays(auth);
  const seenKeys = new Set((Array.isArray(seen) ? seen : []).filter((item) => typeof item === "string").slice(-300));
  return { day, events: events.filter((event) => !seenKeys.has(birthdayEventKey(event))) };
}

// Na hora de falar: os dados relidos (o cliente pode ter saído: arquivado, Particular, data trocada).
export async function loadBirthdayEventsByIds(auth, clientIds = []) {
  const wanted = new Set((clientIds || []).filter((id) => typeof id === "string"));
  if (!wanted.size) return { events: [], users: new Map() };
  const { events, users } = await loadTodayBirthdays(auth, { fresh: true });
  return { events: events.filter((event) => wanted.has(event.clientId)), users };
}

// "Sim" à pergunta do aniversário (ou a ferramenta avisar_corretor_aniversario): monta a CONFIRMAÇÃO na tela — nada é
// enviado aqui. name = primeiro nome do cliente falado (opcional) para restringir.
export async function prepareBirthdayConfirmation(auth, { name = "", signature = "Matheus" } = {}) {
  const { events: all, users } = await loadTodayBirthdays(auth);
  const term = normalizeSpeechText(name).trim();
  const events = term ? all.filter((event) => normalizeSpeechText(event.clientName).split(" ").includes(term.split(" ")[0])) : all;
  if (!events.length) return { events, detail: null, reply: term ? `Não achei aniversariante hoje com o nome ${String(name).slice(0, 40)}.` : "Não achei aniversariante hoje agora." };
  const notified = await loadNotifiedClientIds(events).catch(() => new Set());
  return { events, detail: birthdayConfirmDetail(events, { users, notified, signature }), reply: birthdayConfirmReply(events, { users, notified }) };
}

// Botão "Enviar aviso" da tela (confirmação do dono, HENRY-1): só clientes de hoje, no escopo, de outro responsável ATIVO.
// Idempotente pela dedupe_key da Central (1 por cliente por dia). Registro = a própria entrega (context.source
// henry_birthday, sent_by, via) + log com contagens.
export async function sendHenryBirthdayNotices(auth, clientIds = []) {
  const wanted = new Set((clientIds || []).filter((id) => typeof id === "string"));
  const { events, users } = await loadTodayBirthdays(auth, { fresh: true });
  const targets = events.filter((event) => !event.own && wanted.has(event.clientId));
  if (!targets.length) return { sent: [], already: [], text: "Nada para avisar agora." };
  const deliveries = buildBirthdayNoticeDeliveries(targets, { sentBy: auth?.profile?.id || "", pushKind: NOTIFICATION_KIND.HENRY_BIRTHDAY });
  const created = await createAlertDeliveries(deliveries);
  const createdKeys = new Set(created.map((row) => `${row.recipient_id}:${row.context?.client_id || ""}`));
  const sentBrokers = new Set();
  const alreadyBrokers = new Set();
  for (const event of targets) {
    const label = birthdayBrokerName(users.get(event.receiverId)).name;
    if (createdKeys.has(`${event.receiverId}:${event.clientId}`)) sentBrokers.add(label);
    else alreadyBrokers.add(label);
  }
  console.info(`[henry] aviso de aniversário (${BIRTHDAY_NOTICE_SOURCE}): ${created.length} enviado(s), ${targets.length - created.length} já avisado(s) hoje.`);
  const sent = [...sentBrokers];
  const already = [...alreadyBrokers].filter((label) => !sentBrokers.has(label));
  return { sent, already, text: birthdayNoticeResultText({ sent, already }) };
}
