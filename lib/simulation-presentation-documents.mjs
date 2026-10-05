// Lista de documentos da apresentação (cena de documentos, folha "Lista de documentos" e imagem PNG para baixar).
//
// FONTE AUTORITATIVA DO TEXTO: a imagem de referência do próprio dono (round 3, 2026-10-05). Títulos e descrições são
// exatamente os dela; variam conforme o cadastro do cliente (decisão do dono, ver PRES-16): estado civil, renda, observação
// do comprovante de residência, PIS (sai se já cadastrado), dependentes e, no cadastro conjunto, um bloco por proponente.
//
// PRIVACIDADE: a página é PÚBLICA por link. Os dados do cadastro (tipo de renda, estado civil, filhos, PIS) são lidos AQUI,
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

const INCOME_CLT = "Os 2 últimos holerites (sem férias)";
const INCOME_IR = "Declaração completa do Imposto de Renda do ano vigente e recibo de entrega";
const INCOME_IR_OBS = "Deve estar no seu nome";
const INCOME_INFORMAL = "Os 3 últimos extratos bancários ou as 3 últimas faturas de cartão de crédito";
const INCOME_UNKNOWN = [
  "Formal (2 últimos holerites s/férias) ou Imposto de Renda do ano vigente",
  "Informal (3 últimos extratos bancários ou 3 últimas faturas de cartão de crédito)"
];

const MARITAL_TEXT = {
  nascimento: "Certidão de nascimento",
  casamento: "Certidão de casamento",
  averbado: "Certidão de casamento", // + observação (MARITAL_OBS)
  desconhecido: "Certidão de nascimento ou casamento"
};

// Observação em linha menor, abaixo da descrição (só o divorciado).
const MARITAL_OBS = {
  averbado: "Com averbação do divórcio"
};

// Observação do comprovante de residência conforme o tipo de renda DA PESSOA (regra do dono 2026-10-05).
// Renda desconhecida → sem observação (a mais neutra: não afirma nada que não se sabe).
const RESIDENCE_OBS = {
  clt: "Pode estar no nome de um parente ou de outra pessoa",
  ir: "Obrigatoriamente no seu nome",
  informal: "Obrigatoriamente no seu nome"
};

const INCOME_KIND = {
  registered_employment: "clt",
  income_tax_declarant: "ir",
  self_employed_unregistered: "informal"
};

const MARITAL_KIND = {
  single: "nascimento",
  married: "casamento",
  stable_union: "nascimento", // regra do dono 2026-10-05: união estável pede certidão de nascimento
  divorced: "averbado",
  widowed: "casamento" // regra do dono 2026-10-05: viúvo pede só a certidão de casamento
};

const PERSON_UNKNOWN = { income: "desconhecido", marital: "desconhecido", pisKnown: false };

/**
 * Perfil documental derivado do cadastro (SÓ no servidor; nunca serializar). Aceita o cadastro como devolvido por
 * `getSimulationRegistration` (camelCase). Cadastro ausente, manual (placeholder) ou com valor fora da lista → "desconhecido".
 * Cada proponente tem o PRÓPRIO estado civil e renda (cadastro conjunto → 2 pessoas). `pisKnown`: o PIS já está cadastrado
 * (a tabela só guarda o PIS do titular; o 2º proponente sempre pede).
 * @returns {{ income, marital, pisKnown, dependents: "sim"|"nao"|"desconhecido", people: Array<{income, marital, pisKnown}> }}
 *   (income/marital/pisKnown de topo = 1ª pessoa)
 */
export function deriveDocumentProfile(registration) {
  const unknown = { ...PERSON_UNKNOWN, dependents: "desconhecido", people: [{ ...PERSON_UNKNOWN }] };
  if (!registration || typeof registration !== "object") return unknown;
  if (String(registration.oldestBirthDate || "") === MANUAL_PLACEHOLDER_BIRTH_DATE) return unknown;

  const person = (incomeType, maritalStatus, pisKnown) => ({
    income: INCOME_KIND[incomeType] || "desconhecido",
    marital: MARITAL_KIND[maritalStatus] || "desconhecido",
    pisKnown
  });
  const people = [person(registration.primaryIncomeType, registration.primaryMaritalStatus, Boolean(String(registration.pis || "").trim()))];
  if (registration.simulationType === "joint") people.push(person(registration.secondaryIncomeType, registration.secondaryMaritalStatus, false));
  const children = registration.hasChildrenUnder18;

  return {
    ...people[0],
    dependents: children === true ? "sim" : children === false ? "nao" : "desconhecido",
    people
  };
}

