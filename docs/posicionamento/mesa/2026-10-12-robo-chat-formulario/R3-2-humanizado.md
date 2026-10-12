# Rodada 3 — Cadeira Atendimento humanizado (Versão 12 + texto final do Guia)

## Respostas à V7
Aceita: B9 pela pessoa (Guia); uma vez por período fechado; "assim que possível" (1º corretor on-line 08h05 mediana; pior espera 22 h); A1 única ("te manda o resultado" é verdade para quem preenche); 10 h condicional ("te responde").

## Questionamentos à V11
1. "Bom dia" + texto da etapa às 8 h: se a etapa é a de 10 h, o cliente lê "última mensagem" e 5 min depois o corretor escreve → texto fixo às 8 h; 10 h vira "último lembrete sobre o link".
2. Outra cidade em "Tentando contato" mantém o alerta "Sem contato há +3 dias" (`lib/client-status.js:397-407`) e empurra a insistir → crm-editor tira a tag OUTRA CIDADE do alerta (Fase 2); até lá, Guia diz "não insistir".
3. D "neste mesmo número": há WhatsApp individual de corretor → removido (não verificado).
4. "Devolver para a roleta" à mão não grava o aviso "não respondeu às mensagens automáticas" → Guia ensina a reconhecer (cliente de anúncio só com mensagens automáticas).

## VERSÃO 12
Regras: voz "a equipe", plural, ≤ 1 emoji; nada para Não contactar/arquivado/Particular/equipe; Botão "Fazer simulação" → `/s` (segurado: genérico); fora = fora de seg–sáb 8h–19h; {{saudacao}} = Bom dia/Boa tarde/Boa noite; sem nome: tira vírgula e nome.
**FH (frase de horário):** "Nosso atendimento é de segunda a sábado, das 8h às 19h; fora desse horário, a equipe responde assim que possível. Se esse horário não der pra você, é só avisar que a gente combina outro."

**A. Anúncio (Oficial), 1 envio**
- A1 horário: "{{saudacao}}{{, Nome}}! Aqui é da equipe do Matheus Machado Imóveis 😊 Pra montar sua simulação (quanto você pode financiar e o valor da parcela), é só tocar em Fazer simulação, aqui embaixo, e responder umas perguntas rápidas. Não pede CPF nem documento, e é sem compromisso. Assim que você enviar, um especialista da nossa equipe te manda o resultado por aqui. Se preferir, pode mandar sua dúvida aqui mesmo, escrita ou em áudio." + Botão
- A1 fora: mesmo texto até "...te manda o resultado por aqui." + FH + Botão

**B. Depois do link**
- Horário: nada automático (Guia M1–M5).
- Fora (uma vez por período fechado; texto, áudio, imagem, vídeo, documento; não reação/figurinha):
  - Não preencheu: "Recebemos sua mensagem{{, Nome}}! " + FH + " Se quiser adiantar, a simulação não pede CPF e não consulta seu nome:" + Botão
  - Já preencheu: "Recebemos sua mensagem{{, Nome}}! " + FH (sem botão)
- B12 (antes da liberação e da resposta fora do horário): "Tudo bem{{, Nome}}. Não vamos mais te mandar mensagens. Se um dia quiser conversar, é só chamar aqui." → Não contactar.

**C. Lembretes do anúncio 1 h / 3 h / 10 h** (21h–8h → uma mensagem às 8 h; ≥ 2 h entre lembretes)
- 1 h: "{{Nome}}, conseguiu abrir o link da simulação? Se ficou alguma dúvida, é só mandar aqui, escrita ou em áudio." / sem nome: "Conseguiu abrir o link da simulação? Se ficou alguma dúvida, é só mandar aqui, escrita ou em áudio."
- 3 h: "Só lembrando: com a simulação você já fica sabendo quanto pode financiar e a parcela pro seu caso. Não pede CPF e é sem compromisso. É só tocar em Fazer simulação, na primeira mensagem que te mandamos."
- 10 h (só se ninguém da equipe escreveu): "{{Nome}}, esse é nosso último lembrete sobre o link da simulação 🙂 Se você trabalha sem carteira ou não tem nada guardado, pode fazer do mesmo jeito. Se preferir conversar, é só responder aqui que a nossa equipe te responde." / sem nome: "Esse é nosso último lembrete sobre o link da simulação 🙂 ..."
- **8 h (texto fixo, substitui qualquer etapa pendente):** "Bom dia{{, Nome}}! Passando pra lembrar da simulação que te mandamos: ela mostra quanto você pode financiar e a parcela, sem CPF e sem compromisso. Se ficou alguma dúvida, é só responder aqui, escrita ou em áudio."
- Lembrete único (WA-17; regra 8 h e 2 h): "Oi{{, Nome}}, tudo bem? Sua simulação ainda está em aberto. Ficou alguma dúvida ou teve dificuldade com o link? Se preferir, a gente te ajuda por aqui."
- **Transferência:** A1 + 3 h (21h–8h → 8 h; domingo igual, fila se ninguém on-line); só se não respondeu, não preencheu e ninguém da equipe escreveu → roleta (WA-18), sem mensagem ao cliente, sem aviso à gestão, `via: anuncio_silencio`; corretor recebe "não respondeu às mensagens automáticas". Até a Fase 2: "Devolver para a roleta".

