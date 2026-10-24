import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { ARRIVAL_CANDIDATE_LIMIT, loadClientArrivals, rows } from "./client-arrival-events";
import { saoPauloNow } from "./alexa-config-core.mjs";
import { getTodayInSaoPaulo } from "./daily-report";
import { loadOfficeAbsences } from "./office-presence";
import { readHenryActiveDevice, synthesizeHenryShort, synthesizeHenrySpeech } from "./henry-voice";
import { isHenryRepeatQuestion } from "./henry-voice-conversation.mjs";
import { listMyPendingAlerts } from "./crm-alerts";
import {
  alertDisplayItems,
  alertEventKey,
  alertWindowStart,
  buildArrivalEvents,
  buildClientAlertEvent,
  composeHenryClientAlert,
  composeHenryNoticeLines,
  isAlertDevice,
  isAlertHour,
  isHenryAlertCall,
  isHenryAlertPhrase,
  shouldReleaseAlert
} from "./henry-voice-client-alerts-core.mjs";

// Henry avisa cliente novo e cliente transferido (HENRY-1, dono 2026-10-23). SOMENTE LEITURA: lê o que as entregas já
// gravam — lead_distribution_history (índice por created_at), simulation_registrations.responsible_changed_at (índice;
// gravado por updateSimulationRegistration em toda troca de responsável, inclusive a manual) e created_at com
// direct_broker_link (link pessoal de corretor, a mesma definição de "link direto" do Desempenho). Para os clientes
// achados, o caminho vem de lead_distribution_history + client_journey_events responsible_transferred (as fontes da
// FUN-15h). Nada é gravado; nada vai a cliente nem a corretor — só a voz do Henry para o dono.

const CANDIDATE_LIMIT = ARRIVAL_CANDIDATE_LIMIT;

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Eventos (um por cliente) dos clientes `ids`. fromIso + requireFresh: só entrega dentro da janela (consulta periódica).
// Leitura compartilhada com a janelinha de cliente novo: loadClientArrivals (lib/client-arrival-events.js). Atendido =
// atendimento depois da ENTRADA do cliente (definição de sempre do Henry).
async function loadClientEvents(ids, { fromIso = "", requireFresh = true, now = Date.now() } = {}) {
  const arrivals = await loadClientArrivals(ids, { now });
  const events = [];
  for (const { registration, steps, lastAttendanceAt } of arrivals) {
    const created = Date.parse(registration.created_at) || 0;
    const attended = (Date.parse(lastAttendanceAt || "") || 0) >= created;
    const event = buildClientAlertEvent({ registration, steps, fromIso, attended, requireFresh, now });
    if (event) events.push(event);
  }
  return events.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
}

// Chegada da equipe (dono, 2026-10-23): a 1ª chegada do dia pelo Wi-Fi que a ROL-2f JÁ grava (office_presence_checkins,
// uma linha por pessoa por dia; nada é gravado aqui). Consulta periódica: chegadas desde fromIso. Na hora de falar
// (userIds): a chegada de hoje de cada um, relida (ausência marcada depois derruba o aviso). Regras: buildArrivalEvents.
export async function loadArrivalEvents({ fromIso = "", userIds = null, ownerId = "", now = Date.now() } = {}) {
  let query = db().from("office_presence_checkins").select("user_id, checkin_date, first_seen_at, valid_until, source").eq("source", "wifi");
  if (userIds) {
    const ids = [...new Set(userIds.filter(Boolean))].slice(0, CANDIDATE_LIMIT);
    if (!ids.length) return [];
    query = query.in("user_id", ids).eq("checkin_date", getTodayInSaoPaulo());
  } else {
    query = query.gte("first_seen_at", fromIso);
  }
  const checkins = (await rows(query.order("first_seen_at", { ascending: true }).limit(CANDIDATE_LIMIT))).filter((row) => row.user_id !== ownerId);
  if (!checkins.length) return [];
  const ids = [...new Set(checkins.map((row) => row.user_id))];
  const [users, absences] = await Promise.all([
    rows(db().from("admin_users").select("id, name, gender, role, status").in("id", ids)),
    loadOfficeAbsences(ids)
  ]);
  return buildArrivalEvents({ checkins, users: new Map(users.map((user) => [user.id, user])), absences, ownerId, now });
}

async function loadUsers(events) {
  const ids = [...new Set(events.flatMap((event) => [event.receiverId, ...event.path]).filter(Boolean))];
  if (!ids.length) return new Map();
  const list = await rows(db().from("admin_users").select("id, name, gender").in("id", ids));
  return new Map(list.map((user) => [user.id, user]));
}

