---
paths:
  - "lib/whatsapp-*"
  - "lib/meta-*"
  - "lib/document-analysis.js"
  - "lib/ai-usage.js"
  - "lib/google-contacts*"
  - "lib/secrets-crypto.js"
  - "lib/media-storage.js"
  - "lib/captacao-notifications.js"
  - "lib/site-url.mjs"
  - "components/Whatsapp*.jsx"
  - "components/WhatsApp*.jsx"
  - "components/GoogleContactsStatus.jsx"
  - "components/flows/**"
  - "components/simulation-form/**"
  - "app/admin/chat/**"
  - "app/admin/whatsapp-master/**"
  - "app/api/webhooks/**"
  - "app/api/cron/**"
  - "app/api/whatsapp-*/**"
  - "app/api/admin/whatsapp-*/**"
  - "app/api/admin/meta-ads/**"
  - "app/api/google-contacts/**"
  - "app/api/analyze/**"
  - "whatsapp-individual-service/**"
  - ".env.example"
---

# Integrações externas

## WhatsApp (três canais distintos, não confundir)

- **WhatsApp Master** (`lib/whatsapp-master.js`, tabela `whatsapp_master_events`): integração de mensageria em geral via WhatsApp Cloud API (Meta Graph API) — recebe webhook (`app/api/webhooks/whatsapp-master`, valida `x-hub-signature-256` via HMAC contra `WHATSAPP_APP_SECRET`, rejeita 401 sem assinatura válida e falha fechado se o secret não estiver configurado), sincroniza status de mensagens de campanhas de Disparo pelo mesmo webhook (correlaciona por `whatsapp_message_id`).
- **WhatsApp Disparo/Broadcast** (`lib/whatsapp-broadcasts.js`, tabelas `whatsapp_broadcasts`/`whatsapp_broadcast_messages`/`whatsapp_templates`): campanhas de envio em massa usando templates aprovados pela Meta. Disparo efetivo roda via `/api/cron/whatsapp-broadcast-dispatch`.

