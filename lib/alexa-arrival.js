import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getSupabaseAdminClient } from "./supabase";
import { speakAlexa } from "./alexa-voice";
import { claimSpeakingSlot, loadAlexaSettings } from "./alexa-service";
import {
  composeArrivalSummary,
  containsSensitiveContent,
  evaluateRoutineSpeak,
  firstName,
  isRoutineWindowOpen,
  saoPauloDateKey,
  saoPauloNow
} from "./alexa-config-core.mjs";
import { CLIENT_STATUS } from "./client-status";
import { listCalendarActivities } from "./calendar-activities";
import { getOwnerTeamDailyOverview } from "./daily-goal";

// Rotina "Chegada ao escritório": o iPhone avisa (Atalhos → HTTP) que
// conectou no Wi-Fi; 3 minutos depois (configurável) o cron que já roda a
// cada minuto monta um resumo do CRM e a Alexa fala. No máximo 1 por dia
// (data de São Paulo) — sem depender de evento de saída. Logs só com motivo.

const STATE = "alexa_arrival_state";
const ROUTINE = "arrival";
const STALE_PENDING_MS = 60 * 60 * 1000; // execução vencida há mais de 1h é descartada

function db() {
  return getSupabaseAdminClient();
}

function hashToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

// Gera a chave do iPhone. Só o hash é guardado; a chave é devolvida UMA vez.
export async function generateArrivalToken(userId) {
  const token = `alx_${randomBytes(24).toString("hex")}`;
  const { error } = await db()
    .from(STATE)
    .upsert(
      {
        id: 1,
        token_hash: hashToken(token),
        token_created_at: new Date().toISOString(),
        owner_user_id: userId || null,
        pending_run_at: null,
        updated_at: new Date().toISOString()
      },
      { onConflict: "id" }
    );
  if (error) throw new Error("Não foi possível gerar a chave. A migration da rotina foi aplicada?");
  return token;
}

export async function getArrivalStatus() {
  const { data, error } = await db().from(STATE).select("*").eq("id", 1).maybeSingle();
  if (error || !data) return { ready: false, tokenConfigured: false };
  return {
    ready: true,
    tokenConfigured: Boolean(data.token_hash),
    tokenCreatedAt: data.token_created_at,
    lastPingAt: data.last_ping_at,
    lastArrivalDate: data.last_arrival_date,
    pendingRunAt: data.pending_run_at,
    lastRunAt: data.last_run_at,
    lastRunStatus: data.last_run_status || ""
  };
}

export async function verifyArrivalToken(token) {
  if (!token) return false;
  const { data } = await db().from(STATE).select("token_hash").eq("id", 1).maybeSingle();
  const stored = data?.token_hash || "";
  const supplied = hashToken(token);
  return stored.length === supplied.length && stored.length > 0 && timingSafeEqual(Buffer.from(stored), Buffer.from(supplied));
}

// Recebe "cheguei" do iPhone. Aceita no máximo 1 por dia e só dentro da janela
// da rotina; qualquer outra chamada é ignorada sem erro (Wi-Fi oscilando).
export async function registerArrival(now = new Date()) {
  const { settings } = await loadAlexaSettings();
  const routine = settings.routines[ROUTINE];
  await db().from(STATE).update({ last_ping_at: now.toISOString() }).eq("id", 1);

  if (!settings.enabled || !routine.enabled) return { accepted: false, reason: "rotina_inativa" };
  if (!isRoutineWindowOpen(routine, now)) return { accepted: false, reason: "fora_da_janela" };

  const today = saoPauloDateKey(now);
  const runAt = new Date(now.getTime() + routine.delayMinutes * 60 * 1000).toISOString();
  const { data, error } = await db()
    .from(STATE)
    .update({ last_arrival_date: today, pending_run_at: runAt, updated_at: now.toISOString() })
    .eq("id", 1)
    .or(`last_arrival_date.is.null,last_arrival_date.neq.${today}`)
    .select("id");
  if (error) throw error;
  if (!data?.length) return { accepted: false, reason: "ja_chegou_hoje" };
  return { accepted: true, runAt };
}

// --- Resumo ------------------------------------------------------------------
async function countByStatus(statuses) {
  const { count, error } = await db()
    .from("simulation_registrations")
    .select("id", { count: "exact", head: true })
    .in("status", statuses);
  if (error) throw error;
  return count || 0;
}

async function safe(label, task, fallback) {
  try {
    return await task();
  } catch {
    console.warn(`[alexa-arrival] não foi possível obter "${label}"; item omitido.`);
    return fallback;
  }
}

