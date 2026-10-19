## Cadeira 4: Viabilidade no CRM (Rodada 2)
Conferi em origin/main (4ec48bf1) e só li. Não editei nada, não fiz commit e não toquei no banco.

### (a) Respostas às objeções contra a minha R1
1. **Esperar 30 dias de base antes de mudar.** Aceito e retiro. A base de 08 a 18/10 já serve. A medição vai junto com o lote A.
2. **"1º documento = 1º arquivo salvo".** Aceito como medida: o arquivo no CRM só existe para 7 clientes. Mantenho a parte técnica. Salvar a partir do Chat já grava o evento `document_batch_uploaded` (`lib/client-documents.js:96`), então a marca "1º documento" é o 1º lote salvo, sem campo novo. O que falta é fazer as pessoas salvarem (sugestão no Chat) e ter um registro "Recebi por fora", que é um evento na jornada, sem migration.
3. **Lembrete pelo Oficial, alcance 0.** Aceito e retiro.

### (b) Decisões que a Apresentação deixou para mim
- **"Enviar simulação" no painel.** Não copiar o fluxo. O `sendPresentationToWhatsApp` (`SimulationGenerator.jsx:803-875`) primeiro salva o formulário (`persistSimulation`), confere a trava da simulação automática e o cadastro, e só então chama `enviar-preparar`. Se o painel (`SimulationPresentationPanel.jsx`, componente irmão na mesma página) chamar a rota direto, ele pula o salvamento: o cliente pode ver valores antigos e passa a existir uma 2ª cópia da regra PRES-22. A saída é o botão do painel acionar a mesma função do gerador por um evento de página, sem lógica nova. Esforço P, sem migration. Teste: `simulation-presentation-send` e conferência na vitrine.
- **Registrar "link copiado".** Ação nova `copiado` na rota `apresentacao` (o guard `requireAdminApi` e o escopo de `getSimulation` já estão lá). Grava um evento novo na jornada, `presentation_link_copied`. Ele **não pode** ser `presentation_sent`: isso destravaria a FUN-13 (trava de "Simulação enviada" sem envio real) e contaria como atendimento na FUN-15f (`client-attendance-core.mjs:47`). Precisa de rótulo em `ClientJourneyActions.jsx:52`. Esforço P, sem migration (event_type é texto livre). Pela regra do "Alterar conta", fica com o corretor emulado. A linha "envio não registrado" sai no GET: basta somar `simulation-sent-evidence` ao `stateBody`. Esforço P.
- **"{N} → {X} anos".** Viável no navegador, sem servidor: `compareStrategy(estrategia, choices com só o 13º ligado)` com o valor de `automaticOptionValue(base,"decimoTerceiro")` e as pontas por `roundedYears`, que é o mesmo arredondamento do gráfico. Para a folha mostrar o **mesmo** número, a linha tem que abrir o `StrategySheet` com `initialChoices` já com o 13º ligado (essa propriedade já existe). Sem isso, a folha abre sem nenhuma opção ligada e mostra 35 contra 35. Quando a pessoa já salvou uma estratégia, vale a escolha gravada. Informal ou sem `estrategia` no DTO: texto sem número. Esforço P/M. Teste: `payment-strategy` (a linha tem que bater com o gráfico) e `simulation-presentation-player`.
- **Os 13 links sem rastro.** Pelo código, o envio pelo gerador grava `enviar-registrar` **antes** de abrir o WhatsApp. A única exceção é a falha do Oficial, que cai no Chat e deixa a mensagem gravada. As únicas saídas que não deixam rastro são o painel: "Copiar link", selecionar o campo à mão ou, até 19/10, o "Abrir o link". Conclusão: praticamente os 13 saíram do painel, mas não dá para separar copiar de selecionar. Teste para a Dados: link criado sem `presentation_sent` em ±1 min indica criado pelo "Gerar link" do painel; `created_by_user_id` diz por qual corretor.
- **Toque e abertura feita pela equipe.**
  - O cookie não serve na rota de evento: o player envia com `credentials: "omit"` (`PresentationPlayer.jsx:812`), então o cookie nunca chega.
  - Caminho: a página `/apresentacao/[token]` (já `force-dynamic`) lê o cookie do painel no servidor e passa ao player uma marca `equipe`, fora do DTO. Assim as allowlists da PRES-3 não mudam.
  - Formato: **tabela nova de eventos, aditiva**, `simulation_presentation_events` (presentation_id, tipo, alvo, cena, equipe, created_at), com RLS ligado e sem policy, igual à de 05/10. É melhor que colunas: dá a cena exata onde a pessoa parou (hoje `last_scene` guarda a **maior** cena alcançada), a ordem dos toques e a marca de equipe em cada evento. Os contadores atuais continuam como estão.
  - A allowlist de `parsePresentationEvent` ganha o tipo `toque` com `alvo` fechado (estrategia, agendar, imoveis, lista, linha13). Sem IP e sem user-agent.
  - Esforço M. Migration **sim**: a aplicação é manual e precisa de autorização, então tem que entrar **antes** do deploy.
  - Limite: no iPhone, o app instalado e o navegador do WhatsApp não dividem cookie.

