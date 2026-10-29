import { redactInternalPropertyFields, redactInternalPropertyList } from "./property-visibility-core.mjs";

// [REGRA OFICIAL — dono, 2026-10-29, substitui a de 2026-10-04/16] Campos internos do imóvel (contato do
// proprietário, informações internas, exclusividade, endereço completo, documentos) são vistos por TODOS os perfis
// logados no painel (admin, gestor, corretor, associado). `auth` vem dos guards (requireAdminPage etc.).
// Sem auth/perfil: nega (falha fechada). Site público nunca recebe (lib/public-properties.js).
export function canViewInternalPropertyFields(auth) {
  return Boolean(auth && auth.profile);
}

export function redactPropertyForAuth(property, auth) {
  return redactInternalPropertyFields(property, canViewInternalPropertyFields(auth));
}

export function redactPropertiesForAuth(properties, auth) {
  return redactInternalPropertyList(properties, canViewInternalPropertyFields(auth));
}
