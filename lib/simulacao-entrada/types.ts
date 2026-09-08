/**
 * Modelo de dados para o motor de cálculo de entrada de empreendimentos.
 *
 * Baseado na análise da planilha "ENTRADAS EMPREENDIMENTOS ANDRÉ" — cada
 * empreendimento tem suas próprias regras de parcelamento da entrada,
 * então o objeto `Empreendimento` guarda TODOS os parâmetros editáveis
 * de um empreendimento específico. Isso é o que deve virar uma linha
 * numa tabela do Supabase (coluna `regras` como JSONB).
 */

/** Dados que vêm do cadastro do cliente / aprovação do banco. */
export interface DadosCliente {
  /** Renda familiar bruta mensal informada no cadastro. */
  rendaTotal: number;
  /** Valor de financiamento já aprovado pelo banco (bruto, sem MCMV). */
  financiamentoAprovado: number;
  /** Valor de subsídio MCMV aprovado (0 se não elegível / Faixa 3-4). */
  subsidioMcmv: number;
  /** Valor de Casa Paulista aprovado, se houver (0 se não elegível/aplicável). */
  casaPaulista: number;
  /** Valor da parcela mensal do financiamento aprovado pelo banco. */
  parcelaFinanciamento: number;
  /** FGTS ou outro valor que o cliente já tem disponível para abater a entrada. */
  fgtsDisponivel: number;

  // --- Perfil do cliente, usado por empreendimentos com tabela de condições
  // (ex.: Vera Cruz, que muda a entrada conforme dependente/FGTS/tipo de renda) ---
  /** Cliente possui dependente(s) declarado(s)? */
  temDependente?: boolean;
  /** Cliente é cotista do FGTS há 3 anos ou mais? */
  fgtsMaisDe3Anos?: boolean;
  /** Tipo de renda do cliente, usado para bater com a tabela de condições. */
  tipoRenda?: "informal" | "formal" | string;
}

/** Um desconto de valor fixo aplicado sobre o valor do imóvel. */
export interface Desconto {
  /** Identificador livre, ex.: "incorporadora", "documentacao_gratis", "casa_paulista". */
  tipo: string;
  /** Rótulo para exibir na simulação. */
  label: string;
  /** Valor do desconto em reais. */
  valor: number;
}

/**
 * Teto de parcela: um valor fixo em reais, OU um percentual da renda do
 * cliente (comprometimento de renda). Editável por empreendimento.
 */
export type ParcelaMaxima =
  | { tipo: "valor_fixo"; valor: number }
  | { tipo: "percentual_renda"; percentual: number };

/**
 * Os 4 campos que você precisa poder editar por empreendimento (e, quando o
 * modelo for "obra + pós-obra", de forma independente para cada fase).
 * Todos opcionais — deixe de fora o que não se aplicar.
 */
export interface LimitesParcela {
  /** Número máximo de parcelas. */
  numeroMaximoParcelas?: number;
  /** Valor mínimo de parcela — se a conta desse um valor menor, reduz o nº de parcelas em vez de gerar parcela pequena. */
  parcelaMinima?: number;
  /** Teto da parcela — valor fixo OU percentual da renda do cliente. */
  parcelaMaxima?: ParcelaMaxima;
  /** Taxa de juros/correção mensal aplicada às parcelas deste bloco (deixe vazio = parcelamento linear, sem juros). */
  taxaJurosMensal?: number;
}

/**
 * Estratégia 1 — "ATO + parcelas" (ex.: Terras de SP).
 *
 * A entrada total é dividida em duas partes:
 *  - ATO: o que ultrapassa `limiteParcelavel` deve ser pago à vista, na assinatura.
 *  - Parcelável: até `limiteParcelavel`, dividido em parcelas mensais conforme `limites`.
 *
 * Quando a entrada excede o limite, usa-se um prazo fixo maior
 * (`numeroParcelasQuandoExcedeLimite`) só sobre a parte parcelável.
 */
