# Operação dos disparos do WhatsApp (guia para quem não é técnico)

Atualizado em 2026-10-10 (proteções anti-banimento: §8). Vale para os disparos **automáticos** pelo WhatsApp do corretor (Meta Diária automática e a fila do botão "Disparar" da Prospecção). Não vale para o botão manual (o clique do corretor no link do WhatsApp), nem para o Disparo em massa oficial.

## 1. A política nova ("v2") — VIGENTE para todo corretor com a automação ligada (desde 2026-10-04)

**[REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-04]**

| Item | Regra |
|---|---|
| Quantas por dia | no máximo **30 mensagens por número**: 10 de 1ª tentativa, 10 de 2ª e 10 de 3ª, **sem emprestar** de uma etapa para outra (10+6+10 = 26, nunca 30). A fila "Disparar" conta no total de 30 (não aumenta o teto). O botão manual não muda |
| Tamanho da fila | cada tentativa guarda **no máximo 10 itens pendentes** na fila automática. O que passa disso é **retirado só da fila** (ver 1.1) |
| Dias e horário | **segunda a sábado, das 6h30 às 15h30** (horário de Brasília). Domingo e fora do horário: não tenta |
| Intervalo | mínimo **5 minutos**, máximo **8 minutos** entre uma mensagem e outra (sorteado dentro dessa faixa). Nunca menos de 5 min. Se o sistema atrasar além de 8 min (atraso técnico), tudo bem; 8 min é o limite do agendamento |
| Pausa | **15 a 30 minutos** de pausa a cada ~10 envios (8 a 12, sorteado) |
| Cada número | envia sozinho, sem combinar com os outros corretores |
| Mensagens | modelos novos, **curtos e longos alternados**, nunca repete o modelo anterior nem o penúltimo; a 1ª, 2ª e 3ª **sem promessa** (sem "sem entrada", aprovação, valor, prazo) e **sem link**; todas terminam com **"responda SAIR"** em destaque. Quem responde SAIR vira "Não contactar" na hora (já funcionava; confirmado no código em 2026-10-10 — §8.5) |
| Reconexão | quando o WhatsApp volta, **não sai tudo atrasado de uma vez**: os atrasados são **reagendados** para os próximos horários livres, e o 1º envio só acontece **5 minutos depois** de conectar |
| O que não saiu no dia | **não é cancelado**: passa para o dia seguinte (sem duplicar), respeitando o teto de 30 e os 10/10/10 |

**Janela e intervalo vêm da própria política** (06h30–15h30 e 5 a 8 min), **não** dos valores antigos gravados no banco (07h–14h, 5 a 10 min), que deixam de valer. A configuração gravada de quem tem a automação ligada foi alinhada aos mesmos valores e a tela mostra os valores novos.

### 1.2 Como ler os números do card da Meta Diária

Três números diferentes, que NÃO se somam: (a) **Fila automática de hoje X de 30 (1ª a/10 · 2ª b/10 · 3ª c/10)** = o que a automação realmente envia (enviadas hoje + na fila, máximo 10 por tentativa); (b) **x / y atividades da meta (carteira N + pendentes P)** = a meta do dia, que inclui acumulados e o que é feito à mão, congelada de manhã; (c) **Carteira ativa N/30 (aguardando 1ª · 2ª · 3ª)** = clientes em cadência; o teto é 30 (era 50 até 2026-10-04: o excedente foi devolvido à Prospecção, MD-14). A limpeza da política v2 mexe só em (a).

### 1.1 Limpeza do excesso da fila

Corretores chegaram a ter 40, 60, 80 itens acumulados na fila. Ao valer a política nova, o sistema (código do servidor, sem enviar nada) **reduz cada tentativa a no máximo 10 itens**, ficando com os **10 prioritários** na ordem normal da fila (os de horário mais cedo; empate pelo mais antigo). Os demais são **cancelados só na fila** (motivo `policy_v2_trim_excess`): **nenhum cliente é excluído, arquivado, marcado como contatado ou muda de etapa do funil, e nenhum histórico é apagado**. Os retirados **não voltam** nem hoje nem amanhã como pendência automática (o corretor os trabalha pelo botão manual). A limpeza roda sozinha a cada ciclo do disparo (inclusive com a sessão desconectada) e na reconexão; é **idempotente** (rodar de novo não retira mais nada). Auditoria: tabela `daily_goal_policy_trim_log` (corretor, tentativa, quantos ficaram, quantos saíram, quando) e o motivo em cada item cancelado. O dia seguinte gera no máximo 10 por tentativa, pela cota de 10 novos por dia e carteira de 50 já existentes (regras inalteradas).

Não mudam: a cota de 10 novos por dia, a carteira de 30, a pontuação, o ranking e a Meta de 100%. Atenção: com o teto de 30, a automação não cobre sozinha toda a Meta de quem tem mais de 30 atividades no dia; o restante continua sendo feito à mão pelo botão manual.

