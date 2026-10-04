// Manual do CRM — CONTEÚDO inicial (dados puros). SOMENTE texto do ponto de vista
// de quem USA o CRM. Entra sempre como "pending" (o dono aprova); o seed é
// idempotente e nunca sobrescreve texto já editado (só preenche corpo vazio).
// Slugs são âncoras estáveis: nunca renomeie depois de publicar.
// Corpo: parágrafos e listas com "- " (ver lib/manual-ui-core.mjs). Sem HTML.
const B = ["broker"];
const ALL = ["all"];

export const MANUAL_SEED_TOPICS = Object.freeze([
  { slug: "clientes", title: "Clientes", icon: "users", description: "Cadastro, funil, pendências e acompanhamento dos clientes." },
  { slug: "prospeccao-meta-diaria", title: "Prospecção e Meta Diária", icon: "target", description: "Lista de contatos, tentativas e a meta do dia." },
  { slug: "chat-whatsapp", title: "Chat e WhatsApp", icon: "message", description: "Conversas com clientes e envio de mensagens." },
  { slug: "agenda", title: "Agenda", icon: "calendar", description: "Compromissos e atividades dos clientes." },
  { slug: "simulacao-jornada", title: "Simulação e Jornada", icon: "calculator", description: "Simulação de financiamento, aprovação e a jornada do cliente." },
  { slug: "documentacao", title: "Documentação", icon: "file", description: "Documentos do cliente, análise e envio à CCA." },
  { slug: "ranking-desempenho", title: "Ranking e Desempenho", icon: "trophy", description: "Bônus do dia, destaques e reconhecimentos." },
  { slug: "outros", title: "Outros", icon: "more", description: "Roleta, imóveis, mensagem diária e alertas." }
]);

const e = (topic, section, title, audiences, body) => ({ topic, section, title, audiences, body: body.trim() });

