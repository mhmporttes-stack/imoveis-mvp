import * as leadsRepo from "../repositories/leads.js";
import * as messagesRepo from "../repositories/messages.js";
import * as instancesRepo from "../repositories/instances.js";
import * as compliance from "../repositories/compliance.js";
import { authorize } from "./authorization.js";
import { suppressPhone } from "./suppression.js";
import { applyInstanceImpact } from "./instances.js";
import { normalizePhone } from "../utils/phone.js";
import { backoffDelay, isWithinWindow, localDate } from "../utils/time.js";
import { maskPhone, sanitizeText } from "../utils/logger.js";
import { badRequest, conflict, notFound } from "../utils/errors.js";
import { RECIPIENT_OPT_OUT_CODES } from "../whatsapp/graph-client.js";

// Ciclo de vida de uma mensagem (outbound_messages.status):
// requested → (autorização) → scheduled → (instância reservada) → queued → (worker) → sending → accepted
//   → delivered → read → replied           (só por confirmação real do provedor / resposta do cliente)
// falha temporária → scheduled com backoff · permanente → failed · desconhecida → unknown_pending_verification
//   → (webhook confirma) accepted… | (sem confirmação no prazo) unknown_needs_review (decisão humana; nunca reenvio automático)
// bloqueio (não contato/revogação/duplicado) → cancelled; lead rejected/cancelled.

// ---------- Entrada (API) ----------
export async function createLead(ctx, input, actor) {
  const phone = normalizePhone(input.phone, ctx.config.DEFAULT_COUNTRY_CODE);
  if (!phone) throw badRequest("Telefone inválido (Brasil: celular com DDD).");
  const campaign = await leadsRepo.getCampaignByCode(ctx.db, input.campaign_code);
  if (!campaign) throw badRequest("Campanha inexistente.", { campaign_code: input.campaign_code });
  const idempotencyKey = input.idempotency_key || `${input.crm_lead_id}:${campaign.code}`;

  return ctx.db.tx(async (q) => {
    const { lead, created } = await leadsRepo.insertLeadIdempotent(q, {
      crm_lead_id: input.crm_lead_id, phone_e164: phone, campaign_id: campaign.id,
      consent_reference: input.consent_reference, idempotency_key: idempotencyKey
    });
    if (!created && (lead.phone_e164 !== phone || lead.campaign_id !== campaign.id || lead.crm_lead_id !== input.crm_lead_id)) {
      throw conflict("Chave de idempotência já usada com outros dados.", "idempotency_mismatch");
    }
    const message = await messagesRepo.insertMessage(q, {
      lead_id: lead.id, campaign_id: campaign.id, phone_e164: phone, max_attempts: ctx.config.MAX_SEND_ATTEMPTS
    });
    if (created) {
      await messagesRepo.addEvent(q, { messageId: message.id, type: "requested", status: "requested", detail: { actor } });
      await compliance.audit(q, { actor, action: "lead.create", entityType: "lead", entityId: lead.id, detail: { campaign: campaign.code } });
      // Não contato tem prioridade: recusa já na entrada (o lead fica registrado com o motivo).
      const suppression = await compliance.getSuppression(q, phone);
      if (suppression?.active) {
        await rejectLead(ctx, q, lead, message, "lista_de_nao_contato");
        return { lead: await leadsRepo.getLead(q, lead.id), message: await messagesRepo.getMessage(q, message.id), created };
      }
    }
    return { lead, message, created };
  });
}

async function rejectLead(ctx, q, lead, message, reason) {
  await leadsRepo.setLeadStatus(q, lead.id, "rejected", reason);
  await cancelMessage(q, message, reason, "rejected");
}

