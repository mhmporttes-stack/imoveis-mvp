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

## Mensagem diária (`lib/daily-message.js`, `lib/daily-message-cycle.mjs`)

Card motivacional/devocional mostrado aos corretores uma vez por dia — **não confundir com Meta Diária** (são sistemas completamente diferentes apesar do nome parecido: um é gamificação de prospecção, o outro é conteúdo). Janela de tolerância de 20h antes de gerar uma nova linha automática, para não duplicar o envio do dia se o horário configurado mudar no meio do dia (`RECENT_AUTO_GUARD_MS`). Testes dedicados: `tests/daily-message-cycle.test.mjs`.

## Log de histórico de cliente

`logClientJourneyEvent`/`logClientJourneyEvents` (`lib/client-journey.js`) é o **ponto único de escrita** na timeline do cliente (`client_journey_events`) para qualquer ação nova do CRM que deve aparecer no histórico — nunca um INSERT direto espalhado pelo código. Use a versão em lote (`logClientJourneyEvents`) quando registrar mais de um evento na mesma ação, em vez de um loop chamando a versão singular (N+1 real já corrigido em `lib/client-tags.js`).
