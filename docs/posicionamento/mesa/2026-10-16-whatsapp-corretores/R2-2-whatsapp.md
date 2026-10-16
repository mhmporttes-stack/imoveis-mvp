# Rodada 2 — Cadeira WhatsApp e automação (Versão 5)

Especialistas consultados: nenhum. Trabalhei como a cadeira WhatsApp e automação da rodada 2, conferindo direto no código. Não enviei nada, não alterei nada e não gravei arquivo.

Conclusão consolidada: a primeira coisa a fazer é destravar a fila. O código confirma a causa: **toda reconexão comum reinicia a espera de 2 h.** Mexer em volume, IP ou textos só faz sentido depois disso. Também encontrei um erro no próprio pedido: o formato `({associado_a})` sugerido para os textos não funciona. Para a base, minha recomendação é **reativar os ~3.500 cadastros próprios** no lugar da base importada.

## (b) O que o código mostra
1. **A espera de 2 h reinicia em toda reconexão (confirmado).** `lib/whatsapp-individual.js:77` grava `last_connected_at` sempre que o status vira "connected", seja depois de QR, de queda 428/500/503 ou de reinício do serviço. A espera usa esse campo (`reconnectReadyAtMs`, `lib/daily-goal-policy-core.mjs:66`; `loadV2ConnectedAtMs`, `lib/daily-goal-auto.js:1015`), e a rule já descreve isso como comportamento atual não confirmado pelo dono. Com reconexões a cada ~50 min, a espera de 2 h nunca chega ao fim. O `/diagnosticar-producao` ainda precisa confirmar que isso explica 14–15/10.
2. **Quedas 500 depois de ≥ 30 min: nada no nosso código causa isso.** Não há proxy, não há reinício periódico do socket, o sinal de "estou vivo" é o padrão do Baileys (não configurado) e a tarefa que roda a cada 2 min só corrige sessões travadas, sem derrubar nenhuma (`reconcile.js`). No Baileys, o código 500 é o que vem quando o WhatsApp manda um erro sem código conhecido (`reconnect-policy.js:18`). O serviço já grava `detail` (`session-lifecycle.js:40`). Hipóteses: o WhatsApp encerra sessões web longas, ou a rede/servidor da Railway derruba a conexão. Pedido a Dados (é só leitura):
   - o `detail` das quedas 500 desde 14/10;
   - se os 500 acontecem **no mesmo minuto em vários números** (sinal de problema no servidor) ou em horários soltos (sinal de algo por conta).
3. **Teste de IP e identificação.** Usar só número de teste da empresa e só conexão, sem prospecção. Qualquer conversa de teste fica entre números da equipe e precisa do "sim" do dono. Indicador: **"aberturas de sessão seguidas de 401 em até 30 min ÷ total de aberturas"**. A base que temos (8 de 14) conta só as remoções e não serve de denominador; Dados precisa medir a taxa por abertura. Mudar uma coisa por vez:
   - **A. Identificação padrão de navegador**, aplicada já no pareamento. Hoje as sessões retomadas se apresentam como `["CRM Imoveis","Chrome","1.0"]` (`sessions.js:437`). Não trocar em sessão já pareada: `sessions.js:24-27` registra que mudar a identificação no login derrubou sessões. Termos: não muda nada, continua sendo cliente não oficial. Risco operacional baixo.
   - **B. IP fixo de saída.** Continua sendo IP de datacenter. Termos: igual ao A. Custo não documentado no repositório.
   - **C. Proxy residencial por número.** É o de maior risco. Esconder automação para driblar a detecção agrava a violação dos Termos ("acesso automatizado não autorizado"). Um terceiro passa a ver os metadados do tráfego, o que é um ponto de LGPD. E essas redes às vezes usam aparelhos de terceiros, o que é risco ético. Só com ciência expressa do dono, e eu recomendo não fazer.
   - Com n pequeno, o resultado pode sair inconclusivo, e isso será dito assim.

