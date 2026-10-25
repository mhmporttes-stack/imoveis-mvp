import * as schemas from "../validation/schemas.js";
import * as dispatch from "../services/dispatch.js";
import * as suppression from "../services/suppression.js";
import * as instances from "../services/instances.js";
import * as onboarding from "../services/onboarding.js";
import { collectStats } from "../services/stats.js";
import { handleMetaWebhook } from "../services/webhook-processing.js";
import { verifySubscription } from "../whatsapp/webhooks.js";
import * as leadsRepo from "../repositories/leads.js";
import * as messagesRepo from "../repositories/messages.js";
import * as compliance from "../repositories/compliance.js";
import * as operations from "../repositories/operations.js";
import { normalizePhone } from "../utils/phone.js";
import { badRequest, notFound, conflict } from "../utils/errors.js";
import { withTimeout } from "../queue/index.js";

const uuid = (value) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))) throw notFound();
  return value;
};

export function createControllers(ctx) {
  return {
    health: (req, res) => res.json({ status: "ok", service: "whatsapp-dispatch-service", uptime_s: Math.round(process.uptime()) }),

    // Pronto = banco respondendo com migrações aplicadas E Redis respondendo. Sem Redis: 503 (pedidos de lead
    // continuam aceitos e persistidos no Postgres; o enfileiramento é retomado quando o Redis volta).
    async ready(req, res) {
      const checks = { database: false, migrations: false, redis: false };
      try {
        await withTimeout(ctx.db.query("select 1"), 2000, "db timeout");
        checks.database = true;
        const { rows } = await ctx.db.query("select count(*)::int as n from wa_dispatch.schema_migrations");
        checks.migrations = rows[0].n > 0;
      } catch { /* checks ficam false */ }
      try { checks.redis = ctx.queue ? await ctx.queue.ping() : false; } catch { checks.redis = false; }
      const ready = Object.values(checks).every(Boolean);
      res.status(ready ? 200 : 503).json({ ready, checks });
    },

    async createLead(req, res) {
      const input = schemas.leadSchema.parse({ ...req.body, idempotency_key: req.body?.idempotency_key || req.headers["idempotency-key"] || undefined });
      const { lead, message, created } = await dispatch.createLead(ctx, input, req.actor);
      res.status(created ? 202 : 200).json({
        created, lead: { id: lead.id, crm_lead_id: lead.crm_lead_id, status: lead.status, rejection_reason: lead.rejection_reason },
        job: { id: message.id, status: message.status }
      });
    },

    async getLead(req, res) {
      const lead = await leadsRepo.getLead(ctx.db, uuid(req.params.id));
      if (!lead) throw notFound("Lead não encontrado.");
      const message = await messagesRepo.getMessageByLead(ctx.db, lead.id);
      res.json({ lead, job: message ? dispatch.presentMessage(message) : null });
    },

    async findLeads(req, res) {
      if (!req.query.crm_lead_id) throw badRequest("Informe crm_lead_id.");
      const leads = await leadsRepo.findLeadsByCrmId(ctx.db, String(req.query.crm_lead_id).slice(0, 100));
      res.json({ leads });
    },

    async getJob(req, res) {
      res.json(await dispatch.getJob(ctx, uuid(req.params.id)));
    },

    async getConsent(req, res) {
      const phone = normalizePhone(req.query.phone, ctx.config.DEFAULT_COUNTRY_CODE);
      if (!phone) throw badRequest("Telefone inválido.");
      res.json({ phone_e164: phone, records: await compliance.listConsent(ctx.db, phone) });
    },

    async revokeConsent(req, res) {
      res.status(201).json(await suppression.revokeConsent(ctx, schemas.revocationSchema.parse(req.body), req.actor));
    },

    async addSuppression(req, res) {
      const result = await suppression.addSuppression(ctx, schemas.suppressionSchema.parse(req.body), req.actor);
      res.status(201).json({ phone_e164: result.suppression.phone_e164, active: result.suppression.active, cancelled_pending: result.cancelled });
    },

    async getSuppression(req, res) {
      res.json(await suppression.getSuppressionStatus(ctx, req.params.phone));
    },

    async deactivateSuppression(req, res) {
      const body = schemas.suppressionDeactivateSchema.parse(req.body);
      res.json(await suppression.deactivateSuppression(ctx, { phone: req.params.phone, ...body }, req.actor));
    },

    async listInstances(req, res) {
      res.json({ instances: await instances.listInstances(ctx) });
    },

    async getInstance(req, res) {
      res.json(await instances.getInstanceDetail(ctx, uuid(req.params.id)));
    },

    async createInstance(req, res) {
      const row = await instances.createInstance(ctx, schemas.instanceCreateSchema.parse(req.body), req.actor);
      res.status(201).json({ instance: instances.presentInstance(row) });
    },

    async updateInstance(req, res) {
      const row = await instances.updateInstanceConfig(ctx, uuid(req.params.id), schemas.instanceUpdateSchema.parse(req.body), req.actor);
      if (!row) throw notFound("Instância não encontrada.");
      res.json({ instance: instances.presentInstance(row) });
    },

    async verifyInstance(req, res) {
      res.json(await instances.verifyConnection(ctx, uuid(req.params.id), req.actor));
    },

    instanceAction: (action) => async (req, res) => {
      const body = schemas.instanceActionSchema.parse(req.body || {});
      const row = await instances.changeOperational(ctx, uuid(req.params.id), action, body, req.actor);
      res.json({ instance: instances.presentInstance(row) });
    },

    async startOnboarding(req, res) {
      const run = await onboarding.startOnboardingIfNeeded(ctx, uuid(req.params.id), { force: true, actor: req.actor });
      if (!run) throw conflict("Onboarding só começa com a conexão confirmada.");
      res.status(202).json({ onboarding: await onboarding.runOnboarding(ctx, run.id) });
    },

    async listCampaigns(req, res) {
      res.json({ campaigns: await leadsRepo.listCampaigns(ctx.db) });
    },

    async createCampaign(req, res) {
      const data = schemas.campaignCreateSchema.parse(req.body);
      const row = await ctx.db.tx(async (q) => {
        if (await leadsRepo.getCampaignByCode(q, data.code)) throw conflict("Campanha já existe.");
        const c = await leadsRepo.insertCampaign(q, data);
        await compliance.audit(q, { actor: req.actor, action: "campaign.create", entityType: "campaign", entityId: c.code });
        return c;
      });
      res.status(201).json({ campaign: row });
    },

    async updateCampaign(req, res) {
      const data = schemas.campaignUpdateSchema.parse(req.body);
      const row = await ctx.db.tx(async (q) => {
        const c = await leadsRepo.updateCampaign(q, req.params.code, data);
        if (!c) throw notFound("Campanha não encontrada.");
        await compliance.audit(q, { actor: req.actor, action: "campaign.update", entityType: "campaign", entityId: c.code, detail: { fields: Object.keys(data) } });
        return c;
      });
      res.json({ campaign: row });
    },

    async stats(req, res) {
      res.json(await collectStats(ctx));
    },

    async failures(req, res) {
      res.json({ failures: await operations.listFailures(ctx.db, Math.min(Number(req.query.limit) || 100, 500)) });
    },

    async auditLogs(req, res) {
      const entityType = req.query.entity_type ? String(req.query.entity_type).slice(0, 40) : null;
      res.json({ logs: await compliance.listAudit(ctx.db, { limit: Math.min(Number(req.query.limit) || 100, 500), entityType }) });
    },

    async resolveUnknown(req, res) {
      res.json({ job: await dispatch.resolveUnknown(ctx, uuid(req.params.id), schemas.resolveUnknownSchema.parse(req.body), req.actor) });
    },

    webhookVerify(req, res) {
      const challenge = verifySubscription(req.query, ctx.config.WA_WEBHOOK_VERIFY_TOKEN);
      if (!challenge) return res.status(403).json({ error: "Verificação recusada." });
      res.type("text/plain").send(challenge);
    },

    async webhookReceive(req, res) {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const result = await handleMetaWebhook(ctx, raw, req.headers["x-hub-signature-256"]);
      res.status(result.status).json(result.body);
    }
  };
}