## 2. Estado da política e como desligar para UM corretor

**A política v2 é a vigente por padrão** para todo corretor com a automação ligada (a coluna `policy_v2_enabled` ausente ou vazia vale como ligada). Quem está com a automação **desligada continua desligado**: a política nunca liga a automação de ninguém. **Para desligar a política de UM corretor (voltar à antiga):** Gestão › Meta Diária › aba **Automação** › cartão do corretor › **"Voltar à política antiga"** (só administrador geral; é o único opt-out; "Ligar política nova" reverte). Não envolve migration para funcionar, mas o interruptor só grava depois da migration (§7).

## 3. Como PAUSAR manualmente (fica na mão da gestora)

- **Um corretor:** Gestão › Meta Diária › aba **Automação** › cartão do corretor › botão **"Pausar"** (vira **"Retomar"** para voltar). Pausar para os envios automáticos desse corretor na hora (Meta Diária e fila "Disparar"); a fila fica guardada. Quem pode: administrador e gestora (cada gestora só os da própria equipe).
- **Desligar de vez a automação de um corretor:** mesmo cartão, botão **"Desativar"** (e **"Ativar"** para voltar).
- **Todos de uma vez:** não existe um botão único. É preciso **Pausar** corretor por corretor (a lista fica na mesma aba). Isso é intencional por enquanto.
- O sistema também pausa sozinho um corretor após **3 erros seguidos de envio** (já era assim) e, desde 2026-10-10, **o número** que recebe bloqueio (403) ou logout do WhatsApp (§8). O alerta de entrega descrito abaixo **não pausa nada**.

## 4. Alerta de taxa de entrega (monitor)

**[REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-04]** Roda sozinho (a cada hora, junto do disparo), **sempre ligado**, não depende da política nova.

- Mede, por corretor e por dia, a **% de mensagens da Meta Diária automática que o WhatsApp confirmou** (pelo menos 1 tique). Só conta mensagens enviadas **entre 1 e 24 horas atrás** e **somente da automação** (não o manual, não a fila "Disparar").
- Só avalia com **pelo menos 20 mensagens**. Ignora domingo, mensagens fora de 6h30–15h30 e corretor com WhatsApp desconectado (também ignora o que foi enviado antes da última queda).
- Se a taxa ficar **abaixo de 60%** (limite provisório), a **Caroline Mayumi** (gestora) recebe **um e-mail** dizendo qual corretor, qual dia, quantos %, quantas mensagens foram avaliadas. No máximo **1 e-mail por corretor por dia** e **5 por execução**; só olha hoje e ontem.
- **O que o alerta significa:** muitas mensagens sem confirmação. Pode ser bloqueio ou restrição do número.
- **O que ele NÃO significa:** não prova bloqueio. Celular desligado/sem internet e recibo atrasado (podem levar horas) parecem bloqueio. **Nada é pausado automaticamente.** A decisão de pausar é da gestora.
- Limites: só conhece a **última** queda de cada WhatsApp (não o histórico completo); o 1 tique já conta como confirmado; o limite de 60% e a amostra de 20 podem ser ajustados sem mudar código (registro `daily_goal_delivery_monitor` em `crm_settings`: `thresholdPercent`, `minSample`, `maxAlertsPerRun`). O estado da última avaliação fica em `crm_settings` (`daily_goal_delivery_monitor_state`) e a marca "já avisado hoje" em `delivery_alert:<dia>:<corretor>`. Sem migration.
- Se o envio de e-mail não estiver configurado (Resend), o alerta **não é perdido**: é tentado de novo na próxima hora.
- **Tendência (2026-10-10):** além dos 60%, o mesmo e-mail (só aviso, nada é pausado) sai quando a taxa do dia cai **mais de 20 pontos** abaixo da média dos 7 dias anteriores do próprio corretor (precisa de 3 dias anteriores com 10+ mensagens) ou quando as **últimas 10 mensagens seguidas** não tiveram **nenhum tique**. Também 1 por corretor por dia (cada tipo), dentro do limite de 5 por execução.
- Recomenda-se acompanhar **2 a 4 semanas** de dados antes de qualquer decisão sobre pausa automática.

## 5. O que NÃO foi feito (de propósito)

- Pausa automática por taxa de entrega (a pausa automática existente é só por erros de envio seguidos e por bloqueio/logout do número, §8).
- Verificação de denúncia.
- Bloqueio da API do WhatsApp.
- Botão único "pausar todos".

## 6. Onde está no código (para o desenvolvedor)

Limpeza do excesso: `planV2Trim` (puro) e `trimV2QueueExcess` (`lib/daily-goal-auto.js`). Regras puras e testadas: `lib/daily-goal-policy-core.mjs` (política), `lib/daily-goal-policy-messages.mjs` (modelos), `lib/daily-goal-delivery-monitor-core.mjs` (monitor). Ligação com o banco: `lib/daily-goal-auto.js` e `lib/daily-goal-delivery-monitor.js`. Testes: `tests/daily-goal-policy-v2.test.mjs`, `tests/daily-goal-delivery-monitor.test.mjs`.

