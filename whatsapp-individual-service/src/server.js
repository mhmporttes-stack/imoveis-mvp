import { timingSafeEqual } from "node:crypto";
import express from "express";
import { connectSession, deleteMessageForEveryone, disconnectSession, editMessage, getLiveSessionStatus, reactToMessage, sendMessage } from "./sessions.js";
import { listResumableUserIds, readSessionRow } from "./db.js";
import { pendingWrites } from "./auth-state.js";
import { resumeSpacingMs, shouldResumeSession } from "./reconnect-policy.js";
import { telemetry } from "./telemetry.js";

const REQUIRED_ENV = ["APP_WEBHOOK_URL", "SESSION_ENCRYPTION_KEY", "WHATSAPP_INDIVIDUAL_SERVICE_SECRET"];
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missingEnv.length) {
  console.error(`Variáveis de ambiente faltando: ${missingEnv.join(", ")}. Veja .env.example.`);
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// Health check SEM segredo — é o que a Railway usa pra saber se o serviço
// está de pé, e não manda o header.
app.get("/health", (_req, res) => res.json({ ok: true }));

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
    res.status(500).json({ error: error.message });
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
  resumeSessions();
});

// A Railway manda SIGTERM antes de matar o processo (redeploy/restart) — sem
// isso, uma gravação de credenciais em andamento podia ser cortada no meio,
// perdendo o ÚLTIMO estado da sessão do Signal e corrompendo a sessão aos
// poucos (erro "Bad MAC" nas mensagens seguintes). Espera a fila de
// gravações pendentes (ver auth-state.js) terminar antes de sair.
function gracefulShutdown(signal) {
  console.log(`${signal} recebido — aguardando gravações pendentes antes de encerrar…`);
  telemetry.record(null, "service_shutdown", { reason: signal });
  Promise.race([
    Promise.allSettled([...pendingWrites, telemetry.flush()]),
    new Promise((resolve) => setTimeout(resolve, 8000))
  ]).finally(() => process.exit(0));
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// A cada restart/redeploy o socket em memória se perde, mas as credenciais
// continuam persistidas (cifradas) no Supabase — sem isso o corretor ficava
// "conectado" no banco sem socket vivo nenhum até clicar Reconectar. Um de
// cada vez, com intervalo (e jitter) entre eles, pra não abrir várias conexões
// coladas com o WhatsApp no boot.
//
// SÓ retoma quem o banco diz que estava 'connected' quando o processo caiu
// (reconnect-policy.js: shouldResumeSession). Sessão em 'reconnecting', 'error'
// (intervenção/needs_attention), 'qr_required', 'disconnected'... NÃO é reaberta
// por restart/deploy — antes, todo deploy reabria todas, inclusive as que
// estavam em laço de recusa (403). Quem foi pulado fica registrado na telemetria.
async function resumeSessions() {
  let userIds = [];
  try {
    userIds = await listResumableUserIds();
  } catch (error) {
    console.error("Falha ao listar sessões para retomar:", error.message);
    return;
  }
  let resumed = 0;
  for (const userId of userIds) {
    let row = null;
    try {
      row = await readSessionRow(userId);
    } catch (error) {
      // Sem confirmar o estado no banco, não reabre (conservador).
      console.error(`[${userId}] Não foi possível ler o estado para retomar; sessão não retomada:`, error.message);
      telemetry.record(userId, "resume_skipped", { reason: "state_unreadable" });
      continue;
    }
    if (!shouldResumeSession(row)) {
      console.log(`[${userId}] Sessão não retomada no boot (estado: ${row?.status || "sem linha"}).`);
      telemetry.record(userId, "resume_skipped", { reason: row?.status ? `status_${row.status}` : "no_row" });
      continue;
    }
    try {
      await connectSession(userId, { trigger: "resume" });
      resumed += 1;
      console.log(`[${userId}] Sessão retomada após subir o processo.`);
    } catch (error) {
      console.error(`[${userId}] Falha ao retomar a sessão:`, error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, resumeSpacingMs()));
  }
  telemetry.record(null, "resume_done", { detail: `resumed_${resumed}_of_${userIds.length}` });
}
