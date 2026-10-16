## Mesa "WhatsApp dos corretores", Rodada 3, cadeira Dados (V7)

**Resumo.** São 06:41 em São Paulo (09:41Z). Ainda é cedo para dizer se o commit 140f9be9 destravou a fila: a primeira mensagem agendada de hoje é às 07:15. Três dados mudam o plano:
1. Dos 3.555 "cadastros próprios", 2.810 (79 %) vieram da própria prospecção da base importada. A base real para reativar tem **341** cadastros, não ~3.500. Ela acaba em cerca de 4 dias úteis, não em 30.
2. **58 % das quedas 500 acontecem exatamente aos 50 minutos de conexão.** É um temporizador mecânico, não acaso. As quedas não acontecem juntas em vários números, então não indicam o servidor inteiro.
3. Os recibos que aparecem "antes do envio" são uma corrida de gravação, não diferença de LID/jid.

**Limitação de entrada:** o arquivo R2-3 (V6) não existe na cópia local e esta sessão não tem shell para `git fetch`/`git show`. Não consegui ler a V6. Na parte (a) testei com dados as premissas que a V6 herda da V4 e da V5. Não li o texto da V6.

### (a) Premissas da V4/V5, testadas com dados
1. **"Reativar ~3.500 cadastros próprios, cerca de 30 dias úteis": DISCORDO.** O universo real é 341 (medição 2). A base importada vai continuar sendo a maior parte do volume, ou a meta de 15 por dia cai.
2. **"Destravar a espera de 2 h é a prioridade 1": CONCORDO.** As quedas 500 têm vida fixa de ~50 min, o que confirma que uma espera reiniciada a cada reconexão nunca chegaria ao fim.
3. **"Investigar se os 500 são do servidor ou do IP": a hipótese do servidor inteiro está REFUTADA.** Mas aparece um problema novo: o temporizador de 50 min (medição 4).
4. **"Teste de IP medido por 401 por abertura": CONCORDO com ressalva.** A taxa base é baixa (1,3 %) e metade dela vem de um único número. Um teste em um número só não terá poder estatístico.
5. **"3ª tentativa só manual": ainda NÃO está em vigor.** Hoje há 3ªs tentativas automáticas na fila (Jennyfer e Izabela).
6. **"Calibrar o A1 pelo recibo": cuidado.** O corretor com mais recibos (Bencke, 80 %, 32 de 40) foi justamente quem levou 403. O recibo sozinho não previu a restrição. O número de 403 é pequeno, então a confiança é baixa.

### (b) Medições

**1. Fila.** Fonte: `daily_goal_auto_queue` com status `sent`, por dia em São Paulo, de 09 a 16/10. Envios por dia:

| Dia | Envios | Corretores enviando |
|---|---|---|
| 10/10 | 52 | 6 |
| 12/10 | 51 | 4 |
| 13/10 | 45 | 3 |
| 14/10 | 7 | 1 |
| 15/10 | 2 | 2 |
| 16/10 até 06:41 | 1 | 1 |

- O envio de hoje é da Caroline, às 09:40:21Z (depois de 09:35Z). Antes de 09:35Z houve 0 envios.
- Para hoje há **39 envios agendados para 3 corretores**: Jennyfer 15, Caroline 14, Gabriel 10. Os horários vão de 07:15 a 17:48.
- Três corretores estão pausados: Bencke (403), Bruna (pausada pelo admin) e Ketlin. A Izabela está pausada desde 05/10 ("teste lento"). O Eduardo está com "Usar para disparo" desligado e tem 12 envios presos desde 10/10.
- **Ainda é cedo para concluir.** O ponto de checagem é por volta das 15h: se a fila tiver voltado, os 3 corretores devem estar com mais de 5 envios cada.
- **Fato novo:** a sessão da Caroline caiu com 401 "Stream Errored (conflict)" às 09:40:19Z, 5 segundos depois de começar o envio. É um caso só (n = 1). Desde 29/09, 8 de 45 quedas 401 vieram até 5 min depois de um envio automático do mesmo corretor. Isso é **inconclusivo**: não calculei a taxa esperada por acaso. A telemetria não registrou esse 401, que só aparece em `whatsapp_session_events`.

**2. Recorte dos "~3.500".** Fonte: `simulation_registrations` × `client_origins`, n = 3.555 (3.523 telefones).
- 2.810 têm `prospecting_contact_id`, ou seja, vieram da base importada. Desses, 1.453 estão "tentando contato" e 831 em Não contactar.
- Ficam **745 cadastros que não vieram da prospecção**. Excluindo Não contactar (153), Venda (6) e clientes em andamento nas etapas 1 a 6 (245), sobram **341**. Desses, **266 têm responsável ativo**.
- Composição dos 341:
  - 282 arquivados;
  - 56 "tentando contato";
  - 3 em atendimento automático;
  - **160 entraram por conta própria** (WhatsApp do corretor 109, link do corretor 23, campanha 10, anúncio 8, site 7, outros 3);
  - **181 têm origem incerta** (manual 97, unknown 84).
- Só 4 dos 341 preencheram o formulário (`last_form_submitted_at`).
- 90 dos 109 que vieram pelo WhatsApp tiveram contato registrado nos últimos 30 dias. Isso cai na exclusão por conversa recente (MD-13).
- **O LeadCaptureModal grava em outra tabela (`leads`), não em `simulation_registrations`. São só 6 cadastros no total** (29/07 a 07/10). O universo "com aviso de contato" é de 6 pessoas.

