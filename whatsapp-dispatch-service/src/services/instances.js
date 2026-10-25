import * as instancesRepo from "../repositories/instances.js";
import * as compliance from "../repositories/compliance.js";
import * as operations from "../repositories/operations.js";
import { normalizePhone } from "../utils/phone.js";
import { badRequest, conflict, notFound } from "../utils/errors.js";
import { sanitizeText } from "../utils/logger.js";
import { isValidTimeZone, localDate } from "../utils/time.js";

// Ciclo de vida da instância. Três estados independentes:
//   connection_state  — só vira 'connected' após resposta REAL do provedor (verifyConnection)
//   operational_state — inactive | active | paused | suspended (envio só em 'active')
//   profile_state     — onboarding do perfil (services/onboarding.js)
export const CONNECTION_TRANSITIONS = {
  registered: ["verifying", "not_configured"],
  not_configured: ["verifying", "registered"],
  verifying: ["connected", "disconnected", "error", "not_configured"],
  connected: ["verifying", "disconnected", "error", "reconnecting", "not_configured"],
  disconnected: ["verifying", "reconnecting", "not_configured"],
  reconnecting: ["verifying", "connected", "disconnected", "error", "not_configured"],
  error: ["verifying", "not_configured"]
};
export const OPERATIONAL_TRANSITIONS = {
  inactive: ["active"],
  active: ["paused", "suspended", "inactive"],
  paused: ["active", "suspended", "inactive"],
  suspended: ["active", "inactive"]
};

export function assertTransition(table, from, to) {
  if (from === to) return;
  if (!(table[from] || []).includes(to)) throw conflict(`Transição inválida: ${from} → ${to}.`, "invalid_transition");
}

export function presentInstance(i, usage = null) {
  const { provider_config: cfg, ...rest } = i;
  return {
    ...rest,
    provider_config: cfg, // só identificadores; tokens nunca ficam no banco
    usage_today: usage
  };
}

export async function createInstance(ctx, input, actor) {
  const phone = normalizePhone(input.phone, ctx.config.DEFAULT_COUNTRY_CODE);
  if (!phone) throw badRequest("Telefone da instância inválido.");
  if (!isValidTimeZone(input.timezone)) throw badRequest("Fuso horário inválido.");
  const adapter = ctx.adapters.get(input.provider);
  const draft = { ...input, phone_e164: phone, connection_type: adapter.connectionType, enabled: false };
  const problems = adapter.validateRegistration(draft);
  if (problems.length) throw badRequest("Cadastro do provedor incompleto.", problems);
  const status = adapter.configurationStatus(draft);
  draft.connection_state = status.ok ? "registered" : "not_configured";
  return ctx.db.tx(async (q) => {
    let row;
    try {
      row = await instancesRepo.insertInstance(q, draft);
    } catch (error) {
      if (error.code === "23505") throw conflict("Já existe instância com esse nome ou telefone.");
      throw error;
    }
    if (!status.ok) await instancesRepo.updateInstance(q, row.id, { last_error: status.reason, last_error_at: new Date() });
    await compliance.audit(q, { actor, action: "instance.create", entityType: "instance", entityId: row.id, detail: { provider: row.provider, name: row.name } });
    return instancesRepo.getInstance(q, row.id);
  });
}

export async function listInstances(ctx) {
  const rows = await instancesRepo.listInstances(ctx.db);
  return Promise.all(rows.map(async (i) => presentInstance(i, await instancesRepo.getDailyUsage(ctx.db, i.id, localDate(i.timezone, ctx.now())))));
}

export async function getInstanceDetail(ctx, id) {
  const i = await instancesRepo.getInstance(ctx.db, id);
  if (!i) throw notFound("Instância não encontrada.");
  const usage = await instancesRepo.getDailyUsage(ctx.db, i.id, localDate(i.timezone, ctx.now()));
  const onboarding = await operations.latestOnboarding(ctx.db, i.id);
  return { ...presentInstance(i, usage), onboarding };
}