async function cancelMessage(q, message, reason, eventType = "cancelled") {
  if (message.status === "queued" || message.reserved_usage_date) {
    await instancesRepo.releaseDailySlot(q, message.instance_id, message.reserved_usage_date);
  }
  await messagesRepo.updateMessage(q, message.id, {
    status: "cancelled", cancelled_at: new Date(), cancel_reason: reason, reserved_usage_date: null
  });
  await messagesRepo.addEvent(q, { messageId: message.id, instanceId: message.instance_id, type: eventType, status: "cancelled", detail: { reason } });
}

// Cancela tudo o que ainda não saiu para o telefone (não contato / revogação). Mensagem já em envio não é interrompida
// aqui; o worker confere a lista antes de chamar o provedor.
export async function cancelPendingForPhone(ctx, q, phone, reason, purpose = null) {
  const pending = await messagesRepo.pendingForPhone(q, phone, purpose);
  for (const message of pending) {
    await cancelMessage(q, message, reason);
    await leadsRepo.setLeadStatus(q, message.lead_id, "cancelled", reason);
  }
  return pending.length;
}

export async function getJob(ctx, id) {
  const message = await messagesRepo.getMessage(ctx.db, id);
  if (!message) throw notFound("Trabalho não encontrado.");
  const events = await messagesRepo.listEvents(ctx.db, id);
  return { job: presentMessage(message), events };
}

export function presentMessage(m) {
  return {
    id: m.id, lead_id: m.lead_id, campaign_id: m.campaign_id, instance_id: m.instance_id, status: m.status,
    attempts: m.attempts, max_attempts: m.max_attempts, next_attempt_at: m.next_attempt_at, provider_message_id: m.provider_message_id,
    pacing_status: m.pacing_status,
    timeline: {
      requested_at: m.requested_at, authorized_at: m.authorized_at, queued_at: m.queued_at, sending_started_at: m.sending_started_at,
      accepted_at: m.accepted_at, delivered_at: m.delivered_at, read_at: m.read_at, replied_at: m.replied_at,
      failed_at: m.failed_at, cancelled_at: m.cancelled_at
    },
    last_error_code: m.last_error_code, last_error_message: m.last_error_message, cancel_reason: m.cancel_reason
  };
}

// ---------- Agendador: autorização ----------
export async function authorizeRequested(ctx) {
  const { rows } = await ctx.db.query(
    `select id from wa_dispatch.outbound_messages where status = 'requested' and next_attempt_at <= now() order by created_at limit $1`, [ctx.config.SCHEDULER_BATCH_SIZE]
  );
  let done = 0;
  for (const { id } of rows) {
    await ctx.db.tx(async (q) => {
      const message = await messagesRepo.getMessage(q, id, { forUpdate: true });
      if (!message || message.status !== "requested") return;
      const lead = await leadsRepo.getLead(q, message.lead_id);
      const campaign = await leadsRepo.getCampaign(q, message.campaign_id);
      const result = await authorize(ctx, q, { message, lead, campaign, phase: "schedule" });
      await applyAuthorization(ctx, q, { message, lead, result, onOk: async () => {
        await leadsRepo.setLeadStatus(q, lead.id, "authorized");
        await messagesRepo.updateMessage(q, id, { status: "scheduled", authorized_at: new Date() });
        await messagesRepo.addEvent(q, { messageId: id, type: "authorized", status: "scheduled", detail: { consent_record: result.consent?.id } });
      } });
      done += 1;
    });
  }
  return done;
}

async function applyAuthorization(ctx, q, { message, lead, result, onOk }) {
  if (result.ok) return onOk();
  if (result.scope === "lead") {
    if (result.suppress) {
      await suppressPhone(ctx, q, { phone: message.phone_e164, reason: result.reason, source: "crm", actor: "sistema:consentimento" });
    }
    const fresh = await messagesRepo.getMessage(q, message.id);
    if (fresh.status !== "cancelled") await rejectLead(ctx, q, lead, fresh, result.reason);
    else await leadsRepo.setLeadStatus(q, lead.id, "rejected", result.reason); // a supressão já cancelou o trabalho
    ctx.logger.info({ messageId: message.id, phone: maskPhone(message.phone_e164), reason: result.reason }, "lead recusado na autorização");
    return;
  }
  if (result.scope === "campaign" && result.action === "cancel") {
    await leadsRepo.setLeadStatus(q, lead.id, "cancelled", result.reason);
    await cancelMessage(q, message, result.reason);
    return;
  }
  // Campanha pausada/não iniciada: tenta de novo mais tarde, sem consumir tentativa.
  await messagesRepo.updateMessage(q, message.id, { next_attempt_at: new Date(Date.now() + 60000) });
}

