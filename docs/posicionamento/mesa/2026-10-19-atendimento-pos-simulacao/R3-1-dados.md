## Cadeira 1 (Dados), Rodada 3 (final)
Só usei SELECT e não gravei nada, nem na minha memória. Base: apresentações criadas de 05/10 a 18/10, sem clientes de teste, n = 74 (bate com a R2). As fotos do CRM são de hoje, 19/10.

**Resumo.** O "link sem rastro" está concentrado em poucas pessoas. Tarefas automáticas pesam pouco por corretor, mas quase metade delas cairia na carteira do dono ou de quem já saiu. O custo de IA não serve de motivo para segurar o aviso de mídia. O problema real é outro: **nenhum lote de documentos foi salvo no CRM desde 06/10**.

### (a) Objeções contra a minha R2
- **Atendimento: "lançar junto confunde o efeito".** Aceito em parte. Os itens 1 e 4 têm medidas diferentes e podem sair juntos. "Pediu lista ÷ concluiu" tem n de cerca de 16 por semana; com 32 casos a margem é de ±16 pontos, então escalonar não deixa a medida legível. Fico com os lotes da V8.
- **Apresentação: "Mandou por fora?".** Era item meu e aceito trocar a pergunta pela linha discreta no painel.

### (b) Medições
1. **Links sem `presentation_sent` em ±1 min da criação: 18 de 74 (24%).** São 15 sem nenhum evento e 3 com evento horas depois. Os "13 sem rastro" se dividem assim:
   - 9 sem rastro nenhum.
   - 4 em que o link aparece numa conversa marcada como Particular e sem cliente vinculado, enviado pelo WhatsApp do corretor. A regra atual de prova de envio não enxerga esses casos. Fica como lacuna para o `crm-editor` avaliar; a privacidade de conversa Particular é regra do dono.
   - Por quem criou o link (os 13): Jennyfer 5 (de 24 links), Caroline (gestora) 3 de 5, Gabriel 2 de 3, izabela (inativa) 2 de 4, ketlin 1 de 4.
   - Eduardo (18 links), Bruna (6) e Matheus (6) têm 0.
   - Dos 24 links da Jennyfer, 11 eram de clientes de outro responsável.
   - Fonte: `simulation_presentations.created_by_user_id`, `client_journey_events`, `whatsapp_messages` × `whatsapp_conversations`.
2. **A "vaga vazia" barraria 11 de 73 tarefas (15%, IC 9–25).**
   - Em Aguardando documentação: 7 de 33 com a vaga ocupada (1 futura, 6 vencidas sem concluir).
   - Com link aberto antes de Doc: 4 de 40 (2 futuras, 2 vencidas).
   - **8 das 11 são atividades vencidas**, justamente dos clientes mais esquecidos.
   - Fonte: `simulation_registrations.scheduled_activity_at` e `scheduled_activity_completed_at`, foto de hoje.
3. **Efeito na Meta Diária (13 a 19/10, equipe ativa sem o dono).**
   - Pendentes congelados: média de 320 por dia, para cerca de 5 pessoas (uns 60 por pessoa).
   - Desses, só 18,3 por dia (5,7%) são clientes-alvo (em Doc ou com link aberto).
   - Com cerca de 28 tarefas por semana (uns 5 por dia útil), os pendentes da equipe cairiam cerca de 1,5%.
   - O risco não é o volume. Pela MD-8, agendar uma atividade futura conta como "pendência resolvida": uma tarefa criada pelo sistema daria ao corretor 1 feito sem trabalho.
   - Observação à parte: o congelamento do dono tem 1.087 a 1.238 pendentes por dia.
   - Fonte: `daily_goal_pending_freeze` × `client_status_history`.
4. **Corretores ativos e carga.**
   - Ativos: 5 corretores, 1 gestora e o dono; 2 corretores estão inativos.
   - Os 73 clientes-alvo estão assim: **dono 27 (37%)**, inativos 8 (11%), Jennyfer 10, Bruna 9, Eduardo 7, ketlin 5, Gabriel 4, Caroline 3.
   - Carga: 28 tarefas por semana × 52% ÷ 6 pessoas ≈ 2,4 por semana, ou **cerca de 0,5 por pessoa por dia útil**. Um teto diário não faria diferença.
   - Fonte: `admin_users`, `simulation_registrations.responsible_user_id`.
5. **Custo de IA por lote.**
   - A tabela é `ai_usage_log`, recurso `client_document_analysis`, com 20 lotes de 21/09 a 06/10.
   - Média de **US$ 0,11 por lote** (mediana 0,05; p90 0,27), cerca de 9 arquivos por lote, 3 lotes com falha. Total de US$ 2,26.
   - **Desde 07/10 não existe nenhum lote salvo** (`client_document_batches`: 21 no total).
   - Mesmo se os 33 clientes em Doc salvassem um lote, seriam cerca de US$ 4.

