# Operação dos disparos do WhatsApp (guia para quem não é técnico)

Atualizado em 2026-10-04. Vale para os disparos **automáticos** pelo WhatsApp do corretor (Meta Diária automática e a fila do botão "Disparar" da Prospecção). Não vale para o botão manual (o clique do corretor no link do WhatsApp), nem para o Disparo em massa oficial.

## 1. A política nova ("v2") — o que muda para o corretor que estiver com ela ligada

**[REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-04]**

| Item | Regra |
|---|---|
| Quantas por dia | no máximo **30 mensagens por número**: 10 de 1ª tentativa, 10 de 2ª e 10 de 3ª. A fila "Disparar" conta no total de 30 (não aumenta o teto) |
| Dias e horário | **segunda a sábado, das 6h30 às 15h30** (horário de Brasília). Domingo e fora do horário: não tenta |
| Intervalo | mínimo **90 segundos**, máximo **8 minutos** entre uma mensagem e outra (sorteado dentro dessa faixa). Nunca duas ao mesmo tempo |
| Pausa | **15 a 30 minutos** de pausa a cada ~10 envios (8 a 12, sorteado) |
| Cada número | envia sozinho, sem combinar com os outros corretores |
| Mensagens | modelos novos, **curtos e longos alternados**, nunca repete o modelo anterior nem o penúltimo; a 1ª, 2ª e 3ª **sem promessa** (sem "sem entrada", aprovação, valor, prazo) e **sem link**; todas terminam com **"responda SAIR"** em destaque. Quem responde SAIR vira "Não contactar" na hora (já funcionava) |
| Reconexão | quando o WhatsApp volta, **não sai tudo atrasado de uma vez**: os atrasados são **reagendados** para os próximos horários livres, e o 1º envio só acontece **5 minutos depois** de conectar |
| O que não saiu no dia | **não é cancelado**: passa para o dia seguinte (sem duplicar), respeitando o teto de 30 e os 10/10/10 |

Os limites antigos de configuração (janela, intervalo) continuam valendo **só se forem mais restritivos**. Hoje o banco está em 07h–14h com intervalo de 5 a 10 min: nesse caso a política nova usa 07h–14h (mais curto que 6h30–15h30) e intervalo de 5 a 8 min (o mínimo de 5 min do banco é mais restrito que os 90 s). Para valer a faixa completa do dono (6h30–15h30 e 90 s a 8 min), alinhe a configuração em Gestão › Meta Diária › Automação (janela 6h30–15h30, intervalo mínimo 1 min, máximo 8 min).

Não mudam: a cota de 10 novos por dia, a carteira de 50, a pontuação, o ranking e a Meta de 100%. Atenção: com o teto de 30, a automação não cobre sozinha toda a Meta de quem tem mais de 30 atividades no dia; o restante continua sendo feito à mão pelo botão manual.

## 2. Como ligar a política nova (e como desligar)

**Importante — o padrão é DESLIGADO para todos.** Nada muda para ninguém até alguém ligar a chave de um corretor.

**Passo 0 (uma vez só): aplicar a migration.** O arquivo é `supabase/migrations/20261004130000_daily_goal_policy_v2.sql` (só cria a coluna `policy_v2_enabled`, padrão "desligada"; não mexe em nenhum dado). Aplique como as outras migrations deste projeto (fluxo em `.claude/rules/database-supabase.md`). Enquanto ela não for aplicada, o sistema funciona como hoje e o botão da tela mostra um aviso claro.

**Ligar para UM corretor (piloto), pela tela:** Gestão › Meta Diária › aba **Automação** › no cartão do corretor, linha de configuração (embaixo), clique em **"Ligar política nova"** e confirme. Só o administrador geral consegue. A fila pendente do corretor é refeita uma vez com as regras novas. Para voltar: **"Voltar à política antiga"**.