// ---------- Agendador: reserva de instância (rodízio) e enfileiramento ----------
export async function assignInstances(ctx) {
  const assigned = await ctx.db.tx(async (q) => {
    const batch = await messagesRepo.lockBatch(q, ["scheduled"], ctx.config.SCHEDULER_BATCH_SIZE);
    if (!batch.length) return [];
    const candidates = await instancesRepo.lockEligibleCandidates(q);
    const now = ctx.now();
    const pool = candidates.filter((i) => isWithinWindow(i.send_window, i.timezone, now));
    const result = [];
    for (const message of batch) {
      const campaign = await leadsRepo.getCampaign(q, message.campaign_id);
      if (!campaign?.enabled) continue;
      let chosen = null;
      for (let i = 0; i < pool.length && !chosen; i += 1) {
        const instance = pool[i];
        if (campaign.message_type === "template" && instance.provider !== "meta_cloud_api") continue;
        const usageDate = localDate(instance.timezone, now);
        if (await instancesRepo.reserveDailySlot(q, instance.id, usageDate, instance.daily_limit)) {
          chosen = { instance, usageDate };
          pool.splice(i, 1);
          // Intervalo mínimo zero: volta para o fim da fila (rodízio). Caso contrário, só no próximo ciclo.
          if (instance.min_interval_seconds === 0) pool.push(instance);
        }
      }
      if (!chosen) continue; // nenhuma instância elegível/sem cota: espera; nunca força envio
      await messagesRepo.updateMessage(q, message.id, {
        status: "queued", instance_id: chosen.instance.id, reserved_usage_date: chosen.usageDate, queued_at: new Date()
      });
      await instancesRepo.updateInstance(q, chosen.instance.id, { last_assigned_at: new Date() });
      await messagesRepo.addEvent(q, { messageId: message.id, instanceId: chosen.instance.id, type: "queued", status: "queued", detail: { usage_date: chosen.usageDate } });
      result.push(message.id);
    }
    return result;
  });
  await enqueue(ctx, assigned);
  return assigned.length;
}

async function enqueue(ctx, ids) {
  if (!ids.length || !ctx.queue) return 0;
  let ok = 0;
  for (const id of ids) {
    try {
      await ctx.queue.addSend(id);
      ok += 1;
    } catch (error) {
      // Redis fora: o trabalho continua 'queued' no Postgres e é reenfileirado na recuperação (requeueQueued).
      ctx.logger.warn({ messageId: id, err: sanitizeText(error?.message) }, "falha ao enfileirar; ficará para a recuperação");
      break;
    }
  }
  return ok;
}

// Recuperação: tudo que está 'queued' no banco volta para a fila (jobId = id da mensagem → sem duplicar).
export async function requeueQueued(ctx) {
  const { rows } = await ctx.db.query(
    `select id from wa_dispatch.outbound_messages where status = 'queued' order by queued_at limit $1`, [ctx.config.SCHEDULER_BATCH_SIZE * 4]
  );
  return enqueue(ctx, rows.map((r) => r.id));
}

