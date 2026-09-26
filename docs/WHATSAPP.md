# WHATSAPP — arquitetura, regras e riscos

> Fonte: `lib/whatsapp-*.js`/`.mjs`, `lib/phone-utils.js`, `lib/client-phone-lookup.js`, `app/api/webhooks/whatsapp-master`, `app/api/admin/whatsapp-*`, `app/api/cron/whatsapp-*`, migrations `20260901…`, `20260915_whatsapp_manual_log`, `20260920…`, `20260922180000`, `20260923210000`, `20260924*` (inclui `20260924210000`: Chat interno, exclusão e lead patrocinado) (verificado em 2026-09-24, commit `3c82f72`).
> **Nunca** registrar tokens, segredos ou valores de variáveis aqui — só nomes. Estado real da conta Meta (WABA, número ativo, modelos aprovados) **não foi verificado** → **A CONFIRMAR**.
> Regras gerais: [`BUSINESS_RULES.md`](BUSINESS_RULES.md) §11 · Banco: [`DATABASE.md`](DATABASE.md) · Permissões: [`PERMISSIONS.md`](PERMISSIONS.md) · Manual: [`../AGENTS.md`](../AGENTS.md). Meta Ads/Pixel: [`TRAFEGO_META.md`](TRAFEGO_META.md).

## 1. Visão geral

Um **único número oficial** na **WhatsApp Cloud API (Graph API)**. Tudo o que entra e sai passa por:

```
Meta ──webhook──▶ /api/webhooks/whatsapp-master ──▶ processWhatsappWebhook (lib/whatsapp-master.js)
                     │ 1) whatsapp_master_events  (bruto, idempotente por event_key)
                     │ 2) projectChatFromEvents   → whatsapp_conversations / whatsapp_messages (Chat)
                     │ 3) processSponsoredLeads   → lead de anúncio (Click to WhatsApp) novo entra na roleta (§9-B)
                     │ 3b) downloadInboundAudios  → áudio recebido baixado e guardado em storage privado (§6)
                     │ 4) processFlowInbound      → Fluxos (prioridade)   ─┐ se um fluxo tratou, pára
                     │ 5) processAutomationReply  → respostas por palavra-chave ◀┘
                     └ 6) syncBroadcastMessageStatuses → status do Disparo (sent/delivered/read/failed)

CRM ──▶ sendWhatsappTextMessage / sendWhatsappMessagePayload / sendWhatsappTemplateMessage ──▶ Graph API
        (Chat, Fluxos, respostas, Disparo, lembretes de atividade, ação de automação "WhatsApp modelo")
```

Módulos de tela: **Chat** (`/admin/chat`) e, em Automações, **Regras de resposta**, **Fluxos**, **Disparo**, **WhatsApp Master** (configuração/perfil/inbox de eventos) e **WhatsApp Manual**.

## 2. Configuração (nomes de variáveis — nunca valores)

`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_DISPLAY_PHONE_NUMBER` (número público do botão “Receber minha simulação”), `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_GRAPH_API_VERSION` (padrão do código `v23.0`), `WHATSAPP_REMINDER_TEMPLATE_NAME`/`_LANGUAGE`, `WHATSAPP_APP_ID`/`META_APP_ID` (upload da foto de perfil — Resumable Upload), `APP_SECRET` (alias/fallback de `WHATSAPP_APP_SECRET` na validação da assinatura do webhook — `getAppSecret()` em `lib/whatsapp-master.js`). Só as 9 primeiras estão em `.env.example`.
Configuração/estado de conexão exibidos na tela: `crm_settings.id='whatsapp_master'` (`getWhatsappMasterSettings`). Teste de conexão: `testWhatsappMasterConnection`.

## 3. Recebimento (webhook)

