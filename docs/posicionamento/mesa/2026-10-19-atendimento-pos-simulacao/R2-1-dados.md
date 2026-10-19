## Cadeira 1 (Dados), Rodada 2

**Resumo.** Confirmei que o cliente para no "Próximo passo": 29 das 33 apresentações abertas e não concluídas pararam exatamente na antepenúltima cena (IC 73–95%). Três decisões da V4 não se sustentam com os dados:
- **Lembrete pelo Oficial:** não teria alcançado ninguém. 0 dos 9 que não abriram receberam o link por esse número.
- **"1º documento = 1º arquivo salvo":** quase não mede nada. Só 2 dos 33 clientes em Aguardando documentação têm algum arquivo no CRM.
- **Esperar 30 dias de base antes da F2:** a base já existe. Esperar deixa cerca de 140 clientes passarem pela cena que mais vaza.

Unidade nesta rodada: apresentação (link `/s/`) criada de 05/10 a 18/10, sem clientes de teste, n = 74 (65 abertas). Na R1 a unidade era cliente (72), por isso os números diferem um pouco. Nada foi gravado: não escrevi nem na minha memória, como foi pedido.

### (a) Resposta às objeções
1. **Aberturas do corretor.** Aceito em parte, mas o efeito parece pequeno.
   - 35 das 65 primeiras aberturas são suspeitas: 23 em menos de 2 min depois do envio, 2 antes do envio e 10 sem envio registrado.
   - Esse grupo se comporta como cliente: concluiu 20 de 35, contra 12 de 30 no outro grupo. A mediana é de 3 visualizações, contra 4.
   - Candidatos fortes a "só o corretor abriu" (1 visualização, sem concluir, sem pedir lista): 6 de 65 (3–9%). Confiança baixa.
   - O que fica errado é o horário da 1ª abertura, não a contagem de quem abriu.
2. **"2 de 72" na amortização.** Aceito, e o problema é maior do que a cadeira 4 disse. O 1º salvamento é de 18/10, por volta de 22h (`payment_strategy_at`). Desde o lançamento só houve cerca de 6 apresentações abertas, e 2 salvaram. Retiro a métrica da R1.
3. **Id da cena dedutível.** Aceito, com duas ressalvas.
   - **Mudança de roteiro no meio do período.** Até 08/10 a cena "formação" existia sempre. Por isso 6 dos 32 concluídos (vistos de 06 a 08/10) aparecem com 1 cena a mais que a conta.
   - **A conta usa a simulação de hoje.** O link lê a simulação atual, e há simulações editadas depois de vistas; uma delas aparece com 1 cena a mais.
   - Qualquer cena nova quebra a dedução sem aviso. Gravar o id continua sendo barato, mas deixa de ser pré-requisito.

### (b) Medições
| # | Medida | Resultado | Fonte |
|---|---|---|---|
| 1 | Abriu e não concluiu (33) | Parou no Próximo passo: 29 (24 certos, 5 de 05 a 07/10 acertados pelo roteiro antigo, 2 de 08/10 incertos). Validar: 2. Abertura: 1. Inconsistente: 1. Conferência: 25 dos 32 concluídos batem com a conta, e os 7 que não batem têm explicação | `simulation_presentations.last_scene` (1-based, `player-core.mjs:96`) contra o total de cenas recalculado de `simulations.internal_note` pela regra de `simulation-presentation-core.mjs:172-238` |
| 2 | Pediu lista: salvou estratégia × não salvou | 0 de 2 contra 14 de 72 (todos os links) e 14 de 63 (só os abertos). n = 2, não diz nada | `payment_strategy_at`, `docs_forecast_at` |
| 3 | Links sem `presentation_sent` | 15 de 74. Só 2 têm o link `/s/` no Chat (mesmo token). 13 não têm nenhum registro, e 10 desses foram abertos: o link saiu por fora do CRM | `client_journey_events`, `whatsapp_messages` (regex de `simulation-first-core.mjs:16`) |
| 4 | Clientes em Doc com arquivo no CRM | 2 de 33. Só 7 clientes têm arquivo no CRM inteiro. Das 17 chegadas à Aguardando aprovação desde 05/10, só 2 tinham arquivo. 1º arquivo até aprovação: mediana 95 h (n = 4, não conclui). Mídia recebida no Chat depois de entrar em Doc: 4 de 33. 9 de 33 não têm conversa gravada. Mediana de dias em Doc: 17 | `client_documents`, `client_status_history`, `whatsapp_messages` |
| 5 | Aberturas do próprio corretor | Teto 54% (35 de 65 suspeitas), estimativa realista 3–9%. Não dá para separar sem cookie ou marca | Ver (a)1 |
| Extra | Canal do link | Dos 20 links que aparecem no Chat, 12 saíram pelo número pessoal, 2 pelo Oficial e 6 sem canal. Pelo Oficial: 0 dos 9 que não abriram | `whatsapp_conversations.account_channel` |

