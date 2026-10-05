// Motor de regras documentais — 100% determinístico, SEM chamada de IA.
//
// A IA (lib/document-analysis.js) só tem um trabalho: olhar pra cada
// documento enviado e dizer O QUE ele é (tipo, papel da pessoa, dados
// extraídos, legibilidade). Este arquivo pega esses fatos JÁ CLASSIFICADOS
// e decide, por código puro, quais documentos ainda faltam — cruzando com o
// que já está cadastrado no cliente (estado civil, tipo de renda). A IA
// NUNCA decide "ausente": ela não tem mais essa responsabilidade, então não
// existe mais lista fixa de documentos sendo aplicada igualmente a todo
// cliente.
//
// Um requisito só vira "ausente"/"pendência" quando (1) ele realmente se
// aplica àquele cliente/papel E (2) nenhuma alternativa válida foi
// encontrada nos documentos já classificados — nunca por presunção.

const SPOUSE_REQUIRED_STATUSES = new Set(["married", "stable_union"]);

export function evaluateDocumentRequirements(clientContext, classifiedItems, activeRules = []) {
  const rows = [];
  const hasRule = (key) => activeRules.some((rule) => rule.ruleKey === key);
  const marriage = classifiedItems.find((item) => item.personRole === "titular" && item.documentType === "certidao_casamento" && item.extractedData?.divorceAnnotation === false);
  const divorced = classifiedItems.some((item) => item.personRole === "titular" && item.documentType === "certidao_casamento" && item.extractedData?.divorceAnnotation === true);
  const effectiveMarital = hasRule("marriage_spouse") && marriage ? "married" : divorced ? "divorced" : clientContext.primaryMaritalStatus;

  evaluatePerson(rows, {
    role: "titular",
    displayLabel: clientContext.fullName || "Titular",
    maritalStatus: effectiveMarital,
    incomeType: clientContext.primaryIncomeType,
    knownPis: clientContext.pis
  }, classifiedItems, hasRule("residence_source"));

  // Certidão de dependente: só exige quando o cadastro afirma explicitamente
  // que existe filho(a) menor de 18 anos — nunca por presunção (a
  // quantidade não é rastreada no cadastro, só a existência; se não houver
  // NENHUM dependente já classificado, pede 1 como sinalizador do requisito).
  if (clientContext.hasChildrenUnder18 && !classifiedItems.some((item) => item.personRole === "dependente" && item.documentType === "certidao_nascimento")) {
    rows.push(row("dependente", "Dependente(s)", "certidao_nascimento", "Cadastro informa filho(s) menor(es) de 18 anos, mas nenhuma certidão de nascimento de dependente foi identificada."));
  }

  if (SPOUSE_REQUIRED_STATUSES.has(effectiveMarital)) {
    const spouseLabel = classifiedItems.find((item) => item.personRole === "conjuge")?.personLabel || "Cônjuge";
    evaluatePerson(rows, {
      role: "conjuge",
      displayLabel: spouseLabel,
      maritalStatus: null, // o casamento do titular já cobre o vínculo — cônjuge não precisa de outro documento de estado civil próprio
      incomeType: clientContext.secondaryIncomeType,
      knownPis: null
    }, classifiedItems, hasRule("residence_source"));
  }

  // Composição informada no cadastro é independente do casamento anterior.
  // Um "outro" só é tratado como segundo proponente quando o cadastro é conjunto.
  if (clientContext.simulationType === "joint" && (!SPOUSE_REQUIRED_STATUSES.has(effectiveMarital) || classifiedItems.some((item) => item.personRole === "outro" && item.documentType !== "nao_identificado"))) {
    evaluatePerson(rows, {
      role: "outro",
      displayLabel: classifiedItems.find((item) => item.personRole === "outro")?.personLabel || "Segundo proponente",
      maritalStatus: clientContext.secondaryMaritalStatus,
      incomeType: clientContext.secondaryIncomeType,
      knownPis: null
    }, classifiedItems, hasRule("residence_source"));
  }

  if (hasRule("fgts_updated")) {
    for (const role of SPOUSE_REQUIRED_STATUSES.has(effectiveMarital) ? ["titular", "conjuge"] : ["titular"]) {
      const statements = itemsFor(classifiedItems, role, ["fgts"]);
      if (!statements.length && !(role === "titular" && clientContext.primaryIncomeType === "registered_employment") && !(role === "conjuge" && clientContext.secondaryIncomeType === "registered_employment")) {
        rows.push(row(role, role === "titular" ? clientContext.fullName || "Titular" : "Cônjuge", "fgts", "Envie extrato do FGTS atualizado."));
      } else if (statements.length && statements.every((item) => item.extractedData?.expired) && !statements.some((item) => item.status === "pendencia")) {
        rows.push(row(role, role === "titular" ? clientContext.fullName || "Titular" : "Cônjuge", "fgts", "O extrato do FGTS está desatualizado; envie um extrato atualizado.", "pendencia"));
      }
    }
  }

  return rows;
}