export const MANUAL_SEED_CONTENT = Object.freeze([
  // ---------------- CLIENTES ----------------
  e("clientes", "cadastrar-cliente", "Cadastrar clientes", B, `
Você pode cadastrar um cliente à mão, pelo CRM, ou ele pode chegar pelo formulário de simulação. Cadastro feito por você fica no seu nome.

Antes de criar, o CRM confere se o cliente já existe: se houver cadastro com o mesmo telefone (ou, sem telefone igual, o mesmo nome), o formulário atualiza o cadastro existente em vez de criar outro. Responsável e origem do cadastro são mantidos.

Quando o cliente preenche o formulário de novo, ele continua no mesmo card e sobe para o topo da lista.

Cadastro criado sem a simulação (manual, Chat) não mostra dados de simulação: aparece o aviso de que o cliente ainda não preencheu essas informações, em vez de valores em branco.
`),
  e("clientes", "funil-e-etapas", "Etapas do funil", ALL, `
O funil tem 7 etapas principais:

- Atendimento
- Simulação
- Aguardando documentação
- Aguardando aprovação
- Cliente aprovado
- Reunião
- Venda

Dentro das etapas existem situações mais detalhadas, que você escolhe na ficha do cliente. Restrição, blindagem e reprovado ficam agrupados em "Aguardando aprovação". As situações de venda contam todas como a etapa Venda.
`),
  e("clientes", "alteracao-de-etapa", "Alterar a etapa do cliente", B, `
Você muda a etapa pela ficha do cliente. Cada mudança fica registrada no histórico do cliente.

Dois avanços acontecem sozinhos:

- Ao entrar em uma situação de venda, a venda é registrada automaticamente.
- Se o cliente nunca teve "Reunião realizada" e vai direto para a venda, o CRM marca essa reunião automaticamente.

Ao marcar o cliente como aprovado, a data da aprovação é gravada.
`),
  e("clientes", "trava-cliente-disparo", "Cliente de disparo: avanço de etapa", B, `
Quando o cliente recebeu a mensagem automática da Meta Diária ou entrou pelo botão Disparar, ele fica em "Tentando contato". Enquanto ele não responder, você não consegue avançá-lo de etapa. A trava vale para rodadas criadas a partir de 02/10/2026. O CRM avisa: "Aguardando resposta do cliente para avançar o atendimento."

Só uma resposta real do cliente libera o avanço. Mensagem sua, mensagem entregue ou lida não liberam.

Mesmo sem resposta, você pode sempre marcar "Não contactar" ou arquivar o cliente.
`),
  e("clientes", "clientes-pendentes", "Clientes pendentes", B, `
Cliente pendente é aquele que precisa da sua ação. Entra na lista "Clientes pendentes" quem:

- está ativo (sem arquivamento e fora de "Não contactar");
- está há mais de 3 dias sem contato por WhatsApp (ou desde o cadastro, se nunca houve contato);
- não tem nenhuma atividade futura agendada.

Para sair da lista, registre um contato ou agende um compromisso. Os clientes pendentes também contam na sua Meta Diária.
`),
  e("clientes", "tentando-contato", "Tentando contato e pendências", B, `
Se um cliente de etapa avançada parou de responder e você o devolve manualmente para "Tentando contato", ele deixa de aparecer como "sem atividade futura". Essa etapa segue as regras próprias de tentativa de contato.

Os 3 dias para virar pendente recomeçam a contar a partir da troca de etapa. Sem resposta por 3 dias, ele volta a ser pendente.
`),
  e("clientes", "arquivados-nao-contactar", "Arquivar e Não contactar", B, `
Arquivar tira o cliente do seu dia a dia sem apagá-lo. Você pode desarquivar quando quiser, e o cliente volta a participar do funil.

"Não contactar" é para quem pediu para não receber mensagens. O cliente continua com você e o cadastro permanece, mas ele deixa de entrar em prospecção e em automações. Para marcar, é obrigatório informar o motivo.

Cliente em "Não contactar" não conta como pendente.
`),
  e("clientes", "nao-contactar-automatico", "Não contactar automático", B, `
O CRM só move o cliente para "Não contactar" sozinho quando a resposta dele é um pedido claro, como:

- número errado;
- "não sou o cliente";
- "não tenho interesse" ou outra negativa clara, sozinha na mensagem.

Respostas como "agora não", "depois", "no momento", respostas com "mas" ou com uma pergunta não são tratadas como recusa: o cliente vai para "Em atendimento" e você continua a conversa.
`),
  e("clientes", "resposta-prospeccao", "Quando o cliente responde à prospecção", B, `
Quando um cliente que estava em prospecção responde, o CRM passa o cadastro sozinho para "Em atendimento" e envia um aviso (push) para você.

As mensagens automáticas que ainda estavam na fila para esse cliente são canceladas, para ele não receber mais nada enquanto você conversa. A meta do dia não muda por causa disso.
`),
  e("clientes", "lista-e-filtros", "Busca, filtros e tags da lista", B, `
Na lista de clientes você pode fazer buscas e filtrar por tag, pendentes, sem contato, sem atividade futura e grupo de etapa. Os contadores acompanham o filtro escolhido.

A lista pode mostrar 5, 10 ou 20 clientes por página. A tela abre com 20.
`),

  // ---------------- PROSPECÇÃO E META DIÁRIA ----------------
  e("prospeccao-meta-diaria", "meta-diaria", "Meta Diária", B, `
A Meta Diária organiza sua prospecção em rodadas de até 3 tentativas por contato.

- Você faz no máximo 1 tentativa por contato por dia.
- Depois de uma tentativa, o card do contato fica verde e só passa para a próxima tentativa à meia-noite.
- Na 3ª tentativa a rodada se encerra.

Seu progresso do dia aparece na própria tela da Meta Diária.
`),
  e("prospeccao-meta-diaria", "selecao-de-clientes", "Seleção de clientes e carteira", B, `
Os contatos do dia são gerados quando você abre a tela da Meta Diária. Você começa o dia com exatamente 10 contatos aguardando o 1º contato.

Sua carteira ativa comporta no máximo 30 clientes. Com a carteira cheia você não recebe novos até liberar espaço. Com 29, por exemplo, você recebe 1 para completar 30.
`),
  e("prospeccao-meta-diaria", "prospeccao", "Prospecção manual", B, `
Na Prospecção você trabalha contatos de duas listas: a Base da Imobiliária e a sua base ("Minha Base").

Contatos sem nome aparecem por último na lista; os demais seguem do mais novo para o mais antigo.
`),
  e("prospeccao-meta-diaria", "conclusao-da-meta", "Conclusão da meta", B, `
A meta do dia soma duas coisas: a prospecção do dia e os clientes pendentes. Quando as duas são concluídas, você chega a 100%.

Cada contato extra depois dos 100% soma +1 ponto percentual (por exemplo, 101%, 102%). Pendente não gera percentual extra.

O resultado do dia só é fechado e atualizado à meia-noite.
`),
  e("prospeccao-meta-diaria", "prospeccao-apos-100", "Prospecção após 100%", B, `
Só depois de a Meta Diária chegar a 100% você pode pegar contatos novos na Prospecção e usar o botão "Disparar".

Pegar um contato respeita o limite da sua carteira: com a carteira cheia, não é possível pegar novos.
`),
  e("prospeccao-meta-diaria", "regras-de-contato", "Regras de contato", B, `
- Cada contato recebe até 3 tentativas, 1 por dia.
- Depois da 3ª tentativa sem resposta, o cliente continua com você por mais 24 horas, para você ver uma resposta e atualizar a etapa.
- Passadas as 24 horas sem mudança de etapa, o contato volta para a fila e fica bloqueado por 30 dias.
- Se você pegou um contato e a última tentativa foi há 7 dias ou mais, sem o cliente avançar, o CRM também o devolve à fila.
`),
  e("prospeccao-meta-diaria", "automacao-e-disparar", "Mensagens automáticas e Disparar", B, `
As mensagens automáticas da Meta Diária e do botão "Disparar" saem pelo WhatsApp que você conectou ao CRM.

O modelo de mensagem é sorteado para cada envio, sem repetir o mesmo modelo em sequência. O CRM envia um contato por vez.

Cada clique em "Disparar" reserva um contato para a fila de envio. O botão só libera com a Meta Diária em 100% e o WhatsApp conectado.
`),
  e("prospeccao-meta-diaria", "prospeccao-whatsapp-conectado", "Prospecção só com WhatsApp conectado", B, `
Para usar a Prospecção e a Meta Diária, seu WhatsApp precisa estar conectado ao CRM.

Se estiver desconectado, você não recebe contatos novos na Meta Diária e a Prospecção mostra a tela "Conecte seu WhatsApp para acessar a Prospecção.", com o botão para conectar. Ao reconectar, tudo volta ao normal.
`),
  e("prospeccao-meta-diaria", "compensacao-restricao", "Compensação por restrição validada", B, `
Se seu WhatsApp tiver uma restrição validada, o tempo que você perdeu é devolvido no mesmo dia, com limite até as 21:00.

Se mesmo assim não der tempo de concluir a meta, o dia é marcado como impactado pela restrição e você não recebe penalidade.

Veja os estados do WhatsApp em "Chat e WhatsApp".
`),

  // ---------------- CHAT E WHATSAPP ----------------
  e("chat-whatsapp", "conectar-whatsapp", "Conectar o WhatsApp", B, `
Você conecta o seu WhatsApp pelo modal "WhatsApp" do cabeçalho do CRM. Siga as instruções da tela para ler o código e concluir.

Para usar Prospecção e Meta Diária, a conexão precisa estar ativa. Se ela cair, o CRM mostra o estado e o botão para reconectar.
`),
  e("chat-whatsapp", "estados-do-whatsapp", "Estados do WhatsApp", B, `
Seu WhatsApp aparece sempre com um destes estados:

- Conectado;
- Desconectado;
- Restrição informada — aguardando validação;
- Restrição validada.

Se o seu número foi restringido, informe no modal do WhatsApp do cabeçalho, confirmando a mensagem. Você só informa; o CRM avisa quando a restrição for validada.

- Informada: não muda nada na sua Meta Diária nem na Prospecção.
- Validada: libera a Meta Diária manual e, com 100% da meta, a Prospecção manual. O envio automático não é liberado.

A restrição termina quando o WhatsApp volta a conectar.
`),
  e("chat-whatsapp", "botao-whatsapp-do-card", "Botão WhatsApp do card", B, `
O botão WhatsApp do card do cliente escolhe o destino conforme o estado do seu WhatsApp:

- Conectado: abre a conversa no Chat do CRM.
- Desconectado ou com restrição: abre o WhatsApp Web, no computador, ou o aplicativo, no celular.

Se o estado ainda está carregando, ou durante a reconexão, o botão abre o Chat.

Abrir fora do CRM não conecta o seu WhatsApp. O clique continua registrando o contato.
`),
  e("chat-whatsapp", "responder-clientes", "Conversas e envio de mensagens", B, `
Pelo Chat você conversa com os clientes e envia mensagens, arquivos e mídias.

O WhatsApp permite mensagem livre só dentro de 24 horas depois da última mensagem do cliente. Passado esse prazo, só é possível enviar um modelo aprovado.

Os modelos de mensagem ficam disponíveis no próprio Chat. Áudios recebidos podem ser tocados direto na conversa.
`),
  e("chat-whatsapp", "guia-de-atendimento", "Guia de Atendimento", B, `
O Guia de Atendimento fica ao lado do Chat e ajuda a conduzir a conversa. Você escolhe a objeção que o cliente trouxe e o guia mostra o próximo passo.

- Cada passo traz orientação, um argumento sugerido e uma mensagem pronta, com botão para copiar.
- Todo atendimento pendente deve terminar com um próximo passo e uma data de retorno, que vira compromisso na Agenda.
- O guia lembra onde você parou em cada cliente.
`),

  // ---------------- AGENDA ----------------
  e("agenda", "compromissos", "Compromissos e atividades", B, `
Cada cliente pode ter várias atividades agendadas ao mesmo tempo.

Ao reagendar uma atividade, o CRM cria uma nova e marca a anterior como reagendada, mantendo o histórico.

Cliente com atividade futura agendada não é considerado pendente.
`),

  // ---------------- SIMULAÇÃO E JORNADA ----------------
  e("simulacao-jornada", "simulacao-financiamento", "Simulação de financiamento", B, `
O cliente pode fazer a simulação pelo formulário público ou pelo Atendimento Rápido, que é uma versão mais curta.

O status "Simulação realizada" só vale quando há valor de financiamento ou subsídio na simulação. Sem esses valores, o cliente não é movido para essa etapa.
`),
  e("simulacao-jornada", "aprovacao", "Aprovação", B, `
Ao marcar o cliente como aprovado, o CRM grava a data da aprovação.

Quando você envia a documentação à CCA, o cliente passa para "Aguardando aprovação".
`),
  e("simulacao-jornada", "jornada-do-cliente", "Jornada do cliente", B, `
"Minha Jornada" é uma página pública, aberta por um link exclusivo do cliente, que mostra em que etapa ele está. O progresso mostrado nunca volta para trás.

O aviso ao cliente feito pelo CRM registra que você acionou o envio. Não é confirmação de que a mensagem chegou.
`),
  e("simulacao-jornada", "links-de-captacao", "Link pessoal e gerador de links", B, `
Cada corretor tem um link pessoal. Clientes que se cadastram por ele ficam direto com você.

O gerador de links cria links de campanha com origem identificada. Se uma campanha for desativada, o cadastro continua funcionando pelo fluxo comum.

O link pode abrir direto na simulação ou numa tela de escolha. O CRM guarda por 30 dias a campanha de quem acessou o link.
`),

  // ---------------- DOCUMENTAÇÃO ----------------
  e("documentacao", "documentos-do-cliente", "Envio dos documentos", B, `
Os documentos do cliente podem ser enviados em lote, de uma vez só, na ficha de documentação.

Depois do envio, o CRM faz a análise e mostra o que está completo e o que falta.
`),
  e("documentacao", "analise-dos-documentos", "Análise dos documentos", B, `
A análise usa inteligência artificial para identificar cada documento enviado. Quem decide o que falta é o CRM, a partir dos dados do cadastro do cliente (estado civil, tipo de renda, filhos).

O CRM só cobra o que está nas regras de documentação. Reanálise sem documento novo é gratuita.
`),
  e("documentacao", "pendencias", "Pendências e devolutiva", B, `
Quando faltam documentos, o CRM monta uma mensagem de pendências. Você pode editar o texto e enviá-la ao cliente pela própria conversa no Chat.
`),
  e("documentacao", "envio-a-cca", "Relatório em PDF e envio à CCA", B, `
O CRM gera um PDF com a ficha do cliente e os documentos reunidos. A opção "Pasta" mantém os arquivos originais em um pacote com a ficha em PDF.

Ao enviar, você escolhe o formato e a CCA. Se houver pendências, o CRM pede confirmação. Depois do envio, o cliente vai para "Aguardando aprovação" e o CRM abre um link do WhatsApp com a mensagem pronta; nada é enviado automaticamente.
`),

  // ---------------- RANKING ----------------
  e("ranking-desempenho", "pontuacao", "Meta e bônus do dia", B, `
Bater a Meta Diária dá pontos extras no ranking:

- 100% da meta: +15 pontos;
- 200% da meta: +30 pontos. Acima de 200% continua +30.

Entre 100% e 200% o bônus cresce proporcionalmente. Os pontos de prospecção têm um teto de 200% da sua cota do dia; acima disso você segue prospectando e a contagem sobe, mas os pontos não.
`),
  e("ranking-desempenho", "ranking", "Melhor do Dia e Campeão da Semana", ALL, `
O ranking destaca o Melhor do Dia, que só aparece se o líder tiver pontuação positiva.

Toda segunda-feira, às 00:01, a semana anterior (segunda a domingo) é fechada e o Campeão ou a Campeã da Semana é definido. O destaque fica fixo durante a semana.
`),
  e("ranking-desempenho", "reconhecimentos", "Reconhecimentos com animação", B, `
Quando você alcança um marco, o CRM mostra uma animação na tela, que se fecha sozinha em poucos segundos.

Exemplos de marcos: bater a Meta Diária (100%, 150%, 200%), chegar em 1º no ranking, sequência de dias e recorde pessoal.
`),

  // ---------------- OUTROS ----------------
  e("outros", "roleta-de-leads", "Como recebo clientes novos", B, `
Clientes que chegam pelo link geral do site entram na roleta de leads e são distribuídos entre os corretores.

Só participam da distribuição os corretores que estão on-line no momento. Se não houver ninguém on-line, o cliente aguarda numa fila de espera até alguém ficar disponível.

Cadastros feitos pelo seu link pessoal vão direto para você, sem passar pela roleta.
`),
  e("outros", "imoveis-empreendimentos", "Imóveis, empreendimentos e depoimentos", B, `
Você pode cadastrar imóveis, empreendimentos e depoimentos. O cadastro entra como não publicado.

A publicação no site é feita pela administração.
`),
  e("outros", "mensagem-diaria", "Mensagem diária", ALL, `
A mensagem diária é um cartão motivacional que aparece uma vez por dia. Ela não tem relação com a Meta Diária.
`),
  e("outros", "central-de-alertas", "Alertas e notificações", ALL, `
O CRM avisa você por vários caminhos:

- o sino de notificações, com os avisos do dia a dia;
- notificações push, quando ativadas no seu aparelho;
- um som quando chega um cliente novo pelo formulário do site.
`)
]);

