// Modelos da POLÍTICA v2 de disparos (REGRA OFICIAL — dono, 2026-10-04). Só quem está com
// `daily_goal_auto_settings.policy_v2_enabled = true` usa estes; os modelos de lib/daily-goal-auto-messages.mjs
// (editáveis em Gestão › Meta Diária › Automação) continuam valendo para os demais corretores. Puro e testado em
// tests/daily-goal-policy-v2.test.mjs. Regras:
//  - 10 modelos por tentativa (5 CURTOS + 5 LONGOS); a escolha alterna curto/longo e nunca repete o último nem o
//    penúltimo modelo da mesma tentativa (pickV2Variant);
//  - 1ª/2ª/3ª tentativa SEM promessa (nada de entrada, aprovação, valor, prazo, garantia) e SEM link/URL;
//  - todos terminam com a linha de saída em linha própria, com a palavra SAIR destacada (*SAIR*): a resposta SAIR
//    já vira "Não contactar" pelo caminho existente (lib/prospecting-reply*.js);
//  - só as variáveis {saudacao} {primeiro_nome} {nome_corretor} (sem {associado_a}).

export const V2_AUTO_MESSAGES = {
  message1: [
    { length: "short", text: "{saudacao} {primeiro_nome}, tudo bem? Sou {nome_corretor}, da equipe do corretor Matheus Machado. Você chegou a comprar seu imóvel?\n\nSe não quiser receber mensagens, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}, tudo bem? Meu nome é {nome_corretor} e faço parte da equipe do corretor Matheus Machado, da Matheus Machado Imóveis.\n\nEstou entrando em contato porque, há um tempo, você demonstrou interesse na compra de um imóvel. Queria entender se isso ainda está nos seus planos ou se você já resolveu por outro caminho.\n\nSe preferir não receber nossas mensagens, é só responder *SAIR*." },
    { length: "short", text: "{saudacao} {primeiro_nome}! Aqui é {nome_corretor}, da Matheus Machado Imóveis. Posso te fazer uma pergunta rápida sobre a compra de um imóvel?\n\nPara parar de receber, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}, como você está? Me chamo {nome_corretor} e trabalho com o corretor Matheus Machado.\n\nVi aqui que você pediu informações sobre imóveis há algum tempo e quis saber como ficou isso para você: chegou a comprar, continua pesquisando ou deixou para depois? Qualquer resposta já me ajuda.\n\nNão quer receber nossas mensagens? Responda *SAIR*." },
    { length: "short", text: "{saudacao} {primeiro_nome}, tudo certo? Me chamo {nome_corretor}. Há um tempo você pediu informações sobre imóveis. Isso ainda está nos seus planos?\n\nSe não quiser receber, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}, tudo bem? Aqui é {nome_corretor}, da equipe do corretor Matheus Machado.\n\nQuando você demonstrou interesse em comprar um imóvel, talvez ainda não fosse o melhor momento. Por isso estou passando para saber como está isso hoje e se faz sentido a gente conversar um pouco.\n\nPara não receber mais mensagens, responda *SAIR*." },
    { length: "short", text: "{saudacao} {primeiro_nome}, como você está? Aqui é {nome_corretor}, da equipe do Matheus Machado Imóveis. Você ainda pensa em comprar um imóvel?\n\nPara não receber mais, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}! Meu nome é {nome_corretor} e faço parte da equipe da Matheus Machado Imóveis.\n\nEstou retomando o contato com quem, em algum momento, pediu informações para comprar um imóvel. Gostaria de saber se você já conseguiu realizar esse objetivo ou se ainda está pensando no assunto.\n\nSe não quiser receber mais nossas mensagens, responda *SAIR*." },
    { length: "short", text: "{saudacao} {primeiro_nome}, tudo bem? Aqui é {nome_corretor}, do Matheus Machado Imóveis. Lembrei de você: ainda tem interesse em comprar um imóvel?\n\nSe preferir não receber, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}, tudo bem? Sou {nome_corretor}, da equipe do corretor Matheus Machado.\n\nEstou falando com as pessoas que, há algum tempo, procuraram a gente para comprar um imóvel. Quero só entender como está o seu momento hoje: já comprou, ainda pretende comprar ou prefere deixar para mais adiante?\n\nSe quiser parar de receber, é só responder *SAIR*." }
  ],
  message2: [
    { length: "short", text: "{saudacao} {primeiro_nome}, tudo bem? Aqui é {nome_corretor} de novo. Ainda faz sentido para você conversar sobre a compra do seu imóvel?\n\nPara parar de receber, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}, tudo bem? Aqui é {nome_corretor}, da equipe do corretor Matheus Machado. Te chamei há pouco tempo e não quis deixar a conversa solta.\n\nA nossa equipe trabalha com quem quer comprar o primeiro imóvel, e posso te explicar como funciona cada etapa, com calma e sem compromisso. Se fizer sentido para você, me conta como está o seu momento.\n\nSe não quiser receber mensagens, responda *SAIR*." },
    { length: "short", text: "{saudacao} {primeiro_nome}! Passando de novo para saber: você já resolveu a compra do imóvel ou ainda está avaliando?\n\nSe não quiser receber, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}, como você está? Sou {nome_corretor} e te chamei outro dia, em nome do corretor Matheus Machado.\n\nMuita gente deixa a compra do imóvel para depois por não saber por onde começar. Se esse for o seu caso, posso te orientar nos primeiros passos e tirar suas dúvidas, sem pressa.\n\nPara não receber mais mensagens, responda *SAIR*." },
    { length: "short", text: "{saudacao} {primeiro_nome}, tudo certo? Sou {nome_corretor}. Você ainda quer ajuda para comprar um imóvel?\n\nSe preferir não receber, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}, tudo bem? Meu nome é {nome_corretor}, da Matheus Machado Imóveis, e estou retomando o nosso contato.\n\nQueria saber se você continua com vontade de comprar um imóvel. Se sim, posso conversar com você sobre o seu momento e ver quais caminhos fazem sentido. Se não, tudo bem, me avise e eu deixo você em paz.\n\nSe quiser parar de receber, responda *SAIR*." },
    { length: "short", text: "{saudacao} {primeiro_nome}, tudo bem? Aqui é {nome_corretor}. Seguimos por aqui para conversar sobre a compra do seu imóvel, se você ainda tiver interesse. Posso te ajudar?\n\nPara não receber, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}! Aqui é {nome_corretor}, da equipe do corretor Matheus Machado.\n\nFaz um tempo que você demonstrou interesse em comprar um imóvel e quero saber se ainda posso te ajudar com isso. Se você já comprou, fico feliz e encerro por aqui. Se ainda está pensando, me conta o que mais pesa na sua decisão.\n\nSe não quiser receber nossas mensagens, responda *SAIR*." },
    { length: "short", text: "{saudacao} {primeiro_nome}, como você está? Aqui é {nome_corretor}, do Matheus Machado Imóveis. A compra do imóvel continua nos seus planos?\n\nSe não quiser receber, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}, tudo bem? Sou {nome_corretor} e trabalho com o corretor Matheus Machado.\n\nEstou acompanhando as pessoas que pediram informações sobre imóveis e quero entender como você está agora. Se ainda quiser conversar sobre a compra, é só me responder aqui e eu te atendo com atenção. Se o momento mudou, sem problema.\n\nPara parar de receber, responda *SAIR*." }
  ],
  message3: [
    { length: "short", text: "{saudacao} {primeiro_nome}, tudo bem? Só confirmando, para não ficar te chamando à toa: você ainda pretende comprar um imóvel?\n\nSe não quiser receber, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}, tudo bem? Aqui é {nome_corretor}, da equipe do corretor Matheus Machado. Esta é a minha última tentativa de contato por aqui.\n\nSe a compra do imóvel ainda faz sentido para você, me responda com um \"sim\" e a gente conversa com calma. Se preferir deixar para mais adiante, também está tudo bem, e eu não incomodo mais.\n\nPara parar de receber mensagens, responda *SAIR*." },
    { length: "short", text: "{saudacao} {primeiro_nome}! Última mensagem por aqui: o plano de comprar um imóvel ainda existe para você?\n\nPara não receber mais, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}, como você está? Sou {nome_corretor} e já te chamei algumas vezes em nome do corretor Matheus Machado.\n\nNão quero te incomodar, então vou perguntar de forma direta: você já comprou seu imóvel, ainda pretende comprar ou prefere que eu encerre o contato? Sua resposta, qualquer que seja, já ajuda.\n\nSe preferir não receber mais mensagens, responda *SAIR*." },
    { length: "short", text: "{saudacao} {primeiro_nome}, tudo certo? Sou {nome_corretor}. Posso encerrar o seu contato ou você ainda quer conversar sobre imóveis?\n\nSe não quiser receber, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}, tudo bem? Aqui é {nome_corretor}, da Matheus Machado Imóveis.\n\nTalvez, quando você demonstrou interesse, o momento não fosse o ideal. Se hoje a compra de um imóvel faz mais sentido para você, posso conversar sobre o seu cenário e explicar os próximos passos. Se continua sem ser o momento, é só me dizer.\n\nPara não receber mais mensagens, responda *SAIR*." },
    { length: "short", text: "{saudacao} {primeiro_nome}, tudo bem? Passando pela última vez: ainda tem interesse em comprar um imóvel?\n\nSe preferir não receber, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}! Meu nome é {nome_corretor} e faço parte da equipe do corretor Matheus Machado.\n\nJá tentei falar com você outras vezes e não quero ser inconveniente. Se você ainda pensa em comprar um imóvel, responda esta mensagem e eu te atendo hoje mesmo. Se o assunto já foi resolvido, fico feliz por você e encerro o contato.\n\nSe quiser parar de receber, é só responder *SAIR*." },
    { length: "short", text: "{saudacao} {primeiro_nome}, como você está? Aqui é {nome_corretor}. Sigo à disposição se você ainda quiser falar sobre a compra de um imóvel.\n\nPara não receber, responda *SAIR*." },
    { length: "long", text: "{saudacao} {primeiro_nome}, tudo bem? Sou {nome_corretor}, do Matheus Machado Imóveis.\n\nPara eu entender o seu momento e respeitar o seu tempo, me diz só uma coisa: a compra do seu imóvel ainda é um objetivo, já foi realizada ou ficou para mais pra frente? Com a sua resposta eu sei se continuo te chamando ou se paro por aqui.\n\nSe não quiser receber mais, responda *SAIR*." }
  ]
};

