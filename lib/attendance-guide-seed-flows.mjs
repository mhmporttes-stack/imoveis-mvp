// Modelos iniciais — os 3 guias: PROSPECÇÃO, LEAD e ORGÂNICO. As objeções reais vêm do Banco de Objeções
// (cards "ref"). Tudo é editável em Gestão → Guia de Atendimento.
//
// Convenções do spec: { id, phase, title, guidance, argument, message, options:[[rótulo, destino]] }.
// type "ref": { id, type:"ref", entry:"obj-…" (entrada do banco), next:"card depois de tratar a objeção", label }.

const DOC = "documentacao";
const RETORNO = "retorno";

function documentacaoCards(prefix, { antes = "" } = {}) {
  return [
    {
      id: `${prefix}-${DOC}`, phase: "documentacao", title: "Documentação",
      guidance: `${antes}Só peça documentos DEPOIS de testar a aceitação. Peça por etapas e explique o porquê. Documentos básicos: documento com foto (RG ou CNH), CPF, comprovante de residência, comprovante de renda, estado civil (certidão) e, se for o caso, dados de quem vai comprar junto.`,
      argument: "Com a documentação em mãos a análise anda mais rápido e você evita idas e vindas.",
      message: "Perfeito, [Nome]! Pra eu já adiantar o seu processo, vou te pedir os documentos por etapas. Pra começar, me envia uma foto do seu documento com foto (RG ou CNH) e do CPF. Pode ser?",
      options: [["Enviou os documentos", `${prefix}-doc-conferir`], ["Vai enviar depois", `${prefix}-${RETORNO}`], ["Tem dificuldade para reunir", `${prefix}-doc-dificuldade`]]
    },
    {
      id: `${prefix}-doc-conferir`, phase: "documentacao", title: "Conferir os documentos recebidos",
      guidance: "Confira se estão legíveis, atualizados e completos. Peça o que faltar de uma vez só, com uma lista clara. Confirme o recebimento.",
      argument: "Conferir agora evita que a análise volte por falta de documento.",
      message: "Recebi, [Nome], obrigado! Vou conferir tudo e já te aviso se faltar alguma coisa. Ainda hoje eu te retorno com o próximo passo, combinado?",
      options: [["Faltam documentos", `${prefix}-${DOC}`], ["Tudo certo", `${prefix}-${RETORNO}`]]
    },
    {
      id: `${prefix}-doc-dificuldade`, phase: "documentacao", title: "Cliente com dificuldade para reunir documentos",
      guidance: "Descubra qual documento trava (renda informal, comprovante de residência em nome de terceiro, certidões). Oriente uma alternativa e divida em etapas.",
      argument: "Quase todo documento tem um caminho alternativo. Dividir em etapas tira o peso do processo.",
      message: "Sem problema, [Nome]. Qual dos documentos está mais difícil de conseguir? Me diz que eu te oriento o melhor jeito, e a gente vai por etapas.",
      options: [["Combinou como resolver", `${prefix}-${RETORNO}`], ["Prefere pensar", `@${prefix}-r-pensar`]]
    },
    { id: `${prefix}-r-pensar`, type: "ref", entry: "obj-pensar", next: `${prefix}-${DOC}`, label: "Precisa pensar" },
    {
      id: `${prefix}-${RETORNO}`, type: "followup", title: "Definir próximo passo e data de retorno",
      guidance: "Todo atendimento pendente termina com um próximo passo combinado e uma data para voltar a falar. Escolha a data, confirme com o cliente e salve a atividade na agenda.",
      message: "Então ficamos assim, [Nome]: o próximo passo é o que combinamos e eu volto a falar com você no dia marcado. Tudo certo?",
      defaultDays: 1
    }
  ];
}

