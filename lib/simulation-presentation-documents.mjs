// Lista de documentos da apresentação (cena de documentos, folha "Lista de documentos" e imagem PNG para baixar).
//
// FONTE AUTORITATIVA DO TEXTO: a imagem de referência do próprio dono (round 3, 2026-10-05). Títulos e descrições são
// exatamente os dela; só os itens "Comprovante de renda", "Comprovante de estado civil" e "Certidão de dependentes" variam
// conforme o cadastro do cliente (decisão do dono). Os demais itens são fixos para todos.
//
// PRIVACIDADE: a página é PÚBLICA por link. Os dados do cadastro (tipo de renda, estado civil, filhos) são lidos AQUI,
// no servidor, e só a lista FINAL (títulos e descrições já resolvidos) sai para o DTO, a cena e o PNG. O valor cru nunca
// sai. A personalização revela, de forma implícita, o perfil (ex.: "certidão de casamento") — decisão do dono; o link é
// não previsível (token de 128 bits).
//
// REGRA DE ENGANO ZERO: dado ausente/placeholder → linha "desconhecido" da referência (lista completa). Nada é inventado.

export const DOCUMENTS_SCENE_TEXT = "Para validarmos esses valores junto à Caixa, vamos precisar montar a sua pasta. Para isso, preciso de alguns documentos.";

/** Cabeçalho da imagem (mesmo texto do canto superior das cenas). */
export const BRAND_NAME = "MATHEUS MACHADO";
export const BRAND_ROLE = "CORRETOR DE IMÓVEIS";
export const BRAND_CRECI = "CRECI 323106";

// Marcador do sistema para data de nascimento ausente (cadastro manual): os demais campos desse cadastro também são
// placeholders (renda informal / solteiro / sem filhos), então não representam o cliente.
const MANUAL_PLACEHOLDER_BIRTH_DATE = "1900-01-01";

const ENGINE = "lib/document-requirements-engine.js";

// Onde, no motor documental do CRM, está a regra que cada variação personalizada espelha (um teste confere os trechos).
export const DOCUMENT_PERSONALIZATION_SOURCES = [
  { file: ENGINE, anchor: "envie a certidão de nascimento" },
  { file: ENGINE, anchor: "envie a certidão de casamento" },
  { file: ENGINE, anchor: "certidão de casamento com a averbação do divórcio" },
  { file: ENGINE, anchor: "envie os 2 últimos holerites (sem férias)" },
  { file: ENGINE, anchor: "envie os 3 últimos extratos bancários OU as 3 últimas faturas de cartão de crédito" },
  { file: ENGINE, anchor: "envie a declaração completa do ano vigente e o recibo de entrega" },
  { file: ENGINE, anchor: "só exige quando o cadastro afirma explicitamente" }
];

const INCOME_FORMAL = "Os 2 últimos holerites (sem férias) ou Imposto de Renda do ano vigente";
const INCOME_INFORMAL = "Os 3 últimos extratos bancários ou as 3 últimas faturas de cartão de crédito";
const INCOME_UNKNOWN = [
  "Formal (2 últimos holerites s/férias) ou Imposto de Renda do ano vigente",
  "Informal (3 últimos extratos bancários ou 3 últimas faturas de cartão de crédito)"
];

const MARITAL_TEXT = {
  nascimento: "Certidão de nascimento",
  casamento: "Certidão de casamento",
  averbado: "Certidão de casamento com a averbação do divórcio",
  desconhecido: "Certidão de nascimento ou casamento"
};

const INCOME_KIND = {
  registered_employment: "formal",
  income_tax_declarant: "formal", // Imposto de Renda: coberto pela linha "ou Imposto de Renda do ano vigente"
  self_employed_unregistered: "informal"
};

const MARITAL_KIND = {
  single: "nascimento",
  married: "casamento",
  stable_union: "casamento",
  divorced: "averbado"
  // widowed e demais: o motor não define documento → "desconhecido"
};

