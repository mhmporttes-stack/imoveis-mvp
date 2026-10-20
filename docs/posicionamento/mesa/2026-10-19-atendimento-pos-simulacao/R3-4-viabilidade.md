## Cadeira 4: Viabilidade no CRM, Rodada 3 (final)
Só li o código em origin/main (o clone local estava 170 commits atrás, então li tudo via `git show origin/main:`). Não editei, não fiz commit e não toquei no banco.

### (a) Respostas às objeções contra a minha R2
1. **Custo de IA como motivo (Dados):** aceito e retiro. O aviso de mídia fica no lote B só porque mexe no `WhatsappChat`.
2. **Teto diário e o que fazer com a vaga vencida (Dados):** aceito. Adoto o "motivo sugerido" do Atendimento, que não usa a vaga de atividade. Com isso a vaga vencida e a MD-8 deixam de ser problema.
3. **Diagnosticar os 0 lotes antes do "Recebi por fora" (Atendimento):** aceito. O diagnóstico está em (b).
4. **"±1 min" mede errado (Atendimento):** aceito. A medida passa a ser "link aberto sem nenhuma prova de envio". Ela só vale depois de resolver a lacuna da conversa Particular e nunca aparece por pessoa em tela.
5. **Motivo sem o código "T3" (Apresentação):** aceito. O "Recebi por fora" aparece só em Doc sem lote, como eu já tinha proposto.

### (b) Por que não há lote desde 06/10: provavelmente falta de uso, não defeito (falta confirmar no banco)
- **O caminho de salvar não mudou no período.**
  - `lib/client-documents.js` não teve commit entre 02/10 e 10/10. O de 10/10 (6c118f48) só tirou uma função morta.
  - A rota `from-chat` não mudou desde 01/10 ou antes, e `lib/whatsapp-media.js` desde 02/10.
  - As duas entradas continuam no ar: "Documentação" no menu do card (`ClientCard.jsx:150`) e "Analisar documentação" no Chat (`WhatsappChat.jsx:1446`). Essa segunda some em conversa Particular desde 09/10 (3b2e1337), o que não explica 07 e 08/10.
- **Uma tentativa quase sempre deixa rastro.**
  - Pelo card, o lote é gravado **antes** do upload (`createDocumentBatch`, `client-documents.js:52`) e nunca é apagado.
  - Pelo Chat, falha de IA fica gravada como `failed`. O lote só é apagado quando nenhum arquivo selecionado consegue ser carregado (`client-documents.js:172-175`).
  - Apagar tudo (só admin ou gestor) deixa o evento `document_all_deleted` na jornada.
  - Ou seja, 0 linhas quer dizer, na prática, que ninguém tentou.
- **A base já era baixa:** 20 lotes em 16 dias, e só 4 de 33 clientes em Doc receberam arquivo pelo Chat. O Chat híbrido de 08/10 deixou o WhatsApp pessoal "só pelo celular", então os documentos podem nem estar entrando no CRM.
- **Fora do escopo, para o dono saber:** quando a análise falha no Chat, a tela mostra só "Não foi possível iniciar a análise." e esconde o erro real do servidor (código perto da `WhatsappChat.jsx:1690`, função `analyze`).
- **Consultas de leitura para confirmar:**
```sql
-- Q1: lotes por dia, situação e quem enviou (se forem quase todos do dono ou de teste, não houve queda)
select (created_at at time zone 'America/Sao_Paulo')::date d, status, uploaded_by, count(*) from client_document_batches group by 1,2,3 order by 1;
-- Q2: tentativas e lotes apagados
select event_type, (created_at at time zone 'America/Sao_Paulo')::date d, count(*) from client_journey_events
 where event_type in ('document_batch_uploaded','document_all_deleted','documents_list_sent') and created_at >= '2026-09-21' group by 1,2 order by 2;
-- Q3: arquivos recebidos de clientes em Doc, por dia e se a conversa é Particular
select (m.created_at at time zone 'America/Sao_Paulo')::date d, c.private, count(*) from whatsapp_messages m
 join whatsapp_conversations c on c.id=m.conversation_id join simulation_registrations r on r.id=c.client_id
 where m.direction='inbound' and m.message_type in ('image','document') and r.status='documentation_pending' and m.created_at >= '2026-09-21' group by 1,2 order by 1;
```
- **Logs da Vercel desde 06/10:** procurar "Falha ao iniciar análise documental do Chat" e erros 4xx/5xx em `POST /api/admin/client-documents/from-chat` e `/batches`.
- **Leitura dos resultados:** se Q1 a Q3 e os logs vierem vazios, é falta de uso. Se houver erros, abrir `/diagnosticar-bug`.

