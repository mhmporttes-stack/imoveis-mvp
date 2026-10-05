import "server-only";
import { AdminPermissionError, canUseProfileDatabaseScope, isBrokerProfile, isGeneralAdminAuth, isManagerProfile, isOwnerAdminEmail } from "@/lib/admin-profiles";

import { brokerClientScopeClause } from "@/lib/client-returned-scope-core.mjs";

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

// `returnedFromColumn` (só a tabela de clientes): inclui também o cliente
// devolvido à fila que estava com o corretor (ver lib/client-returned-scope-core.mjs).
export function applyResponsibleUserScope(query, auth, column = "responsible_user_id", explicitResponsibleUserId = "", { returnedFromColumn = "" } = {}) {
  const profile = auth?.profile;

  if (isGeneralAdminAuth(auth)) {
    if (explicitResponsibleUserId === "unassigned") return query.is(column, null);
    if (explicitResponsibleUserId) return query.eq(column, explicitResponsibleUserId);
    return query;
  }

  if (isBrokerProfile(profile) && canUseProfileDatabaseScope(profile)) {
    const ids = [profile.id, profile.linkedBrokerId].filter(Boolean);
    if (returnedFromColumn) return query.or(brokerClientScopeClause(ids, column, returnedFromColumn));
    return ids.length > 1 ? query.in(column, ids) : query.eq(column, profile.id);
  }

  if (isBrokerProfile(profile)) return query.eq(column, EMPTY_UUID);

  if (isManagerProfile(profile) && canUseProfileDatabaseScope(profile)) {
    const ids = profile.managedUserIds || [profile.id];
    if (explicitResponsibleUserId === "unassigned") return query.is(column, null);
    if (explicitResponsibleUserId) {
      return ids.includes(explicitResponsibleUserId) ? query.eq(column, explicitResponsibleUserId) : query.eq(column, EMPTY_UUID);
    }
    // Sem filtro explícito: time do gestor + clientes "aguardando" (roleta
    // sem corretor on-line ainda, column IS NULL) — sem isso, um cliente na
    // fila de espera fica invisível pro gestor até alguém ser distribuído.
    return query.or(`${column}.in.(${ids.join(",")}),${column}.is.null`);
  }

  if (isManagerProfile(profile)) return query.eq(column, EMPTY_UUID);

  return query;
}

export function assertCanAccessResponsibleUser(auth, responsibleUserId) {
  const profile = auth?.profile;
  if (isGeneralAdminAuth(auth)) return;
  if (isBrokerProfile(profile) && [profile.id, profile.linkedBrokerId].filter(Boolean).includes(responsibleUserId)) return;
  if (isManagerProfile(profile) && (profile.managedUserIds || [profile.id]).includes(responsibleUserId)) return;
  throw new AdminPermissionError();
}

export function assertGeneralAdmin(auth) {
  if (isGeneralAdminAuth(auth)) return;
  throw new AdminPermissionError("Apenas o administrador geral pode acessar esta área.");
}

export function assertGeneralAdminOrManager(auth) {
  if (isGeneralAdminAuth(auth) || isManagerProfile(auth?.profile)) return;
  throw new AdminPermissionError("Apenas gestor ou administrador geral pode acessar esta área.");
}

// Painel gerencial da Meta Diária: exclusivo do administrador principal
// (dono da operação), não de qualquer administrador geral — reaproveita a
// mesma identificação já usada para o owner em todo o resto do app.
export function assertOwnerAdmin(auth) {
  if (isOwnerAdminEmail(auth?.user?.email)) return;
  throw new AdminPermissionError("Apenas o administrador principal pode acessar esta área.");
}

export function isAdminPermissionError(error) {
  return error instanceof AdminPermissionError || error?.status === 403;
}
