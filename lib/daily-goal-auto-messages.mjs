// Modelos APROVADOS pelo dono (2026-10-02) para as mensagens automáticas da
// Meta Diária e do "Disparar" (WhatsApp individual do corretor). Fonte dos
// padrões do código; os modelos em uso ficam em crm_settings
// (id = 'daily_goal_auto_messages', editáveis em Gestão › Meta Diária ›
// Automação) e foram gravados em produção com exatamente estes textos.
// Variáveis: {saudacao}, {primeiro_nome}, {nome_corretor}, {associado_a}
// (ver renderAutoMessage em lib/daily-goal-auto-core.mjs). Escolha do modelo:
// sorteio com anti-repetição no envio (pickAntiRepeatVariant).

export const AUTO_MESSAGE_MAX_VARIANTS = { message1: 4, message2: 4, message3: 10 };

export const AUTO_MESSAGE_VARIABLES = ["saudacao", "primeiro_nome", "nome_corretor", "associado_a", "associado_associada"];

export const APPROVED_AUTO_MESSAGES = {
  message1: [
    "{saudacao} {primeiro_nome}, tudo bem?",
    "{saudacao} {primeiro_nome}, como você está?",
    "{saudacao} {primeiro_nome}, tudo certo?",
    "{saudacao} {primeiro_nome}, posso falar com você um instante?"
  ],
  message2: [
    "{saudacao} {primeiro_nome}, tudo bem? Meu nome é {nome_corretor}, sou {associado_a} do corretor Matheus Machado. Notei que há um tempo você se interessou pela compra de um imóvel. Você chegou a concluir a compra?\n\nHoje somos especialistas na compra do primeiro imóvel e temos opções sem entrada e com documentação gratuita. Também oferecemos suporte para quem possui restrições no nome e para quem precisa regularizar o Imposto de Renda fora do prazo para comprovação de renda.",
    "{saudacao} {primeiro_nome}, tudo bem? Meu nome é {nome_corretor} e sou {associado_a} do corretor Matheus Machado. Vi que há um tempo você demonstrou interesse em comprar um imóvel. Queria saber se já conseguiu realizar essa compra.\n\nHoje trabalhamos com imóveis prontos sem entrada e com documentação gratuita. Também temos soluções para quem possui restrições no nome ou precisa regularizar o Imposto de Renda fora do prazo. Somos especialistas na compra do primeiro imóvel.",
    "{saudacao} {primeiro_nome}, tudo bem? Meu nome é {nome_corretor}, sou {associado_a} do corretor Matheus Machado. Estou entrando em contato porque há um tempo você demonstrou interesse na compra de um imóvel. Chegou a comprar?\n\nCaso ainda não tenha comprado, hoje temos imóveis prontos com documentação gratuita e opções sem entrada. Também auxiliamos quem possui restrições no nome e quem precisa regularizar o Imposto de Renda para comprovação de renda.",
    "{saudacao} {primeiro_nome}, tudo bem? Meu nome é {nome_corretor} e sou {associado_a} do corretor Matheus Machado. Notei que há um tempo você teve interesse em comprar um imóvel e queria saber se esse objetivo já foi realizado.\n\nSe ainda não, posso te apresentar algumas possibilidades. Somos especialistas na compra do primeiro imóvel, temos imóveis prontos sem entrada e com documentação gratuita, além de suporte para restrições no nome e regularização do Imposto de Renda fora do prazo."
  ],
  message3: [
    "{saudacao} {primeiro_nome}, tudo bem? Estou te enviando mais uma mensagem porque queria saber se a compra do seu imóvel ainda está nos seus planos.",
    "{saudacao} {primeiro_nome}, tudo bem? Passando novamente para saber se você já conseguiu comprar seu imóvel ou ainda está avaliando as possibilidades.",
    "{saudacao} {primeiro_nome}, tudo bem? Queria entender uma coisa: o que mais tem dificultado você de avançar na compra do seu imóvel hoje?",
    "{saudacao} {primeiro_nome}, tudo bem? Talvez quando você demonstrou interesse ainda não fosse o momento ideal. A compra do imóvel faz mais sentido para você hoje?",
    "{saudacao} {primeiro_nome}, tudo bem? Se o valor da entrada foi o que dificultou sua compra anteriormente, hoje temos algumas alternativas. Ainda tem interesse em comprar?",
    "{saudacao} {primeiro_nome}, tudo bem? Estou entrando em contato novamente porque podemos fazer uma nova análise e verificar quais possibilidades você tem hoje. Gostaria que eu verificasse?",
    "{saudacao} {primeiro_nome}, tudo bem? Estou te chamando novamente porque hoje podemos ter opções diferentes das que você encontrou quando começou a pensar na compra do imóvel. Ainda tem interesse?",
    "{saudacao} {primeiro_nome}, tudo bem? Só queria confirmar para não ficar te chamando sem necessidade. Você ainda pretende comprar seu imóvel?",
    "{saudacao} {primeiro_nome}, tudo bem? Estou passando mais uma vez porque comprar o primeiro imóvel pode continuar sendo um objetivo importante para você. Esse plano ainda faz sentido hoje?",
    "{saudacao} {primeiro_nome}, tudo bem? Para eu entender seu momento, me responde só uma coisa: você já comprou seu imóvel, ainda pretende comprar ou prefere deixar esse objetivo para mais pra frente?"
  ]
};

// Variáveis usadas num modelo que o sistema não conhece (erro de digitação).
export function unknownAutoMessageVariables(template) {
  const found = String(template || "").match(/\{([a-z_]+)\}/gi) || [];
  return [...new Set(found.map((token) => token.slice(1, -1)).filter((name) => !AUTO_MESSAGE_VARIABLES.includes(name)))];
}
