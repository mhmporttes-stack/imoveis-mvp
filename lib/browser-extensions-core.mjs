// Extensões do Chrome do dono (EXT-1, dono, 2026-10-29): Seguidor do Instagram (ferramentas/instagram-seguidor) e
// Publicador do Marketplace (ferramentas/marketplace-publicador). Regras puras (sem banco), testadas em
// tests/browser-extensions-core.test.mjs: configuração editável no CRM (faixas fechadas), "Parar tudo", sinal de saúde
// (sem dado de terceiros) e comparação de versões. Banco/rotas: lib/browser-extensions.js.

export const EXTENSIONS = Object.freeze({
  instagram: Object.freeze({ key: "instagram", label: "Seguidor do Instagram", folder: "instagram-seguidor", tokenPrefix: "igs_" }),
  marketplace: Object.freeze({ key: "marketplace", label: "Publicador do Marketplace", folder: "marketplace-publicador", tokenPrefix: "mkp_" })
});
export const EXTENSION_KEYS = Object.freeze(Object.keys(EXTENSIONS));

// crm_settings (sem migration): um registro por assunto.
export const CONTROL_SETTING_ID = "browser_extensions_control";
export const configSettingId = (ext) => `browser_extension_config_${ext}`;
export const healthSettingId = (ext) => `browser_extension_health_${ext}`;
export const INSTAGRAM_TOKEN_SETTING_ID = "instagram_follower_extension";

// Campos editáveis pelo dono (faixa fechada; fora dela vale o limite mais próximo). Padrões = comportamento de hoje,
// exceto "Seguir por dia" do Instagram: 20 (dono, 2026-10-29: "quero 20 já"; era 15).
// Marketplace: só a publicação (o chat já é configurado em Chat Marketplace › Configurações; sem teto diário de
// mensagens do chat — dono, 2026-10-29).
export const CONFIG_FIELDS = Object.freeze({
  instagram: Object.freeze([
    { key: "followPerDay", label: "Seguir por dia", unit: "perfis", default: 20, min: 0, max: 40 },
    { key: "unfollowPerDay", label: "Deixar de seguir por dia", unit: "perfis", default: 15, min: 0, max: 40 },
    { key: "welcomePerDay", label: "Boas-vindas na DM por dia", unit: "mensagens", default: 30, min: 1, max: 100 },
    { key: "checkFollowersEveryMin", label: "Conferir seguidores novos a cada", unit: "min", default: 10, min: 5, max: 60 },
    { key: "startHour", label: "Começa às", unit: "h", default: 5, min: 0, max: 23 },
    { key: "endHour", label: "Para às", unit: "h", default: 22, min: 1, max: 24 }
  ]),
  marketplace: Object.freeze([
    { key: "publishPerDay", label: "Publicações por dia", unit: "anúncios", default: 3, min: 0, max: 10 },
    { key: "publishStartHour", label: "Publica a partir das", unit: "h", default: 8, min: 0, max: 23 },
    { key: "publishEndHour", label: "Publica até as", unit: "h", default: 20, min: 1, max: 24 }
  ])
});

const HOUR_PAIRS = Object.freeze({ instagram: ["startHour", "endHour"], marketplace: ["publishStartHour", "publishEndHour"] });

export function isExtensionKey(value) {
  return Object.prototype.hasOwnProperty.call(EXTENSIONS, String(value || ""));
}

export function defaultExtensionConfig(ext) {
  return Object.fromEntries((CONFIG_FIELDS[ext] || []).map((field) => [field.key, field.default]));
}

// Valor guardado/recebido → configuração válida. Número fora da faixa vai para o limite; lixo = padrão. Horário de
// início sempre antes do fim (senão os dois voltam ao padrão).
export function normalizeExtensionConfig(ext, raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const field of CONFIG_FIELDS[ext] || []) {
    const value = Number(source[field.key]);
    out[field.key] = Number.isFinite(value) && source[field.key] !== null && source[field.key] !== "" ? Math.min(field.max, Math.max(field.min, Math.round(value))) : field.default;
  }
  const pair = HOUR_PAIRS[ext];
  if (pair && out[pair[0]] >= out[pair[1]]) {
    const defaults = defaultExtensionConfig(ext);
    out[pair[0]] = defaults[pair[0]];
    out[pair[1]] = defaults[pair[1]];
  }
  return out;
}

