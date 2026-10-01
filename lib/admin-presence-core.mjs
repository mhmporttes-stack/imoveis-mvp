// Puro (sem banco, sem "server-only") — regras de presença testáveis em
// tests/admin-presence-core.test.mjs.
//
// Duas leituras da mesma atividade, de propósito separadas (regra do dono,
// 2026-10-01, ROL-2b em docs/BUSINESS_RULES.md):
//   - ROLETA (elegibilidade): `admin_presence.last_activity_at` = hora REAL da
//     última atividade no CRM (clique, tecla, clique no WhatsApp, envio pelo
//     Chat). On-line = até 5 min depois disso, sem nenhuma extensão.
//     pick_round_robin_broker (SQL) lê essa coluna direto.
//   - VISUAL (painel Online, seletor 🟢 do Chat, painel da roleta): mantém a
//     tolerância que já existia depois de uma ação de WhatsApp — uma marca
//     `kind='grace'` em admin_presence_activity conta como atividade até
//     GRACE_EXTENSION_MS depois do minuto em que aconteceu. Isso preserva o
//     comportamento visual de antes sem gravar hora no futuro na coluna que a
//     roleta usa.

export const PRESENCE_STATUS = { ONLINE: "online", AWAY: "away", OFFLINE: "offline" };
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;
export const AWAY_WINDOW_MS = 30 * 60 * 1000;
export const GRACE_EXTENSION_MS = 5 * 60 * 1000;

function toMs(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function deriveStatus(lastActivityAt, now) {
  if (!lastActivityAt) return PRESENCE_STATUS.OFFLINE;
  const elapsed = now - new Date(lastActivityAt).getTime();
  if (!Number.isFinite(elapsed)) return PRESENCE_STATUS.OFFLINE;
  if (elapsed < 0) return PRESENCE_STATUS.ONLINE;
  if (elapsed <= ONLINE_WINDOW_MS) return PRESENCE_STATUS.ONLINE;
  if (elapsed <= AWAY_WINDOW_MS) return PRESENCE_STATUS.AWAY;
  return PRESENCE_STATUS.OFFLINE;
}

// Referência usada SÓ para o status visual: a mais recente entre a atividade
// real e (última marca de tolerância + extensão). Devolve ISO ou null.
export function visualActivityReference(lastActivityAt, lastGraceMinuteAt) {
  const realMs = toMs(lastActivityAt);
  const graceMs = toMs(lastGraceMinuteAt);
  const best = Math.max(realMs, graceMs ? graceMs + GRACE_EXTENSION_MS : 0);
  return best ? new Date(best).toISOString() : null;
}

export function deriveVisualStatus(lastActivityAt, lastGraceMinuteAt, now) {
  return deriveStatus(visualActivityReference(lastActivityAt, lastGraceMinuteAt), now);
}
