// Visibilidade de campos INTERNOS de empreendimento/imóvel por perfil (T-75,
// decisão do dono em 2026-10-04): dono (admin) e gestor veem tudo; corretor e
// associado NÃO recebem as "Informações internas" (internalNotes) nem o autor
// do cadastro (createdByUserId). Função pura: nunca muta o objeto original.
// O filtro tem que rodar no SERVIDOR, antes de passar props a um componente —
// props de Client Component vão no código enviado ao navegador.

export const INTERNAL_PROPERTY_FIELDS = ["internalNotes", "createdByUserId"];

export function redactInternalPropertyFields(property, canViewInternal) {
  if (!property || typeof property !== "object") return property;
  if (canViewInternal === true) return property;
  const copy = { ...property };
  for (const field of INTERNAL_PROPERTY_FIELDS) {
    if (field in copy) copy[field] = "";
  }
  return copy;
}

export function redactInternalPropertyList(properties, canViewInternal) {
  return (properties || []).map((property) => redactInternalPropertyFields(property, canViewInternal));
}

// O gerador de simulação monta o PDF/imagem do cliente a partir de imagens e
// textos; não usa o book em base64 (pdfData), que só pesaria no navegador.
export function withoutPropertyPdf(properties) {
  return (properties || []).map((property) => {
    if (!property || typeof property !== "object" || !("pdfData" in property)) return property;
    return { ...property, pdfData: "" };
  });
}
