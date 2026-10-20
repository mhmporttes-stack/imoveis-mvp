## Cadeira 4: Viabilidade no CRM (Rodada 1)
Conferi tudo em origin/main, só leitura. Não editei nada e não mexi no banco.

### (a) O que a Versão 3 pede, comparado com o que o código tem hoje
- **Métrica da apresentação.** A tabela `simulation_presentations` guarda só contadores: `view_count`, primeira e última abertura, `completed_at` e `last_scene`. Na função `record_simulation_presentation_event` (migration 20261005120000), `last_scene` usa `greatest`: é a **cena mais alta alcançada**, não o ponto exato onde a pessoa parou. Não existe tabela de eventos. A rota `/api/s/<token>/evento` aceita só `abriu`, `cena` e `concluiu`. Tocar em "Estratégia", "Agendar" ou "Imóveis" não grava nada.
- **Ordem das cenas** (`lib/simulation-presentation-core.mjs:173-238`). O roteiro é abertura, poder, formação, parcelas, [diferença], **proximo, validar, documentos**. As três últimas sempre existem. Então "Próximo passo" é sempre a antepenúltima cena. O "id da cena" pode ser deduzido hoje, sem gravar nada: se a cena mais alta é a antepenúltima, a pessoa parou no "Próximo passo".
- **Abertura feita pelo próprio corretor.** O código não separa. O botão "Abrir o link" saiu do painel (comentário em `SimulationPresentationPanel.jsx:94`), e a prévia do CRM já não conta. Caminho possível: a rota de evento olha o cookie `mm_admin_access_token` (path "/", Lax) e descarta ou conta à parte. Esforço P/M. Só precisa de migration se for para **contar** essas aberturas (coluna nova, aditiva). Limite: no iPhone, o PWA e o navegador interno do WhatsApp não compartilham cookie, então parte das aberturas do corretor continua escapando.
- **Uso da amortização.** `payment_strategy_at` só é gravado quando o cliente baixa o PDF ou toca em "Falar com meu corretor" (`lib/payment-strategy.js:90`). Por isso o "2 de 72" mede quem **salvou** a estratégia, não quem a abriu. O uso real hoje é desconhecido.
- **1º nome do corretor no DTO.** Não existe. `PUBLIC_DTO_FIELDS` traz só version, scenes, branch, podeReceberLista e estrategia. A PRES-3 permite o 1º nome e a PRES-9 só proíbe contato. Esforço P, sem migration. Afeta os testes de allowlist em round2 e round3.
- **Cena de amortização.** Não precisa de cálculo novo no servidor: o DTO já leva `estrategia.opcoes.decimoTerceiro`, já líquido. O motor puro `payment-strategy-core.mjs` já roda no navegador (StrategySheet), então o "N para X anos" pode ser calculado ali. Esforço M: cena nova, mudança no montador do roteiro, testes do player e de round2/3. Mexe na PRES-4 e na PRES-12, regras oficiais.
- **Textos que são regra oficial.** VALIDAR e o título do "Próximo passo" estão em `PresentationPlayer.jsx:685-722`. O texto da cena de documentos é `DOCUMENTS_SCENE_TEXT` (`lib/simulation-presentation-documents.mjs:14`). A pergunta da folha está em `ForecastSheet.jsx:102`. A mensagem pronta "consigo enviar **toda** a documentação" (`documents-forecast-core.mjs:127`) é texto citado na PRES-17. Tirar "toda" só da folha deixaria a tela e a mensagem diferentes. Testes afetados: documents-forecast (5 trechos), round2 (5), round3 (1). Esforço P. Exige "sim" do dono.
- **Agenda.** A PRES-17 já cria a atividade `documentos` na data e no período (09h, 14h ou 19h), e o cron avisa (AUT-9b). Pôr o texto T6 na observação é P. Uma 2ª tarefa "2 dias úteis depois só com atividade de documentos" o motor AUT-1 **não** faz: o gatilho `activity_overdue` não filtra por tipo e o motor não conta dias úteis. Precisa de código, esforço M, sem migration. Ponto de atenção: a PRES-17 diz "Sem automação nova de cobrança" (efeito aceito pelo dono). Logo, o item 6 precisa de "sim", ao contrário do que as cadeiras 2 e 3 marcaram.
- **Atalhos do Chat.** Já existem (`/api/admin/whatsapp-chat/shortcuts`; gestor e admin criam pela tela). Custo de código zero, mas não substituem variáveis como {nome}: o corretor completa à mão. Guia: só sugestão.
- **Oficial e janela de 24 h (T12).** Existe o mecanismo do WA-17/18 (`lib/whatsapp-form-reminder-core.mjs`: janela, horário de silêncio e intervalo mínimo de 2 h), mas ele **exclui** de propósito os links `/s/<token>` (linha 172). Para reaproveitar, é preciso criar um tipo novo de lembrete. Esforço M, sem migration, revisão do `auditor-automacoes`. Risco alto: mensagem real em produção.
- **"Envio registrado em todos os caminhos".** Só a rota `apresentacao` (route.js:132) grava `presentation_sent`. Mas `lib/simulation-sent-evidence.js` já junta esse evento com o link `/s/` mandado pelo Chat. Para medir, isso basta; não precisa gravar mais eventos.
- **Marcas "1º documento" e "documentação completa".** Não existem. O módulo de documentos já recebe mídia do Chat (`partitionChatSelection`, `client_documents`). Uma marca manual nova seria uma solução paralela.
- **Alerta de simulação sem link.** Não existe gatilho para isso, e a AUT-9 proíbe notificar "cliente aguardando ação". Teria de ser uma atividade agendada ou uma linha no painel. Esforço M.