// Worker caiu no meio de uma chamada ao provedor: não dá para saber se saiu → verificação (nunca reenvio direto).
export async function recoverStaleSending(ctx) {
  return ctx.db.tx(async (q) => {
    const stale = await messagesRepo.lockBatch(q, ["sending"], ctx.config.SCHEDULER_BATCH_SIZE, {
      dueOnly: false, extraWhere: "and sending_lock_expires_at < now()"
    });
    for (const m of stale) {
      await messagesRepo.updateMessage(q, m.id, { status: "unknown_pending_verification", last_error_code: "worker_lost", last_error_message: "Processamento interrompido durante o envio." });
      await messagesRepo.addEvent(q, { messageId: m.id, instanceId: m.instance_id, type: "send_unknown", status: "unknown_pending_verification", attempt: m.attempts, detail: { reason: "worker_lost" } });
    }
    return stale.length;
  });
}

// Resultado desconhecido: verifica no provedor quando ele oferece consulta; a Cloud API não oferece (só webhook com
// biz_opaque_callback_data). Sem confirmação dentro da janela → revisão humana. Nunca reenvia sozinho.
export async function verifyUnknown(ctx) {
  const { rows } = await ctx.db.query(
    `select id from wa_dispatch.outbound_messages where status = 'unknown_pending_verification' order by updated_at limit $1`,
    [ctx.config.SCHEDULER_BATCH_SIZE]
  );
  let resolved = 0;
  for (const { id } of rows) {
    const m = await messagesRepo.getMessage(ctx.db, id);
    const instance = m.instance_id ? await instancesRepo.getInstance(ctx.db, m.instance_id) : null;
    const adapter = instance ? ctx.adapters.get(instance.provider) : null;
    let found = null;
    if (adapter?.supports("getMessageStatus")) {
      try { found = await adapter.getMessageStatus(instance, m); } catch { found = null; }
    }
    await ctx.db.tx(async (q) => {
      const cur = await messagesRepo.getMessage(q, id, { forUpdate: true });
      if (cur.status !== "unknown_pending_verification") return;
      if (found?.providerMessageId) {
        await markAccepted(ctx, q, cur, { providerMessageId: found.providerMessageId, pacingStatus: null }, "unknown_resolved_by_provider");
        resolved += 1;
        return;
      }
      const age = Date.now() - new Date(cur.updated_at).getTime();
      if (age >= ctx.config.UNKNOWN_VERIFICATION_WINDOW_MS) {
        await messagesRepo.updateMessage(q, id, { status: "unknown_needs_review" });
        await messagesRepo.addEvent(q, { messageId: id, instanceId: cur.instance_id, type: "unknown_needs_review", status: "unknown_needs_review", detail: { waited_ms: age } });
        resolved += 1;
      }
    });
  }
  return resolved;
}

async function markAccepted(ctx, q, message, { providerMessageId, pacingStatus }, eventType = "send_accepted", processingMs = null) {
  await messagesRepo.updateMessage(q, message.id, {
    status: "accepted", provider_message_id: providerMessageId, pacing_status: pacingStatus, accepted_at: new Date(),
    sending_lock_expires_at: null, last_error_code: null, last_error_message: null, processing_ms: processingMs
  });
  await instancesRepo.recordAccepted(q, message.instance_id, message.reserved_usage_date);
  await leadsRepo.setLeadStatus(q, message.lead_id, "completed");
  await messagesRepo.addEvent(q, { messageId: message.id, instanceId: message.instance_id, type: eventType, status: "accepted", attempt: message.attempts, providerMessageId });
}

