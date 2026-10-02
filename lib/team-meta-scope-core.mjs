// Escopo da visão de EQUIPE da Meta Diária/WhatsApp (REGRA OFICIAL — dono, 2026-10-02). Funções PURAS
// (testes: tests/team-meta-scope.test.mjs). A mesma tela serve o administrador principal (todos) e a
// gestora (SOMENTE a própria equipe). O isolamento é decidido AQUI, no backend — a tela só apresenta.

export const TEAM_META_MODE = Object.freeze({ OWNER: "owner", TEAM: "team", DENIED: "denied" });

// -> { mode: "owner" } | { mode: "team", ids: [...], selfId } | { mode: "denied" }
// manager: perfil efetivo é gestora (não admin geral); managedUserIds já vem de attachDataAccessScope
// (ela mesma + subordinados + associados vinculados a eles).
export function resolveTeamMetaScope({ isManager = false, isOwner = false, profileId = "", managedUserIds = null } = {}) {
  if (isManager) {
    const ids = [...new Set((Array.isArray(managedUserIds) && managedUserIds.length ? managedUserIds : [profileId]).filter(Boolean).map(String))];
    return { mode: TEAM_META_MODE.TEAM, ids, selfId: String(profileId || "") };
  }
  if (isOwner) return { mode: TEAM_META_MODE.OWNER };
  return { mode: TEAM_META_MODE.DENIED };
}

// Cards da gestora: só quem está na equipe dela, sem ela mesma (a visão é dos corretores).
export function filterProfilesForScope(profiles = [], scope) {
  if (!scope || scope.mode === TEAM_META_MODE.OWNER) return profiles;
  if (scope.mode !== TEAM_META_MODE.TEAM) return [];
  const allowed = new Set(scope.ids);
  return profiles.filter((profile) => profile?.id && allowed.has(profile.id) && profile.id !== scope.selfId);
}

// O corretor pedido (detalhe/histórico/restrição) está no escopo? Owner: sim; gestora: só equipe.
export function isBrokerInScope(scope, brokerId) {
  if (!scope || !brokerId) return false;
  if (scope.mode === TEAM_META_MODE.OWNER) return true;
  return scope.mode === TEAM_META_MODE.TEAM && scope.ids.includes(String(brokerId)) && String(brokerId) !== scope.selfId;
}