// ---------------------------------------------------------------------------
// PROSPECÇÃO — reativação / cliente antigo
// ---------------------------------------------------------------------------
export const PROSPECTING_SPEC = [
  {
    id: "p-abertura", phase: "abertura", title: "Abertura",
    guidance: "Cliente antigo: mande SÓ o cumprimento e aguarde a resposta. Não envie a apresentação junto. Se responder, siga para a apresentação.",
    argument: "Um cumprimento curto abre a conversa sem parecer abordagem de venda.",
    message: "Bom dia, [Nome], tudo bem?",
    options: [["Cliente respondeu", "p-apresentacao"], ["Visualizou e não respondeu", "@r-nao-responde-p"]]
  },
  { id: "r-nao-responde-p", type: "ref", entry: "obj-nao-responde", next: "p-apresentacao", label: "Não responde" },
  {
    id: "p-apresentacao", phase: "abertura", title: "Apresentação e pergunta sobre a compra",
    guidance: "Apresente-se e pergunte como foi a experiência dele. O objetivo é descobrir se ele comprou, e não vender. Escute.",
    argument: "Ligar o contato ao interesse anterior mostra que não é uma mensagem em massa.",
    message: "[Nome], meu nome é [Corretor], sou [cargo_corretor]. Vi que há um tempo você entrou em contato com interesse na compra de um imóvel. Hoje estou te chamando para saber como foi sua experiência, se você foi bem atendido e se deu tudo certo com a compra.",
    options: [["Comprou", "p-comprou"], ["Não comprou", "p-motivo"], ["Não informou / respondeu vago", "p-nao-informou"]]
  },
  {
    id: "p-nao-informou", phase: "investigar", title: "Cliente não informou se comprou",
    guidance: "Faça UMA pergunta direta e simples. Se ainda vier resposta vaga, siga pelas duas possibilidades.",
    argument: "Uma pergunta objetiva tira o cliente da resposta evasiva sem pressioná-lo.",
    message: "E deu tudo certo com a compra?",
    options: [["Comprou", "p-comprou"], ["Não comprou", "p-motivo"], ["Segue sem responder", "@r-nao-responde-p"]]
  },
  {
    id: "p-comprou", phase: "encerramento", title: "Cliente comprou",
    guidance: "Finalize corretamente: parabenize, pergunte se foi bem atendido e com quem comprou. Peça indicação com naturalidade e ATUALIZE o cliente no CRM. Se comprou por outro corretor, registre e encerre com educação.",
    argument: "Um cliente satisfeito é a melhor fonte de indicação — e o pós-venda vem antes do pedido.",
    message: "Que ótima notícia, [Nome]! Parabéns pela conquista! Você ficou satisfeito(a) com o atendimento? Se conhecer alguém que também esteja querendo comprar um imóvel, fico feliz em ajudar.",
    options: [["Finalizar e registrar no CRM", "p-fim-comprou"]]
  },
  { id: "p-fim-comprou", type: "end", title: "Atendimento finalizado: comprou", outcome: "Comprou", guidance: "Atualize o cliente no CRM (status e observação) e, se combinado, agende um contato de relacionamento." },
  {
    id: "p-motivo", phase: "investigar", title: "Descobrir o motivo de não ter comprado",
    guidance: "Não ofereça imóvel ainda. Pergunte com curiosidade e escute. Escolha abaixo o motivo que o cliente disse. Cada caminho tem investigação e solução no Banco de Objeções.",
    argument: "Entender o que aconteceu vale mais do que qualquer oferta: mostra que você se importa com o resultado dele.",
    message: "Entendi, [Nome]. Me conta o que aconteceu que não deu certo? Foi alguma questão com a entrada, com a aprovação, com o imóvel? Assim eu vejo se consigo te ajudar de algum jeito.",
    options: [
      ["Sem entrada", "@r-sem-entrada-p"],
      ["Restrição no nome", "@r-restricao-p"],
      ["Parcela alta", "@r-parcela-p"],
      ["Aprovação baixa", "@r-aprovacao-p"],
      ["Renda insuficiente", "@r-renda-p"],
      ["Não gostou dos imóveis", "@r-imovel-p"],
      ["Quer esperar", "@r-esperar-p"],
      ["Quer juntar dinheiro", "@r-juntar-p"],
      ["Já está com outro corretor", "@r-outro-p"],
      ["Financiamento / juros", "@r-juros-p"],
      ["Outro motivo", "@r-outra-p"]
    ]
  },
  { id: "r-sem-entrada-p", type: "ref", entry: "obj-sem-entrada", next: "p-documentacao", label: "Sem entrada" },
  { id: "r-restricao-p", type: "ref", entry: "obj-restricao", next: "p-documentacao", label: "Restrição" },
  { id: "r-parcela-p", type: "ref", entry: "obj-parcela-alta", next: "p-documentacao", label: "Parcela alta" },
  { id: "r-aprovacao-p", type: "ref", entry: "obj-aprovacao-baixa", next: "p-documentacao", label: "Aprovação baixa" },
  { id: "r-renda-p", type: "ref", entry: "obj-renda-baixa", next: "p-documentacao", label: "Renda insuficiente" },
  { id: "r-imovel-p", type: "ref", entry: "obj-nao-gostou-imovel", next: "p-documentacao", label: "Não gostou dos imóveis" },
  { id: "r-esperar-p", type: "ref", entry: "obj-esperar", next: "p-documentacao", label: "Quer esperar" },
  { id: "r-juntar-p", type: "ref", entry: "obj-juntar-dinheiro", next: "p-documentacao", label: "Quer juntar dinheiro" },
  { id: "r-outro-p", type: "ref", entry: "obj-outro-corretor", next: "p-documentacao", label: "Outro corretor" },
  { id: "r-juros-p", type: "ref", entry: "obj-juros", next: "p-documentacao", label: "Financiamento / juros" },
  { id: "r-outra-p", type: "ref", entry: "obj-outra", next: "p-documentacao", label: "Outro motivo" },
  ...documentacaoCards("p", { antes: "Chegou aqui porque o cliente aceitou a solução para o motivo que o impediu de comprar. " })
];

