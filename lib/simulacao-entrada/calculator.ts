import type {
  DadosCliente,
  Empreendimento,
  ResultadoSimulacao,
  DetalhePagamento,
  BlocoPagamento,
  RegraAtoMaisParcelas,
  RegraPeriodoObraBalao,
  RegraTabelaCondicoes,
} from "./types";

/**
 * Ponto de entrada principal: recebe os dados do cliente (do cadastro) e a
 * configuração de UM empreendimento, e devolve a simulação completa.
 *
 * Para simular vários empreendimentos de uma vez (como a aba "DADOS
 * APROVAÇÃO" da planilha original fazia), chame esta função em loop —
 * ver example.ts.
 */
export function simularEntrada(
  cliente: DadosCliente,
  empreendimento: Empreendimento
): ResultadoSimulacao {
  const avisos: string[] = [];

  const totalDescontos = empreendimento.descontos.reduce(
    (soma, d) => soma + d.valor,
    0
  );
  const valorFinalImovel = empreendimento.valorImovel - totalDescontos;

  const casaPaulista =
    empreendimento.aceitaCasaPaulista ? cliente.casaPaulista : 0;
  if (!empreendimento.aceitaCasaPaulista && cliente.casaPaulista > 0) {
    avisos.push(
      "Cliente tem Casa Paulista aprovado, mas este empreendimento não aceita esse subsídio."
    );
  }

  const totalCoberto =
    cliente.financiamentoAprovado + cliente.subsidioMcmv + casaPaulista;

  const entradaTotal = Math.max(0, valorFinalImovel - totalCoberto);
  if (valorFinalImovel - totalCoberto < 0) {
    avisos.push(
      "O financiamento aprovado + subsídios já cobre o valor do imóvel — não há entrada a pagar (verifique os valores, isso é incomum)."
    );
  }

  // Abate o FGTS disponível do que sobrar para parcelar (nunca fica negativo).
  const entradaAposFgts = Math.max(0, entradaTotal - cliente.fgtsDisponivel);
  if (cliente.fgtsDisponivel > entradaTotal && cliente.fgtsDisponivel > 0) {
    avisos.push(
      "O FGTS informado é maior que a entrada necessária — sobra não utilizada nesta simulação."
    );
  }

  const limiteGlobal = empreendimento.limiteMaximoEntradaParcelavel;
  const excedenteParaAto = limiteGlobal && limiteGlobal > 0
    ? Math.max(0, entradaAposFgts - limiteGlobal)
    : 0;
  const valorParaParcelar = entradaAposFgts - excedenteParaAto;

  const detalhePagamento = calcularDetalhePagamento(
    valorParaParcelar,
    empreendimento,
    cliente,
    avisos
  );
  detalhePagamento.ato += excedenteParaAto;
  if (excedenteParaAto > 0) {
    avisos.push(
      `R$ ${moeda(excedenteParaAto)} excedem o limite parcelável e foram direcionados automaticamente para o ato.`
    );
  }
  aplicarRegraAto(detalhePagamento, entradaAposFgts, empreendimento, avisos);
  const motivos = validarCenario(detalhePagamento, entradaAposFgts, empreendimento, cliente);
  const classificacao = motivos.length ? "inviavel" : avisos.length ? "ajuste" : "viavel";

  const resultado: ResultadoSimulacao = {
    empreendimentoId: empreendimento.id,
    empreendimentoNome: empreendimento.nome,
    valorImovel: empreendimento.valorImovel,
    totalDescontos,
    descontosAplicados: empreendimento.descontos,
    subsidioMcmv: cliente.subsidioMcmv,
    casaPaulista,
    valorFinalImovel,
    totalCoberto,
    financiamentoAprovado: cliente.financiamentoAprovado,
    entradaTotal: entradaAposFgts,
    detalhePagamento,
    beneficiosInformativos: empreendimento.beneficiosInformativos ?? [],
    avisos,
    classificacao,
    motivos,
  };

  if (empreendimento.regraEngenharia) {
    resultado.alternativaEngenharia = calcularViaEngenharia(
      empreendimento.valorImovel,
      empreendimento.regraEngenharia
    );
  }

  return resultado;
}