**Ligar para todos:** repita o passo acima em cada corretor (não existe chave global de propósito — a ideia é ligar um por vez). Se preferir por SQL (escrita em produção: **peça confirmação do dono antes**): `update daily_goal_auto_settings set policy_v2_enabled = true where broker_id = '<id do corretor>';` — para todos, tirar o `where` (só depois de o piloto dar certo). Pela tela é mais seguro, porque também refaz a fila.

## 3. Como PAUSAR manualmente (fica na mão da gestora)

- **Um corretor:** Gestão › Meta Diária › aba **Automação** › cartão do corretor › botão **"Pausar"** (vira **"Retomar"** para voltar). Pausar para os envios automáticos desse corretor na hora (Meta Diária e fila "Disparar"); a fila fica guardada. Quem pode: administrador e gestora (cada gestora só os da própria equipe).
- **Desligar de vez a automação de um corretor:** mesmo cartão, botão **"Desativar"** (e **"Ativar"** para voltar).
- **Todos de uma vez:** não existe um botão único. É preciso **Pausar** corretor por corretor (a lista fica na mesma aba). Isso é intencional por enquanto.
- O sistema também pausa sozinho um corretor após **3 erros seguidos de envio** (já era assim). O alerta de entrega descrito abaixo **não pausa nada**.

## 4. Alerta de taxa de entrega (monitor)

**[REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-04]** Roda sozinho (a cada hora, junto do disparo), **sempre ligado**, não depende da política nova.

- Mede, por corretor e por dia, a **% de mensagens da Meta Diária automática que o WhatsApp confirmou** (pelo menos 1 tique). Só conta mensagens enviadas **entre 1 e 24 horas atrás** e **somente da automação** (não o manual, não a fila "Disparar").
- Só avalia com **pelo menos 20 mensagens**. Ignora domingo, mensagens fora de 6h30–15h30 e corretor com WhatsApp desconectado (também ignora o que foi enviado antes da última queda).
- Se a taxa ficar **abaixo de 60%** (limite provisório), a **Caroline Mayumi** (gestora) recebe **um e-mail** dizendo qual corretor, qual dia, quantos %, quantas mensagens foram avaliadas. No máximo **1 e-mail por corretor por dia** e **5 por execução**; só olha hoje e ontem.
- **O que o alerta significa:** muitas mensagens sem confirmação. Pode ser bloqueio ou restrição do número.
- **O que ele NÃO significa:** não prova bloqueio. Celular desligado/sem internet e recibo atrasado (podem levar horas) parecem bloqueio. **Nada é pausado automaticamente.** A decisão de pausar é da gestora.
- Limites: só conhece a **última** queda de cada WhatsApp (não o histórico completo); o 1 tique já conta como confirmado; o limite de 60% e a amostra de 20 podem ser ajustados sem mudar código (registro `daily_goal_delivery_monitor` em `crm_settings`: `thresholdPercent`, `minSample`, `maxAlertsPerRun`). O estado da última avaliação fica em `crm_settings` (`daily_goal_delivery_monitor_state`) e a marca "já avisado hoje" em `delivery_alert:<dia>:<corretor>`. Sem migration.
- Se o envio de e-mail não estiver configurado (Resend), o alerta **não é perdido**: é tentado de novo na próxima hora.
- Recomenda-se acompanhar **2 a 4 semanas** de dados antes de qualquer decisão sobre pausa automática.

## 5. O que NÃO foi feito (de propósito)

- Pausa automática por taxa de entrega.
- Verificação de denúncia.
- Bloqueio da API do WhatsApp.
- Botão único "pausar todos".

## 6. Onde está no código (para o desenvolvedor)

Regras puras e testadas: `lib/daily-goal-policy-core.mjs` (política), `lib/daily-goal-policy-messages.mjs` (modelos), `lib/daily-goal-delivery-monitor-core.mjs` (monitor). Ligação com o banco: `lib/daily-goal-auto.js` e `lib/daily-goal-delivery-monitor.js`. Testes: `tests/daily-goal-policy-v2.test.mjs`, `tests/daily-goal-delivery-monitor.test.mjs`.
