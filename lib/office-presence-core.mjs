// Regras puras da ROL-2f (dono, 2026-10-13): "só fica na roleta quem veio à
// imobiliária". Presença = o CRM (heartbeat) chegou pela internet do escritório.
// A rede é identificada pelo IP público: IPv4 exato; IPv6 pelo prefixo /64 (cada
// aparelho tem um endereço IPv6 diferente dentro da mesma rede).
// Testes: tests/office-presence.test.mjs. A janela de validade (até 9h do dia
// seguinte; sábado -> segunda) é calculada no banco (office_presence_valid_until);
// officeValidUntilIso aqui é o espelho para testes/telas.

export function clientIpFromHeaders(headers) {
  const get = (name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]) || "";
  const forwarded = String(get("x-forwarded-for")).split(",")[0].trim();
  return (forwarded || String(get("x-real-ip")).trim()).slice(0, 64);
}

// Chave de comparação da rede: IPv4 inteiro; IPv6 = 4 primeiros blocos (/64).
export function networkKey(ip) {
  const value = String(ip || "").trim().toLowerCase().replace(/^::ffff:/, "");
  if (!value) return "";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value;
  if (!value.includes(":")) return "";
  const [head, tail = ""] = value.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = value.includes("::") ? 8 - headParts.length - tailParts.length : 0;
  const parts = [...headParts, ...Array(Math.max(missing, 0)).fill("0"), ...tailParts];
  if (parts.length !== 8) return "";
  return `${parts.slice(0, 4).map((part) => part.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export function ipMatchesNetworks(ip, networks = []) {
  const key = networkKey(ip);
  if (!key) return false;
  return networks.some((network) => networkKey(network?.ip || network) === key || network?.key === key);
}

const SAO_PAULO_OFFSET_HOURS = 3; // America/Sao_Paulo sem horário de verão (UTC-3)

// Até quando vale uma chegada feita em `nowMs`: 9h (SP) do dia seguinte; se a
// chegada for num sábado, 9h da segunda.
export function officeValidUntilIso(nowMs) {
  const local = new Date(nowMs - SAO_PAULO_OFFSET_HOURS * 3600 * 1000);
  const dow = local.getUTCDay();
  const add = dow === 6 ? 2 : 1;
  const target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + add, 9 + SAO_PAULO_OFFSET_HOURS);
  return new Date(target).toISOString();
}

// Situação de um usuário para a tela/aviso.
// "Na imobiliária agora" (dono, 2026-10-15): heartbeat pelo Wi-Fi do escritório nos últimos 10 min. Só visual —
// a roleta continua usando a validade da chegada (active/eligible).
export const OFFICE_HERE_WINDOW_MS = 10 * 60 * 1000;

// "Marcar ausente" (dono, 2026-10-17): `absences` = ausências NÃO desfeitas da pessoa ({ markedAt, absentUntil, markedByName }).
// Espelho de office_presence_ok (migration 20261017120000): a chegada é ignorada quando foi feita até o fim de uma ausência
// e ainda valia quando ela foi marcada. Enquanto a ausência vale, a pessoa aparece "Ausente", mesmo com o Wi-Fi detectando.
export function officeStatus({ ruleEnabled, validUntil, firstSeenAt = null, lastWifiSeenAt = null, absences = [], nowMs = Date.now() }) {
  const ignored = Boolean(validUntil) && isCheckinIgnoredByAbsence({ firstSeenAt, validUntil }, absences);
  const absence = currentAbsence(absences, nowMs);
  const active = Boolean(validUntil) && Date.parse(validUntil) > nowMs && !ignored;
  const seenMs = lastWifiSeenAt ? Date.parse(lastWifiSeenAt) : NaN;
  const wifiNow = Number.isFinite(seenMs) && nowMs - seenMs <= OFFICE_HERE_WINDOW_MS;
  return {
    ruleEnabled: Boolean(ruleEnabled),
    active,
    here: wifiNow && !absence,
    wifiDetectedWhileAbsent: wifiNow && Boolean(absence),
    eligible: !ruleEnabled || active,
    validUntil: active ? validUntil : null,
    lastWifiSeenAt: Number.isFinite(seenMs) ? lastWifiSeenAt : null,
    absence
  };
}

export function isCheckinIgnoredByAbsence({ firstSeenAt, validUntil }, absences = []) {
  const firstMs = Date.parse(firstSeenAt || "");
  const untilMs = Date.parse(validUntil || "");
  return (absences || []).some((absence) => {
    const absentUntilMs = Date.parse(absence?.absentUntil || "");
    const markedMs = Date.parse(absence?.markedAt || "");
    return Number.isFinite(absentUntilMs) && Number.isFinite(markedMs) && (!Number.isFinite(firstMs) || firstMs <= absentUntilMs) && untilMs > markedMs;
  });
}

// Ausência valendo agora (a de prazo mais longo), ou null.
export function currentAbsence(absences = [], nowMs = Date.now()) {
  let best = null;
  for (const absence of absences || []) {
    const untilMs = Date.parse(absence?.absentUntil || "");
    const markedMs = Date.parse(absence?.markedAt || "");
    if (!(markedMs <= nowMs && untilMs > nowMs)) continue;
    if (!best || untilMs > Date.parse(best.absentUntil)) best = absence;
  }
  return best;
}

// Fim (exclusivo) do dia `dateKey` (AAAA-MM-DD) em São Paulo = 00:00 do dia seguinte.
export function absenceUntilIso(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const target = new Date(Date.UTC(y, m - 1, d + 1, SAO_PAULO_OFFSET_HOURS));
  return Number.isFinite(target.getTime()) ? target.toISOString() : null;
}

// Data (AAAA-MM-DD, São Paulo) do próximo domingo; se hoje é domingo, hoje.
export function nextSundayKey(nowMs = Date.now()) {
  const local = new Date(nowMs - SAO_PAULO_OFFSET_HOURS * 3600 * 1000);
  const add = (7 - local.getUTCDay()) % 7;
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + add)).toISOString().slice(0, 10);
}