Variáveis: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_DISPLAY_PHONE_NUMBER`, `WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_REMINDER_TEMPLATE_NAME`/`_LANGUAGE`.

**[REGRA OFICIAL DE NEGÓCIO — definida pelo dono em 2026-09-24, roteamento por corretor ajustado em 2026-09-28] Botão "Receber minha simulação".** Na tela final do formulário (`components/simulation-form/SimulationSuccess.jsx` → `ReceiveSimulationWhatsappButton.jsx`) o cliente toca num botão que abre o WhatsApp com a mensagem pronta "Olá, preenchi meu cadastro. Gostaria de receber a minha simulação." Quando o cliente escreve primeiro, a janela de 24h abre e quem recebe responde sem template. NÃO envia valores da simulação automaticamente — quem envia o PDF é o corretor, pelo Chat, dentro da janela de 24h (o Chat mostra aviso âmbar quando faltam menos de 2h). Sem código do cadastro na mensagem (decisão do dono): o vínculo é pelo telefone. Cliente que não toca no botão segue como antes (corretor chama pelo WhatsApp pessoal). A regra de redistribuição por falta de contato só vale para leads da roleta (`distribution_type = round_robin`), nunca para link pessoal de corretor. As respostas automáticas por palavra-chave (`whatsapp_automation_replies`) casam por PALAVRA inteira ("sim" não casa com "simulação").

**[REGRA OFICIAL DE NEGÓCIO — definida pelo dono em 2026-09-28] Para qual WhatsApp o botão abre.** `/api/whatsapp-contact` (chamado por `ReceiveSimulationWhatsappButton.jsx`, que recebe `brokerRef` de `SimulationForm.jsx`, o mesmo `?ref=` da URL do formulário) devolve o WhatsApp PESSOAL do corretor dono do link — link da Bruna abre o WhatsApp da Bruna, sem `?ref=` (link padrão do site) abre o do Matheus (`DEFAULT_SIMULATION_BROKER_REF = "matheus"`, o mesmo default usado em `resolveResponsibleUserIdFromPayload` para gravar o responsável do cadastro). Corretor precisa estar ativo e ter telefone cadastrado (`admin_users.phone`) — sem isso, ou link de equipe/roleta (`?ref=equipe`, sorteia um corretor diferente a cada envio, impossível saber de antemão), cai no número oficial (`WHATSAPP_DISPLAY_PHONE_NUMBER`) como antes. O fluxo "Formulário concluído (Receber minha simulação)" (Fluxos, editável na tela; modelo em `components/flows/flow-templates.js`) roda só quando o cliente escreve para o número OFICIAL — casa a frase, encaminha ao responsável do cadastro (`roulette` action), marca a tag "Simulação pelo WhatsApp" e responde com o prazo. Quando o botão abre o WhatsApp pessoal do corretor, a mensagem cai direto na conversa pessoal dele (fora do Chat/número oficial), sem passar por esse Fluxo.

**[REGRA OFICIAL DE NEGÓCIO — definida pelo dono em 2026-09-24] Tratamento de quem atende nas mensagens do WhatsApp.** O cadastro do usuário (`admin_users`) tem `gender` (male/female) e `has_creci`. Com CRECI: "corretor/corretora". Sem CRECI: SEMPRE "associado/associada do corretor Matheus Machado", qualquer que seja a categoria (corretor, gestor, associado) — a categoria de acesso não define o tratamento. `lib/broker-gender.js` (`buildBrokerGenderVars`) gera as variáveis dos Fluxos: \`{{cargo_corretor}}\`, \`{{nosso_cargo}}\`, \`{{o_a}}\`, \`{{ele_ela}}\`; sem gênero informado usa "(a)". O administrador principal já entra com CRECI marcado; os demais precisam ser marcados na tela de Usuários. Mensagens de Fluxo escritas com "associado (a)" à mão não mudam sozinhas — trocar pela variável.

Clique de "abrir WhatsApp" na UI (deep link `wa.me/...`) sempre chama uma API pra registrar o contato ANTES de abrir o link — isso registra uma ação do usuário no sistema (para pontuação/histórico), **não comprova que a mensagem foi de fato enviada ou lida**. Não trate esse registro como confirmação de entrega em nenhuma lógica nova.

- **WhatsApp individual** (`lib/whatsapp-individual*.js`/`.mjs`, tabela `whatsapp_individual_sessions`, microsserviço `whatsapp-individual-service/` hospedado no **Railway**, não na Vercel): sessão pessoal de cada corretor via Baileys (QR Code ou código numérico). Criado porque **o número oficial da API foi banido pela Meta em 28/09/2026** (`whatsapp-individual-service/README.md`). O Next.js nunca fala com o WhatsApp direto: chama o microsserviço por HTTP e recebe eventos em `app/api/webhooks/whatsapp-individual`; os dois lados se autenticam pelo header `X-Service-Secret` (`WHATSAPP_INDIVIDUAL_SERVICE_SECRET`, `WHATSAPP_INDIVIDUAL_SERVICE_URL`). O microsserviço não tem a service role do Supabase. Canal de envio do Chat decidido por `pickSendChannel` (`lib/whatsapp-individual-routing.mjs`): sessão do responsável conectada → individual; configurada mas caída → **bloqueia** (nunca cai em silêncio para o número oficial banido); sem sessão/sem responsável → caminho antigo (Cloud API). Usado também pela automação da Meta Diária (`.claude/rules/meta-diaria-ranking.md`).

**Contexto operacional:** a migração de WABA de 2026-09-21 foi superada pelo banimento do número oficial em 28/09 (texto antigo em `docs/HISTORICO_REGRAS.md`). Antes de assumir que Disparo/Fluxos/Chat pela Cloud API estão operacionais, confirme o estado atual de `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_BUSINESS_ACCOUNT_ID` com o dono.

## Anthropic (análise de documentos)

`lib/document-analysis.js` chama `https://api.anthropic.com/v1/messages` via `fetch` direto (**sem SDK** — não há `@anthropic-ai/sdk` nas dependências; se for adicionar uma chamada nova à API da Anthropic, siga o mesmo padrão de fetch direto usado aqui, ou avalie deliberadamente se vale a pena adicionar o SDK como dependência nova). Variáveis: `ANTHROPIC_API_KEY`, `ANTHROPIC_DOCUMENT_MODEL` (default `claude-sonnet-5`). Uso registrado em `ai_usage_log` via `lib/ai-usage.js` — ver `.claude/rules/documentacao-cca.md`.

`OPENAI_API_KEY`/`OPENAI_MODEL` também existem (usado em `/api/analyze`, extração heurística de dados de texto/URL — opcional, sem chave cai num fallback heurístico sem IA).

## E-mail (Resend)

`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SIMULATION_NOTIFICATION_EMAIL`, `CAPTACAO_NOTIFICATION_EMAIL`. Notificações por e-mail de novo cadastro/captação.

## Cron (pg_cron no Supabase, não o cron nativo da Vercel)

Rotas em `app/api/cron/*` (11 em 2026-10-01): `daily-goal-close`, `daily-report`, `scheduled-activities`, `whatsapp-broadcast-dispatch`, `whatsapp-flows`, `whatsapp-meta-diaria-dispatch` (automação da Meta Diária, a cada 2 min), `meta-ads-intraday-sync`, `meta-ads-daily-consolidation`, `whatsapp-templates-sync`, `weekly-ranking`, `celebrations-ranking`. Tabela de jobs e horários: `docs/DATABASE.md` §5. Todas exigem `Authorization: Bearer <token>` comparado com `timingSafeEqual` contra `CRON_SECRET`/`SUPABASE_CRON_TOKEN_HASH` — **falha fechado se a variável não estiver configurada** (nunca aceita chamada sem segredo configurado).

