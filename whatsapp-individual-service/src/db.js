// Toda leitura/escrita de whatsapp_individual_sessions passa pelo Next.js
// (app/api/webhooks/whatsapp-individual/state) em vez de falar com o
// Supabase direto: este host (Railway) nunca guarda SUPABASE_SERVICE_ROLE_KEY
// — esse segredo só existe no Next.js. Autenticado pelo MESMO
// WHATSAPP_INDIVIDUAL_SERVICE_SECRET usado no sentido contrário (webhook.js).
function baseUrl() {
  return String(process.env.APP_WEBHOOK_URL || "").replace(/\/+$/, "");
}

function secret() {
  return process.env.WHATSAPP_INDIVIDUAL_SERVICE_SECRET || "";
}

async function call(method, path, body) {
  const url = `${baseUrl()}${path}`;
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "X-Service-Secret": secret() },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `Falha ao falar com o CRM (status ${response.status}) em ${path}.`);
  }
  return payload;
}

export async function readEncryptedCreds(userId) {
  const { encrypted } = await call("GET", `/api/webhooks/whatsapp-individual/state?userId=${encodeURIComponent(userId)}&field=creds`);
  return encrypted || null;
}

export async function writeEncryptedCreds(userId, encrypted) {
  await call("POST", "/api/webhooks/whatsapp-individual/state", { userId, encrypted });
}

export async function clearSessionCreds(userId) {
  await call("POST", "/api/webhooks/whatsapp-individual/state", { userId, encrypted: null });
}

// Fallback do GET /sessions/:userId/status (server.js) para quando este
// processo acabou de subir e ainda não tem estado em memória — status/QR já
// são persistidos pelo Next.js via notifyStatus (webhook.js), esta função só
// lê de volta.
export async function readSessionRow(userId) {
  const { row } = await call("GET", `/api/webhooks/whatsapp-individual/state?userId=${encodeURIComponent(userId)}&field=row`);
  return row || null;
}
