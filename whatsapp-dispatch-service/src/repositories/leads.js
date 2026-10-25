// wa_dispatch.leads + wa_dispatch.campaigns.

export async function insertLeadIdempotent(q, data) {
  // Mesmo idempotency_key (ou mesmo lead do CRM na mesma campanha) devolve o registro existente, sem duplicar.
  const inserted = await q.query(
    `insert into wa_dispatch.leads (crm_lead_id, phone_e164, campaign_id, consent_reference, idempotency_key)
     values ($1,$2,$3,$4,$5)
     on conflict do nothing returning *`,
    [data.crm_lead_id, data.phone_e164, data.campaign_id, data.consent_reference, data.idempotency_key]
  );
  if (inserted.rows[0]) return { lead: inserted.rows[0], created: true };
  const { rows } = await q.query(
    `select * from wa_dispatch.leads where idempotency_key = $1 or (crm_lead_id = $2 and campaign_id = $3) limit 1`,
    [data.idempotency_key, data.crm_lead_id, data.campaign_id]
  );
  return { lead: rows[0], created: false };
}

export async function getLead(q, id) {
  const { rows } = await q.query(`select * from wa_dispatch.leads where id = $1`, [id]);
  return rows[0] || null;
}

export async function findLeadsByCrmId(q, crmLeadId) {
  const { rows } = await q.query(`select * from wa_dispatch.leads where crm_lead_id = $1 order by created_at`, [crmLeadId]);
  return rows;
}

export async function setLeadStatus(q, id, status, reason = null) {
  await q.query(
    `update wa_dispatch.leads set status = $2, rejection_reason = coalesce($3, rejection_reason), updated_at = now() where id = $1`,
    [id, status, reason]
  );
}

export async function getCampaignByCode(q, code) {
  const { rows } = await q.query(`select * from wa_dispatch.campaigns where code = $1`, [code]);
  return rows[0] || null;
}

export async function getCampaign(q, id) {
  const { rows } = await q.query(`select * from wa_dispatch.campaigns where id = $1`, [id]);
  return rows[0] || null;
}

export async function listCampaigns(q) {
  const { rows } = await q.query(`select * from wa_dispatch.campaigns order by created_at`);
  return rows;
}

export async function insertCampaign(q, c) {
  const { rows } = await q.query(
    `insert into wa_dispatch.campaigns (code, name, purpose, message_type, template_name, template_language,
       template_components, text_body, enabled, starts_at, ends_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [c.code, c.name, c.purpose, c.message_type, c.template_name || null, c.template_language || null,
      JSON.stringify(c.template_components || []), c.text_body || null, Boolean(c.enabled), c.starts_at || null, c.ends_at || null]
  );
  return rows[0];
}

const CAMPAIGN_UPDATABLE = ["name", "enabled", "template_name", "template_language", "template_components", "text_body", "starts_at", "ends_at"];
export async function updateCampaign(q, code, patch) {
  const keys = Object.keys(patch).filter((k) => CAMPAIGN_UPDATABLE.includes(k));
  if (!keys.length) return getCampaignByCode(q, code);
  const values = keys.map((k) => (k === "template_components" ? JSON.stringify(patch[k]) : patch[k]));
  const { rows } = await q.query(
    `update wa_dispatch.campaigns set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now()
     where code = $1 returning *`,
    [code, ...values]
  );
  return rows[0] || null;
}