export interface RegraAtoMaisParcelas {
  tipo: "ato_mais_parcelas";
  /** Valor de entrada acima do qual o excedente vira ATO (ex.: 60000). */
  limiteParcelavel: number;
  /** Limites de parcela (mínima, máxima, nº máximo, juros) usados quando a entrada NÃO excede `limiteParcelavel`. */
  limites: LimitesParcela;
  /** Nº de parcelas fixo usado quando a entrada excede o limite. */
  numeroParcelasQuandoExcedeLimite: number;
}

/** Configuração de um bloco de parcelas com prazo e nº de vezes fixos. */
export interface PeriodoParcelas {
  /** Quantidade de parcelas neste bloco. */
  parcelas: number;
  /** Valor de cada parcela neste bloco (calculado ou fixo, conforme a regra). */
  valorParcela?: number;
}

/** Configuração de pagamentos-balão (reforços semestrais/anuais). */
export interface ConfigBalao {
  /** Quantidade de balões. */
  quantidade: number;
  /** Periodicidade em meses (6 = semestral, 12 = anual). */
  periodicidadeMeses: number;
  /** Valor máximo permitido por balão — acima disso, o excedente vai para o ATO. */
  valorMaximoPorBalao: number;
}

/**
 * Estratégia 2 — "Período de obra + pós-obra + balão"
 * (ex.: Vale dos Sonhos, Reserva dos Ipês).
 *
 * A entrada é dividida em até 3 blocos, na ordem em que o dinheiro do
 * cliente é alocado: balão(ões) primeiro, depois parcelas durante a obra,
 * depois parcelas pós-obra. O que sobrar (não couber em nenhum bloco,
 * respeitando os limites) vira ATO.
 */
export interface RegraPeriodoObraBalao {
  tipo: "periodo_obra_pos_obra_balao";
  /** Duração da obra em meses (nº de parcelas "período obra") — prazo fixo, não uma estimativa. */
  mesesPeriodoObra: number;
  /** Teto de parcela (mínima/máxima/juros) específico do período de obra. */
  limitesObra?: LimitesParcela;
  /** Duração do período pós-obra em meses (0 se o empreendimento não tiver essa fase) — prazo fixo. */
  mesesPosObra: number;
  /** Teto de parcela (mínima/máxima/juros) específico do pós-obra — pode ser diferente do período de obra. */
  limitesPosObra?: LimitesParcela;
  /** Config de balão, se o empreendimento oferecer essa opção. */
  balao?: ConfigBalao;
}

/** Um cenário da tabela de condições especiais (ex.: Vera Cruz). */
export interface CondicaoEspecial {
  temDependente: boolean;
  fgtsMaisDe3Anos: boolean;
  tipoRenda: string;
  /** Entrada total exigida nesse cenário, para o valor de unidade de referência. */
  entrada: number;
  /** ATO (se houver) nesse cenário. */
  ato?: number;
  /** Nº de parcelas da entrada nesse cenário. */
  parcelas: number;
  /** Valor de cada parcela nesse cenário. */
  valorParcela: number;
}

/**
 * Estratégia 3 — "Tabela de condições" (ex.: Vera Cruz).
 *
 * Alguns empreendimentos/incorporadoras fornecem uma tabela pronta com o
 * valor de entrada por combinação de perfil do cliente (dependente, tempo
 * de FGTS, tipo de renda) em vez de uma fórmula genérica. Nesses casos,
 * a regra é uma busca direta na tabela.
 */
export interface RegraTabelaCondicoes {
  tipo: "tabela_condicoes";
  /** Valor de referência da unidade para a qual a tabela foi calculada. */
  valorUnidadeReferencia: number;
  condicoes: CondicaoEspecial[];
}

export type RegraEntrada =
  | RegraAtoMaisParcelas
  | RegraPeriodoObraBalao
  | RegraTabelaCondicoes;

