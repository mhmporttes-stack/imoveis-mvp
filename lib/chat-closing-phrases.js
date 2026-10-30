import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { defaultClosingConfig, resolveClosingConfig, sanitizePhraseList } from "./chat-closing-message-core.mjs";

// Lista editável da aba "Sem resposta" (WA-38). Uma linha em chat_closing_phrases (migration 20261030170000).
// Sem a tabela ou sem linha salva: lista padrão do código. Cache curto: a aba e o contador consultam a cada resumo.
const TABLE = "chat_closing_phrases";
const CACHE_MS = 60_000;
let cache = null;

export class ClosingPhrasesError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function isMissingTable(error) {
  return error && (error.code === "42P01" || error.code === "PGRST205");
}

async function readRow() {
  const { data, error } = await getSupabaseAdminClient().from(TABLE).select("closing, negative, updated_at").eq("id", "default").maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { row: null, ready: false };
    throw error;
  }
  return { row: data || null, ready: true };
}

// Config para o classificador (servidor do Chat). Falha de leitura = lista padrão + log (nunca derruba a lista do Chat).
export async function getClosingConfig() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.config;
  try {
    const { row } = await readRow();
    const config = row ? resolveClosingConfig(row) : defaultClosingConfig();
    cache = { at: Date.now(), config };
    return config;
  } catch (error) {
    console.error("[chat-closing-phrases] leitura falhou, usando a lista padrão:", error?.message || error);
    return defaultClosingConfig();
  }
}

// Tela de configuração (admin/gestor).
export async function loadClosingPhrasesSettings(auth) {
  assertGeneralAdminOrManager(auth);
  const { row, ready } = await readRow();
  const config = row ? resolveClosingConfig(row) : defaultClosingConfig();
  return { ...config, defaults: defaultClosingConfig(), customized: Boolean(row), ready, updatedAt: row?.updated_at || null };
}

export async function saveClosingPhrasesSettings(auth, { closing, negative, reset = false } = {}) {
  assertGeneralAdminOrManager(auth);
  const supabase = getSupabaseAdminClient();
  if (reset) {
    const { error } = await supabase.from(TABLE).delete().eq("id", "default");
    if (error) {
      if (isMissingTable(error)) throw new ClosingPhrasesError("Falta aplicar a migration 20261030170000_chat_closing_phrases no banco.", 503);
      throw error;
    }
  } else {
    const row = { id: "default", closing: sanitizePhraseList(closing), negative: sanitizePhraseList(negative), updated_by: auth?.profile?.id || null, updated_at: new Date().toISOString() };
    const { error } = await supabase.from(TABLE).upsert(row, { onConflict: "id" });
    if (error) {
      if (isMissingTable(error)) throw new ClosingPhrasesError("Falta aplicar a migration 20261030170000_chat_closing_phrases no banco.", 503);
      throw error;
    }
  }
  cache = null;
  return loadClosingPhrasesSettings(auth);
}