## (a) Objeções contra a minha V2
- **T5 "não é o momento":** aceito. Pela PRO-8, "momento" vai para o humano (`AMBIGUITY_MARKERS`, `lib/prospecting-reply-core.mjs:95`). Tirei o convite ambíguo. A saída virou "responder *não tenho interesse*", frase que o `isClearOptOut` já reconhece (L54).
- **Variáveis:** aceito, com uma correção ao pedido. `({associado_a})` não serve, por três motivos:
  - os modelos v2 (vigentes por padrão) **excluem de propósito** essa variável (`lib/daily-goal-policy-messages.mjs:10`);
  - sem gênero cadastrado, o token entre parênteses não é substituído e o envio é bloqueado (`renderAutoMessage`/`hasUnresolvedVariable`, `lib/daily-goal-auto-core.mjs:306-324`);
  - a variável ignora o CRECI, então chamaria um corretor com CRECI de "associado", contra a regra de tratamento de 24/09.
  
  Solução: `{saudacao} {primeiro_nome}`, `{nome_corretor}` e o texto fixo "da equipe do corretor Matheus Machado".
- **A1 com falso alarme:** aceito. O A1 sai até o conserto dos recibos (D1) e a calibração. Até lá vale a pausa por entrega muito baixa que já existe (10 ou mais enviadas com no máximo 2 entregues).
- **"Não saiu":** retiro o rótulo. Uso "sem recibo", porque pelo menos 11 dessas mensagens tiveram resposta.

## (c) Alternativa de fundo
- **Reativar os cadastros próprios (~3.500).**
  - Prós: são pessoas que deram o número para nós, o que fica mais perto do consentimento que a Política Business exige. O texto pode ser verdadeiro ("você fez um cadastro com a gente"). Hipótese, sem medição: menos denúncias.
  - Contras: a base acaba. Na conta aproximada, ~8 corretores × 15 = até 120 por dia, cerca de 30 dias úteis só de 1ª tentativa. Também precisa excluir Não contactar, clientes em andamento com outro corretor e conversa recente (MD-13).
  - O consentimento do formulário para contato por WhatsApp precisa ser conferido. Não verifiquei.
- **1ª mensagem pelo Oficial, com modelo aprovado.**
  - Prós: é o canal permitido e não expõe os números dos corretores.
  - Contras: tem custo por mensagem de marketing (o valor configurado fica em `crm_settings` `whatsapp_pricing`; não cito número). A Política também exige consentimento, então importados não podem. E denúncias e bloqueios põem em risco o Oficial, que roda o funil do anúncio. O Oficial anterior foi banido em 28/09.
  - Uso possível: só um piloto pequeno com cadastros próprios.
- **Base importada:** se o dono mantiver, o texto **não pode dizer "você demonstrou interesse"** sem saber a origem da lista. Os modelos v2 atuais dizem isso (`daily-goal-policy-messages.mjs:15-23`).

## (d) Onde discordo da V4
1. **"Espera de 2 h só depois de QR novo, 401 ou 403" deixa buracos.** A V4 deixa de fora a retomada depois de pausa por 403, logout ou entrega baixa, e uma volta depois de horas fora (por exemplo, o serviço parado de madrugada). Proponho reiniciar a espera em quatro casos: QR ou pareamento novo; 401; retomada de pausa; queda longa de ≥ 30 min. O corte de 30 min já existe no código para entrega baixa (`LOW_DELIVERY_LONG_OUTAGE_MS`). Para separar esses casos, o CRM precisa saber de onde veio cada conexão (QR ou automática).
2. **A V4 deixa a base como escolha neutra; eu recomendo um lado.** Com 12 contatos com consentimento, a base importada é a maior exposição pelos Termos. Recomendo reativação como padrão e importados pausados até o dono decidir com ciência.
3. **A meta do indicador de 401 precisa de denominador.** "Queda no teste de IP" partindo de 8/14 não mede taxa. É preciso medir "por abertura" antes de comparar.