// Consulta periódica (sem voz, nenhuma chamada paga): entregas desde o cursor. seen = chaves cliente:corretor já
// avisadas/pendentes no navegador (a janela relê o último minuto). Rajada: segura até assentar (shouldReleaseAlert).
// call = o vocativo já sorteado no navegador; sai com voz (cache curto por voz) só quando há aviso e pode falar.
// clients/arrivals = liga/desliga "Avisar clientes novos e transferidos" / "Avisar chegada da equipe".
export async function pollHenryClientAlerts(auth, { since = "", seen = [], deviceId = "", call = "", style = null, voice = true, clients = true, arrivals = true } = {}) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  if (!isAlertDevice(await readHenryActiveDevice(), deviceId)) return { cursor: nowIso, skipped: "other_device", events: [] };
  const fromIso = alertWindowStart(since, now);
  const none = Promise.resolve([]);
  const [delivered, moved, direct, arrived] = await Promise.all([
    clients ? rows(db().from("lead_distribution_history").select("registration_id").gte("created_at", fromIso).not("to_user_id", "is", null).limit(CANDIDATE_LIMIT)) : none,
    clients ? rows(db().from("simulation_registrations").select("id").gte("responsible_changed_at", fromIso).limit(CANDIDATE_LIMIT)) : none,
    clients ? rows(db().from("simulation_registrations").select("id").gte("created_at", fromIso).eq("direct_broker_link", true).limit(CANDIDATE_LIMIT)) : none,
    arrivals ? loadArrivalEvents({ fromIso, ownerId: auth?.profile?.id || "", now }) : none
  ]);
  const ids = [...delivered.map((row) => row.registration_id), ...moved.map((row) => row.id), ...direct.map((row) => row.id)];
  if (!ids.length && !arrived.length) return { cursor: nowIso, events: [] };
  const seenKeys = new Set((Array.isArray(seen) ? seen : []).filter((key) => typeof key === "string").slice(-200));
  const clientEvents = ids.length ? await loadClientEvents(ids, { fromIso, now }) : [];
  const events = [...clientEvents, ...arrived]
    .filter((event) => !seenKeys.has(alertEventKey(event)))
    .sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  if (!events.length) return { cursor: nowIso, events: [] };
  if (!shouldReleaseAlert({ oldestAt: events[0].at, newestAt: events[events.length - 1].at, now })) {
    return { cursor: since || nowIso, hold: true, events: [] };
  }
  const speak = voice && isAlertHour(saoPauloNow().minutes);
  const callAudio = speak && isHenryAlertPhrase(call) ? await synthesizeHenryShort(auth, call, style, { profile: isHenryAlertCall(call) ? "call" : "" }) : null;
  return {
    cursor: nowIso,
    quiet: !speak,
    callAudio,
    events: events.map((event) =>
      event.kind === "arrival"
        ? { key: alertEventKey(event), userId: event.userId, kind: "arrival", at: event.at }
        : { key: alertEventKey(event), clientId: event.clientId, receiverId: event.receiverId, kind: event.kind, at: event.at }
    )
  };
}

// A informação, depois do "pode falar": dados relidos agora (quem está com o cliente, espera, caminho), um aviso só
// (resumo quando são vários) e a voz do Henry. Um cliente que saiu do escopo do aviso (arquivado, Particular, fila) cai.
// Chegadas (userIds) vêm depois dos clientes no mesmo aviso (prioridade do dono).
export async function speakHenryClientAlerts(auth, { clientIds = [], userIds = [], noticeIds = [], recent = null, away = false, style = null, voice = true, clients = true, arrivals = true } = {}) {
  const ownerId = auth?.profile?.id || "";
  // Avisos da Central (dono, 2026-10-23): relidos aqui pela MESMA leitura da tela (listMyPendingAlerts, só os do próprio
  // dono, informativos ainda não vistos); o navegador marca como vistos pelo mesmo caminho da tela depois de falar.
  const wantedNotices = new Set((noticeIds || []).filter((id) => typeof id === "string"));
  const [clientEvents, arrivalEvents, notices] = await Promise.all([
    clients && clientIds.length ? loadClientEvents(clientIds, { requireFresh: false }) : [],
    arrivals && userIds.length ? loadArrivalEvents({ userIds, ownerId }) : [],
    wantedNotices.size ? listMyPendingAlerts(auth).then((data) => (data.informative || []).filter((item) => wantedNotices.has(item.id))).catch(() => []) : []
  ]);
  const users = clientEvents.length ? await loadUsers(clientEvents) : new Map();
  const composed = clientEvents.length || arrivalEvents.length ? composeHenryClientAlert([...clientEvents, ...arrivalEvents], { users, ownerId, recent: recent || undefined, away }) : { text: "", recent };
  // Prioridade: cliente novo/transferido e chegada primeiro, depois os avisos da Central (mais recente primeiro).
  const noticeText = composeHenryNoticeLines(notices, { lead: true });
  const text = [composed.text, noticeText.text].filter(Boolean).join(" ").trim();
  // Lidos = os falados + os que já não estão pendentes (alguém viu na tela / passaram do prazo): saem do pendente.
  const readNoticeIds = [...wantedNotices];
  if (!text) return { text: "", audio: null, recent: composed.recent, noticeIds: readNoticeIds, items: [] };
  // Lista na tela (canto esquerdo), um item por aviso falado — só o que vai na voz.
  const items = alertDisplayItems({ clientText: composed.text, events: [...clientEvents, ...arrivalEvents], noticeLines: noticeText.lines });
  const audio = voice && isAlertHour(saoPauloNow().minutes) ? await synthesizeHenrySpeech(auth, text, style) : null;
  return { text, audio, items, recent: composed.recent, noticeIds: noticeText.extra > 0 ? readNoticeIds.filter((id) => noticeText.spokenIds.includes(id) || !notices.some((item) => item.id === id)) : readNoticeIds };
}

// Frase curta fixa do aviso (vocativo, "depois te falo", "posso falar?"): só da lista fechada, voz com cache por voz;
// o vocativo sai com o perfil de voz do chamado (mais lento, tom de pergunta). Também a repetição curta da pergunta
// aberta ("Posso dar play?", lista fechada HENRY_REPEAT_QUESTIONS — dono, 2026-10-23).
export async function henryAlertPhraseAudio(auth, text, style) {
  if (!isHenryAlertPhrase(text) && !isHenryRepeatQuestion(text)) return null;
  return synthesizeHenryShort(auth, text, style, { profile: isHenryAlertCall(text) ? "call" : "" });
}
