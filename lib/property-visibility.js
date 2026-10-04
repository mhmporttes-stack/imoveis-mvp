import { isGeneralAdminAuth, isManagerProfile } from "./admin-profiles";
import { redactInternalPropertyFields, redactInternalPropertyList } from "./property-visibility-core.mjs";

// Só dono/admin e gestor veem os campos internos. `auth` é o resultado dos
// guards (requireAdminPage etc.), que já traz o perfil EFETIVO — durante
// "Alterar conta" o perfil emulado é o que vale. Sem auth: nega (falha fechada).
export function canViewInternalPropertyFields(auth) {
  if (!auth) return false;
  return isGeneralAdminAuth(auth) || isManagerProfile(auth.profile);
}

export function redactPropertyForAuth(property, auth) {
  return redactInternalPropertyFields(property, canViewInternalPropertyFields(auth));
}

export function redactPropertiesForAuth(properties, auth) {
  return redactInternalPropertyList(properties, canViewInternalPropertyFields(auth));
}