// ---------- Worker ----------
export async function processMessage(ctx, messageId, workerId = "worker") {
  const started = Date.now();
  const prepared = await ctx.db.tx(async (q) => {
    const message = await messagesRepo.getMessage(q, messageId, { forUpdate: true });
    if (!message || message.status !== "queued") return { skip: message ? message.status : "missing" };
    const lead = await leadsRepo.getLead(q, message.lead_id);
    const campaign = await leadsRepo.getCampaign(q, message.campaign_id);
    const instance = await instancesRepo.getInstance(q, message.instance_id);
    const result = await authorize(ctx, q, { message, lead, campaign, instance, phase: "send" });
    if (!result.ok) {
      if (result.scope === "instance" || (result.scope === "campaign" && result.action === "wait")) {
        await releaseToSchedule(q, message, result.reason, new Date(Date.now() + 60000));
      } else {
        await applyAuthorization(ctx, q, { message, lead, result, onOk: async () => {} });
      }
      return { skip: `blocked:${result.reason}` };
    }
    const lockUntil = new Date(Date.now() + ctx.config.SENDING_LOCK_MS);
    const sending = await messagesRepo.updateMessage(q, messageId, {
      status: "sending", attempts: message.attempts + 1, sending_started_at: new Date(), sending_lock_expires_at: lockUntil
    }, { expectStatus: "queued" });
    await messagesRepo.addEvent(q, { messageId, instanceId: instance.id, type: "send_started", status: "sending", attempt: sending.attempts, detail: { worker: workerId } });
    return { message: sending, campaign, instance };
  });
  if (prepared.skip) return { status: "skipped", reason: prepared.skip };

  const { message, campaign, instance } = prepared;
  const adapter = ctx.adapters.get(instance.provider);
  let outcome;
  try {
    const sent = await adapter.sendMessage(instance, { to: message.phone_e164, campaign, callbackData: message.id });
    outcome = { ok: true, sent };
  } catch (error) {
    outcome = { ok: false, error };
  }
  const processingMs = Date.now() - started;

  return ctx.db.tx(async (q) => {
    const current = await messagesRepo.getMessage(q, messageId, { forUpdate: true });
    if (current.status !== "sending") {
      // O webhook já resolveu (ex.: status 'sent' chegou antes). Nada a fazer.
      return { status: current.status };
    }
    if (outcome.ok) {
      await markAccepted(ctx, q, current, outcome.sent, "send_accepted", processingMs);
      ctx.logger.info({ messageId, instance: instance.name, ms: processingMs }, "mensagem aceita pelo provedor");
      return { status: "accepted" };
    }
    return handleSendFailure(ctx, q, current, instance, campaign, outcome.error, processingMs);
  });
}

async function releaseToSchedule(q, message, reason, nextAt) {
  await instancesRepo.releaseDailySlot(q, message.instance_id, message.reserved_usage_date);
  await messagesRepo.updateMessage(q, message.id, {
    status: "scheduled", instance_id: null, reserved_usage_date: null, next_attempt_at: nextAt, sending_lock_expires_at: null
  });
  await messagesRepo.addEvent(q, { messageId: message.id, instanceId: message.instance_id, type: "released", status: "scheduled", detail: { reason } });
}

const INSTANCE_LEVEL = new Set(["auth", "restricted", "quality", "disconnected", "not_configured"]);

