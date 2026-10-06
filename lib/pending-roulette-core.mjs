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
