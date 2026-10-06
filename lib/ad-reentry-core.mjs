// Regras puras da "reentrada por anuncio" (sem acesso a banco, testaveis).
// Cliente que JA existe no CRM e volta a preencher o formulario por um link de
// campanha ATIVA (anuncio patrocinado) vira um novo cadastro (tag da campanha +
// roleta), duplicado de proposito — pedido do dono (2026-10-06): mostra que o
// corretor atual nao esta dando atencao e permite cobrar. Reenvio em poucos
// minutos (duplo clique/retry de rede) continua sendo o mesmo cadastro, para
// nao gerar dois cards da mesma submissao.
export const AD_REENTRY_COOLDOWN_MS = 10 * 60 * 1000;

export function isSponsoredReentry(existing, assignment, now = Date.now()) {
  if (!existing?.id || !assignment?.isActiveCampaign) return false;
  const createdAt = Date.parse(existing.createdAt || "");
  return !(Number.isFinite(createdAt) && now - createdAt < AD_REENTRY_COOLDOWN_MS);
}

export function markAdReentry(origin, existing) {
  if (!existing?.id) return origin;
  return {
    ...origin,
    metadata: {
      ...(origin?.metadata || {}),
      ad_reentry: true,
      ad_reentry_of: existing.id,
      ad_reentry_previous_responsible: existing.responsibleUserId || ""
    }
  };
}
