import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { OFFICIAL_WHATSAPP_DIGITS } from "./official-whatsapp.mjs";
import { listIndividualSessionRowsByUser, sendIndividualMessage } from "./whatsapp-individual";
import { aggregateSessionStatus } from "./whatsapp-session-slots.mjs";
import { lastOfficialInboundAt, listUserPhones, sendOfficialAlert } from "./official-alert";
import {
  KEEPALIVE_KEY_PREFIX, KEEPALIVE_RESEND_TEXT, KEEPALIVE_STATES, KEEPALIVE_TEXT, decideKeepaliveVerify, keepaliveKey, planKeepaliveRun, saoPauloDay
} from "./official-window-keepalive-core.mjs";

// ROTINA DAS 08:00 (dono, 2026-11-10; BUSINESS_RULES WA-40). Regras puras em lib/official-window-keepalive-core.mjs.
// Cron `official-window-keepalive` (a cada 2 min das 08:00 às 08:40 — SQL em docs/WHATSAPP.md §WA-40): (1) envia pelo número
// PESSOAL de cada corretor ativo com WhatsApp conectado "Bom dia, já estou disponível para atender" ao Oficial, uma vez por
// dia/corretor; (2) ~10 min depois CONFERE se chegou ao Oficial; não chegou → reenvia "👋" (até 2x); ainda falhando → alerta o dono.
// Estado por corretor/dia em crm_settings (`official_keepalive:<dia>:<usuário>`, sem migration); o INSERT da chave é a reserva
// (o índice único impede o 2º envio). Nunca envia com a sessão não conectada.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

async function loadDayRows(day) {
  const { data, error } = await db().from("crm_settings").select("id, setting_value, updated_at").like("id", `${KEEPALIVE_KEY_PREFIX}${day}:%`);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.id.slice(`${KEEPALIVE_KEY_PREFIX}${day}:`.length), row.setting_value || {}]));
}

async function saveRow(day, userId, value, previousState = null) {
  let query = db().from("crm_settings").update({ setting_value: value, updated_at: nowIso() }).eq("id", keepaliveKey(day, userId));
  if (previousState) query = query.eq("setting_value->>state", previousState);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return Boolean(data?.length);
}

async function claimRow(day, userId, value) {
  const { error } = await db().from("crm_settings").insert({ id: keepaliveKey(day, userId), setting_value: value, updated_at: nowIso() });
  if (error?.code === "23505") return false;
  if (error) throw error;
  return true;
}

async function loadUsers() {
  const { data, error } = await db().from("admin_users").select("id, name, role, status, phone, email").in("role", ["admin", "manager", "broker", "associate"]).eq("status", "active");
  if (error) throw error;
  const rowsByUser = await listIndividualSessionRowsByUser((data || []).map((user) => user.id));
  return (data || []).map((user) => {
    const rows = rowsByUser.get(user.id) || [];
    const connected = rows.find((row) => row.status === "connected");
    return { ...user, sessionStatus: aggregateSessionStatus(rows) || "", slot: connected?.slot || 1 };
  });
}

async function alertOwner(text, title) {
  const { listAdminProfiles, isOwnerAdminEmail } = await import("./admin-profiles");
  const owner = (await listAdminProfiles()).find((profile) => isOwnerAdminEmail(profile.email) && profile.status === "active");
  if (!owner?.id) return console.error("Bom dia das 08:00: dono não encontrado para o alerta.");
  await sendOfficialAlert({ userId: owner.id, text, push: { title, body: text.slice(0, 120), url: "/admin/automacoes?tab=fluxo-oficial" } });
}