**3. Recibos.** Fonte: fila automática.
- Recibo antes do `sent_at`: hoje são **26 casos** (eram 28; a diferença pode vir de dados atualizados).
- **É corrida de gravação.** Em mediana o recibo chega 0,11 s antes do `sent_at`, no máximo 3,8 s. Nos 8 casos que têm `send_started_at`, o recibo caiu entre o início do envio e o registro dele. Nenhum caso tem recibo antes do início do envio.
- O envio dura 6 s em mediana (p90 9 s), e o `sent_at` só é gravado no fim.
- Últimos 14 dias (02 a 16/10): **118 de 244 (48 %, IC 42–55) sem recibo nenhum**. Entre as mensagens com mais de 24 h, 116 de 241.
- Por corretor: Bruna 24/25, Izabela 22/39, Jennyfer 29/65, Ketlin 27/59, Bencke 8/40.

**4. Quedas 401 e 500.** Fonte: `whatsapp_session_telemetry`, de 04 a 16/10.
- **401 por abertura de sessão:** 30 de 971 aberturas tiveram 401 depois de abrir; **13 de 971 (1,3 %) caíram até 30 min depois de abrir.**
  - A Izabela sozinha tem 6 de 48. Sem ela, são 7 de 923 (0,8 %).
  - Jennyfer: 0 de 195 aberturas, somando os 2 números.
  - A telemetria registra menos 401 do que `session_events`: 30 contra 41.
- **Quedas 500:** 417 quedas em 13 números.
  - 404 minutos tiveram queda em um número só, 5 minutos em 2 números e 1 minuto em 3 números.
  - O acaso, considerando o volume, explicaria cerca de 5 minutos com mais de um número. **Não há sinal de problema do servidor ou do IP inteiro.**
  - Porém **240 de 417 (58 %) aconteceram entre 49,9 e 50,2 minutos de conexão** (p25 = 50,0 min). Desde 15/10, o `detail` dessas quedas é `stream:error.ack.text` (36), `ack.media` (22) ou `ack.reaction` (1).

### (c) VERSÃO 7
1. **Prospectar.** Primeiro confirmar hoje se a fila voltou. Volume de 15 por dia pelo Número de prospecção. Base: os 160 que entraram por conta própria primeiro, depois os 181 de origem incerta conforme decisão do dono. A base importada continua sendo o volume principal, com o texto 1ª-D. 3ª tentativa só manual (ainda falta implementar).
2. **Detectar cedo.** Consertar a corrida dos recibos gravando o `sent_at` no início do envio ou aceitando recibo que chegue ±10 s antes. Classificar o 401 pelo `detail` ("conflict"). Marca "em risco" por número. O recibo não serve como alarme sozinho.
3. **Voltar rápido.** Rotina da V5. Gestora retoma pausas em até 1 dia útil: hoje são 4 corretores parados, mais o Eduardo com envio desligado.
4. **Reserva.** Igual à V5.
5. **Salvar/responder.** Igual à V5. O botão do site atinge pouca gente (6 cadastros no modal, 7 do site).

**Decisões do dono, em ordem de prioridade:**
1. Confirmar a regra da espera de 2 h já publicada (140f9be9), à luz da checagem das 15h de hoje.
2. Base: aceitar que o universo próprio é de 341 cadastros e decidir se mantém a base importada (risco pelos Termos) para sustentar o volume.
3. Liberar as 4 pausas e o envio desligado do Eduardo, ou negar.
4. 3ª tentativa só manual.
5. Autorizar a investigação do temporizador de 50 min (encaminhar ao `crm-editor` e à cadeira WhatsApp) antes de gastar com IP.
6. Teste de IP: só faz sentido com mais de um número, por causa da taxa base de 1,3 %.

**Limitações:**
- Não li a V6.
- Hoje está só no começo da janela de envio.
- A telemetria registra menos 401 do que existem.
- `last_whatsapp_contact_at` não prova que houve mensagem (MET-6).
- Os 401 depois de envio não foram comparados com o acaso.
- Não gravei memória: esta sessão não tem ferramenta de escrita.

**Consultas (todas SELECT):** fila por dia e corretor; pendentes por dia; sessões e configurações atuais; `session_events` 401 classificados pelo `detail`; corrida `delivered_at` × `send_started_at`/`sent_at`; recibo em 14 dias; recorte `simulation_registrations` × `client_origins` × `admin_users`; `leads` por `source`; 401 por abertura na telemetria; quedas 500 por minuto e por `connected_ms`.

Arquivos lidos:
- /home/user/imoveis-mvp/docs/posicionamento/mesa/2026-10-16-whatsapp-corretores/BRIEF.md
- /home/user/imoveis-mvp/docs/posicionamento/mesa/2026-10-16-whatsapp-corretores/R2-1-dados.md
- /home/user/imoveis-mvp/docs/posicionamento/mesa/2026-10-16-whatsapp-corretores/R2-2-whatsapp.md
- /home/user/imoveis-mvp/app/api/leads/route.js
- /home/user/imoveis-mvp/components/LeadCaptureModal.jsx