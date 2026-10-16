## Mesa WhatsApp dos corretores, Rodada 3, cadeira WhatsApp/automação (V8)

Trabalhei só lendo: R2-2, R2-3, R3-1, o código em origin/main (45c12fb1) e o Baileys 6.7.24 e 7.0.0-rc14, baixados do npm para o scratchpad. Não editei nada, não gravei no banco e não enviei mensagem.

**Resumo:**
1. **Quedas 500 aos 50 min.** O código mostra uma causa provável: a versão do Baileys que usamos não confirma ao WhatsApp o recebimento de mensagem que falha ao decifrar. A versão nova confirma. Se for isso, a correção é um ajuste pequeno (M) e não envolve número de IP.
2. **"Conflict" com código 401 não é outra sessão aberta.** Quando vem com código 401, o WhatsApp está avisando que o aparelho foi removido.

### (a) V6 e V7, item a item
- V6, espera de 2 h já corrigida: aceito. A rule de 16/10 confirma.
- V6, reativação é projeto G: aceito. A V7 reforça: são 341 cadastros, que acabam em ~4 dias úteis. Proponho tirar das fases. A base importada continua sendo o volume, então os textos neutros passam a ser urgentes.
- V6, manter *SAIR* e 10/10/10: aceito, retiro a troca. Rebato só a contagem. A V6 contou 7/2/1 modelos a reescrever; eu conto 9/2/1. Na 1ª tentativa, "Você chegou a comprar seu imóvel?" e "ainda pensa" já supõem interesse anterior. Na 2ª e na 3ª, o "ainda" vale, porque se refere à nossa própria mensagem anterior.
- V6, navegador: aceito. `creds.registered` só fica verdadeiro no pareamento por código (Baileys messages-recv.js:435). O teste vale só para pareamento novo (sessions.js:434).
- V6, IP fixo concentra o risco: aceito. A V7 refuta queda geral do servidor. Os 50 min parecem coisa do protocolo, não do IP, então o gasto com IP fica para depois.
- V6, defeito no CSV do Oficial e 3ª tentativa manual com impacto na carteira: aceito. A V7 mostra que hoje ainda há 3ª tentativa automática na fila.
- V7, fila: aceito a checagem às 15h de hoje.
- V7, recibos chegando antes do envio: aceito que é corrida de gravação. Discordo da folga de ±10 s. Melhor comparar o recibo com `send_started_at`, que já existe e é a referência certa.
- V7, "detail desde 15/10": **rebato**. O `detail` só começou a ser gravado em 15/10 06:49 (commit 2d52451d). Não quer dizer que o erro começou nesse dia.
- V7, "classificar o 401 por conflict": rebato. Ver (b). O que separa os casos é o tipo dentro do `conflict`.
- V7, Bencke com 80 % de recibo e mesmo assim 403: aceito. O recibo sozinho não serve de alarme.
- V7, teste de IP com mais de 1 número: aceito, e passa a vir depois da correção dos 50 min.

### (b) Quedas 500 aos 50 min e o 401 da Caroline
**Como o código monta a queda.** `getErrorCodeFromStreamError` (Baileys Utils/generics.js:266-283) usa o código que vem no nó; sem código, cai em 500. O `detail` "stream:error.ack.text" quer dizer que o WhatsApp derrubou a sessão reclamando de um `<ack>` de mensagem do tipo text, media ou reaction, que são tipos de mensagem recebida.

**Causa provável.** No 6.7.24 (Socket/messages-recv.js:610-700), a mensagem recebida só é confirmada pelo recibo. Quando a mensagem não decifra, o Baileys pede reenvio. Depois de 5 pedidos, `sendRetryRequest` (:90-94) **sai sem mandar nada**. Se der exceção, também não confirma (:701). O 7.0.0-rc14 corrigiu isso: ele manda `sendMessageAck(node, NACK_REASONS.UnhandledError)` depois da falha e no `catch` (:1386-1438).

**Por que 50 min certinhos.** Hipótese: o WhatsApp entrega mensagens pendentes logo ao conectar. Uma delas fica sem confirmação. Ele espera cerca de 50 min e derruba a sessão. Ao reconectar, entrega a mesma mensagem de novo, e o ciclo se repete. Isso explica um relógio fixo por número.

**Também ajuda a esconder o problema:**
- o log do Baileys está em `silent` (sessions.js:73);
- não há `getMessage` (padrão `async () => undefined`, Defaults:57). Então, quando o celular do cliente pede reenvio de mensagem **nossa**, nunca recebe. Isso pode explicar parte dos 48 % sem recibo. É hipótese, ainda não medida.

**Ajuste candidato:**
- Diagnóstico passivo (P): gravar `class`/`id` (com hash) do ack no `detail` e contar, na telemetria, mensagens recebidas que não decifraram e pedidos de reenvio das nossas mensagens.
- Correção (M): `pnpm patch` no 6.7.24 copiando a confirmação do rc14, mais um teste unitário com nó falso.
- Depois, `getMessage` com cache em memória de 24 h (M).
- Atualizar para a v7 seria G (mudanças de LID); fica fora.

