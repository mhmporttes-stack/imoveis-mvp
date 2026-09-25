// Modelos iniciais — BANCO DE OBJEÇÕES (reutilizável pelos outros guias).
// Regra central de cada objeção: OBJEÇÃO → INVESTIGAR → MOTIVO REAL → SOLUCIONAR → TESTAR ACEITAÇÃO → (volta ao atendimento
// para a DOCUMENTAÇÃO) → DATA DE RETORNO. Nenhuma fala promete aprovação, valor de parcela, valorização ou lucro.
// Tudo é editável em Gestão → Guia de Atendimento.

const REINVESTIGAR = "lib-reinvestigar";
const TESTAR = "lib-testar";
const RETORNO = "lib-retorno";
const VOLTAR = "lib-voltar";
const OUTRA = "obj-outra";

export const LIBRARY_SPEC = [
  // ------------------------------------------------------------------ comuns
  {
    id: TESTAR, phase: "testar", title: "Testar aceitação",
    guidance: "Antes de falar em documentação, confirme se a solução apresentada faz sentido para o cliente. Pergunte e espere a resposta — não assuma que ele aceitou.",
    argument: "Perguntar é o que separa um cliente que entendeu de um cliente que só concordou por educação.",
    message: "Pensando no que conversamos, [Nome], esse caminho faz sentido pra você? Se fizer, já consigo te dizer o próximo passo.",
    options: [
      ["Aceitou / quer seguir", VOLTAR],
      ["Ainda tem uma dúvida", REINVESTIGAR],
      ["Precisa pensar / falar com alguém", "obj-pensar"],
      ["Não aceitou", REINVESTIGAR]
    ]
  },
  {
    id: REINVESTIGAR, phase: "investigar", title: "Voltar a investigar o motivo",
    guidance: "Se ele não aceitou, a solução provavelmente não atacou o motivo real. Não insista no mesmo argumento: pergunte de novo, de outro jeito.",
    argument: "Uma objeção costuma esconder outra. Perguntar “o que faltou” mostra interesse e abre o motivo verdadeiro.",
    message: "Entendi, [Nome]. Me ajuda a entender melhor: o que, na sua visão, ainda não fez sentido ou ficou faltando?",
    options: [
      ["É o valor da parcela", "obj-parcela-alta"],
      ["É a entrada", "obj-sem-entrada"],
      ["Não gostou do imóvel", "obj-nao-gostou-imovel"],
      ["Tem medo / insegurança", "obj-medo-financiamento"],
      ["Outro motivo", OUTRA],
      ["Não quis explicar", "obj-pensar"]
    ]
  },
  {
    id: RETORNO, type: "followup", title: "Definir próximo passo e data de retorno",
    guidance: "Nenhum atendimento pendente termina sem próximo passo + data. Combine com o cliente O QUE vai acontecer e QUANDO você volta a falar com ele. Registre a atividade aqui.",
    message: "Combinado, [Nome]! Então o próximo passo é esse e eu volto a falar com você no dia que marcamos, pra gente dar sequência. Pode ser?",
    defaultDays: 2
  },
  { id: VOLTAR, type: "return" },

  // ------------------------------------------------------------ sem entrada
  {
    id: "obj-sem-entrada", entry: true, phase: "objecao", title: "Objeção: “Não tenho entrada”",
    guidance: "Não corra para a solução. Primeiro descubra se é ausência total de recurso, recurso guardado que ele não quer usar, ou dúvida sobre o que conta como entrada (FGTS, valor a receber, etc.).",
    argument: "Muitos clientes acham que “entrada” é um valor alto e fixo. Existem condições diferentes por empreendimento e por perfil — só a análise mostra o que cabe.",
    message: "Entendi, [Nome]. Só pra eu te ajudar do jeito certo: quando você diz que não tem entrada, é que não tem nenhum valor separado agora, ou tem um pouco mas acha que não é suficiente?",
    options: [
      ["Não tem nada separado", "sol-sem-entrada"],
      ["Tem um pouco / FGTS", "sol-entrada-composta"],
      ["Tem, mas não quer usar", "sol-entrada-nao-usar"]
    ]
  },
  {
    id: "sol-sem-entrada", phase: "solucionar", title: "Apresentar condições sem entrada / entrada facilitada",
    guidance: "Apresente produtos e condições COMPATÍVEIS com o perfil (renda, restrição, região). Fale em “opções que podem existir conforme a análise”, nunca em aprovação certa. Mostre 1 ou 2 opções, não uma lista enorme.",
    argument: "Alguns empreendimentos trabalham com entrada parcelada ou condições facilitadas. O que cabe depende da análise de cada pessoa — por isso a simulação vem antes de qualquer decisão.",
    message: "Existem empreendimentos com condições bem flexíveis de entrada, [Nome], e o que cabe depende da análise do seu perfil. Posso te mostrar as opções que combinam com o que você me contou, sem compromisso?",
    options: [
      ["Gostou da opção sem entrada", TESTAR],
      ["Não gostou do imóvel", "obj-nao-gostou-imovel"],
      ["Não gostou das opções sem entrada", "sol-primeiro-imovel"],
      ["Achou a parcela alta", "obj-parcela-alta"],
      ["Outra objeção", OUTRA]
    ]
  },
  {
    id: "sol-entrada-composta", phase: "solucionar", title: "Montar a entrada com o que já existe",
    guidance: "Pergunte o que ele tem (FGTS, economia, carro, valor a receber). Não prometa que o total será aceito: diga que a análise define. O objetivo é ele perceber que talvez tenha mais do que imagina.",
    argument: "Entrada nem sempre é dinheiro guardado na conta: pode incluir FGTS e outros recursos, conforme as regras de cada financiamento.",
    message: "Legal saber, [Nome]! Muita gente descobre que já tem mais recurso do que imaginava, contando FGTS e outras fontes. Você sabe mais ou menos quanto tem hoje, somando tudo? Assim eu simulo com dados reais.",
    options: [["Informou os valores", TESTAR], ["Não sabe quanto tem", "sol-parcela-simulacao"], ["Achou pouco", "sol-sem-entrada"]]
  },
  {
    id: "sol-entrada-nao-usar", phase: "solucionar", title: "Entender por que não quer usar o que tem",
    guidance: "Quem guarda e não quer usar geralmente tem um medo: ficar sem reserva. Reconheça isso antes de argumentar.",
    argument: "Ter reserva é importante mesmo. A conversa é encontrar uma condição que não deixe ele desprotegido.",
    message: "Faz total sentido, [Nome]. Ter uma reserva dá tranquilidade. Se eu te mostrar uma condição em que você usa só uma parte e mantém uma reserva, vale eu te mostrar?",
    options: [["Topou ver", "sol-sem-entrada"], ["Continua não querendo usar", "obj-juntar-dinheiro"], ["Outro motivo", OUTRA]]
  },
  {
    id: "sol-primeiro-imovel", phase: "solucionar", title: "Primeiro imóvel: início da construção de patrimônio",
    guidance: "Use quando ele não gostou das opções sem entrada. Trabalhe o CONCEITO: o primeiro imóvel é um começo. Sair do aluguel, pagar algo que vira patrimônio (amortizar) e, no futuro, poder evoluir para outro imóvel. NÃO prometa valorização, lucro nem revenda.",
    argument: "O primeiro imóvel raramente é o dos sonhos — é o ponto de partida. A parcela deixa de ser um gasto que some (aluguel) e passa a amortizar um patrimônio seu. Lá na frente, com a vida mais organizada, dá pra pensar em evoluir.",
    message: "Muita gente pensa no imóvel ideal logo de cara, [Nome], mas o primeiro costuma ser o começo da construção do patrimônio: você sai do aluguel, cada parcela amortiza algo que é seu e, no futuro, pode pensar em evoluir para um imóvel maior. Faz sentido olhar por esse lado?",
    options: [["Entendeu e gostou da ideia", TESTAR], ["Ainda prefere esperar", "obj-esperar"], ["Prefere continuar no aluguel", "obj-aluguel"], ["Outra objeção", OUTRA]]
  },

  // ------------------------------------------------------------ parcela alta
  {
    id: "obj-parcela-alta", entry: true, phase: "objecao", title: "Objeção: “A parcela está alta”",
    guidance: "Não reduza o valor de cara nem “dê desconto”. Descubra o número que ele considera confortável e o que a parcela representa na renda dele.",
    argument: "Parcela alta depende de renda, prazo, entrada e valor do imóvel. Cada um desses pode ser ajustado em uma simulação — e o ajuste só é possível se soubermos o valor confortável.",
    message: "Entendi, [Nome]. Pra eu buscar algo que caiba de verdade: qual valor de parcela ficaria confortável pra você no mês? E você paga aluguel hoje?",
    options: [["Informou um valor", "sol-parcela-ajuste"], ["Não sabe dizer", "sol-parcela-simulacao"], ["Compara com o aluguel", "obj-aluguel"]]
  },
  {
    id: "sol-parcela-ajuste", phase: "solucionar", title: "Ajustar a simulação ao valor confortável",
    guidance: "Mostre as alavancas: prazo, valor do imóvel, valor de entrada, composição de renda. Refaça a simulação com o valor que ele informou. Diga sempre “conforme a análise”.",
    argument: "Em vez de cortar o sonho, ajustamos as variáveis: às vezes um imóvel de valor um pouco menor ou uma composição de renda muda bastante o cenário.",
    message: "Com esse valor de parcela em mente, [Nome], consigo refazer a simulação mexendo em prazo, entrada e valor do imóvel pra ver o que se encaixa. Posso fazer isso agora com você?",
    options: [["Gostou do novo cenário", TESTAR], ["Renda não comporta", "obj-renda-baixa"], ["Quer imóvel mais barato", "obj-nao-gostou-imovel"], ["Outra objeção", OUTRA]]
  },
  {
    id: "sol-parcela-simulacao", phase: "solucionar", title: "Simular para ele ver números reais",
    guidance: "Quando ele não sabe o valor confortável, a simulação vira a conversa. Envie o link de simulação ou peça os dados básicos e compartilhe as opções.",
    argument: "Sem números na mão a parcela parece maior do que é. A simulação mostra o cenário real, sem compromisso.",
    message: "Sem problema, [Nome]! O melhor é ver com números reais. Você pode fazer uma simulação rápida por aqui, sem compromisso: [Link]. Quando terminar, me avisa que eu te explico o resultado.",
    options: [["Fez a simulação", "sol-parcela-ajuste"], ["Não quis fazer", "obj-pensar"], ["Outra objeção", OUTRA]]
  },

  // -------------------------------------------------------------- renda baixa
  {
    id: "obj-renda-baixa", entry: true, phase: "objecao", title: "Objeção: “Minha renda é baixa”",
    guidance: "Investigue: renda formal ou informal? Alguém pode compor renda (cônjuge, familiar)? Existe renda que ainda não foi considerada?",
    argument: "Renda não é só o holerite. A composição de renda e a comprovação correta mudam muito o cenário — mas quem decide é a análise do banco.",
    message: "Entendi, [Nome]. Me conta: sua renda é de carteira assinada, autônomo ou outra forma? E tem alguém, como cônjuge ou familiar, que poderia comprar junto com você?",
    options: [["Pode compor renda", "sol-renda-composicao"], ["Renda informal", "sol-renda-informal"], ["Ninguém pra compor", "sol-renda-imovel-menor"]]
  },
  {
    id: "sol-renda-composicao", phase: "solucionar", title: "Composição de renda",
    guidance: "Explique que duas rendas podem ser analisadas juntas. Não prometa aprovação. Combine quem participaria e quais documentos cada um teria.",
    argument: "Comprar em conjunto é uma forma comum e legítima de ampliar as possibilidades de análise.",
    message: "Uma alternativa é comprar em conjunto, [Nome]: as duas rendas entram na análise. Quem poderia participar com você? Assim eu já simulo os dois cenários.",
    options: [["Vai compor renda", TESTAR], ["Ninguém quer / pode", "sol-renda-imovel-menor"], ["Precisa conversar com a família", "obj-familia"]]
  },
  {
    id: "sol-renda-informal", phase: "solucionar", title: "Renda informal / autônomo",
    guidance: "Pergunte como recebe (Pix, extrato, declaração do imposto de renda, MEI). Explique que existem formas de comprovar, e que a análise é do banco.",
    argument: "Autônomo também financia. O caminho é organizar a comprovação de renda da forma que o banco aceita.",
    message: "Quem trabalha por conta própria também consegue analisar financiamento, [Nome]. O segredo é organizar a comprovação da renda. Você tem extratos ou declaração de imposto de renda? Posso te dizer o que costuma ser pedido.",
    options: [["Tem comprovação", TESTAR], ["Não tem como comprovar", "obj-restricao"], ["Outra objeção", OUTRA]]
  },
  {
    id: "sol-renda-imovel-menor", phase: "solucionar", title: "Buscar imóvel compatível com a renda",
    guidance: "Mostre opções de menor valor ou condições diferentes. Reforce o conceito de primeiro imóvel como começo.",
    argument: "Ajustar o imóvel à realidade de hoje é como se começa. A situação pode evoluir e o próximo imóvel vem depois.",
    message: "Então o caminho é achar um imóvel que caiba na sua realidade de hoje, [Nome]. Posso te mostrar opções nessa faixa e você me diz o que acha?",
    options: [["Quer ver as opções", TESTAR], ["Não gostou das opções", "sol-primeiro-imovel"], ["Outra objeção", OUTRA]]
  },

  // -------------------------------------------------------- aprovação baixa
  {
    id: "obj-aprovacao-baixa", entry: true, phase: "objecao", title: "Objeção: “A aprovação saiu baixa”",
    guidance: "Descubra o valor aprovado, em qual banco/programa e há quanto tempo. Entenda o que ele queria comprar em comparação com o aprovado.",
    argument: "O valor aprovado é um ponto de partida: ele pode mudar com entrada, composição de renda, prazo e organização de documentos — sem promessa, sempre conforme a análise.",
    message: "Entendi, [Nome]. Você lembra de quanto foi o valor aprovado e em qual banco? E qual imóvel você estava querendo?",
    options: [["Informou os valores", "sol-aprovacao-alternativas"], ["Não lembra / não sabe", "sol-parcela-simulacao"], ["Já foi reprovado antes", "obj-ja-reprovado"]]
  },
  {
    id: "sol-aprovacao-alternativas", phase: "solucionar", title: "Alternativas para o valor aprovado",
    guidance: "Apresente: imóvel dentro do valor aprovado, aumento de entrada, composição de renda, nova análise após organizar documentos. Nunca prometa que uma nova análise dará mais.",
    argument: "Existem caminhos para rever o cenário: escolher imóvel dentro do que foi aprovado, aumentar a entrada ou compor renda. Vale avaliar cada um.",
    message: "Tem alguns caminhos, [Nome]: buscar imóveis dentro do valor aprovado, reforçar a entrada ou comprar em conjunto. Qual deles você gostaria que eu detalhasse primeiro?",
    options: [["Quer ver imóveis no valor aprovado", "sol-renda-imovel-menor"], ["Quer compor renda", "sol-renda-composicao"], ["Quer reforçar a entrada", "sol-entrada-composta"], ["Outra objeção", OUTRA]]
  },

  // ----------------------------------------------------------------- restrição
  {
    id: "obj-restricao", entry: true, phase: "objecao", title: "Objeção: “Meu nome está com restrição”",
    guidance: "Acolha sem julgar. Descubra o tipo (dívida em aberto, negativado, score baixo, processo) e há quanto tempo. Restrição pede ORGANIZAÇÃO antes do financiamento — direcione para a Blindagem Financeira.",
    argument: "Restrição não é o fim: é um ponto a resolver antes. Com a situação organizada, a análise de crédito tende a ser mais segura para a pessoa.",
    message: "Obrigado por me contar com sinceridade, [Nome]. Isso é mais comum do que parece. Você sabe me dizer se é alguma dívida em aberto, nome negativado ou score baixo? E faz quanto tempo?",
    options: [["Dívida / nome negativado", "sol-blindagem"], ["Score baixo", "sol-blindagem"], ["Não sabe o que tem", "sol-blindagem-consulta"]]
  },
  {
    id: "sol-blindagem", phase: "solucionar", title: "Direcionar para a Blindagem Financeira",
    guidance: "Apresente a Blindagem Financeira como o caminho de organizar a vida financeira ANTES de financiar. Não prometa prazo nem resultado. Explique o processo em linhas gerais e combine o próximo passo.",
    argument: "A Blindagem Financeira organiza a situação do cliente para ele poder buscar o financiamento com mais segurança. É o passo que vem antes do imóvel.",
    message: "Pra esse caso, [Nome], nós temos um trabalho chamado Blindagem Financeira, que ajuda a organizar a sua situação antes de você buscar o financiamento. Posso te explicar como funciona, rapidinho?",
    options: [["Quer entender / topou", TESTAR], ["Quer resolver por conta própria", RETORNO], ["Desconfiou / tem receio", "obj-medo-financiamento"], ["Outra objeção", OUTRA]]
  },
  {
    id: "sol-blindagem-consulta", phase: "solucionar", title: "Descobrir a situação real do CPF",
    guidance: "Oriente o cliente a consultar o próprio CPF em canais oficiais e a trazer o resultado. Só depois direcione.",
    argument: "Não dá pra resolver o que não se conhece. Consultar a própria situação é o primeiro passo — e é gratuito nos canais oficiais.",
    message: "Sem problema, [Nome]. O primeiro passo é saber exatamente como está o seu CPF. Você consegue consultar nos canais oficiais e me mandar o resultado? Aí eu te oriento com base em fatos.",
    options: [["Vai consultar", RETORNO], ["Já mandou o resultado", "sol-blindagem"], ["Prefere não fazer", "obj-pensar"]]
  },

  // ------------------------------------------------------------ não gostou do imóvel
  {
    id: "obj-nao-gostou-imovel", entry: true, phase: "objecao", title: "Objeção: “Não gostei do imóvel”",
    guidance: "Nunca defenda o imóvel. Descubra o que exatamente não agradou: localização, tamanho, padrão, tipo, acabamento, entrega. A resposta muda a próxima opção a mostrar.",
    argument: "Saber o que NÃO agradou é tão valioso quanto saber o que agrada: evita mostrar mais do mesmo.",
    message: "Obrigado por ser sincero, [Nome]. O que exatamente não te agradou nele: localização, tamanho, padrão ou outra coisa? Assim eu procuro algo mais parecido com o que você imagina.",
    options: [["Localização", "sol-nova-opcao"], ["Tamanho / layout", "sol-nova-opcao"], ["Padrão / acabamento", "sol-nova-opcao"], ["Só quer algo melhor", "obj-imovel-melhor"]]
  },
  {
    id: "sol-nova-opcao", phase: "solucionar", title: "Apresentar nova opção alinhada",
    guidance: "Apresente 1 ou 2 opções que corrijam o que ele disse que não gostou. Deixe claro o que cada uma tem de diferente — sem exagerar.",
    argument: "Com o que você me falou, separei opções que corrigem exatamente esse ponto. Vamos olhar juntos.",
    message: "Com o que você me falou, [Nome], separei opções que corrigem exatamente esse ponto. Posso te enviar 2 delas pra você me dizer qual chega mais perto?",
    options: [["Gostou de uma das opções", TESTAR], ["Não gostou de nenhuma", "sol-primeiro-imovel"], ["Achou a parcela alta", "obj-parcela-alta"], ["Outra objeção", OUTRA]]
  },

  // --------------------------------------------------------- quer imóvel melhor
  {
    id: "obj-imovel-melhor", entry: true, phase: "objecao", title: "Objeção: “Quero um imóvel melhor”",
    guidance: "Descubra o que é “melhor” para ele (tamanho, região, padrão) e se o orçamento acompanha. Alinhe a expectativa ao que é possível hoje, sem cortar o sonho.",
    argument: "O imóvel dos sonhos costuma ser um destino, não o primeiro passo. Começar bem organiza o caminho até ele.",
    message: "Entendi, [Nome]. Como seria esse imóvel melhor pra você? Tamanho, região, padrão? Me conta pra eu ver o quanto isso já cabe hoje e o que seria um passo intermediário.",
    options: [["Cabe no orçamento", "sol-nova-opcao"], ["Não cabe hoje", "sol-primeiro-imovel"], ["Quer esperar pra comprar o ideal", "obj-esperar"]]
  },

  // ------------------------------------------------------------ juntar dinheiro
  {
    id: "obj-juntar-dinheiro", entry: true, phase: "objecao", title: "Objeção: “Vou juntar dinheiro primeiro”",
    guidance: "Descubra a meta (quanto), o prazo e quanto consegue guardar por mês. Compare com o custo de esperar (aluguel pago nesse período). Não prometa que o preço vai subir.",
    argument: "Juntar é uma boa ideia — e dá pra fazer os dois: simular hoje mostra quanto falta e em quanto tempo. Os valores e condições podem mudar (para mais ou para menos), então informação é o que protege.",
    message: "Juntar dinheiro é uma ótima decisão, [Nome]. Você tem uma meta de quanto quer juntar e em quanto tempo? Se a gente simular hoje, você descobre exatamente quanto falta — e aí o plano fica com números reais.",
    options: [["Topa simular pra saber quanto falta", "sol-parcela-simulacao"], ["Já tem meta clara", "sol-juntar-plano"], ["Quer esperar mesmo assim", "obj-esperar"]]
  },
  {
    id: "sol-juntar-plano", phase: "solucionar", title: "Plano com números reais",
    guidance: "Monte junto: meta, prazo, parcela do plano. Defina uma data para reavaliar. Fica registrado no retorno.",
    argument: "Um plano com número e data vira compromisso. Sem isso, “vou juntar” vira “vou deixar pra depois”.",
    message: "Então vamos fazer assim, [Nome]: eu simulo com a sua meta e a gente marca uma data pra reavaliar como você está. Assim você não perde o fio. Pode ser?",
    options: [["Combinou o plano", RETORNO], ["Não quis marcar data", "obj-esperar"]]
  },

  // ----------------------------------------------------------------- quer esperar
  {
    id: "obj-esperar", entry: true, phase: "objecao", title: "Objeção: “Quero esperar”",
    guidance: "“Esperar” quase nunca é o motivo real. Descubra o que ele está esperando: dinheiro, juros, uma decisão da família, um emprego, medo. Faça UMA pergunta por vez.",
    argument: "Quando sabemos o que ele está esperando, dá pra tratar isso hoje ou marcar uma data concreta para voltar ao assunto.",
    message: "Entendi, [Nome]. Sem pressão nenhuma. Só pra eu entender: você está esperando por algo específico — alguma situação, valor ou decisão?",
    options: [["Esperando juntar dinheiro", "obj-juntar-dinheiro"], ["Esperando juros baixarem", "obj-juros"], ["Esperando decisão da família", "obj-familia"], ["Está inseguro", "obj-medo-financiamento"], ["Não sabe explicar", "sol-esperar-data"], ["Outro motivo", OUTRA]]
  },
  {
    id: "sol-esperar-data", phase: "solucionar", title: "Transformar “esperar” em data",
    guidance: "Se ele não tem motivo específico, proponha uma data. Esperar sem data é perder o cliente.",
    argument: "Esperar é uma decisão válida — e uma data marcada mantém a porta aberta sem pressão.",
    message: "Tudo bem, [Nome]. Que tal a gente marcar uma data pra conversar de novo, só pra ver como você está? Pode ser daqui a alguns dias — qual seria melhor pra você?",
    options: [["Combinou uma data", RETORNO], ["Não quis marcar", "obj-nao-responde"]]
  },

  // ----------------------------------------------------------------------- juros
  {
    id: "obj-juros", entry: true, phase: "objecao", title: "Objeção: “Os juros são altos”",
    guidance: "Descubra de onde vem a percepção (taxa que ouviu, comparação, notícia). Não dispute números que você não confirmou; explique a composição do custo e a possibilidade de rever no futuro, sem prometer.",
    argument: "O que pesa no bolso é a parcela final e o custo total, e isso depende de prazo, entrada e renda. Além disso, as condições do financiamento podem ser revistas no futuro conforme o mercado e o contrato — sem garantia.",
    message: "Entendo a preocupação, [Nome]. Você viu alguma taxa específica ou ouviu isso de alguém? Posso te mostrar como fica o custo real na parcela, com os números da sua simulação.",
    options: [["Quer ver o custo real", "sol-parcela-simulacao"], ["Ainda acha caro", "sol-juros-alternativas"], ["Prefere esperar os juros", "obj-esperar"]]
  },
  {
    id: "sol-juros-alternativas", phase: "solucionar", title: "Olhar para a parcela e o custo total",
    guidance: "Mostre prazo x parcela e, se ele tiver recurso, o efeito de uma entrada maior. Explique que é possível amortizar o saldo depois, conforme o contrato.",
    argument: "Uma entrada maior ou um prazo diferente muda a parcela. Depois do contrato, ainda é possível amortizar o saldo, conforme as regras.",
    message: "Podemos olhar a parcela por outros ângulos, [Nome]: prazo, entrada e, depois, a possibilidade de amortizar o saldo, conforme o contrato. Quer que eu monte dois cenários pra você comparar?",
    options: [["Quer comparar cenários", TESTAR], ["Continua inseguro", "obj-medo-financiamento"], ["Outra objeção", OUTRA]]
  },

  // ----------------------------------------------------------- medo de financiamento
  {
    id: "obj-medo-financiamento", entry: true, phase: "objecao", title: "Objeção: “Tenho medo de financiar”",
    guidance: "Medo pede escuta, não argumento. Descubra a causa: perder o emprego, ficar devendo muito tempo, já ter visto alguém passar por problema, não entender o contrato.",
    argument: "O medo geralmente vem de falta de informação. Quando o contrato e os números são explicados com calma, a decisão fica mais segura.",
    message: "É natural ter esse cuidado, [Nome], financiar é uma decisão grande. O que mais te preocupa: ficar com parcela pesada, perder a renda, ou não entender o contrato? Vou te explicar cada ponto com calma.",
    options: [["Medo de não conseguir pagar", "sol-medo-pagar"], ["Não entende o contrato", "sol-medo-contrato"], ["Já viu alguém passar problema", "sol-medo-pagar"]]
  },
  {
    id: "sol-medo-pagar", phase: "solucionar", title: "Parcela cabendo com folga",
    guidance: "Trabalhe o conforto: parcela dentro de uma parte da renda, reserva de segurança, seguros do contrato. Não diga “não tem risco”: diga que o que se busca é uma parcela que caiba com folga.",
    argument: "O objetivo é uma parcela que caiba com folga, e não a maior parcela possível. O contrato tem seguros previstos para situações como invalidez e falecimento, conforme as regras.",
    message: "A ideia, [Nome], é escolher uma parcela que caiba com folga na sua realidade, e não a maior possível. Quer que eu monte um cenário mais confortável e explique como o contrato protege em alguns imprevistos?",
    options: [["Quer ver o cenário", TESTAR], ["Ainda com medo", "obj-pensar"], ["Outra objeção", OUTRA]]
  },
  {
    id: "sol-medo-contrato", phase: "solucionar", title: "Explicar o contrato com calma",
    guidance: "Explique em partes: valor financiado, prazo, parcela, seguros, o que acontece na quitação. Convide para tirar dúvidas antes de assinar qualquer coisa.",
    argument: "Ninguém deve assinar o que não entende. Explicar antes é parte do nosso trabalho.",
    message: "Vou te explicar por partes, [Nome], e você me interrompe quando quiser: quanto se financia, em quanto tempo, quanto é a parcela e o que está incluso. Podemos fazer isso agora ou em outro horário melhor pra você.",
    options: [["Quer agora", TESTAR], ["Prefere outro horário", RETORNO]]
  },

  // ----------------------------------------------------------------- precisa pensar
  {
    id: "obj-pensar", entry: true, phase: "objecao", title: "Objeção: “Preciso pensar”",
    guidance: "“Preciso pensar” tem um motivo por trás. Pergunte com leveza: “o que você quer pensar?”. Se ele revelar o motivo, mude para a objeção correspondente. Se não revelar, feche um retorno com data.",
    argument: "Pensar é saudável — e você pode ajudar a organizar o pensamento: o que falta pra decidir?",
    message: "Claro, [Nome], é uma decisão importante. Pra eu te ajudar a pensar: o que, especificamente, você quer avaliar melhor? Assim eu já te trago essas informações.",
    options: [["Revelou o motivo (parcela)", "obj-parcela-alta"], ["Revelou o motivo (entrada)", "obj-sem-entrada"], ["Precisa falar com a família", "obj-familia"], ["Tem medo", "obj-medo-financiamento"], ["Não soube dizer", RETORNO]]
  },

  // ------------------------------------------------------- marido / esposa / família
  {
    id: "obj-familia", entry: true, phase: "objecao", title: "Objeção: “Preciso falar com marido/esposa/família”",
    guidance: "Respeite e INCLUA a outra pessoa: proponha uma conversa com os dois. Quem decide junto precisa ouvir a informação de quem entende, não de segunda mão.",
    argument: "Quando a decisão é dos dois, é melhor os dois receberem a mesma informação ao mesmo tempo. Isso evita ruído.",
    message: "Faz todo sentido, [Nome]! Que tal a gente fazer uma conversa rápida com vocês dois? Assim a informação chega completa e ninguém fica com dúvida. Qual horário seria bom pros dois?",
    options: [["Combinou conversa com os dois", RETORNO], ["Vai conversar antes sozinho(a)", RETORNO], ["Não quer incluir o outro", "obj-pensar"]]
  },

  // ------------------------------------------------------------------ já foi reprovado
  {
    id: "obj-ja-reprovado", entry: true, phase: "objecao", title: "Objeção: “Já fui reprovado”",
    guidance: "Descubra QUANDO, em qual banco, e o MOTIVO informado (restrição, renda, score, documentação). A situação pode ter mudado. Nunca prometa que agora aprova.",
    argument: "Uma reprovação é um retrato de um momento. Entender o motivo mostra o que pode ser organizado antes de uma nova análise.",
    message: "Entendo, [Nome], isso pode desanimar. Você lembra quando foi e qual foi o motivo que o banco informou? Com isso eu consigo ver o que pode ter mudado ou o que dá pra organizar antes de uma nova análise.",
    options: [["Foi por restrição", "sol-blindagem"], ["Foi por renda", "obj-renda-baixa"], ["Foi por documentação", "sol-doc-organizar"], ["Não sabe o motivo", "sol-parcela-simulacao"]]
  },
  {
    id: "sol-doc-organizar", phase: "solucionar", title: "Organizar a documentação antes de nova análise",
    guidance: "Reprovação por documento é a mais “consertável”: liste o que precisa, ajude a organizar. Sem promessa de aprovação.",
    argument: "Documento incompleto ou desatualizado derruba análise. Organizar direito antes evita repetir a experiência.",
    message: "Quando o motivo é documentação, [Nome], dá pra organizar tudo direitinho antes de tentar de novo. Posso te passar a lista do que precisa e te ajudar a conferir cada item?",
    options: [["Quer a lista", TESTAR], ["Outra objeção", OUTRA]]
  },

  // ------------------------------------------------------------------ prefere aluguel
  {
    id: "obj-aluguel", entry: true, phase: "objecao", title: "Objeção: “Prefiro continuar no aluguel”",
    guidance: "Não ataque o aluguel. Descubra por que prefere (flexibilidade, medo de compromisso, valor menor, não vê como possível). Compare parcela x aluguel COM números dele.",
    argument: "O aluguel dá flexibilidade, mas o valor pago não vira patrimônio. A parcela de um financiamento vai amortizando algo que é seu. Vale comparar com números reais.",
    message: "Respeito, [Nome]. O que você mais valoriza no aluguel hoje: a flexibilidade, o valor ou a tranquilidade? Se você me disser quanto paga, comparo com uma simulação pra você ver os dois lados.",
    options: [["Quer comparar com números", "sol-parcela-simulacao"], ["Valoriza a flexibilidade", "sol-aluguel-patrimonio"], ["Acha que não consegue financiar", "obj-medo-financiamento"]]
  },
  {
    id: "sol-aluguel-patrimonio", phase: "solucionar", title: "Aluguel x construção de patrimônio",
    guidance: "Mostre o conceito sem julgar: cada aluguel pago é um valor que não volta; cada parcela paga amortiza um patrimônio. Sem prometer valorização.",
    argument: "A diferença está no destino do dinheiro: aluguel é custo; parcela de financiamento amortiza um imóvel que passa a ser seu.",
    message: "Uma diferença que muita gente só percebe depois, [Nome]: o aluguel é um valor que você paga e não volta, e a parcela amortiza um imóvel que passa a ser seu. Se isso fizer sentido, eu te mostro como fica no seu caso.",
    options: [["Fez sentido", TESTAR], ["Ainda prefere aluguel", RETORNO], ["Outra objeção", OUTRA]]
  },

  // ------------------------------------------------------------------ outro corretor
  {
    id: "obj-outro-corretor", entry: true, phase: "objecao", title: "Situação: “Já estou com outro corretor”",
    guidance: "Respeito total: nunca fale mal de colega. Descubra em que ponto está o processo. Se ele já comprou, parabenize. Se está parado, ofereça ajuda como segunda opinião, sem pressão.",
    argument: "O cliente decide com quem quer ser atendido. Sua atitude profissional constrói confiança para o futuro, mesmo que não seja a venda agora.",
    message: "Que bom que você está sendo atendido, [Nome]! Deu tudo certo com a compra ou o processo ainda está andando? Se precisar de uma segunda opinião em qualquer etapa, fico feliz em ajudar.",
    options: [["Já comprou", "obj-outro-comprou"], ["Processo andando bem", RETORNO], ["Parado / insatisfeito", "sol-segunda-opiniao"]]
  },
  {
    id: "obj-outro-comprou", phase: "encerramento", title: "Comprou com outro corretor",
    guidance: "Parabenize e encerre bem. Peça que lembre de você para indicações. Registre o status no CRM e programe um contato de relacionamento futuro.",
    argument: "Uma despedida educada mantém a porta aberta para indicações.",
    message: "Que ótima notícia, [Nome]! Parabéns pela conquista! Se um dia precisar de algo ou conhecer alguém procurando imóvel, pode contar comigo.",
    options: [["Registrar e definir contato futuro", RETORNO]]
  },
  {
    id: "sol-segunda-opiniao", phase: "solucionar", title: "Oferecer segunda opinião sem pressão",
    guidance: "Pergunte onde travou e ofereça ajuda pontual. Não force troca de corretor.",
    argument: "Uma segunda visão às vezes destrava o processo — e a decisão continua com o cliente.",
    message: "Se quiser, [Nome], posso olhar a sua situação como uma segunda opinião, sem compromisso. Onde exatamente o processo travou?",
    options: [["Aceitou ajuda", TESTAR], ["Prefere seguir como está", RETORNO]]
  },

  // ------------------------------------------------------------------ não responde
  {
    id: "obj-nao-responde", entry: true, phase: "objecao", title: "Situação: o cliente não responde",
    guidance: "Não insista com a mesma frase. Varie o ângulo: 1ª tentativa = pergunta simples; 2ª = algo de valor; 3ª = despedida cordial com data. Use sempre um horário/dia diferente.",
    argument: "Silêncio quase nunca é “não”: costuma ser falta de tempo ou de clareza sobre o que responder. Mensagens curtas, de pergunta fácil, funcionam melhor.",
    message: "Oi, [Nome]! Passando só pra saber se você ainda tem interesse em conversar sobre o imóvel. Uma resposta rápida já me ajuda: ainda faz sentido pra você?",
    options: [["Respondeu", "obj-nao-responde-voltou"], ["Continua sem responder (2ª tentativa)", "sol-nao-responde-valor"]]
  },
  {
    id: "obj-nao-responde-voltou", phase: "solucionar", title: "Voltou a responder",
    guidance: "Não cobre o silêncio. Agradeça e retome do ponto em que parou.",
    argument: "Retomar com leveza faz o cliente se sentir à vontade para continuar.",
    message: "Que bom falar com você, [Nome]! Vamos retomar de onde paramos? Me diz como está a sua situação hoje.",
    options: [["Retomou o atendimento", VOLTAR]]
  },
  {
    id: "sol-nao-responde-valor", phase: "solucionar", title: "2ª tentativa: algo de valor",
    guidance: "Mande algo útil (uma opção nova, uma condição, uma dica) em vez de cobrar resposta.",
    argument: "Conteúdo útil reabre a conversa sem pressão.",
    message: "[Nome], separei uma opção que pode combinar com o que você buscava. Quer que eu te envie os detalhes?",
    options: [["Respondeu", "obj-nao-responde-voltou"], ["Ainda sem resposta (3ª tentativa)", "sol-nao-responde-despedida"]]
  },
  {
    id: "sol-nao-responde-despedida", phase: "solucionar", title: "3ª tentativa: despedida cordial com data",
    guidance: "Última tentativa da sequência: cordial, sem culpa, deixando a porta aberta E marcando uma data para você voltar a tentar.",
    argument: "Uma despedida educada aumenta as chances de resposta futura.",
    message: "[Nome], entendo que a rotina é corrida. Vou dar uma pausa por agora e volto a falar com você na próxima semana, tudo bem? Se o assunto voltar a fazer sentido antes, é só responder aqui.",
    options: [["Respondeu", "obj-nao-responde-voltou"], ["Sem resposta", RETORNO]]
  },

  // ------------------------------------------------------------------ outras
  {
    id: OUTRA, entry: true, phase: "objecao", title: "Outra objeção (não listada)",
    guidance: "Deixe o cliente falar. Escreva com as palavras dele o que o preocupa e tente enquadrar em uma das objeções conhecidas. Se for nova, anote para a gestão incluir no banco.",
    argument: "Qualquer objeção é um sinal de que ainda existe interesse: quem não tem interesse não se dá ao trabalho de explicar.",
    message: "Obrigado por me contar, [Nome]. Me explica um pouco mais o que te preocupa? Quero entender direitinho pra te ajudar da melhor forma.",
    options: [["É sobre parcela", "obj-parcela-alta"], ["É sobre entrada", "obj-sem-entrada"], ["É sobre renda", "obj-renda-baixa"], ["É sobre restrição", "obj-restricao"], ["É sobre o imóvel", "obj-nao-gostou-imovel"], ["É sobre medo / insegurança", "obj-medo-financiamento"], ["É sobre esperar", "obj-esperar"], ["Nenhuma dessas — registrar e definir retorno", RETORNO]]
  }
];
