import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { listVisibleTeamProfiles } from "./admin-profiles";
import { addDaysToPlainDate, getTodayInSaoPaulo, zonedPlainDateToUtcIso } from "./daily-report";
import {
  AWAY_WINDOW_MS,
  PRESENCE_REPORT_PERIODS,
  PRESENCE_STATUS,
  buildPresenceReportMembers,
  buildPresenceSessions,
  buildWhatsappConnectionPeriods,
  whatsappPresenceIcons,
  splitPrivateAttempts,
  computeDailyPresence,
  deriveStatus,
  deriveVisualStatus,
  presenceDeviceFromUserAgent,
  resolvePresenceProfileId,
  resolvePresencePeriodDates,
  writePresenceSignal
} from "./admin-presence-core.mjs";

export { PRESENCE_REPORT_PERIODS, PRESENCE_STATUS, computeDailyPresence, deriveStatus, deriveVisualStatus };

// Janelas de status — sempre DERIVADAS da idade da última atividade na hora
// da leitura, nunca de um evento de login/logout (fechar o navegador/PWA sem
// logout não pode manter alguém "online" para sempre). "Ausente" cobre quem
// ainda tem presença conhecida mas parou de interagir; depois da janela de
// ausência, cai para offline sozinho, sem depender de nenhum evento externo.
// Só INTERAÇÃO real (clique, tecla, rolagem, toque — ver
// components/AdminPresenceHeartbeat.jsx) ou ação real de WhatsApp/Chat gera
// atividade: "online" = atividade nos últimos 5 min; de 5 a 30 min = ausente;
// depois disso offline. Janelas e cálculo puro em lib/admin-presence-core.mjs.
//
// ROL-2b (regra do dono, 2026-10-01): last_activity_at guarda sempre a hora
// REAL da última atividade — nunca mais uma hora no futuro (a antiga
// "tolerância" de 5 min gravada à frente fazia a roleta considerar o corretor
// on-line por até 10 min depois de um envio pelo Chat). A tolerância visual
// continua existindo, mas calculada na leitura a partir das marcas
// kind='grace' (loadVisualPresence), sem afetar a roleta.

const STATUS_ORDER = { [PRESENCE_STATUS.ONLINE]: 0, [PRESENCE_STATUS.AWAY]: 1, [PRESENCE_STATUS.OFFLINE]: 2 };

