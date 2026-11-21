// Redes NOVAS detectadas (dono, 2026-11-21, ROL-2f): heartbeat de corretor/associado/gestor ativo que chega por um IP que NÃO
// está nas redes cadastradas deixa um rastro pequeno e auto-limpo, só para o dono ver "qual é a rede nova" e cadastrar.
// Regras puras (sem banco) — testes: tests/office-unmatched.test.mjs. Persistência em lib/office-presence.js
// (`crm_settings` id 'office_presence_unmatched'). Só guarda o PREFIXO (`networkKey`: IPv4 inteiro ou IPv6 /64), nunca o
// IP completo, e só ids internos de usuário — nada de dado de cliente. NÃO muda o casamento de IP nem a elegibilidade.

export const UNMATCHED_THROTTLE_MS = 10 * 60 * 1000; // no máx. 1 gravação a cada 10 min por usuário/prefixo
export const UNMATCHED_RETENTION_MS = 3 * 24 * 3600 * 1000; // 3 dias
export const UNMATCHED_MAX_PREFIXES = 30;
export const UNMATCHED_MAX_USERS = 20;
export const UNMATCHED_ALERT_MIN_USERS = 2; // corretores/associados DIFERENTES no mesmo dia

const SAO_PAULO_OFFSET_MS = 3 * 3600 * 1000;

// Dia (AAAA-MM-DD) em São Paulo (UTC-3, sem horário de verão).
export function spDayKey(ms) {
  return new Date(ms - SAO_PAULO_OFFSET_MS).toISOString().slice(0, 10);
}

export function emptyUnmatchedState() {
  return { prefixes: {} };
}

function normalizeState(state) {
  const prefixes = state && typeof state === "object" && state.prefixes && typeof state.prefixes === "object" ? state.prefixes : {};
  return { prefixes: { ...prefixes } };
}

// Remove usuários/prefixos com mais de 3 dias e limita a 30 prefixos (os mais recentes) e 20 usuários por prefixo.
export function pruneUnmatchedState(state, nowMs) {
  const base = normalizeState(state);
  const cutoff = nowMs - UNMATCHED_RETENTION_MS;
  const kept = [];
  for (const [key, entry] of Object.entries(base.prefixes)) {
    const users = Object.entries(entry?.users || {})
      .filter(([, at]) => Number.isFinite(Date.parse(at)) && Date.parse(at) >= cutoff)
      .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
      .slice(0, UNMATCHED_MAX_USERS);
    if (!users.length) continue;
    const lastAt = users[0][1];
    kept.push([key, { firstAt: entry.firstAt || lastAt, lastAt, users: Object.fromEntries(users), alertedDay: entry.alertedDay || null }]);
  }
  kept.sort((a, b) => Date.parse(b[1].lastAt) - Date.parse(a[1].lastAt));
  return { prefixes: Object.fromEntries(kept.slice(0, UNMATCHED_MAX_PREFIXES)) };
}

// Registra que `userId` apareceu em `key` agora. Devolve { state, changed }: `changed = false` quando o throttle de 10 min
// (por usuário e prefixo, lido do próprio estado gravado — vale entre instâncias) manda não gravar.
export function recordUnmatchedSighting(state, { key, userId, nowMs = Date.now() }) {
  const base = normalizeState(state);
  if (!key || !userId) return { state: base, changed: false };
  const entry = base.prefixes[key];
  const last = Date.parse(entry?.users?.[userId] || "");
  if (Number.isFinite(last) && nowMs - last < UNMATCHED_THROTTLE_MS) return { state: base, changed: false };
  const nowIso = new Date(nowMs).toISOString();
  base.prefixes[key] = {
    firstAt: entry?.firstAt || nowIso,
    lastAt: nowIso,
    users: { ...(entry?.users || {}), [userId]: nowIso },
    alertedDay: entry?.alertedDay || null
  };
  return { state: pruneUnmatchedState(base, nowMs), changed: true };
}

// Usuários distintos do prefixo cuja última aparição foi no dia (São Paulo) de `nowMs`.
export function usersSeenToday(entry, nowMs) {
  const today = spDayKey(nowMs);
  return Object.entries(entry?.users || {}).filter(([, at]) => Number.isFinite(Date.parse(at)) && spDayKey(Date.parse(at)) === today).map(([id]) => id);
}

// Decide o aviso ao dono: >= 2 usuários DIFERENTES no mesmo dia no mesmo prefixo desconhecido, um aviso por prefixo por dia.
export function decideUnmatchedAlert(state, key, nowMs = Date.now()) {
  const entry = state?.prefixes?.[key];
  if (!entry) return { alert: false, users: 0 };
  const users = usersSeenToday(entry, nowMs).length;
  const today = spDayKey(nowMs);
  return { alert: users >= UNMATCHED_ALERT_MIN_USERS && entry.alertedDay !== today, users };
}

export function markUnmatchedAlerted(state, key, nowMs = Date.now()) {
  const base = normalizeState(state);
  if (!base.prefixes[key]) return base;
  base.prefixes[key] = { ...base.prefixes[key], alertedDay: spDayKey(nowMs) };
  return base;
}

// Para a tela: redes novas (fora das já cadastradas), mais recente primeiro. `registeredKeys` = chaves das redes cadastradas.
export function summarizeUnmatchedNetworks(state, { registeredKeys = [], nowMs = Date.now() } = {}) {
  const registered = new Set(registeredKeys);
  const pruned = pruneUnmatchedState(state, nowMs);
  return Object.entries(pruned.prefixes)
    .filter(([key]) => !registered.has(key))
    .map(([key, entry]) => ({ key, users: Object.keys(entry.users).length, usersToday: usersSeenToday(entry, nowMs).length, lastAt: entry.lastAt }))
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

// Texto curto do aviso ao dono.
export function unmatchedAlertText(users, key) {
  return `${users} corretores estão em uma rede nova (${key}). Cadastre em Supervisão › Online.`;
}
