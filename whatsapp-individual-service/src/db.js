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

// user_ids com credenciais salvas — usado só na subida do processo (server.js)
// para retomar sozinho as sessões que existiam antes do restart/redeploy.
export async function listResumableUserIds() {
  const { userIds } = await call("GET", "/api/webhooks/whatsapp-individual/state?field=resumable");
  return Array.isArray(userIds) ? userIds : [];
}

// Mídia recebida (foto, vídeo, figurinha, áudio, documento): este serviço não
// tem acesso ao Storage — pede ao CRM uma URL de upload assinada (curta, para
// UM arquivo, no bucket privado) e envia o arquivo direto para lá. O arquivo
// nunca passa pela Vercel (limite de ~4,5 MB por requisição).
export async function requestMediaUploadTarget(userId, { waMessageId, mime, kind }) {
  return call("POST", "/api/webhooks/whatsapp-individual/media-upload", { userId, waMessageId, mime, kind });
}

// Sessões gravadas como 'reconnecting'/'connecting' (reconcile.js): [{ user_id, status, updated_at }].
export async function listTransientSessionRows() {
  const { rows } = await call("GET", "/api/webhooks/whatsapp-individual/state?field=transient");
  return Array.isArray(rows) ? rows : [];
}

// LEASE (lease.js): acquire/renew/release pelo CRM (rota /api/webhooks/whatsapp-individual/lease), que
// chama as funções atômicas do banco. Devolve SEMPRE um resultado normalizado, nunca lança:
//   { acquired, ... } | { renewed } | { released } | { unavailable: true, reason }
// "unavailable" = endpoint ausente (CRM antigo, 404), tabela/função ausente (503) ou rede/5xx.
export function createLeaseApi({ bootId, deployId }) {
  async function leaseCall(action, extra = {}) {
    let response;
    try {
      response = await fetch(`${baseUrl()}/api/webhooks/whatsapp-individual/lease`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Service-Secret": secret() },
        body: JSON.stringify({ action, bootId, deployId: deployId || null, ...extra }),
        signal: AbortSignal.timeout(8000)
      });
    } catch (error) {
      return { unavailable: true, reason: error?.name === "TimeoutError" ? "timeout" : "network" };
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404) return { unavailable: true, reason: "endpoint_missing" };
    if (response.status === 503 && payload?.unavailable) return { unavailable: true, reason: payload.reason || "lease_table_missing" };
    if (response.status === 401) return { unavailable: true, reason: "unauthorized" };
    if (!response.ok || payload?.error) return { unavailable: true, reason: `http_${response.status}` };
    return payload;
  }
  return {
    acquire: ({ ttlSeconds }) => leaseCall("acquire", { ttlSeconds }),
    renew: ({ ttlSeconds }) => leaseCall("renew", { ttlSeconds }),
    release: () => leaseCall("release")
  };
}
