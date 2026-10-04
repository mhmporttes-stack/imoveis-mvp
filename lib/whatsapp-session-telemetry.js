import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { sanitizeTelemetryBatch } from "./whatsapp-session-telemetry-core.mjs";

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
  if (error) throw error;
  return { inserted: rows.length, rejected };
}