export async function runOfficialWindowKeepalive({ now = new Date(), rng = Math.random } = {}) {
  const day = saoPauloDay(now);
  const users = await loadUsers();
  const dayRows = await loadDayRows(day);
  const result = { day, sent: 0, confirmed: 0, resent: 0, failed: 0, skipped: [], errors: [] };

  const candidates = users.map((user) => ({ userId: user.id, user, sessionStatus: user.sessionStatus, claimedToday: dayRows.has(user.id), userPhones: [user.phone] }));
  const plan = planKeepaliveRun({ candidates, now, officialDigits: OFFICIAL_WHATSAPP_DIGITS, rng });
  if (plan.reason !== "ok") return { ...result, skipped: plan.reason };
  result.skipped = plan.skipped;

  // 1) envio (uma vez por dia/corretor; reserva = INSERT da chave)
  for (const item of plan.send) {
    const user = users.find((entry) => entry.id === item.userId);
    if (item.delayMs) await sleep(item.delayMs);
    try {
      if (!(await claimRow(day, user.id, { state: "claiming", userId: user.id, name: user.name, claimedAt: nowIso() }))) continue;
      try {
        await sendIndividualMessage(user.id, { to: OFFICIAL_WHATSAPP_DIGITS, text: KEEPALIVE_TEXT, slot: user.slot });
        await saveRow(day, user.id, { state: KEEPALIVE_STATES.sent, userId: user.id, name: user.name, sentAt: nowIso(), lastAttemptAt: nowIso(), resendCount: 0, slot: user.slot });
        result.sent += 1;
      } catch (sendError) {
        // Falha no 1º envio: fica registrada (nunca reenviada às cegas — resultado pode ser desconhecido) e entra no alerta ao dono.
        await saveRow(day, user.id, { state: KEEPALIVE_STATES.failed, userId: user.id, name: user.name, failedAt: nowIso(), error: String(sendError?.message || sendError).slice(0, 200), slot: user.slot });
        result.failed += 1;
        result.errors.push({ userId: user.id, error: String(sendError?.message || sendError).slice(0, 120) });
        console.warn("Bom dia das 08:00: envio falhou:", user.id, sendError?.message || sendError);
      }
    } catch (error) {
      result.errors.push({ userId: item.userId, error: String(error?.message || error).slice(0, 120) });
      console.error("Bom dia das 08:00: falha ao processar o corretor:", error?.message || error);
    }
  }

  // 2) conferência: chegou ao Oficial? senão "👋" (até 2x); ainda falhando → alerta o dono.
  const verifyRows = await loadDayRows(day);
  for (const [userId, row] of verifyRows) {
    if (row.state !== KEEPALIVE_STATES.sent && row.state !== KEEPALIVE_STATES.resent) continue;
    try {
      const phones = await listUserPhones(userId);
      const lastInbound = phones.length ? await lastOfficialInboundAt(phones) : null;
      const confirmed = Boolean(lastInbound) && new Date(lastInbound).getTime() >= new Date(row.sentAt).getTime() - 2 * 60 * 1000;
      const decision = decideKeepaliveVerify({ row, confirmed, now });
      if (decision.action === "confirm") {
        if (await saveRow(day, userId, { ...row, state: KEEPALIVE_STATES.confirmed, confirmedAt: nowIso() }, row.state)) result.confirmed += 1;
      } else if (decision.action === "resend") {
        const user = users.find((entry) => entry.id === userId);
        if (user?.sessionStatus !== "connected") continue; // nunca envia com a sessão não conectada
        const reserved = await saveRow(day, userId, { ...row, state: KEEPALIVE_STATES.resent, resendCount: (row.resendCount || 0) + 1, lastAttemptAt: nowIso() }, row.state);
        if (!reserved) continue;
        try {
          await sendIndividualMessage(userId, { to: OFFICIAL_WHATSAPP_DIGITS, text: KEEPALIVE_RESEND_TEXT, slot: row.slot || user.slot });
          result.resent += 1;
        } catch (resendError) {
          result.errors.push({ userId, error: String(resendError?.message || resendError).slice(0, 120) });
          console.warn("Bom dia das 08:00: reenvio falhou:", userId, resendError?.message || resendError);
        }
      } else if (decision.action === "fail") {
        if (await saveRow(day, userId, { ...row, state: KEEPALIVE_STATES.failed, failedAt: nowIso(), error: "nao_chegou_ao_oficial" }, row.state)) {
          result.failed += 1;
          await alertOwner(`A mensagem de bom dia de ${row.name || "um corretor"} não chegou ao número oficial depois de 2 reenvios. A janela de 24 h dele pode estar fechada.`, "Bom dia das 08:00 não chegou");
        }
      }
    } catch (error) {
      result.errors.push({ userId, error: String(error?.message || error).slice(0, 120) });
      console.error("Bom dia das 08:00: falha na conferência:", error?.message || error);
    }
  }
  // limpeza: estados com mais de 7 dias
  const { error: cleanError } = await db().from("crm_settings").delete().like("id", `${KEEPALIVE_KEY_PREFIX}%`).lt("updated_at", new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
  if (cleanError) console.warn("Bom dia das 08:00: falha na limpeza dos estados antigos:", cleanError.message || cleanError);
  return result;
}

/** Tela de configuração: lista "Bom dia de hoje" (estado por corretor). */
export async function listKeepaliveToday(now = new Date()) {
  const day = saoPauloDay(now);
  const rows = await loadDayRows(day);
  return { day, items: [...rows].map(([userId, row]) => ({ userId, name: row.name || "", state: row.state, sentAt: row.sentAt || null, confirmedAt: row.confirmedAt || null, resendCount: row.resendCount || 0, error: row.error || "" })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) };
}
