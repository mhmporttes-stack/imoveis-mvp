// Rótulos curtos do bloco "Cadastro do cliente" da aba da simulação (pedido do dono, 2026-10-19). Só apresentação.
// "Primeiro imóvel" é o INVERSO do campo gravado `has_residential_property` ("Possui imóvel residencial?"):
// "Primeiro imóvel: Sim" = NÃO possui imóvel (false); "Não" = possui (true). O dado salvo continua o mesmo campo.

/** Valor da opção "Primeiro imóvel" ("true"/"false"/"") a partir do `hasResidentialProperty` gravado. */
export function firstPropertyOptionValue(hasResidentialProperty) {
  if (hasResidentialProperty === true) return "false";
  if (hasResidentialProperty === false) return "true";
  return "";
}

/** `hasResidentialProperty` a gravar a partir da opção escolhida em "Primeiro imóvel". */
export function hasResidentialPropertyFromFirstPropertyOption(optionValue) {
  return optionValue !== "true";
}

export const FIRST_PROPERTY_OPTIONS = [
  { value: "true", label: "Sim" }, // rótulo do campo já é "Primeiro imóvel" (no celular "Sim, primeiro imóvel" cortava)
  { value: "false", label: "Não" }
];