---
# VERSÃO 5 (os números são exemplos configuráveis; nenhum envio é "seguro" pelos Termos)
**1. Prospectar.**
- Prioridade 1: destravar a espera de 2 h, com os gatilhos da seção (d)1.
- Volume: 15 por corretor por dia, somando os 2 números (é o que o código faz). Envio sai pelo Número de prospecção.
- Base: cadastros próprios primeiro; importados pausados.
- Tentativas: 1ª e 2ª automáticas; a 3ª só manual.
- Horário: 8h–18h. Sábado com teto 5 ou sem envio.
- Conteúdo: sem link, sem promessa, pergunta curta.

**2. Detectar cedo.** Nesta ordem:
- D1 (recibos que se perdem);
- 401 dividido em 3 tipos;
- marca "em risco";
- Dados mede os 500 (`detail` e se acontecem juntos em vários números);
- A1 só depois de calibrar.

**3. Voltar rápido.** Rotina de retomada por tipo de queda:

| Tipo | O que fazer |
|---|---|
| Queda comum 428/500/503 | Nada: o serviço reconecta sozinho e, com a mudança, a espera não reinicia. |
| 401 pareamento falho | Suporte refaz o QR com o corretor, sem penalidade. |
| 401 aparelho removido com a sessão aberta | Corretor confere "Aparelhos conectados" e refaz o QR uma vez. Se cair de novo em até 30 min, não insiste no dia: marca "em risco" e avisa a gestora. |
| 401 sessão recusada ao voltar | Refaz o QR uma vez. |
| 403 | Não tenta reconectar (limite WA-32). Lista impressa. Gestora valida ou nega a restrição no mesmo dia. |
| Pausa por entrega baixa | Gestora retoma ou nega em até 1 dia útil. |

- Gestora: liga para o corretor em até 30 min, libera a lista impressa no mesmo dia e anota a causa em 1 linha.

**4. Reserva.** Igual à V3:
- sem rodízio;
- Número 2 é de relacionamento, com "Usar para disparo" desligado;
- o CRM recusa o mesmo número nos 2 espaços;
- chip reserva só se o dono pagar.

**5. Salvar/responder.**
- A 1ª mensagem pede resposta.
- O link só vai depois da resposta, junto com o pedido de salvar o contato.
- Cliente do site: botão "Receber minha simulação".

**Textos finais** (ficariam em `lib/daily-goal-policy-messages.mjs`; saída que o CRM já reconhece):
- 1ª-A (cadastro próprio): "{saudacao} {primeiro_nome}, tudo bem? Aqui é {nome_corretor}, da equipe do corretor Matheus Machado. Você fez um cadastro com a gente para comprar um imóvel. Isso ainda está nos seus planos?\n\nSe não quiser receber mensagens, é só responder *não tenho interesse*."
- 1ª-B: "{saudacao} {primeiro_nome}! {nome_corretor} aqui, da Matheus Machado Imóveis. Posso te fazer uma pergunta rápida sobre o imóvel que você pesquisou com a gente?\n\nSe não quiser receber, responda *não tenho interesse*."
- 1ª-C: "{saudacao} {primeiro_nome}, tudo bem? Sou {nome_corretor}, da equipe do corretor Matheus Machado. Você chegou a comprar seu imóvel ou ainda está procurando?\n\nSe preferir não receber, responda *não tenho interesse*."
- 1ª-D (só para base importada, se o dono mantiver; não afirma interesse anterior): "{saudacao} {primeiro_nome}, tudo bem? Aqui é {nome_corretor}, da equipe do corretor Matheus Machado. Trabalho com a compra do primeiro imóvel. Posso te fazer uma pergunta rápida?\n\nSe não quiser receber, responda *não tenho interesse*."
- 2ª-E: "{saudacao} {primeiro_nome}, aqui é {nome_corretor} de novo, da equipe do corretor Matheus Machado. Se fizer sentido, te explico como funciona a simulação, sem compromisso. É só responder *sim*.\n\nSe não quiser receber mais, responda *não tenho interesse*."
- 2ª-F: "{saudacao} {primeiro_nome}! Quer que eu te mostre como funciona a simulação do seu imóvel? Responde *sim* que eu te explico.\n\nSe preferir não receber, responda *não tenho interesse*."
- Depois da resposta (atalho manual do corretor no Chat): "Que bom, {primeiro_nome}! Salva meu número como “{nome_corretor} Imóveis”, assim o link que eu te mandar abre direto aqui. Já te envio."

