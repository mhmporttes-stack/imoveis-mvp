import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { speakAlexa } from "./alexa-voice";
import { claimSpeakingSlot, loadAlexaSettings } from "./alexa-service";
import { evaluateRoutineSpeak, saoPauloDateKey, saoPauloNow } from "./alexa-config-core.mjs";
import { arrivalCoversToday, briefingInputFromInicio, composeFirstAccessBriefing } from "./alexa-bom-dia-core.mjs";
import { getPainelInicio } from "./painel-inicio";
import { firstAccessUserKey, recordFirstAccessAlexa } from "./primeiro-acesso";

// "Bom dia no primeiro acesso" (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md INI-4). Disparado pelo SERVIDOR
// (app/api/admin/primeiro-acesso, depois da resposta) no primeiro acesso do dia do dono. Mesmas travas de toda fala
// espontânea: Alexa ativa, rotina "first_access" ligada, "Quando pode falar" (global e da rotina) e intervalo mínimo
// (claimSpeakingSlot). Números: getPainelInicio — a MESMA fonte da tela Início. Nunca lança; logs só com motivo.

const ROUTINE = "first_access";

async function readArrivalCovered(today) {
  try {
    const { data } = await getSupabaseAdminClient()
      .from("alexa_arrival_state")
      .select("last_arrival_date, pending_run_at, last_run_at, last_run_status")
      .eq("id", 1)
      .maybeSingle();
    return arrivalCoversToday(data, today);
  } catch {
    return false;
  }
}

// ignoreArrival: prévia/teste do painel montam sempre o resumo completo.
export async function buildFirstAccessBriefing(auth, { now = new Date(), ignoreArrival = false } = {}) {
  const [inicio, arrivalCovered] = await Promise.all([
    getPainelInicio(auth),
    ignoreArrival ? false : readArrivalCovered(saoPauloDateKey(now))
  ]);
  return composeFirstAccessBriefing(briefingInputFromInicio(inicio, { minutesOfDay: saoPauloNow(now).minutes, arrivalCovered }));
}

export async function announceFirstAccessBriefing(auth, day) {
  const userKey = firstAccessUserKey(auth);
  const finish = async (reason) => {
    if (reason !== "ok") console.info(`[alexa-bom-dia] fala ignorada: ${reason}.`);
    await recordFirstAccessAlexa(userKey, day, reason);
    return { spoken: reason === "ok", reason };
  };
  try {
    const { settings } = await loadAlexaSettings();
    const decision = evaluateRoutineSpeak({ settings, routineKey: ROUTINE });
    if (!decision.allow) return finish(decision.reason);
    const text = await buildFirstAccessBriefing(auth);
    if (!text) return finish("frase_invalida");
    if (!(await claimSpeakingSlot(settings))) return finish("intervalo_minimo");
    const result = await speakAlexa(text);
    return finish(result?.ok ? "ok" : result?.reason || "falha_envio");
  } catch (error) {
    console.warn(`[alexa-bom-dia] erro inesperado: ${error?.name || "erro"}.`);
    return finish("erro");
  }
}

// "Testar bom dia" (/admin/alexa): fala agora, ignorando o 1x/dia, a janela e o intervalo — ação manual do administrador.
export async function testFirstAccessBriefing(auth, { speak = false } = {}) {
  const text = await buildFirstAccessBriefing(auth, { ignoreArrival: true });
  if (!text) return { ok: false, error: "Não foi possível montar o bom dia sem dados sensíveis." };
  if (!speak) return { ok: true, text };
  const result = await speakAlexa(text);
  if (result?.ok) return { ok: true, text };
  if (result?.skipped) return { ok: false, text, error: `A Alexa não está configurada no servidor (${result.reason}).` };
  return { ok: false, text, error: "Não foi possível falar na Alexa agora." };
}