function calcularDetalhePagamento(
  entrada: number,
  empreendimento: Empreendimento,
  cliente: DadosCliente,
  avisos: string[]
): DetalhePagamento {
  const regra = empreendimento.regraEntrada;

  switch (regra.tipo) {
    case "ato_mais_parcelas":
      return calcularAtoMaisParcelas(entrada, regra, cliente);
    case "periodo_obra_pos_obra_balao":
      return calcularPeriodoObraBalao(entrada, regra, cliente, avisos);
    case "tabela_condicoes":
      return calcularPorTabelaCondicoes(regra, cliente, avisos);
    default: {
      // Exhaustiveness check — se um novo tipo de regra for adicionado a
      // RegraEntrada sem um case aqui, o TypeScript acusa erro nesta linha.
      const _exhaustive: never = regra;
      throw new Error(`Regra de entrada não suportada: ${_exhaustive}`);
    }
  }
}

/**
 * Resolve um bloco de parcelamento linear (obra, pós-obra, ou a única
 * parcela da estratégia ATO+parcelas), aplicando os 4 campos editáveis:
 * nº máximo de parcelas, parcela mínima, parcela máxima (fixa ou % da
 * renda) e taxa de juros mensal.
 *
 * `parcelasFixas`, quando informado, trava o nº de parcelas (usado em
 * "período de obra"/"pós-obra", cuja duração é fixa pelo cronograma da
 * obra) — nesse caso, se o teto de parcela máxima for estourado, o
 * excedente vira `sobra` (não dá pra esticar o prazo da obra). Quando
 * `parcelasFixas` NÃO é informado (ex.: ATO+parcelas), o nº de parcelas é
 * derivado a partir da parcela mínima/máxima.
 */
function resolverBlocoLinear(
  valor: number,
  limites: import("./types").LimitesParcela | undefined,
  rendaCliente: number,
  parcelasFixas?: number
): {
  parcelas: number;
  valorParcela: number;
  valorParcelaComJuros?: number;
  sobra: number;
} {
  if (valor <= 0) return { parcelas: 0, valorParcela: 0, sobra: 0 };

  const parcelaMaximaValor = resolverValorParcelaMaxima(
    limites?.parcelaMaxima,
    rendaCliente
  );
  if (parcelaMaximaValor <= 0) return { parcelas: 0, valorParcela: 0, sobra: valor };

  let parcelas: number;
  if (parcelasFixas !== undefined) {
    parcelas = parcelasFixas;
  } else {
    const parcelaMinima = limites?.parcelaMinima ?? 0;
    const numeroMaximoParcelas = limites?.numeroMaximoParcelas ?? Infinity;
    const preferido = limites?.numeroParcelasPreferido;
    const tetoParcelas = preferido && preferido > 0 ? Math.min(preferido, numeroMaximoParcelas) : numeroMaximoParcelas;
    parcelas = maiorPrazoValido(valor, tetoParcelas, parcelaMinima, limites?.taxaJurosMensal ?? 0);
    if (!isFinite(parcelas) || parcelas < 1) parcelas = 1;
  }

  let valorParcela = valor / parcelas;
  let sobra = 0;

  if (valorParcela > parcelaMaximaValor) {
    if (parcelasFixas !== undefined) {
      // Duração fixa (ex.: obra) — não dá pra esticar o prazo, o excedente vira sobra.
      valorParcela = parcelaMaximaValor;
      sobra = valor - valorParcela * parcelas;
    } else {
      const numeroMaximoParcelas = limites?.numeroMaximoParcelas ?? Infinity;
      const parcelasNecessarias = Math.ceil(valor / parcelaMaximaValor);
      parcelas = Math.min(parcelasNecessarias, numeroMaximoParcelas);
      valorParcela = parcelaMaximaValor;
      sobra = Math.max(0, valor - valorParcela * parcelas);
    }
  }

  let valorParcelaComJuros: number | undefined;
  if (limites?.taxaJurosMensal && limites.taxaJurosMensal > 0 && parcelas > 0) {
    const i = limites.taxaJurosMensal;
    const n = parcelas;
    const principal = valor - sobra;
    valorParcelaComJuros = calcularParcelaComJuros(principal, i, n);
  }

  return { parcelas, valorParcela, valorParcelaComJuros, sobra };
}

