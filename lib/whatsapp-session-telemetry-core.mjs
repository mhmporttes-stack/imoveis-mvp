// Telemetria de conexão do WhatsApp individual — regras PURAS (sem banco).
// Testes: tests/whatsapp-reconnect-policy.test.mjs. Persistência:
// lib/whatsapp-session-telemetry.js. Quem envia: whatsapp-individual-service/src/telemetry.js.
//
// Lista FIXA de campos: o que não está aqui é descartado. NUNCA entram
// credenciais, chaves, conteúdo de mensagem nem telefone — o identificador é o
// id interno do corretor, e valores de texto passam por um filtro de caracteres
// e por uma trava contra sequências longas de dígitos (parecem telefone).

// Tipos da 1ª versão da tabela (CHECK original). Mantidos separados para o fallback de
// gravação quando a migration 20261004213000 (tipos de lease/reconciliação) ainda não foi aplicada.
export const LEGACY_TELEMETRY_EVENT_TYPES = Object.freeze([
  "service_boot", "service_shutdown", "resume_skipped", "resume_done",
  "cycle_start", "cycle_end", "connect_attempt", "connected", "disconnected",
  "retry_scheduled", "interrupted_limit", "intervention_required"
]);
export const TELEMETRY_EVENT_TYPES = Object.freeze([
  ...LEGACY_TELEMETRY_EVENT_TYPES,
  // lease do serviço (dono único das sessões) e reconciliação de estado preso
  "lease_acquired", "lease_waiting", "lease_released", "lease_lost", "lease_unavailable",
  "session_reconciled"
]);
// Eventos do próprio serviço (sem corretor).
export const SERVICE_LEVEL_EVENT_TYPES = Object.freeze([
  "service_boot", "service_shutdown", "resume_done",
  "lease_acquired", "lease_waiting", "lease_released", "lease_lost", "lease_unavailable"
]);
export const MAX_TELEMETRY_BATCH = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_CHARS = /[^A-Za-z0-9_.:-]/g;
const PHONE_LIKE = /\d{9,}/;

function token(value, max, { allowLongDigits = false } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const clean = String(value).replace(SAFE_CHARS, "").slice(0, max);
  if (!clean) return null;
  if (!allowLongDigits && PHONE_LIKE.test(clean)) return null;
  return clean;
}

function int(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function timestamp(value, nowMs) {
  const t = new Date(value || 0).getTime();
  // Relógio do serviço absurdo (inválido ou no futuro) → hora do recebimento.
  if (!Number.isFinite(t) || t <= 0 || t > nowMs + 5 * 60_000) return new Date(nowMs).toISOString();
  return new Date(t).toISOString();
}

// -> linha pronta para inserir, ou null se o evento não presta.
export function sanitizeTelemetryEvent(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const eventType = String(raw.type || "");
  if (!TELEMETRY_EVENT_TYPES.includes(eventType)) return null;
  const userId = raw.userId ? String(raw.userId).trim() : null;
  if (userId && !UUID.test(userId)) return null;
  if (!userId && !SERVICE_LEVEL_EVENT_TYPES.includes(eventType)) return null;
  const bootId = token(raw.bootId, 64, { allowLongDigits: true });
  if (!bootId) return null;
  return {
    user_id: userId,
    event_type: eventType,
    cycle_id: token(raw.cycleId, 64, { allowLongDigits: true }),
    attempt: int(raw.attempt),
    next_attempt: int(raw.nextAttempt),
    status_code: int(raw.statusCode),
    reason: token(raw.reason, 64),
    kind: token(raw.kind, 24),
    trigger: token(raw.trigger, 24),
    delay_ms: int(raw.delayMs),
    connected_ms: int(raw.connectedMs),
    max_retries: int(raw.maxRetries),
    detail: token(raw.detail, 40),
    baileys_version: token(raw.baileysVersion, 32, { allowLongDigits: true }),
    wa_version: token(raw.waVersion, 32, { allowLongDigits: true }),
    wa_version_is_latest: typeof raw.waVersionIsLatest === "boolean" ? raw.waVersionIsLatest : null,
    boot_id: bootId,
    deploy_id: token(raw.deployId, 64, { allowLongDigits: true }),
    commit_sha: token(raw.commitSha, 40, { allowLongDigits: true }),
    occurred_at: timestamp(raw.occurredAt, nowMs)
  };
}

// -> { rows, rejected }
export function sanitizeTelemetryBatch(events, nowMs = Date.now()) {
  const list = Array.isArray(events) ? events.slice(0, MAX_TELEMETRY_BATCH) : [];
  const rows = [];
  let rejected = Math.max(0, (Array.isArray(events) ? events.length : 0) - list.length);
  for (const event of list) {
    const row = sanitizeTelemetryEvent(event, nowMs);
    if (row) rows.push(row); else rejected += 1;
  }
  return { rows, rejected };
}