### (b) Discordâncias
1. **Item 1 (gravar o id da cena) não é pré-requisito.** O "Próximo passo" é sempre a antepenúltima cena, então a Dados pode confirmar a parada **hoje**, recalculando o total de cenas. O pré-requisito real é outro: evento de **toque nos botões** (estratégia, agendar, imóveis, "Receber lista") e separar o corretor. Aí sim há migration aditiva.
2. **"Usou amortização 2/72" está errado como métrica.** Só conta quem salvou (PDF ou contato). Antes de criar a cena nova (item 5, esforço M, regra oficial), é preciso medir quantos **abrem** a folha. Até lá o item 5 desce na lista.
3. **"Faltam 2 telas" é estável.** validar e documentos são incondicionais, e o que varia é antes do "Próximo passo". Mantido. Mas o item 5 põe uma cena **antes** do "Próximo passo", justamente onde 36 de 38 já param. Isso alonga o trecho que vaza. Prefiro um destaque de uma linha dentro do próprio "Próximo passo", sem cena nova.
4. **O "pulsar" é viável**: o player já tem `usePrefersReducedMotion`. Mas parar o avanço automático e depois pulsar mexe na PRES-12, que é regra oficial, então precisa de "sim" junto com o item 2.
5. **Cobrança "sem decisão do dono" (cadeiras 2 e 3) entra em conflito com a PRES-17** ("Sem automação nova de cobrança"). O texto na atividade que já existe dispensa "sim"; a 2ª tarefa automática exige.
6. **Marca manual de documento: discordo.** O certo é reaproveitar o fluxo Chat → documentos do cliente. O 1º arquivo salvo ali já é o "1º documento recebido", sem campo novo. Precisa só de um evento na jornada, que é texto livre e não exige migration.
7. **Item 4, identificação.** A pré-mensagem com "quem te responde é {1º nome}" precisa de nome **e** gênero, e o DTO não tem gênero. Usar só o nome, sem "corretor/corretora".

