// Fonte única dos rótulos usados tanto na tela de documentação (admin) quanto
// no PDF gerado pra CCA — antes cada um mantinha sua própria cópia, o que já
// tinha divergido (ex.: "A confirmar" no PDF vs "Necessita confirmação" na
// tela para o mesmo status precisa_confirmacao, e o PDF nem tinha rótulo pra
// em_analise, o status padrão da coluna no banco).
export const MARITAL_LABELS = {
  married: "Casado(a)",
  single: "Solteiro(a)",
  divorced: "Divorciado(a)",
  stable_union: "União estável",
  widowed: "Viúvo(a)"
};

export const INCOME_LABELS = {
  registered_employment: "CLT / registrado",
  income_tax_declarant: "Declarante de IR",
  self_employed_unregistered: "Autônomo"
};

export const PERSON_ROLE_LABELS = {
  titular: "Titular",
  conjuge: "Cônjuge",
  dependente: "Dependente(s)",
  outro: "Outro"
};

export const DOCUMENT_STATUS_LABELS = {
  conforme: "Conforme",
  pendencia: "Pendência",
  ilegivel: "Ilegível",
  ausente: "Ausente",
  divergencia: "Divergência",
  precisa_confirmacao: "Necessita confirmação",
  em_analise: "Em análise"
};
