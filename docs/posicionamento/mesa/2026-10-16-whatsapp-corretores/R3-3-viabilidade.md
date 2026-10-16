## Mesa WhatsApp, Rodada 3, cadeira Viabilidade (V9 final)
Só li `origin/main` (2d044b14) e os dois Baileys que estão no scratchpad. Não editei nada, não gravei no banco e não fiz commit.

### (a) V8 e V7 conferidas no código
- **V8, `detail` só existe desde 15/10:** confirmado. O commit 2d52451d é de 15/10 às 06:49 (-03). A V7 não pode afirmar que o erro "começou em 15/10".
- **V8, "mais de 10 logins por dia por número":** os números da V7 não sustentam isso. 417 quedas ÷ 13 números ÷ ~12 dias dá **~2,7 quedas por dia por número**. Além disso, a queda 500 retoma a sessão já salva, sem parear de novo. Na conta de risco, isso pesa bem menos que um QR novo.
- **V8, 401 com "conflict" = aparelho removido:** confere com o código. `getErrorCodeFromStreamError` (Baileys `generics.js:273-283`) usa primeiro o `code` do nó e só depois o `conflict` (440). O nosso `summarizeDisconnectData` (`reconnect-policy.js:410-422`) já grava `child.attrs.type`. Então a telemetria da Caroline deve mostrar `stream:error.conflict.device_removed` se a V8 estiver certa. Dados confere em uma consulta, sem código.
- **V8, folga de ±10 s (V7) contra `send_started_at`:** fico com a V8. Usar o `send_started_at` é a correção da causa; a folga só esconde a corrida.
- **V8, janela "8h–18h":** isso **muda a REGRA OFICIAL MD-15 item 9** (06:30–18:00, segunda a sábado). Só com "sim" do dono.
- **3ª tentativa só manual:** muda a **REGRA OFICIAL MD-14b** (10/10/10, sem empréstimo entre etapas). É decisão de regra, não ajuste técnico.
- **Fato novo:** o microsserviço não trata mensagem recebida que não decifra (nenhuma menção a `CIPHERTEXT` em `whatsapp-individual-service/src`). Essa mensagem some do Chat sem deixar rastro. Pode ser resposta de cliente da prospecção que se perde. O diagnóstico abaixo mede quantas são.

### (b) Hipótese da queda aos 50 min
- **As linhas citadas conferem.** No 6.7.24, `sendRetryRequest` (`messages-recv.js:90-94`) sai sem mandar nada depois de 5 pedidos de reenvio. O `catch` (`:701-703`) só registra o erro e não confirma a mensagem. O contador de pedidos é criado **por socket** (`:19`) e zera a cada reconexão. No rc14, a resposta negativa é enviada depois do pedido de reenvio (`:1388`) e no `catch` (`:1436-1438`).
- **Ressalvas:**
  1. O rc14 manda a resposta negativa depois de **todo** pedido de reenvio, não só quando os pedidos se esgotam. Copiar isso igual pode fazer o WhatsApp desistir de mensagens que ainda decifrariam. Recomendo mandar a resposta negativa **só ao esgotar os pedidos e no erro**.
  2. Há uma **hipótese concorrente**. No 6.7.24 a confirmação de mensagem não leva o campo `from` (`:57-59`). No rc14 leva sempre (`Utils/stanza-ack.js:32-35`). Nesse caso o WhatsApp estaria recusando uma confirmação malformada nossa. O relógio fixo de 50 min favorece a hipótese da V8, mas só o diagnóstico separa as duas.
- **Como o microsserviço é instalado:** `npm` + `package-lock.json`. O Dockerfile roda `npm ci --omit=dev`. `railway.json` usa o builder DOCKERFILE e só publica quando muda algo em `/whatsapp-individual-service/**`. **`pnpm patch` não serve.**
- **Correção da confirmação (M):**
  - **Opção recomendada:** um script nosso (`scripts/patch-baileys.mjs`, nome sugerido) rodado no Dockerfile logo depois do `npm ci`. Ele troca um trecho exato e **falha o build** se a versão não for 6.7.24 ou se o trecho não for encontrado. Com o build falho, o Railway mantém a versão anterior no ar. Não muda o lockfile.
  - **`patch-package` também dá,** mas tem que ir em `dependencies` (o `--omit=dev` descarta o resto), ganhar um `postinstall`, um `COPY patches` antes do `npm ci` e o lockfile regenerado.
  - **Teste:** o "teste com nó falso" da V8 é otimista. `handleMessage` fica fechado dentro do socket, e a raiz do projeto nem tem o Baileys instalado. Teste realista: um teste `node --test` do script contra trechos copiados do arquivo (aplica, não aplica duas vezes, falha se o trecho mudar). A prova de verdade é a medição em produção: quedas 500 entre 49,9 e 50,2 min, hoje 58 %, devem ir para perto de 0 em 2 dias úteis.
  - **Riscos:**
    - a publicação reconecta todos os números, então publicar depois das 18h;
    - pela regra 7b, reinício do serviço com retomada em menos de 30 min não recomeça a espera de 2 h;
    - mensagem que não decifra passa a ser descartada de vez (hoje ela também não chega ao Chat).
  - **Desfazer:** reverter o commit, ou fazer rollback do deploy no painel do Railway (minutos, mais uma reconexão geral).
