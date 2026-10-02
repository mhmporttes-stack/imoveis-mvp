/**
 * MODELO ÚNICO da "Apresentação de valores do empreendimento".
 *
 * A tela (`components/EmpreendimentoPresentation.jsx`) e o PDF "Proposta de Valores"
 * (`lib/simulacao-entrada/proposta-pdf.mjs`) consomem EXATAMENTE a saída desta função.
 * Quem desenha só formata; nenhum cálculo financeiro fica na camada de exibição.
 * O resultado do motor (`simularEntrada`, calculator.ts) entra pronto aqui.
 */

/**
 * [PENDENTE DE VALIDAÇÃO] Valor exibido como "Documentação gratuita": 5% do valor do imóvel.
 * Origem: commit f9992ec (polimento visual da apresentação, 2026-09-08); não consta em docs nem
 * rules, e o cadastro do empreendimento já traz um valor próprio (`beneficiosInformativos`,
 * tipo documentacao_gratuita). Preservado exatamente como a tela já mostrava, até decisão do dono.
 */
export const DOCUMENTACAO_GRATUITA_PERCENTUAL = 0.05;

export function hasFreeDocuments(benefits = []) {
  return benefits.some((benefit) => {
    const text = `${benefit.label} ${benefit.tipo}`;
    return /document/i.test(text) && /gr[aá]tis|gratuita|isenta/i.test(text);
  });
}

function featureLabel(feature) {
  return typeof feature === "string" ? feature : feature?.text || "";
}

/**
 * Campos do `cliente` enviados ao motor. Casa Paulista NÃO faz parte: é valor fixo por
 * empreendimento (casa-paulista.mjs). Único lugar que define o formato.
 */
export function montarClienteEntrada({
  rendaTotal = 0,
  financiamentoAprovado = 0,
  subsidioMcmv = 0,
  parcelaFinanciamento = 0,
  fgtsDisponivel = 0,
  temDependente = false,
  fgtsMaisDe3Anos = false,
  tipoRenda = ""
} = {}) {
  return {
    rendaTotal: Number(rendaTotal) || 0,
    financiamentoAprovado: Number(financiamentoAprovado) || 0,
    subsidioMcmv: Number(subsidioMcmv) || 0,
    parcelaFinanciamento: Number(parcelaFinanciamento) || 0,
    fgtsDisponivel: Number(fgtsDisponivel) || 0,
    temDependente: Boolean(temDependente),
    fgtsMaisDe3Anos: Boolean(fgtsMaisDe3Anos),
    tipoRenda: typeof tipoRenda === "string" ? tipoRenda : ""
  };
}

/** Aplica o número de parcelas escolhido na tela (somente regra ato + parcelas), sem mutar a entrada. */
export function aplicarParcelasManuais(regras, parcelasManuais) {
  const clone = structuredClone(regras);
  if (parcelasManuais && clone.regraEntrada?.tipo === "ato_mais_parcelas") {
    clone.regraEntrada.limites.numeroParcelasPreferido = parcelasManuais;
  }
  return clone;
}

export function buildPresentationModel(result, { financingInstallments = {}, propertyFeatures = [] } = {}) {
  const detail = result.detalhePagamento || { ato: 0, blocos: [] };
  const blocos = detail.blocos || [];
  const entryBlock = blocos.find((block) => /parcela/i.test(block.label)) || null;
  const informativos = result.beneficiosInformativos || [];
  const featureBenefits = propertyFeatures.map((feature) => ({ tipo: "diferencial", label: featureLabel(feature) }));
  const documentacaoGratuita = hasFreeDocuments([...informativos, ...featureBenefits]);
  const documentacaoValor = documentacaoGratuita ? result.valorImovel * DOCUMENTACAO_GRATUITA_PERCENTUAL : 0;
  const subsidioMcmv = result.subsidioMcmv || 0;
  const casaPaulista = result.casaPaulista || 0;
  const totalDescontosEBeneficios = result.totalDescontos + subsidioMcmv + casaPaulista + documentacaoValor;
  const saldoParcelado = blocos.reduce((total, block) => total + block.valorParcela * block.parcelas, 0);
  const primeira = Number(financingInstallments.first) || 0;
  const ultima = Number(financingInstallments.last) || 0;

  return {
    empreendimentoNome: result.empreendimentoNome || "",
    valorImovel: result.valorImovel,
    descontos: (result.descontosAplicados || []).map((discount) => ({ label: discount.label, valor: discount.valor })),
    subsidioMcmv,
    casaPaulista,
    documentacaoGratuita: { aplica: documentacaoGratuita, valor: documentacaoValor },
    temDescontosOuBeneficios: Boolean(
      (result.descontosAplicados || []).length || subsidioMcmv > 0 || casaPaulista > 0 || documentacaoGratuita
    ),
    totalDescontosEBeneficios,
    financiamentoAprovado: result.financiamentoAprovado,
    primeiraParcelaFinanciamento: primeira,
    ultimaParcelaFinanciamento: ultima,
    entradaTotal: result.entradaTotal,
    atoInicial: detail.ato || 0,
    /** Entrada integralmente parcelada, sem pagamento inicial. */
    entradaTotalmenteParcelada: result.entradaTotal > 0 && !(detail.ato > 0) && blocos.length > 0,
    saldoParcelado,
    parcelamento: entryBlock
      ? { label: entryBlock.label, parcelas: entryBlock.parcelas, valorParcela: entryBlock.valorParcelaComJuros ?? entryBlock.valorParcela }
      : null,
    outrosBlocos: blocos
      .filter((block) => block !== entryBlock)
      .map((block) => ({ label: block.label, parcelas: block.parcelas, valorParcela: block.valorParcelaComJuros ?? block.valorParcela })),
    /** Benefícios cadastrados no empreendimento (documentação gratuita sai daqui: aparece na linha própria). */
    beneficios: informativos
      .filter((benefit) => !documentacaoGratuita || !/document/i.test(`${benefit.label} ${benefit.tipo}`))
      .map((benefit) => ({ label: benefit.label, valor: benefit.valor > 0 ? benefit.valor : 0 })),
    diferenciais: propertyFeatures.map(featureLabel).filter(Boolean),
    classificacao: result.classificacao,
    motivos: result.motivos || []
  };
}