function itemsFor(classifiedItems, role, types) {
  return classifiedItems.filter((item) => item.personRole === role && types.includes(item.documentType));
}

function evaluatePerson(rows, person, classifiedItems, residenceSourceRule) {
  const { role, displayLabel, maritalStatus, incomeType, knownPis } = person;
  const suffix = role === "titular" ? "do titular" : "do cônjuge";

  // 1) Identidade: RG (com CPF) OU CNH — nunca as duas, e nunca CPF cobrado
  // separadamente quando o RG já cobre (o RG unificado tipo CIN já traz CPF).
  if (!itemsFor(classifiedItems, role, ["rg", "cnh"]).length) {
    rows.push(row(role, displayLabel, "rg", `Envie o RG (com CPF) ou a CNH ${suffix} — qualquer um dos dois já é suficiente.`));
  }

  // 2) Estado civil — um único documento, nunca os dois ao mesmo tempo.
  if (maritalStatus === "single") {
    if (!itemsFor(classifiedItems, role, ["certidao_nascimento"]).length) {
      rows.push(row(role, displayLabel, "certidao_nascimento", "Cliente solteiro(a) — envie a certidão de nascimento."));
    }
  } else if (maritalStatus === "stable_union") {
    // Regra do dono 2026-10-05: união estável/amigado pede a certidão de nascimento (não a de casamento). O vínculo com o
    // companheiro(a) como segundo proponente continua em SPOUSE_REQUIRED_STATUSES (outra regra, não alterada).
    if (!itemsFor(classifiedItems, role, ["certidao_nascimento"]).length) {
      rows.push(row(role, displayLabel, "certidao_nascimento", "Cliente em união estável — envie a certidão de nascimento."));
    }
  } else if (maritalStatus === "married") {
    if (!itemsFor(classifiedItems, role, ["certidao_casamento"]).length) {
      rows.push(row(role, displayLabel, "certidao_casamento", "Cliente casado(a) — envie a certidão de casamento."));
    }
  } else if (maritalStatus === "divorced") {
    if (!itemsFor(classifiedItems, role, ["certidao_casamento"]).length) {
      rows.push(row(role, displayLabel, "certidao_casamento", "Cliente divorciado(a) — envie a certidão de casamento com a averbação do divórcio."));
    }
  }
  // widowed ou vazio/desconhecido: nenhuma regra definida — não inventa exigência.

  // 3) Renda — depende do tipo declarado. Nunca exige holerite de quem é
  // informal, nem extrato/fatura de quem é CLT.
  if (incomeType === "registered_employment") {
    const count = itemsFor(classifiedItems, role, ["holerite"]).length;
    if (count === 0) {
      rows.push(row(role, displayLabel, "holerite", `Renda CLT — envie os 2 últimos holerites (sem férias) ${suffix}.`));
    } else if (count === 1) {
      rows.push(row(role, displayLabel, "holerite", "Foi identificado apenas 1 dos 2 últimos holerites necessários.", "pendencia"));
    }
  } else if (incomeType === "income_tax_declarant") {
    const hasDeclaracao = itemsFor(classifiedItems, role, ["declaracao_ir"]).length > 0;
    const hasRecibo = itemsFor(classifiedItems, role, ["recibo_entrega_ir"]).length > 0;
    if (!hasDeclaracao && !hasRecibo) {
      rows.push(row(role, displayLabel, "declaracao_ir", "Renda comprovada por Imposto de Renda — envie a declaração completa do ano vigente e o recibo de entrega."));
    } else if (!hasDeclaracao) {
      rows.push(row(role, displayLabel, "declaracao_ir", "Falta a declaração completa do Imposto de Renda (o recibo de entrega já foi enviado).", "pendencia"));
    } else if (!hasRecibo) {
      rows.push(row(role, displayLabel, "recibo_entrega_ir", "Falta o recibo de entrega do Imposto de Renda (a declaração já foi enviada).", "pendencia"));
    }
  } else if (incomeType === "self_employed_unregistered") {
    const extratos = itemsFor(classifiedItems, role, ["extrato_bancario"]).length;
    const faturas = itemsFor(classifiedItems, role, ["fatura_cartao"]).length;
    if (extratos < 3 && faturas < 3) {
      if (extratos === 0 && faturas === 0) {
        rows.push(row(role, displayLabel, "extrato_bancario", `Renda informal — envie os 3 últimos extratos bancários OU as 3 últimas faturas de cartão de crédito ${suffix}.`));
      } else if (extratos >= faturas) {
        rows.push(row(role, displayLabel, "extrato_bancario", `Foram identificados ${extratos} dos 3 extratos bancários necessários.`, "pendencia"));
      } else {
        rows.push(row(role, displayLabel, "fatura_cartao", `Foram identificadas ${faturas} das 3 faturas de cartão de crédito necessárias.`, "pendencia"));
      }
    }
  }
  // incomeType vazio/desconhecido: nenhuma regra definida — não inventa exigência de renda.

  // 4) Um comprovante em nome de terceiro também é um documento presente.
  // A regra ativa de titularidade determina a pendência na classificação;
  // nunca chamar um arquivo existente de "ausente".
  // Comprovante do segundo proponente cujo status original era "precisa_confirmacao"
  // foi neutralizado (normalizeNonPrincipalResidenceItem) e continua sem valer
  // como prova de residência do principal — mesmo comportamento de antes.
  const regularResidence = classifiedItems.some((item) => item.documentType === "comprovante_residencia" && item.status !== "precisa_confirmacao" && item.extractedData?.residenceNotRequiredFrom !== "precisa_confirmacao");
  const cardIncome = residenceSourceRule && incomeType === "self_employed_unregistered" && itemsFor(classifiedItems, role, ["fatura_cartao"]).length >= 3;
  if (role === "titular" && !regularResidence && !cardIncome) {
    rows.push(row(role, displayLabel, "comprovante_residencia", "Nenhum comprovante de residência válido (água, energia elétrica, internet ou telefone) foi identificado."));
  }

  // 5) CTPS: para TODOS (regra do dono 2026-10-05: mesmo quem é informal ou declara IR pode ter registro).
  // FGTS continua só para quem tem vínculo CLT.
  if (!itemsFor(classifiedItems, role, ["ctps"]).length) {
    rows.push(row(role, displayLabel, "ctps", `Carteira de trabalho (CTPS, física ou digital) ${suffix}.`));
  }
  if (incomeType === "registered_employment") {
    if (!itemsFor(classifiedItems, role, ["fgts"]).length) {
      rows.push(row(role, displayLabel, "fgts", `Extrato do FGTS atualizado ${suffix}.`));
    }
  }

  // 6) PIS é um NÚMERO, não um documento — se já está no cadastro ou já foi
  // extraído de qualquer documento (CTPS, FGTS, holerite etc.), não pede de
  // novo.
  const extractedPis = classifiedItems.some((item) => item.personRole === role && item.extractedData?.pis);
  if (!knownPis && !extractedPis) {
    rows.push(row(role, displayLabel, "pis", `Número do PIS não identificado ${suffix} — pode vir de qualquer documento (CTPS, FGTS, Meu INSS, Caixa Tem etc.), não precisa ser um arquivo específico.`));
  }
}

function row(personRole, personLabel, documentType, observations, status = "ausente") {
  return { personRole, personLabel, documentType, status, observations, documentId: null, confidence: null, extractedData: {} };
}