export function canLoadAdminPresence() {
  return hasSupabaseAdminConfig;
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Presença é SEMPRE do usuário REAL da sessão. Em "Alterar conta" o perfil
// efetivo (auth.profile) é o do corretor emulado e NUNCA recebe presença: o
// sinal vai para o admin real (regra do dono, 2026-10-04). Ver
// resolvePresenceProfileId em lib/admin-presence-core.mjs.
function requireProfileId(auth) {
  const id = resolvePresenceProfileId(auth);
  if (!id) throw new Error("Usuário sem perfil ativo.");
  return id;
}

// Chamado pelo heartbeat do navegador (components/AdminPresenceHeartbeat.jsx)
// SOMENTE quando houve interação real (nunca por timer ocioso), e pelas rotas
// de ação de WhatsApp/Chat (recordAdminGrace). Grava a hora REAL da atividade
// em admin_presence.last_activity_at (lida pela roleta) e a marca do minuto no
// histórico usado pelo relatório de horas. Com grace=true (clique em
// WhatsApp, envio pelo Chat, tentativa da Meta Diária) a marca é
// kind='grace': o relatório de horas e o status VISUAL toleram mais
// inatividade depois dela — a roleta não (ROL-2b). A marca de histórico é
// best-effort: se a tabela ainda não existir, a presença continua funcionando.
export async function recordAdminHeartbeat(auth, { grace = false, userAgent = "" } = {}) {
  const userId = requireProfileId(auth);
  await writePresenceSignal(db(), userId, {
    grace,
    device: presenceDeviceFromUserAgent(userAgent),
    nowMs: Date.now(),
    warn: (...args) => console.warn(...args)
  });
}

// Versão "à prova de falha" para rotas de negócio (WhatsApp, Meta Diária,
// prospecção): nunca pode quebrar a ação principal por causa da presença.
export async function recordAdminGrace(auth) {
  try {
    await recordAdminHeartbeat(auth, { grace: true });
  } catch (error) {
    console.warn("Falha ao registrar tolerância de presença:", error?.message || error);
  }
}

// Presença da equipe visível para quem pergunta — MESMA regra de
// visibilidade já usada no Ranking/Desempenho (listVisibleTeamProfiles):
// administrador geral vê todo mundo, gestor só a própria equipe. A lista de
// quem pode aparecer já sai filtrada antes de qualquer busca de presença —
// não há como pedir a presença de alguém fora desse escopo, mesmo chamando a
// API diretamente.
export async function getTeamPresence(auth) {
  assertGeneralAdminOrManager(auth);
  const profiles = await listVisibleTeamProfiles(auth);
  const ids = profiles.map((profile) => profile.id);
  if (!ids.length) return { online: 0, away: 0, offline: 0, members: [] };

  const now = Date.now();
  const [presenceByUser, whatsappByUser] = await Promise.all([loadVisualPresence(ids, now), loadWhatsappIconsByUser(ids)]);
  const members = profiles
    .map((profile) => {
      const presence = presenceByUser.get(profile.id);
      return {
        id: profile.id,
        name: profile.name || profile.email || "Usuário",
        photoUrl: profile.photoUrl || "",
        status: presence?.status || PRESENCE_STATUS.OFFLINE,
        lastActivityAt: presence?.lastActivityAt || null,
        device: presence?.device || null,
        whatsapp: whatsappByUser.get(profile.id) || whatsappPresenceIcons([])
      };
    })
    .sort((a, b) => {
      const orderDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (orderDiff !== 0) return orderDiff;
      const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      return bTime - aTime;
    });

  const counts = { online: 0, away: 0, offline: 0 };
  for (const member of members) counts[member.status] += 1;

  return { ...counts, members, generatedAt: new Date(now).toISOString() };
}

// Status VISUAL de presença (painel Online, seletor 🟢 do Chat, painel da
// roleta) — mesma aparência de antes da ROL-2b: atividade real OU a
// tolerância de uma marca kind='grace' recente. Nunca usar para decidir quem
// recebe lead: a roleta lê só last_activity_at (pick_round_robin_broker).
// Devolve Map userId -> { status, lastActivityAt } (lastActivityAt = hora
// real, para "Última atividade há X min"). Sem ids, mapa vazio. Falha ao ler
// as marcas de tolerância não derruba a tela: cai no status só pela
// atividade real.
export async function loadVisualPresence(userIds, now = Date.now()) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const result = new Map();
  if (!ids.length) return result;

  let { data, error } = await db().from("admin_presence").select("user_id, last_activity_at, last_device").in("user_id", ids);
  // Antes da migration da coluna last_device: lê sem ela (ícone de aparelho simplesmente não aparece).
  if (error && /last_device/i.test(error.message || "")) ({ data, error } = await db().from("admin_presence").select("user_id, last_activity_at").in("user_id", ids));
  if (error) throw error;
  const lastActivityByUser = new Map((data || []).map((row) => [row.user_id, row.last_activity_at]));
  const lastDeviceByUser = new Map((data || []).map((row) => [row.user_id, row.last_device || null]));

  const lastGraceByUser = new Map();
  try {
    const since = new Date(now - AWAY_WINDOW_MS - 60 * 60 * 1000).toISOString();
    const { data: graceRows, error: graceError } = await db()
      .from("admin_presence_activity")
      .select("user_id, minute_at")
      .in("user_id", ids)
      .eq("kind", "grace")
      .gte("minute_at", since)
      .order("minute_at", { ascending: false })
      .limit(ids.length * 120);
    if (graceError) throw graceError;
    for (const row of graceRows || []) {
      if (!lastGraceByUser.has(row.user_id)) lastGraceByUser.set(row.user_id, row.minute_at);
    }
  } catch (graceError) {
    console.warn("Tolerância visual de presença indisponível:", graceError?.message || graceError);
  }

  for (const id of ids) {
    const lastActivityAt = lastActivityByUser.get(id) || null;
    result.set(id, {
      status: deriveVisualStatus(lastActivityAt, lastGraceByUser.get(id) || null, now),
      lastActivityAt,
      device: lastDeviceByUser.get(id) || null
    });
  }
  return result;
}

export function formatAdminPresenceError(error) {
  const message = error?.message || String(error || "");
  if (message.toLowerCase().includes("admin_presence")) {
    return "A tabela public.admin_presence ainda não existe no Supabase. Execute a migration supabase/migrations/20260916_admin_presence.sql.";
  }
  return message || "Não foi possível carregar a presença da equipe.";
}

// ---------------------------------------------------------------------------
// Relatório de horas no CRM
// ---------------------------------------------------------------------------

const FETCH_PAGE_SIZE = 1000;

async function fetchAllRows(buildQuery) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(from, from + FETCH_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < FETCH_PAGE_SIZE) break;
    from += FETCH_PAGE_SIZE;
  }
  return rows;
}

function isMissingTableError(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return text.includes("admin_presence_activity") || error?.code === "42P01" || error?.code === "PGRST205";
}