// ---------------- NOVIDADES (sempre rascunho; o dono aprova e publica) ----------------
export const MANUAL_SEED_NEWS = Object.freeze([
  {
    slug: "meta-diaria-carteira-50",
    title: "Meta Diária: carteira de até 50 clientes",
    audiences: ["broker"],
    body: "Agora sua carteira diária terá no máximo 50 clientes. Quem já possui mais de 50 não perderá nenhum cliente; novos serão adicionados somente quando ficar abaixo desse limite. A cota diária de novos contatos passou a ser 10."
  },
  {
    slug: "whatsapp-restricao-informada-validada",
    title: "WhatsApp: restrição informada e validada",
    audiences: ["broker"],
    body: "Se seu número do WhatsApp for restringido, você pode informar no modal do WhatsApp, no cabeçalho, confirmando a mensagem. Informar não muda nada na Meta Diária nem na Prospecção. O CRM informa quando a restrição for validada.\n\nQuando a restrição for validada, a Meta Diária passa a funcionar em modo manual e, com 100% da meta, a Prospecção manual é liberada. O envio automático não é liberado.\n\nO tempo perdido é devolvido no mesmo dia, até as 21:00. Se mesmo assim não for possível concluir a meta, o dia é marcado como impactado e sem penalidade."
  },
  {
    slug: "botao-whatsapp-do-card",
    title: "Botão WhatsApp do card",
    audiences: ["broker"],
    body: "O botão WhatsApp do card agora depende do estado do seu WhatsApp. Conectado: abre o Chat do CRM. Desconectado ou com restrição: abre o WhatsApp Web no computador ou o aplicativo no celular."
  },
  {
    slug: "nao-contactar-automatico-mais-preciso",
    title: "Não contactar automático ficou mais preciso",
    audiences: ["broker"],
    body: "O CRM só move o cliente para Não contactar sozinho quando a resposta é um pedido claro, como número errado, \"não sou o cliente\" ou \"não tenho interesse\". Respostas ambíguas, como \"agora não\" ou \"depois\", deixam o cliente em Em atendimento."
  }
]);