function unanimous(values) {
  if (!values.length || values.some((value) => !value)) return "desconhecido";
  return values.every((value) => value === values[0]) ? values[0] : "desconhecido";
}

/**
 * Perfil documental derivado do cadastro (SÓ no servidor; nunca serializar). Aceita o cadastro como devolvido por
 * `getSimulationRegistration` (camelCase). Cadastro ausente, manual (placeholder) ou com valor fora da lista → "desconhecido".
 * @returns {{ income: "formal"|"informal"|"desconhecido", marital: "nascimento"|"casamento"|"averbado"|"desconhecido", dependents: "sim"|"nao"|"desconhecido" }}
 */
export function deriveDocumentProfile(registration) {
  const unknown = { income: "desconhecido", marital: "desconhecido", dependents: "desconhecido" };
  if (!registration || typeof registration !== "object") return unknown;
  if (String(registration.oldestBirthDate || "") === MANUAL_PLACEHOLDER_BIRTH_DATE) return unknown;

  const joint = registration.simulationType === "joint";
  const incomes = [registration.primaryIncomeType, ...(joint ? [registration.secondaryIncomeType] : [])].map((value) => INCOME_KIND[value] || "");
  const maritals = [registration.primaryMaritalStatus, ...(joint ? [registration.secondaryMaritalStatus] : [])].map((value) => MARITAL_KIND[value] || "");
  const children = registration.hasChildrenUnder18;

  return {
    income: unanimous(incomes),
    marital: unanimous(maritals),
    dependents: children === true ? "sim" : children === false ? "nao" : "desconhecido"
  };
}

function item(id, title, description = "", lines = []) {
  return { id, title, description, lines };
}

/**
 * Lista FINAL de documentos (já resolvida), na ordem da referência do dono. Só dados de texto; nada do cadastro.
 * Dependentes: omitido quando o cadastro diz que NÃO há filhos menores de 18 anos; com filhos ou desconhecido → aparece.
 */
export function buildDocumentItems(profile = {}) {
  const income = profile.income || "desconhecido";
  const marital = profile.marital || "desconhecido";
  const items = [
    item("identidade", "DOCUMENTAÇÃO DE IDENTIDADE COM FOTO", "RG com CPF ou CNH, foto do documento aberto"),
    item("residencia", "COMPROVANTE DE RESIDÊNCIA ATUAL", "Máximo de dois meses atrás"),
    item("estado-civil", "COMPROVANTE DE ESTADO CIVIL", MARITAL_TEXT[marital] || MARITAL_TEXT.desconhecido)
  ];
  if (profile.dependents !== "nao") {
    items.push(item("dependentes", "CERTIDÃO DE DEPENDENTES", "Certidão de nascimento de filhos menores de 18 anos"));
  }
  if (income === "formal") items.push(item("renda", "COMPROVANTE DE RENDA", INCOME_FORMAL));
  else if (income === "informal") items.push(item("renda", "COMPROVANTE DE RENDA", INCOME_INFORMAL));
  else items.push(item("renda", "COMPROVANTE DE RENDA", "", INCOME_UNKNOWN));
  items.push(
    item("carteira", "CARTEIRA DE TRABALHO", "Foto, identificação e todos os registros"),
    item("pis", "DOCUMENTAÇÃO COM O NÚMERO DO PIS", "Pode ser encontrado na carteira de trabalho física e nos aplicativos Meu INSS, Carteira de Trabalho Digital, FGTS, Caixa Trabalhador e Caixa Tem"),
    item("fgts", "EXTRATO DO FGTS ATUALIZADO"),
    item("contato", "E-MAIL E TELEFONE COM DDD")
  );
  return items;
}

/** Atalho: cadastro → lista final. */
export function buildDocumentItemsFor(registration) {
  return buildDocumentItems(deriveDocumentProfile(registration));
}