async function handleSendFailure(ctx, q, message, instance, campaign, error, processingMs) {
  const kind = error?.kind || "unknown";
  const code = error?.code || null;
  const detail = { provider: instance.provider, code, kind, http_status: error?.httpStatus ?? null, impact: error?.instanceImpact ?? null };
  const base = { last_error_code: code, last_error_message: sanitizeText(error?.message, 300), processing_ms: processingMs, sending_lock_expires_at: null };
  ctx.logger.warn({ messageId: message.id, instance: instance.name, ...detail }, "falha no envio");

  if (kind === "unknown") {
    await messagesRepo.updateMessage(q, message.id, { ...base, status: "unknown_pending_verification" });
    await messagesRepo.addEvent(q, { messageId: message.id, instanceId: instance.id, type: "send_unknown", status: "unknown_pending_verification", attempt: message.attempts, detail });
    return { status: "unknown_pending_verification" };
  }

  // Problema do número (credencial, restrição, qualidade, desconexão): para os envios dessa instância e devolve a
  // mensagem ao agendamento (o lead não tem culpa) — sem contornar bloqueio: o próprio authorize continua valendo.
  if (error?.instanceImpact && INSTANCE_LEVEL.has(error.instanceImpact)) {
    await applyInstanceImpact(ctx, q, instance, error.instanceImpact, base.last_error_message);
  }
  if (error?.instanceImpact === "template") {
    await leadsRepo.updateCampaign(q, campaign.code, { enabled: false });
    await compliance.audit(q, { actor: "sistema", action: "campaign.paused_by_provider_error", entityType: "campaign", entityId: campaign.code, detail: { code } });
  }
  if (code && RECIPIENT_OPT_OUT_CODES.has(code)) {
    await suppressPhone(ctx, q, { phone: message.phone_e164, reason: `provedor_${code}_cliente_optou_por_nao_receber`, source: "provider", actor: "sistema:provedor" });
  }

  const instanceLevel = (error?.instanceImpact && INSTANCE_LEVEL.has(error.instanceImpact)) || error?.instanceImpact === "template";
  if ((kind === "temporary" || instanceLevel) && message.attempts < message.max_attempts && !(code && RECIPIENT_OPT_OUT_CODES.has(code))) {
    const delay = error?.retryAfterMs ?? backoffDelay(message.attempts, ctx.config.RETRY_BASE_DELAY_MS, ctx.config.RETRY_MAX_DELAY_MS);
    await instancesRepo.releaseDailySlot(q, message.instance_id, message.reserved_usage_date);
    await messagesRepo.updateMessage(q, message.id, {
      ...base, status: "scheduled", instance_id: null, reserved_usage_date: null, next_attempt_at: new Date(Date.now() + delay)
    });
    await messagesRepo.addEvent(q, { messageId: message.id, instanceId: instance.id, type: "send_failed_temporary", status: "scheduled", attempt: message.attempts, detail: { ...detail, retry_in_ms: delay } });
    return { status: "scheduled", retryInMs: delay };
  }

  await instancesRepo.releaseDailySlot(q, message.instance_id, message.reserved_usage_date);
  await messagesRepo.updateMessage(q, message.id, { ...base, status: "failed", failed_at: new Date(), reserved_usage_date: null });
  await instancesRepo.incrementCounter(q, instance.id, "total_failed");
  await messagesRepo.addEvent(q, { messageId: message.id, instanceId: instance.id, type: "send_failed_permanent", status: "failed", attempt: message.attempts, detail });
  return { status: "failed" };
}

// ---------- Decisão humana sobre resultado desconhecido ----------
export async function resolveUnknown(ctx, messageId, { resolution, note }, actor) {
  return ctx.db.tx(async (q) => {
    const m = await messagesRepo.getMessage(q, messageId, { forUpdate: true });
    if (!m) throw notFound("Trabalho não encontrado.");
    if (!["unknown_pending_verification", "unknown_needs_review"].includes(m.status)) throw conflict("Trabalho não está com resultado desconhecido.");
    if (resolution === "sent") {
      await messagesRepo.updateMessage(q, m.id, { status: "accepted", accepted_at: new Date() });
      await instancesRepo.recordAccepted(q, m.instance_id, m.reserved_usage_date);
      await leadsRepo.setLeadStatus(q, m.lead_id, "completed");
    } else if (resolution === "not_sent_retry") {
      await releaseToSchedule(q, m, "revisao_humana_confirmou_nao_enviado", new Date());
    } else {
      await instancesRepo.releaseDailySlot(q, m.instance_id, m.reserved_usage_date);
      await messagesRepo.updateMessage(q, m.id, { status: "failed", failed_at: new Date(), reserved_usage_date: null });
    }
    await messagesRepo.addEvent(q, { messageId: m.id, instanceId: m.instance_id, type: "unknown_resolved_by_human", detail: { resolution, actor } });
    await compliance.audit(q, { actor, action: "message.resolve_unknown", entityType: "outbound_message", entityId: m.id, detail: { resolution, note: sanitizeText(note, 300) } });
    return presentMessage(await messagesRepo.getMessage(q, m.id));
  });
}