## 7. Aplicar a migration de ativação (passo a passo para quem não é técnico)

O código já funciona **sem** a migration (política vigente por padrão; limpeza feita pelo servidor; janela e intervalo vindos da política). A migration só (a) cria a coluna do interruptor por corretor, (b) cria a tabela de auditoria `daily_goal_policy_trim_log` e (c) alinha a configuração gravada (06h30–15h30, 5–8 min) de quem tem a automação ligada. **Não envia nada, não toca clientes, funil, histórico nem a fila, e não liga automação de ninguém.**

1. Abra o Supabase › projeto do imóveis › **SQL Editor** › **New query**.
2. Abra o arquivo `docs/sql-manual/aplicar-politica-v2-disparos.sql` (no repositório), copie **tudo** e cole na query.
3. Clique **Run**. Pode rodar mais de uma vez com segurança.
4. Deve aparecer, no final, uma tabela "DEPOIS" com cada corretor, `policy_v2_enabled = true` para quem tem a automação ligada, janela `390`–`930` e intervalo `5`–`8`. A linha de quem está desligado (ex.: o dono) mostra `enabled = false` e continua assim.
5. Se der erro: não faz mal, a query roda em transação e nada é gravado pela metade. Copie a mensagem e envie ao suporte.

## 8. Proteções anti-banimento (regra do dono, 2026-10-10)

**[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-10]** Detalhe técnico: `docs/BUSINESS_RULES.md` MD-15.

1. **Número bloqueado ou desconectado pelo WhatsApp (403 / logout) = pausa só daquele número.** A automação desse número para na hora (o outro número do mesmo corretor continua), a fila fica guardada, e o **corretor e a gestora** recebem um aviso importante na Central de Alertas ("Disparos pausados por segurança"). **Para voltar é preciso retomar à mão:** Gestão › Meta Diária › aba **Automação** › cartão do corretor › **"Retomar Número N"** (ou **"Retomar"**, quando o corretor inteiro foi pausado por não sobrar número). Quem pode: administrador e gestora da equipe. Se o corretor tem um só número (ou os dois foram pausados), o corretor inteiro fica "Pausado" com o motivo. A taxa de entrega nunca pausa.
2. **Aquecimento de número novo ou que voltou depois de um bloqueio (403):** limite por dia de **10** nos dias 1 e 2, **15** nos dias 3 e 4, **20** nos dias 5 e 6 e **30** do 7º dia em diante. Conta a partir da 1ª conexão do número (ou de quando o número foi trocado) ou do dia em que a gestora **retomou** depois de um 403 (o tempo parado não conta). O cartão mostra "aquecimento de número novo/reconectado (N por dia)". Os 30 por dia e o 10/10/10 continuam sendo o máximo. Número que já enviava antes desta regra **não** entra em aquecimento.
3. **Tendência de entrega:** ver §4.
4. **Fila parada / erros repetidos:** aviso na Central (informativo) ao corretor e à gestora quando uma mensagem pendente fica **mais de 2 horas parada dentro do horário de envio** ou quando há **mais de 5 erros seguidos do mesmo tipo**. Um aviso por problema por dia. Não conta como parada: teto do dia atingido, fora do horário/domingo, intervalo ou pausa programada, número pausado, WhatsApp desconectado.
5. **Resposta SAIR do cliente:** já vira "Não contactar" sozinha (cliente, linhas da fila do mesmo telefone/cadastro e mensagens pendentes), com registro no log de "não contactar". Se o cliente estiver em outra etapa (ex.: documentação) ou sem tentativa nas últimas 48 h, o sistema só bloqueia a fila daquele telefone e confirma ao cliente — o status do cliente não muda (lacuna conhecida, sem alteração).
6. **Google Contacts:** se o Google falhar de forma passageira (ex.: erro 502), o sistema tenta sincronizar no máximo **3 vezes** por contato. Na 4ª vez a mensagem **sai sem sincronizar**, e o item registra o motivo ("google_contacts_ignorado_apos_3_falhas"). Erro de permissão continua marcando a conexão como "Requer reconexão".

**Migration (aplicar na Central do Supabase, nunca automática):** `supabase/migrations/20261010140000_daily_goal_protecoes_anti_banimento.sql` — cria a coluna `slot_controls` (estado por número) e as duas definições de alerta. Só acrescenta; pode rodar mais de uma vez. **Sem ela o sistema funciona**, mas 403/logout pausa o corretor inteiro (não só o número), não há aquecimento e os avisos da Central não são entregues (o log do servidor registra o motivo). Ao publicar com a migration aplicada, quem estiver com sessão em 403/logout nas últimas 72 h (ainda caída) será pausado e avisado; quem reconectou há mais de 6 h não.
