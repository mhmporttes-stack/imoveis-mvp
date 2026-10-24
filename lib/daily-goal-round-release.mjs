// Contato que SAI do corretor (voltou para a fila, foi para outro corretor ou foi liberado) não pode deixar a
// rodada da Meta Diária ativa: a rodada ativa É a "carteira ativa" (card "Carteira ativa N/30"). Sem isto o
// contato já devolvido continuava contando na carteira do corretor antigo (rodada "zumbi": 94 casos em
// 2026-10-04, até 37 num só corretor), inflando o teto e o card. Encerra do mesmo jeito que a reconciliação
// existente (daily-goal.js reconcileDailyGoalRounds): rodada 'ended_no_conversion' + item PENDENTE da fila
// automática cancelado ('round_reconciled'). Tentativas (daily_goal_attempts), attempt_count e histórico
// ficam intactos; não conta ponto nem marca contato.
// `db` é o cliente do Supabase (injetado: o módulo é puro e testável, sem server-only).
// exceptBrokerId: não encerra a rodada do corretor que continua (ou passa a ser) o responsável pelo contato.
const CHUNK = 200;

export async function releaseActiveRoundsForContacts(db, contactIds, { exceptBrokerId = null, now = new Date() } = {}) {
  const ids = [...new Set((contactIds || []).filter(Boolean))];
  if (!ids.length) return { ended: 0 };
  const nowIso = now.toISOString();
  let ended = 0;
  for (let from = 0; from < ids.length; from += CHUNK) {
    let query = db.from("daily_goal_rounds")
      .update({ status: "ended_no_conversion", ended_at: nowIso })
      .in("prospecting_contact_id", ids.slice(from, from + CHUNK))
      .eq("status", "active");
    if (exceptBrokerId) query = query.neq("broker_id", exceptBrokerId);
    const { data, error } = await query.select("id");
    if (error) throw error;
    const roundIds = (data || []).map((row) => row.id);
    if (!roundIds.length) continue;
    ended += roundIds.length;
    const { error: queueError } = await db.from("daily_goal_auto_queue")
      .update({ status: "canceled", skip_reason: "round_reconciled", updated_at: nowIso })
      .in("round_id", roundIds)
      .eq("status", "pending");
    if (queueError) throw queueError;
  }
  return { ended };
}

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] "Se não foi tentado contato ele fica ali ainda": contato com rodada
// ATIVA da Meta Diária (ou do Disparar) sem nenhuma tentativa (attempt_count = 0) continua na carteira/meta do corretor
// no dia seguinte — o retorno automático de 7 dias não o devolve à fila. Sem isto, contato da 2ª passagem (que traz o
// last_attempt_at do ciclo anterior, nunca zerado pela reserva claim_daily_goal_contacts) era devolvido no mesmo ciclo
// do cron, sem ter recebido mensagem. Quem já recebeu tentativa segue o fluxo normal.
export async function listContactIdsWithUntriedActiveRound(db, contactIds) {
  const ids = [...new Set((contactIds || []).filter(Boolean))];
  const untried = new Set();
  for (let from = 0; from < ids.length; from += CHUNK) {
    const { data, error } = await db.from("daily_goal_rounds")
      .select("prospecting_contact_id")
      .in("prospecting_contact_id", ids.slice(from, from + CHUNK))
      .eq("status", "active")
      .eq("attempt_count", 0);
    if (error) throw error;
    for (const row of data || []) if (row.prospecting_contact_id) untried.add(row.prospecting_contact_id);
  }
  return untried;
}
