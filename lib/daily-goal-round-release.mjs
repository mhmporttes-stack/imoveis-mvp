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
