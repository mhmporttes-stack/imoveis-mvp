// Regra pura do reconhecimento "Assumiu o 1º lugar do dia" (RAN-9, cron celebrations-ranking). Testada em
// tests/celebrations-ranking-core.test.mjs.
//
// O ranking é do DIA: a liderança de ontem não conta para os "Minutos seguros de liderança" de hoje. O estado
// (`celebration_ranking_lead_state`) não é zerado à meia-noite — antes do horário de início o cron sai cedo sem
// gravar nada —, então, quando o líder de hoje era o mesmo do fim do dia anterior, o `leading_since` antigo fazia o
// reconhecimento sair no 1º tick do dia (12:00 em ponto), sem esperar o tempo mínimo configurado.

const TIME_ZONE = "America/Sao_Paulo";

export function saoPauloDateOf(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// Devolve desde quando o líder atual está em 1º HOJE. `changed = true` quando a contagem recomeça (líder novo, sem
// registro ou liderança registrada num dia anterior) — o chamador grava `leadingSince` no estado.
export function resolveLeadingSince({ state, leaderId, nowIso, today }) {
  const previousSince = state?.leading_since || null;
  const sameLeader = Boolean(leaderId) && state?.leader_broker_id === leaderId;
  if (sameLeader && previousSince && saoPauloDateOf(previousSince) === today) {
    return { leadingSince: previousSince, changed: false };
  }
  return { leadingSince: nowIso, changed: true };
}

// ---------------- liderança diária em sequência (dono, 2026-10-30) ----------------
//
// Cada dia o cron do ranking grava quem fechou o dia em 1º (`celebration_daily_leaders`, o MESMO líder que o ranking
// do dia e o "assumiu o 1º lugar" usam: `dailyRankingLeader`). Aqui só se lê essa lista.
//
// `records` = [{ day: "AAAA-MM-DD", leader_broker_id: uuid|null }]. Conta os dias seguidos, até ontem, em que o MESMO
// corretor fechou em 1º. Dia sem líder quebra a sequência — exceto domingo (sem ranking: segunda a sábado), que é
// pulado. Devolve { leaderId, days } do líder do último dia de ranking, ou { leaderId: null, days: 0 }.
export function rankingLeaderStreak(records, today, { lookbackDays = 60 } = {}) {
  const byDay = new Map();
  for (const record of records || []) if (record?.day) byDay.set(String(record.day).slice(0, 10), record.leader_broker_id || null);

  let leaderId = null;
  let days = 0;
  for (let back = 1; back <= lookbackDays; back += 1) {
    const day = shiftDay(today, -back);
    const leader = byDay.get(day) || null;
    if (!leader) {
      if (new Date(`${day}T12:00:00Z`).getUTCDay() === 0) continue;
      break;
    }
    if (!leaderId) leaderId = leader;
    else if (leader !== leaderId) break;
    days += 1;
  }
  return { leaderId, days };
}

function shiftDay(day, delta) {
  const [year, month, date] = String(day).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10);
}
