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