function maiorPrazoValido(valor: number, maximo: number, minimo: number, juros: number) {
  const teto = Number.isFinite(maximo) ? Math.max(1, Math.floor(maximo)) : 1;
  for (let parcelas = teto; parcelas >= 1; parcelas -= 1) {
    const parcela = juros > 0 ? calcularParcelaComJuros(valor, juros, parcelas) : valor / parcelas;
    if (minimo <= 0 || parcela + 0.01 >= minimo) return parcelas;
  }
  return 1;
}

function calcularParcelaComJuros(principal: number, taxa: number, parcelas: number) {
  if (taxa <= 0 || parcelas <= 0) return parcelas ? principal / parcelas : 0;
  const fator = Math.pow(1 + taxa, parcelas);
  return (principal * taxa * fator) / (fator - 1);
}

function resolverValorParcelaMaxima(
  parcelaMaxima: import("./types").ParcelaMaxima | undefined,
  rendaCliente: number
): number {
  if (!parcelaMaxima) return Infinity;
  return parcelaMaxima.tipo === "valor_fixo"
    ? parcelaMaxima.valor
    : rendaCliente * parcelaMaxima.percentual;
}

/** Estratégia "ATO + parcelas" — replica exatamente a lógica de Terras de SP. */
function calcularAtoMaisParcelas(
  entrada: number,
  regra: RegraAtoMaisParcelas,
  cliente: DadosCliente
): DetalhePagamento {
  const excedeLimite = entrada > regra.limiteParcelavel;

  let ato = excedeLimite ? entrada - regra.limiteParcelavel : 0;
  const valorParcelavel = entrada - ato;

  const parcelasFixas = excedeLimite
    ? regra.numeroParcelasQuandoExcedeLimite
    : undefined;

  const { parcelas, valorParcela, valorParcelaComJuros, sobra } =
    resolverBlocoLinear(valorParcelavel, regra.limites, cliente.rendaTotal, parcelasFixas);

  ato += sobra;

  const blocos: BlocoPagamento[] = [];
  if (parcelas > 0) {
    blocos.push({
      label: "Parcelas da entrada",
      parcelas,
      valorParcela,
      valorParcelaComJuros,
      periodicidadeMeses: 1,
    });
  }

  return { ato, blocos };
}

/**
 * Estratégia "período de obra + pós-obra + balão" — reimplementação limpa
 * do padrão visto em Vale dos Sonhos / Reserva dos Ipês. A ordem de
 * alocação é: balão(ões) primeiro (até o teto por balão), depois parcelas
 * do período de obra (respeitando o teto de comprometimento de renda, se
 * houver), depois pós-obra. O que sobrar vira ATO.
 *
 * Nota: a planilha original tinha uma fórmula com um provável erro de
 * cópia na aba "Reserva dos Ipês" (uma comparação booleana dentro de um
 * MIN()) — esta função não replica esse bug; ela é uma reconstrução
 * limpa do padrão. Valide os números com casos reais antes de confiar
 * 100% neles.
 */