### (c) A especificação final da Apresentação contra o código
- **`fitScene` ≥ 90%: dá para cumprir, mas só conferindo à mão.** O mínimo do código é `FIT_MIN = 0.72` (`PresentationPlayer.jsx:766`) e não há teste de layout. Na vitrine, em 360×640, basta ler o `style.zoom` do bloco e anotar no relatório do `design-critic`. O plano B (Imóveis vira link de texto) não muda nenhuma regra.
- **Testes que travam os textos atuais e precisam ser atualizados no mesmo commit:**
  - `round2:186` e `round3:250` (texto "VALIDAR SIMULAÇÃO");
  - `round2:277` (cena de documentos);
  - `documents-forecast:129`, `257` e `510` (mensagem e pergunta da folha).
  - Nenhum código lê a frase da mensagem pronta: a mensagem do agendamento (`client-appointments-core.mjs:287`) é outra, e o código do atendimento continua igual.
- **"Recebi por fora" sem pontuar:**
  - Vira um evento novo na jornada, `document_received_offline`. Ele fica **fora** de `ATTENDANCE_JOURNEY_EVENTS` (`client-attendance-core.mjs:37`), então não conta como atendimento.
  - Não muda status, não mexe em `last_whatsapp_contact_at` nem na atividade, então não dá ponto nem entra na Meta Diária.
  - Leva um teste que trava isso.
  - **Assimetria para o dono decidir:** hoje `document_batch_uploaded` **conta** como atendimento. Salvar pelo CRM conta e "por fora" não contaria.
- **"Desfazer" em 10 s:** a jornada só recebe gravações novas (não há delete nem update em `lib/`). O desfazer grava um evento de cancelamento, `document_received_offline_undone`, e a etiqueta lê o último dos dois. Não recomendo segurar a gravação no navegador, porque se a pessoa fechar a tela a marca se perde. Esforço P, sem migration.
- **Motivo sugerido fora da vaga:**
  - Pode ser **calculado na hora**, sem gravar nada e sem cron: usa `simulation_presentations` (`completed_at`, `last_scene`, `last_opened_at`), a previsão de documentos, o status e o último contato humano. Some sozinho quando há contato real.
  - Precisa de migration? Não. A tabela de eventos do item 3 só deixa a "cena onde parou" exata.
  - A conferir: hoje `last_scene` guarda a **maior** cena alcançada, não a última. Também falta confirmar se `listVisibleTeamProfiles` mostra ao gestor os clientes de corretor inativo; se não mostrar, a regra "inativo vai para o gestor" precisa de ajuste de escopo.
- **Conversa Particular como prova de envio: viável sem quebrar a privacidade.**
  - Hoje a prova de envio só olha conversas com `client_id` (`simulation-sent-evidence.js:29`).
  - A proposta é procurar o **token exato** do link do cliente (128 bits, único) nas mensagens enviadas de qualquer conversa e devolver só "sim ou não", sem mostrar conteúdo nem ligar a conversa ao cliente.
  - Custo: busca de texto em `whatsapp_messages` sem índice trigram. Um índice opcional seria migration.
  - Toca a privacidade da conversa Particular (WA-23), então é decisão do dono. A alternativa de custo zero é o item 6 do roteiro da conversa: tirar o cliente de Particular.