**Como testar sem enviar nada:** publicar só o diagnóstico e observar as sessões que já existem. Depois da correção, medir em 2 dias úteis a fatia de quedas 500 entre 49,9 e 50,2 min. Hoje é 58 %; se a hipótese estiver certa, deve ir para perto de 0.

Secundário: `markOnlineOnConnect` usa o padrão (true). A sessão aparece "online" o tempo todo, e isso pode fazer o celular do corretor deixar de mostrar notificações. É um candidato a medir, não uma conclusão.

**401 "Stream Errored (conflict)" da Caroline.** O código no nó vem antes do CODE_MAP. `conflict` sem código seria 440 (`replaced` = outra conexão com as mesmas credenciais). Com código 401, é quase certo `conflict type="device_removed"`: o aparelho foi removido, pelo celular ou pelo WhatsApp. Não é um segundo processo: o lease garante um só, e uma sobreposição durante deploy daria 440.

Foi às 06:40 de São Paulo, 5 s depois de um envio. Aponta para remoção pelo antifraude do WhatsApp (hipótese, n = 1). Dados deve confirmar o `detail` na telemetria. Se não estiver lá: `session_events` não guarda `errorData`, e incluir o `detail` no `notifyStatus` é P.

### (c) Textos neutros (lib/daily-goal-policy-messages.mjs, substituir na mesma posição)
Conferi por script contra as regras do `tests/daily-goal-policy-v2.test.mjs`: curto ≤ 200, longo ≥ 300, *SAIR* na última linha, nenhuma palavra proibida, só as 3 variáveis, sem emoji. Deu 0 falhas.
- 1ª tentativa, modelo [0] (curto): "{saudacao} {primeiro_nome}, tudo bem? Sou {nome_corretor}, da equipe do corretor Matheus Machado. Comprar um imóvel está nos seus planos?\n\nSe não quiser receber mensagens, responda *SAIR*."
- 1ª tentativa, modelo [1] (longo): "{saudacao} {primeiro_nome}, tudo bem? Meu nome é {nome_corretor} e faço parte da equipe do corretor Matheus Machado, da Matheus Machado Imóveis.\n\nNossa equipe ajuda quem quer comprar o primeiro imóvel, explicando cada etapa com calma. Queria saber se comprar um imóvel faz parte dos seus planos ou se esse assunto não é para você.\n\nSe preferir não receber nossas mensagens, é só responder *SAIR*."
- 1ª tentativa, modelo [3] (longo): "{saudacao} {primeiro_nome}, como você está? Me chamo {nome_corretor} e trabalho com o corretor Matheus Machado.\n\nEstou conversando com algumas pessoas para entender quem pensa em comprar um imóvel, seja o primeiro ou uma troca. Posso te perguntar se isso faz parte dos seus planos? Qualquer resposta já me ajuda.\n\nNão quer receber nossas mensagens? Responda *SAIR*."
- 1ª tentativa, modelo [4] (curto): "{saudacao} {primeiro_nome}, tudo certo? Me chamo {nome_corretor}, da Matheus Machado Imóveis. Você pensa em comprar um imóvel?\n\nSe não quiser receber, responda *SAIR*."
- 1ª tentativa, modelo [5] (longo): "{saudacao} {primeiro_nome}, tudo bem? Aqui é {nome_corretor}, da equipe do corretor Matheus Machado.\n\nTrabalho ajudando quem quer comprar um imóvel a entender o caminho, da primeira conversa até a assinatura. Não sei se esse é um assunto para você, por isso prefiro perguntar antes: faz sentido a gente conversar um pouco?\n\nPara não receber mais mensagens, responda *SAIR*."
- 1ª tentativa, modelo [6] (curto): "{saudacao} {primeiro_nome}, como você está? Aqui é {nome_corretor}, da equipe do Matheus Machado Imóveis. Comprar um imóvel está entre os seus planos?\n\nPara não receber mais, responda *SAIR*."
- 1ª tentativa, modelo [7] (longo): "{saudacao} {primeiro_nome}! Meu nome é {nome_corretor} e faço parte da equipe da Matheus Machado Imóveis.\n\nEstou entrando em contato para me apresentar e saber se a compra de um imóvel faz parte dos seus planos. Se fizer, posso te explicar com calma como funciona; se não fizer, tudo bem também, é só me avisar.\n\nSe não quiser receber mais nossas mensagens, responda *SAIR*."
- 1ª tentativa, modelo [8] (curto): "{saudacao} {primeiro_nome}, tudo bem? Aqui é {nome_corretor}, do Matheus Machado Imóveis. Trabalho com compra de imóveis: esse é um assunto para você?\n\nSe preferir não receber, responda *SAIR*."
- 1ª tentativa, modelo [9] (longo): "{saudacao} {primeiro_nome}, tudo bem? Sou {nome_corretor}, da equipe do corretor Matheus Machado.\n\nQuero respeitar o seu tempo, então vou direto: comprar um imóvel é algo que você pensa em fazer, agora ou mais para frente? Com a sua resposta eu sei se faz sentido continuar a conversa ou se paro por aqui.\n\nSe quiser parar de receber, é só responder *SAIR*."
- 2ª tentativa, modelo [7] (longo): "{saudacao} {primeiro_nome}! Aqui é {nome_corretor}, da equipe do corretor Matheus Machado.\n\nTe mandei uma mensagem recentemente e não quis deixar sem retorno. Se a compra de um imóvel estiver nos seus planos, posso te ajudar com isso. Se você já comprou ou não tem interesse, tudo bem, é só me avisar e eu encerro por aqui.\n\nSe não quiser receber nossas mensagens, responda *SAIR*."
- 2ª tentativa, modelo [9] (longo): "{saudacao} {primeiro_nome}, tudo bem? Sou {nome_corretor} e trabalho com o corretor Matheus Machado.\n\nTe escrevi recentemente para saber se a compra de um imóvel faz parte dos seus planos. Se quiser conversar sobre isso, é só me responder aqui e eu te atendo com atenção. Se não for um assunto para você, sem problema.\n\nPara parar de receber, responda *SAIR*."
- 3ª tentativa, modelo [5] (longo): "{saudacao} {primeiro_nome}, tudo bem? Aqui é {nome_corretor}, da Matheus Machado Imóveis.\n\nTe chamei algumas vezes por aqui e não quero insistir. Se comprar um imóvel fizer sentido para você, posso conversar sobre o seu cenário e explicar os próximos passos. Se não fizer, é só me dizer e eu encerro o contato.\n\nPara não receber mais mensagens, responda *SAIR*."

