// Núcleo puro dos limites da Meta Diária.
// Os valores EFETIVOS vivem no banco (daily_goal_wallet_config / daily_goal_quota_versions);
// estas constantes são só o padrão de código quando a linha não existe.
// [REGRA OFICIAL — dono, 2026-10-04] Carteira ativa = NO MÁXIMO 30 por corretor (era 50 desde 2026-10-02, 100 antes).
// Esta é a ÚNICA constante do teto no código; o SQL lê o teto de daily_goal_wallet_config (migration 20261004200000).
export const MAX_WALLET_LIMIT = 30; // teto da carteira ativa (antes 50): nem a tela de configuração aceita mais que isto
export const DEFAULT_WALLET_LIMIT = MAX_WALLET_LIMIT; // padrão de código quando a linha do banco não existe
export const DEFAULT_DAILY_NEW_CONTACTS = 10; // novos contatos/dia exigidos (antes 20)

// Espelho em JS de public.daily_goal_reserve_wallet_slots: acima do teto (ou no teto) concede 0;
// abaixo, completa no máximo até o teto. A reserva nunca remove ninguém — quem excede é tratado pelo
// rebalanceamento (daily_goal_wallet_trim), não pela reserva.
export function walletSlotsAvailable({ limit = DEFAULT_WALLET_LIMIT, current = 0, requested = 0, blockOnLimit = true } = {}) {
  if (requested <= 0) return 0;
  if (!blockOnLimit) return requested;
  return Math.min(requested, Math.max(limit - current, 0));
}

// Espelho em JS de public.daily_goal_wallet_trim_plan (migration 20261004200000): decide, por corretor, quais
// rodadas ativas FICAM, quais viram "zumbi" (contato já devolvido à fila) e quais são o EXCEDENTE devolvido à
// Prospecção. O SQL é a fonte de verdade (roda no banco); este espelho existe para o teste de paridade e para
// documentar a prioridade. Prioridade de quem fica:
//   0) protegida (negócio em andamento, resposta do cliente, atividade futura, envio em andamento): nunca sai;
//   1) mais avançada na cadência (attempt_count maior);
//   2) contato mais recente (maior entre a última tentativa da rodada e a última tentativa do contato);
//   3) rodada mais antiga (round_started_at, depois created_at);
//   4) id (desempate fixo, determinístico).
// round: { id, brokerId, attemptCount, lastAttemptAt, roundStartedAt, createdAt, zombie, protectedReason }
export function planWalletTrim(rounds, { limit = DEFAULT_WALLET_LIMIT, enforce = true } = {}) {
  const decisions = new Map();
  const byBroker = new Map();
  for (const round of rounds) {
    if (!byBroker.has(round.brokerId)) byBroker.set(round.brokerId, []);
    byBroker.get(round.brokerId).push(round);
  }
  const time = (value) => (value ? new Date(value).getTime() : -Infinity);
  for (const list of byBroker.values()) {
    const protectedCount = list.filter((r) => !r.zombie && r.protectedReason).length;
    const candidates = list.filter((r) => !r.zombie && !r.protectedReason).sort((a, b) =>
      (b.attemptCount - a.attemptCount)
      || (time(b.lastAttemptAt) - time(a.lastAttemptAt))
      || (time(a.roundStartedAt) - time(b.roundStartedAt))
      || (time(a.createdAt) - time(b.createdAt))
      || String(a.id).localeCompare(String(b.id)));
    const room = Math.max(limit - protectedCount, 0);
    for (const r of list) {
      if (r.zombie) decisions.set(r.id, "zombie");
      else if (!enforce || r.protectedReason) decisions.set(r.id, "keep");
    }
    candidates.forEach((r, index) => decisions.set(r.id, !enforce || index < room ? "keep" : "return"));
  }
  return decisions;
}
