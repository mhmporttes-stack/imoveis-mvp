## Cadeira 1 (Dados): onde o cliente trava entre a simulação e os documentos

**Resumo.** O maior gargalo é a etapa depois de "Aguardando documentação". Na coorte madura, 41% de quem chegou lá nunca foi enviado para aprovação. Das 14 previsões de envio de documentos feitas pelo cliente, 9 já venceram e só 1 avançou. Na apresentação, quase todos abrem (88%), mas só 44% chegam ao fim. Quem não chega ao fim para 1 ou 2 cenas antes, e isso é muito provavelmente no "Próximo passo", onde o avanço automático para. Hoje o CRM não registra "recebi o 1º documento" nem "documentação completa". Essas duas etapas não dá para medir, só estimar por sinais indiretos.

**Escopo.** Unidade = cliente (`simulation_registrations`). Fuso de São Paulo. Clientes de teste excluídos (nome contendo "test"). Duas coortes:
- **(P) Apresentação:** clientes com link `/s/` criado em [05/10, 19/10). n = 72. O recurso existe desde 05/10, então não há como olhar 60–90 dias.
- **(H) Histórica, COORTE-CRIAÇÃO (MET-5):** clientes criados em [21/07, 05/10), já com Simulação (rk ≥ 2). n = 220. A subcoorte A (criados de 21/07 a 18/09, com 30 dias ou mais de idade) tem n = 133.

**Números da coorte P (n = 72).** Fontes: `simulation_presentations`, `client_journey_events`, `whatsapp_messages`, `client_status_history`, `client_appointments`.

| Etapa | n | % de 72 |
|---|---|---|
| Link gerado | 72 | 100% |
| Envio registrado (`presentation_sent`) | 58 | 81% |
| Abriu (*) | 63 | 88% |
| Concluiu (chegou à cena de documentos) | 32 | 44% |
| Tocou "Receber lista de documentos" | 14 | 19% |
| Tocou "Agendar atendimento" | 2 | 3% |
| Usou a Estratégia com amortização | 2 | 3% |
| Respondeu no WhatsApp (só entre os 44 com conversa gravada) | 37/44 | 84% |
| Mandou foto ou documento no WhatsApp gravado | 6/44 | 14% |
| Documentos enviados pelo CRM (`client_document_batches`) depois do link | 0 | nenhum lote desde 06/10 |
| Chegou a Aguardando aprovação | 4 | 6% |

(*) A abertura inclui o "Abrir o link" do próprio corretor (PRES-7).

Tempos na coorte P (mediana / p75, só quem tem os dois eventos):

| Intervalo | Mediana | p75 | n |
|---|---|---|---|
| Simulação → link | 1,8 h | 21 h | 72 |
| Envio → 1ª abertura | 0,0 h | 0,1 h | 51 (1 fora de ordem) |
| Abertura → concluiu | 0,1 h | 0,9 h | 32 |
| Abertura → pediu lista | 0,1 h | 0,4 h | 14 |
| Envio → 1ª resposta do cliente | 0,8 h | 5,4 h | 33 |
| Link → Aguardando aprovação | 26 h | 69 h | 4 |

A abertura quase imediata depois do envio sugere que parte dessas aberturas é do corretor.

Coorte histórica A, chegada a cada etapa (`client_status_history` + status atual, MET-3):

| Etapa | n | Conversão |
|---|---|---|
| Simulação | 133 | – |
| Aguardando documentação | 69 | 52% |
| Aguardando aprovação | 41 | 59% de Doc |
| Aprovado | 16 | – |

Tempos na coorte A: Sim→Doc 2,4 d / 7,3 d (n = 28). Doc→Aprov 3,0 d / 3,9 d (n = 9).