**O agendamento real não é o cron da Vercel** (`vercel.json`) — é o `pg_cron` do próprio banco (Supabase), com jobs em `cron.job` chamando `net.http_get` contra `https://imoveis-mvp.vercel.app/api/cron/<rota>` (domínio técnico da Vercel, não o domínio da marca — ver `lib/site-url.mjs`; isso é só a URL alvo da chamada do servidor, nunca aparece pra o cliente) com o token vindo de `vault.decrypted_secrets` (`crm_automation_cron_token`). Para inspecionar/alterar o agendamento, use `execute_sql` no projeto Supabase (`select * from cron.job`), não o painel da Vercel.

**[REGRA — ajustada em 2026-09-28]** `crm-automations-every-minute` (`scheduled-activities`), `whatsapp-broadcast-dispatch-every-minute` e `whatsapp-flows-timers-every-minute` rodavam a cada 1 minuto; passaram para **a cada 2 minutos** (`cron.alter_job(id, schedule => '*/2 * * * *')`) — essas três, somadas ao registro de cada execução em `cron.job_run_details`, respondiam por quase 30% do tempo total gasto pelo banco (medido via `pg_stat_statements`). Efeito prático (aceito pelo dono): um passo de espera de Fluxo, a regra "REDISTRIBUIÇÃO DE LEADS" (`.claude/rules/roleta-prospeccao-campanhas.md`) e o reforço de segurança do cadastro automático do WhatsApp podem demorar até 1 minuto a mais no pior caso. **O Chat (WhatsApp) em tempo real não é afetado** — mensagem chegando/saindo e a tela se atualizando sozinha dependem do webhook (`app/api/webhooks/whatsapp-master`) e do canal Supabase Realtime, não deste cron. `daily-report`/`daily-goal-close`/`meta-ads-*`/`whatsapp-templates-sync`/`limpar-historico-cron-diario` continuam com sua frequência original (diária/algumas vezes ao dia), não foram tocados.

## Google Contacts

`lib/google-contacts.js` (+ `google-contacts-config*.js`/`.mjs`, OAuth por corretor, tokens cifrados com `lib/secrets-crypto.js`): salva o cliente na agenda do Google do corretor antes do envio automático da Meta Diária. Best-effort e isolado do WhatsApp individual — erro aqui nunca derruba a sessão nem o envio.

## Push

Ver `.claude/rules/automacoes-notificacoes.md` (Web Push nativo com VAPID, sem serviço terceiro).

## Storage

Supabase Storage para mídia (`SUPABASE_STORAGE_BUCKET`, `SUPABASE_TESTIMONIALS_BUCKET`). Alguns campos históricos antigos ainda guardam URL/dado de mídia embutido diretamente na tabela em vez de referência ao Storage — não assuma que toda mídia do sistema segue o padrão novo.

## Regra geral pra qualquer integração nova

Documente a variável de ambiente nova em `.env.example` (sem valor). Nunca hardcode um token/segredo no código. Existência de código de integração não comprova credencial ativa em produção neste momento — ao investigar um problema de integração, confirme se a variável está de fato configurada no ambiente antes de assumir que é um bug de código.

**[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO — corrigido em 2026-09-27] Link de simulação nunca usa `?ref=` de corretor inativo.** O formulário público só aceita `?ref=` de corretor com `status = active` (`resolveAdminProfileByRef`, `lib/admin-profiles.js`) — link com o ref de um corretor desligado é recusado no ENVIO, depois do cliente preencher tudo ("Este link de corretor é inválido ou está inativo."). `resolveSimulationLink` (`lib/whatsapp-chat.js`, atalho "Link de simulação" do Chat) e `buildBaseContext`/`applyBrokerAssignment` (`lib/whatsapp-flows.js`, Fluxos) checam `status === "active"` antes de usar o corretor responsável do cliente para montar o link — corretor inativo é tratado como "sem responsável" (link público genérico). Cliente real afetado antes da correção: Janaina da Silva Cruz (27/09, responsável na hora era Luana Souza, inativa) — contornado manualmente na hora mandando o link da ketlin. **Risco residual não corrigido**: clientes com `responsible_user_id` ainda apontando para um corretor inativo (ex.: os vinculados a Elias Henrique/Liyssa Cardoso/Luis Alexandre) continuam sem um corretor de verdade atendendo — reatribuir esses clientes é decisão do dono, não foi feito automaticamente.
