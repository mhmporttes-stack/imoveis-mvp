import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { CONNECT_EVENT_TYPES, CONNECT_EVENTS_MAX_ROWS, LEGACY_TELEMETRY_EVENT_TYPES, connectEventsWindowMs, sanitizeTelemetryBatch, toConnectEvent } from "./whatsapp-session-telemetry-core.mjs";

// Persistência da telemetria de conexão do WhatsApp individual
// (whatsapp_session_telemetry, append-only). Só REGISTRO: nenhuma decisão do
// CRM depende desta tabela. Chamada apenas pela rota do microsserviço
// (X-Service-Secret). Erro de banco sobe para a rota, que responde 500 — o
// microsserviço trata como best-effort e nunca derruba a sessão por isso.
export async function recordSessionTelemetry(events) {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  const { rows, rejected } = sanitizeTelemetryBatch(events);
  if (!rows.length) return { inserted: 0, rejected };
  const { error } = await client.from("whatsapp_session_telemetry").insert(rows);
  if (error) {
    // CHECK antigo (migration 20261004213000 ainda não aplicada) recusa o lote inteiro por causa de um
    // tipo novo (lease/reconciliação). Grava só os tipos antigos e deixa o aviso explícito no log —
    // o lote nunca é perdido por inteiro e nada é descartado sem aviso.
    if (error.code === "23514") {
      const legacy = rows.filter((row) => LEGACY_TELEMETRY_EVENT_TYPES.includes(row.event_type));
      console.warn(`Telemetria: CHECK de event_type desatualizado (aplicar a migration 20261004213000); ${rows.length - legacy.length} evento(s) de lease/reconciliação não gravado(s).`);
      if (!legacy.length) return { inserted: 0, rejected: rejected + rows.length };
      const retry = await client.from("whatsapp_session_telemetry").insert(legacy);
      if (retry.error) throw retry.error;
      return { inserted: legacy.length, rejected: rejected + (rows.length - legacy.length) };
    }
    throw error;
  }
  return { inserted: rows.length, rejected };
}

// Tentativas, conexões e quedas RECENTES de UM número (corretor + slot), em ordem cronológica. Alimenta o limite de
// tentativas depois de um 403 (dono, 2026-10-13): o microsserviço pergunta aqui, com o segredo dele, antes de abrir uma
// conexão nova e decide com reconnect-policy.js — a contagem vem do que já está gravado, nunca da memória do serviço.
// Mais recentes primeiro no banco (teto de linhas nunca corta o fim da janela) e invertido na saída. Só leitura.
export async function listRecentConnectEvents(userId, slot = 1, { windowMs } = {}) {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  const since = new Date(Date.now() - connectEventsWindowMs(windowMs)).toISOString();
  const { data, error } = await client
    .from("whatsapp_session_telemetry")
    .select("event_type, status_code, trigger, occurred_at")
    .eq("user_id", userId)
    .eq("session_slot", slot)
    .in("event_type", CONNECT_EVENT_TYPES)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(CONNECT_EVENTS_MAX_ROWS);
  if (error) throw error;
  return (data || []).map(toConnectEvent).reverse();
}
