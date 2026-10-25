import express from "express";
import { asyncRoute as a, authenticate, requireRole } from "../middleware/index.js";

// Papéis: crm (integração do CRM), admin (operação completa), viewer (somente leitura). admin passa em tudo.
export function buildRoutes(ctx, c) {
  const router = express.Router();
  const auth = authenticate(ctx.config);
  const crm = requireRole("crm");
  const read = requireRole("crm", "viewer");
  const admin = requireRole();
  const ops = requireRole("viewer");

  router.get("/health", c.health);
  router.get("/ready", a(c.ready));

  // Webhook da Meta (sem token: autenticado pela assinatura X-Hub-Signature-256; corpo bruto).
  router.get("/webhooks/meta", c.webhookVerify);
  router.post("/webhooks/meta", express.raw({ type: "*/*", limit: "1mb" }), a(c.webhookReceive));

  const v1 = express.Router();
  v1.use(express.json({ limit: "100kb" }));
  v1.use(auth);
  v1.post("/leads", crm, a(c.createLead));
  v1.get("/leads", read, a(c.findLeads));
  v1.get("/leads/:id", read, a(c.getLead));
  v1.get("/jobs/:id", read, a(c.getJob));
  v1.get("/consent", crm, a(c.getConsent));
  v1.post("/consent/revocations", crm, a(c.revokeConsent));
  v1.post("/suppressions", crm, a(c.addSuppression));
  v1.get("/suppressions/:phone", crm, a(c.getSuppression));
  v1.post("/suppressions/:phone/deactivate", admin, a(c.deactivateSuppression));
  v1.get("/instances", read, a(c.listInstances));
  v1.get("/instances/:id", read, a(c.getInstance));
  v1.post("/instances", admin, a(c.createInstance));
  v1.patch("/instances/:id", admin, a(c.updateInstance));
  v1.post("/instances/:id/verify", admin, a(c.verifyInstance));
  for (const action of ["enable", "disable", "activate", "pause", "resume", "suspend"]) {
    v1.post(`/instances/:id/${action}`, admin, a(c.instanceAction(action)));
  }
  v1.post("/instances/:id/onboarding", admin, a(c.startOnboarding));
  v1.get("/campaigns", read, a(c.listCampaigns));
  v1.post("/campaigns", admin, a(c.createCampaign));
  v1.patch("/campaigns/:code", admin, a(c.updateCampaign));
  v1.get("/stats", read, a(c.stats));
  v1.get("/admin/failures", ops, a(c.failures));
  v1.get("/admin/audit-logs", ops, a(c.auditLogs));
  v1.post("/admin/jobs/:id/resolve-unknown", admin, a(c.resolveUnknown));
  router.use("/v1", v1);
  return router;
}