export async function updateInstanceConfig(ctx, id, patch, actor) {
  if (patch.timezone && !isValidTimeZone(patch.timezone)) throw badRequest("Fuso horário inválido.");
  if (patch.phone) throw badRequest("Telefone não pode ser alterado; cadastre outra instância.");
  return ctx.db.tx(async (q) => {
    const current = await instancesRepo.getInstance(q, id, { forUpdate: true });
    if (!current) throw notFound("Instância não encontrada.");
    const next = await instancesRepo.updateInstance(q, id, patch);
    if (patch.provider_config) {
      // Mudou identificador do provedor: precisa verificar a conexão de novo.
      await instancesRepo.updateInstance(q, id, { connection_state: "registered", operational_state: current.operational_state === "active" ? "paused" : current.operational_state });
    }
    await compliance.audit(q, { actor, action: "instance.update", entityType: "instance", entityId: id, detail: { fields: Object.keys(patch) } });
    return next;
  });
}

// Verificação REAL de conexão com o provedor. 'connected' só com resposta confirmada.
export async function verifyConnection(ctx, id, actor = "sistema") {
  const instance = await instancesRepo.getInstance(ctx.db, id);
  if (!instance) throw notFound("Instância não encontrada.");
  const adapter = ctx.adapters.get(instance.provider);
  const status = adapter.configurationStatus(instance);
  if (!status.ok) {
    await ctx.db.tx(async (q) => {
      await setConnection(q, instance, "not_configured", { last_error: status.reason, last_error_at: new Date() });
      await compliance.audit(q, { actor, action: "instance.verify", entityType: "instance", entityId: id, detail: { result: "not_configured", reason: status.reason } });
    });
    return { connected: false, state: "not_configured", reason: status.reason };
  }
  // Instância já conectada continua elegível durante a checagem; as demais passam por 'verifying'.
  if (instance.connection_state !== "connected") await ctx.db.tx((q) => setConnection(q, instance, "verifying", {}));
  let result;
  try {
    result = await adapter.checkConnection(instance);
  } catch (error) {
    result = { connected: false, state: error?.instanceImpact === "auth" ? "error" : "disconnected", reason: sanitizeText(error?.message, 300), error };
  }
  await ctx.db.tx(async (q) => {
    const cur = await instancesRepo.getInstance(q, id, { forUpdate: true });
    const extra = { last_checked_at: new Date() };
    if (result.connected) {
      extra.last_connected_at = new Date();
      extra.last_error = null;
    } else {
      extra.last_error = result.reason || "desconectado";
      extra.last_error_at = new Date();
    }
    await setConnection(q, cur, result.state, extra);
    if (result.connected && result.qualityProblem && cur.operational_state === "active") {
      await setOperational(q, cur, "paused", "qualidade_baixa_reportada_pelo_provedor");
    }
    if (!result.connected) await releaseQueuedForInstance(q, id, `instancia_${result.state}`);
    if (result.error?.instanceImpact && ["auth", "restricted"].includes(result.error.instanceImpact)) {
      await setOperational(q, await instancesRepo.getInstance(q, id), "suspended", `${result.error.instanceImpact}: ${result.reason}`.slice(0, 300));
    }
    await compliance.audit(q, { actor, action: "instance.verify", entityType: "instance", entityId: id, detail: { connected: result.connected, state: result.state, reason: result.reason || null, details: result.details || null } });
  });
  if (result.connected) {
    const { startOnboardingIfNeeded } = await import("./onboarding.js");
    await startOnboardingIfNeeded(ctx, id);
  }
  return { connected: result.connected, state: result.state, reason: result.reason || null, details: result.details || null };
}

async function setConnection(q, instance, state, extra) {
  assertTransition(CONNECTION_TRANSITIONS, instance.connection_state, state);
  return instancesRepo.updateInstance(q, instance.id, { connection_state: state, ...extra });
}

async function setOperational(q, instance, state, reason) {
  assertTransition(OPERATIONAL_TRANSITIONS, instance.operational_state, state);
  return instancesRepo.updateInstance(q, instance.id, {
    operational_state: state, suspension_reason: state === "active" || state === "inactive" ? null : reason
  });
}

// Trabalhos já reservados para uma instância que deixou de poder enviar voltam ao agendamento.
export async function releaseQueuedForInstance(q, instanceId, reason) {
  const { rows } = await q.query(
    `select * from wa_dispatch.outbound_messages where instance_id = $1 and status = 'queued' for update`, [instanceId]
  );
  for (const m of rows) {
    await instancesRepo.releaseDailySlot(q, instanceId, m.reserved_usage_date);
    await q.query(
      `update wa_dispatch.outbound_messages set status = 'scheduled', instance_id = null, reserved_usage_date = null, updated_at = now() where id = $1`, [m.id]
    );
    await q.query(
      `insert into wa_dispatch.message_events (outbound_message_id, instance_id, event_type, status, detail) values ($1,$2,'released','scheduled',$3)`,
      [m.id, instanceId, JSON.stringify({ reason })]
    );
  }
  return rows.length;
}

