import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { LEASE_SERVICE_ID, isLeaseUnavailableError, normalizeLeaseResult } from "./whatsapp-service-lease-core.mjs";

// Persistência do lease do whatsapp-individual-service (tabela whatsapp_service_lease, funções SQL
// atômicas da migration 20261004213000). Só a rota do microsserviço chama (X-Service-Secret).
// Erro "tabela/função não existe" vira { unavailable: true } — o serviço segue sem lease (aviso no log dele).

const FUNCTION_BY_ACTION = Object.freeze({
  acquire: "whatsapp_service_lease_acquire",
  renew: "whatsapp_service_lease_renew",
  release: "whatsapp_service_lease_release"
});

export async function runLeaseAction({ action, bootId, deployId, ttlSeconds }) {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  const args = { p_id: LEASE_SERVICE_ID, p_boot_id: bootId };
  if (action === "acquire") { args.p_deploy_id = deployId; args.p_ttl_seconds = ttlSeconds; }
  if (action === "renew") args.p_ttl_seconds = ttlSeconds;
  const { data, error } = await client.rpc(FUNCTION_BY_ACTION[action], args);
  if (error) {
    if (isLeaseUnavailableError(error)) return { unavailable: true, reason: "lease_table_missing" };
    throw error;
  }
  return { unavailable: false, result: normalizeLeaseResult(action, data) };
}