**Fases (nada é feito sem o "sim" do dono):**
- **F1, sem código:** decisões do dono (espera de 2 h, base, 3ª tentativa, sábado, saída em linguagem natural, origem da base importada). Gestora revisa as 4 pausas. Dados mede os 500 e a taxa de 401 por abertura.
- **F2, código:** `/diagnosticar-producao` da fila de 14–15/10. Nova regra da espera e registro da origem de cada conexão (QR ou automática). D1 recibos. 401 por tipo. Textos novos. 3ª tentativa só manual. Filtro para usar só cadastros próprios.
- **F3:** teste A, depois B, em número de teste (C só com ciência expressa do dono). A1 calibrado. Piloto opcional pelo Oficial, só com cadastros próprios.

**Indicadores (sem mudança em relação à V4, com dois ajustes):**
- "401 em até 30 min" passa a ser medido por abertura de sessão.
- Novo: "% da base com cadastro próprio" (hoje 12 de 33.027).

## O que mudei e por quê
1. A espera de 2 h ganhou gatilhos completos, porque a V4 deixava de fora retomadas e quedas longas.
2. Saiu `({associado_a})`, porque bloqueia o envio quando falta gênero e ignora o CRECI.
3. A saída virou *não tenho interesse*, porque o CRM já reconhece essa frase e ela não convida resposta ambígua.
4. O T5 com "momento" saiu, porque pela PRO-8 essa resposta vai para o humano.
5. O rótulo "não saiu" virou "sem recibo", porque pelo menos 11 dessas mensagens tiveram resposta.
6. A base padrão passou a ser os cadastros próprios, com importados pausados.
7. O texto para importados não afirma interesse anterior, porque não sabemos a origem da lista.
8. O teste de IP ganhou denominador e ordem A → B → C, com o risco de cada etapa.

## O que deixo para Viabilidade
- Esforço e migration para registrar a origem de cada conexão (QR ou automática) e para a nova regra da espera (`brokerReconnectReferenceMs` e `slotsPastReconnectWait`).
- Filtro de cadastro próprio na RPC `claim_daily_goal_contacts`, com exclusão de Não contactar, clientes em andamento e conversa recente.
- Ligar o código à identificação padrão de navegador só em pareamento novo.
- Custo de IP fixo na Railway (não documentado).
- Custo e fluxo do Oficial com modelo aprovado.
- Revisar os modelos v2 que dizem "você demonstrou interesse".

## Decisões do dono
1. Em que casos a espera de 2 h reinicia. Sem essa mudança, a automação continua quase parada (2 a 7 envios por dia).
2. Base: reativação dos cadastros próprios (recomendada) ou importados, com ciência do risco pelos Termos.
3. Qual é a origem da base importada, para o texto ser verdadeiro.
4. 3ª tentativa só manual, e como fica o sábado.
5. Teste de IP: autorizar A e B; C só com ciência expressa (recomendo não fazer).
6. Piloto pelo Oficial, que tem custo por mensagem e expõe o número do anúncio.

Arquivos: nenhum gravado. Lidos:
- /home/user/imoveis-mvp/docs/posicionamento/mesa/2026-10-16-whatsapp-corretores/R2-1-dados.md
- /home/user/imoveis-mvp/lib/whatsapp-individual.js
- /home/user/imoveis-mvp/lib/daily-goal-auto.js
- /home/user/imoveis-mvp/lib/daily-goal-auto-core.mjs
- /home/user/imoveis-mvp/lib/daily-goal-policy-messages.mjs
- /home/user/imoveis-mvp/lib/prospecting-reply-core.mjs
- /home/user/imoveis-mvp/whatsapp-individual-service/src/sessions.js
- /home/user/imoveis-mvp/whatsapp-individual-service/src/reconnect-policy.js
- /home/user/imoveis-mvp/whatsapp-individual-service/src/reconcile.js