**D. Pós-formulário**
- Horário: "Recebemos seu cadastro{{, Nome}}! Obrigado pela confiança. Agora um especialista da nossa equipe vai preparar sua simulação e te chamar por aqui."
- Fora: "Recebemos seu cadastro{{, Nome}}! Obrigado pela confiança. Um especialista da nossa equipe vai preparar sua simulação e te chamar por aqui. " + FH

**E. Sem anúncio:** "{{saudacao}}{{, Nome}}! Aqui é da equipe do Matheus Machado Imóveis. Como podemos te ajudar?" [Fazer simulação] [Já sou cliente] [Tenho uma dúvida]
- Fazer simulação: "Pra montar sua simulação (quanto você pode financiar e o valor da parcela), é só tocar em Fazer simulação, aqui embaixo. Não pede CPF nem documento, e é sem compromisso. Assim que você enviar, um especialista da nossa equipe te manda o resultado por aqui." (+ FH se fora) + Botão
- Já sou cliente: "Que bom falar com você de novo! Já avisamos quem cuida do seu atendimento, que te responde por aqui." (+ FH se fora) → `base_roulette`
- Tenho uma dúvida: "Pode mandar sua dúvida por aqui, escrita ou em áudio, que a nossa equipe te responde." (+ FH se fora) → pessoa
- Sem resposta → encerra.

**F.** Corretor sem automação; TESTE fica. **G.** Guia abaixo. **H.** Outra cidade só pela pessoa, após confirmar que não quer Marília → tag OUTRA CIDADE + Tentando contato; nunca arquivar/Não contactar; relatórios excluem a tag.
Fases e painel = V11, + Fase 2 item 4 (texto fixo 8 h e novo 10 h) + alerta +3 dias sem a tag OUTRA CIDADE.

## TEXTO FINAL DA ENTRADA DO GUIA (guia "Lead — patrocinado")
**Título:** Lead de anúncio: primeira resposta (texto ou áudio)
**Descrição:** Cliente que chegou pelo anúncio da simulação no WhatsApp e escreveu ou mandou áudio, ou que não respondeu e chegou a você pela roleta. Responder a dúvida primeiro, oferecer os dois caminhos (conversa ou link) e combinar o próximo passo com data.

Formato do seed (`{id, type, phase, title, guidance, argument, message, options:[[rótulo, destino]]}`; ref = `{type:"ref", entry, next, label}`; `guideId` dos ref = id do guia "Banco de objeções"). Única mudança em card existente: 2 respostas novas no card de recepção (`l-recepcao` ou o que sai do início no `published_graph`):
- ["Veio do anúncio da simulação e escreveu ou mandou áudio", "la-m1"]
- ["Veio do anúncio e não respondeu (chegou pela roleta)", "la-silencio"]