// Consulta o CRM só agora, reaproveitando as funções existentes. Cada bloco
// falha isoladamente (o item some do resumo, o resto continua).
export async function buildArrivalSummary(ownerUserId, now = new Date()) {
  const { data: owner } = await db().from("admin_users").select("id, name, email, role").eq("id", ownerUserId).maybeSingle();
  // Mesmo formato de auth das rotas de admin: dono/administrador geral.
  const auth = owner ? { ok: true, user: { email: owner.email }, profile: { id: owner.id, role: owner.role || "admin", email: owner.email } } : null;
  const today = saoPauloDateKey(now);
  const { minutes } = saoPauloNow(now);

  const [awaitingSimulation, documentsPending, awaitingApproval, agenda, goalDoneNames, salesToday] = await Promise.all([
    safe("aguardando simulação", () => countByStatus([CLIENT_STATUS.PENDING]), 0),
    safe("documentação pendente", () => countByStatus([CLIENT_STATUS.DOCUMENTATION, CLIENT_STATUS.DOCUMENTS_PENDING]), 0),
    safe("aguardando aprovação", () => countByStatus([CLIENT_STATUS.APPROVAL_PENDING]), 0),
    safe("agenda", async () => {
      if (!auth) return { count: 0, nextTime: null };
      const start = new Date(`${today}T00:00:00-03:00`).toISOString();
      const end = new Date(`${today}T23:59:59-03:00`).toISOString();
      const items = await listCalendarActivities({ from: start, to: end, auth, pendingOnly: true });
      const upcoming = items.find((item) => new Date(item.scheduledActivityAt) >= now);
      let nextTime = null;
      if (upcoming) {
        const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(upcoming.scheduledActivityAt));
        nextTime = { h: Number(parts.find((p) => p.type === "hour").value), m: Number(parts.find((p) => p.type === "minute").value) };
      }
      return { count: items.length, nextTime };
    }, { count: 0, nextTime: null }),
    safe("meta diária", async () => {
      if (!auth) return [];
      const overview = await getOwnerTeamDailyOverview({ period: "today" }, auth);
      return (overview.brokers || []).filter((broker) => broker.meta?.total > 0 && broker.meta.percent >= 100).map((broker) => firstName(broker.name));
    }, []),
    safe("vendas do dia", async () => {
      const { count, error } = await db().from("financial_sales").select("id", { count: "exact", head: true }).eq("sale_date", today);
      if (error) throw error;
      return count || 0;
    }, 0)
  ]);

  return composeArrivalSummary({
    name: firstName(owner?.name),
    minutesOfDay: minutes,
    agenda,
    awaitingSimulation,
    documentsPending,
    awaitingApproval,
    goalDoneNames,
    salesToday
  });
}

// Fala o resumo respeitando Alexa ativa, rotina ativa, dia/horário (global e da
// rotina) e intervalo mínimo. `force` (botão "Ouvir agora") ignora só essas
// travas de horário/liga-desliga: é uma ação manual do administrador.
export async function speakArrivalSummary(text, { force = false } = {}) {
  if (!text || containsSensitiveContent(text)) return { spoken: false, reason: "frase_invalida" };
  if (!force) {
    const { settings } = await loadAlexaSettings();
    const decision = evaluateRoutineSpeak({ settings, routineKey: ROUTINE });
    if (!decision.allow) {
      console.info(`[alexa-arrival] fala ignorada: ${decision.reason}.`);
      return { spoken: false, reason: decision.reason };
    }
    if (!(await claimSpeakingSlot(settings))) {
      console.info("[alexa-arrival] fala ignorada: intervalo_minimo.");
      return { spoken: false, reason: "intervalo_minimo" };
    }
  }
  const result = await speakAlexa(text);
  return { spoken: Boolean(result?.ok), reason: result?.ok ? "ok" : result?.reason || "falha_envio" };
}

// Chamado pelo cron que já roda a cada minuto. Nunca lança erro.
export async function processDueArrival(now = new Date()) {
  try {
    const nowIso = now.toISOString();
    const { data: row } = await db().from(STATE).select("owner_user_id, pending_run_at").eq("id", 1).maybeSingle();
    if (!row?.pending_run_at || new Date(row.pending_run_at) > now) return { ran: false };

    // Reserva a execução (só uma instância do cron consegue): limpa o pendente
    // comparando com o valor lido. Pendente parado há mais de 1h (cron fora do
    // ar) é descartado sem falar atrasado.
    const stale = now.getTime() - new Date(row.pending_run_at).getTime() > STALE_PENDING_MS;
    const { data: claimed, error } = await db()
      .from(STATE)
      .update({ pending_run_at: null, last_run_at: nowIso, last_run_status: stale ? "expirada" : "executando" })
      .eq("id", 1)
      .eq("pending_run_at", row.pending_run_at)
      .select("id");
    if (error || !claimed?.length || stale) return { ran: false };

    const owner = row.owner_user_id;
    const finish = (status) => db().from(STATE).update({ last_run_status: status }).eq("id", 1);

    const text = await buildArrivalSummary(owner, now);
    const result = await speakArrivalSummary(text);
    await finish(result.spoken ? "ok" : result.reason);
    return { ran: true, spoken: result.spoken };
  } catch (error) {
    console.warn(`[alexa-arrival] erro inesperado: ${error?.name || "erro"}.`);
    return { ran: false };
  }
}