### (c) Decisões que questiono
1. **Tarefas com teto diário "sem duplicar com a Meta Diária" (itens 6 e 10 da V7).**
   - O cliente tem **uma única vaga de atividade** (`simulation_registrations.scheduled_activity_at/type`). Uma tarefa automática **apagaria** a atividade "documentos" da PRES-17 ou um retorno que o corretor marcou. Regra técnica: só criar quando a vaga está vazia, nunca por cima.
   - Atividade futura **tira o cliente dos Pendentes da Meta Diária** (MD-8, `isClientAwaitingAction`, `client-status.js:423`). Então "não duplicar" acontece sozinho, mas a tarefa encolhe a Meta e esconde abandono. Isso é decisão do dono.
   - A tarefa precisa sair como "sistema", senão zera o relógio de 3 dias (FUN-15f).
   - Esforço real M+, com cron novo ou gatilho novo no motor AUT-1. Vai para o lote C.
2. **Sugestão "É documento do financiamento?" no Chat.**
   - Salvar um arquivo do Chat sempre dispara a análise por IA (`confirmDocumentBatchUpload` → `analyzeBatchNow`): custo de IA por lote e espera.
   - Mexe no `WhatsappChat.jsx`, que tem 3.264 linhas.
   - O aviso aparece para quem abre a conversa: corretor, associado, gestor ou admin.
   - Público pequeno: só 4 de 33 clientes em Doc receberam mídia no Chat.
   - Proposta: aviso só para cliente em "Aguardando documentação" sem nenhum lote salvo, mais o "Recebi por fora" com 1 toque. Vai para o lote B.
3. **"Mais 2 telas" e o botão novo.**
   - Hoje a frase está certa (validar e documentos são incondicionais), mas tem que ser **calculada** pelo roteiro (`buildScenes`), não escrita à mão.
   - Trocar o texto "VALIDAR SIMULAÇÃO", que a PRES-12 cita pelo nome, por "VER O QUE PRECISO PARA AVANÇAR" também muda a PRES-12.
4. **Lote A com 4 itens de uma vez.** Concordo, porque as medidas são separadas. Mas o item 1 e a linha de amortização mexem na **mesma cena**: separados, são 2 rodadas de vitrine e `design-critic`. Ainda assim, mantenho a linha no B para medir o efeito do botão sozinho.