function item(id, title, description = "", lines = [], obs = "", heading = false) {
  // `obs` e `heading` só existem no item quando preenchidos: os demais itens mantêm o formato antigo.
  const base = { id, title, description, lines };
  if (obs) base.obs = obs;
  if (heading) base.heading = true;
  return base;
}

function incomeItem(id, income) {
  if (income === "clt") return item(id("renda"), "COMPROVANTE DE RENDA", INCOME_CLT);
  if (income === "ir") return item(id("renda"), "COMPROVANTE DE RENDA", INCOME_IR, [], INCOME_IR_OBS);
  if (income === "informal") return item(id("renda"), "COMPROVANTE DE RENDA", INCOME_INFORMAL);
  return item(id("renda"), "COMPROVANTE DE RENDA", "", INCOME_UNKNOWN);
}

const dependentsItem = () => item("dependentes", "CERTIDÃO DE DEPENDENTES", "Certidão de nascimento de filhos menores de 18 anos");

// Só o e-mail: o telefone já está com o corretor (regra do dono 2026-10-05).
const contactItem = () => item("contato", "E-MAIL");

// Itens de UMA pessoa, na ordem da referência do dono. `suffix` distingue os ids no cadastro conjunto.
// `afterCivil`: itens da família que entram logo depois do estado civil (dependentes, no cadastro individual).
function personItems(person, suffix = "", afterCivil = []) {
  const income = person.income || "desconhecido";
  const marital = person.marital || "desconhecido";
  const id = (base) => `${base}${suffix}`;
  const items = [
    item(id("identidade"), "DOCUMENTAÇÃO DE IDENTIDADE COM FOTO", "RG com CPF ou CNH, foto do documento aberto"),
    item(id("residencia"), "COMPROVANTE DE RESIDÊNCIA ATUAL", "Máximo de dois meses atrás", [], RESIDENCE_OBS[income] || ""),
    item(id("estado-civil"), "COMPROVANTE DE ESTADO CIVIL", MARITAL_TEXT[marital] || MARITAL_TEXT.desconhecido, [], MARITAL_OBS[marital] || ""),
    ...afterCivil,
    incomeItem(id, income),
    // Carteira de trabalho: para todos (a pessoa pode ter registro), regra do dono 2026-10-05.
    item(id("carteira"), "CARTEIRA DE TRABALHO", "Foto, identificação e todos os registros")
  ];
  // PIS é um NÚMERO: se já está no cadastro, o item sai da lista da pessoa (regra do dono 2026-10-05).
  if (!person.pisKnown) {
    items.push(item(id("pis"), "DOCUMENTAÇÃO COM O NÚMERO DO PIS", "Pode ser encontrado na carteira de trabalho física e nos aplicativos Meu INSS, Carteira de Trabalho Digital, FGTS, Caixa Trabalhador e Caixa Tem"));
  }
  items.push(item(id("fgts"), "EXTRATO DO FGTS ATUALIZADO"));
  return items;
}

/**
 * Lista FINAL de documentos (já resolvida), na ordem da referência do dono. Só dados de texto; nada do cadastro.
 * Individual: lista única. Conjunto (`profile.people` com 2 pessoas): um bloco por proponente ("PROPONENTE 1"/"PROPONENTE 2";
 * o cadastro não guarda o nome do 2º, então nunca se usa nome nem sobrenome), depois o bloco "PARA OS DOIS" com dependentes
 * (uma vez só, é da família) e e-mail.
 * Dependentes: omitido quando o cadastro diz que NÃO há filhos menores de 18 anos; com filhos ou desconhecido → aparece.
 */
export function buildDocumentItems(profile = {}) {
  const people = Array.isArray(profile.people) && profile.people.length
    ? profile.people
    : [{ income: profile.income, marital: profile.marital, pisKnown: profile.pisKnown === true }];
  const dependents = profile.dependents !== "nao" ? [dependentsItem()] : [];

  if (people.length < 2) return [...personItems(people[0], "", dependents), contactItem()];

  const items = [];
  people.slice(0, 2).forEach((person, index) => {
    items.push(item(`grupo-p${index + 1}`, `PROPONENTE ${index + 1}`, "", [], "", true));
    items.push(...personItems(person, `-p${index + 1}`));
  });
  items.push(item("grupo-familia", "PARA OS DOIS", "", [], "", true), ...dependents, contactItem());
  return items;
}

/** Atalho: cadastro → lista final. */
export function buildDocumentItemsFor(registration) {
  return buildDocumentItems(deriveDocumentProfile(registration));
}
