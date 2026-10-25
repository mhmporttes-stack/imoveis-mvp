import * as compliance from "../repositories/compliance.js";
import * as messages from "../repositories/messages.js";
import { isWithinWindow } from "../utils/time.js";

// Módulo CENTRAL de autorização — chamado ao autorizar o lead (agendamento) e de novo imediatamente antes de cada envio.
// Ordem = prioridade: não contato e revogação vêm antes de tudo. Rodízio de números nunca contorna nenhum destes bloqueios
// (a decisão é pelo telefone do cliente, independente da instância).
// Resultado: { ok: true, consent } | { ok: false, scope: 'lead'|'campaign'|'instance', action, reason, suppress? }
//   scope lead     → lead recusado/cancelado (nunca será enviado)
//   scope campaign → aguarda (campanha pausada) ou cancela (campanha encerrada)
//   scope instance → devolve à fila de agendamento para outra instância elegível

export function campaignState(campaign, now = new Date()) {
  if (campaign.ends_at && new Date(campaign.ends_at) <= now) return { ok: false, action: "cancel", reason: "campanha_encerrada" };
  if (!campaign.enabled) return { ok: false, action: "wait", reason: "campanha_pausada" };
  if (campaign.starts_at && new Date(campaign.starts_at) > now) return { ok: false, action: "wait", reason: "campanha_nao_iniciada" };
  return { ok: true };
}

export function instanceEligibility(instance, now = new Date()) {
  if (!instance) return { ok: false, reason: "sem_instancia" };
  if (!instance.enabled) return { ok: false, reason: "instancia_desabilitada" };
  if (instance.connection_state !== "connected") return { ok: false, reason: `instancia_${instance.connection_state}` };
  if (instance.operational_state !== "active") return { ok: false, reason: `instancia_${instance.operational_state}` };
  if (!isWithinWindow(instance.send_window, instance.timezone, now)) return { ok: false, reason: "fora_do_horario_autorizado" };
  return { ok: true };
}

export async function authorize(ctx, q, { message, lead, campaign, instance = null, phase }) {
  const now = ctx.now();
  const suppression = await compliance.getSuppression(q, message.phone_e164);
  if (suppression?.active) return { ok: false, scope: "lead", action: "reject", reason: "lista_de_nao_contato" };

  const revoked = await compliance.latestRevocation(q, message.phone_e164, campaign.purpose);
  if (revoked) return { ok: false, scope: "lead", action: "reject", reason: "consentimento_revogado" };

  const c = campaignState(campaign, now);
  if (!c.ok) return { ok: false, scope: "campaign", action: c.action, reason: c.reason };

  if (await messages.hasPriorSend(q, message.phone_e164, campaign.id, message.id)) {
    return { ok: false, scope: "lead", action: "reject", reason: "duplicado_mesmo_telefone_e_campanha" };
  }

  if (phase === "send") {
    const inst = instanceEligibility(instance, now);
    if (!inst.ok) return { ok: false, scope: "instance", action: "release", reason: inst.reason };
  }

  // Fonte confiável (CRM). O campo enviado no pedido NÃO é prova.
  const result = await ctx.consent.verify({ crmLeadId: lead.crm_lead_id, phoneE164: message.phone_e164, purpose: campaign.purpose });
  const record = await compliance.insertConsentRecord(q, {
    lead_id: lead.id, crm_lead_id: lead.crm_lead_id, phone_e164: message.phone_e164, purpose: campaign.purpose,
    state: result.state, origin: result.origin, verifier: result.verifier, evidence_ref: result.evidence_ref,
    consented_at: result.consented_at, revoked_at: result.state === "revoked" ? now : null, reason: result.reason
  });
  if (result.state !== "granted") {
    return { ok: false, scope: "lead", action: "reject", reason: `consentimento_${result.state}:${result.reason || ""}`, suppress: Boolean(result.suppress), consent: record };
  }
  return { ok: true, consent: record };
}