- **Diagnóstico passivo (P, risco baixo):** o padrão já existe (`sessions.js:457-458`, `sock.ws.on("CB:receipt"/"CB:ack")` só observando). O que medir, sempre com id em hash:
  - mensagens recebidas que não decifram (CIPHERTEXT);
  - pedidos de reenvio das nossas mensagens (`receipt type=retry`);
  - id e `class` do `<ack>` dentro do `stream:error`;
  - `detail` também no `session_events`.

  Ligar `BAILEYS_LOG_LEVEL=debug` (`:73`) não é recomendado: joga telefone e conteúdo no log do Railway. Desfazer = reverter o commit.
- **`getMessage` com cache (M):** cache em memória das mensagens que nós enviamos, por 24 h, com tamanho máximo. Reinício do serviço apaga o cache. Fazer **separado e depois** da correção, para medir o efeito de cada um. Ganho para "quem não salvou o número" é hipótese. Teste: unitário do cache.

### (c) 12 textos neutros
- Rodei o script `chk/check.mjs` contra as regras do `tests/daily-goal-policy-v2.test.mjs:503-541`: **0 falhas**.
  - Curtos têm de 142 a 168 caracteres (limite ≤ 200); longos, de 332 a 371 (mínimo ≥ 300).
  - Os 12 mantêm curto/longo **na mesma posição**, então `pickV2Variant` e os `variant_index` antigos continuam valendo.
  - O texto é escolhido no envio (`daily-goal-auto.js:1931-1932`), então itens já na fila sairão com o texto novo.
  - O item (6) da MD-15 v2 continua cumprido.
- **Problemas:**
  1. **Pouca variação.** "faz parte dos seus planos" aparece em 1ª[1], [3], [7] e 2ª[9]. 1ª[0], [4] e [6] são quase a mesma pergunta. Isso reduz o efeito anti-repetição contra filtro de spam: vale reescrever 2 ou 3.
  2. **Ainda supõem interesse anterior:** 2ª[5] ("continua com vontade") e 3ª[3] e [9] ("já comprou seu imóvel", "ainda é um objetivo"). Fica para o dono dizer se o critério é amplo ou estreito.
  3. Trocar o texto **exige "sim" do dono**: os modelos fazem parte da regra oficial.

### (d) VERSÃO FINAL (V9)
1. **Prospectar:** 15 por dia pelo Número de prospecção, janela oficial 06:30–18:00 até o dono decidir. Base importada como volume, com os textos neutros. Reativação dos 341 arquivada.
2. **Detectar cedo:** diagnóstico passivo → corrida dos recibos pelo `send_started_at` → 401 pelo tipo (`device_removed` × `replaced`) → marca "em risco" → A1 só depois de calibrado.
3. **Voltar rápido:** tabela da V5. 401 `device_removed` logo depois de um envio = lista impressa no dia e QR só no dia seguinte. Gestora resolve as pausas.
4. **Reserva:** sem rodízio; Número 2 para relacionamento; chip reserva só se o dono pagar.
5. **Salvar/responder:** 1ª mensagem sem link e com pergunta. Link só depois da resposta, junto com o pedido para salvar o contato. *SAIR* continua.

**Plano, em ordem:**
| # | O quê | Quem | Esforço | "Sim" do dono? |
|---|---|---|---|---|
| 0 | Checagem das 15h da fila; ler o `detail` do 401 da Caroline | Dados | P | não |
| 1 | Liberar ou negar as 4 pausas e o "Usar para disparo" do Eduardo | dono/gestora | nenhum código | **SIM** |
| 2 | Diagnóstico passivo no microsserviço, publicado depois das 18h | crm-editor | P | **SIM (publicar no Railway)** |
| 3 | Recibos pelo `send_started_at`; CSV do Oficial bloqueando Não contactar de `simulation_registrations` | crm-editor | P + P | não (correção de defeito) |
| 4 | 12 textos (+ ajuste de variação) | dono → crm-editor | P | **SIM (textos)** |
| 5 | Patch da confirmação de mensagem por script no Docker, se o passo 2 confirmar a hipótese; medir 2 dias úteis | crm-editor | M | **SIM (Railway)** |
| 6 | `getMessage` com cache, isolado | crm-editor | M | **SIM (Railway)** |
| 7 | Base: importada como volume; arquivar reativação | dono | nenhum código | **SIM (base)** |
| 8 | 3ª tentativa só manual (muda MD-14b); janela 8h e sábado (mudam MD-15 item 9) | dono → crm-editor | P código / M impacto | **SIM (3ª, janela)** |
| 9 | Pareamento novo com `Browsers.ubuntu` em número de teste; IP fixo só depois de medir o passo 5 | dono → crm-editor | P / custo Railway | **SIM (teste, IP)** |

Arquivos:
- /home/user/imoveis-mvp/whatsapp-individual-service/Dockerfile
- /home/user/imoveis-mvp/whatsapp-individual-service/railway.json
- /home/user/imoveis-mvp/whatsapp-individual-service/package-lock.json
- /home/user/imoveis-mvp/whatsapp-individual-service/src/sessions.js (73, 433-437, 457-458)
- /home/user/imoveis-mvp/whatsapp-individual-service/src/reconnect-policy.js (410-422)
- /home/user/imoveis-mvp/lib/daily-goal-policy-messages.mjs
- /home/user/imoveis-mvp/tests/daily-goal-policy-v2.test.mjs
- /tmp/claude-0/-home-user-imoveis-mvp/dcd2978e-8bf8-5388-9b95-cb62ddb37c33/scratchpad/baileys/package/lib/Socket/messages-recv.js
- /tmp/claude-0/-home-user-imoveis-mvp/dcd2978e-8bf8-5388-9b95-cb62ddb37c33/scratchpad/baileys/v7/package/lib/Utils/stanza-ack.js