// ---------------------------------------------------------------------------
// LEAD — patrocinado / lead novo (fluxo mais direto)
// Recepção → Interesse → Necessidade → Simulação → Objeções → Documentação
// ---------------------------------------------------------------------------
export const LEAD_SPEC = [
  {
    id: "l-recepcao", phase: "abertura", title: "Recepção do lead",
    guidance: "Responda RÁPIDO (os primeiros minutos decidem). Apresente-se, confirme o interesse e faça UMA pergunta. Depois, escolha abaixo como o cliente respondeu.",
    argument: "O lead acabou de demonstrar interesse. Rapidez e simpatia valem mais do que uma mensagem longa.",
    message: "Olá, [Nome]! Aqui é [o_a] [Corretor], [cargo_corretor]. Vi que você pediu informações sobre o imóvel. Vou te ajudar por aqui! Antes de tudo: você está buscando pra morar ou pra investir?",
    options: [
      ["Quer saber o valor", "l-valor"],
      ["Quer saber a entrada", "l-entrada"],
      ["Pergunta se é sem entrada", "l-sem-entrada"],
      ["Quer apenas informações", "l-informacoes"],
      ["Perguntou de um imóvel específico", "l-imovel"],
      ["Já fez simulação", "l-ja-simulou"],
      ["Já foi reprovado", "@r-reprovado-l"],
      ["Visualizou e sumiu", "@r-nao-responde-l"],
      ["Responde pouco", "l-responde-pouco"],
      ["Outra situação", "@r-outra-l"]
    ]
  },
  { id: "r-reprovado-l", type: "ref", entry: "obj-ja-reprovado", next: "l-interesse", label: "Já foi reprovado" },
  { id: "r-nao-responde-l", type: "ref", entry: "obj-nao-responde", next: "l-interesse", label: "Não responde" },
  { id: "r-outra-l", type: "ref", entry: "obj-outra", next: "l-interesse", label: "Outra situação" },
  {
    id: "l-valor", phase: "abertura", title: "Cliente quer saber o valor",
    guidance: "Dê o valor de referência se tiver, mas NÃO pare aí: valor sem contexto vira comparação de preço. Transforme em pergunta sobre o que ele precisa.",
    argument: "O valor do imóvel é só uma parte: o que decide a compra é a parcela e a entrada que cabem no bolso dele.",
    message: "Claro, [Nome]! O valor de referência é esse que te passei, mas o que realmente importa é a parcela que caberia no seu bolso. Me conta: você está pensando em comprar pra morar ou pra investir?",
    options: [["Respondeu", "l-interesse"], ["Só queria o valor", "l-informacoes"]]
  },
  {
    id: "l-entrada", phase: "abertura", title: "Cliente quer saber a entrada",
    guidance: "Não solte um número e fique esperando. Explique que existem condições diferentes e pergunte o que ele tem disponível.",
    argument: "A entrada pode variar conforme o empreendimento e o perfil. Perguntar o que ele tem evita um “não” precipitado.",
    message: "A entrada muda conforme o empreendimento e o seu perfil, [Nome]. Pra eu te dar um número real: você tem algum valor separado ou FGTS? Não precisa ser exato, só uma ideia.",
    options: [["Informou o que tem", "l-necessidade"], ["Não tem entrada", "@r-sem-entrada-l"], ["Prefere não informar", "l-necessidade"]]
  },
  {
    id: "l-sem-entrada", phase: "abertura", title: "Pergunta se é sem entrada",
    guidance: "Não responda “sim” nem “não” secos. Diga que existem condições facilitadas e que dependem da análise do perfil. Investigue a situação.",
    argument: "Existem condições de entrada facilitada, mas dependem da análise. Prometer sem analisar gera frustração.",
    message: "Existem condições bem flexíveis de entrada, [Nome], e o que cabe depende da análise do seu perfil. Me conta rapidinho: você trabalha de carteira assinada ou por conta própria? Assim já te digo o caminho mais provável.",
    options: [["Respondeu sobre a renda", "l-necessidade"], ["Só quer saber se tem sem entrada", "@r-sem-entrada-l"]]
  },
  { id: "r-sem-entrada-l", type: "ref", entry: "obj-sem-entrada", next: "l-simulacao", label: "Sem entrada" },
  {
    id: "l-informacoes", phase: "abertura", title: "Cliente quer apenas informações",
    guidance: "“Só informação” é abertura de conversa. Dê a informação e devolva uma pergunta que revele a necessidade.",
    argument: "Quem pede informação já está no funil. Uma pergunta boa transforma informação em atendimento.",
    message: "Claro, [Nome]! Vou te passar o que você precisa. Pra eu te mandar só o que interessa: você pensa em qual região e em quantos quartos?",
    options: [["Respondeu", "l-necessidade"], ["Responde pouco", "l-responde-pouco"]]
  },
  {
    id: "l-imovel", phase: "abertura", title: "Imóvel específico",
    guidance: "Confirme qual imóvel e o que chamou a atenção. Use isso na necessidade. Se o imóvel não estiver disponível, ofereça alternativa parecida.",
    argument: "O que chamou a atenção nesse imóvel revela o que o cliente valoriza — e ajuda a mostrar outras opções.",
    message: "Ótima escolha, [Nome]! O que mais te chamou a atenção nele: a localização, o tamanho ou o valor? Assim eu vejo se tenho outras opções parecidas também.",
    options: [["Respondeu", "l-necessidade"], ["Quer só esse imóvel", "l-simulacao"]]
  },
  {
    id: "l-ja-simulou", phase: "abertura", title: "Cliente já fez simulação",
    guidance: "Peça o resultado da simulação anterior (ou consulte no CRM). Não refaça do zero: valide o que ele viu e descubra o que ficou em aberto.",
    argument: "Quem já simulou está mais adiantado — só precisa de alguém que explique o resultado e destrave a decisão.",
    message: "Que bom que você já simulou, [Nome]! Você lembra do resultado que apareceu? O que você achou: a parcela, a entrada, o valor do imóvel?",
    options: [["Informou o resultado", "l-objecoes"], ["Não lembra", "l-simulacao"]]
  },
  {
    id: "l-responde-pouco", phase: "abertura", title: "Cliente responde pouco",
    guidance: "Faça perguntas de UMA palavra (sim/não, A ou B). Cliente que responde pouco não quer digitar muito — facilite.",
    argument: "Perguntas fechadas e curtas destravam o diálogo sem cansar o cliente.",
    message: "Tudo bem, [Nome]! Vou facilitar: é pra morar ou investir? Se preferir, me manda um áudio, que eu entendo rapidinho.",
    options: [["Passou a responder", "l-interesse"], ["Continua sem responder", "@r-nao-responde-l"]]
  },
  {
    id: "l-interesse", phase: "investigar", title: "Interesse",
    guidance: "Confirme o interesse real: pra morar, investir, sair do aluguel? Perceba a urgência (quando quer se mudar).",
    argument: "O motivo da compra é o que sustenta a decisão quando aparecerem as objeções.",
    message: "Me conta, [Nome]: o que te fez procurar um imóvel agora? Você quer sair do aluguel, aumentar a família, investir?",
    options: [["Respondeu", "l-necessidade"], ["Só está olhando", "l-necessidade"]]
  },
  {
    id: "l-necessidade", phase: "investigar", title: "Necessidade",
    guidance: "Descubra o essencial do imóvel: região, quartos, faixa de valor, prazo. Anote no CRM. Não ofereça nada antes de entender.",
    argument: "Um imóvel bem escolhido para a necessidade vende sozinho. Uma opção jogada no escuro só gera comparação.",
    message: "Pra eu te indicar o que faz sentido, [Nome]: qual região você prefere, quantos quartos precisa e mais ou menos qual valor de parcela ficaria confortável no mês?",
    options: [["Respondeu tudo", "l-simulacao"], ["Respondeu em parte", "l-simulacao"], ["Não sabe a parcela", "l-simulacao"]]
  },
  {
    id: "l-simulacao", phase: "solucionar", title: "Simulação",
    guidance: "Envie o link de simulação (ou peça os dados básicos). A simulação mostra o que cabe e sustenta a conversa. Explique que é sem compromisso e que o resultado depende da análise.",
    argument: "Sem simulação a conversa é opinião; com simulação vira número. É o que tira o cliente do “acho que não consigo”.",
    message: "Agora vamos ver o que cabe no seu perfil, [Nome]. Você pode fazer uma simulação rápida por aqui, sem compromisso: [Link]. Quando terminar, me avisa que eu te explico o resultado.",
    options: [["Fez a simulação", "l-objecoes"], ["Vai fazer depois", "l-retorno"], ["Não quer fazer", "@r-pensar-l"]]
  },
  { id: "r-pensar-l", type: "ref", entry: "obj-pensar", next: "l-simulacao", label: "Precisa pensar" },
  {
    id: "l-objecoes", phase: "objecao", title: "Objeções",
    guidance: "Depois de ver o resultado, o cliente costuma reagir. Primeiro pergunte o que achou; a objeção real aparece aqui. Escolha a que ele mencionou.",
    argument: "Uma objeção dita é uma oportunidade: quem não tem interesse não explica o motivo.",
    message: "E aí, [Nome], o que você achou do resultado? Ficou algum ponto que te deixou em dúvida?",
    options: [
      ["Parcela alta", "@r-parcela-l"],
      ["Renda", "@r-renda-l"],
      ["Restrição", "@r-restricao-l"],
      ["Entrada", "@r-sem-entrada-l2"],
      ["Não gostou do imóvel", "@r-imovel-l"],
      ["Precisa pensar / família", "@r-familia-l"],
      ["Gostou e quer seguir", "l-documentacao"],
      ["Outra objeção", "@r-outra-l2"]
    ]
  },
  { id: "r-parcela-l", type: "ref", entry: "obj-parcela-alta", next: "l-documentacao", label: "Parcela alta" },
  { id: "r-renda-l", type: "ref", entry: "obj-renda-baixa", next: "l-documentacao", label: "Renda" },
  { id: "r-restricao-l", type: "ref", entry: "obj-restricao", next: "l-documentacao", label: "Restrição" },
  { id: "r-sem-entrada-l2", type: "ref", entry: "obj-sem-entrada", next: "l-documentacao", label: "Entrada" },
  { id: "r-imovel-l", type: "ref", entry: "obj-nao-gostou-imovel", next: "l-documentacao", label: "Não gostou do imóvel" },
  { id: "r-familia-l", type: "ref", entry: "obj-familia", next: "l-documentacao", label: "Família" },
  { id: "r-outra-l2", type: "ref", entry: "obj-outra", next: "l-documentacao", label: "Outra objeção" },
  ...documentacaoCards("l", { antes: "Cliente gostou da simulação (ou aceitou a solução da objeção). " })
];