- `GET`: `hub.mode=subscribe` + `hub.verify_token` == `WHATSAPP_WEBHOOK_VERIFY_TOKEN` → devolve `hub.challenge`; senão 403.
- `POST`: valida `x-hub-signature-256` (HMAC-SHA256 do **corpo bruto** com `WHATSAPP_APP_SECRET`, `timingSafeEqual`); sem assinatura válida → **401** (falha fechado: sem o secret configurado nada é aceito). JSON inválido → 400; erro de processamento → 500 (a Meta reenvia).
- Ignora eventos cujo `metadata.phone_number_id` ≠ `WHATSAPP_PHONE_NUMBER_ID`.
- Cada mensagem vira uma linha em `whatsapp_master_events` (`event_key = message:<id>` ou `status:<id>:<status>:<ts>`; `upsert … ignoreDuplicates`) — **só as linhas realmente inseridas disparam automação**, então reentrega da Meta nunca processa o mesmo “sim” duas vezes.
- O Chat é projetado de forma **idempotente e best-effort** (`projectChatFromEvents`): falha aqui não derruba automações nem faz a Meta reenviar; o bruto continua guardado. Não há reprocessamento/alerta automático de projeções falhas.
- A rota do webhook tem `maxDuration = 30` s (o processamento agora também roda o lead patrocinado e baixa áudio).
- Logs estruturados por evento (`whatsapp-master-webhook`: aceito/rejeitado/processado/falhou, sem conteúdo de mensagem).

## 4. Envio

| Função (`lib/whatsapp-master.js`) | Uso | Restrições |
|---|---|---|
| `sendWhatsappTextMessage` | texto livre (Chat, respostas por palavra-chave) | só dentro da janela de 24 h (o **chamador** confere); ≤ 4096 caracteres; `allowRawRecipient` para responder a quem escreveu (wa_id da Meta) |
| `sendWhatsappMessagePayload` | interativo/mídia (Fluxos, atalhos: botões, lista, `cta_url`, imagem, áudio, documento) | idem |
| `sendWhatsappTemplateMessage` | modelo aprovado (Disparo, lembretes, automação, Chat fora da janela) | destinatário precisa ser celular brasileiro válido (`toWhatsAppDigits`); aceita parâmetros de corpo, parâmetro de URL dinâmica de botão e `callbackData` (`biz_opaque_callback_data`, ≤ 512) |

Classificação de erro (essencial para nunca duplicar envio): `notSent = true` (falha **antes** da Meta: credencial, telefone, nome do modelo) e `metaRejected = true` (a Meta respondeu erro) provam que **não** foi enviado; timeout/rede/resposta sem ID = **resultado desconhecido** → **nunca reenviar automaticamente**. Timeout de 12 s por chamada.

## 5. Janela de 24 h e modelos (templates)

- **Janela** = 24 h desde `whatsapp_conversations.last_inbound_at` (`WINDOW_MS`). Dentro: texto livre, botões, mídia, atalhos. Fora: `sendChatMessage` responde `409 WINDOW_CLOSED`; só **modelo `APPROVED` sem botão** (`sendChatTemplate`; variáveis todas preenchidas) ou o WhatsApp pessoal do corretor (`wa.me`). O Chat mostra aviso âmbar quando restam < 2 h.
- **Modelos**: criados na Meta pela tela Disparo (`createAndSubmitTemplate`) e **sincronizados** (`syncTemplatesFromMeta`, ação explícita — não há polling) para `whatsapp_templates` (chave nome+idioma). Status Meta: `PENDING/APPROVED/REJECTED/PAUSED/DISABLED/IN_APPEAL/NOT_FOUND`. O Disparo só aceita `APPROVED`. Listar/criar modelos pelo endpoint do WhatsApp Master (`admin/whatsapp-master/templates`): **só o dono**; pela tela Disparo (`admin/whatsapp-broadcasts/templates*`): admin/gestor.
- Botão “Receber minha simulação” (site) → `wa.me/<número oficial>` com texto pronto; quando o cliente escreve primeiro a janela abre. O CRM **não** envia valores da simulação automaticamente (o corretor envia pelo Chat). Sem código do cadastro na mensagem: o vínculo é pelo **telefone**.
- Botão “WhatsApp” dos cards de cliente: `/api/admin/whatsapp-chat/window` decide — janela aberta → abre o Chat (`/admin/chat?client=<id>`); fechada/erro → `wa.me` do corretor. O clique **registra a ação** (`last_whatsapp_contact_at`) antes; não prova entrega.

