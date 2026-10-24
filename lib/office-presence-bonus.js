import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { addDaysToPlainDate, getTodayInSaoPaulo, zonedPlainDateToUtcIso } from "./daily-report";
import { loadOfficeAbsences } from "./office-presence";
import {
  OFFICE_BONUS_KINDS,
  OFFICE_BONUS_PARTICIPANT_ROLES,
  decideFirstArrival,
  decideLastDeparture,
  isOfficeBonusParticipant,
  officeBonusEntries
} from "./office-presence-bonus-core.mjs";

// Bônus "Primeiro a chegar" / "Último a sair" (REGRA OFICIAL — dono, 2026-10-23; docs/BUSINESS_RULES.md RAN-10).
// A DECISÃO é gravada uma vez por dia e tipo (office_presence_bonus_awards, chave primária award_date + kind,
// insert "on conflict do nothing") — nunca dá duas vezes, mesmo com o cron concorrente. Gravada porque o "último a
// sair" só existe depois que o dia acaba e uma ausência marcada depois não pode tirar pontos já dados. O Ranking e o
// Extrato leem essas linhas (loadOfficeBonusScoring) — os pontos não são recalculados por outro caminho.
// Roda no cron scheduled-activities (runOfficePresenceBonus): chegada assim que der para decidir (3 min depois da
// 1ª chegada); saída do dia anterior a partir das 03:00 (São Paulo). Sem aviso/push (AUT-9).

const AWARDS_TABLE = "office_presence_bonus_awards";
const LAST_DEPARTURE_FROM_HOUR = 3;

function db() {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase administrativo não configurado.");
  return getSupabaseAdminClient();
}

function isMissingAwardsTable(error) {
  return ["42P01", "PGRST205"].includes(error?.code) || String(error?.message || "").includes(AWARDS_TABLE);
}

async function loadParticipantIds() {
  const { data, error } = await db().from("admin_users").select("id, role, status").in("role", [...OFFICE_BONUS_PARTICIPANT_ROLES]).eq("status", "active");
  if (error) throw error;
  return new Set((data || []).filter(isOfficeBonusParticipant).map((row) => row.id));
}

async function awardExists(dateKey, kind) {
  const { data, error } = await db().from(AWARDS_TABLE).select("award_date").eq("award_date", dateKey).eq("kind", kind).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function loadDayCheckins(dateKey) {
  const { data, error } = await db()
    .from("office_presence_checkins")
    .select("user_id, source, first_seen_at, last_wifi_seen_at, valid_until")
    .eq("checkin_date", dateKey);
  if (error) throw error;
  return data || [];
}

// Decide e grava um tipo de bônus para um dia. Idempotente: já decidido = não faz nada.
export async function settleOfficeBonus(dateKey, kind, nowMs = Date.now()) {
  if (await awardExists(dateKey, kind)) return { dateKey, kind, status: "already" };
  const [checkins, participantIds] = await Promise.all([loadDayCheckins(dateKey), loadParticipantIds()]);
  const absencesByUser = await loadOfficeAbsences(checkins.map((row) => row.user_id).filter((id) => participantIds.has(id)));
  const decision = kind === OFFICE_BONUS_KINDS.FIRST_ARRIVAL
    ? decideFirstArrival({ checkins, participantIds, absencesByUser, nowMs })
    : decideLastDeparture({ checkins, participantIds, absencesByUser });
  if (!decision.ready) return { dateKey, kind, status: "waiting" };
  const { error } = await db()
    .from(AWARDS_TABLE)
    .upsert({ award_date: dateKey, kind, winners: decision.winners, decided_at: new Date(nowMs).toISOString() }, { onConflict: "award_date,kind", ignoreDuplicates: true });
  if (error) throw error;
  return { dateKey, kind, status: "awarded", winners: decision.winners };
}

function saoPauloHour(nowMs) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(new Date(nowMs)));
}

// Cron: chegada de hoje (e de ontem, se o cron ficou parado), saída de ontem depois das 03:00.
export async function runOfficePresenceBonus(nowMs = Date.now()) {
  const today = getTodayInSaoPaulo();
  const yesterday = addDaysToPlainDate(today, -1);
  const results = [];
  try {
    results.push(await settleOfficeBonus(today, OFFICE_BONUS_KINDS.FIRST_ARRIVAL, nowMs));
    results.push(await settleOfficeBonus(yesterday, OFFICE_BONUS_KINDS.FIRST_ARRIVAL, nowMs));
    if (saoPauloHour(nowMs) >= LAST_DEPARTURE_FROM_HOUR) results.push(await settleOfficeBonus(yesterday, OFFICE_BONUS_KINDS.LAST_DEPARTURE, nowMs));
  } catch (error) {
    if (isMissingAwardsTable(error)) return { skipped: "migration 20261023200000_bonus_primeiro_ultimo_imobiliaria pendente" };
    throw error;
  }
  return { results };
}

// Pontos do período para o Ranking e o Extrato (mesma leitura nos dois). Sem a tabela (migration pendente): nada.
export async function loadOfficeBonusScoring(supabase, range) {
  const result = { totalsByBroker: new Map(), byKind: new Map(), entries: [] };
  const { data, error } = await supabase
    .from(AWARDS_TABLE)
    .select("award_date, kind, winners")
    .gte("award_date", addDaysToPlainDate(range.startDate, -1))
    .lte("award_date", range.endDate);
  if (error) {
    if (isMissingAwardsTable(error)) return result;
    throw error;
  }
  const startMs = Date.parse(range.startIso || zonedPlainDateToUtcIso(range.startDate));
  const endMs = Date.parse(range.endIso || zonedPlainDateToUtcIso(addDaysToPlainDate(range.endDate, 1)));
  for (const entry of officeBonusEntries(data, { startMs, endMs })) {
    result.entries.push(entry);
    result.totalsByBroker.set(entry.brokerId, (result.totalsByBroker.get(entry.brokerId) || 0) + entry.points);
    const kinds = result.byKind.get(entry.brokerId) || {};
    kinds[entry.kind] = (kinds[entry.kind] || 0) + entry.points;
    result.byKind.set(entry.brokerId, kinds);
  }
  return result;
}