function calcularPeriodoObraBalao(
  entrada: number,
  regra: RegraPeriodoObraBalao,
  cliente: DadosCliente,
  avisos: string[]
): DetalhePagamento {
  let restante = entrada;
  const blocos: BlocoPagamento[] = [];

  // 1) Balão(ões)
  if (regra.balao && regra.balao.quantidade > 0) {
    const limiteBalao = resolverValorParcelaMaxima(
      regra.balao.limite || (regra.balao.valorMaximoPorBalao !== undefined
        ? { tipo: "valor_fixo", valor: regra.balao.valorMaximoPorBalao }
        : undefined),
      cliente.rendaTotal
    );
    const valorBalaoDesejado = Math.min(
      restante,
      limiteBalao * regra.balao.quantidade
    );
    if (valorBalaoDesejado > 0) {
      const valorPorBalao = valorBalaoDesejado / regra.balao.quantidade;
      blocos.push({
        label:
          regra.balao.periodicidadeMeses === 12
            ? "Balão anual"
            : regra.balao.periodicidadeMeses === 6
            ? "Balão semestral"
            : `Balão (a cada ${regra.balao.periodicidadeMeses} meses)`,
        parcelas: regra.balao.quantidade,
        valorParcela: valorPorBalao,
        periodicidadeMeses: regra.balao.periodicidadeMeses,
      });
      restante -= valorBalaoDesejado;
    }
  }

  // 2) Parcelas durante a obra — prazo fixo (mesesPeriodoObra); parcela mínima/máxima/juros vêm de limitesObra
  const mesesObra = resolverMesesObra(regra.mesesPeriodoObra, regra.dataEntrega);
  if (mesesObra > 0 && restante > 0) {
    const { parcelas, valorParcela, valorParcelaComJuros, sobra } =
      resolverBlocoLinear(restante, regra.limitesObra, cliente.rendaTotal, mesesObra);

    blocos.push({
      label: "Parcelas durante a obra",
      parcelas,
      valorParcela,
      valorParcelaComJuros,
      periodicidadeMeses: 1,
    });
    restante = sobra;

    if (sobra > 0) {
      avisos.push(
        "A parcela do período de obra foi limitada pelo teto configurado (parcela máxima) — o saldo restante foi para o pós-obra/ATO."
      );
    }
  }

  // 3) Pós-obra — prazo fixo (mesesPosObra); teto próprio via limitesPosObra
  if (regra.mesesPosObra > 0 && restante > 0) {
    const { parcelas, valorParcela, valorParcelaComJuros, sobra } =
      resolverBlocoLinear(restante, regra.limitesPosObra, cliente.rendaTotal, regra.mesesPosObra);

    blocos.push({
      label: "Parcelas pós-obra",
      parcelas,
      valorParcela,
      valorParcelaComJuros,
      periodicidadeMeses: 1,
    });
    restante = sobra;

    if (sobra > 0) {
      avisos.push(
        "A parcela pós-obra foi limitada pelo teto configurado (parcela máxima) — o saldo restante foi para o ATO."
      );
    }
  }

  // 4) O que não coube em nenhum bloco vira ATO
  const ato = Math.max(0, restante);
  if (ato > 0) {
    avisos.push(
      "Parte da entrada não coube nos blocos configurados (obra/pós-obra/balão) e foi para o ATO."
    );
  }

  return { ato, blocos };
}

function aplicarRegraAto(
  detalhe: DetalhePagamento,
  entrada: number,
  empreendimento: Empreendimento,
  avisos: string[]
) {
  const regra = empreendimento.ato;
  if (!regra?.ativo) return;
  const alvo = regra.tipo === "percentual_entrada"
    ? entrada * Math.max(0, regra.percentual || 0)
    : Math.max(0, regra.valor || 0);
  const minimo = Math.max(0, regra.minimo || 0, regra.obrigatorio ? alvo : 0);
  if (detalhe.ato < minimo) {
    const diferenca = minimo - detalhe.ato;
    detalhe.ato = minimo;
    reduzirBlocos(detalhe.blocos, diferenca);
  }
  if (regra.maximo && detalhe.ato > regra.maximo) {
    avisos.push(`O ato calculado supera o máximo configurado de R$ ${moeda(regra.maximo)}.`);
  }
}

function reduzirBlocos(blocos: BlocoPagamento[], valor: number) {
  let restante = valor;
  for (let index = blocos.length - 1; index >= 0 && restante > 0; index -= 1) {
    const bloco = blocos[index];
    const total = bloco.valorParcela * bloco.parcelas;
    const retirada = Math.min(total, restante);
    const novoTotal = total - retirada;
    bloco.valorParcela = bloco.parcelas ? novoTotal / bloco.parcelas : 0;
    if (bloco.valorParcelaComJuros !== undefined && total > 0) {
      bloco.valorParcelaComJuros *= novoTotal / total;
    }
    restante -= retirada;
  }
}

function validarCenario(
  detalhe: DetalhePagamento,
  entrada: number,
  empreendimento: Empreendimento,
  cliente: DadosCliente
) {
  const motivos: string[] = [];
  const ato = empreendimento.ato;
  if (detalhe.ato > 0 && ato?.ativo === false) {
    motivos.push(`R$ ${moeda(detalhe.ato)} precisariam ser pagos no ato, mas este empreendimento não permite ato.`);
  }
  if (ato?.maximo && detalhe.ato > ato.maximo) {
    motivos.push(`Ato necessário de R$ ${moeda(detalhe.ato)}, acima do máximo de R$ ${moeda(ato.maximo)}.`);
  }
  const parcelado = Math.max(0, entrada - detalhe.ato);
  if (empreendimento.limiteMaximoEntradaParcelavel && parcelado > empreendimento.limiteMaximoEntradaParcelavel + 0.01) {
    motivos.push(`Entrada parcelada de R$ ${moeda(parcelado)}, mas o empreendimento permite no máximo R$ ${moeda(empreendimento.limiteMaximoEntradaParcelavel)}.`);
  }
  if (empreendimento.regraEntrada.tipo === "tabela_condicoes" && detalhe.blocos.length === 0 && entrada > 0) {
    motivos.push("Não existe uma condição cadastrada para o perfil financeiro deste cliente.");
  }
  if (cliente.rendaTotal <= 0 && usaLimitePorRenda(empreendimento)) {
    motivos.push("A renda do cliente precisa estar preenchida para validar os limites percentuais.");
  }
  return motivos;
}