**Achados**
1. **Doc → aprovação é o maior vazamento.** Na coorte A, 28 de 69 ficaram em Doc. Das 14 previsões de envio, 9 venceram, 9 clientes ainda estão em Aguardando documentação e 1 chegou à aprovação (`docs_forecast_date`). O prazo médio que o cliente escolhe é 3 dias. Das 12 tarefas "documentos" que entraram na agenda, 7 foram concluídas. Confiança: média, porque a recepção dos documentos acontece fora do CRM.
2. **Parada no "Próximo passo".** Dos 38 que abriram e não concluíram, 36 pararam na cena 4, 5 ou 6. Quem conclui chega à cena 6, 7 ou 8 (o total de cenas varia por cliente), então eles param 1 ou 2 cenas antes do fim. Isso é hipótese: o banco grava o número da cena, não qual cena é. Quem concluiu respondeu no WhatsApp 22 de 23 vezes (IC 79–99%). Quem abriu e não concluiu respondeu 12 de 22 (IC 35–73%). É associação, não causa: o cliente mais engajado faz as duas coisas.
3. **Concluiu, mas não pediu a lista:** 18 de 32. São clientes engajados (12 de 13 responderam) que o corretor pode puxar direto.
4. **Simulação sem link:** 14 de 72 clientes com simulação salva no período não ganharam link (19%). Quando ganham, o p75 entre simulação e link é de 21 h.
5. **Faixa de renda (1º proponente):** chegam à aprovação 38% dos clientes com até R$ 2.850 (48/127, IC 30–47) contra 17% dos de R$ 2.851 a R$ 4.700 (11/66, IC 10–27). Os intervalos não se sobrepõem, mas isso é candidato, não fato: confunde com origem e com corretor, e precisa ser validado em outro período. Informal × CLT (Doc: 64% × 51%) e individual × conjunto (61% × 40%) têm intervalos que se sobrepõem, então não dá para concluir. Novo × usado não dá para medir: não existe campo de escolha.
6. **Recortes por corretor e origem: todos com n < 30, só descritivos.** Sim→Doc→Aprov na coorte H: Matheus 117→54→24 (inclui a fila sem dono), Jennyfer 21→12→9, Bruna 20→13→6, Eduardo 16→14→9, Ketlin 15→10→4, Caroline 14→13→9. Por origem (Sim→Aprov): manual 11/18, unknown 30/95, broker_link 11/50, campaign 6/20, whatsapp_ad 3/17, site 3/14. Isso não serve para ranquear ninguém.
7. **Tempo do 👍 do corretor: não dá para medir.** `simulation_auto_reviews` tem 4 linhas, todas de hoje (19/10): 3 aprovadas com mediana de 22 min e 1 pendente. O efeito disso na resposta do cliente fica para medir em cerca de 30 dias.

**Gargalos, em ordem:** (1) Aguardando documentação → envio à aprovação, sem cobrança na data prevista; (2) parada no "Próximo passo"; (3) quem concluiu e não pediu a lista; (4) simulação salva sem link; (5) faixas 2 e 3 avançam menos (candidato).

**Lista de melhorias, versão 1** (impacto / esforço estimados)
1. Registrar "1º documento recebido" e "documentação completa" no card. Impacto alto, esforço baixo. Mede: % Doc→Aprov e tempo entre os dois. (crm-editor)
2. No dia seguinte à data prevista sem avanço, gerar alerta com texto sugerido, revisado pelo corretor (FUN-15b). Impacto alto, esforço baixo. Mede: % das previsões vencidas que chegam à aprovação em 7 dias.
3. Gatilho "abriu e parou antes do fim" vira tarefa para o corretor. Impacto alto, esforço médio. Mede: resposta e pedido de lista nesse grupo.
4. Gatilho "concluiu e não pediu lista" vira tarefa. Impacto médio, esforço baixo.
5. Gravar qual cena (id) o cliente viu, não só o número, e separar abertura do corretor da do cliente. Impacto médio (medição), esforço baixo.
6. Avisar quando uma simulação salva ficar mais de 2 h sem link enviado. Impacto médio, esforço baixo. Mede: p75 de simulação → link.
7. Registrar `presentation_sent` em todos os caminhos de envio: 14 clientes têm link sem esse registro. Impacto baixo, esforço baixo.
8. Deixar o "Próximo passo" e o botão da lista mais evidentes (designer-crm). Impacto médio, esforço médio. Mede: concluiu ÷ abriu.
9. Amortização como argumento para as faixas 2 e 3. Medir uso × pedido de lista quando houver 30 ou mais usos.
10. Consulta semanal fixa do funil pós-simulação (mesmas etapas desta tabela).

**Limitações.** Dados de 05/10 a 18/10. A abertura mistura cliente e corretor. Só 44 de 72 clientes têm conversa de WhatsApp gravada (MET-6). Documentos chegam fora do CRM. Quando o cliente pede a lista, o próprio sistema muda o status para Aguardando documentação (PRES-17), o que infla a etapa Doc da coorte de outubro: Doc já não quer dizer "documentos pendentes". A coorte C (de 05/10 em diante) é nova demais. 👍 e amortização têm menos de 1 dia de dado.

**Consultas usadas** (só leitura, nada gravado). Agregações por cliente em `simulation_presentations` (abertura, conclusão, previsão, estratégia, `last_scene`), `client_journey_events` (`presentation_sent`, `document_forecast_set`), `whatsapp_messages` + `whatsapp_conversations` (entrada depois do link e mídia recebida), `client_status_history` (rk pela MET-3 e tempos pela MET-6), `client_origins`, `calendar_activities` (tipo documentos) e `simulation_auto_reviews`. IC de Wilson 95% conforme `docs/analytics/consultas-base.md`.

**Para a cadeira 2 (Atendimento) decidir:**
- A cadência depois do envio. Metade das respostas vem em menos de 1 h, e o p75 é 5,4 h.
- O que dizer a quem parou no "Próximo passo" e a quem concluiu sem pedir a lista.
- Como cobrar documento na data que o próprio cliente escolheu, sem pressão.
- O que fazer com quem não abriu (9 clientes).
- Se "pediu lista" deve continuar mudando o status sozinho. Isso é decisão do dono.