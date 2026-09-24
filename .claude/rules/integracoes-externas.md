# Integrações externas

## WhatsApp (dois sistemas distintos, não confundir)

- **WhatsApp Master** (`lib/whatsapp-master.js`, tabela `whatsapp_master_events`): integração de mensageria em geral via WhatsApp Cloud API (Meta Graph API) — recebe webhook (`app/api/webhooks/whatsapp-master`, valida `x-hub-signature-256` via HMAC contra `WHATSAPP_APP_SECRET`, rejeita 401 sem assinatura válida e falha fechado se o secret não estiver configurado), sincroniza status de mensagens de campanhas de Disparo pelo mesmo webhook (correlaciona por `whatsapp_message_id`).
- **WhatsApp Disparo/Broadcast** (`lib/whatsapp-broadcasts.js`, tabelas `whatsapp_broadcasts`/`whatsapp_broadcast_messages`/`whatsapp_templates`): campanhas de envio em massa usando templates aprovados pela Meta. Disparo efetivo roda via `/api/cron/whatsapp-broadcast-dispatch`.

Variáveis: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_DISPLAY_PHONE_NUMBER`, `WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_REMINDER_TEMPLATE_NAME`/`_LANGUAGE`.

**[REGRA OFICIAL DE NEGÓCIO — definida pelo dono em 2026-09-24] Botão "Receber minha simulação".** Na tela final do formulário (`components/simulation-form/SimulationSuccess.jsx` → `ReceiveSimulationWhatsappButton.jsx`) o cliente toca num botão que abre o WhatsApp oficial (número de `WHATSAPP_DISPLAY_PHONE_NUMBER`, lido por `/api/whatsapp-contact`) com a mensagem pronta "Olá, preenchi meu cadastro. Gostaria de receber a minha simulação." Quando o cliente escreve primeiro, a janela de 24h abre e o CRM responde sem template. O fluxo "Formulário concluído (Receber minha simulação)" (Fluxos, editável na tela; modelo em `components/flows/flow-templates.js`) casa a frase, encaminha a conversa ao responsável do cadastro (`roulette` action: corretor do link pessoal, ou o da roleta; sem cadastro cria pela roleta), marca a tag "Simulação pelo WhatsApp" e responde com o prazo (dentro/fora do horário comercial). NÃO envia valores da simulação automaticamente — quem envia o PDF é o corretor, pelo Chat, dentro da janela de 24h (o Chat mostra aviso âmbar quando faltam menos de 2h). Sem código do cadastro na mensagem (decisão do dono): o vínculo é pelo telefone. Cliente que não toca no botão segue como antes (corretor chama pelo WhatsApp pessoal). A regra de redistribuição por falta de contato só vale para leads da roleta (`distribution_type = round_robin`), nunca para link pessoal de corretor. As respostas automáticas por palavra-chave (`whatsapp_automation_replies`) casam por PALAVRA inteira ("sim" não casa com "simulação").

**[REGRA OFICIAL DE NEGÓCIO — definida pelo dono em 2026-09-24] Tratamento de quem atende nas mensagens do WhatsApp.** O cadastro do usuário (`admin_users`) tem `gender` (male/female) e `has_creci`. Com CRECI: "corretor/corretora". Sem CRECI: SEMPRE "associado/associada do corretor Matheus Machado", qualquer que seja a categoria (corretor, gestor, associado) — a categoria de acesso não define o tratamento. `lib/broker-gender.js` (`buildBrokerGenderVars`) gera as variáveis dos Fluxos: \`{{cargo_corretor}}\`, \`{{nosso_cargo}}\`, \`{{o_a}}\`, \`{{ele_ela}}\`; sem gênero informado usa "(a)". O administrador principal já entra com CRECI marcado; os demais precisam ser marcados na tela de Usuários. Mensagens de Fluxo escritas com "associado (a)" à mão não mudam sozinhas — trocar pela variável.

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