// Período do relatório: datas de São Paulo (regra pura em
// lib/admin-presence-core.mjs) + limites UTC [início do 1º dia, início do dia
// seguinte ao último) para a consulta das marcas de minuto.
export function resolvePresenceRange(params = {}) {
  const { period, startDate, endDate } = resolvePresencePeriodDates(getTodayInSaoPaulo(), params);
  return {
    period,
    startDate,
    endDate,
    startIso: zonedPlainDateToUtcIso(startDate),
    endIso: zonedPlainDateToUtcIso(addDaysToPlainDate(endDate, 1))
  };
}

const IN_CHUNK = 200;

// Tentativas da Meta Diária do período que CONTAM na tela (sem as de contato
// Particular — splitPrivateAttempts, regra do dono 2026-10-12). Qualquer
// falha aqui sobe: o relatório marca contactsAvailable=false, nunca "0".
async function loadCountableAttempts(ids, range) {
  const raw = await fetchAllRows((from, to) => db()
    .from("daily_goal_attempts")
    .select("broker_id, goal_date, origin, client_id, round:daily_goal_rounds(client_id, contact:prospecting_contacts(phone_normalized))")
    .in("broker_id", ids)
    .gte("goal_date", range.startDate)
    .lte("goal_date", range.endDate)
    .order("created_at", { ascending: true })
    .range(from, to));
  if (!raw.length) return [];

  const clientIds = [...new Set(raw.map((row) => row.client_id || row.round?.client_id).filter(Boolean))];
  const clients = new Map();
  for (let index = 0; index < clientIds.length; index += IN_CHUNK) {
    const { data, error } = await db().from("simulation_registrations")
      .select("id, phone_normalized, private_contact_at")
      .in("id", clientIds.slice(index, index + IN_CHUNK));
    if (error) throw error;
    for (const client of data || []) clients.set(client.id, client);
  }

  const idList = ids.join(",");
  const conversations = await fetchAllRows((from, to) => db()
    .from("whatsapp_conversations")
    .select("session_key, assigned_user_id, contact_phone")
    .not("private_at", "is", null)
    .or(`session_key.in.(${idList}),assigned_user_id.in.(${idList})`)
    .order("id", { ascending: true })
    .range(from, to));

  const rows = raw.map((row) => {
    const clientId = row.client_id || row.round?.client_id || null;
    return {
      broker_id: row.broker_id,
      goal_date: row.goal_date,
      origin: row.origin,
      client_id: clientId,
      client_phone: clients.get(clientId)?.phone_normalized || "",
      contact_phone: row.round?.contact?.phone_normalized || ""
    };
  });
  const privateClientIds = new Set([...clients.values()].filter((client) => client.private_contact_at).map((client) => client.id));
  return splitPrivateAttempts(rows, {
    privateClientIds,
    privateConversations: conversations.map((conversation) => ({
      owner_ids: [conversation.session_key, conversation.assigned_user_id],
      contact_phone: conversation.contact_phone
    }))
  }).countable;
}

export async function getPresenceReport(params = {}, auth) {
  assertGeneralAdminOrManager(auth);
  const range = resolvePresenceRange(params);
  const profiles = await listVisibleTeamProfiles(auth);
  const ids = profiles.map((profile) => profile.id);
  const publicRange = { period: range.period, startDate: range.startDate, endDate: range.endDate };
  if (!ids.length) return { ready: true, range: publicRange, members: [] };

  let activityRows;
  try {
    activityRows = await fetchAllRows((from, to) => db()
      .from("admin_presence_activity")
      .select("user_id, minute_at, kind")
      .in("user_id", ids)
      .gte("minute_at", range.startIso)
      .lt("minute_at", range.endIso)
      .order("minute_at", { ascending: true })
      .range(from, to));
  } catch (error) {
    if (isMissingTableError(error)) return { ready: false, range: publicRange, members: [] };
    throw error;
  }

  // Contatos realizados na Meta Diária no período (cruzamento com atividade
  // real: horas online sem contato nenhum é um sinal importante). Falha nesta
  // busca NÃO vira "0 contatos": o relatório sai com contactsAvailable=false
  // e a tela mostra o aviso (antes um catch vazio devolvia lista vazia).
  let attemptRows = null;
  try {
    attemptRows = await loadCountableAttempts(ids, range);
  } catch (error) {
    console.error("Horas no CRM: falha ao carregar os contatos da Meta Diária:", error?.message || error);
  }

  const members = buildPresenceReportMembers(profiles, activityRows, attemptRows, Date.now());
  return { ready: true, range: publicRange, contactsAvailable: attemptRows !== null, members };
}