### (c) Decisões da V8 que questiono
1. **Item 8, "decisão do dono por custo de IA":** não se sustenta. São US$ 0,11 por lote e o volume esperado fica abaixo de US$ 1 por semana. Com 0 lotes em 13 dias, a marca "1º lote" vai dizer zero. Por isso o "Recebi por fora" (1 toque, evento na jornada, esforço P, sem mexer no Chat) deve subir para o lote A. O aviso de mídia fica no B pela complexidade do `WhatsappChat`, não pelo custo.
2. **Item 9, "só em vaga vazia" e "teto por corretor":**
   - O teto é desnecessário (0,5 tarefa por pessoa por dia).
   - A regra da vaga precisa dizer o que fazer com atividade vencida: 8 das 11 vagas ocupadas estão vencidas.
   - Faltam 3 regras, que são decisão do dono:
     - tarefa do sistema não conta como pendência resolvida;
     - para onde vai a tarefa de cliente de corretor inativo (8);
     - o dono recebe ou não tarefas (27).
3. **Item 3:** antes do código, uma conversa com 3 pessoas (Jennyfer, Caroline e Gabriel) cobre 10 dos 13 casos, com custo zero. O código continua valendo.

### (d) VERSÃO 9
| # | O que muda | Impacto × esforço | Como medir (n e prazo) | Dono? |
|---|---|---|---|---|
| 1 | Lote A: tabela de eventos (toque, equipe, cena) | Alto (habilita) × M | % de aberturas da equipe; toque ÷ abertura. Descritivo em 2 semanas | Autorizar a migration |
| 2 | Lote A: "Próximo passo" com botão único e "Mais {n} telas" calculado | Alto × P | Concluiu ÷ abriu: 32/65 = 49% (IC 37–61), base 08–18/10. Cerca de 140 aberturas (4–5 semanas) detectam ≥ 17 pontos | Sim (PRES-12) |
| 3 | Lote A: textos sem "toda", frase de compromisso, T6 | Alto × P | Pediu lista ÷ concluiu: 14/32 (±16 pontos). Descritivo até cerca de 30 previsões | Sim (PRES-17) |
| 4 | Lote A: painel com "Enviar simulação", "copiado" registrado, linha "envio não registrado". No mesmo dia, conversa com as 3 pessoas | Médio/alto × P | Sem envio em ±1 min: 18/74 (24%); sem rastro: 13/74. Meta abaixo de 5% em cerca de 150 links (4 semanas), por quem criou | Sim (painel enxuto) |
| 5 | Lote A: atalhos T1–T11 e T13 | Médio × zero | Uso; resposta em 24 h | Sim (textos) |
| 6 | Lote A: "Recebi documentos por fora" (1 toque) | Alto × P | % de Doc com 1º documento (hoje 2/33; 0 lotes desde 06/10). Semanal | Não |
| 7 | Lote B: aviso de mídia no Chat (só em Doc e sem lote) | Médio × M | Lotes por semana (hoje 0); custo de cerca de US$ 0,11 por lote | Não |
| 8 | Lote B: linha 13º "{N}→{X}" e identificação (1º nome e CRECI) | Médio × P/M | Toque na linha ÷ chegou na cena; "golpe" no Chat | Sim (PRES-4/12/24) |
| 9 | Lote C: tarefas T4/T3/T7. Vaga vazia (inclusive o que fazer com as vencidas: 8); não contam como pendência resolvida; destino de cliente de inativo/dono; sem teto | Alto × M+ | Resposta em 48 h, descritivo. Cerca de 28 por semana (0,5 por pessoa por dia útil) | Sim (MD-8, PRES-17, roteamento) |
| 10 | Lote C: quem sumiu, D+1/D+3/D+7 úteis, fechando com T13 | Médio × M | Retomada; pedidos de "pare" | Sim (prazos) |

**O que mudei**
1. "Recebi por fora" subiu para o lote A: há 0 lotes salvos desde 06/10.
2. Tirei "custo de IA" como motivo de decisão (US$ 0,11 por lote).
3. Tirei o teto diário: a carga medida é de 0,5 tarefa por pessoa por dia.
4. Tarefas: entram a regra da vaga vencida (8 de 11), "não conta como resolvida" (MD-8) e o destino dos clientes do dono e dos inativos (35 de 73).
5. O item 4 ganhou a conversa com 3 pessoas (10 de 13 casos) e a medida por quem criou.
6. A métrica de envio passou de "sem rastro" para "sem envio em ±1 min" (18/74).
7. Lacuna para o `crm-editor`: link enviado em conversa Particular sem cliente vinculado não conta como envio (4 casos).
8. Cada medida traz n, prazo e diz quando é só descritiva.

**Limitações.** As fotos de vaga e de responsável são de hoje (19/10), não do dia de cada link. Excluí clientes de teste pelo nome. "Status no dia" vem de `client_status_history`. O "±1 min" mostra associação com o "Gerar link" do painel, não prova a origem. 28 tarefas por semana é estimativa do Atendimento.