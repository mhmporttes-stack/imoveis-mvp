import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { LEGACY_TELEMETRY_EVENT_TYPES, sanitizeTelemetryBatch } from "./whatsapp-session-telemetry-core.mjs";

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
