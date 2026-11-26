import { hasSalePrice, MARKETPLACE_PRICE_REQUIRED_MESSAGE } from "./marketplace-core.mjs";

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-11-25] Todo imóvel cadastrado no CRM tem valor de venda; o site pode
// esconder (hide_price), o Marketplace sempre leva. Empreendimento (is_development) não exige (interpretação a confirmar).
export const PROPERTY_PRICE_REQUIRED_MESSAGE = "Informe o valor de venda do imóvel (ele só aparece para a equipe se o site estiver sem valores).";
export { hasSalePrice, MARKETPLACE_PRICE_REQUIRED_MESSAGE };

// Só valida o que vai ser gravado; leitura/listagem de imóvel antigo sem valor nunca passa por aqui.
export function assertPropertySalePrice(property) {
  if (property?.isDevelopment === true) return;
  if (!hasSalePrice(property?.price)) throw new Error(PROPERTY_PRICE_REQUIRED_MESSAGE);
}