### (d) VERSÃO FINAL
| # | O que muda | Por quê | Como medir | Esforço | Migration | Dono? |
|---|---|---|---|---|---|---|
| 0 | Já: consultas Q1–Q3 e logs, e a conversa com as 3 pessoas | Defeito ou falta de uso; 10 de 13 casos | Causa dos 0 lotes; casos cobertos | P | Não | Não |
| 1 | "Próximo passo" com um único botão cheio e "Mais {n} telas" calculado por `buildScenes` | Hoje são 2 botões cheios disputando | Concluiu ÷ abriu: 32/65 (~140 aberturas) | P | Não | Sim: PRES-12 (o nome é opcional) |
| 2 | Cena, folha e mensagem sem "toda"; frase de compromisso; T6 | Diminui o medo de se comprometer | Pediu lista ÷ concluiu: 14/32 | P | Não | Sim: PRES-17 e a frase |
| 3 | Tabela `simulation_presentation_events` (toque, equipe, cena) | Habilita os itens 8 e 9 | Toque ÷ abertura; % de aberturas da equipe | M | **Sim** (aditiva, antes do deploy) | Autorizar a aplicação |
| 4 | Painel: "Enviar simulação" pelo fluxo do gerador, "copiado" registrado e linha "envio não registrado" | 18 de 74 sem envio | Link aberto sem prova de envio (não por pessoa) | P | Não | Sim: painel enxuto |
| 5 | "Recebi documentos por fora": só em Doc sem lote, com desfazer, fora do atendimento | 2 de 33 com 1º documento | Doc com 1º documento por semana | P | Não | Sim: não conta (e a assimetria) |
| 6 | Atalhos T1–T11 e T13 (T11 sem falar de cobrança) | Toque humano rápido | Uso; resposta em 24 h | Zero | Não | Sim: textos e frase anti-golpe |
| 7 | Prova de envio em conversa Particular pelo token exato, só sim ou não | 4 envios reais invisíveis | Os 4 casos passam a contar | P/M | Opcional (índice) | Sim: privacidade (WA-23) |
| 8 | Aviso de mídia no Chat (Doc sem lote); linha do 13º "{N}→{X}" com `initialChoices`; identificação | Mais lotes; amortização como argumento | Lotes por semana; toque na linha | M | Não | Sim: PRES-4, 12 e 24 |
| 9 | Motivo sugerido **calculado** (sem cron, sem vaga) e "quem sumiu" D+1, D+3 e D+7 fechando com o T13 | Recupera quem parou sem mexer na MD-8 | Resposta em 48 h; pedidos de "pare" | M | Não | Sim: as 4 regras e os prazos |

**Plano de lotes**
- **Lote 0, agora:** precisa só do "ok" do dono para a conversa com as 3 pessoas. As consultas são leitura.
- **Lote A (itens 1 a 6), uma semana:** precisa de "sim" para PRES-12, PRES-17 e a frase de compromisso, o painel enxuto, o "Recebi por fora" não contar (e a assimetria), os textos com a frase anti-golpe e a autorização da migration (aplicada antes do deploy). O item 5 só entra se o lote 0 confirmar falta de uso.
- **Lote B (itens 7 e 8), 2 a 3 semanas depois, com dados de toque:** precisa de "sim" para a privacidade da conversa Particular (WA-23) e para PRES-4, 12 e 24.
- **Lote C (item 9), depois do `auditor-automacoes`:** precisa de "sim" para as 4 regras (vencida, MD-8, inativo vai ao gestor, lista semanal do dono) e para os prazos.
- **Em todos os lotes:** `pnpm build`, `node --test` da área (com os testes listados em (c) atualizados), vitrine em 360/390 com o `zoom` anotado, `design-critic`, `/verificar-correcao` e `docs/CHANGELOG_AI.md`.

### O que mudei
1. Os 0 lotes ficaram, pelo código, como "provavelmente falta de uso": uma tentativa quase sempre deixa linha. A confirmação depende de Q1–Q3 e dos logs.
2. O motivo sugerido passou a ser calculado na hora: sem cron, sem migration e sem usar a vaga. O esforço do lote C caiu de M+ para M.
3. O "Recebi por fora" tem a garantia escrita (fora de `ATTENDANCE_JOURNEY_EVENTS`, com teste) e o desfazer por evento de cancelamento.
4. Apontei uma assimetria para o dono: salvar lote pelo CRM conta como atendimento, e "por fora" não contaria.
5. A prova de envio em conversa Particular virou item próprio: busca pelo token exato, resposta só "sim ou não", com decisão do dono.
6. Listei os 6 pontos de teste que travam os textos atuais.
7. O `fitScene` ≥ 90% é medido à mão (o código permite até 72%); não há teste automático.
8. Tirei o custo de IA e o teto diário; a medida de envio não aparece por pessoa.
