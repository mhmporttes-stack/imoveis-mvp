// Lease do microsserviço WhatsApp individual — regras PURAS (sem banco).
// Testes: tests/whatsapp-service-lease.test.mjs. Persistência: lib/whatsapp-service-lease.js.
// Quem chama: whatsapp-individual-service/src/lease.js, pela rota
// app/api/webhooks/whatsapp-individual/lease (X-Service-Secret).

export const LEASE_SERVICE_ID = "whatsapp-individual-service";
export const LEASE_ACTIONS = Object.freeze(["acquire", "renew", "release"]);
export const DEFAULT_LEASE_TTL_SECONDS = 60;
export const MIN_LEASE_TTL_SECONDS = 20;
export const MAX_LEASE_TTL_SECONDS = 120;

const ID_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;

function cleanId(value) {
  const text = String(value ?? "").trim();
  return ID_TOKEN.test(text) ? text : "";
}

// -> { ok: true, action, bootId, deployId, ttlSeconds } | { ok: false, error }
export function parseLeaseRequest(body) {
  const action = String(body?.action || "");
  if (!LEASE_ACTIONS.includes(action)) return { ok: false, error: "Ação de lease inválida." };
  const bootId = cleanId(body?.bootId);
  if (!bootId) return { ok: false, error: "bootId inválido." };
  const deployRaw = body?.deployId;
  const deployId = deployRaw === undefined || deployRaw === null || deployRaw === "" ? null : cleanId(deployRaw) || null;
  const ttlNumber = Number(body?.ttlSeconds);
  const ttlSeconds = Number.isFinite(ttlNumber)
    ? Math.min(MAX_LEASE_TTL_SECONDS, Math.max(MIN_LEASE_TTL_SECONDS, Math.trunc(ttlNumber)))
    : DEFAULT_LEASE_TTL_SECONDS;
  return { ok: true, action, bootId, deployId, ttlSeconds };
}

// Migration 20261004213000 ainda não aplicada (tabela/função inexistente): o serviço deve seguir
// SEM lease (comportamento antigo), com aviso — nunca derrubar sessão por causa disso.
export function isLeaseUnavailableError(error) {
  const code = String(error?.code || "");
  if (["PGRST202", "PGRST205", "42883", "42P01"].includes(code)) return true;
  const message = String(error?.message || "").toLowerCase();
  return message.includes("whatsapp_service_lease") && (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"));
}

const toMs = (value) => {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
};

// Normaliza o jsonb das funções SQL para o formato da API (camelCase, sem dado sensível).
export function normalizeLeaseResult(action, data) {
  const raw = data && typeof data === "object" ? data : {};
  if (action === "acquire") {
    if (raw.acquired) {
      return {
        acquired: true,
        tookOver: Boolean(raw.took_over),
        previousReleased: Boolean(raw.previous_released),
        first: Boolean(raw.first),
        expiresAt: raw.expires_at || null
      };
    }
    return {
      acquired: false,
      holderBootId: raw.holder_boot_id ? String(raw.holder_boot_id).slice(0, 64) : null,
      holderDeployId: raw.holder_deploy_id ? String(raw.holder_deploy_id).slice(0, 64) : null,
      retryAfterMs: Number.isFinite(Number(raw.retry_after_ms)) ? Math.max(0, Math.trunc(Number(raw.retry_after_ms))) : null,
      expiresAt: toMs(raw.expires_at) ? raw.expires_at : null
    };
  }
  if (action === "renew") return { renewed: Boolean(raw.renewed), expiresAt: raw.expires_at || null };
  return { released: Boolean(raw.released) };
}