### (c) Versão 4
| # | O que muda | Impacto × esforço real | Migration | Como medir | Dono? |
|---|---|---|---|---|---|
| 1 | Medição: evento de toque nos botões (estratégia, agendar, imóveis, lista) e descarte/contagem da abertura com cookie de admin | Alto (habilita) × M | Sim (aditiva) | % abertura do corretor; abriu estratégia ÷ abriu | Não |
| 2 | Texto T6 na atividade "documentos" que já existe | Alto × P | Não | Previsões vencidas → aprovação em 7 d | Sim (texto) |
| 3 | "Próximo passo" com 1 botão principal + "Faltam 2 telas" + pulsar respeitando reduced-motion | Alto × P | Não | Concluiu ÷ abriu (só cliente) | **Sim (PRES-12)** |
| 4 | Textos leves na cena de documentos, na folha e na mensagem pronta (as 3 iguais, sem "toda") | Alto × P | Não | Pediu lista ÷ concluiu | **Sim (PRES-17)** |
| 5 | 1º nome do corretor + CRECI da empresa (PRES-9 mantida) | Médio × P | Não | Pediu lista; "golpe" no Chat | **Sim** |
| 6 | 1º documento = 1º arquivo salvo pelo fluxo Chat → documentos (evento na jornada) | Alto × P/M | Não | Doc → Aprov; dias | Não |
| 7 | Atalhos T1 a T11 cadastrados pela tela (gestor/admin) | Médio × P (sem código) | Não | Resposta em 24 h | **Sim (textos)** |
| 8 | Tarefas por comportamento (não abriu, parou, concluiu sem lista) + 2ª tarefa de documentos | Alto × M | Não | Resposta e lista em 7 d por grupo | **Sim (contraria a PRES-17)** |
| 9 | Amortização: destaque dentro do "Próximo passo" (motor no navegador, sem cena nova) | Médio × M | Não | Abriu estratégia → pediu lista | **Sim (PRES-4/12)** |
| 10 | Lembrete único "não abriu" pelo Oficial (tipo novo no motor do WA-17) | Médio × M, risco alto | Não | Abertura em 24 h com × sem | **Sim (se existe e texto)** |

**F1, só medição e pré-requisitos (1 a 2 dias):** item 1, consulta semanal sobre `simulation-sent-evidence`, Dados confirmar a parada pelo recálculo do total de cenas. Sem mudança visível para o cliente.
**F2, apresentação e tarefas (depois de 30 dias de medição de base):** itens 2 a 7 e 9. Cada um tem teste (`node --test` de round2/3, documents-forecast, player e payment-strategy), conferência na vitrine em 360×640 e passa pelo `design-critic`.
**F3, automação:** itens 8 e 10, com `auditor-automacoes`, Não contactar e janela de 24 h. Nada sai sem "sim" por item.

### O que mudei e por quê
1. O "id da cena" deixou de ser pré-requisito: dá para deduzir. O pré-requisito passou a ser o toque nos botões.
2. O "2 de 72" da amortização foi refeito como métrica: mede quem salvou, não quem abriu.
3. A cena nova de amortização virou destaque dentro do "Próximo passo", para não alongar o trecho que vaza.
4. Cobrança automática e 2ª tarefa passaram a exigir "sim": a PRES-17 diz "sem automação nova de cobrança".
5. A marca manual de documento virou reaproveitamento do fluxo Chat → documentos, para não criar estrutura paralela.
6. A troca de "toda a documentação" vale também para a mensagem pronta, que é texto oficial da PRES-17.
7. Os atalhos custam zero de código, mas não preenchem {nome}.
8. O "envio em todos os caminhos" é resolvido usando `simulation-sent-evidence`, sem gravar eventos novos.

### Para a rodada 2 (começa por Dados): medir ou decidir
- Recalcular, para os 38 que pararam, se a cena mais alta é exatamente a antepenúltima (confirma a parada no "Próximo passo").
- Taxa de pedido de lista entre quem salvou a estratégia e quem não salvou (n pequeno; só descritivo).
- Quantos `presentation_sent` faltam depois de cruzar com o link `/s/` mandado pelo Chat (`simulation-sent-evidence`).
- Quantos clientes de Doc têm arquivo em `client_documents` (testa o item 6).
- Dono: PRES-12 (botão único e pulsar), PRES-17 (textos e 2ª tarefa), 1º nome do corretor, T12 sim ou não. Também o emoji "🙂" no texto oficial das 10 h (WA-17/18), apontado pela cadeira 2.