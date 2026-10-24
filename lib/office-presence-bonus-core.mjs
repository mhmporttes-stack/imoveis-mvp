// Bônus "Primeiro a chegar" / "Último a sair" da imobiliária (REGRA OFICIAL — dono, 2026-10-23; docs/BUSINESS_RULES.md
// RAN-10). Funções PURAS (testes: tests/office-presence-bonus.test.mjs); leitura/gravação em lib/office-presence-bonus.js.
// - Fonte única da chegada/saída: office_presence_checkins (ROL-2f). Chegada = first_seen_at da linha com source 'wifi'
//   ("Liberar hoje"/"Chegou sem Wi-Fi" = source 'manual', fora do bônus). Saída = last_wifi_seen_at (último sinal do
//   heartbeat pelo Wi-Fi do escritório naquele dia, gravado no máx. a cada 2 min por instância).
// - Quem participa: corretor e associado ATIVOS (o dono e a gestora não). "Marcado ausente" fica fora
//   (isCheckinIgnoredByAbsence, mesma régua da roleta).
// - Empate: quem ficou a MENOS de 3 min do primeiro (ou do último) divide os 100 pontos — contado sempre contra o
//   primeiro/último do dia, sem encadear (decisão técnica a confirmar com o dono).
import { isCheckinIgnoredByAbsence } from "./office-presence-core.mjs";

export const OFFICE_BONUS_POINTS = 100;
export const OFFICE_BONUS_TIE_MS = 3 * 60 * 1000;
// Folga depois dos 3 min antes de decidir a chegada (chegada gravada no limite ainda pode estar a caminho do banco).
export const OFFICE_BONUS_DECIDE_MARGIN_MS = 30 * 1000;
export const OFFICE_BONUS_KINDS = Object.freeze({ FIRST_ARRIVAL: "first_arrival", LAST_DEPARTURE: "last_departure" });
export const OFFICE_BONUS_PARTICIPANT_ROLES = Object.freeze(["broker", "associate"]);
export const OFFICE_BONUS_LABELS = Object.freeze({ first_arrival: "Primeiro a chegar", last_departure: "Último a sair" });

export function isOfficeBonusParticipant(profile) {
  return Boolean(profile?.id) && OFFICE_BONUS_PARTICIPANT_ROLES.includes(profile.role) && profile.status === "active";
}

// Divide `total` em `count` partes inteiras sem perder ponto: 100/3 = 34, 33, 33 (o resto vai para os primeiros da
// lista — quem chegou primeiro / saiu por último).
export function splitOfficeBonusPoints(count, total = OFFICE_BONUS_POINTS) {
  if (!Number.isInteger(count) || count <= 0) return [];
  const base = Math.floor(total / count);
  const rest = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < rest ? 1 : 0));
}

function eligibleRows(checkins, participantIds, absencesByUser) {
  const allowed = participantIds instanceof Set ? participantIds : new Set(participantIds || []);
  return (checkins || []).filter((row) => row?.user_id && allowed.has(row.user_id)
    && !isCheckinIgnoredByAbsence({ firstSeenAt: row.first_seen_at, validUntil: row.valid_until }, absencesByUser?.get?.(row.user_id) || []));
}

function pickWinners(candidates, direction) {
  if (!candidates.length) return [];
  // direction 1 = mais cedo primeiro (chegada); -1 = mais tarde primeiro (saída). Desempate estável pelo id.
  const sorted = [...candidates].sort((a, b) => direction * (a.ms - b.ms) || String(a.userId).localeCompare(String(b.userId)));
  const anchor = sorted[0].ms;
  const winners = sorted.filter((item) => Math.abs(item.ms - anchor) < OFFICE_BONUS_TIE_MS);
  const points = splitOfficeBonusPoints(winners.length);
  return winners.map((item, index) => ({ userId: item.userId, at: new Date(item.ms).toISOString(), points: points[index] }));
}

// Primeiro a chegar. `ready` só quando ninguém mais pode empatar: agora >= 1ª chegada + 3 min (+ folga).
export function decideFirstArrival({ checkins, participantIds, absencesByUser = new Map(), nowMs = Date.now() }) {
  const candidates = eligibleRows(checkins, participantIds, absencesByUser)
    .filter((row) => row.source === "wifi")
    .map((row) => ({ userId: row.user_id, ms: Date.parse(row.first_seen_at || "") }))
    .filter((item) => Number.isFinite(item.ms));
  if (!candidates.length) return { ready: false, winners: [] };
  const firstMs = Math.min(...candidates.map((item) => item.ms));
  if (nowMs < firstMs + OFFICE_BONUS_TIE_MS + OFFICE_BONUS_DECIDE_MARGIN_MS) return { ready: false, winners: [] };
  return { ready: true, winners: pickWinners(candidates, 1) };
}

// Último a sair: último sinal no Wi-Fi do dia (qualquer linha do dia com last_wifi_seen_at — é sinal real do Wi-Fi).
// Quem chama garante que o dia já terminou.
export function decideLastDeparture({ checkins, participantIds, absencesByUser = new Map() }) {
  const candidates = eligibleRows(checkins, participantIds, absencesByUser)
    .map((row) => ({ userId: row.user_id, ms: Date.parse(row.last_wifi_seen_at || "") }))
    .filter((item) => Number.isFinite(item.ms));
  return { ready: candidates.length > 0, winners: pickWinners(candidates, -1) };
}

// Linhas gravadas (office_presence_bonus_awards) -> lançamentos de pontos dentro do período [startMs, endMs).
export function officeBonusEntries(awards, { startMs = -Infinity, endMs = Infinity } = {}) {
  const entries = [];
  for (const award of awards || []) {
    const label = OFFICE_BONUS_LABELS[award?.kind];
    if (!label) continue;
    const winners = Array.isArray(award.winners) ? award.winners : [];
    const shared = winners.length > 1;
    for (const winner of winners) {
      const ms = Date.parse(winner?.at || "");
      const points = Number(winner?.points) || 0;
      if (!winner?.userId || !points || !Number.isFinite(ms) || ms < startMs || ms >= endMs) continue;
      entries.push({
        brokerId: winner.userId,
        kind: award.kind,
        points,
        occurredAt: winner.at,
        action: `${label} na imobiliária${shared ? ` (dividido entre ${winners.length})` : ""}`,
        origin: "Presença na imobiliária"
      });
    }
  }
  return entries;
}
