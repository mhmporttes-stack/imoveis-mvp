// wa_dispatch.onboarding_runs + wa_dispatch.webhook_events + consultas de estatística.

export async function getRunningOnboarding(q, instanceId, { forUpdate = false } = {}) {
  const { rows } = await q.query(
    `select * from wa_dispatch.onboarding_runs where instance_id = $1 and status = 'running'${forUpdate ? " for update" : ""}`,
    [instanceId]
  );
  return rows[0] || null;
}

export async function latestOnboarding(q, instanceId) {
  const { rows } = await q.query(
    `select * from wa_dispatch.onboarding_runs where instance_id = $1 order by started_at desc limit 1`, [instanceId]
  );
  return rows[0] || null;
}

export async function insertOnboarding(q, { instanceId, desiredProfile, steps }) {
  const { rows } = await q.query(
    `insert into wa_dispatch.onboarding_runs (instance_id, desired_profile, steps) values ($1,$2,$3)
     on conflict (instance_id) where status = 'running' do nothing returning *`,
    [instanceId, JSON.stringify(desiredProfile), JSON.stringify(steps)]
  );
  return rows[0] || getRunningOnboarding(q, instanceId);
}

export async function updateOnboarding(q, id, { status, steps, attempts, lastError, finished = false }) {
  const { rows } = await q.query(
    `update wa_dispatch.onboarding_runs
        set status = coalesce($2, status), steps = coalesce($3, steps), attempts = coalesce($4, attempts),
            last_error = $5, finished_at = case when $6 then now() else finished_at end, updated_at = now()
      where id = $1 returning *`,
    [id, status || null, steps ? JSON.stringify(steps) : null, attempts ?? null, lastError || null, finished]
  );
  return rows[0];
}

// Registro do webhook. dedupe_key único = proteção contra replay do mesmo corpo. Retorna null se já existia.
export async function insertWebhookEvent(q, { provider, dedupeKey, signatureValid, eventKind = null, instanceId = null, summary = {} }) {
  const { rows } = await q.query(
    `insert into wa_dispatch.webhook_events (provider, dedupe_key, signature_valid, event_kind, instance_id, summary)
     values ($1,$2,$3,$4,$5,$6) on conflict (dedupe_key) do nothing returning id`,
    [provider, dedupeKey, signatureValid, eventKind, instanceId, JSON.stringify(summary)]
  );
  return rows[0]?.id || null;
}

export async function finishWebhookEvent(q, id, { error = null, summary = null } = {}) {
  await q.query(
    `update wa_dispatch.webhook_events set processed_at = now(), processing_error = $2, summary = coalesce($3, summary) where id = $1`,
    [id, error, summary ? JSON.stringify(summary) : null]
  );
}

export async function messageStatusCounts(q) {
  const { rows } = await q.query(`select status, count(*)::int as total from wa_dispatch.outbound_messages group by status`);
  return Object.fromEntries(rows.map((r) => [r.status, r.total]));
}

export async function eventCounts(q, sinceHours = 24) {
  const { rows } = await q.query(
    `select event_type, count(*)::int as total from wa_dispatch.message_events
      where created_at >= now() - make_interval(hours => $1) group by event_type`,
    [sinceHours]
  );
  return Object.fromEntries(rows.map((r) => [r.event_type, r.total]));
}

export async function providerErrorCounts(q, sinceHours = 24) {
  const { rows } = await q.query(
    `select coalesce(detail->>'provider','?') as provider, coalesce(detail->>'code','?') as code, count(*)::int as total
       from wa_dispatch.message_events
      where event_type in ('send_failed_temporary','send_failed_permanent','send_unknown')
        and created_at >= now() - make_interval(hours => $1)
      group by 1, 2 order by 3 desc limit 50`,
    [sinceHours]
  );
  return rows;
}

export async function processingStats(q, sinceHours = 24) {
  const { rows } = await q.query(
    `select count(*)::int as processed, coalesce(avg(processing_ms),0)::int as avg_ms, coalesce(max(processing_ms),0)::int as max_ms
       from wa_dispatch.outbound_messages where processing_ms is not null and updated_at >= now() - make_interval(hours => $1)`,
    [sinceHours]
  );
  return rows[0];
}

export async function leadRejectionCounts(q, sinceHours = 24) {
  const { rows } = await q.query(
    `select coalesce(split_part(rejection_reason, ':', 1), '?') as reason, count(*)::int as total from wa_dispatch.leads
      where status = 'rejected' and updated_at >= now() - make_interval(hours => $1) group by 1`,
    [sinceHours]
  );
  return Object.fromEntries(rows.map((r) => [r.reason, r.total]));
}

export async function suppressionCount(q) {
  const { rows } = await q.query(`select count(*) filter (where active)::int as active, count(*)::int as total from wa_dispatch.suppression_list`);
  return rows[0];
}

export async function onboardingFailures(q, sinceHours = 168) {
  const { rows } = await q.query(
    `select count(*)::int as total from wa_dispatch.onboarding_runs
      where status = 'failed' and updated_at >= now() - make_interval(hours => $1)`,
    [sinceHours]
  );
  return rows[0].total;
}

export async function listFailures(q, limit = 100) {
  const { rows } = await q.query(
    `select id, lead_id, campaign_id, instance_id, status, attempts, last_error_code, last_error_message, cancel_reason,
            failed_at, cancelled_at, updated_at
       from wa_dispatch.outbound_messages
      where status in ('failed','unknown_needs_review','unknown_pending_verification')
      order by updated_at desc limit $1`,
    [limit]
  );
  return rows;
}