// "Parar tudo" (dono, 2026-10-29): uma chave só para as duas extensões; elas consultam antes de cada ação.
export function normalizeControl(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return { stopped: source.stopped === true, changedAt: source.changedAt || null, changedBy: source.changedBy || "" };
}

// --- Versões ------------------------------------------------------------------------------------------------------
export function parseVersion(value) {
  const parts = String(value || "").trim().split(".");
  if (!parts.length || parts.length > 4 || parts.some((part) => !/^\d{1,5}$/.test(part))) return null;
  return parts.map(Number);
}

// -1 (a < b), 0, 1; null se alguma não for versão válida.
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function isOutdated(running, latest) {
  return compareVersions(running, latest) === -1;
}

// --- Sinal de saúde (sem dado de terceiros) ------------------------------------------------------------------------
export const HEALTH_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_HEALTH_ERRORS = 40;
export const MAX_SELECTOR_FAILURES = 30;
export const MAX_SWALLOWED = 30;
const TEXT_MAX = 300;

// Tira o que identifica terceiros antes de guardar: @usuário, e-mail, telefone, links de perfil/conversa.
export function scrubThirdPartyText(value, max = TEXT_MAX) {
  return String(value || "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[e-mail]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/@[A-Za-z0-9._]{1,30}/g, "@…")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[número]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const isoOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const time = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(time) && time > Date.UTC(2020, 0, 1) ? new Date(time).toISOString() : null;
};
const count = (value, max = 100000) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(0, Math.round(Number(value)))) : null);
const shortText = (value, max = 80) => scrubThirdPartyText(value, max);

function normalizeToday(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [key, item] of Object.entries(raw).slice(0, 8)) {
    if (!/^[a-z_]{2,20}$/i.test(key) || !item || typeof item !== "object") continue;
    out[key] = { done: count(item.done) ?? 0, limit: count(item.limit) };
  }
  return out;
}

// Corpo enviado pela extensão → formato guardado. Tudo opcional, tudo limitado.
export function normalizeHealthReport(body = {}) {
  const source = body && typeof body === "object" ? body : {};
  const list = (items, max) => (Array.isArray(items) ? items.slice(-max) : []);
  return {
    ok: source.ok === true,
    stage: shortText(source.stage, 60),
    error: scrubThirdPartyText(source.error),
    today: normalizeToday(source.today),
    pausedUntil: isoOrNull(source.pausedUntil),
    pauseReason: scrubThirdPartyText(source.pauseReason),
    manualPause: source.manualPause === true,
    stoppedByCrm: source.stoppedByCrm === true,
    errors: list(source.errors, MAX_HEALTH_ERRORS)
      .map((item) => ({ at: isoOrNull(item?.at), text: scrubThirdPartyText(item?.text), kind: shortText(item?.kind, 30) }))
      .filter((item) => item.at && item.text),
    selectorFailures: list(source.selectorFailures, MAX_SELECTOR_FAILURES)
      .map((item) => ({ at: isoOrNull(item?.at), name: shortText(item?.name, 80), detail: scrubThirdPartyText(item?.detail, 160) }))
      .filter((item) => item.at && item.name),
    swallowed: list(source.swallowed, MAX_SWALLOWED)
      .map((item) => ({ context: shortText(item?.context, 80), count: count(item?.count) ?? 1, lastAt: isoOrNull(item?.lastAt), lastError: scrubThirdPartyText(item?.lastError, 160) }))
      .filter((item) => item.context && item.lastAt)
  };
}

const within = (iso, nowMs) => Boolean(iso) && nowMs - Date.parse(iso) <= HEALTH_WINDOW_MS && Date.parse(iso) <= nowMs + 5 * 60 * 1000;

