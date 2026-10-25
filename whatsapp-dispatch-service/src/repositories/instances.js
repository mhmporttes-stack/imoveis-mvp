// Acesso a wa_dispatch.whatsapp_instances e wa_dispatch.instance_daily_usage.
// `q` é o pool ou um client dentro de transação (db.tx).

const UPDATABLE = new Set([
  "name", "phone_e164", "provider_config", "credential_ref", "connection_state", "profile_state", "operational_state",
  "enabled", "daily_limit", "min_interval_seconds", "send_window", "timezone", "rotation_order", "profile_config",
  "suspension_reason", "last_error", "last_error_at", "last_connected_at", "last_checked_at", "last_assigned_at",
  "last_success_send_at"
]);
const JSON_COLUMNS = new Set(["provider_config", "send_window", "profile_config"]);

export async function insertInstance(q, data) {
  const { rows } = await q.query(
    `insert into wa_dispatch.whatsapp_instances
       (name, phone_e164, provider, connection_type, provider_config, credential_ref, daily_limit, min_interval_seconds,
        send_window, timezone, rotation_order, profile_config, enabled, connection_state)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [data.name, data.phone_e164, data.provider, data.connection_type, JSON.stringify(data.provider_config || {}),
      data.credential_ref || null, data.daily_limit, data.min_interval_seconds, JSON.stringify(data.send_window),
      data.timezone, data.rotation_order || 0, JSON.stringify(data.profile_config || {}), Boolean(data.enabled),
      data.connection_state || "registered"]
  );
  return rows[0];
}

export async function getInstance(q, id, { forUpdate = false } = {}) {
  const { rows } = await q.query(
    `select * from wa_dispatch.whatsapp_instances where id = $1${forUpdate ? " for update" : ""}`, [id]
  );
  return rows[0] || null;
}

export async function findInstanceByProviderKey(q, provider, key, value) {
  const { rows } = await q.query(
    `select * from wa_dispatch.whatsapp_instances where provider = $1 and provider_config ->> $2 = $3 limit 1`,
    [provider, key, String(value)]
  );
  return rows[0] || null;
}

export async function listInstances(q) {
  const { rows } = await q.query(`select * from wa_dispatch.whatsapp_instances order by rotation_order, created_at`);
  return rows;
}

export async function updateInstance(q, id, patch) {
  const keys = Object.keys(patch).filter((k) => UPDATABLE.has(k));
  if (!keys.length) return getInstance(q, id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = keys.map((k) => (JSON_COLUMNS.has(k) ? JSON.stringify(patch[k]) : patch[k]));
  const { rows } = await q.query(
    `update wa_dispatch.whatsapp_instances set ${sets.join(", ")}, version = version + 1, updated_at = now()
     where id = $1 returning *`,
    [id, ...values]
  );
  return rows[0] || null;
}

// Candidatas à distribuição circular: habilitadas, conectadas de verdade, ativas e fora do intervalo mínimo.
// Ordem = quem recebeu trabalho há mais tempo primeiro (rodízio). SKIP LOCKED evita duas reservas simultâneas.
export async function lockEligibleCandidates(q, { instanceIds = null } = {}) {
  const { rows } = await q.query(
    `select * from wa_dispatch.whatsapp_instances
      where enabled and connection_state = 'connected' and operational_state = 'active'
        and (last_assigned_at is null or last_assigned_at <= now() - make_interval(secs => min_interval_seconds))
        and ($1::uuid[] is null or id = any($1::uuid[]))
      order by last_assigned_at nulls first, rotation_order, id
      for update skip locked`,
    [instanceIds]
  );
  return rows;
}

// Reserva atômica de 1 envio no limite diário. Retorna true se coube no limite.
export async function reserveDailySlot(q, instanceId, usageDate, limit) {
  if (!(limit > 0)) return false;
  const { rows } = await q.query(
    `insert into wa_dispatch.instance_daily_usage (instance_id, usage_date, reserved) values ($1, $2, 1)
     on conflict (instance_id, usage_date) do update
       set reserved = wa_dispatch.instance_daily_usage.reserved + 1, updated_at = now()
       where wa_dispatch.instance_daily_usage.reserved < $3
     returning reserved`,
    [instanceId, usageDate, limit]
  );
  return rows.length === 1;
}

export async function releaseDailySlot(q, instanceId, usageDate) {
  if (!instanceId || !usageDate) return;
  await q.query(
    `update wa_dispatch.instance_daily_usage set reserved = greatest(reserved - 1, 0), updated_at = now()
      where instance_id = $1 and usage_date = $2`,
    [instanceId, usageDate]
  );
}

export async function getDailyUsage(q, instanceId, usageDate) {
  const { rows } = await q.query(
    `select reserved, accepted from wa_dispatch.instance_daily_usage where instance_id = $1 and usage_date = $2`,
    [instanceId, usageDate]
  );
  return rows[0] || { reserved: 0, accepted: 0 };
}

export async function recordAccepted(q, instanceId, usageDate) {
  await q.query(
    `update wa_dispatch.whatsapp_instances
        set total_accepted = total_accepted + 1, last_success_send_at = now(), last_error = null, updated_at = now()
      where id = $1`, [instanceId]
  );
  if (usageDate) {
    await q.query(
      `update wa_dispatch.instance_daily_usage set accepted = accepted + 1, updated_at = now()
        where instance_id = $1 and usage_date = $2`, [instanceId, usageDate]
    );
  }
}

export async function incrementCounter(q, instanceId, column) {
  if (!["total_failed", "total_delivered", "total_read"].includes(column)) throw new Error("contador inválido");
  await q.query(`update wa_dispatch.whatsapp_instances set ${column} = ${column} + 1, updated_at = now() where id = $1`, [instanceId]);
}
