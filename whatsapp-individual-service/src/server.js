import { timingSafeEqual } from "node:crypto";
import express from "express";
import { connectSession, deleteMessageForEveryone, disconnectSession, editMessage, getLiveSessionStatus, isSessionActive, reactToMessage, sendMessage, setConnectGuard, suspendAllSessions } from "./sessions.js";
import { createLeaseApi, listResumableUserIds, listTransientSessionRows, readSessionRow } from "./db.js";
import { pendingWrites } from "./auth-state.js";
import { resumeSpacingMs, shouldResumeSession } from "./reconnect-policy.js";
import { createLeaseManager } from "./lease.js";
import { createResumeRunner } from "./resume.js";
import { createReconciler } from "./reconcile.js";
import { createServiceRuntime } from "./runtime.js";
import { telemetry } from "./telemetry.js";
import { notifyStatus } from "./webhook.js";

const REQUIRED_ENV = ["APP_WEBHOOK_URL", "SESSION_ENCRYPTION_KEY", "WHATSAPP_INDIVIDUAL_SERVICE_SECRET"];
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missingEnv.length) {
  console.error(`Variáveis de ambiente faltando: ${missingEnv.join(", ")}. Veja .env.example.`);
  process.exit(1);
}

// ---- Dono único das sessões (lease), retomada escalonada, reconciliação e encerramento gracioso ----
// Escotilha: WHATSAPP_LEASE_DISABLED=true liga o comportamento antigo (sem lease) sem novo deploy de código.
const envInt = (name, fallback, min, max) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
const leaseDisabled = process.env.WHATSAPP_LEASE_DISABLED === "true";
const leaseApi = createLeaseApi({ bootId: telemetry.context.bootId, deployId: telemetry.context.deployId });
const record = (userId, type, fields) => telemetry.record(userId, type, fields);

const lease = createLeaseManager({
  api: leaseDisabled
    ? { acquire: async () => ({ unavailable: true, reason: "disabled_by_env" }), renew: async () => ({ unavailable: true }), release: async () => ({ released: false }) }
    : leaseApi,
  unavailableGraceMs: leaseDisabled ? 0 : envInt("WHATSAPP_LEASE_UNAVAILABLE_GRACE_MS", 90_000, 0, 600_000),
  record: (type, fields) => record(null, type, fields),
  onLost: (reason) => runtime.onLost(reason),
  onRegained: (info) => runtime.onRegained(info)
});

const resumeRunner = createResumeRunner({
  listIds: listResumableUserIds,
  readRow: readSessionRow,
  shouldResume: shouldResumeSession,
  connect: (userId) => connectSession(userId, { trigger: "resume" }),
  isActive: isSessionActive,
  shouldAbort: () => runtime.shuttingDown || !lease.isHolder(),
  record,
  spacingMs: () => resumeSpacingMs()
});

const reconciler = createReconciler({
  listTransientRows: listTransientSessionRows,
  isActive: isSessionActive,
  notifyStatus,
  canRun: () => !runtime.shuttingDown && lease.isHolder(),
  staleMs: envInt("WHATSAPP_RECONCILE_STALE_MS", 10 * 60_000, 60_000, 3_600_000),
  record
});

const runtime = createServiceRuntime({
  lease,
  resumeRunner,
  reconciler,
  suspendAllSessions,
  flushPendingWrites: () => Promise.allSettled([...pendingWrites]),
  flushTelemetry: () => telemetry.flush(),
  record,
  settleOverrideMs: process.env.WHATSAPP_RESUME_SETTLE_MS === undefined ? null : envInt("WHATSAPP_RESUME_SETTLE_MS", null, 0, 120_000)
});
setConnectGuard(runtime.guard);

const app = express();
app.use(express.json({ limit: "1mb" }));

// Health check SEM segredo — é o que a Railway usa pra saber se o serviço está de pé, e não manda o
// header. Sempre 200 (também enquanto espera o lease: o deploy precisa ser considerado pronto para o
// serviço antigo receber o SIGTERM e liberar o lease). Só estado do lease, nada sensível.
app.get("/health", (_req, res) => res.json(runtime.health()));

function checkSecret(req, res, next) {
  const expected = process.env.WHATSAPP_INDIVIDUAL_SERVICE_SECRET || "";
  const header = req.headers["x-service-secret"] || "";
  const left = Buffer.from(String(header));
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return res.status(401).json({ error: "Assinatura inválida." });
  }
  next();
}