// Sessões do dia de UM integrante (entrou/saiu e aparelho) para o painel Online. Mesmo escopo de getTeamPresence:
// admin geral vê todos, gestor só a equipe; fora disso, erro (sem dado).
export async function getMemberPresenceHistory(auth, userId, { date = "" } = {}) {
  assertGeneralAdminOrManager(auth);
  const profiles = await listVisibleTeamProfiles(auth);
  if (!profiles.some((profile) => profile.id === userId)) throw new Error("Integrante fora da sua equipe.");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getTodayInSaoPaulo();
  const from = zonedPlainDateToUtcIso(day);
  const to = zonedPlainDateToUtcIso(addDaysToPlainDate(day, 1));
  let { data, error } = await db()
    .from("admin_presence_activity")
    .select("minute_at, kind, device")
    .eq("user_id", userId)
    .gte("minute_at", from)
    .lt("minute_at", to)
    .order("minute_at", { ascending: true })
    .limit(2000);
  if (error && /device/i.test(error.message || "")) {
    ({ data, error } = await db().from("admin_presence_activity").select("minute_at, kind").eq("user_id", userId).gte("minute_at", from).lt("minute_at", to).order("minute_at", { ascending: true }).limit(2000));
  }
  if (error) throw error;
  return { date: day, sessions: buildPresenceSessions(data || []) };
}

// Ícones de WhatsApp por integrante (painel Online). Falha na leitura não derruba o painel: mostra um ícone cinza.
async function loadWhatsappIconsByUser(ids) {
  const result = new Map();
  try {
    // whatsapp_number_activity (SQL): status + se o número está ATIVO (ROL-2e: menos de 4 h sem mensagem entre 8h e 21h).
    let { data, error } = await db().rpc("whatsapp_number_activity", { p_user_ids: ids });
    if (error) ({ data, error } = await db().from("whatsapp_individual_sessions").select("user_id, slot, status").in("user_id", ids));
    if (error) throw error;
    const rowsByUser = new Map();
    for (const row of data || []) {
      if (!rowsByUser.has(row.user_id)) rowsByUser.set(row.user_id, []);
      rowsByUser.get(row.user_id).push(row);
    }
    for (const id of ids) result.set(id, whatsappPresenceIcons(rowsByUser.get(id) || []));
  } catch (error) {
    console.warn("Status do WhatsApp indisponível no painel Online:", error?.message || error);
  }
  return result;
}

// Histórico de conexão do WhatsApp de UM integrante num dia (clique no ícone do WhatsApp). Mesmo escopo do painel.
export async function getMemberWhatsappHistory(auth, userId, { date = "" } = {}) {
  assertGeneralAdminOrManager(auth);
  const profiles = await listVisibleTeamProfiles(auth);
  if (!profiles.some((profile) => profile.id === userId)) throw new Error("Integrante fora da sua equipe.");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getTodayInSaoPaulo();
  const from = zonedPlainDateToUtcIso(day);
  const to = zonedPlainDateToUtcIso(addDaysToPlainDate(day, 1));
  const [{ data: dayRows, error }, { data: sessions, error: sessionsError }] = await Promise.all([
    db().from("whatsapp_session_telemetry").select("session_slot, event_type, occurred_at")
      .eq("user_id", userId).in("event_type", ["connected", "disconnected"]).gte("occurred_at", from).lt("occurred_at", to)
      .order("occurred_at", { ascending: true }).limit(2000),
    db().from("whatsapp_individual_sessions").select("slot, label").eq("user_id", userId)
  ]);
  if (error) throw error;
  if (sessionsError) throw sessionsError;
  // Estado de cada número no início do dia = último evento antes dele.
  const initialBySlot = {};
  for (const slot of [1, 2]) {
    const { data: before } = await db().from("whatsapp_session_telemetry").select("event_type")
      .eq("user_id", userId).eq("session_slot", slot).in("event_type", ["connected", "disconnected"]).lt("occurred_at", from)
      .order("occurred_at", { ascending: false }).limit(1);
    if (before?.[0]?.event_type === "connected") initialBySlot[slot] = true;
  }
  const events = (dayRows || []).map((row) => ({ slot: row.session_slot || 1, type: row.event_type, ms: new Date(row.occurred_at).getTime() }));
  const periods = buildWhatsappConnectionPeriods(events, {
    dayStartMs: new Date(from).getTime(), dayEndMs: new Date(to).getTime(), nowMs: Date.now(), initialBySlot
  });
  const labels = Object.fromEntries((sessions || []).map((row) => [row.slot || 1, row.label || ""]));
  return { date: day, periods, labels };
}