### (d) VERSÃO 8
| # | O que muda | Impacto × esforço real | Migration | Testes | Dono? |
|---|---|---|---|---|---|
| 1 | Medição: tabela de eventos, tipo `toque`, marca `equipe` vinda da página, cena exata | Alto (habilita) × M | **Sim** (aditiva) | simulation-presentation, round2/3 | Não (só autorizar a migration) |
| 2 | "Próximo passo": 1 botão principal e "Mais {n} telas" calculado | Alto × P | Não | player, round2/3, viewport; vitrine 360/390 | Sim (PRES-12) |
| 3 | Painel: "Enviar simulação" aciona o fluxo do gerador; Copiar com contorno grava `presentation_link_copied`; linha "envio não registrado" | Médio/alto × P | Não | send, sent-lock (copiado ≠ evidência) | Sim (painel enxuto de 19/10; copiar não é atendimento) |
| 4 | Textos sem "toda" iguais na cena, na folha e na mensagem; frase de compromisso; T6 na observação da atividade | Alto × P | Não | documents-forecast (5), round2 (5), round3 (1) | Sim (PRES-17 e a frase) |
| 5 | Atalhos T1–T11 e T13 cadastrados pela tela | Médio × zero de código | Não | nenhum | Sim (textos) |
| 6 | Linha 13º "{N}→{X} anos", que abre a folha com o 13º ligado | Médio × P/M | Não | payment-strategy, player | Sim (PRES-12/24) |
| 7 | 1º nome do corretor e CRECI na cena de documentos e na folha | Médio × P | Não | allowlist round2/3 | Sim (PRES-3 já permite o 1º nome) |
| 8 | Aviso de mídia (só em Doc e sem lote) e "Recebi por fora"; a marca é o 1º lote | Alto × M (com custo de IA) | Não | client-documents, document-regression | Sim (custo de IA) |
| 9 | Tarefas T4, T3, T7 e alerta de simulação sem link: só em vaga vazia, ator "sistema", teto por corretor | Alto × M+ | Não | testes novos do motor, daily-goal-progress | Sim (PRES-17, MD-8, AUT-9) |
| 10 | Quem sumiu: D+1, D+3 e D+7 úteis, fechando com o T13 | Médio × M | Não | junto com o 9 | Sim (prazos) |

**Lote A** (1 semana): 1 (migration aplicada antes do deploy), depois 2, 3, 4 e 5. **Lote B** (2 a 3 semanas depois, com dados de toque): 6, 7 e 8. **Lote C** (depois do `auditor-automacoes`): 9 e 10. Em todos: `pnpm build`, `node --test` da área, vitrine e `design-critic`, `/verificar-correcao` e registro em `docs/CHANGELOG_AI.md`.

**Regras oficiais tocadas:** PRES-3, PRES-4, PRES-9, PRES-12, PRES-17, PRES-22 (envio de 11/10, só o link; agendar), PRES-24 (13º líquido), FUN-13, FUN-15b, FUN-15f, MD-8, AUT-1, AUT-9, a atribuição durante "Alterar conta" (01/10) e as decisões do dono de 19/10 (painel enxuto, aprovação automática, sem seletor de mês, anos arredondados no gráfico).

### O que mudei
1. A medição virou tabela de eventos (migration aditiva) e entra antes de tudo no lote A.
2. A abertura pela equipe é marcada pelo servidor da página, porque o cookie não chega na rota de evento (`credentials: "omit"`).
3. O botão do painel aciona a função do gerador; ninguém copia o fluxo.
4. "Copiado" é um evento separado, que não conta como envio (FUN-13) nem como atendimento (FUN-15f).
5. A linha do 13º abre a folha já com o 13º ligado, para o número bater.
6. As tarefas passam a respeitar a vaga única de atividade e o efeito nos Pendentes (MD-8), e vão para o lote C.
7. O aviso de mídia desce para o lote B, por causa do custo de IA e do público de 4 em 33.
8. "1º documento" passa a ser o 1º lote salvo, sem campo novo.

### Para a rodada 3 (Dados) medir ou decidir
- Dos 13 links sem rastro: quantos foram criados sem `presentation_sent` em ±1 min (origem no painel) e por qual `created_by_user_id`.
- Quantos clientes em Doc ou com link aberto já tinham `scheduled_activity_at` ocupado (quantas tarefas a regra da vaga vazia impediria).
- Quantos pendentes da Meta Diária por dia sairiam se as tarefas existissem (efeito na MD-8).
- Número de corretores ativos, para a conta de tarefas por pessoa por dia.
- Custo médio de IA por lote salvo, para decidir o item 8.