// Ações administrativas: habilitar/desabilitar, ativar, pausar, retomar, suspender.
export async function changeOperational(ctx, id, action, { reason = null, allow_incomplete_profile = false } = {}, actor) {
  return ctx.db.tx(async (q) => {
    const i = await instancesRepo.getInstance(q, id, { forUpdate: true });
    if (!i) throw notFound("Instância não encontrada.");
    switch (action) {
      case "enable":
        await instancesRepo.updateInstance(q, id, { enabled: true });
        break;
      case "disable":
        await instancesRepo.updateInstance(q, id, { enabled: false });
        if (i.operational_state !== "inactive") await setOperational(q, i, "inactive", null);
        await releaseQueuedForInstance(q, id, "instancia_desabilitada");
        break;
      case "activate":
      case "resume": {
        if (!i.enabled) throw conflict("Habilite a instância antes de ativar.");
        if (i.connection_state !== "connected") throw conflict("A instância só pode enviar depois da conexão confirmada (verify).");
        if (i.operational_state === "suspended" && !reason) throw badRequest("Retomar uma instância suspensa exige motivo.");
        const profileDone = ["completed", "completed_with_limitations"].includes(i.profile_state);
        if (!profileDone && !allow_incomplete_profile) throw conflict(`Perfil ainda não configurado (profile_state=${i.profile_state}).`);
        await setOperational(q, i, "active", null);
        break;
      }
      case "pause":
        await setOperational(q, i, "paused", reason || "pausa_administrativa");
        await releaseQueuedForInstance(q, id, "instancia_pausada");
        break;
      case "suspend":
        if (!reason) throw badRequest("Suspensão exige motivo.");
        await setOperational(q, i, "suspended", reason);
        await releaseQueuedForInstance(q, id, "instancia_suspensa");
        break;
      default:
        throw badRequest("Ação desconhecida.");
    }
    await compliance.audit(q, { actor, action: `instance.${action}`, entityType: "instance", entityId: id, detail: { reason, allow_incomplete_profile } });
    return instancesRepo.getInstance(q, id);
  });
}

// Erro do provedor que afeta o número inteiro: interrompe os envios dessa instância e registra o motivo.
export async function applyInstanceImpact(ctx, q, instance, impact, message) {
  const current = await instancesRepo.getInstance(q, instance.id, { forUpdate: true });
  const reason = `${impact}: ${message || ""}`.slice(0, 300);
  await instancesRepo.updateInstance(q, current.id, { last_error: reason, last_error_at: new Date() });
  if (impact === "auth" || impact === "restricted") {
    if (current.operational_state !== "suspended") await setOperational(q, current, "suspended", reason);
  } else if (impact === "quality") {
    if (current.operational_state === "active") await setOperational(q, current, "paused", reason);
  } else if (impact === "disconnected" || impact === "not_configured") {
    const target = impact === "disconnected" ? "disconnected" : "not_configured";
    if ((CONNECTION_TRANSITIONS[current.connection_state] || []).includes(target)) {
      await instancesRepo.updateInstance(q, current.id, { connection_state: target });
    }
  }
  await releaseQueuedForInstance(q, current.id, `instancia_${impact}`);
  await compliance.audit(q, { actor: "sistema", action: "instance.provider_impact", entityType: "instance", entityId: current.id, detail: { impact, reason } });
  ctx.logger.warn({ instance: current.name, impact }, "envios da instância interrompidos por erro do provedor");
}

// Checagem periódica (agendador): confirma a conexão de quem está habilitado e não suspenso.
// Desconectada → tenta de novo no próximo ciclo ('reconnecting'); a Cloud API não tem operação de "reconectar".
export async function healthCheckAll(ctx) {
  const all = await instancesRepo.listInstances(ctx.db);
  const results = [];
  for (const i of all) {
    if (!i.enabled || i.operational_state === "suspended") continue;
    if (i.connection_state === "disconnected") {
      await ctx.db.tx(async (q) => setConnection(q, await instancesRepo.getInstance(q, i.id, { forUpdate: true }), "reconnecting", {}));
    }
    try {
      results.push({ id: i.id, ...(await verifyConnection(ctx, i.id, "sistema:health")) });
    } catch (error) {
      results.push({ id: i.id, error: sanitizeText(error?.message, 200) });
    }
  }
  return results;
}