// ---------------------------------------------------------------------------
// ORGÂNICO — Instagram, indicação, WhatsApp, contato espontâneo
// Origem → Interesse → Necessidade → Situação atual → Simulação → Objeções → Documentação
// ---------------------------------------------------------------------------
export const ORGANIC_SPEC = [
  {
    id: "o-origem", phase: "abertura", title: "Origem do contato",
    guidance: "Descubra como o cliente chegou — isso muda a abertura. Contato espontâneo já tem interesse; indicação carrega confiança de quem indicou.",
    argument: "Saber a origem ajuda a personalizar a abordagem desde a primeira frase.",
    message: "Olá, [Nome]! Aqui é [o_a] [Corretor], [cargo_corretor]. Que bom seu contato! Me conta: como você chegou até a gente?",
    options: [
      ["Viu um imóvel no Instagram", "o-instagram"],
      ["Quer saber o poder de compra", "o-poder"],
      ["Veio por indicação", "o-indicacao"],
      ["Quer sair do aluguel", "o-aluguel"],
      ["Imóvel específico", "o-imovel"],
      ["“Só estou olhando”", "o-olhando"],
      ["Outra situação", "@r-outra-o"]
    ]
  },
  { id: "r-outra-o", type: "ref", entry: "obj-outra", next: "o-interesse", label: "Outra situação" },
  {
    id: "o-instagram", phase: "abertura", title: "Viu um imóvel no Instagram",
    guidance: "Pergunte qual publicação chamou a atenção e o que gostou. Isso mostra o gosto dele antes de qualquer números.",
    argument: "Quem chega por um post já se identificou com algo do imóvel — descobrir o quê é o atalho para a necessidade.",
    message: "Que legal, [Nome]! Qual imóvel você viu e o que mais chamou sua atenção nele? Assim eu já te passo as informações certas.",
    options: [["Respondeu", "o-interesse"], ["Não lembra qual", "o-necessidade"]]
  },
  {
    id: "o-poder", phase: "abertura", title: "Quer saber o poder de compra",
    guidance: "Não dê um número de cabeça: só a simulação diz. Explique e conduza para entender a situação.",
    argument: "Poder de compra depende de renda, entrada e prazo — só calculando com dados reais o cliente tem uma resposta confiável.",
    message: "Boa pergunta, [Nome]! Só dá pra saber com números reais, e eu faço isso com você rapidinho, sem compromisso. Pra começar: você tem renda formal ou trabalha por conta própria?",
    options: [["Respondeu", "o-situacao"], ["Prefere ver a simulação direto", "o-simulacao"]]
  },
  {
    id: "o-indicacao", phase: "abertura", title: "Veio por indicação",
    guidance: "Agradeça a indicação e cite quem indicou. Indicação já vem com confiança — não desperdice: atenda muito bem e retribua a quem indicou ao final.",
    argument: "Quem chega por indicação espera o mesmo nível de cuidado que quem o indicou recebeu.",
    message: "Que bom, [Nome]! Fico muito feliz que tenham nos indicado. Vou cuidar de você com o mesmo carinho. Me conta: o que você está buscando?",
    options: [["Respondeu", "o-interesse"]]
  },
  {
    id: "o-aluguel", phase: "abertura", title: "Quer sair do aluguel",
    guidance: "Descubra quanto paga de aluguel e há quanto tempo: é o principal argumento numérico da conversa.",
    argument: "Quem quer sair do aluguel já entende o custo de não ter imóvel — só precisa ver que existe caminho.",
    message: "Muita gente começa exatamente assim, [Nome]! Hoje você paga quanto de aluguel, mais ou menos? Com esse valor eu já consigo ver possibilidades de parcela.",
    options: [["Informou o aluguel", "o-necessidade"], ["Prefere não informar", "o-necessidade"]]
  },
  {
    id: "o-imovel", phase: "abertura", title: "Imóvel específico",
    guidance: "Confirme qual imóvel e o que chamou a atenção. Se não estiver disponível, ofereça alternativas parecidas.",
    argument: "O imóvel escolhido diz muito sobre o que o cliente valoriza.",
    message: "Ótima escolha, [Nome]! Além desse, você aceitaria ver outras opções parecidas? Me conta o que mais te atraiu nele.",
    options: [["Respondeu", "o-necessidade"], ["Só quer esse", "o-situacao"]]
  },
  {
    id: "o-olhando", phase: "abertura", title: "“Só estou olhando”",
    guidance: "Não pressione: “só olhando” é uma forma educada de se proteger. Dê valor, sem cobrar decisão, e ofereça uma simulação sem compromisso.",
    argument: "Quem olha hoje pode comprar amanhã. Ser útil sem pressão é o que faz o cliente voltar.",
    message: "Perfeito, [Nome], olhar com calma é o melhor caminho! Se quiser, eu posso te mostrar como ficaria uma simulação, sem compromisso nenhum, só pra você saber o que cabe. Topa?",
    options: [["Topou", "o-interesse"], ["Continua só olhando", "@r-pensar-o"]]
  },
  { id: "r-pensar-o", type: "ref", entry: "obj-pensar", next: "o-interesse", label: "Só olhando / pensar" },
  {
    id: "o-interesse", phase: "investigar", title: "Interesse",
    guidance: "Confirme o interesse real: morar, investir, sair do aluguel? Perceba a urgência.",
    argument: "O motivo da compra sustenta a decisão quando aparecerem as objeções.",
    message: "E o que te fez começar a olhar imóveis agora, [Nome]? É pra morar, pra investir, pra sair do aluguel?",
    options: [["Respondeu", "o-necessidade"]]
  },
  {
    id: "o-necessidade", phase: "investigar", title: "Necessidade",
    guidance: "Região, quartos, faixa de valor e prazo. Anote no CRM.",
    argument: "Entender antes de oferecer evita mostrar imóveis que não fazem sentido.",
    message: "Pra eu te indicar o que faz sentido: qual região você prefere, quantos quartos precisa e qual valor de parcela ficaria confortável pra você?",
    options: [["Respondeu", "o-situacao"], ["Respondeu em parte", "o-situacao"]]
  },
  {
    id: "o-situacao", phase: "investigar", title: "Situação atual",
    guidance: "Descubra renda (formal/informal), FGTS, entrada disponível, restrição no nome, se já foi reprovado e se compra sozinho ou em conjunto. Pergunte com naturalidade, uma coisa por vez.",
    argument: "A situação real define o caminho: quanto mais cedo for conhecida, menos surpresa na análise.",
    message: "Só pra eu montar a simulação certa, [Nome]: você trabalha de carteira assinada ou por conta própria? Tem FGTS ou algum valor de entrada? E o seu nome está sem restrição, até onde você sabe?",
    options: [["Situação organizada", "o-simulacao"], ["Tem restrição", "@r-restricao-o"], ["Renda informal", "@r-renda-o"], ["Não tem entrada", "@r-sem-entrada-o"], ["Já foi reprovado", "@r-reprovado-o"]]
  },
  { id: "r-restricao-o", type: "ref", entry: "obj-restricao", next: "o-simulacao", label: "Restrição" },
  { id: "r-renda-o", type: "ref", entry: "obj-renda-baixa", next: "o-simulacao", label: "Renda" },
  { id: "r-sem-entrada-o", type: "ref", entry: "obj-sem-entrada", next: "o-simulacao", label: "Sem entrada" },
  { id: "r-reprovado-o", type: "ref", entry: "obj-ja-reprovado", next: "o-simulacao", label: "Já foi reprovado" },
  {
    id: "o-simulacao", phase: "solucionar", title: "Simulação",
    guidance: "Envie o link de simulação ou faça com ele. Deixe claro que é sem compromisso e que o resultado depende da análise.",
    argument: "A simulação transforma “acho que não dá” em números reais.",
    message: "Agora vamos ver o que cabe no seu perfil, [Nome]. Você pode fazer uma simulação rápida por aqui, sem compromisso: [Link]. Quando terminar, me avisa que eu te explico o resultado.",
    options: [["Fez a simulação", "o-objecoes"], ["Vai fazer depois", "o-retorno"], ["Não quer fazer", "@r-pensar-o"]]
  },
  {
    id: "o-objecoes", phase: "objecao", title: "Objeções",
    guidance: "Depois do resultado, o cliente reage. Pergunte o que achou e escolha a objeção que ele mencionou.",
    argument: "Uma objeção dita é uma oportunidade de ajudar.",
    message: "E aí, [Nome], o que você achou do resultado? Algum ponto te deixou em dúvida?",
    options: [
      ["Parcela alta", "@r-parcela-o"],
      ["Renda", "@r-renda-o2"],
      ["Restrição", "@r-restricao-o2"],
      ["Entrada", "@r-sem-entrada-o2"],
      ["Não gostou do imóvel", "@r-imovel-o"],
      ["Quer esperar / juntar dinheiro", "@r-esperar-o"],
      ["Precisa falar com a família", "@r-familia-o"],
      ["Gostou e quer seguir", "o-documentacao"],
      ["Outra objeção", "@r-outra-o2"]
    ]
  },
  { id: "r-parcela-o", type: "ref", entry: "obj-parcela-alta", next: "o-documentacao", label: "Parcela alta" },
  { id: "r-renda-o2", type: "ref", entry: "obj-renda-baixa", next: "o-documentacao", label: "Renda" },
  { id: "r-restricao-o2", type: "ref", entry: "obj-restricao", next: "o-documentacao", label: "Restrição" },
  { id: "r-sem-entrada-o2", type: "ref", entry: "obj-sem-entrada", next: "o-documentacao", label: "Entrada" },
  { id: "r-imovel-o", type: "ref", entry: "obj-nao-gostou-imovel", next: "o-documentacao", label: "Não gostou do imóvel" },
  { id: "r-esperar-o", type: "ref", entry: "obj-esperar", next: "o-documentacao", label: "Quer esperar" },
  { id: "r-familia-o", type: "ref", entry: "obj-familia", next: "o-documentacao", label: "Família" },
  { id: "r-outra-o2", type: "ref", entry: "obj-outra", next: "o-documentacao", label: "Outra objeção" },
  ...documentacaoCards("o", { antes: "Cliente gostou da simulação (ou aceitou a solução da objeção). " })
];