app.use(checkSecret);

app.post("/sessions/:userId/connect", async (req, res) => {
  try {
    // phoneNumber opcional (pedido do dono, 2026-09-30): pareamento por
    // código em vez de QR — só tem efeito numa sessão nova.
    const { phoneNumber } = req.body || {};
    const result = await connectSession(req.params.userId, { phoneNumber });
    res.json(result);
  } catch (error) {
    console.error(`[${req.params.userId}] Falha ao conectar:`, error.message);
    // Serviço aguardando o lease / reiniciando: 503 (tente de novo), não falha da sessão.
    res.status(error.code === "SERVICE_NOT_READY" ? 503 : 500).json({ error: error.message });
  }
});

app.get("/sessions/:userId/status", async (req, res) => {
  try {
    const live = getLiveSessionStatus(req.params.userId);
    if (live) return res.json(live);
    const row = await readSessionRow(req.params.userId);
    res.json({
      status: row?.status || "disconnected",
      phoneNumber: row?.phone_number || "",
      pairingCode: row?.pairing_code || null,
      lastConnectedAt: row?.last_connected_at || null,
      error: row?.last_error || ""
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/sessions/:userId/disconnect", async (req, res) => {
  try {
    await disconnectSession(req.params.userId);
    res.json({ status: "disconnected" });
  } catch (error) {
    console.error(`[${req.params.userId}] Falha ao desconectar:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

function sendError(res, error) {
  const status = error.code === "NOT_CONNECTED" ? 409 : 500;
  res.status(status).json({ error: error.message });
}

app.post("/sessions/:userId/send", async (req, res) => {
  try {
    const { to, text, media, quoted } = req.body || {};
    if (!to || (!text && !media?.url)) return res.status(400).json({ error: "Informe 'to' e 'text' (ou 'media')." });
    const result = await sendMessage(req.params.userId, { to, text, media, quoted });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

// Reação, edição e "apagar para todos" (2026-10-02).
app.post("/sessions/:userId/react", async (req, res) => {
  try {
    const { to, targetId, targetFromMe, emoji } = req.body || {};
    if (!to || !targetId) return res.status(400).json({ error: "Informe 'to' e 'targetId'." });
    res.json(await reactToMessage(req.params.userId, { to, targetId, targetFromMe, emoji }));
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/sessions/:userId/edit", async (req, res) => {
  try {
    const { to, targetId, text } = req.body || {};
    if (!to || !targetId || !text) return res.status(400).json({ error: "Informe 'to', 'targetId' e 'text'." });
    res.json(await editMessage(req.params.userId, { to, targetId, text }));
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/sessions/:userId/delete", async (req, res) => {
  try {
    const { to, targetId } = req.body || {};
    if (!to || !targetId) return res.status(400).json({ error: "Informe 'to' e 'targetId'." });
    res.json(await deleteMessageForEveryone(req.params.userId, { to, targetId }));
  } catch (error) {
    sendError(res, error);
  }
});

const port = Number(process.env.PORT) || 3100;
app.listen(port, () => {
  console.log(`whatsapp-individual-service ouvindo na porta ${port}`);
  // Marcador de boot: id do processo + versão do Baileys + origem do deploy
  // (variáveis da Railway, se houver) — vai junto de todo evento seguinte.
  telemetry.record(null, "service_boot", { detail: `baileys_${telemetry.context.baileysVersion}` });
  // Dono único: só retoma/conecta sessões depois de obter o lease (lease.js). O /health responde 200 já
  // agora (a Railway só considera o deploy pronto com healthcheck), mesmo esperando o lease.
  runtime.boot().catch((error) => console.error("Falha na inicialização do serviço:", error?.message || error));
});

// A Railway manda SIGTERM antes de matar o processo (redeploy/restart). Encerramento gracioso
// (shutdown.js): para de aceitar conexões, fecha os sockets SEM logout, grava as credenciais
// pendentes (senão o último estado do Signal se perde — erro "Bad MAC"), LIBERA o lease e só então
// sai. SIGTERM duplo não reexecuta nada.
process.on("SIGTERM", () => { runtime.shutdown("SIGTERM"); });
process.on("SIGINT", () => { runtime.shutdown("SIGINT"); });
