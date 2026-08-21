import "server-only";
import { AdminPermissionError, canUseProfileDatabaseScope, isBrokerProfile, isGeneralAdminProfile } from "@/lib/admin-profiles";

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

export function applyResponsibleUserScope(query, auth, column = "responsible_user_id", explicitResponsibleUserId = "") {
  const profile = auth?.profile;

  if (isGeneralAdminProfile(profile)) {
    if (explicitResponsibleUserId === "unassigned") return query.is(column, null);
    if (explicitResponsibleUserId) return query.eq(column, explicitResponsibleUserId);
    return query;
  }

  if (isBrokerProfile(profile) && canUseProfileDatabaseScope(profile)) {
    return query.eq(column, profile.id);
  }

  if (isBrokerProfile(profile)) return query.eq(column, EMPTY_UUID);

  return query;
}

export function assertCanAccessResponsibleUser(auth, responsibleUserId) {
  const profile = auth?.profile;
  if (isGeneralAdminProfile(profile)) return;
  if (isBrokerProfile(profile) && responsibleUserId && responsibleUserId === profile.id) return;
  throw new AdminPermissionError();
}

export function assertGeneralAdmin(auth) {
  if (isGeneralAdminProfile(auth?.profile)) return;
  throw new AdminPermissionError("Apenas o administrador geral pode acessar esta área.");
}

export function isAdminPermissionError(error) {
  return error instanceof AdminPermissionError || error?.status === 403;
}