## 6. Chat (`lib/whatsapp-chat.js`, `/admin/chat`)

- **Modelo**: `whatsapp_conversations` (uma por telefone, único `contact_phone`; `status` `open`/`in_service`/`finished`; `assigned_user_id`; `client_id`; `unread_count`; `last_inbound_at`; `last_human_reply_at`; `origin` jsonb) e `whatsapp_messages` (direção `inbound`/`outbound`/**`internal`**, `sender_type` `customer`/`user`/`automation`, `meta_message_id` único, status `received/queued/sent/delivered/read/failed`). Conversa também tem `deleted_at`/`deleted_by` (exclusão lógica) e existe a tabela de auditoria `whatsapp_conversation_audit` (append-only, sem FK).
- **Dois “lidos” que não se misturam**: `whatsapp_messages.status` = ciclo de entrega na Meta; `unread_count`/`last_read_*` = leitura pelo usuário do CRM.
- **Escopo** (`chatScope`): admin/gestor veem tudo; corretor/associado veem conversas de clientes que respondem **ou** atribuídas a eles. Atribuir a outra pessoa: só admin/gestor. Atalhos (textos, imagem, documento, link de simulação do responsável): gerenciar só admin/gestor.
- **Atendimento**: responder marca `in_service`, encerra o Fluxo ativo daquela conversa (`endLiveFlowSession`), grava `last_human_reply_at`, e “quem responde assume” a conversa se ninguém estiver com ela **e** for o responsável pelo cliente (ou a conversa não tiver cliente).
- **Mensagens internas** (`sendChatInternalMessage`, rota `POST …/conversations/[id]/internal`): linha com `direction='internal'`/`message_type='internal'` (constraint no banco: uma implica a outra) **só no CRM** — nunca chama a Meta, não usa nem renova a janela de 24 h (funciona com a janela fechada), não muda status/atendente/última mensagem, não conta como resposta ao cliente (não grava `last_human_reply_at`, e a checagem de “atendente presente” dos Fluxos ignora `internal`) e não dispara automação. **Quem lê e escreve** (`canManageConversation`, decidido no backend; `getChatConversation` nem devolve as internas a quem não pode): administrador geral, gestor, atendente da conversa (`assigned_user_id`) ou responsável atual pelo cliente — **só o próprio id** (o vínculo de associado→corretor **não** vale aqui). Ao salvar, avisa os demais autorizados (responsável, atendente, admins e gestores ativos, exceto o autor) por `crm_notifications` (`chat_internal`) + push; **nunca WhatsApp**. A tela mostra o modo interno (`canInternal`).
- **Excluir conversa** (`deleteChatConversation`, `DELETE …/conversations/[id]`): mesma permissão das internas. É **exclusão lógica** (`deleted_at`): tira da caixa e zera não lidas, encerra o Fluxo vivo (`conversa_excluida`) e grava auditoria; **não** apaga cliente, histórico, funil, documentos, vendas nem responsável, e não tenta apagar nada na Meta. Volta sozinha quando o cliente escreve de novo (`whatsapp_chat_apply_inbound` limpa `deleted_at` e audita `restored_by_inbound`) ou quando alguém abre o WhatsApp do cliente pelo card (`openChatForClient`, `restored_by_open`). A lista, o resumo e a visão geral do Chat (`runScopedQuery`) filtram `deleted_at is null`; abrir uma conversa excluída por id responde 404.
- **Adicionar ao CRM** (`addChatConversationToCrm`): reaproveita o cadastro manual (não duplica se o telefone já existe); origem `whatsapp_chat`.
- **Status do cliente automático.** **[REGRA OFICIAL DE NEGÓCIO — definida pelo dono em 2026-09-25]** O status do CLIENTE muda sozinho conforme a conversa no Chat: quando uma **pessoa da equipe** envia mensagem (texto, modelo, atalho ou anexo) e o cliente está em **“Aguardando simulação”**, ele passa para **“Tentando contato”**; quando o **cliente responde** (qualquer mensagem, menos reação) e está em **“Tentando contato”**, passa para **“Em atendimento”**. Só anda para a frente: cliente em outra etapa, arquivado ou “não contactar” nunca é alterado; respostas automáticas (Fluxos/palavra-chave) não contam como “corretor enviou”; a resposta do cliente só promove quem tem corretor responsável (cliente sem dono, ainda na roleta, não muda). Grava `client_status_history` (`source = whatsapp_chat`); a mudança para “Em atendimento” fica no nome do **corretor responsável** (mesmo marco de “atendimento” da pontuação que ele ganharia marcando à mão, uma vez por cliente) e a de “Tentando contato” no de quem enviou. “Em atendimento” encerra a rodada da Meta Diária desse cliente como conversão (regra já existente). Vale só para mensagens novas (não retroage). — `lib/whatsapp-client-status-core.mjs`, `lib/whatsapp-client-status.js`, `lib/whatsapp-chat.js` (`noteHumanContact`, `projectChatFromEvents`), testes em `tests/whatsapp-client-status.test.mjs`.
- **Visão geral** (`getChatOverview`, `waitingInfo`): conversa não finalizada em que o **cliente escreveu por último** = “aguardando a gente” (≥ 10 min atenção, ≥ 30 min atraso); em que **nós** falamos por último e há ≥ 180 min de silêncio = “contato em silêncio”.
- **Mídia enviada**: imagem JPG/PNG, áudio (ogg/mp3/mp4/aac/amr; gravação `webm/opus` é convertida para ogg em `lib/webm-opus-to-ogg.mjs`), documentos PDF/Office; ≤ 4 MB (limite de corpo da Vercel); armazenada no bucket **público** `whatsapp-chat-media`. **Áudio recebido** (`lib/whatsapp-media.js`): o servidor consulta a mídia na Meta (token só no servidor), baixa (≤ 16 MB, confere `sha256`), guarda no bucket **privado** `whatsapp-inbound-media` (`SUPABASE_INBOUND_MEDIA_BUCKET`) e registra o estado em `metadata.media` (`stored`/`failed`, tentativas). O navegador toca por `GET /api/admin/whatsapp-chat/media/[messageId]` (autenticada, mesma checagem de acesso da conversa, suporta `Range`, `?retry=1` tenta de novo); o download acontece no webhook (orçamento de 9 s, melhor esforço) ou sob demanda. `POST …/media/recover` (gestão/admin) tenta recuperar áudios dos últimos 14 dias. Player próprio com plano B de decodificação (`components/ChatAudioPlayer.jsx`, `lib/audio-wav.mjs`, `public/vendor/ogg-opus-decoder.min.js`). **Imagem/documento/vídeo recebidos** continuam sem download: só o rótulo (A CONFIRMAR se é requisito).
- **Tempo real**: Supabase Realtime **Broadcast** sem dados (`broadcastChatChanged` → tópico HMAC não adivinhável); o navegador refaz a busca pela API autenticada; polling lento de segurança. Falha no broadcast é ignorada.

## 7. Associação mensagem ↔ cliente ↔ responsável

- **Telefone é a chave de ligação** (o CRM permite vários atendimentos por telefone; a ligação escolhe o cadastro **mais recente** que bate com qualquer formato do número): `lib/client-phone-lookup.js` (`findLatestRegistrationIdsByPhones`, `findConversationByPhone`) — **único ponto** usado por webhook, Chat, roleta, Fluxos, automações e Disparo.
- Formatos (`lib/phone-utils.js`): `canonicalWhatsappPhone` = E.164 com 9º dígito para celular BR (`+55DD9XXXXXXXX`); `phoneComparisonKey` iguala com/sem 9, com/sem +55; `phoneLookupCandidates` lista todas as formas gravadas para `.in(...)`; `toBrazilianE164`/`toWhatsAppDigits` **só aceitam celular** (`DD9XXXXXXXX`). A Meta às vezes entrega o wa_id sem o 9 — por isso o cuidado. Testes: `tests/phone-utils.test.mjs`.
- **Dois “donos” sincronizados**: cliente (`responsible_user_id`) e conversa (`assigned_user_id`). Cliente→conversa: trigger `whatsapp_conversation_assignee_sync`. Conversa→cliente: `assignChatConversation` (só admin/gestor, com histórico de transferência).
- Conversa iniciada por anúncio “Click to WhatsApp”: guarda `origin = { kind: 'meta_ad', referral }` (a Meta envia `referral`); o Fluxo condicional “origem anúncio”/gatilho `ad_referral` reage, e **lead patrocinado novo entra na roleta** (§9-B), gravando a origem no cliente (`client_origins`, ver `TRAFEGO_META.md`).
- **Atendimento humano ativo** (`lib/whatsapp-attendance.js`, `HUMAN_ATTENDING_MS = 30 min`): sinal **separado** de `last_whatsapp_contact_at`. Uma pessoa respondendo pelo Chat: (1) impede a redistribuição automática da roleta se respondeu **depois** de o responsável atual assumir; (2) suspende respostas por palavra-chave; (3) bloqueia Fluxos que não sejam por palavra-chave nos 30 min seguintes. **Não** conta para Meta Diária/ranking/“cliente aguardando ação” (ver P-11).

## 8. Fluxos (robô visual — `lib/whatsapp-flow-core.mjs` puro + `lib/whatsapp-flows.js`)

- **Modelo**: `whatsapp_flows` (rascunho/publicado com versão; `status` `draft`/`active`/`paused`), `whatsapp_flow_sessions` (uma sessão viva por telefone — índice único → `23505` ignora; `status` `active/waiting/completed/handoff/expired/failed`), `whatsapp_flow_logs`. Editor visual em `components/flows/*`; limites: 80 nós, 240 arestas, 300 KB, 30 passos/execução, 8 envios/execução, 2 novas tentativas, espera máx. 23 h.
- **Nós**: `start`, `message` (texto/botões ≤ 3/lista ≤ 10/link), `input` (captura resposta), `action` (`roulette`, `tag`, `handoff`, `finish`, `stop`), `condition` (`business_hours`, `is_client`, `has_broker`, `ad_origin`, `has_name`), `delay`.
- **Gatilhos** (`TRIGGER_PRIORITY`: palavra-chave 0 < anúncio 1 < primeira mensagem 2 < qualquer mensagem 3): `keyword` (modo `exact` ou “contém” — **sem fronteira de palavra**, diferente das respostas por palavra-chave; P-16), `first_message`, `ad_referral`, `any_message`. Cooldown padrão: primeira mensagem 24 h, qualquer mensagem 12 h, demais 0. Só o **grafo publicado** roda; editar não muda o que está no ar até “Ativar”.
- **Execução**: cada mensagem nova do cliente é resposta ao passo atual da sessão viva (expira por inatividade em 30 h); sem sessão, procura fluxo ativo cujo gatilho casa (com o filtro “pós-formulário” de §9-A); humano atendendo há < 30 min só deixa passar gatilho de palavra-chave (o motivo fica no log “Atividade”). Envio só dentro da janela (`canSend`). Cron `/api/cron/whatsapp-flows` (1 min) retoma “Espera” e prazos “se não responder”, e expira sessões abandonadas.
- **Ação `roulette`**: cliente novo pela roleta (RPC atômica) **ou** usa o responsável do cliente existente (nunca troca); conversa fica com o corretor sorteado; notifica-o (`crm_notifications`); preenche variáveis `corretor`, `link_simulacao` (link pessoal com `?jornada=simulacao`) e as de tratamento (`lib/broker-gender.js`: `cargo_corretor`, `nosso_cargo`, `o_a`, `ele_ela`). Ação `tag` → `addTagToClient`. `handoff` → conversa vai a “aberta”; `finish` → “finalizada”.
- **Modelos prontos**: `components/flows/flow-templates.js` (ex.: “Formulário concluído (Receber minha simulação)”, “Menu principal”).
- Testes: `tests/whatsapp-flow-core.test.mjs` — **1 falha conhecida** (`modelo 'Menu principal'`).

## 9. Respostas automáticas por palavra-chave (`lib/whatsapp-automation-replies.js`)

`whatsapp_automation_replies` (palavra, resposta, `forward_to_roleta`, ativa, ordem, contador). Primeira regra ativa por `display_order` cuja palavra aparece como **palavra inteira** (`lib/whatsapp-keyword-match.mjs`: sem acento, sem caixa, sequência de palavras; “sim” ≠ “simulação”) responde; se `forward_to_roleta`, chama `whatsapp_get_or_create_roulette_client` (cliente existente **não** é reatribuído). `{{link_simulacao}}` vira o link pessoal do corretor sorteado (ou o link geral). A resposta aparece no Chat como mensagem de **automação**. Só roda se **nenhum Fluxo** tratou, **nenhum humano** atende e **não é contato pós-formulário** (ver §9-A). Editar: admin/gestor. Semente na migration (`sim`/`não`): **se estão ativas hoje = A CONFIRMAR**. Testes: `tests/whatsapp-keyword-match.test.mjs`.

### 9-A. Contato pós-formulário (regra nova — commit `b3089ea`, `lib/whatsapp-form-completion.mjs`)

O cliente que **acabou de preencher o formulário** já tem cadastro e corretor, então não deve receber boas-vindas/menu/link genérico. É “contato pós-formulário” quando: (a) a mensagem contém “preenchi meu cadastro” (texto do botão “Receber minha simulação”, constante compartilhada `FORM_COMPLETION_MESSAGE`, usada pelo botão do site) ou (b) existe cadastro criado nas últimas **24 h** para aquele telefone (qualquer formato) por formulário/link — `findRecentFormRegistration` em `lib/client-phone-lookup.js` **ignora** origens `manual` e `whatsapp*`. Efeitos:
- **Respostas por palavra-chave**: suprimidas (`shouldSuppressKeywordReply`; log `skipped_post_form_contact`).
- **Fluxos**: se a mensagem é a do botão, **só** o fluxo dedicado (gatilho por palavra-chave “preenchi meu cadastro”/“receber a minha simulação/receber minha simulação”) pode rodar; se é só cadastro recente, gatilhos **automáticos** (`any_message`, `first_message`, `ad_referral`) não disparam e os de **palavra-chave** continuam valendo. Fluxos suprimidos vão para o log “Atividade” (`skipped`).
- Teste: `tests/whatsapp-form-completion.test.mjs`.

### 9-B. Lead patrocinado — Click to WhatsApp (`lib/whatsapp-sponsored-lead.js`, `lib/whatsapp-referral.mjs`, migration `20260924210000`)

Quem chega por **anúncio da Meta** (`referral.source_type = ad`; sem `source_type`, vale se houver `ctwa_clid`/`source_id`; `post` **não** entra) e ainda **não é cliente** entra na **roleta** existente:
- Roda no webhook (eventos novos, já deduplicados) **antes** dos Fluxos/respostas, e numa rede de segurança: o cron `scheduled-activities` chama `reconcileSponsoredLeads` (conversas de anúncio das últimas 24 h sem cliente, até 10 por rodada). Falha nunca derruba o webhook.
- Tudo numa **única transação** do banco, serializada por telefone (`whatsapp_get_or_create_roulette_client`, agora com `p_conversation_id` e `p_history_details`): cliente existente (qualquer formato do número) só tem a conversa vinculada — **não** duplica, **não** volta à roleta, responsável preservado; cliente novo → escolhe o corretor (presença), cria o cliente (`distribution_type='round_robin'`), **grava `lead_distribution_history`** (`assigned`, com `presenceTier`, `skipped`, `source: whatsapp_ad`) e **atribui a conversa ao mesmo corretor**.
- Origem gravada: `acquisition_context.kind = whatsapp_ad`, rótulo “WhatsApp — Anúncio patrocinado”, metadados do `referral` saneados (sem mídia) + nomes de anúncio/conjunto/campanha **quando** o ID do anúncio já foi sincronizado em `meta_ad_entities` (a Meta não manda nomes no webhook).
- Avisos: o corretor sorteado recebe notificação; sem corretor disponível a conversa fica no Chat e a gestão (admin/gestor ativos) é avisada.
- As respostas por palavra-chave e as ações `roulette` de Fluxos também passam `conversationId`: o cliente criado por WhatsApp agora **vincula a conversa** e grava o histórico da roleta (`via: keyword_reply`/`flow`).
- Testes: `tests/whatsapp-chat-media-referral.test.mjs`.

## 10. Disparo (`lib/whatsapp-broadcasts.js`)

- **Fluxo**: escolher modelo `APPROVED` → destinatários (Base da Imobiliária `prospecting_contacts` sem dono, ou CSV) → revisão (`previewBroadcast`: totais, inválidos, duplicados, bloqueados) → `createBroadcast` (cria campanha do Gerador de Links com destino roleta, `whatsapp_broadcasts` e uma `whatsapp_broadcast_messages` por destinatário) → “Disparar agora” (`dispatchBroadcastNow`, transição condicional `draft→processing`, anti clique duplo) + cron a cada minuto (`processAllActiveBroadcastQueues`, 45 s de orçamento dividido entre disparos).
- **Proteções**: “não contactar” **nunca** entra (no servidor); CSV normaliza telefone, remove duplicados (9º dígito), confere opt-out contra a base; ~1 mensagem/s; até 5 tentativas em erro **temporário** (429/5xx/timeout de rede da Meta, reenfileira ao fim da fila); erro permanente → `failed`; **resultado desconhecido → `failed/delivery_unknown`, nunca reenvia** (o webhook de status pode promover a linha). Aquisição atômica por linha (`claim_whatsapp_broadcast_message`, `FOR UPDATE SKIP LOCKED`, `claim_token`), marca `begin_whatsapp_broadcast_send` antes de chamar a Meta, recuperação de presas (`recover_stuck_…`, 300 s): sem ter chamado a Meta → volta à fila; já chamou → `delivery_unknown`; já tem ID → `sent`.
- **Correlação de status**: por `whatsapp_message_id` e `biz_opaque_callback_data` (`bcm:<id>`); progresso `queued<processing<sent<delivered<read<failed` (nunca regride). Link do botão: campanha `?c=<id>` com `link_journey` (`choice`/`quick_service`/`simulation`).
- Permissão: admin/gestor (`assertGeneralAdminOrManager` no `lib`; a rota só exige login).

## 11. Outros usos do WhatsApp

- **Lembrete de atividade** (`lib/scheduled-activity-notifications.js`): modelo `WHATSAPP_REMINDER_TEMPLATE_NAME` ao corretor (+ e-mail ao dono + push). Falha do WhatsApp impede push/e-mail e a marcação de “notificado” (P-04).
- **Automação do CRM** `send_whatsapp_template`: modelo aprovado para corretor/gestor/dono; variáveis posicionais a partir de `AUTOMATION_WHATSAPP_VARIABLES`.
- **WhatsApp Manual** (`lib/whatsapp-manual-summary.js`, `whatsapp_manual_log`): monta textos com dados reais para o dono enviar **manualmente** (`wa.me`); só registra a ação.
- **Perfil do WhatsApp Business** (`lib/whatsapp-profile.js`): ler/editar foto, sobre, endereço etc. via Graph; só admin.
- **Meta Diária** e **Prospecção**: abrem `wa.me` com texto pronto e registram a tentativa (ação, não entrega).

## 12. Identificadores importantes

`event_key` (`whatsapp_master_events`), `message_id`/`meta_message_id` (ID da Meta; único em `whatsapp_messages`), `wa_id`/`contact_phone` (chave da conversa), `conversation_id`, `client_id`, `flow_id` + `session id`, `automation_id` (`whatsapp_messages`), `whatsapp_message_id` + `claim_token` + `callbackData bcm:<id>` (Disparo), `phone_number_id` (filtro do webhook), `referral` (`ctwa_clid` etc.; na conversa e, para lead patrocinado novo, também em `client_origins.source_metadata`), `deleted_at`/`whatsapp_conversation_audit` (exclusão lógica), `metadata.media` (áudio recebido).

## 13. Deduplicação e idempotência (resumo)

| Onde | Como |
|---|---|
| Evento da Meta | `event_key` único (`ignoreDuplicates`) |
| Mensagem no Chat | `meta_message_id` único (índice completo) |
| Conversa | `contact_phone` único + busca por todos os formatos do número |
| Cliente criado via WhatsApp (resposta, Fluxo, lead patrocinado) | RPC com lock de telefone; existente é reaproveitado (só vincula a conversa) |
| Áudio recebido | estado em `metadata.media`; não baixa de novo se `stored`; `upsert` no storage |
| Disparo | clique duplo (transição condicional), claim por linha, `delivery_unknown` sem reenvio |
| Fluxo | uma sessão viva por telefone; cooldown por fluxo/telefone; lock de sessão (60 s) |
| Contador de não lidas | RPC atômica (`whatsapp_chat_apply_inbound`) |

## 14. Riscos conhecidos e pontos a confirmar

Detalhes e impacto em [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) §Problemas. Resumo:
1. **P-04** lembrete de atividade falha em loop quando o modelo não existe/aprovado (erro Meta “#132001”, registrado na memória operacional de 2026-09-24) — bloqueia também push/e-mail.
2. **P-11** resposta pelo Chat não conta como “contato” (por desenho); automações “sem primeiro atendimento” e o indicador “aguardando ação” continuam vendo o cliente como não contatado.
3. ~~P-06~~ **resolvido** (migration `20260924210000`): a roleta acionada por WhatsApp agora grava `lead_distribution_history` e vincula a conversa.
4. **P-16** gatilho de Fluxo por palavra-chave “contém” sem fronteira de palavra.
5. Sem **opt-out** (PARAR/SAIR) no fluxo de mensagens; “não contactar” só vale para a base de prospecção/Disparo. **A CONFIRMAR** requisito.
6. Só o **áudio** recebido é baixado (bucket privado); imagem/documento/vídeo recebidos não. O bucket de mídia **enviada** (`whatsapp-chat-media`) é público (URLs não listadas).
7. Modelos aprovados na WABA atual e o número ativo: **A CONFIRMAR** (a memória operacional de 2026-09-24 registra 0 modelos aprovados na WABA nova).
8. Falhas de projeção do Chat não têm reprocesso/alerta (o bruto fica em `whatsapp_master_events`). O lead patrocinado tem rede de segurança (cron); o áudio tem “Tentar novamente”/recuperação manual.
9. ~~Código TEMPORÁRIO de testes na `main`~~ **encerrado** (P-21). O código foi removido no commit `9bcae0c` (2026-09-25): os commits `TEMP:` de 2026-09-24 tinham introduzido `dryRunForFictionalRecipient` em `lib/whatsapp-master.js` (destinos `+5500…` não chamavam a Meta e devolviam ID `wamid.DRYRUN…`), o pulo do push em `notifyInternalMessage` para conversas `+5500…` e a rota `app/api/admin/tmp-chat-tests`; os envios voltaram a ser sempre reais. O `maxDuration = 30` do webhook (`app/api/webhooks/whatsapp-master/route.js`) é legítimo e permanece. Os dados de teste (12 linhas `TESTE CRITICO` em `crm_clients`) foram removidos do banco e a verificação final achou 0 resíduos; nenhuma conversa, mensagem ou auditoria do WhatsApp tinha resíduo (detalhes em `SYSTEM_ARCHITECTURE.md` P-21).

## 15. Como testar sem enviar mensagem real

- Lógica pura: `node --test tests/whatsapp-flow-core.test.mjs tests/whatsapp-keyword-match.test.mjs tests/whatsapp-form-completion.test.mjs tests/whatsapp-chat-media-referral.test.mjs tests/phone-utils.test.mjs tests/whatsapp-contact-channel.test.mjs`.
- Pré-visualização do Fluxo no editor usa dependências simuladas (não envia).
- **Nunca** chame as funções de envio com telefone real em “teste”. Não existe mais envio simulado: a trava temporária para `+5500…` foi removida (§14, item 9), então qualquer chamada de envio vai de fato à Meta ou falha na validação local (DDD 00 é rejeitado).
- Qualquer rota temporária de diagnóstico em produção: autenticada, sem `_` no nome da pasta, removida e reimplantada depois.
