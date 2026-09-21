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

export function evaluateDocumentRequirements(clientContext, classifiedItems) {
  const rows = [];

  evaluatePerson(rows, {
    role: "titular",
    displayLabel: clientContext.fullName || "Titular",
    maritalStatus: clientContext.primaryMaritalStatus,
    incomeType: clientContext.primaryIncomeType,
    knownPis: clientContext.pis
  }, classifiedItems);

  if (SPOUSE_REQUIRED_STATUSES.has(clientContext.primaryMaritalStatus)) {
    const spouseLabel = classifiedItems.find((item) => item.personRole === "conjuge")?.personLabel || "Cônjuge";
    evaluatePerson(rows, {
      role: "conjuge",
      displayLabel: spouseLabel,
      maritalStatus: null, // o casamento do titular já cobre o vínculo — cônjuge não precisa de outro documento de estado civil próprio
      incomeType: clientContext.secondaryIncomeType,
      knownPis: null
    }, classifiedItems);
  }

  return rows;
}

function itemsFor(classifiedItems, role, types) {
  return classifiedItems.filter((item) => item.personRole === role && types.includes(item.documentType));
}

function evaluatePerson(rows, person, classifiedItems) {
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
  } else if (maritalStatus === "married" || maritalStatus === "stable_union") {
    if (!itemsFor(classifiedItems, role, ["certidao_casamento"]).length) {
      rows.push(row(role, displayLabel, "certidao_casamento", "Cliente casado(a)/em união estável — envie a certidão de casamento."));
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

  // 4) Comprovante de residência — só do titular (a regra de negócio não
  // pede um separado do cônjuge). A checagem de "precisa estar no nome do
  // titular" (renda informal) fica a cargo da IA na classificação do próprio
  // documento, não deste motor.
  if (role === "titular" && !itemsFor(classifiedItems, role, ["comprovante_residencia"]).length) {
    rows.push(row(role, displayLabel, "comprovante_residencia", "Nenhum comprovante de residência (conta, boleto ou fatura com nome e endereço) foi identificado."));
  }

  // 5) CTPS/FGTS só fazem sentido pra quem tem vínculo CLT — não são
  // obrigatoriedade universal.
  if (incomeType === "registered_employment") {
    if (!itemsFor(classifiedItems, role, ["ctps"]).length) {
      rows.push(row(role, displayLabel, "ctps", `Carteira de trabalho (CTPS, física ou digital) ${suffix}.`));
    }
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
