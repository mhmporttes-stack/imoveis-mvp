---
paths:
  - "lib/crm-automation*.js"
  - "lib/push-subscriptions.js"
  - "lib/web-push.js"
  - "lib/daily-message*"
  - "lib/client-journey.js"
  - "lib/scheduled-activity-notifications.js"
  - "lib/lead-notifications.js"
  - "lib/simulation-registration-notifications.js"
  - "lib/daily-report*.js"
  - "lib/calendar-activities.js"
  - "components/AutomationRulesManager.jsx"
  - "components/CrmNotificationsList.jsx"
  - "components/DailyMessage*.jsx"
  - "components/AdminPushSubscription.jsx"
  - "app/admin/automacoes/**"
  - "app/admin/notificacoes/**"
  - "app/api/crm-*/**"
  - "app/api/push/**"
  - "app/api/daily-message/**"
  - "app/api/cron/scheduled-activities/**"
  - "app/api/cron/daily-report/**"
  - "public/sw.js"
  - "lib/supervision-messages*"
  - "components/supervision/**"
  - "app/api/admin/supervision-messages/**"
  - "components/alerts/**"
  - "components/DeferredPanelGates.jsx"
  - "components/panel-gates-by-app.mjs"
  - "components/HideInFinanceiroApp.jsx"
  - "app/chat-app/**"
---

# Automações, notificações, push e mensagem diária

## Motor de automações (`lib/crm-automations.js`)

Regras configuráveis (`crm_automation_rules`) com gatilho + atraso + condições + ações, avaliadas contra clientes candidatos. Peças-chave ao mexer aqui:

- `triggerMatches(rule, client)` decide se um cliente "casa" com o gatilho — **todo gatilho novo precisa de um `if` explícito aqui**; sem isso, cai no `return true` final e casa com qualquer cliente (já foi um bug real com `time_without_contact`, ver `.claude/rules/roleta-prospeccao-campanhas.md`).
- `triggerAnchor(rule, client)` decide a partir de qual data/hora contar o atraso configurado.
- `conditionsMatch(conditions, client)` — condições adicionais (`status_equals`, `responsible_equals`, `has_future_activity`, `not_archived`, `last_contact_older_than`).
- `isRuleDue(rule, anchor)` compara `Date.now()` contra `anchor + delay` (ou `anchor - delay` se `timingMode === "before_activity"`).
- `OUTREACH_TRIGGER_TYPES`/`OUTREACH_NEGATIVE_STATUSES` — trava contra notificar cliente arquivado/não-contactar/restrição/reprovado para gatilhos de "precisa de contato". Gatilhos que reagem a uma MUDANÇA de status específica (`status_changed`, `stage_changed`, `simulation_sent`) ficam de fora de propósito — nesses casos o novo status sendo "negativo" é exatamente o evento que a regra quer capturar.

`runCrmAutomations` roda dentro de `/api/cron/scheduled-activities` (protegido por bearer token `CRON_SECRET`/hash no Supabase, ver `.claude/rules/integracoes-externas.md`), que também processa notificações agendadas. Ações de automação (push, WhatsApp, e-mail) para múltiplos destinatários devem ser paralelizadas (`Promise.all`) quando o destino permitir — já houve N+1 sequencial real nesse arquivo, corrigido para os casos encontrados; ao adicionar uma ação nova com loop de destinatários, não reintroduza o padrão sequencial.

`classifyClientOrigin(client)` categoriza a origem do cliente (`"form"`, `"manual"`, etc.) — reaproveite essa função em vez de reimplementar a lógica de "de onde veio esse cliente".

## Notificações (`crm_notifications`)

Notificação genérica no CRM — sempre resolvida pela hierarquia real de quem gerencia quem (responsável + gestor dele + admins), **nunca hardcode uma pessoa específica por nome**. Ponto único de criação deve reutilizar o padrão existente (dedupe: no máximo 1 notificação por destinatário por chamada) em vez de inserir direto na tabela em cada lugar novo.

## Push (`lib/push-subscriptions.js`, `lib/web-push.js`)

