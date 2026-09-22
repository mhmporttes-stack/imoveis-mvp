# Integrações externas

## WhatsApp (dois sistemas distintos, não confundir)

- **WhatsApp Master** (`lib/whatsapp-master.js`, tabela `whatsapp_master_events`): integração de mensageria em geral via WhatsApp Cloud API (Meta Graph API) — recebe webhook (`app/api/webhooks/whatsapp-master`, valida `x-hub-signature-256` via HMAC contra `WHATSAPP_APP_SECRET`, rejeita 401 sem assinatura válida e falha fechado se o secret não estiver configurado), sincroniza status de mensagens de campanhas de Disparo pelo mesmo webhook (correlaciona por `whatsapp_message_id`).
- **WhatsApp Disparo/Broadcast** (`lib/whatsapp-broadcasts.js`, tabelas `whatsapp_broadcasts`/`whatsapp_broadcast_messages`/`whatsapp_templates`): campanhas de envio em massa usando templates aprovados pela Meta. Disparo efetivo roda via `/api/cron/whatsapp-broadcast-dispatch`.

Variáveis: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_DISPLAY_PHONE_NUMBER`, `WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_REMINDER_TEMPLATE_NAME`/`_LANGUAGE`.

Clique de "abrir WhatsApp" na UI (deep link `wa.me/...`) sempre chama uma API pra registrar o contato ANTES de abrir o link — isso registra uma ação do usuário no sistema (para pontuação/histórico), **não comprova que a mensagem foi de fato enviada ou lida**. Não trate esse registro como confirmação de entrega em nenhuma lógica nova.

**Contexto operacional (2026-09-21)**: o número real de produção ficou preso numa WABA antiga com forma de pagamento bloqueada por uma linha de crédito compartilhada do ManyChat, sem via self-service de liberação. Foi criada uma WABA nova com pagamento funcionando; a migração do número (ou troca por um número novo) ainda pode estar em andamento — confirme o estado atual de `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_BUSINESS_ACCOUNT_ID` no ambiente antes de assumir que o Disparo está operacional.

## Anthropic (análise de documentos)

`lib/document-analysis.js` chama `https://api.anthropic.com/v1/messages` via `fetch` direto (**sem SDK** — não há `@anthropic-ai/sdk` nas dependências; se for adicionar uma chamada nova à API da Anthropic, siga o mesmo padrão de fetch direto usado aqui, ou avalie deliberadamente se vale a pena adicionar o SDK como dependência nova). Variáveis: `ANTHROPIC_API_KEY`, `ANTHROPIC_DOCUMENT_MODEL` (default `claude-sonnet-5`). Uso registrado em `ai_usage_log` via `lib/ai-usage.js` — ver `.claude/rules/documentacao-cca.md`.

`OPENAI_API_KEY`/`OPENAI_MODEL` também existem (usado em `/api/analyze`, extração heurística de dados de texto/URL — opcional, sem chave cai num fallback heurístico sem IA).

## E-mail (Resend)

`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SIMULATION_NOTIFICATION_EMAIL`, `CAPTACAO_NOTIFICATION_EMAIL`. Notificações por e-mail de novo cadastro/captação.

## Cron (Vercel)

Rotas em `app/api/cron/*`: `daily-goal-close`, `daily-report`, `scheduled-activities`, `whatsapp-broadcast-dispatch`. Todas exigem `Authorization: Bearer <token>` comparado com `timingSafeEqual` contra `CRON_SECRET`/`SUPABASE_CRON_TOKEN_HASH` — **falha fechado se a variável não estiver configurada** (nunca aceita chamada sem segredo configurado). Confirme se `vercel.json` (ou a config de cron do painel Vercel) realmente agenda cada rota antes de assumir que ela roda sozinha — a existência do endpoint não garante agendamento ativo.

## Push

Ver `.claude/rules/automacoes-notificacoes.md` (Web Push nativo com VAPID, sem serviço terceiro).

## Storage

Supabase Storage para mídia (`SUPABASE_STORAGE_BUCKET`, `SUPABASE_TESTIMONIALS_BUCKET`). Alguns campos históricos antigos ainda guardam URL/dado de mídia embutido diretamente na tabela em vez de referência ao Storage — não assuma que toda mídia do sistema segue o padrão novo.

## Regra geral pra qualquer integração nova

Documente a variável de ambiente nova em `.env.example` (sem valor). Nunca hardcode um token/segredo no código. Existência de código de integração não comprova credencial ativa em produção neste momento — ao investigar um problema de integração, confirme se a variável está de fato configurada no ambiente antes de assumir que é um bug de código.
