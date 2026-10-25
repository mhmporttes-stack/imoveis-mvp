import { createInstance, verifyConnection, changeOperational } from "../../src/services/instances.js";
import { processOnboardings } from "../../src/services/onboarding.js";
import * as leadsRepo from "../../src/repositories/leads.js";
import { ALWAYS_OPEN } from "./setup.js";

export async function createCampaign(ctx, overrides = {}) {
  return leadsRepo.insertCampaign(ctx.db, {
    code: "retorno-simulacao", name: "Retorno da simulação", purpose: "retorno_simulacao", message_type: "template",
    template_name: "retorno_simulacao", template_language: "pt_BR", template_components: [], enabled: true, ...overrides
  });
}

// Instância Cloud API pronta para enviar (conexão confirmada pelo MOCK, perfil configurado, ativa).
export async function createReadyInstance(ctx, { name, phone, pnid, dailyLimit = 100, minInterval = 0, rotation = 0 }) {
  const created = await createInstance(ctx, {
    name, phone, provider: "meta_cloud_api", provider_config: { phone_number_id: pnid, waba_id: "900000001" },
    credential_ref: "WA_TOKEN_TESTE", daily_limit: dailyLimit, min_interval_seconds: minInterval, send_window: ALWAYS_OPEN,
    timezone: "America/Sao_Paulo", rotation_order: rotation, profile_config: { about: "Atendimento de financiamento" }
  }, "teste");
  const verified = await verifyConnection(ctx, created.id, "teste");
  if (!verified.connected) throw new Error(`instância de teste não conectou: ${verified.reason}`);
  await processOnboardings(ctx);
  await changeOperational(ctx, created.id, "enable", {}, "teste");
  return changeOperational(ctx, created.id, "activate", {}, "teste");
}

export const phoneN = (i) => `1199${String(1000000 + i).slice(-7)}`; // celular nacional válido (11 9xxxx-xxxx)