Web Push nativo (VAPID), sem biblioteca externa de push — `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Assinatura por `endpoint` (upsert), tabela `push_subscriptions`.

## Mensagem diária (`lib/daily-message.js`, `lib/daily-message-cycle.js`)

Card motivacional/devocional mostrado aos corretores uma vez por dia — **não confundir com Meta Diária** (são sistemas completamente diferentes apesar do nome parecido: um é gamificação de prospecção, o outro é conteúdo). Janela de tolerância de 20h antes de gerar uma nova linha automática, para não duplicar o envio do dia se o horário configurado mudar no meio do dia (`RECENT_AUTO_GUARD_MS`). Testes dedicados: `tests/daily-message-cycle.test.mjs`.

## Log de histórico de cliente

`logClientJourneyEvent`/`logClientJourneyEvents` (`lib/client-journey.js`) é o **ponto único de escrita** na timeline do cliente (`client_journey_events`) para qualquer ação nova do CRM que deve aparecer no histórico — nunca um INSERT direto espalhado pelo código. Use a versão em lote (`logClientJourneyEvents`) quando registrar mais de um evento na mesma ação, em vez de um loop chamando a versão singular (N+1 real já corrigido em `lib/client-tags.js`).

## Mensagens internas de supervisão (gestor ↔ corretor)

**[REGRA OFICIAL DE NEGÓCIO — definida pelo dono em 2026-10-01] Mensagem da supervisão.** Gestor/admin abre um mini-chat pelo ícone de chat no card do corretor (Supervisão › Meta Diária) e envia mensagens ao corretor. No corretor, a mensagem aparece como **balão central** que **só sai com "OK" ou com uma resposta** — sem X, sem fechar clicando fora, ESC não descarta. OK envia "OK" ao gestor e marca a mensagem como confirmada; resposta com texto chega ao gestor em tempo real e marca como respondida. Pendente persiste no banco (volta depois de recarregar/relogar); várias pendentes aparecem **uma por vez** ("1 de 3"), nunca empilhadas. Resposta com a conversa fechada vira badge no ícone do card. Corretor só vê as próprias; gestor só a própria equipe; admin geral qualquer usuário. **Não é** o Chat de clientes/WhatsApp nem a "mensagem interna" de uma conversa do Chat. Implementação: `lib/supervision-messages.js` (+ `lib/supervision-messages-core.mjs`, testado), `components/supervision/**`, `/api/admin/supervision-messages/**`, tabela `supervision_messages`. Detalhes: `docs/BUSINESS_RULES.md` AUT-8.

**[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO — PENDENTE DE VALIDAÇÃO]** Durante "Alterar conta" o balão não aparece e a API recusa responder: o admin real não confirma/responde em nome do corretor (responder é falar pelo corretor com a supervisão, diferente das ações operacionais da regra de `auth-permissoes.md`). Hoje o ícone de entrada só existe na visão do dono (`TeamDailyPerformance`); a API já aceita gestor sobre a própria equipe.

## Central de Alertas (Informativo / Importante) — 2026-10-02

**[REGRA OFICIAL DE NEGÓCIO — definida pelo dono em 2026-10-02]** Só dois tipos de alerta na tela. **Informativo**: flutua pela lateral por ~5 s e some, não bloqueia, fila sem sobrepor. **Importante**: bloqueia o CRM até "Entendi", registrando destinatário, alerta, quando apareceu e quando confirmou. Mesmo comportamento em celular, app de computador e navegador. **[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO]**
- Tabelas `crm_alert_definitions` (o quê: mensagem, tipo, público, gatilho, período, repetição — base do futuro construtor) e `crm_alert_deliveries` (cada entrega; `UNIQUE(recipient_id, dedupe_key)`, então o mesmo evento nunca vira dois alertas). Migration `20261002340000`.
- Servidor: `lib/crm-alerts.js` (núcleo puro `lib/crm-alerts-core.mjs`, testes `tests/crm-alerts-core.test.mjs`). Rotas `/api/admin/alerts` (pendentes do próprio usuário), `…/shown`, `…/[id]/ack`, `…/test` e `…/definitions` (admin geral).
- Tela: `components/alerts/AlertCenterGate.jsx` no layout, fora de "Alterar conta", como a Supervisão. Realtime por usuário com consulta de segurança a cada 60 s. O Importante é um `<dialog>` nativo, fica acima de gavetas e espera Supervisão/Reconhecimento/Mensagem do dia; a Supervisão espera ele.
- **Não crie outro sistema de alerta na tela:** novo alerta = linha em `crm_alert_definitions` + `createAlertDeliveries`. Supervisão, Celebração, Mensagem do dia e `crm_notifications` continuam como estão.
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] Bloqueios também no app "Chat" da tela inicial.** O alerta **Importante** da Central (bloqueia o CRM) e a janela obrigatória do motivo do cliente esfriado (FUN-15, só sai com motivo) aparecem e bloqueiam também dentro do app "Chat" (iPhone etc.). App "Financeiro" continua sem avisos; no app Chat, Mensagem do dia, Celebração, Supervisão e o **Informativo** continuam escondidos; "Alterar conta" como sempre (sem Central). Regra única `gatesForApp` (`components/panel-gates-by-app.mjs`), usada por `DeferredPanelGates` (fora do `HideInFinanceiroApp` no `app/admin/layout.jsx`; montado também em `app/chat-app/page.jsx`); `AlertCenterGate` com `importantOnly`. Testes `tests/panel-gates-by-app.test.mjs`. Detalhe: `docs/BUSINESS_RULES.md` AL-APP.
- **[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO — 2026-10-04]** `whatsapp_session_attention` (Importante): sessão individual do WhatsApp que exige intervenção humana (`needs_attention`, `retry_limit`, `qr_expired` de conta já usada) → gestora responsável + admins gerais, com idempotência por ocorrência e encerramento automático ao reconectar. Detalhe e tabela de estados: `docs/WHATSAPP.md` §1-B. Alerta com `context.link` interno (`alertLink`) ganha botão de abrir na Central.
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-10]** Alertas do WhatsApp individual: `whatsapp_connection_self` (Importante só ao corretor dono do número que caiu; alerta da Central com push, via `push_kind = whatsapp_connection` no contexto — `createAlertDeliveries` só aceita os tipos de `ALERT_PUSH_KINDS`, `lib/notification-policy-core.mjs`) e `whatsapp_service_stalled` (Importante aos admins gerais quando o serviço do WhatsApp para de renovar o lease > 5 min, no cron `whatsapp-flows`). Ambos funcionam sem a linha da definição (texto padrão, ligados); definição desligada = desligado. Ver `integracoes-externas.md` e `docs/BUSINESS_RULES.md` WA-20/WA-22.
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-18]** Exceção à política de notificações (AUT-9): conversa do WhatsApp oficial atribuída ao corretor pelo código do atendimento (PRES-25) gera UM aviso no sino + push por atribuição (tipo `official_chat_assigned`, `lib/whatsapp-contact-code.js`); nenhuma outra mensagem de Chat notifica. Detalhe: `docs/BUSINESS_RULES.md` AUT-9c.
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16] Cliente que esfriou (FUN-15).** Usa o Importante da Central para o motivo do corretor (`context.type = cooled_client`, chave `cooled_client:<caso>:<rodada>`): a janela traz campo de texto e só sai com o motivo gravado (`POST /api/admin/cooled-clients/[id]/reason`, que dá a ciência); `acknowledgeAlert` recusa "Entendi" nessas chaves (409) e elas não expiram em 7 dias. A decisão da gestora é uma caixinha no cabeçalho (`components/cooled/CooledClientsInbox.jsx`), não uma janela bloqueante. Ver `.claude/rules/crm-clientes-funil.md`.
- "Cliente aguardando resposta" (`reply_waiting`): o detector é o mesmo do aviso falado da Alexa (`lib/alexa-reply-alert.js`). A mesma espera vira Importante para o corretor, com chave conversa + início da espera. **Nasce desligado** e o dono liga em Automações › Alertas. Por ora herda o horário e o liga/desliga da Alexa.

- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-02] Alerta/mensagem direcionada é PRIVADA.** Alerta, notificação ou mensagem endereçada a um usuário (Central de Alertas, Supervisão, `crm_notifications`, push) é visível SOMENTE ao destinatário definido — outros corretores, gestores e o admin geral NÃO recebem por estarem online, serem da equipe ou terem acesso ao CRM. Audiência explícita no modelo: `user` (só os ids, nunca expande por hierarquia) | `team` (gestor + corretores dele + associados, só quando for a finalidade) | `global`/`role`. Backend: toda consulta filtra por destinatário (`.eq` + `onlyOwnRows`/`onlyRecipientRows` em `lib/crm-alerts-core.mjs`/`supervision-messages-core.mjs`); `listCrmNotifications/count/markRead` filtram pelo próprio usuário também para admin geral (auditoria de terceiros só por rota própria explícita, nunca como alerta). Push: o endpoint do navegador pertence a quem está logado — `AdminPushSubscription` reassocia a cada carga e o logout desassocia (aparelho compartilhado). Testes: `tests/private-alerts.test.mjs`.
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-22]** Extensão do Marketplace sem sinal (MKT-2g): o Importante "sem sinal" aos admins gerais vai também por push (1 por episódio, `push_kind = marketplace_extension_silent`); o aviso de volta fica só no sino. Push da Central = só `ALERT_PUSH_KINDS` (`alertPushKind`); tipo novo só com decisão do dono. Detalhe: `docs/BUSINESS_RULES.md` MKT-2g/AUT-9.

## Avisos fixos x tela cheia do Henry

**[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-23]** "As notificações que ficam fixas no meio da tela NÃO podem aparecer enquanto a tela cheia do Henry estiver aberta" (navegador e app de desktop). Elas não se perdem: esperam na fila de cada gate e aparecem quando a cena fecha, como apareceriam normalmente; aviso lido pelo Henry ("Henry, leia os avisos") continua marcado como lido e não volta. Quando disparam, para quem e contagem não mudam. Sinal ÚNICO: `lib/henry-fullscreen-signal.mjs` (emitido só por `HenryVoiceAssistant` via `expanded`), lido pelo hook `useHenryFullscreen` (`components/henry/useHenryFullscreen.js`) — aviso fixo novo consulta esse hook; não crie outra checagem por DOM/aria. Cobertos hoje: `AlertCenterGate` (Importante), `SupervisionMessageGate`, `DailyMessageGate`, `BrokerCelebrationGate`, `PwaLifecycle`, `AdminPwaInstallHint`, `AdminPushSubscription`. Fora: Informativos/toasts de canto, notificações do sistema e a caixa nativa de atualização do app de desktop. Trava: `tests/henry-fullscreen-signal.test.mjs`.
