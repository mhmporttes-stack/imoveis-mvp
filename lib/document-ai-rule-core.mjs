export function residenceDecision({ rule, incomeType, documentName, clientName }) {
  if (!rule?.active || rule.ruleKey !== "residence_income_ownership") return null;
  const policy = rule.policy?.[incomeType];
  if (!policy || !documentName || !clientName) return { status: "precisa_confirmacao", reason: "Confirme o perfil de renda e a titularidade do comprovante." };
  if (policy === "validation") return { status: "precisa_confirmacao", reason: "A regra pede validação manual da titularidade." };
  const normalize = (value) => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
  const sameName = normalize(documentName) === normalize(clientName);
  if (normalize(documentName).split(" ").length < 2) return { status: "precisa_confirmacao", reason: "Nome incompleto no comprovante; confirme a titularidade." };
  if (policy === "titular_only" && !sameName) return { status: "pendencia", reason: "Renda informal exige comprovante em nome do próprio cliente." };
  if (policy === "third_party_allowed" || sameName) return { status: "conforme", reason: "Titularidade permitida para o perfil de renda informado." };
  return { status: "precisa_confirmacao", reason: "Regra de titularidade sem definição válida." };
}

export function residencePolicyInstruction(policy) {
  const describe = (value) => value === "titular_only" ? "comprovante no nome do cliente" : value === "third_party_allowed" ? "comprovante em nome de terceiro permitido" : "solicitar validação";
  return `Identifique primeiro o perfil de renda. Renda informal: ${describe(policy.self_employed_unregistered)}. CLT: ${describe(policy.registered_employment)}. Declarante de IR: ${describe(policy.income_tax_declarant)}. Sem dados suficientes, solicite validação.`;
}
