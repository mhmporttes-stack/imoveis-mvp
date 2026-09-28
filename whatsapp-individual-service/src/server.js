import { timingSafeEqual } from "node:crypto";
import express from "express";
import { connectSession, disconnectSession, getLiveSessionStatus, sendMessage } from "./sessions.js";
import { readSessionRow } from "./db.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SESSION_ENCRYPTION_KEY", "WHATSAPP_INDIVIDUAL_SERVICE_SECRET"];
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missingEnv.length) {
  console.error(`Variáveis de ambiente faltando: ${missingEnv.join(", ")}. Veja .env.example.`);
  process.exit(1);
}

const app = express();
app.use(express.json());

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
    const result = await connectSession(req.params.userId);
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

app.post("/sessions/:userId/send", async (req, res) => {
  try {
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ error: "Informe 'to' e 'text'." });
    const result = await sendMessage(req.params.userId, { to, text });
    res.json(result);
  } catch (error) {
    const status = error.code === "NOT_CONNECTED" ? 409 : 500;
    res.status(status).json({ error: error.message });
  }
});

const port = Number(process.env.PORT) || 3100;
app.listen(port, () => console.log(`whatsapp-individual-service ouvindo na porta ${port}`));