/**
 * Regra alternativa via avaliação de engenharia do banco (laudo).
 * O banco financia até `percentualMaximoFinanciamento` do valor da
 * engenharia (não do valor de venda) — então, se a engenharia vier
 * acima da venda, a entrada necessária cai.
 */
export interface RegraEngenharia {
  /** Valor de avaliação de engenharia estimado/negociado para este empreendimento. */
  valorEngenharia: number;
  /** % máximo financiável sobre o valor de engenharia (padrão bancário: 0.8 = 80%). */
  percentualMaximoFinanciamento: number;
  /** Taxa de documentação sobre o valor de engenharia (padrão observado: 0.05 = 5%). */
  taxaDocumentacao: number;
  /** Taxa aplicada sobre a diferença (engenharia − venda), quando positiva (padrão observado: 0.15 = 15%). */
  taxaLucroImobiliario: number;
}

/** Configuração completa e editável de um empreendimento. */
export interface Empreendimento {
  id: string;
  nome: string;
  /** Valor de venda/tabela do imóvel. */
  valorImovel: number;
  /**
   * Descontos que reduzem o valor do imóvel para efeito de cálculo da
   * entrada (ex.: desconto de tabela da incorporadora).
   */
  descontos: Desconto[];
  /**
   * Benefícios apenas informativos — NÃO reduzem o valor usado no cálculo
   * da entrada (ex.: "Documentação Grátis", que isenta uma taxa que o
   * cliente pagaria à parte, mas não abate o preço do imóvel). Aparecem
   * na simulação só para reforçar o valor da oferta.
   */
  beneficiosInformativos?: Desconto[];
  /** Este empreendimento aceita subsídio Casa Paulista? */
  aceitaCasaPaulista: boolean;
  /** Regra de parcelamento da entrada deste empreendimento. */
  regraEntrada: RegraEntrada;
  /** Regra alternativa via engenharia, se o empreendimento permitir essa via. */
  regraEngenharia?: RegraEngenharia;
  /** Observações livres (ex.: condições especiais, validade da tabela). */
  observacoes?: string;
  /** Última atualização manual das regras — ajuda a saber se está desatualizado. */
  atualizadoEm?: string;
}

/** Resultado detalhado de uma simulação de entrada. */
export interface ResultadoSimulacao {
  empreendimentoId: string;
  empreendimentoNome: string;
  valorImovel: number;
  totalDescontos: number;
  valorFinalImovel: number;
  /** Financiamento + MCMV + Casa Paulista (o que o banco/governo cobre). */
  totalCoberto: number;
  /** Entrada total necessária (valor final do imóvel − total coberto). */
  entradaTotal: number;
  /** Detalhamento do parcelamento da entrada (depende da estratégia usada). */
  detalhePagamento: DetalhePagamento;
  /** Benefícios informativos do empreendimento (não afetam a entrada calculada). */
  beneficiosInformativos: Desconto[];
  /** Presente apenas se a via de engenharia foi calculada e comparada. */
  alternativaEngenharia?: {
    entradaNecessaria: number;
    financiamentoViaEngenharia: number;
    custosAdicionais: number;
  };
  avisos: string[];
}

export interface DetalhePagamento {
  /** Valor a pagar à vista, na assinatura do contrato. */
  ato: number;
  /** Blocos de parcelas (pode ter mais de um: obra, pós-obra, balão). */
  blocos: BlocoPagamento[];
}

export interface BlocoPagamento {
  /** Rótulo do bloco, ex.: "Parcelas durante a obra", "Balão semestral". */
  label: string;
  parcelas: number;
  /** Valor da parcela sem juros (parcelamento linear — valor ÷ nº de parcelas). */
  valorParcela: number;
  /** Valor da parcela COM juros, se este bloco tiver `taxaJurosMensal` configurada. */
  valorParcelaComJuros?: number;
  periodicidadeMeses: number;
}