Ficam como estão: 1ª [2]; 2ª [0-6, 8]; 3ª [0-4, 6-9]. Se o dono preferir o critério estreito da V6, mantêm-se também 1ª [0] e [6].

### (d) VERSÃO 8
1. **Prospectar.** 15 por dia, pelo Número de prospecção, 8h–18h. A base importada continua, **com os 12 textos neutros**. A reativação dos 341 sai das fases (G para ~4 dias de volume). Antes de qualquer outra coisa: corrigir as quedas de 50 min, porque cada uma é um login novo no WhatsApp, mais de 10 por dia por número.
2. **Detectar cedo.** Diagnóstico passivo dos acks e dos pedidos de reenvio (P) → corrida dos recibos usando `send_started_at` (P) → 401 separado pelo tipo do `conflict` (`device_removed` × `replaced`) → marca "em risco": 401 `device_removed` em até 5 min depois de um envio = não refazer o QR no mesmo dia → A1 só depois de calibrado.
3. **Voltar rápido.** Tabela da V5, mais um item: 401 `device_removed` logo após um envio → lista impressa no dia e QR só no dia seguinte. A gestora resolve hoje as 4 pausas e o caso do Eduardo.
4. **Reserva.** Sem mudança: sem rodízio; Número 2 de relacionamento; chip reserva só se o dono pagar.
5. **Salvar/responder.** 1ª mensagem sem link e com pergunta; o link só depois da resposta, junto com o pedido para salvar o contato; *SAIR* continua. Com o `getMessage` em cache, o reenvio pedido pelo celular do cliente passa a funcionar (para quem não salvou o número, isso é hipótese).

**Decisões do dono (por prioridade):**
1. Autorizar a publicação, no Railway, do diagnóstico passivo e depois da correção das confirmações de mensagem do Baileys (nenhum envio; M).
2. Aprovar os 12 textos neutros.
3. Base: manter a importada como volume principal, ciente do risco pelos Termos, e arquivar a reativação dos cadastros próprios.
4. Liberar ou negar as 4 pausas e o "Usar para disparo" do Eduardo.
5. 3ª tentativa só manual, sabendo que ocupa a carteira de 30.
6. Teste de pareamento novo, e IP fixo só depois de medir o efeito da correção dos 50 min.

Arquivos citados:
- /home/user/imoveis-mvp/whatsapp-individual-service/src/sessions.js (linhas 73, 408-437)
- /home/user/imoveis-mvp/whatsapp-individual-service/src/reconnect-policy.js (linhas 17-18, 407-422)
- /home/user/imoveis-mvp/lib/daily-goal-policy-messages.mjs
- /home/user/imoveis-mvp/tests/daily-goal-policy-v2.test.mjs (linhas 501-541)

Baileys e o script de checagem dos textos, no scratchpad:
- /tmp/claude-0/-home-user-imoveis-mvp/dcd2978e-8bf8-5388-9b95-cb62ddb37c33/scratchpad/baileys/package/lib/Socket/messages-recv.js
- /tmp/claude-0/-home-user-imoveis-mvp/dcd2978e-8bf8-5388-9b95-cb62ddb37c33/scratchpad/baileys/v7/package/lib/Socket/messages-recv.js
- /tmp/claude-0/-home-user-imoveis-mvp/dcd2978e-8bf8-5388-9b95-cb62ddb37c33/scratchpad/chk/check.mjs