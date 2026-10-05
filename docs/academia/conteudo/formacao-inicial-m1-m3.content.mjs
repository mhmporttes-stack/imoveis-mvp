// Conteúdo real da Formação Inicial — Módulos 1, 2 e 3. Texto puro (a interface escapa tudo).
const P = (text) => ({ type: "paragraph", text });
const H = (text) => ({ type: "heading", text });
const C = (text) => ({ type: "callout", text });
const L = (...items) => ({ type: "list", items });
const tip = (title, text) => ({ kind: "tip", config: { title, text } });
const example = (title, text) => ({ kind: "example", config: { title, text } });
const check = (title, ...items) => ({ kind: "checklist", config: { title, items } });

export const MODULES = [
  {
    key: "m1",
    title: "O que faz um bom corretor",
    summary: "Mentalidade antes de técnica: atitude, esforço, empatia, ambição e solução de problemas.",
    exam: true,
    lessons: [
      {
        title: "Conhecimento se adquire. Atitude vem primeiro.",
        minutes: 4,
        blocks: [
          P("Ninguém começa sabendo vender imóvel. Nem o corretor mais experiente da sua cidade. Todo mundo já passou pela primeira simulação, pela primeira objeção e pelo medo de chamar o primeiro cliente."),
          H("O que se aprende e o que se escolhe"),
          P("Conhecimento técnico se aprende: financiamento, documentação, atendimento, funil. É para isso que existem a Academia, o time e a prática. Já a atitude você escolhe todos os dias: estudar, perguntar, tentar de novo."),
          C("Um bom corretor não começa sabendo. Ele começa querendo."),
          H("Falta de experiência não é desculpa"),
          P("“Sou novo” explica um erro. Não explica ficar parado. O cliente não precisa de alguém que já viu tudo; precisa de alguém que se prepara, pergunta quando não sabe e volta com a resposta certa."),
          L("Curiosidade: pergunta o porquê, não só o como.", "Disciplina: estuda um pouco todo dia, mesmo nos dias corridos.", "Aprender fazendo: atende, erra pequeno, ajusta e repete.")
        ],
        activities: [
          example("Na prática", "O cliente faz uma pergunta que você ainda não sabe responder. Resposta fraca: inventar ou enrolar. Resposta de quem aprende: “Boa pergunta. Deixa eu confirmar para te passar certo e te retorno hoje ainda.” Depois, descubra e volte de verdade — é assim que o cliente passa a confiar em você."),
          check("Para fazer hoje", "Anotar uma dúvida técnica que você tem agora.", "Perguntar a alguém do time ou procurar a resposta.", "Usar o que aprendeu no próximo atendimento.")
        ]
      },
      {
        title: "Esforço supera talento",
        minutes: 4,
        blocks: [
          P("No futebol, quem chuta mais vezes ao gol tem mais chances de marcar — e, com o tempo, aprende a finalizar melhor. Ninguém vira bom finalizador treinando só passe."),
          P("Na corretagem é igual. Cada experiência real vale mais do que muita teoria solta:"),
          L("Prospecção: cada abordagem ensina como o cliente reage.", "Atendimento: cada conversa mostra o que ele precisa de verdade.", "Simulações: cada uma treina seu olhar para renda, entrada e parcela.", "Visitas: onde o cliente mostra o que gostou e o que o incomoda.", "Objeções: cada uma é uma aula de graça.", "Follow-ups: quem acompanha aprende por que o cliente some ou avança."),
          H("Quantidade sozinha não basta"),
          P("Fazer 30 vezes a mesma coisa do mesmo jeito é só repetir. O que melhora o resultado é prática, análise e ajuste: o que funcionou? Onde o cliente parou de responder? O que eu faria diferente?"),
          C("Mais chutes, mais atenção ao resultado de cada chute.")
        ],
        activities: [
          example("Na prática", "Depois de um atendimento que não avançou, em vez de pensar “não deu”, responda por escrito: 1) Em que momento a conversa esfriou? 2) O que eu perguntei e o que deixei de perguntar? 3) O que vou fazer diferente no próximo?"),
          tip("Dica", "Guarde as respostas dessas três perguntas por uma semana. Você vai ver padrões que ninguém precisa te contar.")
        ]
      },
      {
        title: "Amor: tenha empatia pela conquista do cliente",
        minutes: 4,
        blocks: [
          P("Para muita gente, o primeiro imóvel é a maior compra da vida. Quem chega até você pode estar ao mesmo tempo feliz, ansioso, com medo, inseguro e cheio de expectativa."),
          P("Por isso o corretor não administra só documentos e imóveis. Ele também conduz pessoas durante um processo que mexe com o emocional."),
          H("Empatia não é concordar com tudo"),
          P("Empatia é entender o momento do cliente e ajudá-lo a avançar com segurança. Se ele disser “esse financiamento é um absurdo”, concordar e desistir junto não ajuda. Reconhecer a preocupação e olhar os números com ele, sim."),
          L("Reconheça o sentimento: “é normal ficar inseguro, é uma decisão grande”.", "Explique de novo, de outro jeito, sem fazer o cliente se sentir bobo.", "Diga o que acontece em cada etapa e quando ele terá a próxima resposta.")
        ],
        activities: [
          example("Cliente ansioso", "Cliente: “E se a Caixa não aprovar? Já expliquei pra minha esposa que vai dar certo…” Corretor com empatia: “Entendo a ansiedade, é muito importante pra vocês. Eu não posso garantir a aprovação, mas posso te mostrar exatamente o que vai ser analisado e o que a gente já deixa organizado para dar o melhor caminho.” Honesto e acolhedor, sem prometer o que não controla.")
        ]
      },
      {
        title: "Ambição: sua profissão também realiza os seus sonhos",
        minutes: 3,
        blocks: [
          P("Ter ambição é algo positivo. A corretagem pode gerar renda e crescimento profissional, e o esforço e o tempo que você investe podem virar recursos para os seus planos."),
          L("Comprar a sua casa.", "Comprar um carro.", "Viajar.", "Dar mais conforto à sua família.", "Investir e construir independência financeira."),
          C("Enquanto você trabalha para realizar o sonho dos seus clientes, pode construir recursos para realizar os seus próprios sonhos."),
          H("Ambição saudável"),
          P("Ambição saudável anda junto com cuidado com o cliente: você cresce quando ajuda alguém a conquistar o imóvel, e não quando empurra uma venda. E não é promessa de enriquecimento: resultado depende de estudo, esforço e constância ao longo do tempo.")
        ],
        activities: [
          check("Para refletir", "Qual é o seu principal objetivo pessoal com essa profissão?", "O que você precisa fazer toda semana para chegar mais perto dele?", "Como esse objetivo ajuda você a cuidar melhor do cliente?")
        ]
      },
      {
        title: "O corretor é um solucionador de problemas",
        minutes: 4,
        blocks: [
          P("No primeiro imóvel, o cliente chega com obstáculos que ele nem sempre sabe nomear:"),
          L("Falta de entrada.", "Documentação incompleta.", "Renda baixa ou renda informal.", "Insegurança e dificuldade para entender financiamento.", "Desorganização financeira.", "Imóvel que não cabe no poder de compra."),
          H("O papel do corretor"),
          P("Identificar o obstáculo verdadeiro e encontrar caminhos legítimos para resolvê-lo. Às vezes o problema que o cliente conta não é o problema que o trava."),
          L("Não prometa o impossível.", "Não esconda problemas.", "Resolva o que pode ser resolvido.", "Explique com clareza o que não pode, e o que o cliente pode fazer a respeito.")
        ],
        activities: [
          example("Na prática", "Cliente: “Não tenho entrada e meu trabalho é informal, acho que não dá.” Antes de responder “dá” ou “não dá”, descubra: quanto ele tem guardado? Tem FGTS? Como comprova a renda? Alguém pode compor renda com ele? Só depois você sabe qual é o obstáculo real e que caminho existe.")
        ]
      },
      {
        title: "Você não vende só um imóvel. Você conduz uma conquista.",
        minutes: 3,
        blocks: [
          P("Entre “quero comprar meu imóvel” e “consegui comprar meu imóvel” existe uma jornada. O corretor acompanha o cliente nessa jornada inteira."),
          L("Esforço: faz mais, aprende com cada tentativa.", "Empatia: entende o momento do cliente e o ajuda a avançar com segurança.", "Ambição: constrói a própria carreira cuidando bem de quem atende.", "Conhecimento: estuda, treina e vai ficando cada vez mais preparado.", "Solução de problemas: resolve o que dá e explica com clareza o que não dá."),
          C("Quem chega aqui para vender só um imóvel vai pouco longe. Quem chega para conduzir uma conquista vai muito mais.")
        ],
        activities: [
          check("Fechando o módulo", "Reler as cinco ideias acima e escolher a que você mais precisa melhorar.", "Definir uma ação concreta para essa semana.", "Fazer a prova do Módulo 1 para liberar o Módulo 2.")
        ]
      }
    ],
    questions: [
      {
        topic: "Atitude e conhecimento", s: "Na sua primeira semana, você vê um colega com muitos anos de casa fechar uma negociação difícil e pensa que nunca vai chegar nesse nível. Qual postura combina com o que a Academia ensina?",
        o: ["Esperar dominar o conteúdo todo para só então começar a atender clientes.", "Atender apenas casos simples até se sentir seguro, evitando qualquer situação que exija perguntar.", "Usar o colega como referência: observar o que ele faz, perguntar o porquê e aplicar já nos próximos atendimentos.", "Copiar o roteiro dele sem adaptar, já que ele sabe o que funciona."], c: 2,
        e: "Conhecimento se adquire com estudo e prática. Observar, perguntar e aplicar acelera o aprendizado; esperar “estar pronto” ou fugir de casos novos só atrasa."
      },
      {
        topic: "Atitude e conhecimento", s: "Um cliente faz uma pergunta técnica que você ainda não sabe responder. O que faz mais sentido?",
        o: ["Responder com o que lembra, para não perder a confiança dele.", "Dizer que vai confirmar para passar certo e combinar quando retorna — e retornar de verdade.", "Passar o cliente para outro colega, já que o assunto não é com você.", "Mudar de assunto e voltar ao tema só se ele insistir."], c: 1,
        e: "Admitir que vai confirmar e cumprir o prazo gera mais confiança do que uma resposta chutada, que pode prejudicar o cliente e a sua credibilidade."
      },
      {
        topic: "Esforço e prática", s: "Há duas semanas você faz cerca de 15 abordagens por dia e poucas conversas viraram atendimento. O que é mais útil fazer?",
        o: ["Dobrar o número de abordagens, sem mudar nada, porque volume resolve.", "Manter o ritmo e revisar as conversas: onde o cliente parou de responder, o que perguntou e o que pode melhorar na próxima.", "Reduzir o ritmo, já que o resultado não apareceu.", "Esperar clientes que cheguem prontos para comprar, sem precisar abordar."], c: 1,
        e: "Quantidade sem aprendizado não basta. O que melhora o resultado é prática somada a análise e ajuste do que foi feito."
      },
      {
        topic: "Esforço e prática", s: "Você fez uma visita, o cliente disse “foi legal” e sumiu. Qual leitura transforma isso em aprendizado?",
        o: ["O cliente não tem interesse: o melhor é esquecer e partir para o próximo.", "Foi o mercado: não há o que melhorar.", "Mandar a mesma mensagem todos os dias até ele responder.", "Rever a visita: que objeção ficou sem resposta, o que foi o último combinado e o que posso perguntar diferente no próximo follow-up."], c: 3,
        e: "Cada follow-up e cada visita ensinam algo. Analisar o que ficou em aberto melhora o próximo contato e os próximos atendimentos."
      },
      {
        topic: "Empatia", s: "Pela terceira vez, um cliente de primeiro imóvel pergunta se vai mesmo ser aprovado. Você já explicou duas vezes. Qual é a melhor condução?",
        o: ["Responder de forma curta, “já expliquei”, para ele aprender a prestar atenção.", "Garantir que vai ser aprovado para acalmá-lo de uma vez.", "Mandar um áudio longo com tudo e esperar que ele não pergunte de novo.", "Reconhecer a ansiedade, explicar de outro jeito e dizer o que acontece em cada etapa e quando ele terá a resposta."], c: 3,
        e: "Ansiedade é normal em quem está fazendo a maior compra da vida. Acolher, explicar de outro modo e dar previsibilidade ajuda sem prometer o que você não controla."
      },
      {
        topic: "Empatia", s: "O cliente diz: “esses juros são um absurdo, não vou pagar tanto”. Qual resposta mostra empatia, e não apenas concordância?",
        o: ["“Verdade, é um absurdo mesmo. Talvez nem valha a pena seguir.”", "“Entendo a preocupação com o valor. Vamos olhar juntos quanto fica a parcela e se cabe no seu orçamento antes de decidir.”", "“Juros são assim, é a regra.”", "“Não se preocupe, depois você se acostuma.”"], c: 1,
        e: "Empatia é reconhecer o sentimento e ajudar o cliente a avançar com dados. Concordar em tudo ou diminuir a preocupação não o ajuda a decidir bem."
      },
      {
        topic: "Ambição", s: "Marina diz que quer crescer na corretagem para comprar um carro e dar mais conforto à família. Como isso se encaixa no que a Academia ensina?",
        o: ["É um problema: quem pensa em dinheiro deixa o cliente em segundo plano.", "É uma ambição saudável, que cresce na medida em que ela ajuda clientes a conquistar o imóvel e se prepara para isso.", "Só vale ter esse objetivo depois de alguns anos de experiência.", "Se o objetivo é financeiro, a técnica de atendimento fica em segundo plano."], c: 1,
        e: "Ambição é positiva quando anda junto com cuidado e preparo. Quanto melhor ela atende, mais seu esforço pode virar recursos para os próprios sonhos."
      },
      {
        topic: "Ambição", s: "Um amigo pergunta se vale a pena virar corretor. Qual resposta é coerente com o que você aprendeu?",
        o: ["“Sim, em poucos meses você já fica rico.”", "“Não, só funciona para quem já tem muitos contatos.”", "“Depende só de sorte; esforço muda pouco.”", "“Pode render bons resultados e realizar sonhos, mas depende de estudo, esforço e constância — não é atalho nem garantia.”"], c: 3,
        e: "A corretagem tem potencial de renda e crescimento, mas a aula é clara: não é promessa de enriquecimento. O resultado vem de estudo, esforço e constância."
      },
      {
        topic: "Solução de problemas", s: "O cliente quer um imóvel bem acima do que a renda dele sustenta e diz que “dá um jeito”. Qual é a melhor conduta?",
        o: ["Dizer que a Caixa costuma liberar mais e seguir com a proposta.", "Entender o que ele quer resolver, mostrar na simulação o que cabe hoje e apresentar caminhos legítimos (outro imóvel, composição de renda, juntar entrada), explicando com clareza o que não é possível.", "Dizer que não é possível e encerrar o atendimento.", "Mostrar só imóveis acima do poder de compra para motivá-lo a conseguir mais renda."], c: 1,
        e: "O papel do corretor é resolver o que pode ser resolvido e explicar com clareza o que não pode. Não se promete aprovação nem se encerra o atendimento sem mostrar caminhos."
      },
      {
        topic: "Solução de problemas", s: "Um cliente diz: “não tenho entrada e meu trabalho é informal, acho que não dá”. Qual é a primeira ação do corretor?",
        o: ["Dizer que sem entrada e com renda informal não existe possibilidade.", "Garantir que dá para resolver, sem conferir nada.", "Descobrir o obstáculo real: quanto ele tem de entrada, como comprova a renda e se há quem possa compor renda.", "Pedir que ele volte quando tiver tudo organizado."], c: 2,
        e: "Antes de dizer “dá” ou “não dá”, é preciso identificar o obstáculo verdadeiro. Só então se aponta o caminho possível, sem prometer o impossível."
      }
    ]
  },
  {
    key: "m2",
    title: "Condução de atendimento e técnicas de venda",
    summary: "Conduzir o cliente com clareza, sem pressionar: objeções, dor, perguntas direcionadas e próximo passo.",
    exam: true,
    lessons: [
      {
        title: "Nunca quebre uma objeção. Contorne-a.",
        minutes: 4,
        blocks: [
          P("Quando o cliente apresenta uma objeção, a reação automática é defender: discutir, convencer, responder na hora. Isso costuma piorar a conversa."),
          H("Primeiro, entender"),
          P("Não tente “quebrar” a objeção. Descubra o que existe por trás dela e trabalhe a objeção a partir disso."),
          L("Não discuta.", "Não invalide o que o cliente sente.", "Não responda de forma automática.", "Pergunte antes de explicar."),
          H("Exemplo: “Não gostei da localização”"),
          P("Defender o bairro na hora (“mas aqui está valorizando muito”) pode não ter nada a ver com o que incomoda. Pergunte: “O que exatamente na localização não te agradou?” Pode ser distância, segurança, trabalho, família, escola, transporte ou a imagem que ele tem do bairro."),
          C("Só depois de entender a causa dá para trabalhar a objeção do jeito certo.")
        ],
        activities: [
          example("Na prática", "Cliente: “Não gostei da localização.”\nResposta que defende: “Mas aqui está valorizando muito!”\nResposta que investiga: “O que exatamente na localização não te agradou?”\nSe ele responder “fica longe do trabalho da minha esposa”, você agora conversa sobre deslocamento, e não sobre valorização.")
        ]
      },
      {
        title: "Procure a objeção",
        minutes: 4,
        blocks: [
          P("Não tenha medo de descobrir por que o cliente não compraria. Uma objeção descoberta pode ser trabalhada. Uma objeção escondida pode simplesmente fazer o cliente desaparecer."),
          H("Uma pergunta melhor depois da visita"),
          P("Em vez de só perguntar “o que você achou?”, em certas situações pergunte: “Se você tivesse que escolher algum ponto desse imóvel que não gostou, qual seria?” A pergunta abre espaço para a resposta sincera."),
          C("Não tenha medo da objeção. Procure por ela."),
          H("O caminho"),
          L("Descobrir a objeção.", "Entender a causa.", "Avaliar se pode ser resolvida.", "Contextualizar a realidade.", "Apresentar alternativas.", "Definir o próximo passo.")
        ],
        activities: [
          tip("Dica", "Pergunte com curiosidade, não com defesa. Tom calmo, sem pressa: o cliente precisa sentir que pode ser sincero com você."),
          check("Para treinar", "Escolher o próximo atendimento com visita.", "Preparar a pergunta do ponto que ele menos gostou.", "Anotar a resposta e qual alternativa você poderia apresentar.")
        ]
      },
      {
        title: "Encontre a dor antes da solução",
        minutes: 4,
        blocks: [
          P("Antes de apresentar imóvel ou condição, entenda o que realmente incomoda o cliente. A solução ganha força quando está ligada a algo que importa para aquela pessoa."),
          P("Dores comuns de quem busca o primeiro imóvel:"),
          L("Pagar aluguel todo mês.", "Morar com familiares.", "Falta de espaço.", "Casamento ou chegada de um filho.", "Distância do trabalho.", "Desejo de ter patrimônio.", "Insegurança financeira."),
          H("Não presuma. Pergunte e ouça."),
          P("Duas pessoas que dizem “quero sair do aluguel” podem ter dores diferentes: uma quer previsibilidade, a outra quer espaço para um filho. A mesma casa não resolve igual para as duas.")
        ],
        activities: [
          example("Perguntas que ajudam", "• “O que está te fazendo pensar em comprar agora?”\n• “O que mais te incomoda na situação de hoje?”\n• “Se der certo, o que muda na sua vida?”\nOuça a resposta inteira antes de falar de imóvel."),
          check("Para treinar", "Fazer ao menos duas dessas perguntas nos próximos atendimentos.", "Repetir com suas palavras o que o cliente disse, para confirmar que entendeu.")
        ]
      },
      {
        title: "O corretor conduz o atendimento",
        minutes: 4,
        blocks: [
          P("Conduzir é facilitar a próxima decisão, com perguntas que já pressupõem uma escolha entre opções reais."),
          P("Um exemplo simples, fora do imóvel:"),
          L("Em vez de “você aceita água?”", "pergunte “você prefere água com gás ou sem gás?”"),
          H("Aplicação no imóvel"),
          P("Quando o cliente já demonstrou interesse, em vez de “quer conhecer o imóvel?”, pergunte: “Para você é melhor conhecer durante a semana ou no sábado?” E depois: “De manhã ou à tarde?”"),
          C("Pressionar é tentar fazer o cliente tomar a decisão que você quer. Conduzir é ajudá-lo a chegar com clareza à próxima decisão."),
          H("Limite importante"),
          P("Isso não autoriza manipulação. A técnica só facilita a decisão quando ela já faz sentido para o cliente. Se ele não demonstrou interesse, ainda é hora de entender, não de agendar.")
        ],
        activities: [
          example("Sim ou não, versus escolha", "Pergunta fechada: “Quer visitar?” → pode virar “não” automático.\nPergunta de condução (com interesse já demonstrado): “Semana ou sábado?” → o cliente escolhe como, e não se.")
        ]
      },
      {
        title: "Nunca termine sem um próximo passo",
        minutes: 3,
        blocks: [
          P("Muita negociação esfria no “fico aguardando”. Sem data, sem responsável e sem combinado, o tempo passa e o cliente some."),
          H("Exemplo"),
          P("Cliente: “Vou separar os documentos.”"),
          P("Resposta fraca: “Beleza, fico aguardando.”"),
          P("Resposta melhor: “Perfeito. Você consegue me enviar hoje ou amanhã?”"),
          H("Três perguntas para sair da conversa"),
          L("O que vai acontecer?", "Quem vai fazer?", "Quando?"),
          C("Sempre que possível, saia do atendimento sabendo o que, quem e quando.")
        ],
        activities: [
          check("Para treinar", "No próximo atendimento, terminar com um combinado claro (o quê, quem, quando).", "Registrar o combinado no CRM para não depender da memória.")
        ]
      },
      {
        title: "Todo atendimento precisa avançar",
        minutes: 4,
        blocks: [
          P("Um atendimento produtivo não é necessariamente aquele em que você vendeu naquele dia. É aquele que avançou. No fim da conversa, pelo menos uma destas coisas aconteceu:"),
          L("Você descobriu uma dor.", "Você solucionou uma dor.", "Você conseguiu uma informação importante.", "Vocês definiram a próxima ação.", "Vocês marcaram uma data."),
          H("Quando a objeção é legítima"),
          P("Às vezes a objeção faz sentido. Exemplo: o cliente consegue um apartamento com pouquíssimo recurso próprio e uma condição muito favorável, mas reclama da localização. Se não existe produto equivalente, em localização melhor, dentro das mesmas condições financeiras, o corretor não deve diminuir a preocupação."),
          P("Ele mostra a realidade com transparência: o que o cliente ganha, a que renuncia e quais seriam as alternativas. Assim o cliente decide conscientemente, e não por pressão.")
        ],
        activities: [
          check("Fechando o módulo", "Revisar seus últimos atendimentos: em quais deles a conversa não avançou?", "Para cada um, definir qual seria o próximo passo.", "Fazer a prova do Módulo 2 para liberar o Módulo 3.")
        ]
      }
    ],
    questions: [
      {
        topic: "Objeções", s: "Depois de ouvir as condições, o cliente diz: “Gostei, mas preciso pensar.” Qual resposta ajuda a conduzir sem pressionar?",
        o: ["“Claro, sem pressa! Fico aguardando seu retorno.”", "“Esse imóvel tem muita procura; se pensar demais, pode perder.”", "“Quer que eu te mande mais fotos para ajudar na decisão?”", "“O que você acha que ainda precisa avaliar para conseguir tomar essa decisão?”"], c: 3,
        e: "“Preciso pensar” costuma esconder uma dúvida ou objeção. A pergunta aberta ajuda a descobri-la sem pressionar. Esperar passivo ou criar urgência artificial não resolve."
      },
      {
        topic: "Objeções", s: "O cliente visita o imóvel e diz: “Não gostei da localização.” Qual é o melhor primeiro movimento?",
        o: ["“Mas este bairro está valorizando muito; é ótimo investimento.”", "“Entendo. Vou te mostrar opções em outro bairro.”", "“O que exatamente na localização não te agradou?”", "“Localização a gente resolve depois; o importante é a parcela.”"], c: 2,
        e: "Antes de defender ou trocar de imóvel, é preciso saber a causa: distância, segurança, trabalho, escola, imagem do bairro. Só então se trabalha a objeção certa."
      },
      {
        topic: "Próximo passo", s: "O cliente diz: “Vou separar os documentos e te mando.” Qual resposta define melhor o próximo passo?",
        o: ["“Perfeito, fico aguardando.”", "“Perfeito. Vou te mandar a lista e você me manda quando conseguir.”", "“Quanto antes melhor, hein? Não demore.”", "“Perfeito. Você consegue me enviar hoje ou amanhã?”"], c: 3,
        e: "Um bom próximo passo diz o que, quem e quando. As outras respostas deixam o tempo aberto ou transformam o prazo em cobrança sem combinado."
      },
      {
        topic: "Descoberta de objeção", s: "Depois de uma visita, o cliente diz apenas “foi legal”. Qual pergunta tem mais chance de revelar uma objeção escondida?",
        o: ["“Então vamos fechar?”", "“Se você tivesse que escolher algum ponto desse imóvel que não gostou, qual seria?”", "“O que você achou?”", "“Você gostou do imóvel, né?”"], c: 1,
        e: "A pergunta convida o cliente a ser sincero sobre o que o incomoda. “Gostou, né?” induz a resposta; “vamos fechar” antecipa a decisão; e “o que achou” costuma gerar respostas educadas."
      },
      {
        topic: "Objeções", s: "O cliente diz: “Achei a prestação alta.” Qual é a melhor resposta?",
        o: ["“Mas é bem menos que um aluguel; vale muito a pena.”", "“Alta em comparação com o quê? Quanto você imaginava pagar por mês?”", "“Vou tentar uma condição melhor para você.”", "“Entendo; então esse imóvel não é para você.”"], c: 1,
        e: "Antes de argumentar, descubra a referência do cliente: orçamento, aluguel atual, expectativa. A pergunta mostra se é um problema de valor, de conforto ou de entendimento. Prometer condição melhor sem poder cumprir é um risco."
      },
      {
        topic: "Cliente que para de avançar", s: "O cliente prometeu enviar os documentos e está sem responder há cinco dias. Qual mensagem faz mais sentido?",
        o: ["“E aí, vai comprar ou não?”", "Aguardar ele se manifestar, para não pressionar.", "Retomar o último combinado, perguntar se algo travou e propor novo prazo, por exemplo: “Quer que a gente veja juntos o que falta? Consegue me enviar até quinta?”", "Mandar imóveis novos todos os dias até ele responder."], c: 2,
        e: "Retomar o combinado, perguntar o que travou e propor um novo prazo é conduzir sem pressionar. Cobrança seca, silêncio ou insistência com outro assunto não avançam."
      },
      {
        topic: "Descoberta de objeção", s: "O cliente diz que o imóvel está caro. Com algumas perguntas, você descobre que o problema é que a esposa não gostou do bairro. O que isso mostra?",
        o: ["Que o cliente mentiu e não é confiável.", "Que a objeção declarada nem sempre é a real: é preciso perguntar até chegar à causa.", "Que preço é sempre a objeção principal e o resto é desculpa.", "Que o melhor é reduzir o preço para fechar logo."], c: 1,
        e: "Muitas vezes a primeira objeção é só a mais fácil de dizer. Perguntar com cuidado revela a causa real, e é nela que se trabalha."
      },
      {
        topic: "Condução", s: "O cliente já demonstrou interesse em conhecer o imóvel. Qual das frases conduz sem pressionar?",
        o: ["“Esse imóvel vai sair rápido; você precisa visitar hoje.”", "“Quando quiser visitar, me avisa.”", "“Para você é melhor conhecer durante a semana ou no sábado?”", "“Você vai querer visitar, né? Já marquei sábado às 10h.”"], c: 2,
        e: "A pergunta oferece opções reais e facilita a decisão que o cliente já sinalizou. Urgência artificial, espera passiva e marcar por conta própria não ajudam."
      },
      {
        topic: "Objeção legítima", s: "O cliente consegue um apartamento com pouquíssimo recurso próprio e condições muito favoráveis, mas reclama da localização. Não existe produto equivalente em localização melhor dentro das mesmas condições. O que fazer?",
        o: ["Minimizar a localização e destacar só as vantagens financeiras.", "Concordar que a localização é ruim e sugerir que ele espere outra oportunidade.", "Mostrar com transparência o que ele ganha e a que renuncia, comparar as alternativas e deixar que ele decida conscientemente.", "Insistir que ele não encontrará nada melhor."], c: 2,
        e: "Quando a objeção é legítima, o corretor não a diminui: mostra a realidade e deixa a decisão com o cliente. Pressionar ou adiar por ele não ajuda."
      },
      {
        topic: "Próximo passo", s: "Ao final do atendimento, o cliente diz que vai conversar com o cônjuge antes de decidir. Qual encerramento é melhor?",
        o: ["“Ótimo, qualquer coisa me chama.”", "“Tudo bem, mas já adianto que temos pouco tempo.”", "“Combinado. Quando vocês conseguem conversar? Posso te chamar amanhã à noite para saber o que decidiram?”", "“Beleza, depois você me avisa.”"], c: 2,
        e: "Um bom encerramento define quando o contato acontece. As outras opções deixam o próximo passo na mão do acaso ou criam pressão por prazo."
      }
    ]
  },
  {
    key: "m3",
    title: "Fundamentos do MCMV e financiamento Caixa",
    summary: "Base para entender o financiamento do primeiro imóvel e interpretar uma simulação. Este módulo continua em breve.",
    exam: false,
    lessons: [
      {
        title: "Entendendo a renda do cliente",
        minutes: 5,
        blocks: [
          P("A renda é a base de toda simulação: ela influencia a parcela que o cliente pode assumir. Mas atenção: o que o cliente diz que ganha não é, necessariamente, o que pode ser comprovado e considerado na análise."),
          H("Tipos de renda que você vai encontrar"),
          L("CLT: renda com carteira assinada, comprovada por holerites.", "Renda informal: quem trabalha por conta própria sem registro formal.", "Autônomo ou empresário, quando aplicável.", "Aposentadoria ou pensão, quando aplicável.", "Composição de renda: duas ou mais pessoas somando renda na mesma proposta."),
          H("Dito versus comprovado"),
          P("O cliente pode afirmar uma renda mais alta do que consegue demonstrar. A análise considera o que está comprovado e o que as regras vigentes aceitam. Por isso, o corretor pergunta, entende e orienta a organizar os documentos desde o começo."),
          C("Não prometa um valor de aprovação com base apenas no que o cliente disse que ganha.")
        ],
        activities: [
          example("Como pedimos a comprovação no CRM", "Hoje, no nosso checklist de documentos:\n• CLT: os 2 últimos holerites.\n• Renda informal: os 3 últimos extratos bancários ou as 3 últimas faturas de cartão de crédito.\n• Quem comprova por Imposto de Renda: declaração completa e recibo de entrega.\nOs critérios específicos da Caixa para cada caso (por exemplo, como a renda informal é considerada) devem ser confirmados nas regras vigentes — nunca decore números soltos."),
          tip("Atenção", "Regras e limites de renda mudam. Nesta Academia ensinamos o princípio; os valores e critérios do momento você confirma na simulação e nas orientações atualizadas do time.")
        ]
      },
      {
        title: "Da conversa para a simulação",
        minutes: 4,
        blocks: [
          P("Você não precisa decorar todas as perguntas necessárias para uma simulação. O CRM já tem um formulário completo, e cada corretor tem o seu link individual."),
          H("O fluxo"),
          L("O cliente conversa com você pelo WhatsApp.", "Você envia o seu link.", "O cliente preenche o formulário.", "As informações entram no sistema.", "Você usa os dados para avançar na simulação."),
          H("Como pedir"),
          P("“Vou te enviar um formulário rápido. Preenche essas informações para mim que eu consigo fazer sua simulação e entender melhor seu poder de compra.”"),
          C("Use a tecnologia para coletar informações. Use seu conhecimento para interpretar e conduzir o cliente.")
        ],
        activities: [
          example("Por que essas informações importam", "• Renda: ajuda a entender a parcela que cabe no orçamento.\n• Data de nascimento: faz parte das condições do financiamento.\n• Dependentes e estado civil: ajudam a entender a composição familiar e se há outra pessoa na proposta.\n• FGTS: pode ajudar na entrada, conforme as regras vigentes.\nVocê não precisa decorar o formulário; precisa entender para que cada dado serve e explicar isso ao cliente com naturalidade."),
          check("Para treinar", "Enviar o seu link ao próximo cliente com a mensagem sugerida.", "Pedir que ele avise quando terminar de preencher.", "Abrir o cadastro no CRM e ver o que veio.")
        ]
      },
      {
        title: "Entendendo o Minha Casa Minha Vida",
        minutes: 5,
        blocks: [
          P("O Minha Casa Minha Vida é um programa habitacional do governo federal que busca facilitar a compra do imóvel, com condições especiais para quem se enquadra. No nosso dia a dia, o financiamento é feito pela Caixa."),
          H("Quem pode se enquadrar"),
          P("O enquadramento depende principalmente da renda bruta familiar, além de outros critérios que a Caixa analisa. Por isso o corretor não “promete enquadramento”: ele organiza as informações, faz a simulação e confirma."),
          H("Faixas de renda"),
          P("O programa é dividido em faixas de renda, e cada faixa tem teto de renda, limites de valor de imóvel e condições diferentes. Em geral, quanto menor a renda familiar, maiores tendem a ser os benefícios."),
          P("Esses valores e limites são atualizados por portaria e mudam de tempos em tempos. Por isso não os memorizamos: o corretor consulta a tabela vigente antes de falar números com o cliente."),
          C("O associado precisa entender a regra. O cliente não precisa receber uma aula de legislação.")
        ],
        activities: [
          example("Como explicar ao cliente", "Em vez de: “Você se enquadra na faixa X, conforme a portaria Y.”\nDiga: “O programa tem condições diferentes dependendo da renda da família. Vou fazer a sua simulação e te mostro quanto você consegue de condição e o que isso significa na parcela e na entrada.”"),
          check("Antes de falar números com o cliente", "Confirmar os limites e as condições vigentes do programa.", "Fazer a simulação com os dados reais do cliente.", "Explicar o resultado em linguagem simples.")
        ]
      }
    ]
  }
];
