import * as operations from "../repositories/operations.js";
import * as messagesRepo from "../repositories/messages.js";
import * as instancesRepo from "../repositories/instances.js";
import * as compliance from "../repositories/compliance.js";
import { isSignatureValid, parseCloudWebhook } from "../whatsapp/webhooks.js";
import { RECIPIENT_OPT_OUT_CODES } from "../whatsapp/graph-client.js";
import { suppressPhone } from "./suppression.js";
import { applyInstanceImpact, verifyConnection } from "./instances.js";
import { sha256Hex } from "../utils/crypto.js";
import { normalizePhone, digitsOf } from "../utils/phone.js";
import { sanitizeText } from "../utils/logger.js";

// Processamento dos webhooks da Cloud API. Anti-replay: o mesmo corpo (sha256) só é processado uma vez; além disso
// as transições de status são monotônicas (um evento antigo nunca rebaixa delivered/read).
const RANK = { accepted: 1, delivered: 2, read: 3, replied: 4 };
const PRE_ACCEPT = new Set(["sending", "unknown_pending_verification", "unknown_needs_review"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleMetaWebhook(ctx, rawBody, signatureHeader) {
  if (!ctx.config.WA_APP_SECRET) return { status: 503, body: { error: "Webhook não configurado (WA_APP_SECRET ausente)." } };
  const hash = sha256Hex(rawBody);
  if (!isSignatureValid(rawBody, signatureHeader, ctx.config.WA_APP_SECRET)) {
    await operations.insertWebhookEvent(ctx.db, { provider: "meta_cloud_api", dedupeKey: `invalid:${hash}`, signatureValid: false, eventKind: "invalid_signature" }).catch(() => null);
    ctx.logger.warn({ hash: hash.slice(0, 12) }, "webhook com assinatura inválida recusado");
    return { status: 401, body: { error: "Assinatura inválida." } };
  }
  let body;
  try { body = JSON.parse(rawBody.toString("utf8")); } catch { return { status: 400, body: { error: "JSON inválido." } }; }
  const eventId = await operations.insertWebhookEvent(ctx.db, { provider: "meta_cloud_api", dedupeKey: hash, signatureValid: true, eventKind: body?.object || null });
  if (!eventId) return { status: 200, body: { ok: true, duplicate: true } };

  const events = parseCloudWebhook(body);
  const summary = { statuses: 0, incoming: 0, opt_outs: 0, unmatched: 0, other: 0 };
  let error = null;
  try {
    for (const event of events) await processEvent(ctx, event, summary);
  } catch (e) {
    error = sanitizeText(e?.message, 300);
    ctx.logger.error({ err: error }, "falha ao processar webhook");
  }
  await operations.finishWebhookEvent(ctx.db, eventId, { error, summary });
  // 200 mesmo com erro interno registrado: a Meta reenviaria o mesmo corpo, que seria descartado como replay.
  // O erro fica em webhook_events.processing_error para análise.
  return { status: 200, body: { ok: true } };
}

async function processEvent(ctx, event, summary) {
  if (event.kind === "status") return processStatus(ctx, event, summary);
  if (event.kind === "incoming") return processIncoming(ctx, event, summary);
  if (event.kind === "account") {
    summary.other += 1;
    if (!event.blocking || !event.wabaId) return;
    const { rows } = await ctx.db.query(
      `select * from wa_dispatch.whatsapp_instances where provider = 'meta_cloud_api' and provider_config ->> 'waba_id' = $1`, [String(event.wabaId)]
    );
    for (const instance of rows) {
      await ctx.db.tx((q) => applyInstanceImpact(ctx, q, instance, "restricted", `account_update ${event.event}`));
    }
    return;
  }
  if (event.kind === "quality") {
    summary.other += 1;
    // Reconsulta o número (quality_rating/status) pela API documentada em vez de interpretar o evento.
    const { rows } = await ctx.db.query(`select id, phone_e164 from wa_dispatch.whatsapp_instances where provider = 'meta_cloud_api'`);
    for (const i of rows) {
      if (event.displayPhoneNumber && digitsOf(i.phone_e164) === digitsOf(event.displayPhoneNumber)) await verifyConnection(ctx, i.id, "sistema:webhook_qualidade");
    }
    return;
  }
  summary.other += 1;
}

async function processStatus(ctx, event, summary) {
  summary.statuses += 1;
  await ctx.db.tx(async (q) => {
    let m = event.providerMessageId ? await messagesRepo.findMessageByProviderId(q, event.providerMessageId, { forUpdate: true }) : null;
    if (!m && event.callbackData && UUID.test(event.callbackData)) {
      const candidate = await messagesRepo.getMessage(q, event.callbackData, { forUpdate: true });
      // Confere telefone além do id: callback de outra origem nunca altera um trabalho.
      if (candidate && (!event.recipient || digitsOf(candidate.phone_e164) === digitsOf(event.recipient))) m = candidate;
    }
    if (!m) { summary.unmatched += 1; return; }
    const at = event.timestamp || new Date();
    const status = event.status;

    if (PRE_ACCEPT.has(m.status) && ["sent", "delivered", "read"].includes(status)) {
      // Resultado desconhecido resolvido pela confirmação real do provedor.
      await messagesRepo.updateMessage(q, m.id, {
        status: "accepted", provider_message_id: event.providerMessageId, accepted_at: at, sending_lock_expires_at: null
      });
      await instancesRepo.recordAccepted(q, m.instance_id, m.reserved_usage_date);
      await q.query(`update wa_dispatch.leads set status = 'completed', updated_at = now() where id = $1`, [m.lead_id]);
      await messagesRepo.addEvent(q, { messageId: m.id, instanceId: m.instance_id, type: "unknown_resolved_by_webhook", status: "accepted", providerMessageId: event.providerMessageId, occurredAt: at, detail: { previous: m.status } });
      m = await messagesRepo.getMessage(q, m.id);
    }

    await messagesRepo.addEvent(q, { messageId: m.id, instanceId: m.instance_id, type: `provider_${status}`, status, providerMessageId: event.providerMessageId, occurredAt: at, detail: { errors: event.errors } });
    if (status === "delivered" && (RANK[m.status] || 0) < RANK.delivered) {
      await messagesRepo.updateMessage(q, m.id, { status: "delivered", delivered_at: at });
      await instancesRepo.incrementCounter(q, m.instance_id, "total_delivered");
    } else if (status === "read" && (RANK[m.status] || 0) < RANK.read) {
      await messagesRepo.updateMessage(q, m.id, { status: "read", read_at: at, delivered_at: m.delivered_at || at });
      await instancesRepo.incrementCounter(q, m.instance_id, "total_read");
    } else if (status === "failed" && (RANK[m.status] || 0) <= RANK.accepted) {
      const code = event.errors[0]?.code || null;
      await messagesRepo.updateMessage(q, m.id, { status: "failed", failed_at: at, last_error_code: code, last_error_message: event.errors[0]?.title || "falha informada pelo provedor" });
      await instancesRepo.incrementCounter(q, m.instance_id, "total_failed");
      if (code && RECIPIENT_OPT_OUT_CODES.has(code)) {
        await suppressPhone(ctx, q, { phone: m.phone_e164, reason: `provedor_${code}_cliente_optou_por_nao_receber`, source: "provider", actor: "sistema:webhook" });
      }
    }
  });
}

async function processIncoming(ctx, event, summary) {
  summary.incoming += 1;
  const phone = normalizePhone(`+${digitsOf(event.from)}`);
  if (!phone) return;
  const instance = event.phoneNumberId ? await instancesRepo.findInstanceByProviderKey(ctx.db, "meta_cloud_api", "phone_number_id", event.phoneNumberId) : null;
  const text = String(event.text || "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const optOut = ctx.config.OPT_OUT_KEYWORDS.map((k) => k.toUpperCase()).includes(text);
  await ctx.db.tx(async (q) => {
    if (optOut) {
      summary.opt_outs += 1;
      await compliance.insertConsentRecord(q, { phone_e164: phone, purpose: "*", state: "revoked", origin: "resposta_do_cliente", verifier: "webhook", revoked_at: new Date(), reason: "palavra_de_saida" });
      await suppressPhone(ctx, q, { phone, reason: "cliente_pediu_para_sair", source: "reply_opt_out", actor: "sistema:webhook" });
    }
    const last = await messagesRepo.latestSentToPhone(q, phone, instance?.id || null);
    if (last) {
      await messagesRepo.updateMessage(q, last.id, { status: "replied", replied_at: event.timestamp || new Date() });
      await messagesRepo.addEvent(q, { messageId: last.id, instanceId: last.instance_id, type: "incoming_reply", status: "replied", providerMessageId: event.providerMessageId, detail: { opt_out: optOut, type: event.type } });
    }
  });
}
