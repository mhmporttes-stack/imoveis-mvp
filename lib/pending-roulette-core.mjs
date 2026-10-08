// Fila de espera da roleta (pending_distribution_at): quem a roleta pode entregar a um corretor on-line.
// Regra do dono (2026-10-06): transferência MANUAL a um corretor vale — o cliente que já tem um responsável
// que não é o dono (o dono só "segura" o lead até alguém ficar on-line, FUN-11) sai da fila de espera e a
// roleta nunca o toma de volta. Puro e testado (tests/pending-roulette.test.mjs).

export function pendingRouletteRowsToDeliver(rows, ownerId = "") {
  const deliver = [];
  const release = [];
  for (const row of rows || []) {
    const responsible = row?.responsible_user_id || "";
    if (!responsible || (ownerId && responsible === ownerId)) deliver.push(row);
    else release.push(row);
  }
  return { deliver, release };
}

// Regra do dono (2026-10-08): a fila de espera é entregue AOS POUCOS — no máximo 1 cliente por corretor on-line a
// cada rodada do cron (a cada 2 minutos). Assim quem fica on-line primeiro não leva a fila inteira de uma vez e
// os outros corretores têm chance de entrar. Entre vários on-line, a ordem continua a da roleta.
export const WAITING_QUEUE_INTERVAL_MINUTES = 2;

export function waitingQueueBatchSize(pendingCount, onlineBrokerCount) {
  const pending = Math.max(0, Number(pendingCount) || 0);
  const online = Math.max(0, Number(onlineBrokerCount) || 0);
  return Math.min(pending, online);
}
