// wa_dispatch.outbound_messages + wa_dispatch.message_events.

export const PENDING_STATUSES = ["requested", "scheduled", "queued"];
export const FINAL_STATUSES = ["delivered", "read", "replied", "failed", "cancelled", "unknown_needs_review"];

export async function insertMessage(q, { lead_id, campaign_id, phone_e164, max_attempts }) {
  const inserted = await q.query(
    `insert into wa_dispatch.outbound_messages (lead_id, campaign_id, phone_e164, max_attempts)
     values ($1,$2,$3,$4) on conflict (lead_id) do nothing returning *`,
    [lead_id, campaign_id, phone_e164, max_attempts]
  );
  if (inserted.rows[0]) return inserted.rows[0];
  return getMessageByLead(q, lead_id);
}

export async function getMessage(q, id, { forUpdate = false } = {}) {
  const { rows } = await q.query(`select * from wa_dispatch.outbound_messages where id = $1${forUpdate ? " for update" : ""}`, [id]);
  return rows[0] || null;
}

export async function getMessageByLead(q, leadId) {
  const { rows } = await q.query(`select * from wa_dispatch.outbound_messages where lead_id = $1`, [leadId]);
  return rows[0] || null;
}

export async function findMessageByProviderId(q, providerMessageId, { forUpdate = false } = {}) {
  const { rows } = await q.query(
    `select * from wa_dispatch.outbound_messages where provider_message_id = $1${forUpdate ? " for update" : ""}`, [providerMessageId]
  );
  return rows[0] || null;
}

const COLUMNS = new Set([
  "status", "instance_id", "reserved_usage_date", "attempts", "next_attempt_at", "provider_message_id", "pacing_status",
  "authorized_at", "queued_at", "sending_started_at", "sending_lock_expires_at", "accepted_at", "delivered_at", "read_at",
  "replied_at", "failed_at", "cancelled_at", "last_error_code", "last_error_message", "cancel_reason", "processing_ms"
]);

export async function updateMessage(q, id, patch, { expectStatus = null } = {}) {
  const keys = Object.keys(patch).filter((k) => COLUMNS.has(k));
  const params = [id, ...keys.map((k) => patch[k])];
  let guard = "";
  if (expectStatus) {
    params.push(Array.isArray(expectStatus) ? expectStatus : [expectStatus]);
    guard = ` and status = any($${params.length}::text[])`;
  }
  const { rows } = await q.query(
    `update wa_dispatch.outbound_messages set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}${keys.length ? "," : ""} updated_at = now()
      where id = $1${guard} returning *`,
    params
  );
  return rows[0] || null;
}

export async function addEvent(q, { messageId = null, instanceId = null, type, status = null, attempt = null, providerMessageId = null, detail = {}, occurredAt = null }) {
  await q.query(
    `insert into wa_dispatch.message_events (outbound_message_id, instance_id, event_type, status, attempt, provider_message_id, detail, occurred_at)
     values ($1,$2,$3,$4,$5,$6,$7, coalesce($8, now()))`,
    [messageId, instanceId, type, status, attempt, providerMessageId, JSON.stringify(detail), occurredAt]
  );
}

export async function listEvents(q, messageId) {
  const { rows } = await q.query(
    `select event_type, status, attempt, provider_message_id, detail, occurred_at, created_at
       from wa_dispatch.message_events where outbound_message_id = $1 order by id`, [messageId]
  );
  return rows;
}

// Lote de mensagens num estado, travadas para este processo (SKIP LOCKED: agendadores concorrentes não pegam a mesma).
export async function lockBatch(q, statuses, limit, { dueOnly = true, extraWhere = "" } = {}) {
  const { rows } = await q.query(
    `select * from wa_dispatch.outbound_messages
      where status = any($1::text[]) ${dueOnly ? "and next_attempt_at <= now()" : ""} ${extraWhere}
      order by next_attempt_at, created_at
      limit $2 for update skip locked`,
    [statuses, limit]
  );
  return rows;
}

export async function pendingForPhone(q, phone, purpose = null) {
  const { rows } = await q.query(
    `select m.* from wa_dispatch.outbound_messages m
      where m.phone_e164 = $1 and m.status = any($2::text[])
        and ($3::text is null or exists (select 1 from wa_dispatch.campaigns c where c.id = m.campaign_id and c.purpose = $3))
      for update of m`,
    [phone, PENDING_STATUSES, purpose]
  );
  return rows;
}

export async function latestSentToPhone(q, phone, instanceId = null) {
  const { rows } = await q.query(
    `select * from wa_dispatch.outbound_messages
      where phone_e164 = $1 and status in ('accepted','delivered','read') and ($2::uuid is null or instance_id = $2)
      order by accepted_at desc nulls last limit 1 for update`,
    [phone, instanceId]
  );
  return rows[0] || null;
}

// Já houve envio aceito para este telefone nesta campanha (outro lead/registro)? Evita duplicação.
export async function hasPriorSend(q, phone, campaignId, excludeId) {
  const { rows } = await q.query(
    `select 1 from wa_dispatch.outbound_messages
      where phone_e164 = $1 and campaign_id = $2 and id <> $3
        and status in ('sending','accepted','delivered','read','replied','unknown_pending_verification','unknown_needs_review')
      limit 1`,
    [phone, campaignId, excludeId]
  );
  return rows.length > 0;
}