### (c) Decisões que questiono
1. **"30 dias de base antes da F2" (V4).** A base já existe: concluiu ÷ abriu = 32/65 = 49% (IC 37–61), e a parada está confirmada. Com cerca de 32 aberturas por semana, 30 dias de base só detectam diferença de 17 pontos ou mais, e custam cerca de 140 clientes na cena que vaza. Proposta: lançar o botão único junto com o registro de toques e comparar com 05 a 18/10, contando a partir de 08/10 por causa da troca de roteiro. A ressalva é que antes e depois não é causa.
2. **Item 6 da V4 ("1º documento = 1º arquivo salvo").** O arquivo do CRM é usado em 7 clientes. Medir por ele daria "zero documentos" falso. Vale a versão do Atendimento: chega mídia no Chat, o CRM sugere salvar e marcar, e o corretor confirma com 1 toque.
3. **Item 10 da V4 e item 6 do Atendimento (lembrete pelo Oficial).** Alcance medido em 2 semanas: 0 clientes. Risco alto por quase nenhum ganho. Proponho tirar da lista.
4. **"Medir por grupo em 7 dias" (V2/V4).** Os grupos são pequenos: 18 concluíram sem pedir lista e 9 previsões venceram em 2 semanas. Por meses, isso só descreve, não compara.

### (d) VERSÃO 5
| # | O que muda | Impacto × esforço | Como medir (n e prazo) | Dono? |
|---|---|---|---|---|
| 1 | "Próximo passo" com 1 botão principal e "Faltam 2 telas" | Alto × P | Concluiu ÷ abriu, hoje 49% (n = 65). Cerca de 140 aberturas, 4–5 semanas, detecta ≥ 17 pontos | Sim (PRES-12) |
| 2 | No mesmo deploy do 1: registro de toques (estratégia, agendar, imóveis, lista), marca de abertura com cookie de admin e id da cena | Alto (habilita) × M | Abriu estratégia ÷ abriu; % de aberturas de admin; 2 semanas já descrevem | Não |
| 3 | Texto T6 na atividade "documentos" e textos sem "toda" (tela, folha e mensagem) | Alto × P | Previsões vencidas → aprovação em 7 d, hoje 1/9. Descritivo até cerca de 30 previsões (cerca de 2 meses) | Sim (PRES-17) |
| 4 | Chega mídia no Chat de cliente em Doc: sugestão "salvar e marcar 1º documento", o corretor confirma | Alto × M | % de Doc com 1º documento (hoje 2/33) e dias até Aguardando aprovação | Não |
| 5 | Tarefa "parou no Próximo passo" (gatilho confiável pelo id da cena do item 2) e "concluiu sem lista" (18 em 2 semanas) | Alto × M | Resposta em 48 h por grupo, só descritivo | Sim (PRES-17) |
| 6 | 1º nome do corretor e CRECI da empresa na apresentação | Médio × P | Pediu lista ÷ concluiu, hoje 14/32 | Sim |
| 7 | Atalhos T1–T11 cadastrados na tela | Médio × P (sem código) | Uso dos atalhos e resposta em 24 h | Sim (textos) |
| 8 | Amortização em destaque no "Próximo passo", só depois de 2–3 semanas do item 2 | Médio × M | Abriu folha → pediu lista, com 30 ou mais aberturas da folha | Sim (PRES-4/12) |
| 9 | Consulta semanal fixa e aviso de link aberto sem envio registrado (13 de 74 saíram por fora) | Médio × P | % de links sem evidência de envio | Não |
| 10 | Alerta de simulação sem link (só horário comercial, descontando a espera do 👍) | Médio × M | p75 de simulação → link, hoje 21 h | Não |

**O que mudei**
1. A parada no Próximo passo passou de hipótese a medida (29/33), com conferência nos concluídos.
2. A medição vai junto com a mudança da cena, não 30 dias antes.
3. Tirei o lembrete pelo Oficial: alcance medido 0.
4. "1º documento" passa a depender da sugestão a partir da mídia do Chat, porque o arquivo do CRM é usado em 7 clientes.
5. Retirei o "2 de 72" da amortização: o denominador real é cerca de 6 aberturas desde 18/10.
6. Rebaixei a separação das aberturas do corretor: o efeito estimado é de 3–9%.
7. "presentation_sent em todos os caminhos" virou aviso de link sem registro: a lacuna real é o link copiado para fora do CRM.
8. Cada medida agora diz o n e o prazo, e o que é só descritivo.

**Para o Atendimento decidir**
- Se aceita sair o lembrete pelo Oficial.
- Como o corretor manda o link pelo Chat do CRM em vez de copiar: 13 links sem rastro.
- O texto da sugestão "salvar como 1º documento".
- A ordem entre T3 (parou no Próximo passo) e T4 (concluiu sem lista) quando o corretor tem pouco tempo.

**Limitações.** Até 18/10; o roteiro mudou em 08/10 e a estratégia entrou em 18/10. O total de cenas foi calculado sobre a simulação atual. Documentos chegam fora do CRM. 9 de 33 clientes em Doc não têm conversa gravada. Comparação antes e depois mostra associação, não causa.

**Consultas (só SELECT):** decodificação do bloco `__SIMULATION_MODELS__` (URL-encoded) para recalcular o total de cenas; evidência de envio pela regra de `lib/simulation-sent-lock-core.mjs`; `client_documents` × `client_status_history`; `account_channel` do 1º link enviado. IC de Wilson 95%.