// Chegada pelo Wi-Fi (PRES-WIFI, dono, 2026-10-23). Regras puras — testes em tests/presence-wifi.test.mjs.
// O Atalho do iPhone ("Ao conectar/desconectar do Wi-Fi X") faz POST /api/presence/wifi com
// `Authorization: Bearer <chave pessoal>` e corpo { event: "arrive" | "leave" }. Sem cookie de sessão: a barreira é a
// chave pessoal (só o hash SHA-256 fica no banco) + quem pode usar (isWifiPresenceEligible) + limite por IP.
import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const WIFI_PRESENCE_EVENTS = Object.freeze(["arrive", "leave"]);
export const WIFI_TOKEN_PREFIX = "wfp_";
// Teto de segurança: sem o "saí" (iPhone sem bateria, Atalho que não rodou), a presença pelo Wi-Fi deixa de valer.
export const WIFI_PRESENCE_MAX_HOURS = 12;
export const WIFI_RATE_LIMIT = Object.freeze({ windowSeconds: 60, maxAttempts: 12 });
export const VOICE_MONKEY_TRIGGER_URL = "https://api-v3.voicemonkey.io/trigger";

export function hashWifiToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

export function generateWifiToken() {
  return `${WIFI_TOKEN_PREFIX}${randomBytes(24).toString("hex")}`;
}

export function wifiTokenMatches(storedHash, token) {
  const stored = String(storedHash || "");
  const supplied = hashWifiToken(token);
  return stored.length > 0 && stored.length === supplied.length && timingSafeEqual(Buffer.from(stored), Buffer.from(supplied));
}

export function bearerToken(headers) {
  const header = (typeof headers?.get === "function" ? headers.get("authorization") : headers?.authorization) || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.startsWith(WIFI_TOKEN_PREFIX) && token.length <= 128 ? token : "";
}

export function parseWifiEvent(body) {
  const event = String(body?.event || "").trim().toLowerCase();
  return WIFI_PRESENCE_EVENTS.includes(event) ? event : "";
}

// Quem pode usar. Hoje só o dono (decisão de 2026-10-23); para estender aos corretores, mude SÓ esta função.
export function isWifiPresenceEligible(profile, { isOwnerEmail = () => false } = {}) {
  if (!profile || profile.status !== "active") return false;
  return Boolean(isOwnerEmail(profile.email));
}

// Presença pelo Wi-Fi: vale do último "cheguei" até o "saí", com teto de WIFI_PRESENCE_MAX_HOURS.
export function wifiPresenceState({ lastEvent, lastEventAt, nowMs = Date.now() }) {
  const atMs = Date.parse(lastEventAt || "");
  if (lastEvent !== "arrive" || !Number.isFinite(atMs)) return { present: false, since: null, until: null };
  const untilMs = atMs + WIFI_PRESENCE_MAX_HOURS * 3600 * 1000;
  if (nowMs >= untilMs) return { present: false, since: null, until: null, expired: true };
  return { present: true, since: new Date(atMs).toISOString(), until: new Date(untilMs).toISOString() };
}

// ID do "Routine Trigger" do Voice Monkey (o que aparece no painel deles). Vazio = não dispara.
export function normalizeTriggerDevice(value) {
  const device = String(value || "").trim();
  if (!device) return "";
  if (device.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(device)) {
    throw new Error("Nome do gatilho inválido: use só letras, números, hífen ou sublinhado (até 64).");
  }
  return device;
}

// Dispara um "Routine Trigger" do Voice Monkey (que vira gatilho de rotina da Alexa). Best-effort: nunca lança erro.
// `enabled` = trava do ambiente (ALEXA_VOICE_ENABLED). Logs/retorno nunca incluem token nem device.
export async function triggerVoiceMonkeyDevice({ device, token, enabled, fetchImpl = fetch, timeoutMs = 4000 }) {
  if (!device) return { ok: false, status: "sem_gatilho" };
  if (!enabled) return { ok: false, status: "alexa_desligada_no_ambiente" };
  if (!token) return { ok: false, status: "sem_token_voice_monkey" };
  try {
    const response = await fetchImpl(VOICE_MONKEY_TRIGGER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ device }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response.ok ? { ok: true, status: "ok" } : { ok: false, status: `recusado_http_${response.status}` };
  } catch (error) {
    return { ok: false, status: error?.name === "TimeoutError" ? "tempo_esgotado" : "falha_rede" };
  }
}

// Fluxo da rota pública, com as dependências injetadas (testável sem banco nem rede).
// deps: checkRateLimit() -> bool; findTokenOwner(token) -> { profile, record } | null; isOwnerEmail(email);
// applyEvent({ profile, record, event }) -> any.
export async function handleWifiPresenceRequest({ headers, body, deps }) {
  if (!(await deps.checkRateLimit())) return { status: 429, json: { error: "Muitas tentativas." } };
  const token = bearerToken(headers);
  const owner = token ? await deps.findTokenOwner(token) : null;
  if (!owner) return { status: 401, json: { error: "Não autorizado." } };
  if (!isWifiPresenceEligible(owner.profile, { isOwnerEmail: deps.isOwnerEmail })) {
    return { status: 403, json: { error: "Não autorizado." } };
  }
  const event = parseWifiEvent(body);
  if (!event) return { status: 400, json: { error: "Evento inválido. Use arrive ou leave." } };
  await deps.applyEvent({ profile: owner.profile, record: owner.record, event });
  return { status: 200, json: { ok: true, event } };
}
