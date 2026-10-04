import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getTodayInSaoPaulo } from "./daily-report";
import { getOpenRestriction } from "./whatsapp-restriction";
import { getIndividualSessionStatusForUser } from "./whatsapp-individual";
import { buildCompensationNotice } from "./daily-goal-compensation-view-core.mjs";
import { evaluateDayImpact, resolveEffectiveWindow, safeGapMinutes, saoPauloDayBoundsMs, temporaryWindowEndFor } from "./daily-goal-window-core.mjs";

// Compensação da janela da Meta Diária por restrição VALIDADA do WhatsApp (REGRA OFICIAL — dono,
// 2026-10-02). Regras puras em lib/daily-goal-window-core.mjs; aqui só a LEITURA do banco. O crédito
// é calculado na leitura a partir de whatsapp_restrictions (validated_at/ended_at) — não há tabela
// de crédito paralela, então nunca fica defasado nem pode ser editado à mão.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Restrições VALIDADAS do corretor que tocam o dia `date` (AAAA-MM-DD, São Paulo).
export async function loadValidatedRestrictionsForDay(brokerId, date) {
  const { startMs, endMs } = saoPauloDayBoundsMs(date);
  const { data, error } = await db().from("whatsapp_restrictions")
    .select("validation_status, validated_at, ended_at")
    .eq("user_id", brokerId).eq("validation_status", "validated")
    .lt("validated_at", new Date(endMs).toISOString())
    .or(`ended_at.is.null,ended_at.gt.${new Date(startMs).toISOString()}`);
  if (error) throw error;
  return data || [];
}

// "Janela efetiva do dia": devolve uma CÓPIA da linha de daily_goal_auto_settings com
// window_end_minutes já estendido (base + crédito, teto 21:00) e os campos de apoio. É a ÚNICA
// forma de ler a janela do dia no envio (dispatcher, reparo da fila, trava final e agendamento).
// Idempotente (linha já efetiva volta como está). Sem linha ou sem restrição validada: igual à base.
export async function withEffectiveWindow(row, { date = getTodayInSaoPaulo(), nowMs = Date.now() } = {}) {
  if (!row || row._effectiveWindow) return row;
  const base = Number(row.window_end_minutes);
  const restrictions = await loadValidatedRestrictionsForDay(row.broker_id, date);
  const resolved = resolveEffectiveWindow({
    date, restrictions,
    windowStartMinutes: Number(row.window_start_minutes), windowEndMinutes: base,
    businessDaysOnly: row.business_days_only !== false, nowMs
  });
  return {
    ...row,
    window_end_minutes: Math.max(resolved.effectiveEndMinutes, temporaryWindowEndFor(date) ?? 0),
    base_window_end_minutes: base,
    window_credit_minutes: resolved.creditMinutes,
    window_cadence: resolved.cadence,
    _effectiveWindow: true
  };
}

// Fechamento do dia (closeDailyGoalDay): o dia ficou "impactado por restrição validada"?
// settingsRow pode ser nulo (corretor sem automação: usa a janela padrão do sistema).
export async function evaluateClosedDayImpact({ brokerId, day, goalMet, remaining }) {
  if (goalMet || !(remaining > 0)) return { impacted: false, impactMinutes: 0 };
  const { data: settingsRow, error: settingsError } = await db().from("daily_goal_auto_settings")
    .select("window_start_minutes, window_end_minutes, business_days_only, min_gap_minutes").eq("broker_id", brokerId).maybeSingle();
  if (settingsError) throw settingsError;
  const windowStart = Number(settingsRow?.window_start_minutes ?? 390);
  const windowEnd = Number(settingsRow?.window_end_minutes ?? 1140);
  const restrictions = await loadValidatedRestrictionsForDay(brokerId, day);
  if (!restrictions.length) return { impacted: false, impactMinutes: 0 };
  const resolved = resolveEffectiveWindow({
    date: day, restrictions, windowStartMinutes: windowStart, windowEndMinutes: windowEnd,
    businessDaysOnly: settingsRow?.business_days_only !== false, nowMs: Date.now()
  });
  return evaluateDayImpact({
    goalMet, remaining, windowStartMinutes: windowStart, baseEndMinutes: windowEnd,
    credit: resolved.credit, safeGapMin: safeGapMinutes(settingsRow)
  });
}

// Aviso de compensação para a tela do corretor (SOMENTE LEITURA, só apresentação): reaproveita
// resolveEffectiveWindow/evaluateDayImpact sem mudar cálculo nem regra. Nunca derruba a tela: erro -> null.
// `goal` = snapshot da Meta Diária de hoje (prospecting/pending/percent).
export async function getBrokerCompensationNotice(brokerId, goal) {
  try {
    const date = getTodayInSaoPaulo();
    const [openRestriction, sessionStatus, settingsResult] = await Promise.all([
      getOpenRestriction(brokerId),
      getIndividualSessionStatusForUser(brokerId),
      db().from("daily_goal_auto_settings")
        .select("window_start_minutes, window_end_minutes, business_days_only, min_gap_minutes").eq("broker_id", brokerId).maybeSingle()
    ]);
    if (settingsResult.error) throw settingsResult.error;
    const settingsRow = settingsResult.data;
    const restrictionStatus = openRestriction?.validation_status || null;
    const windowStart = Number(settingsRow?.window_start_minutes ?? 390);
    const windowEnd = Number(settingsRow?.window_end_minutes ?? 1140);
    const restrictions = await loadValidatedRestrictionsForDay(brokerId, date);
    if (!restrictions.length && restrictionStatus !== "validated") return null;
    const resolved = resolveEffectiveWindow({
      date, restrictions, windowStartMinutes: windowStart, windowEndMinutes: windowEnd,
      businessDaysOnly: settingsRow?.business_days_only !== false, nowMs: Date.now()
    });
    const goalComplete = Number(goal?.percent) >= 100;
    const remaining = Math.max(0, Number(goal?.prospecting?.target ?? goal?.quota ?? 0) - Number(goal?.prospecting?.done ?? goal?.realizedToday ?? 0))
      + Math.max(0, Number(goal?.pending?.remaining) || 0);
    const impact = evaluateDayImpact({
      goalMet: goalComplete, remaining, windowStartMinutes: windowStart, baseEndMinutes: windowEnd,
      credit: resolved.credit, safeGapMin: safeGapMinutes(settingsRow)
    });
    return buildCompensationNotice({
      restrictionStatus, sessionConnected: sessionStatus === "connected",
      baseStartMinutes: windowStart, baseEndMinutes: windowEnd,
      creditMinutes: resolved.creditMinutes, effectiveEndMinutes: resolved.effectiveEndMinutes,
      impacted: impact.impacted, goalComplete
    });
  } catch (error) {
    console.error("Falha ao montar o aviso de compensação da Meta Diária.", error?.message || error);
    return null;
  }
}
