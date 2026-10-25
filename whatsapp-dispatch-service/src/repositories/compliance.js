// wa_dispatch.consent_records + wa_dispatch.suppression_list + wa_dispatch.audit_logs.

export async function insertConsentRecord(q, r) {
  const { rows } = await q.query(
    `insert into wa_dispatch.consent_records (lead_id, crm_lead_id, phone_e164, purpose, state, origin, verifier,
       evidence_ref, consented_at, revoked_at, reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [r.lead_id || null, r.crm_lead_id || null, r.phone_e164, r.purpose, r.state, r.origin, r.verifier,
      r.evidence_ref || null, r.consented_at || null, r.revoked_at || null, r.reason || null]
  );
  return rows[0];
}

// Revogação registrada por este serviço (API/opt-out) para o telefone e finalidade (ou todas: purpose null).
export async function latestRevocation(q, phone, purpose) {
  const { rows } = await q.query(
    `select * from wa_dispatch.consent_records
      where phone_e164 = $1 and state = 'revoked' and (purpose = $2 or purpose = '*')
      order by verified_at desc limit 1`,
    [phone, purpose]
  );
  return rows[0] || null;
}

export async function listConsent(q, phone) {
  const { rows } = await q.query(
    `select id, lead_id, crm_lead_id, purpose, state, origin, verifier, evidence_ref, consented_at, verified_at, revoked_at, reason
       from wa_dispatch.consent_records where phone_e164 = $1 order by verified_at desc limit 100`,
    [phone]
  );
  return rows;
}

export async function getSuppression(q, phone) {
  const { rows } = await q.query(`select * from wa_dispatch.suppression_list where phone_e164 = $1`, [phone]);
  return rows[0] || null;
}

export async function upsertSuppression(q, { phone_e164, reason, source, created_by }) {
  // Reativa um registro desativado (nunca cria duplicado; nunca apaga).
  const { rows } = await q.query(
    `insert into wa_dispatch.suppression_list (phone_e164, reason, source, created_by)
     values ($1,$2,$3,$4)
     on conflict (phone_e164) do update set
       active = true, reason = excluded.reason, source = excluded.source, created_by = excluded.created_by,
       deactivated_at = null, deactivated_by = null, deactivation_reason = null, updated_at = now()
     returning *`,
    [phone_e164, reason, source, created_by]
  );
  return rows[0];
}

export async function deactivateSuppression(q, phone, { by, reason }) {
  const { rows } = await q.query(
    `update wa_dispatch.suppression_list
        set active = false, deactivated_at = now(), deactivated_by = $2, deactivation_reason = $3, updated_at = now()
      where phone_e164 = $1 and active returning *`,
    [phone, by, reason]
  );
  return rows[0] || null;
}

export async function audit(q, { actor, action, entityType, entityId = null, detail = {} }) {
  await q.query(
    `insert into wa_dispatch.audit_logs (actor, action, entity_type, entity_id, detail) values ($1,$2,$3,$4,$5)`,
    [actor, action, entityType, entityId == null ? null : String(entityId), JSON.stringify(detail)]
  );
}

export async function listAudit(q, { limit = 100, entityType = null } = {}) {
  const { rows } = await q.query(
    `select * from wa_dispatch.audit_logs where ($2::text is null or entity_type = $2) order by id desc limit $1`,
    [limit, entityType]
  );
  return rows;
}
