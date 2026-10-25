import * as compliance from "../repositories/compliance.js";
import { normalizePhone } from "../utils/phone.js";
import { badRequest, conflict, notFound } from "../utils/errors.js";
import { maskPhone } from "../utils/logger.js";

// Não contato e revogação — sempre com prioridade: gravam e cancelam na MESMA transação tudo o que estava pendente.

export async function suppressPhone(ctx, q, { phone, reason, source, actor }) {
  const row = await compliance.upsertSuppression(q, { phone_e164: phone, reason, source, created_by: actor });
  const { cancelPendingForPhone } = await import("./dispatch.js");
  const cancelled = await cancelPendingForPhone(ctx, q, phone, `nao_contato:${reason}`.slice(0, 200));
  await compliance.audit(q, { actor, action: "suppression.add", entityType: "suppression", entityId: row.id, detail: { source, reason, cancelled } });
  ctx.logger.info({ phone: maskPhone(phone), source, cancelled }, "telefone na lista de não contato");
  return { suppression: row, cancelled };
}

export async function addSuppression(ctx, { phone, reason, source = "crm" }, actor) {
  const normalized = normalizePhone(phone, ctx.config.DEFAULT_COUNTRY_CODE);
  if (!normalized) throw badRequest("Telefone inválido.");
  return ctx.db.tx((q) => suppressPhone(ctx, q, { phone: normalized, reason, source, actor }));
}

export async function getSuppressionStatus(ctx, phone) {
  const normalized = normalizePhone(phone, ctx.config.DEFAULT_COUNTRY_CODE);
  if (!normalized) throw badRequest("Telefone inválido.");
  const row = await compliance.getSuppression(ctx.db, normalized);
  return { phone_e164: normalized, suppressed: Boolean(row?.active), record: row };
}

// Remoção protegida: só desativa (nunca apaga), exige perfil admin, motivo e a frase de confirmação exata.
export async function deactivateSuppression(ctx, { phone, reason, confirm }, actor) {
  const normalized = normalizePhone(phone, ctx.config.DEFAULT_COUNTRY_CODE);
  if (!normalized) throw badRequest("Telefone inválido.");
  if (confirm !== `REMOVER ${normalized}`) throw badRequest(`Confirmação ausente: envie confirm = "REMOVER ${normalized}".`);
  return ctx.db.tx(async (q) => {
    const row = await compliance.deactivateSuppression(q, normalized, { by: actor, reason });
    if (!row) {
      const existing = await compliance.getSuppression(q, normalized);
      if (!existing) throw notFound("Telefone não está na lista.");
      throw conflict("Registro já está desativado.");
    }
    await compliance.audit(q, { actor, action: "suppression.deactivate", entityType: "suppression", entityId: row.id, detail: { reason } });
    return row;
  });
}

// Revogação de consentimento (pelo CRM ou pelo próprio cliente). purpose ausente = todas as finalidades ('*').
export async function revokeConsent(ctx, { phone, crm_lead_id = null, purpose = null, reason, add_to_suppression = false }, actor) {
  const normalized = normalizePhone(phone, ctx.config.DEFAULT_COUNTRY_CODE);
  if (!normalized) throw badRequest("Telefone inválido.");
  return ctx.db.tx(async (q) => {
    const record = await compliance.insertConsentRecord(q, {
      crm_lead_id, phone_e164: normalized, purpose: purpose || "*", state: "revoked", origin: "revogacao_via_api",
      verifier: "api_revogacao", evidence_ref: null, revoked_at: new Date(), reason
    });
    const { cancelPendingForPhone } = await import("./dispatch.js");
    let cancelled = 0;
    if (add_to_suppression) {
      cancelled = (await suppressPhone(ctx, q, { phone: normalized, reason: `revogacao:${reason}`, source: "consent_revocation", actor })).cancelled;
    } else {
      cancelled = await cancelPendingForPhone(ctx, q, normalized, `consentimento_revogado:${reason}`.slice(0, 200), purpose);
    }
    await compliance.audit(q, { actor, action: "consent.revoke", entityType: "consent", entityId: record.id, detail: { purpose: purpose || "*", cancelled } });
    return { consent: record, cancelled };
  });
}