function mergeByKey(previous = [], incoming = [], keyOf, nowMs, max, atOf = (item) => item.at) {
  const byKey = new Map();
  for (const item of [...previous, ...incoming]) {
    if (!item || !within(atOf(item), nowMs)) continue;
    byKey.set(keyOf(item), item);
  }
  return [...byKey.values()].sort((a, b) => Date.parse(atOf(a)) - Date.parse(atOf(b))).slice(-max);
}

// Sinal anterior + relatório novo → sinal guardado. Erros/seletores/erros engolidos: só as últimas 24 h.
export function mergeHealth(previous, report, { now = new Date(), version = "" } = {}) {
  const nowMs = now.getTime();
  const iso = now.toISOString();
  const prev = previous && typeof previous === "object" ? previous : {};
  return {
    version: String(version || "").slice(0, 20) || prev.version || "",
    lastSignalAt: iso,
    lastOkAt: report.ok ? iso : prev.lastOkAt || null,
    lastRound: { ok: report.ok, stage: report.stage, error: report.error, at: iso },
    today: report.today,
    pausedUntil: report.pausedUntil,
    pauseReason: report.pauseReason,
    manualPause: report.manualPause,
    stoppedByCrm: report.stoppedByCrm,
    errors: mergeByKey(prev.errors, report.errors, (item) => `${item.at}|${item.text}`, nowMs, MAX_HEALTH_ERRORS),
    selectorFailures: mergeByKey(prev.selectorFailures, report.selectorFailures, (item) => `${item.at}|${item.name}`, nowMs, MAX_SELECTOR_FAILURES),
    swallowed: mergeByKey(prev.swallowed, report.swallowed, (item) => item.context, nowMs, MAX_SWALLOWED, (item) => item.lastAt)
  };
}

// O que a tela "Extensões" mostra de uma extensão.
export function buildExtensionHealthView(health, { latestVersion = "", now = new Date(), fallbackVersion = "", fallbackSignalAt = null } = {}) {
  const h = health && typeof health === "object" ? health : {};
  const nowMs = now.getTime();
  const runningVersion = h.version || fallbackVersion || "";
  const lastSignalAt = [h.lastSignalAt, fallbackSignalAt].filter(Boolean).sort().pop() || null;
  const pausedUntil = h.pausedUntil && Date.parse(h.pausedUntil) > nowMs ? h.pausedUntil : null;
  return {
    runningVersion,
    latestVersion,
    outdated: Boolean(runningVersion && latestVersion && isOutdated(runningVersion, latestVersion)),
    versionUnknown: !runningVersion,
    lastSignalAt,
    minutesSinceSignal: lastSignalAt ? Math.max(0, Math.round((nowMs - Date.parse(lastSignalAt)) / 60000)) : null,
    lastOkAt: h.lastOkAt || null,
    lastRound: h.lastRound || null,
    today: h.today || {},
    pausedUntil,
    pauseReason: pausedUntil ? h.pauseReason || "" : "",
    manualPause: h.manualPause === true,
    stoppedByCrm: h.stoppedByCrm === true,
    errors24h: (h.errors || []).filter((item) => within(item.at, nowMs)).reverse(),
    selectorFailures24h: (h.selectorFailures || []).filter((item) => within(item.at, nowMs)).reverse(),
    swallowed24h: (h.swallowed || []).filter((item) => within(item.lastAt, nowMs)).sort((a, b) => b.count - a.count)
  };
}

// O que a extensão recebe a cada rodada.
export function buildExtensionRuntime(ext, { control, config, latestVersion = "", runningVersion = "", downloadUrl = "" }) {
  return {
    ok: true,
    extension: ext,
    stopped: normalizeControl(control).stopped,
    config: normalizeExtensionConfig(ext, config),
    latestVersion,
    outdated: Boolean(runningVersion && latestVersion && isOutdated(runningVersion, latestVersion)),
    downloadUrl
  };
}

// Chave da extensão pelo prefixo (Bearer). "" se não for de nenhuma.
export function extensionForToken(token) {
  const value = String(token || "");
  if (value.length > 200) return "";
  return EXTENSION_KEYS.find((ext) => value.startsWith(EXTENSIONS[ext].tokenPrefix) && value.length > EXTENSIONS[ext].tokenPrefix.length + 16) || "";
}
