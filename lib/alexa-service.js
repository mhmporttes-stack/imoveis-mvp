import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { speakAlexa } from "./alexa-voice";
import {
  containsSensitiveContent,
  evaluateSpeak,
  firstName,
  getDefaultAlexaSettings,
  intervalCutoffIso,
  MAX_PHRASE_LENGTH,
  normalizeAlexaSettings,
  renderAlexaPhrase,
  validateAlexaSettingsInput
} from "./alexa-config-core.mjs";

// Serviço ÚNICO da Alexa: toda fala espontânea do CRM passa por
// announceAlexaEvent(). Ele valida (Alexa ativa, evento ativo, dia/horário,
// intervalo mínimo), monta a frase e só então chama o Voice Monkey
// (lib/alexa-voice.js). Nunca lança erro nem bloqueia quem chamou.
// Os logs trazem só o evento e o motivo — nunca a frase, token ou dispositivo.

const TABLE = "alexa_settings";

// Se a tabela não existir ainda (migration pendente) ou o banco falhar, cai nos
// defaults, que mantêm o comportamento anterior (só "Novo cliente" fala).
export async function loadAlexaSettings() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return { settings: getDefaultAlexaSettings(), meta: { lastSpokenAt: null, updatedAt: null } };
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", 1).maybeSingle();
  if (error) {
    console.warn(`[alexa] não foi possível ler a configuração (${error.code || "erro"}); usando padrão.`);
    return { settings: getDefaultAlexaSettings(), meta: { lastSpokenAt: null, updatedAt: null } };
  }
  return {
    settings: normalizeAlexaSettings(data),
    meta: { lastSpokenAt: data?.last_spoken_at || null, updatedAt: data?.updated_at || null }
  };
}

export async function saveAlexaSettings(input, userId = null) {
  const settings = validateAlexaSettingsInput(input);
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Banco de dados indisponível.");
  const { error } = await supabase.from(TABLE).upsert(
    {
      id: 1,
      enabled: settings.enabled,
      allowed_weekdays: settings.allowedWeekdays,
      start_time: settings.startTime,
      end_time: settings.endTime,
      min_interval_seconds: settings.minIntervalSeconds,
      events: settings.events,
      updated_by: userId || null,
      updated_at: new Date().toISOString()
    },
    { onConflict: "id" }
  );
  if (error) throw new Error("Não foi possível salvar a configuração da Alexa.");
  return settings;
}

// Só booleanos: nunca devolve o valor das credenciais.
export function getAlexaEnvStatus() {
  return {
    voiceEnabledEnv: process.env.ALEXA_VOICE_ENABLED === "true",
    tokenConfigured: Boolean(process.env.VOICEMONKEY_TOKEN),
    deviceConfigured: Boolean(process.env.VOICEMONKEY_DEVICE)
  };
}

async function brokerFirstName(userId) {
  if (!userId) return "";
  try {
    const { data } = await getSupabaseAdminClient().from("admin_users").select("name").eq("id", userId).maybeSingle();
    return firstName(data?.name);
  } catch {
    return "";
  }
}

// Reserva a vez de falar: atualiza last_spoken_at só se já passou o intervalo
// mínimo. É atômico no banco, então vale entre várias execuções simultâneas.
async function claimSpeakingSlot(settings) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return true;
  const now = new Date();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ last_spoken_at: now.toISOString() })
    .eq("id", 1)
    .or(`last_spoken_at.is.null,last_spoken_at.lte.${intervalCutoffIso(settings, now)}`)
    .select("id");
  if (error) return true; // sem a tabela/coluna não há como medir; não silencia a Alexa
  return Boolean(data?.length);
}

// values: { clienteNome, responsibleUserId, corretorNome, quantidade, minutos }
export async function announceAlexaEvent(eventKey, values = {}) {
  try {
    const { settings } = await loadAlexaSettings();
    const decision = evaluateSpeak({ settings, eventKey });
    if (!decision.allow) {
      console.info(`[alexa] fala ignorada (evento=${eventKey}): ${decision.reason}.`);
      return { spoken: false, reason: decision.reason };
    }

    const eventConfig = settings.events[eventKey];
    const phrase = renderAlexaPhrase(eventKey, eventConfig.phrase, {
      cliente: firstName(values.clienteNome),
      corretor: firstName(values.corretorNome) || (await brokerFirstName(values.responsibleUserId)),
      quantidade: values.quantidade,
      minutos: values.minutos ?? eventConfig.leadMinutes ?? eventConfig.minWaitMinutes
    });
    if (!phrase) {
      console.warn(`[alexa] fala ignorada (evento=${eventKey}): frase_vazia_ou_sensivel.`);
      return { spoken: false, reason: "frase_invalida" };
    }

    if (!(await claimSpeakingSlot(settings))) {
      console.info(`[alexa] fala ignorada (evento=${eventKey}): intervalo_minimo.`);
      return { spoken: false, reason: "intervalo_minimo" };
    }

    const result = await speakAlexa(phrase);
    return { spoken: Boolean(result?.ok), reason: result?.ok ? "ok" : result?.reason || "falha_envio" };
  } catch (error) {
    console.warn(`[alexa] erro inesperado (evento=${eventKey}): ${error?.name || "erro"}.`);
    return { spoken: false, reason: "erro" };
  }
}

// "Testar Alexa": fala a frase na hora, ignorando liga/desliga, horário e
// intervalo (é uma ação manual do administrador), mas ainda barrando dados
// sensíveis e frases enormes.
export async function testAlexaPhrase(rawPhrase) {
  const phrase = String(rawPhrase ?? "").replace(/\s+/g, " ").trim();
  if (!phrase) return { ok: false, error: "Escreva uma frase para testar." };
  if (phrase.length > MAX_PHRASE_LENGTH) return { ok: false, error: `A frase pode ter no máximo ${MAX_PHRASE_LENGTH} caracteres.` };
  if (containsSensitiveContent(phrase)) return { ok: false, error: "A frase não pode conter CPF, renda, valores ou outros dados sensíveis." };

  const result = await speakAlexa(phrase);
  if (result?.ok) return { ok: true };
  if (result?.skipped) return { ok: false, error: `A Alexa não está configurada no servidor (${result.reason}).` };
  return { ok: false, error: result?.status ? `O Voice Monkey recusou o envio (HTTP ${result.status}).` : "Não foi possível falar na Alexa agora." };
}
