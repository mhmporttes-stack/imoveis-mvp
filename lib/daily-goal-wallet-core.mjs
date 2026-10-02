// Núcleo puro dos limites da Meta Diária (pedido do dono, 2026-10-02: metade do volume).
// Os valores EFETIVOS vivem no banco (daily_goal_wallet_config / daily_goal_quota_versions);
// estas constantes são só o padrão de código quando a linha não existe.
export const DEFAULT_WALLET_LIMIT = 50; // carteira ativa (antes 100)
export const DEFAULT_DAILY_NEW_CONTACTS = 10; // novos contatos/dia exigidos (antes 20)

// Espelho em JS de public.daily_goal_reserve_wallet_slots: nunca remove ninguém;
// acima do teto (ou no teto) concede 0; abaixo, completa no máximo até o teto.
export function walletSlotsAvailable({ limit = DEFAULT_WALLET_LIMIT, current = 0, requested = 0, blockOnLimit = true } = {}) {
  if (requested <= 0) return 0;
  if (!blockOnLimit) return requested;
  return Math.min(requested, Math.max(limit - current, 0));
}