// Comprimento do modelo `index` da tentativa (null se desconhecido).
export function v2VariantLength(attemptNumber, index) {
  const list = V2_AUTO_MESSAGES[`message${attemptNumber}`] || [];
  return list[index]?.length || null;
}

// Escolhe o modelo v2 do próximo envio. `recentSends` = envios reais recentes do corretor (QUALQUER tentativa),
// do mais antigo para o mais recente: [{ attempt_number, variant_index }]. Regras (pedido do dono, 2026-10-04):
//  - alterna o TAMANHO em relação ao último envio (curto -> longo -> curto...), mesmo entre tentativas;
//  - nunca repete o último nem o penúltimo modelo DESTA tentativa;
//  - sorteio entre o que sobra (aleatório, sem sequência fixa).
export function pickV2Variant({ attemptNumber, recentSends = [], random = Math.random }) {
  const list = V2_AUTO_MESSAGES[`message${attemptNumber}`] || [];
  if (!list.length) return -1;
  const last = recentSends.length ? recentSends[recentSends.length - 1] : null;
  const lastLength = last ? v2VariantLength(last.attempt_number, last.variant_index) : null;
  const wantLength = lastLength === "short" ? "long" : lastLength === "long" ? "short" : (random() < 0.5 ? "short" : "long");
  const sameAttempt = recentSends.filter((send) => send.attempt_number === attemptNumber && Number.isInteger(send.variant_index));
  const blocked = new Set(sameAttempt.slice(-2).map((send) => send.variant_index));
  const all = list.map((_, index) => index);
  let candidates = all.filter((index) => list[index].length === wantLength && !blocked.has(index));
  if (!candidates.length) candidates = all.filter((index) => !blocked.has(index));
  if (!candidates.length) candidates = all;
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
}