function usaLimitePorRenda(empreendimento: Empreendimento) {
  const regra = empreendimento.regraEntrada;
  if (regra.tipo === "ato_mais_parcelas") return regra.limites.parcelaMaxima?.tipo === "percentual_renda";
  if (regra.tipo !== "periodo_obra_pos_obra_balao") return false;
  return [regra.limitesObra?.parcelaMaxima, regra.limitesPosObra?.parcelaMaxima, regra.balao?.limite]
    .some((limite) => limite?.tipo === "percentual_renda");
}

function resolverMesesObra(configurado: number, dataEntrega?: string) {
  if (!dataEntrega || !/^\d{4}-\d{2}-\d{2}$/.test(dataEntrega)) return configurado;
  const hoje = new Date();
  const entrega = new Date(`${dataEntrega}T12:00:00`);
  const meses = Math.max(0, (entrega.getFullYear() - hoje.getFullYear()) * 12 + entrega.getMonth() - hoje.getMonth());
  return configurado > 0 ? Math.min(configurado, meses) : meses;
}

function moeda(valor: number) {
  return Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Estratégia "tabela de condições" — busca direta, sem cálculo (ex.: Vera Cruz). */
function calcularPorTabelaCondicoes(
  regra: RegraTabelaCondicoes,
  cliente: DadosCliente,
  avisos: string[]
): DetalhePagamento {
  const condicao = regra.condicoes.find(
    (c) =>
      c.temDependente === Boolean(cliente.temDependente) &&
      c.fgtsMaisDe3Anos === Boolean(cliente.fgtsMaisDe3Anos) &&
      c.tipoRenda === (cliente.tipoRenda ?? "")
  );

  if (!condicao) {
    avisos.push(
      "Nenhuma condição da tabela bate com o perfil do cliente (dependente/FGTS/tipo de renda) — confirme manualmente com a incorporadora."
    );
    return { ato: 0, blocos: [] };
  }

  avisos.push(
    `Valores desta simulação vêm da tabela de condições especiais deste empreendimento (referência: imóvel de R$ ${regra.valorUnidadeReferencia.toLocaleString(
      "pt-BR"
    )}). Se o imóvel escolhido tiver valor diferente, confirme com a incorporadora.`
  );

  return {
    ato: condicao.ato ?? 0,
    blocos: [
      {
        label: "Parcelas da entrada (tabela de condições)",
        parcelas: condicao.parcelas,
        valorParcela: condicao.valorParcela,
        periodicidadeMeses: 1,
      },
    ],
  };
}

/**
 * Via alternativa por avaliação de engenharia: o banco financia até
 * `percentualMaximoFinanciamento` do valor de ENGENHARIA (não da venda).
 * Isso é só uma ESTIMATIVA de planejamento — depende do laudo real do
 * banco, que pode vir diferente do valor negociado/esperado.
 */
function calcularViaEngenharia(
  valorVenda: number,
  regra: import("./types").RegraEngenharia
) {
  const financiamentoViaEngenharia =
    regra.valorEngenharia * regra.percentualMaximoFinanciamento;

  const entradaNecessaria = Math.max(
    0,
    valorVenda - financiamentoViaEngenharia
  );

  const custoDocumentacao = regra.valorEngenharia * regra.taxaDocumentacao;
  const diferencaEngenhariaVenda = regra.valorEngenharia - valorVenda;
  const custoLucroImobiliario =
    diferencaEngenhariaVenda > 0
      ? diferencaEngenhariaVenda * regra.taxaLucroImobiliario
      : 0;

  return {
    entradaNecessaria,
    financiamentoViaEngenharia,
    custosAdicionais: custoDocumentacao + custoLucroImobiliario,
  };
}