```
la-m1 | card | abertura | "Lead de anúncio: primeira resposta (texto ou áudio)"
 guidance: "Use quando o cliente veio do anúncio da simulação e escreveu ou mandou áudio. Responda rápido. Áudio: ouça inteiro antes de responder. Logo depois da mensagem abaixo, responda o que ele perguntou em 1 ou 2 frases. Nunca prometa aprovação, valor de parcela, taxa ou prazo de banco, e não invente número: se depende da análise, diga isso. Ele já recebeu mensagens automáticas da equipe: não repita o link agora."
 argument: "Quem pergunta quer ser ouvido antes de ser cadastrado. Responder a dúvida primeiro mostra que tem uma pessoa do outro lado."
 message: "Oi, [Nome]! Aqui é [o_a] [Corretor], da equipe do Matheus Machado Imóveis. Recebi sua mensagem 😊"
 options: ["Dúvida respondida", la-m2] ["Disse que é de outra cidade", la-cidade] ["Trouxe uma objeção (nome, renda, entrada…)", la-m4] ["Pediu para não receber mensagens", la-fim-parar]

la-silencio | card | abertura | "Lead de anúncio que não respondeu (chegou pela roleta)"
 guidance: "Use quando o CRM avisar que o cliente 'não respondeu às mensagens automáticas', ou quando receber um cliente de anúncio que só tem mensagens automáticas no Chat. Ele já recebeu o link e lembretes; de manhã, recebeu um 'Bom dia' automático minutos antes de você. Antes de mandar, confira no Chat se ninguém da equipe já escreveu. Não reenvie o link e não cobre resposta: apresente-se como quem vai acompanhar e faça uma pergunta fácil. Se já passou mais de 1 hora desde o último lembrete, tire 'Agora há pouco'."
 argument: "Depois de mensagens automáticas, uma apresentação com nome mostra que tem gente de verdade cuidando do caso dele."
 message: "Oi, [Nome]! Aqui é [o_a] [Corretor], da equipe do Matheus Machado Imóveis. Agora há pouco te mandamos um lembrete da simulação, e sou eu que vou cuidar do seu atendimento. Ficou alguma dúvida? Pode me responder por aqui, escrita ou em áudio, do jeito que for melhor pra você."
 options: ["Respondeu (responda a dúvida primeiro)", la-m2] ["Disse que é de outra cidade", la-cidade] ["Continua sem responder", @la-r-nao-responde] ["Pediu para não receber mensagens", la-fim-parar]

la-m2 | card | investigar | "Oferecer os dois caminhos: conversa ou link"
 guidance: "Deixe o cliente escolher. Quem prefere conversar segue sem formulário: não insista no link."
 argument: "Muita gente trava em formulário, e outros preferem não falar. Dar a escolha tira a pressão."
 message: "Pra te mostrar quanto você pode financiar e o valor da parcela, preciso de algumas informações rápidas. Prefere me responder aqui mesmo (pode ser por áudio) ou pelo link da simulação?"
 options: ["Prefere responder aqui", la-m3] ["Prefere o link", la-link] ["Trouxe uma objeção", la-m4]

la-m3 | card | investigar | "Coletar as informações pelo chat"
 guidance: "Pergunte só isto, de uma vez ou aos poucos, como o cliente preferir. Não peça CPF nem documento nesta etapa. Registre as respostas no cadastro do cliente no CRM."
 argument: "São as mesmas perguntas do formulário: com elas a simulação sai igual, sem o cliente precisar abrir link."
 message: "Então me conta:\n1) Você trabalha registrado, declara imposto de renda ou é autônomo? Quanto ganha por mês, mais ou menos?\n2) Vai comprar sozinho(a) ou com mais alguém?\n3) Tem algum valor guardado ou FGTS? Se não tiver nada, tudo bem, pode falar.\n4) Já tem algum imóvel no seu nome?"
 options: ["Respondeu tudo", la-m5] ["Trouxe uma objeção", la-m4] ["Parou de responder", @la-r-nao-responde]

la-link | card | solucionar | "Cliente prefere o link"
 guidance: "Indique o botão Fazer simulação da primeira mensagem que ele recebeu. Quando ele enviar, a sua primeira mensagem é a simulação."
 argument: "O link já está na conversa: ele não precisa procurar nada."
 message: "Combinado! É só tocar em Fazer simulação, na primeira mensagem que te mandamos aqui. Assim que você enviar, eu preparo sua simulação e te mando por aqui."
 options: ["Enviou o formulário", la-m5] ["Ficou de enviar depois", la-retorno]

la-m4 | card | objecao | "Objeção logo no começo"
 guidance: "Não discuta nem prometa. Agradeça, entenda o motivo e use o Banco de objeções. Depois, volte ao próximo passo."
 argument: "Quem conta a objeção logo no início ainda tem interesse."
 message: "Entendi, [Nome], obrigado por me contar. Me explica um pouco melhor, pra eu te orientar do jeito certo?"
 options: ["Nome com restrição", @la-r-restricao] ["Renda baixa / autônomo / sem carteira", @la-r-renda] ["Sem entrada", @la-r-sem-entrada] ["Outra", @la-r-outra]

la-r-restricao | ref | entry obj-restricao | next la-m5 | "Nome com restrição"
la-r-renda | ref | entry obj-renda-baixa | next la-m5 | "Renda baixa / autônomo"
la-r-sem-entrada | ref | entry obj-sem-entrada | next la-m5 | "Sem entrada"
la-r-outra | ref | entry obj-outra | next la-m5 | "Outra objeção"
la-r-nao-responde | ref | entry obj-nao-responde | next la-m2 | "Não responde"

la-m5 | card | retorno | "Combinar o próximo passo"
 guidance: "Nenhuma conversa termina sem próximo passo e data. Combine um período que você consiga cumprir (se não der no horário de atendimento, combine outro). Se aqui ele disser que é de outra cidade, use a resposta abaixo."
 argument: "Quando o cliente escolhe o horário, ele se compromete junto."
 message: "Com isso eu já monto sua simulação e te mando por aqui. Qual período fica melhor pra você ver comigo: manhã, tarde ou noite?"
 options: ["Combinou o período", la-retorno] ["Disse que é de outra cidade", la-cidade]

la-retorno | followup | defaultDays 1 | "Registrar o retorno combinado"
 guidance: "Salve a atividade na data combinada. Se ele não aparecer, use 'O cliente não responde' do Banco de objeções."
 message: "Combinado, [Nome]! Então a gente se fala no período que você escolheu. Qualquer dúvida antes disso, é só chamar aqui."

la-cidade | card | investigar | "Outra cidade: confirmar se quer comprar em Marília"
 guidance: "Use só quando o cliente disser que mora ou quer imóvel em outra cidade. Não decida pelo DDD. Atendemos quem é de fora e quer comprar em Marília."
 argument: "Morar em outra cidade não impede de comprar em Marília. A pergunta evita perder quem pretende se mudar."
 message: "Só pra eu entender, [Nome]: você pensa em comprar aqui em Marília?"
 options: ["Sim, em Marília", la-m2] ["Ainda não sabe", la-m2] ["Não, só em outra cidade", la-outra-cidade]

la-outra-cidade | card | encerramento | "Outra cidade: despedida sem arquivar"
 guidance: "Mande a mensagem e, no CRM, marque a tag OUTRA CIDADE e o status Tentando contato. NUNCA arquive: a conversa sai do Chat e o cliente se perde se voltar a escrever. NUNCA marque Não contactar: é só para quem pediu para não receber mensagem. Não agende cobrança nem insista. Se ele voltar a escrever, atenda normalmente."
 argument: "Uma despedida educada deixa a porta aberta."
 message: "Entendi, [Nome]! Nosso trabalho é com imóveis aqui em Marília, então pra outra cidade não vamos conseguir te ajudar agora. Se um dia pensar em Marília, é só chamar aqui."
 options: ["Mensagem enviada, tag e status marcados", la-fim-outra]

la-fim-outra | end | "Encerrado: outra cidade" | guidance "Tag OUTRA CIDADE + Tentando contato. Não arquivar." | outcome "Outra cidade — porta aberta"
la-fim-parar | end | "Pediu para não receber mensagens" | guidance "Marque Não contactar (se o CRM ainda não marcou sozinho) e não mande mais nada, nem por outro número." | outcome "Não contactar"
```
Limites: títulos ≤ 120, textos ≤ 2.500, ≤ 20 respostas/card; marcadores só `[Nome]`, `[o_a]`, `[Corretor]` (`fillPlaceholders`).

## Para WhatsApp e automação
Texto fixo das 8 h em `lib/whatsapp-form-reminder-core.mjs` L100-105/`currentReminderStep` + teste "lead às 20h → texto das 8 h, nunca o de 10 h"; corretores respondem lead de anúncio só pelo Chat Oficial? (senão "por aqui" muda); botão da A1 mantém o mesmo atendimento; alerta +3 dias sem tag OUTRA CIDADE; "Já avisamos" (E) só se `base_roulette` notifica; ordem B12 → liberação → Fluxo → fora do horário, uma vez por período mesmo com várias mídias; WA-17 com 8 h e 2 h.
