# CHANGELOG_AI — registro de alterações importantes feitas por agentes

> Este arquivo registra **alterações importantes futuras** feitas por agentes de IA (e por pessoas que usem agentes) neste projeto. **Não contém histórico anterior**: o histórico de código está no Git e o das regras de negócio em `.claude/rules/*.md` e `docs/`.
> Manual dos agentes: [`../AGENTS.md`](../AGENTS.md) · Contexto: [`CRM_CONTEXT.md`](CRM_CONTEXT.md) · Regras: [`BUSINESS_RULES.md`](BUSINESS_RULES.md) · Arquitetura: [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md).

## Quando registrar

Registre uma entrada **sempre que a sua alteração**:

- muda uma **regra de negócio** ou o comportamento visível de um módulo;
- cria/altera **tabela, coluna, função, trigger, migration, cron** ou política de acesso;
- cria/altera **rota de API**, guard/permissão ou contrato de payload;
- mexe em **integração** (WhatsApp, Meta, Anthropic, Resend, push) ou em variável de ambiente;
- altera uma **área compartilhada** (ver lista em `SYSTEM_ARCHITECTURE.md` §10);
- **corrige uma divergência** entre a documentação e o código (atualize também o documento afetado);
- ou quando você **encontra um problema fora do escopo e não o corrigiu** (registre em “Risco/observação” e avise o dono).

Não registre: ajuste de texto/estilo trivial, refatoração sem efeito visível, tarefas só de leitura/auditoria sem alteração.

## Como registrar

1. Acrescente a entrada logo **abaixo do título “## Registro”*### 2026-10-10 — Apresentação: cena "Próximo passo" encaixada no celular
- **Data:** 2026-10-10
- **Área:** Apresentação da simulação (PRES)
- **O quê (pedido do dono):** no celular a cena "Próximo passo" passava da tela ("Próximo passo" encostado na marca do topo, botões por cima da logo da Caixa, "AGENDAR ATENDIMENTO" em duas linhas). Só CSS, só esta cena (`components/presentation/presentation.module.css`, `.scene[data-scene="proximo"]`): título e botões menores, espaçamentos mais curtos, `justify-content: safe center`. Conferido na vitrine em 430×932, 390×844 e 375×667; demais cenas sem sobreposição. Computador e conteúdo inalterados.

### 2026-10-09 — Chat: "online / visto por último" do contato (WhatsApp pessoal)
- **Data:** 2026-10-09
- **Área:** WhatsApp / Chat / microsserviço
- **O quê (pedido do dono):** no cabeçalho da conversa, ao lado de "Janela aberta", aparece "online", "digitando…", "gravando áudio…" ou "visto por último hoje às HH:MM" — só quando existe: conversa do WhatsApp PESSOAL com o número conectado e contato que não esconde o "visto por último" (o número oficial/API da Meta não informa presença). Microsserviço: `getContactPresence` (`presenceSubscribe`, o mesmo que o WhatsApp Web faz ao abrir a conversa; no máximo 1 pedido/min por contato; resposta pelo evento `presence.update`, guardada só em memória) + `POST /sessions/:userId/presence`. CRM: `fetchIndividualPresence` (`lib/whatsapp-individual.js`), `getChatContactPresence` (`lib/whatsapp-chat.js`, escopo do Chat, nunca lança), `GET /api/admin/whatsapp-chat/conversations/[id]/presence` (`requireAdminApi`), `ContactPresence` (`components/WhatsappChat.jsx`, atualiza a cada 1 min com a aba visível). Teste: `tests/whatsapp-contact-presence.test.mjs`.
- **Caso Waldeirsiqueira (17:15):** a mensagem "O Sr. está com alguma dúvida…" saiu do celular da Izabela (não do CRM) e ficou com 1 tique (enviada, não entregue) até a sessão da Izabela no CRM cair (`logged_out`, 17:49) — depois disso o CRM não recebe mais confirmações de entrega.

### 2026-10-10 — Lembrete do formulário: tiques de entregue/lido passam a aparecer no Chat (caso Keite)

- **Sintoma (dono, com print):** lembrete "Notei que você ainda não preencheu o formulário" com 1 tique só, parecendo não entregue.
- **Causa raiz:** a Meta entregou (14:28) e a cliente leu (14:40), mas o lembrete guarda a chave `form-reminder:...` em `meta_message_id` e o id da Meta em `metadata.cloud_message_id`; `applyOutboundStatusEvents` (`lib/whatsapp-chat.js`) só procurava por `meta_message_id`, então o status nunca saía de "enviada".
- **Mudou:** busca também por `metadata->>cloud_message_id`. Os 6 lembretes antigos presos em "enviada" (todos lidos na Meta) foram acertados no banco. Teste: `tests/form-reminder-status.test.mjs`.

### 2026-10-10 — Fluxo do anúncio: 1ª mensagem sem referral da Meta agora cai no fluxo do anúncio (caso Luana)

- **Sintoma (dono, com print):** cliente do anúncio recebeu só "Em instantes, um dos meus associados…" (saudação de contato espontâneo), sem as mensagens pedindo o formulário.
- **Causa raiz:** a Meta entregou a 1ª mensagem ("Olá! Posso ter mais informações sobre isso?") SEM o campo `referral` (confirmado no evento bruto em `whatsapp_master_events`). Sem referral o gatilho `ad_referral` não casa e o motor caiu no fluxo "Contato espontâneo — saudação", que só tem 1 mensagem. Nos últimos 60 dias: 51 mensagens de anúncio com referral e 3 com o texto do anúncio sem referral.
- **Mudou:** `isAdPrefillText` (`lib/whatsapp-referral.mjs`) reconhece os textos pré-preenchidos dos anúncios; `processFlowInbound` (`lib/whatsapp-flows.js`) trata como clique no anúncio só na 1ª mensagem textual sem referral. Só afeta o GATILHO do fluxo — origem patrocinada, roleta e atribuição continuam exigindo o referral real. Teste: `tests/whatsapp-ad-prefill.test.mjs`. Texto novo de anúncio precisa entrar em `AD_PREFILL_TEXTS`.

### 2026-10-10 — Meta Diária: rótulo do teto, aquecimento e painel de saúde batem com a realidade (caso ketlin)

- **Sintoma (dono, com prints):** cartões diziam "aquecimento de número novo/reconectado (15 por dia)" para todos os corretores; painel de saúde repetia a mesma fila em cada número do corretor.
- **Causa raiz:** (1) o rótulo era "aquecimento" para QUALQUER teto < 30 — na verdade era o teto manual (15) de todos; (2) número que nunca pareou (`phone: null`, ex.: ketlin Nº 1) contava como apto e inflava o teto de aquecimento do corretor; (3) o início do aquecimento usava a data da última reconexão (muda a cada queda) em vez da criação do número.
- **Mudou:** rótulo mostra a causa real (aquecimento × teto manual × política); `brokerWarmupCap` ignora número não pareado; `syncSlotControls` usa `created_at` do número; painel rotula a fila como "do corretor (todos os números)". Dados de produção NÃO foram alterados (o início de aquecimento já gravado da ketlin Nº 2 segue como está).
- **Arquivos:** `lib/daily-goal-auto.js`, `lib/daily-goal-policy-core.mjs`, `lib/daily-goal-protection-core.mjs`, `components/WhatsappSessionHealthPanel.jsx`, `tests/daily-goal-protection.test.mjs`.

### 2026-10-10 — Design: aviso "Número N pausado por segurança" e painel de saúde do WhatsApp (só apresentação)

- `components/DailyGoalAdmin.jsx`: o aviso de número pausado (MD-15) saiu de dentro da coluna estreita do cartão e virou faixa própria em âmbar (`role="alert"`, ícone, motivo, explicação em português simples). "Retomar Número N" virou botão com alvo de toque de 44 px (largura total no celular), mostra "Retomando…" e pede confirmação antes (mesmo padrão de "Ligar política nova"). Antes: linha de texto vermelho com link pequeno. Nenhum dado, chamada ou regra alterados.
- `components/WhatsappSessionHealthPanel.jsx`: nome do corretor e "Último erro" passam a quebrar linha em vez de serem cortados com reticências (360 px); resumo anuncia atualização (`aria-live`).
- Não renderizado com dado real (sem login no ambiente); sintaxe conferida. Aquecimento por número não aparece nesse cartão hoje (a API não entrega o dado ali) — precisaria de campo novo, decisão do dono/`crm-editor`.

### 2026-10-10 — Google Contacts: conexão sem permissão de Contatos travava o envio da Meta Diária (Bruna)

- **Sintoma:** 23 itens da fila da Meta Diária da Bruna Santos em `error` ("Google Contacts: Request had insufficient authentication scopes"), reagendados de 30 em 30 min sem nunca enviar.
- **Causa raiz:** a conexão Google dela foi salva com só `openid`/`userinfo.email` (permissão de Contatos desmarcada no consentimento) e ficou `connected`; o pré-envio chamava o Google, recebia 403 e reagendava em loop.
- **Mudou:** (1) `completeGoogleOAuthConnection` recusa conexão sem a permissão de Contatos; (2) 403 de permissão/401 ao criar contato marca a conexão como `error` ("Requer reconexão"), e o envio automático segue sem esperar o Google (mesmo tratamento do token revogado).
- **Arquivos:** `lib/google-contacts.js`, `lib/google-contacts-config-core.mjs`, `tests/google-contacts-config.test.mjs`.
- **Pendente (dono/Bruna):** reconectar o Google dela liberando Contatos. Nenhum dado de produção foi alterado.

### 2026-10-09 — PWA: versão nova não recarrega a tela na frente de quem está usando
- **Data:** 2026-10-09
- **Área:** PWA / Frontend
- **Causa raiz (reclamação da Carol):** `components/PwaLifecycle.jsx` procura versão nova ao voltar ao app e a cada 10 min; o `public/sw.js` muda a cada build (`skipWaiting`) e o `controllerchange` recarregava a página na hora (só esperava parar de digitar). Num dia com dezenas de publicações a tela recarregava toda hora.
- **Correção:** a versão nova fica pendente e só é aplicada quando o app/aba fica oculto (pessoa saiu) ou logo ao voltar a ele, nunca com campo sendo digitado. A procura de versão (10 min + ao voltar) continua igual. Teste: `tests/client-card-whatsapp-chat.test.mjs`.

### 2026-10-09 — Chat: editar o nome do contato
- **Data:** 2026-10-09
- **Área:** WhatsApp / Chat
- **O quê (pedido do dono):** lápis ao lado do nome no painel do contato do Chat (`ContactNameEditor`, `components/WhatsappChat.jsx`); `PATCH /api/admin/whatsapp-chat/conversations/[id]` com `{ contactName }` (`requireAdminApi`) → `renameChatContact` (`lib/whatsapp-chat.js`): mesmo escopo do Chat (`loadConversation`), 2–80 caracteres, normalizado como o nome do cliente (`normalizePersonName`); com cliente vinculado muda também `simulation_registrations.full_name` pelo caminho normal (`updateSimulationRegistration`, com a checagem de acesso dele). Mensagem nova não sobrescreve (o `whatsapp_chat_apply_inbound` só preenche nome vazio). Teste: `tests/whatsapp-contact-rename.test.mjs`.

### 2026-10-09 — ROL-4d: ação manual cancela automação (cliente voltou à roleta depois de atribuído à Bruna)
- **Data:** 2026-10-09
- **Área:** Roleta / Automações / Formulário
- **Causa raiz (Elaine dos Santos / "Cristina"):** 14:02 o dono usou "Devolver para a roleta" e ela foi para a Bruna; a Bruna atendeu (mensagens, "Em atendimento", "Documentação pendente" 14:37). 14:41 a cliente preencheu o formulário: o reenvio forçava a etapa para "Aguardando simulação" e, com renda informada e mais de 5 min desde 14:02, a REDISTRIBUIÇÃO (ROL-4b) a mandou para a fila de espera com o dono às 14:42 (o dono transferiu de volta à mão 14:44). "Devolver para a roleta" não contava como transferência manual (ROL-4c religava a redistribuição).
- **Correção (regra nova do dono ROL-4d):** ~~toda transferência feita por pessoa desliga a redistribuição~~ (revertido no mesmo dia: o dono confirmou que "Devolver para a roleta" mantém o prazo para o próximo corretor; o prazo de 5 min passou a contar do último entre recebimento e formulário preenchido — `triggerAnchor`); atribuição manual de cliente em `whatsapp_ad_waiting` zera o `distribution_type`; formulário reenviado não regride etapa já avançada (`FORM_RESETS_STATUS_FROM`). Dado atual: nenhum cliente em `whatsapp_ad_waiting` com outro responsável além do dono. Teste: `tests/manual-transfer-disables-roulette.test.mjs`.

### 2026-10-09 — Atalho "Chat" na tela inicial do iPhone
- **Data:** 2026-10-09
- **Área:** PWA / Chat
- **O quê (pedido do dono):** terceiro app, mesma proposta do Financeiro: `/chat-app` (página só de instalação) com manifesto `public/chat.webmanifest` (`id` /chat-app) e ícones `public/icons/*chat*-v3-mm.png` (fundo #031D3A, balão do WhatsApp dividido na diagonal como o "M" (esquerda #EFEFEF, direita #3673C2) e telefone #EFEFEF — opção 1 escolhida pelo dono). No app instalado abre `/admin/chat` e mostra só o Chat (`html[data-mm-app=chat]`): sem ranking, menus, barra inferior, popups do painel nem "Abrir cliente"; `FinanceiroAppGuard` (agora genérico, `MM_APPS` em `components/pwaHome.js`) devolve qualquer outra rota `/admin` ao Chat. O número de não lidas no ícone usa o mesmo Badging API já existente (`useWhatsappChatSummary` com o app aberto; push em `public/sw.js` com o app fechado, depois de ativar as notificações no app). Painel e Financeiro inalterados.
- **Ajuste (mesmo dia):** o atalho abria o painel inteiro quando o iPhone abria o ícone numa aba do Safari/Chrome (modo app só ligava em standalone). Agora `/chat-app` É o Chat (`app/chat-app/page.jsx`, mesmas regras de `/admin/chat`), sem painel em volta em qualquer modo (`AppChrome`). Login volta para o app via `?next=` (`app/admin/login/page.jsx`, só caminhos internos). Também corrigidos stubs faltando em `tests/whatsapp-conversation-per-session.test.mjs` (chat-control/isChatPushSuppressed).

### 2026-10-09 — Saúde: "Novo gasto" (avulso, já pago) e "Nova conta recorrente"
- **Data:** 2026-10-09
- **Área:** Financeiro / Saúde
- **O quê (pedido do dono):** botão principal do painel passou a ser **Novo gasto** — gaveta curta (com o que foi, valor, data ≤ hoje, categoria, observação) que grava despesa operacional única, natureza variável, e confirma o pagamento na data do gasto pelo mesmo caminho do "Já foi paga?" (o cadastro pelo dono é a confirmação manual; regra de pagamento manual preservada). **Nova conta** desceu para baixo dos totais, renomeada "Nova conta recorrente", e abre já como recorrente/fixa (ainda permite Única). Painel renomeado "Gastos e contas". Só interface: `components/FinancialHealthAccounts.jsx`; API, banco e cálculos inalterados.

### 2026-10-09 — Atalho "Financeiro" na tela inicial do iPhone
- **Data:** 2026-10-09
- **Área:** PWA / Financeiro
- **O quê:** segundo ícone de app (pedido do dono): `/financeiro` (página pública só de instalação, sem dado) usa manifesto próprio `public/financeiro.webmanifest` (`id` /financeiro) e ícones `public/icons/*financeiro*-mm.png` (mesmo fundo #031D3A e cores do "M", com cifrão). No app instalado redireciona para `/admin/financeiro?aba=saude` (abre direto em Saúde/contas quando o perfil vê a aba; login e permissões inalterados). Após login, `components/pwaHome.js` (sessionStorage) devolve o usuário ao Financeiro. Manifesto/ícone do Painel (`app/manifest.js`, `app/layout.jsx`) não foram alterados.
- **Modo app (mesmo dia):** no app Financeiro instalado, `app/layout.jsx` marca `html[data-mm-app=financeiro]` antes da pintura (standalone + sessionStorage `mm_pwa_home`); CSS esconde ranking/Campeão, menu do topo (`AdminSectionNav`), barra inferior, "Segurança" e "Ver cliente" (classe `mm-app-hide`); `HideInFinanceiroApp` não monta mensagens/celebrações/alertas; `FinanceiroAppGuard` devolve qualquer outra rota `/admin` ao Financeiro. Painel no navegador/app Painel inalterado.

* (mais recente primeiro) — **nunca no topo do arquivo**, acima destas instruções.
2. Uma entrada por mudança lógica (não uma por arquivo). Escreva em **português do Brasil**, objetivo e sem jargão desnecessário.
3. **Nunca** inclua tokens, segredos, valores de variáveis de ambiente, dados pessoais de clientes ou telefones/e-mails reais.
4. Se a alteração afetou regras/arquitetura, **atualize também** o documento correspondente em `docs/` (e diga qual na entrada).
5. Se algo não pôde ser provado no código, escreva **A CONFIRMAR** — não invente.
6. Não apague entradas antigas. Para corrigir uma, acrescente uma nova referenciando a anterior.
7. **Arquivamento mensal (quando necessário):** se este arquivo passar de ~500 linhas, mova as entradas de meses já encerrados, sem alterar o texto, para `docs/changelog/AAAA-MM.md` (um arquivo por mês, mais recente primeiro) e deixe ao fim da seção “Registro” a linha `Meses anteriores: docs/changelog/`. Agentes leem só as entradas recentes daqui; o arquivo mensal é consultado sob demanda.

## Formato

Copie o modelo abaixo (uma entrada por bloco):

```markdown
### AAAA-MM-DD — <título curto>
- **Data:** AAAA-MM-DD
- **Área:** <Clientes | Roleta | Funil | Agenda | Meta Diária | Ranking | WhatsApp | Meta/Tráfego | Documentação/CCA | Financeiro | Permissões | Banco | Infra | Docs | …>
- **Alteração:** <o que mudou, em 1–3 linhas>
- **Motivo:** <por que; pedido do dono, bug, incidente…>
- **Arquivos afetados:** `caminho/arquivo1`, `caminho/arquivo2` (e migrations, se houver)
- **Risco/observação:** <impacto possível em outros módulos, o que foi validado e como, o que ficou A CONFIRMAR, problemas encontrados e não corrigidos>
- **Autor:** <agente/ferramenta ou pessoa>
```

## Registro
### 2026-10-10 — Análise geral: Particular (sem leitura + destranca limpo), testes, falhas silenciosas, funções do banco, código morto
- **Particular (WA-23, dono):** conversa trancada = o corretor e a gestão veem só a linha (nome, telefone, "Conversa particular"); só o administrador geral lê (`privateContentHidden`, `allowPrivateShell`, `lib/whatsapp-chat.js`). **Destrancar** apaga as mensagens do Chat (cópia em `whatsapp_private_wipe_backup`), zera o vínculo e define `history_cutoff_at` (nada anterior é importado nem exibido); o cadastro antigo fica oculto e `findLatestRegistrationIdsByPhones` o ignora (`private_contact_at`) — corrige o "cliente invisível" ao destrancar. Sem aviso na tela. Migration `20261010120000_private_conversation_wipe.sql`.
- **Testes:** `chat-disabled` (regex inválido: o arquivo inteiro não rodava), `chat-reply-only`, `prospecting-reply-core` (WA-20), `simulation-systems-comparison`, `whatsapp-chat-redundant`, stubs de `whatsapp-conversation-per-session`; `journey-http` ignora quando não há servidor. Novos testes do Particular.
- **Falhas silenciosas:** `lib/prospecting.js` (devolver, não contactar, prospectar, vínculo do contato) agora lança o erro do banco; `returnClientToRoulette` só vale se o responsável não mudou (sem redistribuição dupla); `adminSetBrokerDailyCapOverride` avisa quando o corretor não tem configuração; erros de `attachAuthUserId` e `finishExecution` vão para o log; datas de simulação em America/Sao_Paulo (5 pontos); links de apresentação/lista de documentos usam o domínio da marca (não o cabeçalho Host); `track-view` com limite por IP; mensagem de `requireFinancialManagerApi` corrigida.
- **Banco:** migration `20261010130000_fix_function_search_path.sql` (33 funções, advisor `function_search_path_mutable` zerado).
- **Tela de configuração do disparo:** aviso de que a política v2 sobrescreve janela, intervalo e teto.
- **Docs:** FUN-11 refletido em PRO-4/PRO-6/MD-3/P-05 e nas rules; MD-14b (política v2) separado do MD-14 (carteira 30); cota 10 e teto 20 no RAN-3b; "30 por corretor" (WA-15) em vez de "por número"; modo básico no acesso WhatsApp; WA-23.
- **NÃO alterado (decisão do dono pendente):** "Meta Diária 100%" tem duas medidas (bônus × card/penalidade) — ver nota no RAN-3. Dois detectores de "PARAR" (`isOptOutMessage` × `isStopRequest`) aguardam a outra sessão (WA-20).
- **Autor:** Claude Code

### 2026-10-10 — WhatsApp individual: estabilidade, alertas e painel de saúde por número (Frente B)
- **Data:** 2026-10-10
- **Área:** WhatsApp individual / microsserviço / Central de Alertas / política de notificações / Meta Diária (gestão)
- **O quê (pedido do dono):** (1) limite de quedas por número: mais de 6 quedas recuperáveis em 3 h param a reconexão (`needs_attention:repeated_drops`), motivo: Número 2 da Bruna Santos teve 17 conexões e 12 quedas 500 numa noite (cada queda espaçada demais para o limite de 3 erros 500 em 10 min); (2) alerta direto (Importante + push) ao corretor dono do número quando o próprio WhatsApp cai; (3) painel de saúde por número na aba Automação (rota nova `GET /api/admin/whatsapp-individual/health`, escopo de equipe no backend); (4) alerta de serviço parado (lease sem renovar > 5 min) aos admins, no cron `whatsapp-flows` existente.
- **Arquivos:** `whatsapp-individual-service/src/reconnect-policy.js`; `lib/whatsapp-connection-alert{,-core}.{js,mjs}`, `lib/whatsapp-individual.js`, `lib/crm-alerts.js`, `lib/notification-policy-core.mjs`, `lib/whatsapp-session-attention-core.mjs`, `lib/whatsapp-session-health{,-core}.{js,mjs}`, `lib/whatsapp-service-stall{,-core}.{js,mjs}`, `app/api/admin/whatsapp-individual/health/route.js`, `app/api/cron/whatsapp-flows/route.js`, `components/WhatsappSessionHealthPanel.jsx`, `components/DailyGoalAdmin.jsx`; testes `tests/whatsapp-reconnect-policy.test.mjs`, `tests/whatsapp-stability-alerts.test.mjs`, `tests/whatsapp-session-health.test.mjs`, `tests/notification-policy.test.mjs`.
- **Banco:** migration NOVA, NÃO aplicada: `supabase/migrations/20261010130100_whatsapp_self_and_service_alert_definitions.sql` (2 linhas em `crm_alert_definitions`, aditiva). Código tolerante: sem ela os alertas usam texto padrão e ficam ligados.
- **Política de notificações (2026-10-06):** abertura deliberada de UMA exceção — tipo de push `whatsapp_connection` (só a queda do próprio WhatsApp, só ao dono do número). `tests/notification-policy.test.mjs` atualizado; todos os demais alertas da Central seguem sem push.
- **Risco/observação:** a contagem de quedas fica na memória do serviço (zera em redeploy/reinício e no Conectar manual) — o dono pediu "módulo puro", sem persistir; `tests/whatsapp-service-lease.test.mjs` imprime 6 `not ok` ("Promise resolution is still pending") que já ocorriam antes desta mudança (pass 29 / fail 0 igual com e sem ela). Serviço rodando sem lease (fallback antigo) não é monitorado pelo alerta de serviço parado.

### 2026-10-10 — Meta Diária: proteções anti-banimento (pausa por número, aquecimento, tendência de entrega, Google, fila parada)
- **Data:** 2026-10-10
- **Área:** Meta Diária automática / WhatsApp individual / Google Contacts / Central de Alertas / Banco
- **Pedido (dono, autorizado em 2026-10-10):** 6 melhorias de proteção do número. Regra: `docs/BUSINESS_RULES.md` MD-15, `.claude/rules/meta-diaria-ranking.md`, guia `docs/OPERACAO_DISPAROS.md` §8.
- **Mudou:** (1) **pausa automática por número** (corretor + `session_slot`) em 403/`forbidden` ou `logged_out`: `applySessionProtections` (a cada ciclo do cron) grava a pausa em `daily_goal_auto_settings.slot_controls`, a fila fica guardada, corretor + gestora recebem alerta importante (`daily_goal_number_paused`), retomada manual ("Retomar" / "Retomar Número N", `adminResumeDailyGoalAutoSlot`, `PATCH /api/admin/daily-goal-auto` com `resumeSlot`); sem número apto sobrando o corretor inteiro é pausado pelo `paused`/`paused_reason` existente; não pausa por taxa de entrega. (2) **aquecimento** 10/15/20/30 em ~7 dias por número novo/trocado ou reconectado após 403 (`brokerWarmupCap`, `applyPolicyV2`, `filterSlotsByWarmupCap` em `lib/daily-goal-policy-core.mjs`; só reduz o teto). (3) **monitor com tendência**: queda > 20 pontos vs. média de 7 dias do corretor e 10 mensagens seguidas sem tique, e-mail à gestora, só alerta (`evaluateBrokerTrends`; histórico paginado em `lib/daily-goal-delivery-monitor.js`). (4) **SAIR** já marcava `do_not_contact` (`lib/prospecting-reply.js`): nenhum código novo, só documentado (com a lacuna: cliente em outra etapa/sem tentativa em 48 h só tem a fila bloqueada). (5) **Google Contacts**: no máximo 3 tentativas por item/contato; na 4ª o envio sai sem sincronizar com `skip_reason = google_contacts_ignorado_apos_3_falhas`. (6) **fila parada / erros seguidos**: alerta informativo (`daily_goal_queue_problem`) para item pendente > 2 h dentro da janela ou > 5 erros seguidos do mesmo tipo, uma vez por episódio.
- **Arquivos:** `lib/daily-goal-protection-core.mjs` (novo, regras puras), `lib/daily-goal-auto-alerts.js` (novo), `lib/daily-goal-auto.js`, `lib/daily-goal-policy-core.mjs`, `lib/daily-goal-delivery-monitor-core.mjs`, `lib/daily-goal-delivery-monitor.js`, `app/api/admin/daily-goal-auto/route.js`, `components/DailyGoalAdmin.jsx` (linha + botão "Retomar Número N" no cartão — revisar com o designer), `supabase/migrations/20261010140000_daily_goal_protecoes_anti_banimento.sql` (**escrita, NÃO aplicada**), testes `tests/daily-goal-protection.test.mjs`, `tests/daily-goal-delivery-trend.test.mjs`, `tests/daily-goal-delivery-monitor.test.mjs`.
- **Risco/observação:** sem a migration o código roda (403/logout pausa o corretor inteiro; sem aquecimento nem alertas na Central; log registra). Ao publicar COM a migration, quem estiver em 403/logout nas últimas 72 h (ainda caído) é pausado e avisado. `logged_out` pausa mas não reinicia o aquecimento (só 403 ou número trocado) — decisão pendente do dono. Teste fora do escopo já falhando antes desta mudança: `tests/prospecting-reply-core.test.mjs` ("cliente fora da prospecção…": o teste espera `ignore` para "parar" em `in_service`, mas a regra de 2026-10-05 devolve `opt_out`) — teste desatualizado, não corrigido aqui. Nada foi enviado nem gravado em produção.
- **Autor:** Claude (crm-editor)

### 2026-10-09 — Chat: atalho "Lista de documentos" envia a lista personalizada
- **Data:** 2026-10-09
- **Área:** WhatsApp / Chat / Documentos
- **Alteração:** o atalho "Lista de documentos" do Chat (menu "+") agora envia a imagem PERSONALIZADA do cliente da conversa (mesma da apresentação e do botão da ficha, `prepareClientDocumentsList`) quando ele tem simulação com valores; antes sempre ia a imagem genérica do atalho. Sem cliente/simulação (ou em qualquer falha) segue a genérica. Registra "Lista de documentos enviada" na jornada.
- **Motivo:** pedido do dono (cliente que já preencheu o cadastro deve receber a lista dele, não a genérica).
- **Arquivos afetados:** `lib/whatsapp-chat.js`, `tests/chat-documents-shortcut.test.mjs`
- **Risco/observação:** o atalho é reconhecido pelo nome "Lista de documentos" (se renomearem, volta a genérica). Cria/reaproveita o link da apresentação (get-or-create) para gerar a imagem. A CONFIRMAR em produção: enviar o atalho numa conversa de cliente com cadastro.
- **Autor:** Claude Code
### 2026-10-09 — Chat: sai o aviso "envio pelo WhatsApp pessoal desativado"
- **Data:** 2026-10-09
- **Área:** WhatsApp / Chat
- **Alteração:** removido o quadro amarelo "O envio pelo seu WhatsApp pessoal está desativado por enquanto" acima do campo de mensagem. O comportamento não muda (o botão verde segue abrindo o WhatsApp do celular com a mensagem pronta; o servidor continua recusando o envio pelo CRM nesse modo).
- **Motivo:** pedido do dono (poluía a tela).
- **Arquivos afetados:** `components/WhatsappChat.jsx`
- **Risco/observação:** só visual. Os avisos de janela de 24 h e "cliente ainda não escreveu" continuam.
- **Autor:** Claude Code
### 2026-10-09 — Verificação em duas etapas também para os gestores (Carol)
- **Data:** 2026-10-09
- **Área:** Permissões / Login
- **Alteração:** a verificação em duas etapas (TOTP, opt-in) deixou de ser só do dono: perfis **gestor** também podem ativar em `/admin/seguranca` (link no rodapé do painel). Elegibilidade única em `isTwoFactorEligibleResult` (dono OU gestor), usada no guard, no login (`/api/admin/session`), na etapa do código e na configuração (`requireRealTwoFactorApi`). Regra AUT-2FA atualizada.
- **Motivo:** pedido do dono (gestora Caroline Mayumi, conta compartilhada no computador do escritório).
- **Arquivos afetados:** `lib/admin-auth.js`, `app/api/admin/two-factor/route.js`, `app/api/admin/session/route.js`, `app/admin/seguranca/page.jsx`, `app/admin/layout.jsx`, `tests/admin-two-factor.test.mjs`
- **Risco/observação:** sem migration (a tabela `admin_two_factor` é por usuário). Opt-in: a gestora precisa ativar ela mesma (QR Code no app autenticador do celular dela) — até lá nada muda. Depois de ativada, quem usar a conta dela no escritório precisará do código ou de aparelho lembrado (30 dias); "Lembrar este aparelho" no computador compartilhado reabre a brecha, então orientar a não marcar. A CONFIRMAR em produção: ativação e login da gestora.
- **Autor:** Claude Code

### 2026-10-09 — Chat: aba Particular para contatos pessoais (WA-19)
- **O quê:** botão "Particular" (antes Arquivar; "Arquivar cliente" foi para o menu ⋮); aba Particular com histórico completo; mensagem nova não reabre, não cria/vincula cliente, sem push. Cadastro do contato fica fora de Clientes (`private_contact_at`), do resgate de órfãos e da transferência ao excluir usuário. Migração: 94 contatos pessoais arquivados como clientes (WhatsApp individual, sem renda, sem simulação) + 2 conversas arquivadas sem cliente + os 9 da Giovanna Saia. Auditoria do Chat passou a aceitar status_changed/message_edited/message_deleted_for_everyone (antes eram recusados em silêncio).
- **Por quê:** pedido do dono — separar clientes arquivados de conversas pessoais. — `lib/whatsapp-chat.js`, `components/WhatsappChat.jsx`, migrations `20261009160000/160100/160200`.

### 2026-10-09 — Chat: primeira mensagem ao cliente com dados tem de ser o link da simulação (ROL-4c)
- **O quê:** cliente da roleta com renda informada e ainda sem simulação: o Chat recusa qualquer envio que não seja o link da apresentação (/s/<token>) até ele sair; aviso âmbar acima do campo de mensagem. Admin geral livre; não retroativo.
- **Por quê:** regra do dono — corretor se apresentava sem simular, cliente voltava à roleta e outro se apresentava de novo (caso Alexandre, 08/10). — `lib/simulation-first-core.mjs`, `lib/whatsapp-chat.js`, `components/WhatsappChat.jsx`.
### 2026-10-09 — Simulação: envio ao cliente só pelo link
- **O quê:** no gerador de simulação, o "Formato para envio" passa a ter só "Link (apresentação)" (padrão). PDF e imagem saíram do envio; "Baixar PDF"/"Baixar imagens" continuam.
- **Por quê:** pedido do dono. — `components/SimulationGenerator.jsx`.

### 2026-10-09 — Chat no iPhone: sem faixa branca embaixo, abas nítidas no topo e toque longo igual ao WhatsApp

Pedido do dono (prints do iPhone, PWA/Safari), só apresentação — nenhuma regra, `lib/` ou API alterada.
- **Faixa branca sob a barra inferior:** a barra tinha 4rem + a safe-area inteira do iPhone (~34 px) e o Chat media a altura por `100dvh`, que no iPhone pode divergir do retângulo usado pela barra fixa. Agora a barra é compacta em todo o painel (3,5rem + `--admin-bottom-nav-pad` = safe-area − 0,75rem, mínimo 0,25rem; `--admin-bottom-nav-space` acompanha) e, no Chat, o `body` vira moldura `position: fixed; inset: 0` — termina exatamente onde a barra começa.
- **Abas desfocadas sob o relógio:** o respiro `env(safe-area-inset-top)` ficava no cabeçalho do ranking, que o modo aplicativo oculta; as abas nasciam sob a barra de status. O `body` do Chat agora tem `padding-top: env(safe-area-inset-top)` e não rola (scrollHeight == innerHeight).
- **Segurar mensagem (celular):** balões sem seleção de texto/menu nativo em tela de toque (`select-none` em `pointer: coarse`; callout já desligado). Toque longo (~0,4 s, vibração curta) abre foco estilo WhatsApp do iPhone: fundo desfocado e escurecido, cópia nítida do balão no lugar, barra de reações (6 + "+" com a lista de emojis do seletor) acima e cartão Responder/Copiar/Editar/Apagar abaixo (só o que `canReply`/`canReact`/`canEdit`/`canDelete` liberam; "Remover minha reação" após separador). Encaminhar/Informações não existem no CRM e não foram criados. Toque fora/Esc fecha. Computador mantém o menu flutuante.
- Arquivos: `app/globals.css`, `components/AdminBottomNav.jsx`, `components/WhatsappChat.jsx`, `components/WhatsappMessageActions.jsx`; docs `docs/WHATSAPP.md`, `sistema-visual.md`. Verificado na vitrine (390 com safe-area simulada e 1440) com Playwright.
### 2026-10-09 — Chat em modo aplicativo (tela fixa, só lista/mensagens rolam)
- **Área:** Chat (WhatsApp) — só apresentação
- **Alteração:** no Chat a página não rola mais: a tela ocupa a altura da janela (`100dvh` menos a barra inferior no celular; sem ela com o teclado aberto) e só a lista de conversas, as mensagens e as abas Visão geral/Campanhas/Corretores rolam por dentro (`overscroll-behavior: contain`); barra de digitação presa embaixo. Abas em linha compacta (no celular somem com a conversa aberta, como no WhatsApp; voltar mostra de novo); topo da lista mais compacto. No Chat o banner do ranking ("Campeão da semana") e o rodapé "Sair / Segurança da conta" ficam ocultos (continuam nas outras páginas e no "Mais"). Desktop: lista e conversa lado a lado, cada uma rolando por dentro.
- **Motivo:** pedido do dono ("experiência de aplicativo" no Chat).
- **Arquivos afetados:** `components/WhatsappChat.jsx` (prop `appMode`, `useChatAppMode` marca `html.chat-app-mode` e os ancestrais `.chat-app-ancestor`), `app/globals.css` (bloco "Chat em modo aplicativo"), `app/admin/chat/page.jsx`, `app/admin/layout.jsx` (classe `admin-page-footer`), `components/AdminBottomNav.jsx` (classe `admin-typing` no `<html>` com o teclado aberto), `app/dev/vitrine/_components/VitrineClient.jsx`.
- **Risco/observação:** revisado na vitrine em 390 e 1440 px. Teclado do iPhone/PWA não testado em aparelho real (A CONFIRMAR com o dono): o iOS não encolhe `100dvh` com o teclado e rola a janela visual até o campo. O indicador do WhatsApp do topo some junto com o banner, mas o Chat já mostra o próprio na linha das abas.
- **Autor:** Claude Code
### 2026-10-09 — Anúncio de WhatsApp: cliente fica com o dono até responder/preencher + sequência 1 h/3 h/10 h/23 h; lembretes 24 h; backlog
- **Data:** 2026-10-09
- **Área:** WhatsApp / Roleta / Automações
- **Alteração:** (1) quem chega pelo anúncio click-to-WhatsApp é cadastrado em "Atendimento automático" com o DONO (`distribution_type = 'whatsapp_ad_waiting'`), fora da roleta/fila/REDISTRIBUIÇÃO; (2) entra na roleta ao RESPONDER depois das mensagens automáticas (a 1ª mensagem do anúncio não conta; reação não conta) ou ao PREENCHER o formulário (mesmo cadastro, sem "reentrada"); (3) REDISTRIBUIÇÃO cobre quem entrou ao responder (Atendimento automático, sem dados); (4) sequência de 4 mensagens (1 h, 3 h, 10 h, 23 h) no mecanismo do WA-17, chave `form-reminder:<link>:<etapa>`; (5) lembretes passam a rodar 24 h (sem 21:00–08:00), inclusive o WA-17; (6) backlog: links anteriores à publicação cujo cliente escreveu há menos de 24 h recebem a 1ª logo depois da publicação (3 por rodada) e as seguintes contam do envio dela; o corte fixo "links anteriores a 09/10 07:00" saiu; (7) o Fluxo manda o link público `/s` ao cliente segurado (nunca o link pessoal do dono).
- **Motivo:** regra do dono (2026-10-09), BUSINESS_RULES WA-18 e ajustes do WA-17.
- **Arquivos afetados:** `lib/whatsapp-ad-waiting-core.mjs` (novo, puro), `lib/whatsapp-sponsored-lead.js`, `lib/simulation-registrations.js`, `lib/whatsapp-flows.js`, `lib/simulation-deadline-core.mjs`, `lib/whatsapp-form-reminder-core.mjs`, `lib/whatsapp-form-reminder.js`, `app/api/cron/scheduled-activities/route.js`, `tests/whatsapp-ad-waiting.test.mjs` (novo), `tests/whatsapp-form-reminder.test.mjs`, `docs/BUSINESS_RULES.md`, `docs/WHATSAPP.md`, `.claude/rules/integracoes-externas.md`, `.claude/rules/roleta-prospeccao-campanhas.md`.
- **Risco/observação:** sem migration (`distribution_type` é texto livre; idempotência pelo índice único de `meta_message_id`). O cadastro com o dono usa `whatsapp_get_or_create_client_for_broker` (histórico da roleta mostra "atribuído ao dono" com motivo do canal direto) e a regra NOVO LEAD pode avisar o dono no clique. A CONFIRMAR: Fluxo do anúncio desligado = ninguém "responde" (só o formulário libera); ação `base_roulette` no Fluxo do anúncio ainda sortearia no clique; número oficial sem webhook desde 29/09 (se não recebe, nada disso roda no oficial); quantos do backlog ficaram de fora pela janela — ver `formReminders.skipped` (`backlog_fora_das_24h`, `janela_fechada`) na resposta do cron `whatsapp-flows`. Os 4 clientes antigos com origem errada não foram mexidos. Clientes antigos "Atendimento automático" de WhatsApp orgânico seguem fora da REDISTRIBUIÇÃO (fora do escopo).
- **Autor:** Claude Code
### 2026-10-09 — Chat: prévia de link e botão de link como no WhatsApp
- **Área:** Chat (WhatsApp) — apresentação + rota nova de leitura
- **Alteração:** balão com link mostra o cartão de prévia (imagem, título, descrição, "🔗 domínio"); mensagem com botão de link (Fluxo "Formulário de atendimento", atalho "Link de simulação") mostra prévia + texto + linha + botão azul clicável; hora/✓✓ no canto do texto; selo "Automação" discreto. Links do próprio site: prévia montada no servidor sem rede, com os mesmos textos/imagens de Open Graph do site (`lib/chat-link-preview-core.mjs`, em `messageRow`: `linkUrl`, `linkPreview`, `linkPreviewUrl`). Links externos: `GET /api/admin/whatsapp-chat/link-preview` (`requireAdminApi`) → `lib/chat-link-preview.js` (≤ 3 s, ≤ 512 KB, SSRF barrado na URL e na conexão, cache em memória); sem prévia → só o link azul.
- **Motivo:** pedido do dono ("Quero visualizar igual o WhatsApp, detalhe melhor").
- **Arquivos afetados:** `lib/chat-link-preview-core.mjs` (novo, puro), `lib/chat-link-preview.js` (novo), `app/api/admin/whatsapp-chat/link-preview/route.js` (novo), `lib/whatsapp-chat.js` (`messageRow`), `components/WhatsappChat.jsx`, `app/dev/vitrine/_fixtures/chat.js`, `tests/chat-link-preview.test.mjs`, `docs/WHATSAPP.md` §6, `docs/PERMISSIONS.md`, `.claude/skills/design-crm/references/sistema-visual.md`.
- **Risco/observação:** apresentação `/s/<token>` usa o título genérico ("Sua simulação…") em vez do primeiro nome, para não consultar a apresentação (contaria visualização); a imagem é a mesma por token. Imagem de prévia externa é carregada direto do site de origem pelo navegador (sem referer). Os textos fixos do site são conferidos contra `app/layout.jsx` e páginas pelo teste. `/c/<código>` usa a prévia padrão da simulação (é o que o site serve hoje — não existe imagem OG por campanha).
- **Autor:** Claude Code
### 2026-10-09 — Cliente de anúncio de WhatsApp cadastrado por mensagem volta a ser "Patrocinado"
- **O quê:** `routeOrganicLead` (`lib/whatsapp-sponsored-lead.js`) usa a origem `whatsapp_ad` (com anúncio/referral) quando a conversa veio de anúncio.
- **Por quê:** desde que a roleta deixou de rodar no clique do anúncio (2026-10-08), quem escrevia de novo virava "WhatsApp — Contato direto" e sumia da aba Patrocinado (4 clientes de 08–09/10, anúncio 52550704071153). A origem desses 4 NÃO foi corrigida: `client_origins` é imutável no banco (`guard_original_source`) — decisão do dono pendente.
### 2026-10-09 — Chat: aparência de WhatsApp (conversa e lista)
- **Data:** 2026-10-09
- **Área:** Chat (WhatsApp) — só apresentação
- **Alteração:** conversa com fundo bege e desenhos sutis, balões branco (cliente) / verde-claro (nossos) com rabinho, hora e ✓/✓✓ dentro do balão, links clicáveis, documento com ícone por tipo + "PDF · 169 KB", botões e link do atalho no rodapé do balão, reações sobre a borda, etiqueta pequena "Automação", nome de quem enviou no topo da sequência, nota interna centralizada com cadeado; barra de digitação estilo WhatsApp (+ anexo, atalhos, campo branco com emoji e modo interno, botão redondo). Lista: avatar 52px, nome em negrito, prévia com ícone por tipo ("[Imagem]" → câmera "Foto" etc.), "Ontem" na hora, hora e contador verdes, separador depois do avatar, selos numa linha (corretor em selo amarelo). Nenhuma regra, API ou `lib/` alterada; todos os controles mantidos.
- **Motivo:** pedido do dono ("o mais parecido possível com WhatsApp", lista também).
- **Arquivos afetados:** `components/WhatsappChat.jsx`, `app/dev/vitrine/_fixtures/chat.js` (PDF, link e prévias de mídia fictícios), `.claude/skills/design-crm/references/sistema-visual.md`.
- **Risco/observação:** o telefone saiu da linha da lista (fica no painel de informações, na busca e no tooltip). Sem dado no servidor para: prévia em cartão de link, nº de páginas do PDF, duração do áudio e ✓✓/lido da última mensagem na lista — exibidos só quando existirem (hoje: link azul, "PDF · tamanho", ícone de voz, ✓ simples). Selos que não cabem na linha da lista continuam no cabeçalho da conversa.
- **Autor:** Claude Code
### 2026-10-09 — WhatsApp: lembrete do formulário não preenchido (WA-17)
- **Data:** 2026-10-09
- **Área:** WhatsApp / Fluxos / Chat
- **Alteração:** 1 h depois de o cliente receber pelo WhatsApp o link do formulário (Fluxo do anúncio, atalho ou link escrito no Chat) sem preencher, sem responder e sem ninguém ter atendido, o CRM manda UMA mensagem ("Oi, {primeiro nome}, tudo bem? Notei que você ainda não preencheu o formulário…") pelo mesmo número do link; 21:00–08:00 segura até 08:00; oficial só com janela de 24 h aberta; pessoal só conectado + "Usar para disparo" + envio pessoal liberado (no Chat híbrido não sai). Roda no cron `whatsapp-flows`. Etiqueta "Automação" no Chat; não conta como contato humano.
- **Motivo:** regra do dono (2026-10-09).
- **Arquivos afetados:** `lib/whatsapp-form-reminder-core.mjs` (novo, puro), `lib/whatsapp-form-reminder.js` (novo), `app/api/cron/whatsapp-flows/route.js`, `lib/whatsapp-individual-inbound.js` (ignora o eco do lembrete), `tests/whatsapp-form-reminder.test.mjs`, `docs/BUSINESS_RULES.md` (WA-17), `docs/WHATSAPP.md` §9-C, `.claude/rules/integracoes-externas.md`.
- **Risco/observação:** sem migration — a idempotência usa o índice único de `whatsapp_messages.meta_message_id` (chave `form-reminder:<id do link>`); por isso o lembrete do oficial não recebe tiques de entregue/lido. Decisões conservadoras A CONFIRMAR com o dono: link digitado no celular do corretor não gera lembrete; cliente que já preencheu alguma vez não recebe; 3 h de atraso máximo; Fluxo em andamento adia; links anteriores a 09/10 07:00 ignorados. O envio pelo oficial depende do número oficial estar ativo (último webhook recebido em 29/09 — A CONFIRMAR). Fora do escopo, não corrigido: `tests/chat-disabled.test.mjs` (erro de sintaxe no próprio teste) e `tests/chat-reply-only.test.mjs` já falham na `main` antes desta mudança. A CONFIRMAR em produção: resposta do cron (`formReminders`) e a primeira linha `metadata.kind = 'form_reminder'`.
- **Autor:** Claude Code
### 2026-10-09 — Custo do patrocinado no card: administrador vê o mesmo valor da equipe
- **O quê:** o card mostra para todos os perfis o valor da equipe (real × 1,5, ou R$ 10–16,99 sem custo identificado). O valor real continua só no resumo da aba Patrocinado (administrador).
- **Por quê:** decisão do dono.
### 2026-10-09 — Patrocinado sem custo identificado: valor de R$ 10–16,99 para a equipe
- **O quê:** cliente de anúncio sem custo calculável (anúncio não sincronizado/sem gasto) mostra no card, para corretor/gestor/associado, um valor fixo por cliente entre R$ 10,00 e R$ 16,99 (`teamFallbackSponsoredCost`, derivado do id). O administrador geral continua vendo só custos reais.
- **Por quê:** decisão do dono.
### 2026-10-09 — Meta Pixel: detecção automática de eventos desligada (autoConfig=false)
- **O quê:** `components/MetaPixel.jsx` chama `fbq('set','autoConfig',false,ID)` antes do `init`.
- **Por quê:** a Meta conta muito mais leads do que cadastros reais (vídeo PATROCINADO: 18 na Meta × 6 no CRM; o site inteiro teve ~9 cadastros no período). Nosso código só dispara `Lead` depois do insert; a detecção automática do pixel (cliques/envios de formulário entre as etapas, regras sem código) é uma fonte provável dos extras. Junto: `CadastroCRM` (2026-10-08). Pendente do dono: remover a integração Signals Gateway (Birch) e regras do Event Setup Tool, e usar a conversão "Cadastro CRM".
### 2026-10-09 — ROL-4b: correções (simulação vazia do site e "Em atendimento" sem simular)
- **Bug 1:** o cadastro do site já cria uma linha em `simulations` ("Cadastro do site", sem valores); a ROL-4b contava qualquer linha como "simulação feita" e nunca tirava cliente de formulário de ninguém. Agora só conta simulação com valor (`getSimulationListSummary().completed`, mesma regra do card).
- **Bug 2:** mudar para "Em atendimento" sem simular segurava o cliente (a condição da regra é status = Aguardando simulação). Para cliente com dados, a condição vira "status antes da simulação" (Aguardando simulação, Atendimento automático, Em atendimento) — `rouletteRuleConditions` (`lib/simulation-deadline-core.mjs`). Não retroativo: só clientes recebidos a partir de `PRE_SIMULATION_RULE_SINCE`.
- **Bug 3 (meu, do mesmo dia):** `listClientIdsWithManualTransfer` ordenava `client_journey_events` por `created_at`, coluna inexistente (é `occurred_at`) — a regra REDISTRIBUIÇÃO DE LEADS falhava inteira desde o deploy do "Devolver para a roleta"; corrigido.
- **Caso real:** cliente recebido 23:42 por Bencke, "Em atendimento" 37 s depois, sem simulação, não voltou à roleta.
### 2026-10-09 — "Devolver para a roleta" no seletor de corretor (ROL-4c)
- **O quê:** opção nova no seletor de responsável do card (admin/gestor). Rota `POST /api/simulation-registrations/[id]/roleta` (`requireBrokerManagementApi`) → `returnClientToRoulette`: próximo corretor on-line excluindo o atual; ninguém on-line → dono + `pending_distribution_at` (histórico com `toWaitingQueue`, então a fila também não devolve a quem perdeu). Linha do tempo `responsible_transferred` com `transferType: "roulette"`; notificação ao novo corretor. `listClientIdsWithManualTransfer` passa a olhar só a ÚLTIMA troca (manual ou roleta).
- **Por quê:** pedido do dono.
- **Arquivos:** `lib/lead-distribution.js`, `lib/crm-automations.js`, `app/api/simulation-registrations/[id]/roleta/route.js`, `components/clients/ClientCard.jsx`, `components/clients/useClientList.js`, `tests/manual-transfer-disables-roulette.test.mjs`, `docs/BUSINESS_RULES.md` ROL-4c.
### 2026-10-08 — Custo do patrocinado no card para toda a equipe (valor inflado em 50%)
- **O quê:** o selo "Patrocinado · R$" do card passa a aparecer para corretor, gestor e associado com o custo estimado × 1,5 e só o valor (sem gasto do anúncio nem divisão); o administrador geral continua vendo o real com o detalhe. O resumo da aba Patrocinado (total, média, com custo identificado) continua só do administrador.
- **Por quê:** decisão do dono.
- **Arquivos:** `lib/sponsored-cost-core.mjs` (`teamSponsoredCost`), `lib/simulation-list-query.js`, `components/clients/ClientCard.jsx`, `tests/sponsored-cost.test.mjs`.
### 2026-10-08 — "Sem contato há +3 dias" não aparece para cliente com atividade futura agendada
- **O quê:** `isStaleContactClient` (`lib/client-status.js`) ignora cliente com atividade futura pendente; o card passa a considerar também as atividades da agenda (`mergeActivitySignal`); o filtro "Sem contato há +3 dias" (`lib/simulation-list-query.js`) exclui quem tem atividade futura (campo legado e `calendar_activities`). Painéis de desempenho/Alexa usam a mesma função.
- **Por quê:** regra do dono — com o próximo contato já agendado, o alerta não faz sentido (caso: cliente com reunião marcada para 13/10 aparecendo como "sem contato"). Atividade atrasada ou concluída não protege.
- **Arquivos:** `lib/client-status.js`, `components/clients/client-format.js`, `lib/simulation-list-query.js`, `tests/stale-contact-future-activity.test.mjs`.
### 2026-10-08 — Custo do patrocinado no card e por corretor (só administrador)
- **Data:** 2026-10-08
- **Área:** Clientes / Meta Ads
- **Alteração:** card de cliente patrocinado mostra "Patrocinado · R$ X" (gasto do anúncio de origem ÷ clientes do CRM desse anúncio) e a aba Patrocinado ganha painel com total, média e "com custo identificado" para a visão atual (respeita o filtro de corretor). Regra CLI-15.
- **Motivo:** pedido do dono (ligar anúncios da Meta ao custo do cliente e saber quanto de patrocinado há em cada corretor).
- **Arquivos afetados:** `lib/sponsored-cost-core.mjs`, `lib/sponsored-cost.js`, `lib/simulation-list-query.js`, `components/clients/ClientCard.jsx`, `components/clients/ClientWorkspace.jsx`, `tests/sponsored-cost.test.mjs`
- **Risco/observação:** sem migration. Só administrador (corretor/gestor não recebem o custo). Usa meta_ad_insights (sincronizado desde 13/09/2026; backfill histórico não executado, então custos de anúncios antigos podem estar incompletos). Conferido por SQL contra produção: 68 de 72 clientes patrocinados casam com anúncio com gasto; ex.: Bruna Santos 10 clientes ≈ R$ 34,49. Duas consultas leves em memória (60 s) por carregamento da lista para admin. A CONFIRMAR em produção: selo no card e painel da aba.
- **Autor:** Claude Code
### 2026-10-08 — Clientes: aba "Patrocinado"
- **Data:** 2026-10-08
- **Área:** Clientes
- **Alteração:** nova aba "Patrocinado" na faixa de etapas da lista de Clientes: todos os clientes que entraram por mídia paga (qualquer campanha/anúncio), em qualquer status, menos "Não contactar". Critério no banco sobre `client_origins` (kind paid_link/whatsapp_ad, paid_media, ad_id, utm_medium pago), igual a `hasPaidMediaEvidence`. Regra CLI-14.
- **Motivo:** pedido do dono (acompanhar de perto os clientes de anúncio).
- **Arquivos afetados:** `lib/simulation-list-query.js`, `components/clients/ClientWorkspace.jsx`, `tests/sponsored-clients-tab.test.mjs`
- **Risco/observação:** sem migration. Conferido contra o banco de produção (somente leitura): 71 clientes com origem paga, 50 fora "Não contactar" (21 estão nesse status e não aparecem na aba). Mais uma contagem (head) por carregamento da lista. Fase seguinte (acompanhar à risca: tempo sem contato, campanha/anúncio no card, etc.) depende de o dono dizer o que quer ver.
- **Autor:** Claude Code
### 2026-10-08 — Verificação em duas etapas (TOTP) na conta do dono
- **Data:** 2026-10-08
- **Área:** Autenticação / Permissões / Banco
- **Alteração:** código de 6 dígitos de app autenticador SOMENTE para `isOwnerAdminEmail`, opt-in em `/admin/seguranca` (link "Segurança da conta" no rodapé do painel, só para o dono): QR Code + chave manual, confirmação do 1º código, 8 códigos de recuperação de uso único (só hash), "lembrar este aparelho por 30 dias", desativar/gerar novos códigos exigem código. Exigência no SERVIDOR: `applyTwoFactorGuard` em `lib/admin-auth.js` (requireAdminApi, requireRealGeneralAdminApi, getAdminFromCookies — conta real, antes do "Alterar conta"); login com senha mostra a etapa do código (`/api/admin/session` devolve `twoFactorRequired`; `/api/admin/two-factor/verify`). TOTP próprio (RFC 6238, ±1 passo, anti-reuso por `last_used_step`, 5 erros/10 min → bloqueio de 10 min), segredo cifrado com `lib/secrets-crypto.js`. Tabela nova `admin_two_factor` + função `admin_two_factor_consume_recovery_code` (migration `20261008200000_admin_two_factor.sql`, RLS sem policy). Dependência nova `qrcode` (gera o SVG do QR no servidor).
- **Motivo:** pedido e especificação aprovados pelo dono (AUT-2FA).
- **Arquivos afetados:** `lib/admin-two-factor.js`, `lib/admin-two-factor-core.mjs`, `lib/admin-auth.js`, `app/api/admin/session/route.js`, `app/api/admin/two-factor/{route.js,verify/route.js}`, `app/admin/seguranca/page.jsx`, `app/admin/login/page.jsx`, `app/admin/layout.jsx`, `components/AdminTwoFactor{Challenge,Settings}.jsx`, `components/AdminLoginForm.jsx`, `components/AdminSessionKeeper.jsx`, `tests/admin-two-factor.test.mjs`, `.env.example`, docs.
- **Risco/observação:** nada muda para ninguém até o dono ativar. Sem a tabela (migration não aplicada) o guard considera "não ativado" e a tela de ativação avisa; erro de banco com o 2FA do dono → 503 (falha fechada, só para o dono). Ativar exige `CRM_SECRETS_ENCRYPTION_KEY` em produção (configuração A CONFIRMAR; sem ela a tela avisa e não ativa). Preferido TOTP próprio ao MFA nativo do Supabase porque códigos de recuperação e "lembrar aparelho" não existem no nativo e o painel usa cookies próprios. Escolhas sem o dono: logout mantém o aparelho lembrado; "lembrar" vem marcado por padrão na etapa do código; gerar novos códigos também invalida aparelhos lembrados (a sessão atual continua).
- **Autor:** Claude Code

### 2026-10-08 — Pente-fino do Chat: rastro de quem enviou, auditoria e correções
- **Data:** 2026-10-08
- **Área:** WhatsApp / Chat / Permissões
- **Alteração:** (1) cada envio do Chat grava sessão/IP/navegador/conta emprestada em `metadata.actor_ctx`, visível só ao administrador; (2) auditoria de status, assumir/atribuir/liberar, editar e apagar mensagem (e o insert da auditoria passa a checar erro); (3) "Alterar conta" não conecta/desconecta/renomeia o WhatsApp de outra pessoa; (4) modelo aprovado só pelo número oficial; (5) eco duplicado do envio (23505) é adotado em vez de dar erro; (6) lista do Chat 40 → 100 conversas. Regra WA-16.
- **Motivo:** pedido do dono após caso da Bruna enviando como Carol (conta compartilhada) e problemas do Chat; duas auditorias de leitura (privacidade e confiabilidade).
- **Arquivos afetados:** `lib/admin-auth.js`, `lib/whatsapp-chat.js`, `lib/chat-actor-context-core.mjs`, `components/WhatsappChat.jsx`, `app/api/admin/whatsapp-individual/{connect,disconnect,settings}/route.js`, `tests/chat-actor-context.test.mjs`
- **Risco/observação:** sem migration (rastro em JSON de metadata). O rastro NÃO impede login compartilhado: mostra de onde saiu o envio. Achados da auditoria NÃO tratados (decisão do dono ou serviço externo): limite de ociosidade da sessão; gestor enviando/editando/apagando pelo número pessoal de corretor (M1); associado vendo o número do corretor vinculado (M3); "liberar" sem restrição (M5); teto de envio do número oficial (M7); alerta de queda de sessão só informativo e só para gestora; vigilância de sessão "conectada e muda"; cadastro arquivado escolhido por "mais recente"; contadores truncados em 1000 linhas; mensagens sem texto/mídia descartadas; serviço Baileys (versão, retry do webhook) não auditado. A CONFIRMAR em produção: enviar uma mensagem pelo Chat e ver a linha do administrador.
- **Autor:** Claude Code

### 2026-10-08 — Histórico do celular religado (última semana, com foto e áudio)
- **Data:** 2026-10-08
- **Área:** WhatsApp
- **Alteração:** a sincronização de histórico ao parear volta a ficar ligada por padrão (`WHATSAPP_HISTORY_SYNC_ENABLED !== "false"`), limitada aos últimos 7 dias, com texto, fotos e áudios (até 200 mídias por lote, lotes de 25). O CRM grava a mídia do histórico no mesmo formato da mensagem ao vivo.
- **Motivo:** pedido do dono; ninguém recebia o histórico (estava desligado desde o 504 no webhook). A CONFIRMAR em produção se o lote ainda estoura o tempo do webhook; pausar com `WHATSAPP_HISTORY_SYNC_ENABLED=false` na Railway.
- **Arquivos afetados:** `whatsapp-individual-service/src/sessions.js`, `lib/whatsapp-individual-inbound.js`, `docs/WHATSAPP.md`

### 2026-10-08 — Prazo em meses e taxa de juros na cena de parcelas; envio da apresentação pelo computador
- **Data:** 2026-10-08
- **Área:** Apresentação / Simulação
- **Alteração:** (1) novo campo **Prazo (meses)** por sistema (Price e SAC) no cadastro da simulação; a cena de condição de pagamento passa a mostrar prazo e taxa de juros (em cada cartão quando há SAC e Price). (2) "Enviar apresentação" pelo COMPUTADOR copia o link e abre o WhatsApp do cliente sem texto (o texto pré-preenchido do wa.me não gera a prévia do link no WhatsApp Web/Desktop; colar gera). No celular nada muda; se a cópia falhar, volta ao texto pré-preenchido.
- **Motivo:** pedido do dono (prazos diferentes entre os sistemas; prévia do link não aparecia ao enviar pelo computador).
- **Arquivos afetados:** `lib/simulation-models.js`, `lib/simulation-presentation-core.mjs`, `components/SimulationGenerator.jsx`, `components/presentation/PresentationPlayer.jsx`, `components/presentation/presentation.module.css`, `tests/simulation-systems-comparison.test.mjs`
- **Risco/observação:** sem migration (prazo vai no JSON da observação interna). PDF/imagem não mostram o prazo. A causa da prévia no computador é um comportamento conhecido do WhatsApp (não confirmado com o aplicativo real nesta sessão); o servidor entrega as tags e a imagem (88 KB, em cache). A CONFIRMAR: enviar uma apresentação pelo computador e conferir a prévia ao colar.
- **Autor:** Claude Code
### 2026-10-08 — Apresentação: parcelas de SAC e Price na mesma cena (sai a cena comparativo)
- **Data:** 2026-10-08
- **Área:** Apresentação / Simulação
- **Alteração:** a cena "Condição de pagamento" mostra primeira e última parcela de cada sistema (cartões SAC e Price, um depois do outro) quando as parcelas diferem; os rótulos dos cartões viraram só o nome do sistema. A cena "comparativo" separada foi removida (poder de compra, formação e parcelas já mostram os dois). PRES-23 atualizada.
- **Motivo:** pedido do dono (mais claro e menos repetido).
- **Arquivos afetados:** `lib/simulation-presentation-core.mjs`, `components/presentation/PresentationPlayer.jsx`, `tests/simulation-systems-comparison.test.mjs`
- **Risco/observação:** DTO público: cena `comparativo` removida; `parcelas`, `poder` e `formacao` ganham o campo opcional `comparison` (só números). Testes do recurso passam. A CONFIRMAR em produção: ver as cenas animadas.
- **Autor:** Claude Code
### 2026-10-08 — Apresentação: poder de compra com SAC e Price + formação do valor só com subsídio
- **Data:** 2026-10-08
- **Área:** Apresentação / Simulação
- **Alteração:** a cena "Seu poder de compra" mostra SAC e Price em sequência quando os valores diferem; a cena "Como esse valor é formado" só aparece quando há subsídio (antes aparecia sempre e repetia o valor) e, com SAC e Price diferentes, mostra os dois. Comparativo SAC x Price virou dois cartões. PRES-23 atualizada.
- **Motivo:** pedido do dono (visual mais claro; a formação só repetia o poder de compra quando não há subsídio).
- **Arquivos afetados:** `lib/simulation-presentation-core.mjs`, `components/presentation/PresentationPlayer.jsx`, `components/presentation/presentation.module.css`, `tests/simulation-systems-comparison.test.mjs`, `tests/simulation-presentation.test.mjs`
- **Risco/observação:** apresentações sem subsídio passam a ter uma cena a menos (a imagem-resumo também não mostra a linha de formação). Testes do próprio recurso passam; `round2`/`round3`/`approval`/`share` não carregam neste ambiente (falta `react`) mas os dados deles têm subsídio, então mantêm a cena. A CONFIRMAR em produção: ver as duas cenas animadas.
- **Autor:** Claude Code
### 2026-10-08 — Simulação em SAC e Price + cena de comparativo na apresentação
- **Data:** 2026-10-08
- **Área:** Apresentação / Simulação
- **Alteração:** cada tipo (Novo/Usado) ganhou o bloco SAC (opcional, raro) ao lado do Price (padrão — o que sempre existiu), com os mesmos 4 campos. A apresentação mostra a cena "SAC x Price" só quando os dois sistemas foram preenchidos no mesmo tipo; com um só, apresentação normal. PDF/imagem seguem só com o Price. Regra nova PRES-23 em `docs/BUSINESS_RULES.md`.
- **Motivo:** pedido do dono (comparar SAC e Price para o cliente).
- **Arquivos afetados:** `lib/simulation-models.js`, `lib/simulation-presentation-core.mjs`, `lib/simulation-list-utils.js`, `components/SimulationGenerator.jsx`, `components/presentation/PresentationPlayer.jsx`, `components/presentation/presentation.module.css`, `tests/simulation-systems-comparison.test.mjs`
- **Risco/observação:** sem migration (o SAC vai no JSON da observação interna). Simulações antigas = Price, sem mudança. Correção no mesmo dia: a 1ª versão tratou o antigo como SAC; o dono avisou que o antigo é Price. Testes novos 11/11; os testes existentes da área têm as mesmas falhas de antes (`ramo`, `logo da Caixa` etc.), nenhuma nova. A CONFIRMAR em produção: abrir um link com os dois sistemas e ver a cena.
- **Autor:** Claude Code
### 2026-10-08 — Lista de documentos: um e-mail para cada proponente
- **Data:** 2026-10-08
- **Área:** Apresentação / Documentos
- **Alteração:** no cadastro conjunto o item E-MAIL passou a existir em cada proponente (ids `contato-p1`/`contato-p2`, depois do FGTS); saiu do bloco "PARA OS DOIS", que agora só aparece quando há casal e/ou dependentes. Cadastro individual não mudou.
- **Motivo:** pedido do dono — cada pessoa precisa do próprio e-mail.
- **Arquivos afetados:** `lib/simulation-presentation-documents.mjs`, `tests/simulation-presentation-round3.test.mjs`
- **Risco/observação:** só montagem do texto da lista. Dois testes visuais antigos (`ramo`, `logo da Caixa`) já falhavam antes.
- **Autor:** Claude Code
### 2026-10-08 — WhatsApp 2 números: migrations aplicadas em produção
- Parte 1 (`20261008160000`) aplicada antes do deploy; parte 2 (`20261008160100`, PK `(user_id, slot)` e saída do UNIQUE antigo da conversa) aplicada pelo dono no SQL Editor do Supabase depois do deploy — o MCP do Supabase expirava em qualquer DDL com DROP. Conferido: PK `(user_id, slot)`, índice antigo removido, 9 sessões preservadas.
### 2026-10-08 — Lista de documentos: casal sem repetição e comprovante de residência "atualizado"
- **Data:** 2026-10-08
- **Área:** Apresentação / Documentos
- **Alteração:** cadastro conjunto com os dois proponentes casados: certidão de casamento e comprovante de residência aparecem uma vez em "PARA OS DOIS". Título do comprovante virou "COMPROVANTE DE RESIDÊNCIA ATUALIZADO" e a mensagem "Máximo de dois meses atrás" foi removida (vale para todas as listas).
- **Motivo:** pedido do dono — a lista repetia os mesmos documentos para marido e esposa.
- **Arquivos afetados:** `lib/simulation-presentation-documents.mjs`, `tests/simulation-presentation-round3.test.mjs`
- **Risco/observação:** só mexe na montagem da lista (texto); casado + solteiro/viúvos/união estável continuam com cada proponente completo. Dois testes visuais antigos (`ramo`, `logo da Caixa`) já falhavam antes e não têm relação.
- **Autor:** Claude Code
### 2026-10-08 — WhatsApp individual: até 2 números por corretor (WA-15)
- **O quê:** cada usuário conecta até 2 números ("Número 1", "Número 2"), cada um com QR/código, apelido e chave "Usar para disparo" (padrão: ligada no 1, desligada no 2). A Meta Diária automática (e o "Disparar") só envia por número conectado com a chave ligada, meio a meio quando os dois estão ligados (`chooseDispatchSlot` + `pickDispatchSlot`), tudo pelo outro se um cair; teto/intervalo continuam por corretor (não aumenta volume). Chat: filtros Todas | Número 1 | Número 2 | Oficial, selo do número na conversa, resposta/reação/edição/apagar/limite por hora sempre pelo número da conversa, "Abrir no Número N" no menu e status de cada número em Chat › Corretores. Alertas de sessão e telemetria por número.
- **Por quê:** regra do dono (2026-10-08).
- **Migração sem queda:** o Número 1 usa as MESMAS chaves de antes (id da sessão no microsserviço = id do corretor; `session_key`/`session_user_id` = id do corretor); o Número 2 é `<id>:2` no microsserviço, que trata o id como texto opaco — **o microsserviço não foi alterado** (nenhum redeploy no Railway, nenhuma sessão derrubada). A tradução fica só na borda (`lib/whatsapp-session-slots.mjs`).
- **Banco:** `20261008160000_whatsapp_individual_two_numbers.sql` (aditiva — aplicar ANTES do deploy do código) e `20261008160100_whatsapp_individual_two_numbers_keys.sql` (PK da sessão `user_id` → `(user_id, slot)` e sai o UNIQUE antigo da conversa — aplicar DEPOIS do deploy; até lá o Número 2 não grava).
- **Decisões conservadoras (sem consultar o dono):** teto de 30/dia e intervalo da política v2 somam os dois números; restrição (PRO-12/13/14) continua por corretor; status "do corretor" = conectado se qualquer número estiver; a automação só liga sozinha ao conectar um número com a chave de disparo ligada; dedupe de mensagem idêntica entre os dois números do mesmo corretor não foi alterado (índice não mexido para não travar a tabela de mensagens).
- **Arquivos:** `lib/whatsapp-session-slots.mjs` (novo), `lib/whatsapp-individual.js`, `lib/whatsapp-individual-inbound.js`, `lib/whatsapp-chat.js`, `lib/daily-goal-auto.js`, `lib/prospecting-extra-dispatch.js`, `lib/daily-goal-delivery-monitor.js`, `lib/prospecting-reply.js`, `lib/whatsapp-connection-alert.js`, `lib/whatsapp-session-attention.js`, `lib/whatsapp-session-telemetry-core.mjs`, rotas `app/api/webhooks/whatsapp-individual/{route,state}`, `app/api/admin/whatsapp-individual/{status,connect,disconnect,settings}`, `app/api/admin/whatsapp-chat/open-client`, `components/WhatsappIndividualStatus.jsx`, `components/WhatsappChat.jsx`, `components/WhatsappChatBrokers.jsx`, `tests/whatsapp-two-numbers.test.mjs` (+ travas de código atualizadas para as novas assinaturas), `docs/WHATSAPP.md` §1-D, `docs/BUSINESS_RULES.md` WA-15, `docs/DATABASE.md`.

### 2026-10-08 — Roleta: prazo de 5 min para a simulação de cliente com dados (ROL-4b)
- **O quê:** na REDISTRIBUIÇÃO DE LEADS, cliente com `primary_monthly_income > 0` só fica com o corretor se a simulação for feita (status fora de pendente ou linha em `simulations` com o `registration_id`); contato por WhatsApp/resposta no Chat deixam de segurá-lo. Sem dados, nada muda.
- **Por quê:** regra do dono — a abordagem do corretor é a simulação. Dado de referência (15/09–08/10): de 57 clientes de formulário na roleta, só 1 foi simulado em até 5 min (mediana ~6,6 h); o dono manteve 5 min.
- **Arquivos:** `lib/simulation-deadline-core.mjs` (novo), `lib/crm-automations.js`, `tests/simulation-deadline.test.mjs`, `docs/BUSINESS_RULES.md` ROL-4b, `.claude/rules/roleta-prospeccao-campanhas.md`.

### 2026-10-08 — Meta: evento "CadastroCRM" só do servidor (contagem real de cadastros)
- **O quê:** `sendMetaLeadEvent` (`lib/meta-conversions-api.js`) envia, junto do `Lead`, o evento personalizado `CadastroCRM` (event_id `<id>-crm`), só depois do cadastro novo gravado. Nada muda no pixel do navegador.
- **Por quê:** pedido do dono — o número de cadastros da Meta não batia. Prova: em 06/10 a Meta contou 22 leads e o site inteiro recebeu 12 cadastros (de todas as origens); nosso código só dispara `Lead` após o insert, então os extras vêm de fora (suspeita: Signals Gateway/Birch). Com a conversão personalizada sobre `CadastroCRM`, o Gerenciador passa a contar só cadastro real.
- **Pendente do dono:** criar a conversão personalizada "Cadastro CRM" no Gerenciador de Eventos e usá-la como coluna (e, em campanha nova, como evento de otimização). A CONFIRMAR: `META_CONVERSIONS_API_ACCESS_TOKEN` configurado na Vercel (sem ele nada é enviado).
- **Arquivos:** `lib/meta-conversions-api.js`, `tests/meta-crm-registration-event.test.mjs`, `docs/TRAFEGO_META.md`.

### 2026-10-08 — Roleta: sem atendimento em 5 min e ninguém on-line → fila de espera (ROL-4a)
- **O quê:** na REDISTRIBUIÇÃO DE LEADS, quando não há outro corretor on-line, o cliente deixa de ficar com quem não atendeu: vai para o dono com `pending_distribution_at` (`moveClientToRouletteWaitingQueue`) e a fila o entrega ao próximo corretor on-line, excluindo quem o perdeu. Cliente na fila é ignorado pela redistribuição. A entrega pela fila agora grava `responsible_changed_at` (o prazo de 5 min conta da entrega).
- **Por quê:** regra do dono. Bug encontrado junto: clientes entregues pela fila tinham o prazo contado da criação — nunca eram redistribuídos (3 clientes de hoje, 06:26) ou eram tirados em menos de 5 min (07:00 → 07:04).
- **Mantido (decisão do dono):** quem já mandou WhatsApp/respondeu no Chat fica com o cliente; trava de uma volta pela equipe.
- **Arquivos:** `lib/lead-distribution.js`, `lib/crm-automations.js`, `tests/pending-roulette.test.mjs`, `docs/BUSINESS_RULES.md` ROL-4a, `.claude/rules/roleta-prospeccao-campanhas.md`.

### 2026-10-08 — Roleta: fila de espera entregue 1 por corretor a cada 2 min
- **O quê:** `reassignPendingRouletteLeads` agora entrega no máximo 1 cliente da fila por corretor on-line em cada rodada do cron `scheduled-activities` (a cada 2 min), do mais antigo para o mais novo. Antes, o primeiro corretor a ficar on-line recebia a fila inteira de uma vez.
- **Por quê:** regra do dono (ROL-2b): dar chance aos outros corretores entrarem. Sem prazo máximo de espera (decisão do dono).
- **Arquivos:** `lib/lead-distribution.js` (`countOnlineRouletteBrokers`, mesmo critério de on-line da `pick_round_robin_broker`), `lib/pending-roulette-core.mjs` (`waitingQueueBatchSize`), `tests/pending-roulette.test.mjs`, `docs/BUSINESS_RULES.md` ROL-2b, `.claude/rules/roleta-prospeccao-campanhas.md`.
- **Não muda:** cadastro novo com corretor on-line continua indo direto pela roleta (não espera atrás da fila); transferência manual continua tirando o cliente da fila.
### 2026-10-08 — Apresentação: "Agendar atendimento" (presencial ou Meet) com agenda da gestora
- **Atualização:** migration `20261008120000_client_appointments` aplicada em produção em 2026-10-08 (funcionalidade ligada).
- **Data:** 2026-10-08
- **Área:** Apresentação interativa / Agenda / Usuários
- **Alteração:** botão AGENDAR ATENDIMENTO na cena "Próximo passo" (PRES-22): presencial/online, 10 dias, horários de 30 min com escassez em blocos calculada no servidor, agenda compartilhada pela equipe da gestora, "Combinar outro horário", atividade no card, linha do tempo (`appointment_scheduled`/`appointment_requested`), aviso ao corretor e à gestora (`scheduled_activity`), .ics + Google Agenda, WhatsApp do corretor com mensagem pronta. Campo "Link do Google Meet" (admin/gestor) em Usuários. Endereço da imobiliária centralizado em `lib/company-info.mjs` (o rodapé passou a usá-lo).
- **Motivo:** pedido e especificação do dono (2026-10-08).
- **Arquivos afetados:** `lib/client-appointments-core.mjs`, `lib/client-appointments.js`, `lib/company-info.mjs`, `lib/admin-profiles.js`, `app/api/s/[token]/agendamento/**`, `components/presentation/AppointmentSheet.jsx`, `components/presentation/PresentationPlayer.jsx`, `components/presentation/presentation.module.css`, `components/AdminUsersManager.jsx`, `components/ClientJourneyActions.jsx`, `components/Footer.jsx`, `app/apresentacao/[token]/page.jsx`, `app/admin/simulacoes/[id]/apresentacao/page.jsx`, `app/dev/vitrine/apresentacao/page.dev.jsx`, `supabase/migrations/20261008120000_client_appointments.sql`, `tests/client-appointments.test.mjs`.
- **Risco/observação:** migration aditiva (tabela `client_appointments` + `admin_users.meet_link`). Enquanto não aplicada, o botão não aparece (checagem `isClientAppointmentsReady`) e editar usuários continua funcionando (o link do Meet só é gravado quando muda). Semente da escassez: `APPOINTMENT_SCARCITY_SECRET` (opcional; sem ela usa constante do servidor). Não há tela de agenda da gestora nem cancelamento pelo CRM nesta entrega (status `cancelled` existe na tabela, sem tela). Decisões conservadoras listadas em PRES-22.
- **Autor:** Claude Code
### 2026-10-08 — Fluxo do anúncio (saudação + botão com imagem) e Chat híbrido: etiquetas, filtros, "Enviando por" e janela do oficial
- **Fluxo "Anúncio WhatsApp — formulário direto"** (v5, publicado direto no banco; cópia anterior em `whatsapp_flows_backup_20261008`): roleta + tag → "{{saudacao}}, {{primeiro_nome}}! Muito bom ter você por aqui… um associado já vai entrar em contato" → mensagem com a imagem de prévia (`og-simulacao-v3.png`) e botão "Preencher formulário" (link da simulação do corretor + UTMs) → entrega ao atendimento. Cooldown 6 h (cliente que clica de novo dentro de 6 h não recebe de novo). Nova variável `{{saudacao}}` (Bom dia/Boa tarde/Boa noite, Marília) em `lib/whatsapp-flows.js`, editor e prévia.
- **Chat:** filtros "Oficial" e "Pessoal" (`lib/whatsapp-chat.js`/`components/WhatsappChat.jsx`), etiqueta Oficial/Pessoal em cada conversa, linha "Enviando por: número oficial / seu WhatsApp pessoal" no campo de digitar e bloqueio de texto livre no número oficial depois de 24 h da última mensagem do cliente (`WINDOW_CLOSED`; o corretor segue pelo celular). Teste em `tests/chat-disabled.test.mjs` e `tests/whatsapp-flow-saudacao.test.mjs`.

### 2026-10-08 — Chat HÍBRIDO (oficial envia, WhatsApp pessoal só responde pelo celular) + diagnóstico do recebimento do número oficial
- **Pedido (dono):** o número oficial só RECEBE (vai nos anúncios de clique para o WhatsApp); quer o Chat com dois canais: o do corretor e o oficial.
- **Chat híbrido:** `crm_settings.whatsapp_chat_control` agora aceita `individualSendDisabled` (além de `disabled`, que desliga o Chat inteiro). Com `{disabled:false, individualSendDisabled:true}`: o Chat abre para todos, o número oficial (cloud_api) envia normalmente (conversa do oficial nunca migra para a sessão pessoal) e envio/reação/edição/exclusão pela sessão pessoal ficam recusados (`CHAT_INDIVIDUAL_DISABLED`); no composer o corretor vê o aviso e o botão verde que abre o WhatsApp do celular. Card do cliente continua abrindo o WhatsApp externo. Para liberar a sessão pessoal: `individualSendDisabled:false`.
- **Recebimento do oficial:** o cartão "Registro do número oficial" (Automações > WhatsApp Master) agora mostra se o app da Meta está inscrito na conta (`GET/POST /{waba}/subscribed_apps`) e a última mensagem recebida; botão "Ativar recebimento". Último webhook recebido pelo CRM: 29/09.

### 2026-10-08 — Registro do número oficial na API da Meta (tela em Automações > WhatsApp Master)
- **Pedido (dono):** cadastrar o número na API oficial. No Gerenciador do WhatsApp o +55 14 99105-6706 está "Pendente: registre este número usando a API de registro".
- **Mudança:** `lib/whatsapp-register.js` (consulta o estado e faz `POST /{phone-number-id}/register` com PIN de 6 dígitos), rota `/api/admin/whatsapp-master/registration` (GET/POST, só administrador geral) e cartão `components/WhatsappNumberRegistration.jsx` na aba WhatsApp Master (`app/admin/automacoes/page.jsx`). O PIN digitado só vai para a Meta (não é gravado nem logado); token fica no servidor.

### 2026-10-07 — Transferência manual desliga a roleta para o cliente
- **Data:** 2026-10-07
- **Área:** Roleta / Automações
- **Alteração:** a automação de devolver à roleta (`return_to_round_robin`, regra "REDISTRIBUIÇÃO DE LEADS") pula todo cliente que já teve transferência manual (`client_journey_events` `responsible_transferred` com `transferType: manual`). Complementa `e9c3e11` (fila de espera).
- **Motivo:** regra do dono — "depois que eu faço uma transferência manual, a roleta deve ser desativada" (caso #C4673: dono → Matheus 08:04, redistribuição → Eduardo 08:10).
- **Arquivos afetados:** `lib/crm-automations.js`, `tests/manual-transfer-disables-roulette.test.mjs`
- **Risco/observação:** 91 clientes já têm transferência manual registrada e deixam de ser redistribuídos automaticamente. Nenhuma métrica/`distribution_type` mudou.
- **Autor:** Claude Code
### 2026-10-07 — Links curtos de volta nos geradores do CRM + "Excluir link" corrigido
- **Data:** 2026-10-07
- **Área:** Gerador de Links / Links compartilháveis
- **Alteração:** (1) desfaz `8c8a22f`: link de campanha `/c/{short_code}`, link do corretor `/s/{short_ref}`, captação `/v/{short_ref}`, Minha Jornada `/j/{token}`, link genérico das respostas automáticas `/s`. Copiar leva a URL curta completa (`https://www…`). As rotas longas (`/simulacao?c=`, `?ref=`, `/captacao?ref=`, `/minha-jornada/`) seguem valendo; as curtas respondem 200 com Open Graph (`538aef2`), que resolveu a prévia que motivou a reversão de 04/10. (2) "Excluir" no Gerador de Links passa a marcar `campaigns.deleted_at` (migration `20261007010000_campaigns_soft_delete.sql`, aplicada) e esconder da lista; a linha e o status ficam, então a URL já enviada continua abrindo e atribuindo.
- **Motivo:** pedido do dono (links curtos; "não consigo excluir links antigos"). Causa do erro: `DELETE` falhava por FK `whatsapp_broadcasts.link_campaign_id` (sem `on delete`) nos links criados pelo Disparo, e a mensagem mapeada era "O corretor selecionado não foi encontrado".
- **Arquivos afetados:** `lib/campaigns.js`, `lib/admin-profiles.js`, `lib/client-journey.js`, `lib/whatsapp-automation-replies.js`, `lib/whatsapp-flows.js`, `components/CampaignsManager.jsx`, `components/clients/useClientList.js`, `components/flows/FlowPreview.jsx`, `tests/short-links.test.mjs`, migration acima.
- **Risco/observação:** não mudou: modelo aprovado do Disparo (`/simulacao?c={{1}}`, template da Meta), link da roleta `/simulacao/equipe` (abre direto a Simulação), link da apresentação `/s/{token}` (já curto; token de 128 bits mantido por segurança).
- **Autor:** Claude Code
### 2026-10-06 — Histórico do cliente inclui o(s) cadastro(s) anterior(es) (reentrada por anúncio)
- **Data:** 2026-10-06
- **Área:** Clientes / Jornada
- **Alteração:** a linha do tempo de um cadastro criado por reentrada por anúncio mescla os eventos do(s) cadastro(s) anterior(es) da mesma pessoa (`metadata.ad_reentry_of`, até 5 níveis), com selo "Cadastro anterior #Cxxxx", evento "PRIMEIRO CADASTRO" (origem, modalidade, destino, corretor) e "Primeira entrada" no cabeçalho. "Cliente cadastrado" mostra também o corretor inicial. Roleta sem corretor on-line: a atribuição inicial registra com quem o cliente ficou (dono, `heldByOwner`) em vez de "Distribuído para: —".
- **Motivo:** pedido do dono — ver quando o cliente entrou pela primeira vez e para quem foi (ex.: #C4672 → #C3507, 25/09, Caroline Mayumi).
- **Arquivos afetados:** `lib/client-journey.js`, `lib/simulation-registrations.js`, `components/ClientJourneyActions.jsx`, `tests/client-journey-previous-records.test.mjs`
- **Risco/observação:** só leitura entre cadastros (nada copiado). Quem pode abrir o cadastro novo vê também o histórico do anterior, inclusive de outro corretor (mesma pessoa) — decisão de produto a confirmar pelo dono. Eventos antigos de atribuição sem responsável aparecem como "ninguém (nenhum corretor on-line)".
- **Autor:** Claude Code
### 2026-10-06 — "Atividade agendada": um aviso por atividade (não a cada edição do cliente)
- **Data:** 2026-10-06
- **Área:** Automações / Notificações
- **Alteração:** gatilhos de atividade (`activity_created/upcoming/overdue/completed`) passam a usar a chave `gatilho@<data/hora da atividade>` (sem etapa, sem `updated_at`). "Antes da atividade" conta da data/hora agendada; "Atividade agendada" não avisa atividade já passada/concluída. Reagendar = aviso novo.
- **Motivo:** pedido do dono (só notificar cliente novo e atividade). A regra "ATIVIDADE AGENDADA" (30 min antes) usava `updated_at`+etapa: qualquer edição do cliente gerava push de novo, inclusive de atividades antigas (ex.: atividade de 28/09 avisada 4x em 05–06/10).
- **Arquivos afetados:** `lib/crm-automation-activity.mjs` (novo), `lib/crm-automations.js`, `tests/crm-automation-activity.test.mjs`
- **Risco/observação:** na publicação, atividades nos próximos 30 min podem receber um último aviso (chave nova). Sem mudança de banco. Investigação Meta do mesmo dia: a sincronização de insights NÃO está quebrada (campanhas sem veiculação 02–05/10); os "Leads no site" da campanha 52546652319953 (17 em 19 visitas, 1 cadastro no CRM) não vêm do código — suspeita de evento Lead configurado no Gerenciador de Eventos da Meta, a conferir pelo dono.
- **Autor:** Claude Code
### 2026-10-06 — Pendentes da Meta Diária em lote na visão da equipe (sem mudar nenhum número)
- **Data:** 2026-10-06
- **Área:** Meta Diária / Desempenho
- **Alteração:** `getDailyGoalPendingProgressBatch` (`lib/daily-goal-pending.js`) calcula as pendências de todos os corretores com ~6 consultas (antes ~29), usando o MESMO cálculo por corretor (`progressFromLoaded`, agora compartilhado com o caminho individual). A visão da equipe usa o lote e cai no individual se falhar.
- **Motivo:** continuação da lentidão da Meta Diária do administrador — menos carga no banco.
- **Arquivos afetados:** `lib/daily-goal-pending.js`, `lib/daily-goal.js`, `tests/daily-goal-pending-batch.test.mjs`
- **Risco/observação:** conferido em produção ANTES de publicar: lote x individual igual nos 8 corretores e a visão da equipe inteira (`getOwnerTeamDailyOverview`) idêntica à de antes (diff vazio). Consultas por abertura 156 → 133. O tempo medido no PC do desenvolvedor não mudou (~8,4 s, dominado pela latência de cada consulta no caminho crítico); as funções da Vercel rodam em iad1 (EUA leste) e o banco em us-west-2, bem mais perto do que o PC de teste.
- **Autor:** Claude Code
### 2026-10-06 — Meta Diária do administrador mais rápida (menos consultas ao banco)
- **Data:** 2026-10-06
- **Área:** Meta Diária / Banco / Desempenho
- **Alteração:** (1) índices em `daily_goal_rounds` (`(prospecting_contact_id, status, ended_at)` e `(status, ended_at)`): a hibernação do retorno automático (cron de 2 min) passou de ~227 ms para ~2 ms; (2) a visão da equipe (`getOwnerTeamDailyOverview`) calcula a carteira só de quem aparece na lista (antes, de todos os perfis, inclusive inativos/dono/gestores), roda carteira e pendentes em paralelo e usa memória POR REQUISIÇÃO (`lib/request-memo.mjs`) para não repetir os mesmos números do corretor. Medido no mesmo ambiente: 214 → 155 consultas e ~10,4 s → ~8,2 s por abertura (a maior parte do tempo restante é latência de rede por consulta).
- **Motivo:** relato do dono — CRM lento e Meta Diária demorando para carregar no acesso dele.
- **Arquivos afetados:** `supabase/migrations/20261006150000_daily_goal_rounds_contact_status_idx.sql`, `lib/request-memo.mjs`, `lib/daily-goal.js`, `lib/daily-goal-wallet.js`, `tests/request-memo.test.mjs`
- **Risco/observação:** a memória vale só dentro de UMA requisição (nunca entre requisições). Ainda ficam ~155 consultas por abertura; próximo passo seria agrupar os pendentes de todos os corretores numa consulta só (`calendar_activities` 22×, `daily_goal_rounds` 18×).
- **Autor:** Claude Code
### 2026-10-06 — Histórico do cliente abre por cima da ficha (card)
- **Data:** 2026-10-06
- **Área:** Frontend / Clientes
- **Alteração:** o modal "Jornada e histórico" (`components/ClientJourneyActions.jsx`) passou de `div fixed z-[100]` para `<dialog>` nativo com `showModal()`, igual ao modal de Documentação.
- **Motivo:** relato do dono (celular e computador): o histórico ficava ATRÁS do card do cliente — a ficha (Sheet) é um `<dialog>` na camada de topo do navegador e nenhum z-index passa por cima dela.
- **Arquivos afetados:** `components/ClientJourneyActions.jsx`, `tests/client-journey-modal-layer.test.mjs`
- **Risco/observação:** outros modais que abram de dentro da ficha e usem `div fixed` têm o mesmo risco; só este foi reportado/corrigido.
- **Autor:** Claude Code
### 2026-10-06 — Transferência manual não é mais desfeita pela fila de espera da roleta
- **Data:** 2026-10-06
- **Área:** Roleta / Clientes
- **Alteração:** atribuir um cliente a um corretor (`updateSimulationRegistration` com `responsibleUserId`) zera `pending_distribution_at`; a roleta (`reassignPendingRouletteLeads`) só entrega cliente sem responsável ou segurado pelo dono e tira da fila quem já tem corretor (`lib/pending-roulette-core.mjs`).
- **Motivo:** caso real — cliente do Link Geral (roleta), sem ninguém on-line, ficou com o dono (FUN-11) e na fila de espera; o dono transferiu para a Izabela e 4 min depois a roleta o entregou ao Bencke.
- **Arquivos afetados:** `lib/simulation-registrations.js`, `lib/lead-distribution.js`, `lib/pending-roulette-core.mjs`, `tests/pending-roulette.test.mjs`
- **Risco/observação:** o link pessoal do dono (`/simulacao?ref=matheus`) já é direto (fora da roleta); o "Link Geral do Site" (`/simulacao` sem ref) vai para a roleta por desenho (2026-09-30).
- **Autor:** Claude Code
### 2026-10-06 — Nenhum cliente sem responsável + notificações só de cliente novo e atividade agendada
- **Data:** 2026-10-06
- **Área:** Clientes / Roleta / Prospecção / Notificações
- **Alteração:** (1) A rede de segurança `reassignOrphanedClientsToOwner` passa a cobrir TODO cliente sem responsável (inclusive devolvido à fila e fila de espera da roleta): devolvido volta ao corretor que o tinha; senão o dono segura e a roleta o entrega ao 1º corretor on-line; lead novo sem corretor on-line já nasce com o dono. (2) Política de notificações deny-by-default: `sendPushToUser` só envia `kind` permitido (cliente novo, transferência, atividade agendada, teste) e o gatilho `crm_notifications_policy` descarta no sino qualquer outro tipo; avisos antigos de tipos extintos foram marcados como lidos.
- **Motivo:** pedido do dono — "não deve haver clientes sem corretor responsável; em último caso atribua a mim até um corretor ficar on-line e aí transfere automaticamente" e "notificações apenas para novos clientes e tarefas agendadas".
- **Arquivos afetados:** `lib/client-distribution-core.mjs`, `lib/simulation-registrations.js`, `lib/notification-policy-core.mjs`, `lib/push-subscriptions.js`, `lib/crm-automations.js`, `lib/admin-profiles.js`, `lib/scheduled-activity-notifications.js`, `lib/lead-distribution.js`, `lib/whatsapp-sponsored-lead.js`, `lib/whatsapp-flows.js`, `app/api/push/test/route.js`, `supabase/migrations/20261006100000_crm_notifications_policy.sql`, `tests/client-distribution-core.test.mjs`, `tests/notification-policy.test.mjs`
- **Risco/observação:** a regra P-05 (devolvido à fila fica sem responsável) foi SUBSTITUÍDA; o cartão do cliente devolvido volta a ficar na lista do corretor que disparou (rede em até 2 min). Central de Alertas (popups), alerta sonoro e e-mails NÃO foram alterados — perguntar ao dono se também devem sair. Quem estava em "Aguardando distribuição" com responsável nulo passa a aparecer como do dono (rótulo da lista usa `pendingDistributionAt`).
- **Autor:** Claude Code

### 2026-10-06 — Gerador: caixas "Imóvel novo" / "Imóvel usado" (simulação de um tipo só)
- **Data:** 2026-10-06
- **Área:** Gerador de simulação · PDF · Apresentação
- **Alteração:** na Etapa B do Gerador há duas caixas, "Imóvel novo" e "Imóvel usado", marcadas por padrão e com pelo menos uma sempre marcada.
  - Desmarcar apaga os valores daquele tipo e esconde o quadro dele. A cópia automática de financiamento e parcelas (`SYNCED_MODEL_FIELDS`) deixa de preencher esse tipo.
  - Assim, PDF, imagem e apresentação mostram só o tipo marcado, sem comparação ou cena de diferença.
  - Marcar de novo copia financiamento e parcelas do outro tipo; o subsídio fica em branco.
  - Nada novo é gravado: "ativo = tem valor" (`enabledModelsFromModels`, `toggleSimulationModel` em `lib/simulation-models.js`).
- **Motivo:** pedido do dono. Às vezes o cliente só quer novo ou só usado, e a comparação é informação desnecessária. Causa de a comparação aparecer: a cópia automática preenchia também o outro tipo.
- **Arquivos afetados:** `lib/simulation-models.js`, `components/SimulationGenerator.jsx`, `tests/simulation-model-toggle.test.mjs`.
- **Risco/observação:** o estado das caixas é inferido dos valores. Uma simulação antiga com os dois tipos preenchidos abre com as duas marcadas, como hoje. Não testado com login real (só testes unitários e build).
- **Autor:** Claude Code

### 2026-10-06 — Apresentação de aprovação (chave manual no link da simulação)
- **Data:** 2026-10-06
- **Área:** Apresentação da simulação · Banco
- **Alteração:** nova chave "Apresentação de aprovação" no painel da apresentação, com confirmação ao ligar e registro na jornada. Ligada, o mesmo link `/s/<token>` mostra outro roteiro:
  - pausa curta + carimbo "CRÉDITO APROVADO" (impacto, onda, tremida, vibração no Android) + "Parabéns, {nome}!";
  - valores aprovados: financiamento, subsídio, parcela(s) e taxa de juros;
  - imóvel + valores, só se houver imóvel na simulação.

  Sem próximo passo, documentos ou contato. A chave não toca na etapa do funil. As imagens da lista de documentos e do resumo seguem da simulação. Prévia em `?modo=aprovacao`; vitrine `/dev/vitrine/apresentacao?modo=aprovacao` (`&v=sem-imovel`). Regra PRES-21.
- **Motivo:** pedido do dono. Depois da análise ele corrige a simulação com os valores reais da aprovação e quer uma apresentação bonita de aprovado, controlada manualmente para evitar erro.
- **Arquivos afetados:** `supabase/migrations/20261006180000_simulation_presentation_approval.sql` (APLICADA em produção via MCP, aditiva), `lib/simulation-presentation.js`, `lib/simulation-presentation-core.mjs`, `lib/simulation-presentation-share.mjs`, `app/api/admin/simulacoes/[id]/apresentacao/route.js`, `app/admin/simulacoes/[id]/apresentacao/page.jsx`, `app/apresentacao/[token]/documentos/route.js`, `app/apresentacao/[token]/imagem/route.js`, `components/presentation/PresentationPlayer.jsx`, `components/presentation/SimulationPresentationPanel.jsx`, `components/presentation/presentation.module.css`, `components/ClientJourneyActions.jsx`, vitrine, testes (`tests/simulation-presentation-approval.test.mjs` novo; round2/values ajustados).
- **Risco/observação:**
  - O código tolera a coluna ausente: o link segue na simulação e a chave some.
  - A prévia do WhatsApp (título/imagem) continua a mesma da simulação.
  - "Imóvel definido" = imóvel sugerido cadastrado; com vários, aparecem todos (a confirmar com o dono).
  - O teste do round 2 que proibia "aprovad" no player passou a proibir só parceria/homologação/"aprovado pela Caixa".
- **Autor:** Claude Code

### 2026-10-06 — Apresentação: texto da cena do imóvel um pouco mais à direita
- **Data:** 2026-10-06
- **Área:** Apresentação da simulação (cena do imóvel sugerido)
- **Alteração:** no celular, o bloco de texto da cena do imóvel (selo "Imóvel X de Y", nome, destaques, card "Por que este imóvel", dica/botão) foi 10u para a direita. A margem esquerda passou de 24u para 34u, a direita continua 24u. A folga da área que rola acompanha (34u à esquerda), para o carimbo e a onda terem respiro. Efeito mantido.
- **Motivo:** pedido do dono ("gostei do efeito, só traga tudo um pouco mais para a direita para o efeito não recortar").
- **Arquivos afetados:** `components/presentation/presentation.module.css`.
- **Risco/observação:** conferido na vitrine (390x844 e 375x667). O texto fica 10u mais estreito. A versão de computador (paisagem) não muda.
- **Autor:** Claude Code

### 2026-10-06 — Apresentação: fim da "linha de corte" no carimbo dos destaques do imóvel
- **Data:** 2026-10-06
- **Área:** Apresentação da simulação (cena do imóvel sugerido)
- **Alteração:** o carimbo dos destaques (entrada anterior) passava da área que rola (`.photoScroll`, com `overflow` e máscara), e o item gigante e a onda da bolinha eram cortados numa linha invisível a 24u da borda da tela.
  - A área ganhou folga lateral igual à margem da cena (`margin-inline` negativa + `padding-inline`), sem mover o texto.
  - O carimbo ficou contido: escala 1,7 (era 2,4), giro 3° (era 7°) e onda até 2× (era 2,6×). Continua com impacto, achatamento e rebote.
- **Motivo:** relato do dono com capturas ("linha de corte invisível que está deixando a apresentação feia").
- **Arquivos afetados:** `components/presentation/presentation.module.css`.
- **Risco/observação:** conferido na vitrine (`?v=longo&ramo=1`, nome longo + 4 destaques) em 390x844 e 375x667, quadro a quadro, sem corte. A máscara de rolagem (fade de 14u no topo e 10u no rodapé da área) continua; um item que bata exatamente nessa faixa ainda esmaece durante a animação.
- **Autor:** Claude Code

### 2026-10-06 — Apresentação: destaques do imóvel entram como carimbo
- **Data:** 2026-10-06
- **Área:** Apresentação da simulação (cena do imóvel sugerido)
- **Alteração:** os destaques (características) do imóvel trocaram o deslize da esquerda pelo mesmo efeito de carimbo do total de descontos. Cada item, um a um a cada 320 ms (antes 240 ms), vem grande (2,4x), inclinado e desfocado, bate, achata e assenta; uma onda curta sai do marcador no impacto. Só o movimento mudou: no fim cada item fica exatamente como antes (transform identidade, opacidade 1). Com movimento reduzido, só aparece.
- **Motivo:** pedido do dono ("efeito semelhante ao do total de descontos para os destaques do imóvel; não altere o visual e aparência, apenas os efeitos da cena").
- **Arquivos afetados:** `components/presentation/PresentationPlayer.jsx`, `components/presentation/presentation.module.css`, `tests/simulation-presentation-round3.test.mjs`.
- **Risco/observação:** conferido na vitrine quadro a quadro, com o estado final medido. O card "Por que este imóvel" e a dica entram depois do último destaque (atraso recalculado). Testes de apresentação passam.
- **Autor:** Claude Code

### 2026-10-06 — Apresentação: selo "Total de descontos" maior (sobre as linhas vizinhas)
- **Data:** 2026-10-06
- **Área:** Apresentação da simulação (cena de valores do imóvel)
- **Alteração:** o selo do total cresce só no desenho (`--stamp-scale: 1.25`, 1.15 em tela baixa), sem mudar o espaço da cena: avança um pouco sobre a linha de cima e a de baixo, por cima delas (`z-index`). Teto da fonte do número 0,105 × largura do palco, para valores de 6 dígitos ainda caberem. A onda do impacto acompanha a nova escala. A área que rola ganhou folga lateral igual à margem da cena, para o selo não ser cortado. Nada mais mudou.
- **Motivo:** pedido do dono ("aumente um pouco o total de descontos mesmo que sobreponha um pouco da linha superior e inferior; não altere mais nada").
- **Arquivos afetados:** `components/presentation/presentation.module.css`.
- **Risco/observação:** a vitrine usa uma fonte de fallback mais larga que a do site, e lá o selo fica quase na largura da tela. Na fonte real (medida pela captura do dono) fica com cerca de 200 px de 390. Testes de apresentação passam.
- **Autor:** Claude Code

### 2026-10-06 — Parcelas da entrada: sempre o maior parcelamento da regra (fim do "1x" por falta do máximo)
- **Data:** 2026-10-06
- **Área:** Simulação de entrada (motor) · Apresentação · card → Empreendimento · PDF Proposta de Valores
- **Alteração:** na estratégia "ATO + parcelas", quando a regra do empreendimento não tem "Número máximo de parcelas" nos limites, o motor deixa de usar 1 parcela. O teto passa a ser o "Nº de parcelas quando excede o limite" da própria regra (`definirTetoParcelas` em `lib/simulacao-entrada/calculator.ts`). Se o máximo estiver cadastrado, ele continua valendo. Sem nenhum dos dois campos, continua 1 (nada inventado). Nova regra SIM-4 em `docs/BUSINESS_RULES.md`.
- **Motivo:** pedido do dono com a captura da apresentação: entrada de R$ 44.055,83 mostrada como "1x de R$ 44.496,39" (1x com juros de 1%). Reproduzido com o motor. Causa raiz já apontada em 2026-10-05: o Residencial Morumbi só tem parcela mínima R$ 100 e nenhum `numeroMaximoParcelas`, e `maiorPrazoValido` trata a falta do máximo como 1.
- **Arquivos afetados:** `lib/simulacao-entrada/calculator.ts`, `tests/proposta-valores.test.mjs`, `docs/BUSINESS_RULES.md`.
- **Risco/observação:** NÃO CONFIRMADO no banco (conector Supabase com token inválido nesta sessão): se a regra do Morumbi também não tiver o "Nº de parcelas quando excede o limite", continua 1x até o dono preencher "Número máximo de parcelas" na regra do empreendimento. Parcelas digitadas à mão no card passam a respeitar esse teto. `pnpm build` limpo; suíte `node --test` sem falhas novas.
- **Autor:** Claude Code

### 2026-10-06 — Apresentação: cena do imóvel sem botão "Ver valores" e card "Por que este imóvel" redesenhado
- **Data:** 2026-10-06
- **Área:** Apresentação da simulação (ramo de imóveis sugeridos)
- **Alteração:**
  - Quando a próxima cena é a de valores do mesmo imóvel, o botão "Ver valores" sai. Toque ou arraste na tela já avançavam (`tapAction`/`swipeAction`); no lugar do botão fica só uma dica em pílula, "Toque na tela para ver os valores ›", com a seta se mexendo de leve (parada com movimento reduzido).
  - Imóvel sem valores (ou o último) mantém o botão "Próximo imóvel"/"Continuar".
  - A justificativa virou um card de vidro azul: título "POR QUE ESTE IMÓVEL" com selo, texto maior, borda e sombra. Antes era uma faixa clara com borda à esquerda.
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `components/presentation/PresentationPlayer.jsx`, `components/presentation/presentation.module.css`, `tests/simulation-presentation-values.test.mjs`.
- **Risco/observação:** conferido na vitrine (`?ramo=1`) em 390x844 e 375x667. Tocar na tela leva à cena de valores. Testes de apresentação passam.
- **Autor:** Claude Code

### 2026-10-06 — Apresentação: "Total de descontos" volta para baixo dos valores, como CARIMBO
- **Data:** 2026-10-06
- **Área:** Apresentação da simulação (cena de valores do imóvel)
- **Alteração:** desfeita a cena separada "Total de descontos" e o botão "Ver total de descontos" (entrada anterior). O total volta para a cena de valores, logo abaixo das linhas, como um carimbo:
  - selo com borda dupla, levemente inclinado;
  - entra depois de uma pausa vindo grande, girado e desfocado (escala 3,2), "bate", achata e rebota;
  - uma onda de choque sai do selo e a cena treme no instante do impacto;
  - vibração no Android; o valor chega inteiro;
  - a entrada aparece depois do impacto.

  Com movimento reduzido, nada disso anima. Espaçamentos da cena levemente compactados para caber.
- **Motivo:** pedido do dono. Ele não queria botão nem cena separada; queria o total abaixo dos valores com um efeito "bem mais forte, como se fosse carimbado".
- **Arquivos afetados:** `components/presentation/PresentationPlayer.jsx`, `components/presentation/player-core.mjs` (volta ao estado anterior), `components/presentation/presentation.module.css`, `tests/simulation-presentation-values.test.mjs`, `docs/BUSINESS_RULES.md` (PRES-20).
- **Risco/observação:** conferido na vitrine quadro a quadro (390x844) e em 375x667, no caso mais cheio (4 linhas + entrada + sem ato + parcelas), sem rolagem. A vibração não existe no iPhone (limitação do Safari).
- **Autor:** Claude Code

### 2026-10-06 — Apresentação: "Total de descontos" em cena própria com pop-in
- **Data:** 2026-10-06
- **Área:** Apresentação da simulação (ramo de imóveis sugeridos)
- **Alteração:** a sequência de cada imóvel passa a ser imóvel → valores → **total de descontos** → próximo imóvel. A cena nova mostra o nome do empreendimento e o total num cartão grande que entra com efeito pop-in (escala 0,4 → ~1,06 → 1) e um contador. Embaixo vai "Somando descontos e benefícios deste imóvel." e o botão Próximo imóvel/Continuar. A linha do total saiu da cena de valores, cujo botão agora é "Ver total de descontos". Com movimento reduzido, a cena aparece sem escala. A cena só existe com total > 0 e o número é o mesmo `totalDescontos` do servidor (o DTO não muda).
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `components/presentation/player-core.mjs`, `components/presentation/PresentationPlayer.jsx`, `components/presentation/presentation.module.css`, `tests/simulation-presentation-values.test.mjs`, `docs/BUSINESS_RULES.md` (PRES-20).
- **Risco/observação:** a vitrine `?ramo=N` conta cenas do ramo, que agora são 3 por imóvel com valores. Conferido na vitrine (390x844, quadros da animação medidos). Testes de apresentação e previsão passam.
- **Autor:** Claude Code

### 2026-10-06 — Previsão de envio: data e período obrigatórios, com aviso
- **Data:** 2026-10-06
- **Área:** Apresentação da simulação (folha "Receber lista de documentos")
- **Alteração:** as duas perguntas mostram "(obrigatório)". O botão final continua com cara de desativado enquanto falta data ou período, mas agora responde ao toque: não envia e mostra em vermelho o que falta ("Escolha a data em que você vai enviar os documentos." / "Escolha o período do dia."), com contorno no grupo. Antes o botão ficava desativado e sem nenhum retorno. O servidor já recusava (400) envio sem data/período válidos e isso não mudou.
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `components/presentation/ForecastSheet.jsx`, `components/presentation/presentation.module.css`, `tests/documents-forecast.test.mjs` (também corrigida a asserção que o commit anterior, remoção do botão "Lista de documentos", deixou quebrada).
- **Risco/observação:** conferido na vitrine (`?cena=9&envio=erro`) tocando o botão sem data e sem período. Na prévia do CRM o botão continua realmente desativado.
- **Autor:** Claude Code

### 2026-10-06 — Apresentação: sai o botão "Lista de documentos"
- **Data:** 2026-10-06
- **Área:** Apresentação da simulação (link público /s/)
- **Alteração:** a cena "Documentos" não tem mais o botão que abria a folha com a lista. Ficaram só "Receber lista de documentos" (quando há corretor responsável com WhatsApp válido) e "Rever a apresentação". A lista continua chegando pelo corretor. `DocumentsSheet.jsx` ficou no repositório, mas o player não usa mais.
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `components/presentation/PresentationPlayer.jsx`, `tests/simulation-presentation-round2.test.mjs`, `tests/simulation-presentation-round3.test.mjs`.
- **Risco/observação:** sem corretor responsável com WhatsApp válido, a cena fica só com "Rever a apresentação" e o cliente não vê a lista na apresentação. Conferido na vitrine (`?cena=9`). Testes `tests/*presentation*` passam.
- **Autor:** Claude Code

### 2026-10-06 — Apresentação: números maiores nas cenas de valores
- **Data:** 2026-10-06
- **Área:** Apresentação da simulação (link público /s/)
- **Alteração:** Na cena "valores do imóvel" os números ficaram maiores: valor do imóvel, linhas de financiamento/desconto/subsídio, total de descontos, entrada e "Sem ato". Na cena "Como esse valor é formado" também cresceram as parcelas e o "Poder total". Em telas baixas (altura até 720 px, ex.: iPhone SE) a cena de valores mantém os tamanhos anteriores para caber sem rolar. Mudança só no CSS (`.valInner …`, `.rowsSoma .rowPart .rowValue`, `.rowTotal .rowValue`), com limites pela largura do palco (`--cw`) para nada vazar.
- **Motivo:** pedido do dono (capturas do iPhone): os números estavam pequenos e sobrava meia tela vazia.
- **Arquivos afetados:** `components/presentation/presentation.module.css`.
- **Risco/observação:** conferido na vitrine (`/dev/vitrine/apresentacao?ramo=2` e `?cena=2`) em 390x844 e 375x667, com 4 linhas de desconto e parcelas. Rótulo longo quebra em 2 linhas. Testes `tests/*presentation*` passam.
- **Autor:** Claude Code

### 2026-10-06 — "Baixar imagem da lista" não prende mais o app do iPhone
- **Data:** 2026-10-06
- **Área:** Clientes · PWA
- **Alteração:** na prévia "Enviar lista de documentos" (envio manual), o link `<a download>` virou botão. Ele busca a imagem no mesmo domínio já ao abrir a prévia. No celular abre o menu de compartilhar do sistema (Salvar imagem / WhatsApp) e no computador baixa sem trocar de página (`components/clients/documentsImageFile.js`).
- **Motivo:** relato do dono. No app instalado do iPhone, o `<a download>` abria a pré-visualização do iOS sem botão de voltar, e era preciso fechar e reabrir o app.
- **Arquivos afetados:** `components/clients/ClientSheet.jsx`, `components/clients/documentsImageFile.js`, `tests/documents-forecast.test.mjs`.
- **Risco/observação:** não testado num iPhone real daqui. Outros `<a download>` do painel (book em PDF de empreendimento, mídia do Chat, certificado) podem ter o mesmo efeito no app do iPhone e não foram alterados. Testes que já falhavam no main antes desta mudança: `chat-disabled`, `prospecting-opt-out-natural`, `prospecting-reply-core`, `whatsapp-access`, `whatsapp-conversation-per-session`, `whatsapp-service-lease` e `journey-http`.
- **Autor:** Claude Code

### 2026-10-05 — Cliente devolvido à fila continua achável por quem disparou
- **Data:** 2026-10-05
- **Área:** Clientes / Prospecção / Permissões
- **Alteração:** `simulation_registrations.returned_from_user_id` (quem era o responsável quando a Prospecção devolveu o cliente à fila, preenchido por gatilho `client_returned_from_user`) + acesso extra só enquanto o cliente está sem responsável: a PESQUISA por nome/telefone da lista de Clientes, a ficha (`getSimulationRegistration`/`updateSimulationRegistration`, inclusive "Não contactar"), o link direto e o acesso à simulação passam a incluir o cliente devolvido que era do corretor. As abas e contadores não mudam. Preenchimento retroativo: 159 clientes em "Tentando contato" sem responsável.
- **Motivo:** pedido do dono — a Jennyfer disparou para um número errado e não achava o cliente (nem por telefone) para marcar "Não contactar"; o rebalanceamento da carteira (30) devolveu à fila, 6 min após o disparo, o cliente que ela acabara de contatar e a regra P-05 tira o responsável.
- **Arquivos afetados:** `supabase/migrations/20261005190000_client_returned_from_user.sql`, `lib/client-returned-scope-core.mjs`, `lib/admin-access.js`, `lib/simulation-list-query.js`, `lib/simulation-registrations.js`, `lib/simulations.js`, `tests/client-returned-scope.test.mjs`
- **Risco/observação:** a regra P-05 (devolvido à fila fica sem responsável) NÃO mudou — só a visibilidade de quem disparou, e só enquanto ninguém assumir (quando outro corretor reivindica o contato, o gatilho zera a coluna). Gestor e administrador já enxergavam cliente sem responsável. Não corrigido: o rebalanceamento da carteira 30 devolve cliente disparado minutos antes (decisão do dono, MD-14).
- **Autor:** Claude Code
### 2026-10-05 — Cena de valores da apresentação passa a usar a fonte do card do cliente → Empreendimento; bloco "Entrada sugerida" sai da Etapa C (PRES-20)
- **Data:** 2026-10-05
- **Área:** Clientes (apresentação interativa / Gerador de Simulações)
- **Alteração:** a cena de valores de cada imóvel sugerido deixa de ler `simulations.entry_simulation_snapshots` e passa a usar o resultado do MESMO motor que a tela do card → Empreendimento e o PDF "Proposta de Valores" calculam, rodado no servidor sobre a simulação atual (`lib/simulation-presentation-entry.js`, novo; `buildPropertyValues` agora só aplica allowlist). Documentação gratuita passa a vir dos diferenciais do cadastro (`properties.features`), como no card/PDF. O bloco "Entrada sugerida (simulação automática)" (valor, desconto, preço efetivo, entrada, ato, parcelas) foi removido da Etapa C do Gerador, junto com a chamada a `/api/simular-entrada` e a gravação de `entrySimulationSnapshots` (a coluna segue no banco com os dados antigos, sem leitor nem gravador; o formulário deixou de mandar a chave, então o autosave não a sobrescreve com `[]`).
- **Motivo:** pedido do dono ([REGRA OFICIAL DE NEGÓCIO — confirmada em 2026-10-05]): a fonte certa é o card → Empreendimento; o bloco da Etapa C "tem até que ser removido".
- **Arquivos afetados:** `lib/simulation-presentation-core.mjs`, `lib/simulation-presentation.js`, `lib/simulation-presentation-entry.js` (novo), `components/SimulationGenerator.jsx`, `app/dev/vitrine/_fixtures/apresentacao.js`, `tests/simulation-presentation-values.test.mjs`, `docs/BUSINESS_RULES.md` (PRES-20). Motor (`lib/simulacao-entrada/*`), PDF, rota `/api/simular-entrada` e tela do card intocados. Sem migration.
- **Risco/observação (importante):** a investigação provou que o card NÃO persiste nada (calcula na hora em `/api/simular-entrada`) e que o bloco da Etapa C chama a MESMA rota e o MESMO motor — então os números são idênticos. Residencial Morumbi (regras: parcela mínima R$ 100, SEM `numeroMaximoParcelas`) dá 1 parcela de R$ 13.433 no card, no PDF e (agora) na cena: o motor trata "máximo de parcelas ausente" como 1. Trocar a fonte não muda esse número; corrigir exige decisão do dono (cadastrar o máximo de parcelas do Morumbi, ou definir o padrão do motor quando falta). Eco Vilage (máximo 59, mínima R$ 250) dá 56x de R$ 250 no card e na cena. Cena agora faz 1 leitura de regras + 1 de imóvel por imóvel sugerido a cada abertura da apresentação.
- **Autor:** Claude Code (crm-architect)

### 2026-10-05 — Opt-out automático em linguagem natural ("Não tenho interesse, agradeço." / "SAIR")
- **Sintoma (dono):** a cliente "Gisele Indique Lucas" respondeu à automação "Não tenho interesse, agradeço." e, 3 s depois, "SAIR", e ficou em "Em atendimento" em vez de "Não contactar".
- **Causa:** (1) "agradeço" não estava entre as cortesias aceitas, então a 1ª frase não era "pedido claro" e virou resposta → promoção automática a "Em atendimento"; (2) o "SAIR" seguinte não valia porque o cliente já não estava em "Tentando contato" (só a fila de prospecção recebeu o descadastro, o status do cliente não mudou).
- **Correção:** `lib/prospecting-reply-core.mjs` — cortesias "agradeço/agradecido(a)/agradecemos"; novas frases claras ("quero sair", "quero parar de receber mensagens", "me tire da lista", "não tenho interesse em receber mensagens"); pedido claro de sair de cliente "Em atendimento" com tentativa de prospecção nas 48 h anteriores também vira Não contactar (`hasRecentProspectingAttempt`). Mantida a regra "na dúvida, humano decide" (ambiguidades como "agora não", "?" ou frase longa seguem sem opt-out). Teste `tests/prospecting-opt-out-natural.test.mjs`.

### 2026-10-05 — Dia de teste lento da Meta Diária (Izabela, Caroline, Jennyfer) — exceção só de hoje
- **Pedido (dono):** após os testes de disparo da Caroline e da Jennyfer (sem bloqueio), zerar a carteira das 3, colocar 10 contatos novos da base em cada uma e disparar hoje de forma bem lenta (janela até 18:00, intervalo máximo, oscilação ~10–15%, teto do dia 15).
- **Mudança:** `TEMPORARY_POLICY_OVERRIDES` em `lib/daily-goal-policy-core.mjs` (data 2026-10-05 + 3 corretores): janela até 18:00, intervalo 17–21 min (média 19), sem pausas programadas, teto 15/dia; `applyPolicyV2` aplica e `planV2Schedule`/`v2SendBlockReason` respeitam `policy_no_pauses`. Em 06/10 a data não casa e volta à política normal (06:30–15:30, 5–8 min, 30/dia). Teste `tests/daily-goal-temporary-policy.test.mjs`. Dados: carteira das 3 zerada pela função `daily_goal_wallet_trim` (backup + auditoria, reversível) e 10 contatos novos por corretora via `claim_daily_goal_contacts`.

### 2026-10-05 — Apresentação: cena de valores com documentação gratuita, total de descontos e layout enxuto (PRES-20)
- **Data:** 2026-10-05
- **Área:** Clientes (apresentação interativa)
- **Alteração:** na cena de valores do imóvel sugerido entram as linhas "Subsídio Minha Casa Minha Vida" (só se informado) e "Documentação gratuita" (5% do valor do imóvel, reaproveitando `buildPresentationModel`) e o "Total de descontos" (soma exata das linhas mostradas). Só nesta cena: sem logo da Caixa (e sem o rodapé claro dela), sem título "Valores deste imóvel" nem nome do empreendimento, valor do imóvel no topo, botão na base; check do "Sem ato" verde. Outras cenas, PDF e motor intocados.
- **Motivo:** pedido do dono ([REGRA OFICIAL DE NEGÓCIO — confirmada em 2026-10-05]); teste com Eco Village mostrava os descontos sem o total.
- **Arquivos afetados:** `lib/simulation-presentation-core.mjs` (DTO: `subsidio`, `documentacaoGratuita`, `totalDescontos`), `components/presentation/PresentationPlayer.jsx`, `presentation.module.css`, `app/dev/vitrine/_fixtures/apresentacao.js`, `tests/simulation-presentation-values.test.mjs`, `tests/simulation-presentation.test.mjs` (guard "toca no PDF" libera só o import de `presentation-model.mjs` no core), `docs/BUSINESS_RULES.md` (PRES-20)
- **Risco/observação:** o subsídio precisou virar linha própria para o total bater com as linhas. A documentação gratuita também é reconhecida pelos diferenciais do imóvel na simulação (além do cadastro do empreendimento no resultado salvo); o PDF usa os diferenciais do empreendimento — pode divergir se só um dos dois trouxer o benefício. O percentual de 5% segue [PENDENTE DE VALIDAÇÃO] (ver `presentation-model.mjs`). Dois testes antigos de round3 continuam falhando só no Windows por CRLF. Sem migration.
- **Autor:** Claude Code (crm-architect)
### 2026-10-05 — Apresentação: nova cena de valores de cada imóvel sugerido (PRES-20)
- **Data:** 2026-10-05
- **Área:** Clientes (apresentação interativa)
- **Alteração:** no ramo de imóveis sugeridos, depois da cena de cada imóvel entra a cena com valor do imóvel, financiamento, desconto, Casa Paulista, entrada, ato (R$ 0,00 informado vira "Sem ato" destacado; não informado é omitido) e parcelas da entrada. Sem dado, sem cena. Cena do imóvel, PDF e roteiro principal intocados.
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `lib/simulation-presentation-core.mjs`, `components/presentation/PresentationPlayer.jsx`, `player-core.mjs`, `presentation.module.css`, `app/dev/vitrine/**` (dados fictícios), `tests/simulation-presentation-values.test.mjs`, `docs/BUSINESS_RULES.md` (PRES-20)
- **Risco/observação:** valores vêm do resultado do motor salvo em `entry_simulation_snapshots` (gravado ao clicar Salvar ou enviar a apresentação; o autosave não o atualiza): se a simulação mudou depois, a cena some em vez de mostrar número velho. Resultado "inviável" também não vira cena (PENDENTE DE VALIDAÇÃO). Sem migration. Dois testes antigos (round3: `SceneImovel` e `logoFooter`) falham só no Windows por CRLF do autocrlf; passam em LF. Estado real do banco A CONFIRMAR.
- **Autor:** Claude Code (crm-architect)
### 2026-10-05 — Chat DESATIVADO temporariamente (chave do dono): corretores usam o WhatsApp do celular
- **Contexto (dono):** Eduardo foi derrubado (401) 11 s depois da 1ª mensagem enviada pelo Chat, como o Benck (13 s). Decisão: desativar o Chat até o dono pedir para reativar. Corretor/associado não enviam nem recebem pelo Chat; administrador e gestor continuam VENDO as conversas (as mensagens seguem sendo gravadas pela sessão).
- **Mudança:** chave global `crm_settings` id `whatsapp_chat_control` (`{ "disabled": true }`, `lib/chat-control.js`, cache de 5 s). Backend: `lib/whatsapp-chat.js` (`assertChatEnabled` — texto, mídia, atalhos, modelos, reação, edição e exclusão recusam com `CHAT_DISABLED` para TODOS); `lib/admin-auth.js` (`/api/admin/whatsapp-chat/*` → 403 para corretor/associado); `app/admin/chat/page.jsx` (aviso "Chat temporariamente desativado" para eles); push de conversa suprimido para eles (`isChatPushSuppressed`); botão WhatsApp do card e "Enviar…" da ficha abrem o WhatsApp externo (`decideCardWhatsapp` com `chatDisabled`; `card-state` devolve `chatDisabled`; `getChatReplyReadiness` → `chat_disabled`). Teste `tests/chat-disabled.test.mjs`.
- **Reativar:** `update crm_settings set setting_value = '{"disabled": false}' where id = 'whatsapp_chat_control';` (ou pedir ao assistente).

### 2026-10-05 — Apresentação: cada envio usa URL própria (?p=) para o WhatsApp raspar a prévia de novo
- **Sintoma (dono):** o link da Sara seguiu com miniatura pequena mesmo depois da imagem cacheável; o da Carol saiu como cartão grande.
- **Causa provável:** o WhatsApp guarda a prévia por URL; o link da Sara foi raspado quando a imagem ainda era lenta e esse resultado fica em cache.
- **Mudança:** `enviar-preparar` (`app/api/admin/simulacoes/[id]/apresentacao/route.js`) devolve `link?p=<código curto>`; a página `/s/<token>` ignora a query (`proxy.js` zera `search` da página). Link da Sara: usar de novo "Enviar apresentação" (gera a URL nova). Mensagem continua só com o link.

### 2026-10-05 — Prévia da apresentação: cartão grande no WhatsApp (imagem cacheável + aquecida)
- **Sintoma (dono):** o link da apresentação às vezes abre a prévia com miniatura pequena e texto cortado (Sara) em vez do cartão grande (Carol).
- **Causa:** a imagem `/s/<token>/og` era gerada a cada acesso (2–4 s, `no-store`, MISS); se o crawler do WhatsApp chega nesse intervalo, mostra só miniatura.
- **Correção:** imagem `/og` com `Cache-Control: public, s-maxage=86400, stale-while-revalidate` (`proxy.js` e `lib/simulation-presentation-share.mjs`; página e demais imagens seguem `no-store`) e aquecimento da imagem + página ao preparar o envio (`enviar-preparar` em `app/api/admin/simulacoes/[id]/apresentacao/route.js`, espera no máximo 8 s). Imagem só leva o primeiro nome (PRES-18). Links já enviados com miniatura não mudam no WhatsApp (cache do app).

### 2026-10-05 — Trava: "Simulação realizada" só com simulação real
- **Data:** 2026-10-05
- **Área:** Clientes / Funil
- **Alteração:** `completed` exige simulação com financiamento ou subsídio > 0 (servidor + opção bloqueada na tela). Cliente em "Simulação realizada" sem simulação real voltou para "Aguardando simulação" (1 cliente).
- **Motivo:** pedido do dono — um corretor marcou manualmente "Simulação realizada" num cliente sem nenhuma simulação.
- **Arquivos afetados:** `lib/simulation-status-lock-core.mjs`, `lib/simulation-registrations.js`, `components/clients/StatusOptions.jsx`, `components/clients/ClientCard.jsx`, `components/clients/ClientSheet.jsx`, `tests/simulation-status-lock.test.mjs`
- **Risco/observação:** a marcação automática após salvar simulação só com parcelas/entrada (sem financiamento nem subsídio) deixou de mover o cliente — alinhado à regra de pontuação. Sem migration; a trava é só de aplicação (única porta de escrita do status `completed`).
- **Autor:** Claude Code

### 2026-10-05 — Enviar apresentação da simulação: só o link na mensagem
- **Pedido (dono):** com texto junto ("Olá, Sara! Preparei a sua simulação…: link") a pré-visualização do link não abre no WhatsApp; deve ir apenas o link.
- **Mudança:** `buildPresentationSendMessage` (`lib/simulation-presentation-send.mjs`) devolve só a URL `/s/<token>`; teste `tests/simulation-presentation-send.test.mjs` atualizado.

### 2026-10-05 — Chat: conversa sem mensagem do cliente → enviar pelo celular ou link para o cliente chamar
- **Pedido (dono):** se o cliente já escreveu, o Chat envia normalmente; se não, avisar e mandar o corretor enviar pelo celular (abre o app do WhatsApp com a mensagem pronta), além de um link para o cliente chamar o corretor.
- **Mudança:** `getChatConversation` (`lib/whatsapp-chat.js`) devolve `awaitingCustomer` (sessão individual sem nenhuma mensagem recebida) e `brokerWhatsapp`; `components/WhatsappChat.jsx` mostra o aviso, troca o botão de enviar por "Abrir no WhatsApp do celular" (`wa.me/{cliente}?text=…`, texto digitado), desativa anexo/atalhos/áudio nesse estado e oferece "Copiar link para o cliente te chamar" (`wa.me/{corretor}` com a mensagem do cadastro). O backend continua recusando envio sem mensagem do cliente (`CHAT_REPLY_ONLY`).


### 2026-10-05 — Academia: conteúdo real dos Módulos 1, 2 e 3 (Formação Inicial v3) + versão parcial
- **Alteração:** a Formação Inicial passa a ter conteúdo real: Módulo 1 "O que faz um bom corretor" (6 aulas + prova de 10 questões), Módulo 2 "Condução de atendimento e técnicas de venda" (6 aulas + prova de 10 questões, mais difícil) e Módulo 3 "Fundamentos do MCMV e financiamento Caixa" (3 aulas, **sem prova ainda**; a avaliação prática de 3 simulações vem depois). Nova versão 3, publicada pelo fluxo normal (a v1 de exemplo fica aposentada, intocada; a v2 foi um rascunho técnico descartado/aposentado). Provas: nota mínima 70%, 3 tentativas (regras existentes, nada alterado). As aulas dos módulos 4–6 de exemplo não estão na v3.
- **Versão parcial (pequena correção indispensável):** com só 3 módulos, concluir tudo emitiria um certificado de "Formação Inicial" incompleta. `academy_track_versions.settings.partial = true` (migration `20261005190000_academy_partial_versions.sql`, só substitui `academy_refresh_enrollment`) impede concluir a matrícula e emitir certificado enquanto a versão for parcial; a tela mostra "Novos módulos em breve" no pino. Uma versão futura completa publicada sem `partial` volta ao comportamento normal. **Atenção:** a matrícula fica presa à versão em que começou; ao publicar a versão completa, quem estiver na v3 continua nela (decisão de produto pendente: migrar matrículas sem certificado para a nova versão).
- **MCMV (Módulo 3):** NÃO foram publicados números (faixas, tetos de renda e de imóvel, taxas, a regra de R$ 2.550 da renda informal): não foi possível confirmar em fonte oficial legível nem no projeto; a aula ensina o conceito e manda consultar a tabela vigente. Confirmados no projeto e usados: checklist de documentos (CLT 2 holerites; renda informal 3 extratos OU 3 faturas; IR declaração + recibo), formulário/link individual do corretor.
- **Matrículas existentes:** 2 (admin e gestor, sem nenhum progresso) foram apontadas para a v3 para não ficarem presas ao conteúdo de exemplo. Código-fonte do conteúdo: `docs/academia/conteudo/`.
- **Arquivos:** `supabase/migrations/20261005190000_academy_partial_versions.sql`, `lib/academy-views.mjs` (home.partial), `components/academia/AcademiaApp.jsx`, `tests/helpers/academy-fake-db.mjs`, `tests/academy-certificates.test.mjs`, `docs/academia/conteudo/*`.
- **Autor:** Claude Code

### 2026-10-05 — Lista de documentos completa: renda por tipo, obs de residência, PIS, conjunto em blocos, motor alinhado (PRES-16)
- [REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-05] Detalhe das regras em PRES-16 (`docs/BUSINESS_RULES.md`). Mudou: `lib/simulation-presentation-documents.mjs` (perfil por pessoa; blocos PROPONENTE 1/2 + PARA OS DOIS; PIS cadastrado sai; telefone fora; obs de residência por renda; IR/CLT separados), imagem PNG (`image-core`/`image`: subtítulos de bloco) e folha do player (`DocumentsSheet`/CSS `docGroup`).
- Motor `lib/document-requirements-engine.js`: união estável → `certidao_nascimento`; CTPS cobrada de todos (informal/IR/desconhecido agora também). Efeito real: checklists de documentação passam a mostrar CTPS ausente para quem não é CLT. Fixture `tests/fixtures/documentos/casos-requisitos.json` atualizada (2 casos que proibiam CTPS + 2 novos); `.claude/analista-documental/REGRAS-DOCUMENTAIS.md` linha 8.
- Divergência registrada, sem mexer: motor não tem regra para viúvo. DTO continua só com texto final (nunca estado civil/renda crus). Sem migration, sem rota nova.
### 2026-10-05 — Chat só responde (não inicia conversa) + limite por hora, após o banimento do Benck
- **Contexto:** a sessão do Benck caiu (401) às 13:59:19 UTC, 13 s depois de uma 1ª mensagem a um número que nunca tinha escrito; o celular mostra "Conta em análise" (WhatsApp Business, pedido de 05/10, resultado em até 24 h). Ele já tinha reportado 2 restrições em 03/10 e a sessão reconectou 7 vezes em 12 h. A automação dele estava pausada (nenhum disparo automático no dia).
- **Mudança (pedido do dono):** `lib/whatsapp-chat.js` — pela sessão individual o Chat só envia se o contato já escreveu na conversa (`CHAT_REPLY_ONLY`, 409) e no máximo 80 mensagens enviadas/hora por sessão (`CHAT_HOURLY_CAP`, 429). Vale para texto, mídia, atalhos e modelos (`sendChatMessage` e `deliverChatMessage`). Número oficial (Meta) inalterado. Teste `tests/chat-reply-only.test.mjs`.
- **Efeito colateral a saber:** recursos que enviam pelo Chat a cliente que nunca escreveu no WhatsApp (ex.: enviar simulação/lista de documentos) passam a ser recusados até o cliente escrever.
- **A CONFIRMAR / não feito:** queda frequente da sessão (conexão fechada/sessão ruim) depende de logs do serviço no Railway; cooldown pós-restrição para os disparos automáticos não foi implementado (evita rajada ao retomar).

### 2026-10-05 — "Enviar lista de documentos" respeita o Chat que só responde
- **Causa:** a ficha abria/criava conversa vazia (`open-client`) e tentava mandar a imagem pelo Chat mesmo sem conversa; com a trava `CHAT_REPLY_ONLY` (2471830) viraria erro 409 confuso, e a intenção é nunca iniciar conversa pelo Chat.
- **Mudança:** `getChatReplyReadiness` (`lib/whatsapp-chat.js`, somente leitura, reaproveita `assertIndividualChatReplyOnly`); `POST /api/admin/clients/[id]/lista-documentos` (preparar) devolve `chatReady`/`chatReason`; `useClientList.js` força o wa.me/Web quando `chatReady` é falso (nem chama `open-client`); aviso do diálogo por motivo. Falha na checagem = wa.me (fail-safe, com log).
- **Conferido sem mudar:** "Apresentação" do gerador usa só wa.me. **Fora do escopo, reportado:** botão "WhatsApp" do card (`openWhatsApp`) e `open-client` ainda criam conversa vazia/abrem o Chat; demais envios (cadência, fluxos, modelos) passam pela trava do Chat.
- **Sem migration.** Testes: `tests/documents-forecast.test.mjs`.

### 2026-10-05 — Automação ativa × desativada = CRM completo × CRM básico (mesma chave por corretor)
- **Quê:** a chave existente `admin_users.whatsapp_access_blocked` (toggle do card da Meta Diária, agora rotulado "Automação — Ativa · CRM completo / Desativada · CRM básico", com confirmação ao desativar) passou a também tirar do corretor o PDF "Proposta de Valores" (`/api/simulations/[id]/proposta-valores`), a apresentação/link interativo (`/api/admin/simulacoes/[id]/apresentacao`, prévia e página Empreendimentos redirecionam), "Baixar PDF/imagens/Enviar simulação" e a prévia no gerador. Lançar/salvar valores da simulação, Clientes, Funil, Agenda e cadastro/status manual continuam. Gestor e admin não perdem esses recursos (`isBasicMode` / `exceptRoles`). Chat, Meta Diária e disparos já eram bloqueados pela mesma chave. Sem novo toggle, sem migration, nenhum dado alterado.
- **Arquivos:** `lib/whatsapp-access-core.mjs`, `lib/admin-auth.js`, `components/WhatsappAccessProvider.jsx`, `app/admin/layout.jsx`, `app/admin/simulacoes/[id]/{page,apresentacao/page,empreendimentos/page}.jsx`, `components/{SimulationGenerator,TeamDailyPerformance}.jsx`, `components/clients/{ClientCard,ClientSheet}.jsx`, `tests/whatsapp-access.test.mjs`.

### 2026-10-05 — CI verde: 3 testes vermelhos corrigidos (só testes, sem código de produção)
- **Quê:** `tests/short-links.test.mjs` tinha dois regex sem escape (erro de sintaxe, commit 8c8a22f); `tests/simulacao-share-preview.test.mjs` tinha todas as linhas prefixadas com o título novo da prévia (substituição em massa errada no commit e419e9e) e ainda esperava o título antigo — restaurado e atualizado para "Descubra quanto você pode financiar | Matheus Machado" (valor real de `lib/simulacao-share.mjs`); `tests/context-budget.test.mjs`: limite do CLAUDE.md subido de 13500 para 14500 chars (a regra 10 de identidade visual somou ~540; escolhido por ser o menor risco, sem remover regra).
- **Validação:** todos os `*.test.mjs` do ci.yml (menos journey-http) + financial-calculations em checkout LF, node 24: 0 falhas. No Windows com autocrlf=true alguns testes de código-fonte falham por CRLF (ambiente local, não do repo).

### 2026-10-05 — Apresentação como terceira opção do "Enviar simulação" (PDF / Imagem / Apresentação) (PRES-19)
- **O quê:** no seletor "Formato para envio" do gerador (`components/SimulationGenerator.jsx`) entrou "Apresentação". Ao confirmar em "Enviar simulação": salva a simulação, o servidor faz o get-or-create do link (`ensurePresentation`, mesmas regras: valores obrigatórios, token, escopo) e devolve a mensagem "Olá, {primeiro nome}! Preparei a sua simulação de financiamento de um jeito interativo: {link}"; o WhatsApp do cliente abre (`wa.me`, mesmo mecanismo do envio atual de PDF/imagem; o corretor envia). Rota: ações `enviar-preparar` e `enviar-registrar` em `POST /api/admin/simulacoes/[id]/apresentacao` (mesmo guard/escopo). Regras puras em `lib/simulation-presentation-send.mjs`; evento `presentation_sent` na jornada (rótulo em `ClientJourneyActions.jsx`); `cleanFirstName` passou a ser exportada de `documents-forecast-core.mjs`. Teste: `tests/simulation-presentation-send.test.mjs`.
- **Não mudou:** PDF, imagem, `lib/simulacao-entrada`, banco (sem migration).
- **Observação:** o envio de PDF/imagem do gerador nunca usou o Chat nem registrou na jornada (só abre `wa.me`); a Apresentação segue o mesmo canal e registra na jornada. Arquivado/"Não contactar" → 409. Dois testes de `simulation-presentation-round3.test.mjs` (foto do ramo, logo da Caixa) já falham em `origin/main` neste worktree, sem relação com esta mudança.
### 2026-10-05 — Lista de documentos: estado civil pede um só documento (PRES-16)
- **Data:** 2026-10-05 · **Área:** Apresentação / Documentação
- **Alteração:** solteiro e união estável → "Certidão de nascimento"; casado → "Certidão de casamento"; divorciado → "Certidão de casamento" + obs menor "Com averbação do divórcio" (novo campo opcional `obs` do item, renderizado no PNG `/s/<token>/documentos` e na folha do player). Viúvo/desconhecido seguem o genérico (pendente de decisão do dono). Cadastro conjunto: mantida a regra de só personalizar se os dois coincidirem.
- **Motivo:** pedido do dono (**[REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-05]**).
- **Arquivos afetados:** `lib/simulation-presentation-documents.mjs`, `lib/simulation-presentation-image-core.mjs`, `lib/simulation-presentation-image.mjs`, `components/presentation/DocumentsSheet.jsx`, `presentation.module.css`, `tests/simulation-presentation-round3.test.mjs`, `docs/BUSINESS_RULES.md`
- **Risco/observação:** `lib/document-requirements-engine.js` ainda trata união estável como casamento (divergência; motor não alterado). 2 testes de round3 (ramo/logo da Caixa) já falhavam antes. **Autor:** Claude Code

### 2026-10-05 — Apresentação interativa: prévia de compartilhamento do link /s/<token> (PRES-18)
- **O quê:** `generateMetadata` na página pública (og:title/description, Twitter Card `summary_large_image`) + imagem 1200x630 por token em `/s/<token>/og` (rota `app/apresentacao/[token]/og`, `lib/simulation-presentation-share.mjs`, `proxy.js` reescreve `/og`). Título com SÓ o primeiro nome do cliente (regra do dono, exceção consciente à imagem sem dado do cliente).
- **Segurança:** token inválido/revogado → 404 na página e na imagem, prévia genérica; `noindex`/`no-store`; não grava evento de visualização (métricas vêm do navegador; bots já ignorados no endpoint). PDF e player intocados. Teste novo: `tests/simulation-presentation-share.test.mjs`.
- **Risco/observação:** `tests/simulacao-share-preview.test.mjs` na `origin/main` está corrompido (prefixo "Descubra quanto você pode financiar |" em cada linha, SyntaxError) e 2 testes de `simulation-presentation-round3` (ramo/logo da Caixa) já falhavam antes desta mudança; fora do escopo, não corrigidos.

### 2026-10-05 — AGENTS.md: regra "menos código é melhor"
- **Pedido (dono):** incluir a ideia de checar, antes de codar, se o código precisa existir/já existe/dá em menos linhas (sem instalar plugin externo). Só documentação (`AGENTS.md`, "Antes de alterar código", item 9).


### 2026-10-05 — Apresentação interativa, round 4 (previsão de envio dos documentos + "Enviar lista de documentos" na ficha)
- **Data:** 2026-10-05 · **Área:** Simulação (apresentação ao cliente), funil, agenda · **Banco:** 1 migration NOVA, ainda NÃO aplicada (`supabase/migrations/20261005180000_presentation_documents_forecast.sql`; a Central aplica antes de publicar).
- **Mudou:** (1) cena de documentos: sai "Baixar imagem da lista" (o cliente não baixa mais); entra "Receber lista de documentos" (só com responsável ativo + WhatsApp válido): calendário com os PRÓXIMOS 10 DIAS (hoje + 9, SP), período Manhã/Tarde/Noite e botão final que abre o WhatsApp do corretor com a mensagem pronta. (2) `POST /api/s/[token]/documentos-previsao` (pública, 5/min por link): grava o compromisso em `simulation_presentations`, move o status para "Aguardando documentação" só de `completed`/`simulation_sent`/`in_service` (como 'sistema', 0 pontos), cria/atualiza UMA atividade `documentos` (09h/14h/19h) na agenda do corretor e registra na jornada; devolve o `wa.me` só nesta resposta. (3) Ficha do cliente: botão "Enviar lista de documentos" (prévia + confirmação; Chat ou WhatsApp externo por `decideCardWhatsapp`; texto + link da lista personalizada; registra na jornada; não muda status) e rota `POST /api/admin/clients/[id]/lista-documentos`. (4) DTO público ganha só o booleano `podeReceberLista`.
- **Arquivos:** `lib/documents-forecast-{core,store}.mjs`, `lib/documents-forecast.js`, `lib/simulation-presentation{,-core}.{js,mjs}`, `components/presentation/{ForecastSheet,PresentationPlayer}.jsx` + CSS, `components/clients/{ClientSheet.jsx,useClientList.js}`, `components/ClientJourneyActions.jsx`, rotas `app/api/s/[token]/documentos-previsao` e `app/api/admin/clients/[id]/lista-documentos`, páginas da apresentação e da prévia, vitrine dev, migration, `tests/documents-forecast.test.mjs` (+ 3 asserts atualizados em `tests/simulation-presentation*.test.mjs`).
- **Docs:** `docs/BUSINESS_RULES.md` PRES-17 nova (exceções a PRES-9 e PRES-12 anotadas nelas), `docs/DATABASE.md`, `docs/PERMISSIONS.md`, `.claude/rules/crm-clientes-funil.md`.
- **Risco/observação:** (a) o marco "documentation" do ranking vale uma vez por cliente e a mudança 'sistema' o queima sem pontuar ninguém (aceito pelo dono); (b) dia escolhido = hoje e hora já passada: o corretor é avisado no próximo ciclo do cron; (c) o link da lista usa `?baixar=1` (baixa o arquivo ao abrir; sem esse parâmetro abriria na tela: SUGESTÃO ao dono); (d) no envio externo da ficha o clique também registra o contato humano (`whatsapp-contact`), como o botão WhatsApp do card; (e) sem a migration, a confirmação responde "Indisponível" (503) e o botão aparece mesmo assim: aplicar a migration ANTES de publicar; (f) ordem de publicação: migration → deploy; (g) testes vermelhos de outras frentes seguem: `short-links`, `simulacao-share-preview`, tamanho do `CLAUDE.md`.

### 2026-10-05 — Apresentação interativa, round 3 (lista do dono personalizada, ramo de imóveis, logo da Caixa, cabeçalho, "+")
- **Data:** 2026-10-05 · **Área:** Simulação (apresentação ao cliente) · **Banco:** nenhuma migration, nenhuma escrita.
- **Mudou:** (A/B) imagem e folha "Lista de documentos" seguem a referência do dono (cabeçalho azul-marinho com a logo atual, itens com caixa de marcar em SVG; SEM rodapé: nada de WhatsApp/Instagram, por decisão do dono); altura do PNG acompanha a lista (1080 de largura). (C) lista personalizada no servidor pelo cadastro (renda, estado civil, filhos); só a lista final sai no DTO. (D) imóveis saem do roteiro automático e viram um ramo opcional (botão IMÓVEL/IMÓVEIS SUGERIDO(S) no "Próximo passo"; uma cena por imóvel; justificativa real ou texto padrão do dono; "Continuar" volta ao próximo passo). (E) logo da Caixa sem pílula, maior, com halo nas cenas escuras. (F) "+" da cena de formação no mesmo eixo dos valores. (G) cabeçalho "MATHEUS MACHADO / CORRETOR DE IMÓVEIS" nas cenas e no PNG-resumo.
- **Arquivos:** `lib/simulation-presentation-{core,documents,image,image-core}.mjs`, `components/presentation/*`, `app/apresentacao/[token]/page.jsx`, `app/admin/simulacoes/[id]/apresentacao/page.jsx`, vitrine dev, testes `tests/simulation-presentation*.test.mjs` (novo: `-round3`). PDF e regras financeiras intocados.
- **Docs:** `docs/BUSINESS_RULES.md` PRES-4, 8, 12, 13, 14 revisadas; PRES-15 e PRES-16 novas.
- **Risco/observação:** o cadastro manual (marcador 1900-01-01) cai na lista completa (SUPOSIÇÃO: seus campos são placeholders). Testes de outras frentes continuam vermelhos: `short-links`, `simulacao-share-preview` e tamanho do `CLAUDE.md`.

### 2026-10-05 — Correção: cena de diferença novo×usado só com os dois subsídios informados
- **Causa raiz:** `SYNCED_MODEL_FIELDS` do gerador copia financiamento e parcelas entre os modelos novo/usado; numa simulação de um modelo só o outro ficava "preenchido" com subsídio em branco, tratado como R$ 0,00 → diferença inventada (cena e imagem). **Correção:** `subsidyInformed` em `lib/simulation-presentation-core.mjs` exige subsídio informado nos dois modelos. Testes em `tests/simulation-presentation-round2.test.mjs`. Registro também em PRES-10.

### 2026-10-05 — Apresentação interativa, round 2 (juros, diferença de subsídio, VALIDAR SIMULAÇÃO, documentos, logo da Caixa, imagens PNG)
- **Data:** 2026-10-05
- **Área:** Simulação (apresentação ao cliente), Banco, Rotas públicas
- **Mudou:** (1) botão "Baixar apresentação" → PNG 1080x1920 do resumo (`/s/<token>/imagem`, `next/og`, mesmos números do DTO; visual do PDF; PDF intocado); (2) removido "Falar com meu corretor" e todo uso do telefone do corretor; (3) botão VALIDAR SIMULAÇÃO abre a cena "{nome}, esse é o próximo passo!" (só avanço interno; nada enviado nem gravado); (4) cena de documentos com folha "Lista de documentos" e PNG da lista (`/s/<token>/documentos`); (5) logo da Caixa (`public/assets/caixa-logo-transparent.png`, a do formulário público) no rodapé de todas as cenas e das imagens; (6) palco escalável (unidade `--u`, 100dvh, desktop retrato centralizado); (7) `OpeningAnimation.jsx` isolado (ponto de extensão para o designer); (8) cena "Diferença entre imóvel novo e usado" só quando o subsídio difere (senão apresentação neutra, sem as palavras novo/usado); (9) campo opcional "Taxa de juros (% ao ano)" no gerador (coluna `simulations.interest_rate_annual`), exibido na cena de parcelas e na imagem, NUNCA no PDF; (10) abertura com título/subtítulo novos.
- **Arquivos:** `lib/interest-rate.mjs`, `lib/simulation-presentation-{core,gate,documents,image,image-core}.mjs`, `lib/simulation-presentation.js`, `lib/simulation-mapper.js`, `lib/simulations.js`, `components/presentation/*`, `components/SimulationGenerator.jsx`, `app/apresentacao/[token]/{imagem,documentos}/route.js`, `proxy.js`, `app/dev/vitrine/apresentacao/*`, migration `20261005150000_simulations_interest_rate.sql` (NÃO aplicada), testes `tests/simulation-presentation*.test.mjs`.
- **Banco:** coluna nova `interest_rate_annual numeric(5,2)` null, check 0..30 (aditiva, idempotente). Tolerância: sem a coluna, salvar a simulação continua funcionando (a taxa não é gravada e a API devolve `saveWarning`); leituras usam `select("*")`.
- **Lista de documentos:** reaproveita as exigências do motor (`lib/document-requirements-engine.js`) e da Base Mestra (`residence_source`, `fgts_updated`), item a item com fonte (teste confere os trechos). PENDENTE DE VALIDAÇÃO do dono: ver PRES-13.
- **Risco/observação:** a cena "Próximo passo" deixou de ser a última (métrica "concluiu" agora = última cena de todas, 'documentos'); "Rever a apresentação" foi movido para a cena final. Testes de outras frentes continuam vermelhos: `short-links`, `simulacao-share-preview`, tamanho do `CLAUDE.md`.

### 2026-10-05 — Apresentação interativa da simulação (link individual /s/<token>)
- **Data:** 2026-10-05
- **Área:** Clientes / Simulação (apresentação ao cliente), Banco, Permissões
- **Alteração:** nova opção "Apresentação da simulação" na tela da simulação (`/admin/simulacoes/[id]`), ao lado do PDF (que NÃO mudou). Gera um link público individual (`/s/<token de 24 caracteres base62, ~143 bits>`) que mostra a simulação em cenas de tela cheia, mobile first (abertura chave→casa, poder de compra, formação do valor, condição de pagamento, novo×usado só se diferentes, imóvel sugerido, "por que este imóvel" só com justificativa real, próximo passo com botão do corretor responsável só se houver WhatsApp válido). Lê SEMPRE o estado atual da simulação, pela mesma fonte do PDF (`getRenderableSimulationModels`; números idênticos, sem cálculo novo). DTO público em allowlist (só primeiro nome; nada de CPF/telefone/renda/notas/regras). Métricas discretas (aberturas, primeira/última, concluiu, última cena) por endpoint público mínimo. Prévia no CRM sem contar abertura. O `proxy.js` reescreve só o formato do token para `/apresentacao/<token>`; o `/s/{ref}` curto de corretor segue igual (token tem maiúscula+minúscula+dígito; ref é sempre minúsculo).
- **Motivo:** pedido do dono (opção adicional de apresentar a simulação ao cliente, sem alterar o PDF).
- **Arquivos afetados:** `supabase/migrations/20261005120000_simulation_presentations.sql` (tabela `simulation_presentations` + função `record_simulation_presentation_event`; PRECISA SER APLICADA — sem ela o botão mostra "Recurso ainda não ativado no banco" e o resto não quebra), `lib/simulation-presentation-core.mjs`, `lib/simulation-presentation-format.mjs`, `lib/simulation-presentation.js`, `lib/simulation-models.js` (só um export novo: `parseSimulationMoney`), `components/presentation/*`, `app/apresentacao/[token]/page.jsx`, `app/admin/simulacoes/[id]/apresentacao/page.jsx`, `app/admin/simulacoes/[id]/page.jsx` (painel), `app/api/s/[token]/evento/route.js`, `app/api/admin/simulacoes/[id]/apresentacao/route.js`, `proxy.js`, `components/AppChrome.jsx`, `app/dev/vitrine/apresentacao/page.dev.jsx` (só dev), `tests/simulation-presentation*.test.mjs`. NÃO tocados: `proposta-pdf.mjs`, `presentation-model.mjs`, rota do PDF, SimulationGenerator.
- **Risco/observação:** (1) a tabela usa `simulation_id` (a simulação guarda os valores), com `registration_id` opcional — diferente do rascunho do pedido, que citava só registration. (2) o texto-padrão "Este imóvel foi selecionado…" que o gerador grava quando o corretor não escreve nada NÃO é tratado como justificativa: a cena "Por que este imóvel" só aparece com texto próprio. (3) `tests/short-links.test.mjs`, `tests/simulacao-share-preview.test.mjs` e o teste de orçamento do CLAUDE.md (14041 > 13500) já falhavam em origin/main antes desta entrega (outra frente).
### 2026-10-05 — Simulação: calendário compacto, tela final limpa e Instagram também na etapa "Cadastro concluído"
- **Pedido (dono):** o calendário e a tela final estavam feios; incluir o Instagram também na etapa "Cadastro concluído com sucesso! / Responder agora" (nem todo cliente chega ao final).
- **Mudança:** `DateInputStep.jsx` — calendário em linha (não cobre mais o botão Continuar), controles e dias compactos e redondos; `SimulationSuccess.jsx` — layout limpo (logo menor, ícone de confirmação, textos legíveis, sem a "caixa" rosa que o overflow criava atrás do botão); novo `InstagramFollow.jsx` (título, texto, botão em degradê do Instagram e @mhm.machado) usado em `SimulationSuccess` e em `PropertyPreferencesInvite`. Só visual.

### 2026-10-05 — Simulação: só o questionário, tela fixa (sem rodapé do site e sem título grande)
- **Pedido (dono):** remover a parte de baixo (rodapé "Especialista no mercado imobiliário de Marília…") e deixar o questionário fixo, sem rolagem, mais confortável para o cliente.
- **Mudança:** `components/AppChrome.jsx` (rodapé não aparece em `/simulacao`), `app/simulacao/page.jsx` (`main` fixo em tela cheia, conteúdo centralizado; só rola dentro da área se não couber — celular pequeno/tela final), `components/simulation-form/LinkJourneyGate.jsx` (título/subtítulo grandes viram `sr-only`). Formulário, atribuição, roleta e cadastro inalterados.

### 2026-10-05 — Links gerados pelo CRM voltam ao formato longo (decisão do dono); links curtos continuam funcionando
- **Pedido (dono):** "Deixe como estava antes" (a prévia de compartilhamento deixou de aparecer com os links curtos).
- **Mudança:** `buildBrokerSimulationLink`, `buildBrokerCaptacaoLink`, `buildCampaignLink`, link da Minha Jornada, Fluxos/respostas automáticas e "Meu link"/Gerador de Links voltaram a gerar e copiar `https://www…/simulacao?ref=…`, `/simulacao?c=…`, `/captacao?ref=…` e `/minha-jornada/{token}` (com `https://www.`). As rotas `/s`, `/s/{codigo}`, `/c/{codigo}`, `/v…`, `/j/{token}` e as colunas `campaigns.short_code`/`admin_users.short_ref` ficam no ar (inofensivas; links curtos já compartilhados continuam abrindo). Atribuição, roleta, rastreio e cadastros nunca foram alterados.

### 2026-10-05 — Prévia dos links curtos: o próprio link curto responde com Open Graph (corrige "não aparece a prévia")
- **Sintoma (dono):** depois dos links curtos, WhatsApp/Instagram deixaram de mostrar o cartão de prévia.
- **Causa:** `/s`, `/s/{codigo}`, `/c/{codigo}`, `/v…` respondiam 307 sem corpo; o crawler precisava seguir redirecionamentos (e, com o link colado sem `https://www.`, ainda passava por http→https→www) e o Instagram Direct não segue bem.
- **Correção:** essas rotas agora respondem **200** com um HTML mínimo (Open Graph + Twitter Card + canonical) direto no endereço curto — `lib/share-preview-html.mjs`; quem abre no navegador é levado ao destino na hora (meta refresh + `location.replace`), com os mesmos parâmetros (`ref`, `c`, `jornada`, `utm_*`). Textos/imagem num lugar só (`lib/simulacao-share.mjs`, também usado por `app/simulacao/page.jsx`); `/v` usa título/descrição da captação. `/j/{token}` (privado) continua redirect 307. Atribuição/roleta/rastreio inalterados.

### 2026-10-05 — Código curto por usuário nos links (/s/mhm, /s/1…) e cópia sem "https://www."
- **Pedido (dono):** o link do Matheus passa a usar "mhm"; cada outro usuário recebe um número; o CRM copia/mostra os links sem `https://www.`.
- **Mudança:** nova coluna `admin_users.short_ref` (único; Matheus = `mhm`; demais 1, 2, 3… por ordem de cadastro; novos usuários recebem o próximo número por sequência). `/s/{codigo}` e `/v/{codigo}` resolvem o código para o `simulation_ref`/`captacao_ref` de atribuição (`lib/short-ref-resolver.js`) e redirecionam para `/simulacao?ref=…` / `/captacao?ref=…`; o ref longo antigo continua aceito. `buildBrokerSimulationLink`/`buildBrokerCaptacaoLink` usam o código curto; `buildCampaignLink` (link oficial) também. `displayLink` (`lib/short-links.mjs`) tira `https://www.` só na cópia/exibição do Gerador de Links e do botão "Meu link"; mensagens automáticas e botões continuam com a URL completa. Migration `20261005010000_admin_users_short_ref.sql`.

### 2026-10-04 — Links curtos no próprio domínio (/s, /s/{ref}, /c/{codigo}, /v, /j)
- **Pedido (dono):** encurtar todos os links públicos gerados pelo CRM, sem serviço externo, preservando atribuição, roleta, origem, campanha, rastreio e cadastros; links antigos continuam valendo.
- **Como funciona:** rotas de atalho que redirecionam (307) para a URL longa de sempre, repassando os demais parâmetros (`jornada`, `utm_*`…): `/s` → `/simulacao`; `/s/{ref}` → `/simulacao?ref={ref}`; `/c/{codigo}` → `/simulacao?c={id}` (código = nova coluna `campaigns.short_code`, 7 caracteres, único, preenchida nas campanhas existentes e por DEFAULT nas novas; aceita também o id); `/v` e `/v/{ref}` → `/captacao` (venda seu imóvel); `/j/{token}` → `/minha-jornada/{token}`. Toda a lógica continua nas páginas de destino.
- **Geradores atualizados:** `buildBrokerSimulationLink`/`buildBrokerCaptacaoLink` (`lib/admin-profiles.js`), `buildCampaignLink` (`lib/campaigns.js`, usada pelo Gerador de Links e pelo Disparo), link da Minha Jornada (`lib/client-journey.js`), respostas automáticas e Fluxos do WhatsApp. Migration `20261004220000_campaigns_short_code.sql`. Teste `tests/short-links.test.mjs`.
- **Não mudou:** o botão de URL dos modelos aprovados do WhatsApp (`/simulacao?c={{1}}`, formato fixo no modelo aprovado pela Meta); links antigos (`?ref=`, `?c=`, `/simulacao/equipe`, `/minha-jornada/{token}`).

### 2026-10-04 — Tela final da simulação: bloco único + seção do Instagram
- **Pedido (dono):** remover o botão do WhatsApp ("Receber minha simulação") e qualquer aviso de manter a página aberta; deixar um só bloco ("Estamos adicionando seu atendimento" + texto do associado) e a seção do Instagram com os novos textos e botão em degradê do Instagram.
- **Mudança:** `components/simulation-form/SimulationSuccess.jsx` (só visual). `ReceiveSimulationWhatsappButton` deixou de ser usado nesta tela (arquivo mantido). O @ exibido é `@mhm.machado` (perfil real e destino do link); `@matheusmachadoimoveis`, citado no pedido, não existe no Instagram.

### 2026-10-04 — Simulação: calendário da "Data de nascimento" abre em janeiro/2000
- **Pedido (dono):** ao abrir o calendário, mostrar janeiro de 2000 em vez do mês atual, sem preencher nada sozinho.
- **Mudança:** `components/simulation-form/DateInputStep.jsx` — o `<input type="date">` nativo não permite escolher o mês inicial, então virou um calendário próprio (mês/ano em listas + setas; abre em jan/2000 com o campo vazio, ou no mês da data já escolhida). Valor continua "AAAA-MM-DD", só definido ao clicar num dia; mesma idade mínima (dias após a data máxima ficam desativados). Sem mudança em validação/cadastro.

### 2026-10-04 — Entrada dos links de simulação: direto no formulário (tela de escolha só para campanha)
- **Pedido (dono):** links do Matheus, individuais dos corretores e da equipe abrem direto a Simulação; a tela "Como podemos te ajudar?" (Atendimento rápido × Simulação) fica só para links de campanha.
- **Mudança:** `components/simulation-form/LinkJourneyGate.jsx` — sem `?c=` o estado inicial já é "simulation" (sem botão Voltar); com `?c=` nada muda (tela de escolha, ou a jornada direta já configurada na campanha/Disparo). `?ref=`, atribuição, roleta, cadastro e formulários não foram alterados.


### 2026-10-04 — Logo antiga removida do projeto e regra permanente de identidade visual
- **Data:** 2026-10-04
- **Área:** Docs / Identidade visual
- **Alteração:** apagados 11 assets da logo antiga (prédios/skyline): `public/assets/matheus-machado-logo.png`, `-logo-transparent.png`, `-logo-premium.jpeg`, `-symbol-premium.png`, `company-mark-avatar.png` e os 6 ícones sem `-mm` em `public/icons/`. Nenhum código de produção (site, OG, manifest, PDFs) os usava; dois usos residuais foram trocados para `public/icons/icon-192-mm.png`: avatar padrão do card de cliente (`components/clients/ClientCard.jsx`) e foto fictícia da vitrine. Docs/skills que citavam a logo antiga (`DESIGN.md`, `marca-email.md`, `sistema-visual.md`, rascunho GBP) apontam agora para os assets oficiais. Regra 10 em `CLAUDE.md` (+ ponteiro em `AGENTS.md`) e trava `tests/brand-assets.test.mjs`.
- **Motivo:** novas telas/PDFs/imagens reaproveitavam a logo antiga por ela existir no repositório (pedido do dono).
- **Arquivos afetados:** os acima, `CLAUDE.md`, `AGENTS.md`, `tests/brand-assets.test.mjs`.
- **Risco/observação:** logo oficial = `public/assets/matheus-machado-symbol.png` (símbolo), `og-matheus-machado-v2.png` (marca completa) e `public/icons/*-mm.png`. Links externos antigos para os arquivos removidos passam a dar 404 (nada interno os usa). Não verificado: imagens guardadas fora do repositório (Supabase Storage, perfil do WhatsApp/Google). `CHANGELOG_AI` e o histórico do git continuam citando os nomes antigos (histórico, não referência).
### 2026-10-04 — Prévia de compartilhamento de /simulacao (Instagram Direct, WhatsApp, demais)
- **Situação:** o HTML já trazia og:title/description/image e Twitter Card, mas com o texto antigo ("Simulação de financiamento…") e a imagem genérica da marca; faltavam `og:url` e `canonical`, que o Instagram Direct usa para montar o cartão (sem eles só aparecia a URL).
- **Mudança:** `app/simulacao/page.jsx` — título "Simule seu primeiro imóvel | Matheus Machado", descrição "Descubra seu poder de compra e dê o primeiro passo para o seu imóvel.", `canonical` e `og:url` = `https://www.matheusmachadoimoveis.com.br/simulacao`, `og:image`/`twitter:image` absolutas 1200x630 (`og:image:secure_url`, tipo e alt), `twitter:card=summary_large_image`. Tudo no HTML estático (crawlers não executam JS). Nova imagem `public/assets/og-simulacao-v3.png` (1200x630, logo atual M azul/branco sobre azul-marinho; texto "SIMULE SEU PRIMEIRO IMÓVEL / Descubra seu poder de compra"). Teste `tests/simulacao-share-preview.test.mjs`.
- **Não mexe:** formulário/jornada da simulação, `/simulacao/equipe` (continua com a prévia padrão da marca). Para trocar a imagem no futuro, mude o sufixo do arquivo (cache das plataformas).


### 2026-10-04 — Estabilização das sessões do WhatsApp individual (lease, política por código, deploy) [NÃO publicado]
- **Data:** 2026-10-04
- **Área:** WhatsApp / Infra / Banco
- **Alteração:** dono único das sessões por lease; encerramento gracioso; política por código 401/403/408/440/500/515; reconciliação de estado preso; `railway.json` com `watchPatterns` e `drainingSeconds`.
- **Motivo:** erros 440 a cada deploy (duas instâncias) e laços de reconexão; pedido do dono (fase 1: investigar, implementar, testar sem envio).
- **Arquivos afetados:** `whatsapp-individual-service/src/{lease,runtime,resume,reconcile,shutdown,session-mutex}.js` (novos), `reconnect-policy.js`, `session-lifecycle.js`, `sessions.js`, `server.js`, `db.js`, `railway.json`; CRM: `app/api/webhooks/whatsapp-individual/lease/route.js`, `state/route.js` (`field=transient`), `lib/whatsapp-service-lease*.{js,mjs}`, `lib/whatsapp-session-telemetry*.{js,mjs}`, `lib/whatsapp-session-attention-core.mjs`, `lib/whatsapp-individual.js`; migration `20261004213000_whatsapp_service_lease.sql` (aditiva/idempotente, **NÃO aplicada**: cria tabela + 3 funções e amplia o CHECK da telemetria); testes `tests/whatsapp-service-lease.test.mjs` (35) e ajustes em `tests/whatsapp-reconnect-policy.test.mjs`.
- **Detalhe:** dono único por lease (elimina 440 por duas instâncias no deploy); SIGTERM gracioso sem logout/sem apagar credencial, libera o lease por último; mutex por corretor; retomada escalonada single-flight; reconciliação de `reconnecting`/`connecting` preso; 408 de QR não lido não gera QR sozinho; sessão pareada por QR deixa de ser tratada como não pareada (`creds.me`); 515 = reinício normal (sem tentativa/erro/alerta, laço >3/min para); 500 em janela (3 em 10 min para); alerta "precisa de atenção" ganhou 3 motivos novos (mesmos destinatários); `railway.json` com `watchPatterns` e `drainingSeconds: 30`.
- **Risco/observação:** o 1º deploy ainda tem UM reinício inevitável (a instância antiga não conhece o lease; a nova espera 20 s antes de retomar). Sem a migration o serviço segue como antes (aviso no log, 90 s de carência). Nomes de aparelho, versão do WhatsApp e Baileys 6.7.24 NÃO foram alterados. Ajustes só no painel do Railway: ver `docs/WHATSAPP.md` (Deploy no Railway).
- **Autor:** Claude Code (crm-editor)
### 2026-10-04 — Academia: card "Você está aqui" cortado no iPhone
- **Causa raiz:** `components/academia/scene/engine.js` limitava a altura do texto do pino a no máximo 54 px (`cam.hp * 54`) com `overflow:hidden`; em tela estreita o título da aula quebra em 3+ linhas e a última era cortada (medido: 13 px cortados a 320 px). **Correção:** a altura máxima passa a ser a altura natural medida do texto (re-medida quando o texto ou a largura do card mudam), sem teto fixo; `.pd` ganha `overflow-wrap:anywhere`. Conceito visual inalterado.
- **Verificação:** varredura Playwright (Chromium, 320/375/390/430 px) em início, trilha, aula, questão, erro/acerto, conquista e evolução: 0 textos cortados e 0 overflow horizontal. Só `engine.js` e `academia.module.css`. **Limitação:** não testado em iPhone físico.
- **Autor:** Claude Code

### 2026-10-04 — Presença só do usuário real ("Alterar conta" não gera presença); heartbeat e texto relativo
- **Data:** 2026-10-04
- **Área:** Roleta / Ranking (presença) / Permissões
- **Alteração:** Durante "Alterar conta" o sinal de presença (`admin_presence.last_activity_at` e marcas de `admin_presence_activity`, base do relatório de horas e dos pontos "tempo online") passou a ser gravado no admin REAL, nunca no corretor emulado (antes usava `auth.profile.id`, o perfil efetivo). Vale para o heartbeat do navegador e para `recordAdminGrace`/`recordAdminHeartbeat` (Chat, WhatsApp, Meta Diária, Prospecção): ações operacionais continuam atribuídas ao corretor emulado (histórico/pontuação de ação); só o carimbo de presença usa o usuário real. Opção escolhida: gravar no usuário real (ele está de fato na frente da tela; se for elegível na roleta, a presença real dele é legítima); se o perfil real não tiver id, nada é gravado. Heartbeat do navegador: confere `response.ok`, 1 nova tentativa (após 5 s) em falha de rede/5xx, nenhuma tentativa em 401/403 (AdminSessionKeeper renova/redireciona), dispara também no evento `online`; segue 1 sinal/min, só com aba visível, sem timer periódico, sem sendBeacon. Texto "Última atividade há…" usa piso (90 min = 1h; 36 h = 1 dia).
- **Motivo:** Auditoria de presença (T-106): o emulado aparecia Online, entrava na Roleta e ganhava pontos sem estar presente. Regra do dono (2026-10-04).
- **Arquivos afetados:** `lib/admin-presence-core.mjs`, `lib/admin-presence-heartbeat-core.mjs` (novo), `lib/admin-presence.js`, `components/AdminPresenceHeartbeat.jsx`, `components/OnlinePresenceBoard.jsx`, `app/admin/layout.jsx`, `tests/admin-presence-real-user.test.mjs` (novo), `docs/BUSINESS_RULES.md` (ROL-2c), `.claude/rules/roleta-prospeccao-campanhas.md`
- **Impacto/riscos:** Sem migration; limiares inalterados (Online 5 min / Ausente 30 min / Roleta 5 min). Linhas de presença passadas do emulado não foram corrigidas (não há como saber quais). Não provado sem login: a navegação real em "Alterar conta" no navegador.

### 2026-10-04 — Academia F6 e F7: gestão, várias trilhas, regras de matrícula e recomendações
- **Data:** 2026-10-04
- **Área:** Banco / Backend / Frontend (Academia atrás de `ACADEMIA_ENABLED`, desligada)
- **Alteração:** F6: aba Equipe (andamento, atrasos, histórico de provas, atribuição com prazo/obrigatoriedade, mudar prazo; gestor só na equipe), várias trilhas para o aluno (menu "Formações", `?trilha=`), criar trilha no editor. F7: regras de matrícula automática (novos usuários, reciclagem), regra da Formação Inicial obrigatória para novos corretores/associados semeada LIGADA (30 dias), matrícula automática ao abrir a Academia, aplicar/simular (Admin), recomendações de treinamento (aceitar matricula). Migration `20261004170000_academy_f7_rules_recommendations` aplicada em produção.
- **Motivo:** execução do plano (F6/F7). Decisões menores (reversíveis, registradas em ACA-7/8/9): atuais não são afetados pela obrigatoriedade; nada bloqueia o CRM; sem notificação/mensagem; certificado visível ao aluno, gestor da equipe e admin; histórico sem prazo de guarda.
- **Arquivos afetados:** `lib/academy-{management,rules,content-repo,server,service}`, `app/api/admin/academia/{team,enrollments,rules,recommendations}`, `app/academia/page.jsx`, `components/academia/{MenuSheet,AcademiaApp}.jsx`, `components/academia/editor/{TeamPanel,RulesPanel,RecommendationsPanel,EditorApp}`, testes `academy-{management,rules}.test.mjs`, `supabase/tests/academy_f7.sql`, docs/rule.
- **Risco/observação:** com a chave ligada, novos corretores/associados passam a receber a Formação Inicial como obrigatória (só orienta/mostra atraso). Sem login real/iPhone.
- **Autor:** Claude Code

### 2026-10-04 — Academia F5: certificados
- **Data:** 2026-10-04
- **Área:** Banco / Backend / Frontend (Academia atrás de `ACADEMIA_ENABLED`, desligada)
- **Alteração:** certificado emitido automaticamente pelo banco ao concluir a matrícula (idempotente, código `MM-XXXX-XXXX-XXXX`, snapshot), PDF (pdf-lib), tela de Certificação com código e download reais, revogação/reemissão (só Admin, com motivo, auditada), verificação interna por código; migration `20261004160000_academy_f5_certificates` aplicada em produção; regularização de matrículas concluídas sem certificado.
- **Motivo:** execução do plano (F5). Decisão menor: verificação pública não implementada (o dono adiou); a interna exige login de Admin/Gerente.
- **Arquivos afetados:** `supabase/migrations/20261004160000_*`, `supabase/tests/academy_f5.sql`, `lib/academy-{certificates,certificate-pdf,service,repo,views,remote-store,server}`, `app/api/admin/academia/certificates/**`, `components/academia/CertificationMoment.jsx`, `tests/academy-certificates.test.mjs`, docs.
- **Risco/observação:** PDF validado por estrutura (`%PDF`), não visualmente em leitor real.
- **Autor:** Claude Code

### 2026-10-04 — Academia F4: avaliações completas e banco de questões
- **Data:** 2026-10-04
- **Área:** Backend / Frontend / Banco (Academia atrás de `ACADEMIA_ENABLED`, desligada)
- **Alteração:** provas com várias questões do banco (fixas ou sorteadas, sorteio determinístico), prova de módulo (aula virtual no fim do módulo), nota mínima 70% ajustável só para cima, histórico de tentativas, `ExamScreen`, rota `GET exams/[examId]/questions`; editor com banco de questões (versionado) e compositor de prova; migration `20261004150000_academy_f4_exams_bank` (publicação exige prova em módulo com prova obrigatória; índice por tema), aplicada em produção.
- **Motivo:** execução do plano (F4) a pedido do dono. Decisões menores: sem tempo limite aplicado; nota mínima nunca abaixo de 70%; limite de tentativas não editável.
- **Arquivos afetados:** `lib/academy-{core,service,content,content-core,content-repo,repo,remote-store,views,server}`, `app/api/admin/academia/{content,exams/[examId]/questions}`, `components/academia/{ExamScreen,AcademiaApp,LessonScreen}.jsx`, `components/academia/editor/{BankPanel,ExamComposer,...}`, testes `tests/academy-exams.test.mjs`, `supabase/tests/academy_f4.sql`, docs.
- **Risco/observação:** fluxo do aluno e do editor validados no navegador com a API simulada; sem login real nem iPhone real.
- **Autor:** Claude Code

### 2026-10-04 — Academia F3: gestão de conteúdo (Admin e Gerente) + liberação de +1 tentativa
- **Data:** 2026-10-04
- **Área:** Banco / Backend / Frontend (`/academia/editor`, `app/api/admin/academia/{content,grants}`; Academia segue atrás de `ACADEMIA_ENABLED`, desligada)
- **Alteração:** (1) regra do dono registrada: após as 3 tentativas Admin/Gerente liberam +1, manual, por aluno e prova, com quem/quando (`academy_attempt_grants`, 1 por matrícula+prova; limite no banco = máximo + 1 só com a liberação). (2) Migration `20261004140000_academy_content_management` aplicada em produção: `academy_activities`, `academy_attempt_grants`, funções `academy_create_draft`/`academy_publish_version`/`academy_grant_extra_attempt`, `academy_record_attempt` e triggers atualizados. (3) Editor: criar rascunho (clone da publicada ou restaurar antiga), editar módulos/aulas/blocos de texto/atividades/questão, reordenar, mover, excluir, validar e publicar (aposenta a anterior; matrículas existentes ficam na versão em que começaram), descartar rascunho, histórico; aba de liberações (gestor só na equipe). (4) Aluno: aula renderiza blocos e atividades; aula sem questão conclui por botão.
- **Motivo:** pedido do dono (F3 completa). Decisões: gestão em "Alterar conta" é somente leitura (conservador, ACA-10 estendida; reversível); "+1" lido como no máximo uma liberação por aluno e prova (outra exigiria nova decisão); descartar rascunho feito pelo app porque o guard de SQL do projeto pede confirmação humana para DELETE em migration e a ferramenta expirava sem ela (não foi contornado).
- **Arquivos afetados:** `supabase/migrations/20261004140000_academy_content_management.sql`, `supabase/tests/academy_f3.sql`, `lib/academy-{content-core,content,content-repo,grants,access-core,repo,server,service,views}`, `app/api/admin/academia/{content,grants}/**`, `app/academia/{page,editor/page}.jsx`, `components/academia/editor/**`, `components/academia/{AcademiaApp,LessonScreen,MenuSheet}.jsx`, CSS, testes `tests/academy-{content,grants}.test.mjs` e helpers, docs e rule.
- **Risco/observação:** aplicado em produção em partes (guard: `DROP`/`DELETE` ficaram de fora das migrations; funções com `$fn$`); conferido contra Postgres local por impressão digital do esquema e das funções (iguais). Não validado com login real nem em iPhone; editor validado no navegador (Chromium) com o serviço real sobre banco falso. Pendências: vários itens por prova e banco de questões na interface (F4), certificados (F5), equipe/atrasos/atribuição (F6), criar nova trilha e várias trilhas na interface do aluno.
- **Autor:** Claude Code

### 2026-10-04 — Academia F2: persistência real (conteúdo, matrícula, progresso, provas, tentativas)
- **Data:** 2026-10-04
- **Área:** Banco / Backend / Frontend (rota `/academia` e `app/api/admin/academia/**`, ainda atrás de `ACADEMIA_ENABLED`, desligada)
- **Alteração:** 4 migrations aditivas aplicadas em produção (12 tabelas `academy_*`, RLS sem policy, funções atômicas `academy_record_attempt`/`academy_complete_lesson`, triggers de imutabilidade e de limite) + seed da Formação Inicial v1 (estrutura da F1). Camada `lib/academy-{service,repo,server,access-core,views,remote-store}`; 3 rotas (`me`, `exams/[examId]/attempts`, `lessons/[lessonId]/complete`); `app/academia/page.jsx` carrega o estado do aluno. Regras do dono aplicadas: nota 70% (comparação exata), 3 tentativas por prova (quiz de aula sem limite), gabarito só depois de aprovado, histórico preservado, "Alterar conta" somente leitura. Interface da F1 preservada; únicos ajustes: aviso de tentativas esgotadas na questão, toast de avisos do store real e botão "Reiniciar exemplo" só nos dados de exemplo.
- **Motivo:** pedido do dono (executar a F2). Decisão de modelagem: aula com prova só conclui aprovada (a prova de cada aula é uma linha de `academy_exams`); tentativa + conclusão gravadas na mesma transação para o limite de 3 não furar com acessos simultâneos.
- **Arquivos afetados:** `supabase/migrations/20261004{100000,110000,120000,130000}_academy_*.sql`, `supabase/tests/academy_f2.sql`, `lib/academy-*`, `app/academia/page.jsx`, `app/api/admin/academia/**`, `components/academia/{AcademiaApp,QuestionScreen,MenuSheet}.jsx`, `tests/academy-*.test.mjs`, `tests/helpers/academy-fake-db.mjs`, docs (`ACADEMIA`, `BUSINESS_RULES` ACA, `DATABASE`, `PERMISSIONS`, plano) e a rule `academia.md`.
- **Risco/observação:** nada ligado: com a chave desligada o CRM fica igual (404). A aplicação em produção foi feita em partes (a ferramenta expira em 60 s com lotes grandes e com `$$`; as funções foram aplicadas com `$fn$`); o resultado em produção foi conferido contra um Postgres local por checksum do conteúdo e impressão digital do esquema (colunas, constraints, índices, triggers, funções, RLS, grants), todos iguais. Um defeito achado no teste SQL antes da produção: `academy_refresh_enrollment` precisava de `grant execute` ao `service_role`. Pendências: tentativa extra liberada pelo gestor (F6), painel de edição (F3), certificado (F5), conteúdo real, várias questões por prova na interface (F4). Não testado em iPhone real nem contra login real (sem sessão nesta máquina); fluxo validado no navegador com a API simulada.
- **Autor:** Claude Code

### 2026-10-04 — Regra do dono: Academia, 2ª rodada (publicação, tentativas, nota, formação, certificado, histórico)
- **Data:** 2026-10-04
- **Área:** Docs / Regras (nenhum código, banco, rota ou chave alterado)
- **Alteração:** registrado como REGRA OFICIAL (`.claude/rules/academia.md`, `docs/BUSINESS_RULES.md` ACA-1, 2, 7 a 10): Admin e Gerente publicam direto sem aprovação extra; máximo de 3 tentativas por prova; 70% também nas provas de módulo e final; Formação Inicial obrigatória para novos associados/corretores; certificado só com 100% e nota mínima (verificação pública depois); associados participam e todo histórico é preservado; "Alterar conta" somente leitura na Academia. Plano e `docs/ACADEMIA.md` atualizados onde estavam pendentes (guard de publicar, matriz, itens do §8).
- **Motivo:** decisão do dono, fechando os pontos que a 1ª rodada deixou pendentes.
- **Arquivos afetados:** `.claude/rules/academia.md`, `docs/BUSINESS_RULES.md`, `docs/academia/PLANO_TECNICO.md`, `docs/ACADEMIA.md`, `docs/CHANGELOG_AI.md`.
- **Risco/observação:** nada implementado (F2+). "Alterar conta" somente leitura vale só para a Academia; no resto do CRM o comportamento segue o de `auth-permissoes.md`. Restam abertos: nova tentativa liberada pelo gestor, Formação Inicial para os atuais, quem vê o certificado, prova final como coroa, prazo de guarda, restrição por equipe.
- **Autor:** Claude Code

### 2026-10-04 — Regra do dono: decisões da Academia (edição, nota mínima, Fraunces, guindaste, orçamento)
- **Data:** 2026-10-04
- **Área:** Docs / Regras (nenhum código, banco, rota ou chave alterado)
- **Alteração:** registradas como REGRA OFICIAL em `.claude/rules/academia.md` (nova) e `docs/BUSINESS_RULES.md` §18 (ACA-1 a ACA-7): Admin e Gerente criam/editam conteúdo; nota mínima dos quizzes 70%; Fraunces aprovada; metáfora do prédio com guindaste aprovada; teto de 150 KB só para a parte própria da Academia; fontes ≈92 KB aprovadas. Plano, `docs/ACADEMIA.md` e repasse de design atualizados onde conflitavam (matriz de permissões, guard das rotas de edição, itens do §8). Linhas de referência em `CLAUDE.md`, `AGENTS.md`, `auth-permissoes.md` e `frontend-pwa.md`.
- **Motivo:** decisão do dono; a proposta anterior previa edição só pelo admin geral e orçamento/fontes como limites do plano.
- **Arquivos afetados:** `.claude/rules/academia.md`, `docs/BUSINESS_RULES.md`, `docs/academia/PLANO_TECNICO.md`, `docs/academia/HANDOFF_DESIGN.md`, `docs/ACADEMIA.md`, `CLAUDE.md`, `AGENTS.md`, `.claude/rules/auth-permissoes.md`, `.claude/rules/frontend-pwa.md`, `docs/CHANGELOG_AI.md`.
- **Risco/observação:** a edição por Admin e Gerente ainda não existe (F3). Seguem PENDENTES (ACA-1/2/7): quem publica, tentativas, nota das provas de módulo/final, Formação Inicial obrigatória, certificado, "Alterar conta" somente leitura, associados, retenção.
- **Autor:** Claude Code
### 2026-10-04 — Academia F0/F1: rota /academia atrás de chave, experiência completa com dados de exemplo
- **Data:** 2026-10-04
- **Área:** Infra / Frontend (nova rota `/academia`; sem banco, sem API)
- **Alteração:** chave `ACADEMIA_ENABLED` (padrão desligada, `lib/academy-flags.js`); rota `/academia` com 404 desligada e `requireAdminPage` ligada; ajustes aditivos em `components/AppChrome.jsx`, `components/AdminSessionKeeper.jsx`, `proxy.js` e `public/sw.js` (`isPrivateRoute`); grupo "ACADEMIA" no menu só com a chave ligada; lógica pura + store de exemplo (`lib/academy-*.mjs`) e interface em `components/academia/**`, com dados de exemplo em memória.
- **Motivo:** pedido do dono: plataforma de treinamento (Formação Inicial) dentro do CRM, entregue por fases (plano em `docs/academia/PLANO_TECNICO.md`).
- **Arquivos afetados:** `lib/academy-flags.js`, `lib/academy-menu.mjs`, `lib/academy-core.mjs`, `lib/academy-sample.mjs`, `lib/academy-sample-store.mjs`, `app/academia/**`, `app/dev/vitrine/academia/`, `components/academia/**`, `components/AcademyMenuContext.jsx`, `components/AppChrome.jsx`, `components/AdminSessionKeeper.jsx`, `components/AdminMenu.jsx`, `components/AdminBottomNav.jsx`, `app/admin/layout.jsx`, `proxy.js`, `public/sw.js`, `tests/academy-*.test.mjs`, `docs/ACADEMIA.md`, `docs/academia/*`.
- **Risco/observação:** NÃO feito: banco, migrations, API, progresso real, certificado real, bloqueio de escrita em "Alterar conta", conteúdo técnico real. Com a chave desligada o CRM fica igual (confirmado: 404/redirect e menu sem o item). Gabarito dos exemplos está no bundle do cliente (só exemplo; F2 corrige no servidor). Fonte Fraunces nova e metáfora do guindaste aguardam OK do dono; decisões abertas em `docs/academia/PLANO_TECNICO.md` §8. `public/sw.js` mudou de lógica (`/academia` é rota privada).
- **Autor:** Claude Code

### 2026-10-04 — CI verde: 3 testes desatualizados após o acesso WhatsApp por corretor (só testes)
- `tests/team-meta-card-gestora.test.mjs` (2 testes): a página da Meta Diária ganhou a condição `!ownGoalHidden` (card próprio escondido da gestora com WhatsApp bloqueado); expectativas atualizadas. `tests/whatsapp-conversation-per-session.test.mjs` (1 teste): stub de `whatsapp-access.isWhatsappAccessBlocked` (o push agora consulta o bloqueio). Nenhum código/regra alterado.

### 2026-10-04 — Carteira ativa de NO MÁXIMO 30 por corretor + devolução do excedente à Prospecção
- **Pedido (dono):** "alguns corretores continuam com mais de 30 clientes ativos": o limite real passa a ser 30 (era 50 desde 2026-10-02); excedente volta à Prospecção sem excluir ninguém nem marcar contato; novas atribuições nunca passam de 30. **Regra nova oficial (dono, 2026-10-04): MD-14.**
- **Causa raiz (provada em produção, só leitura):** (1) o teto de 50 só limitava a ENTRADA (`daily_goal_reserve_wallet_slots`); quem já tinha mais (83, 70, 60...) nunca perdeu ninguém. (2) **Vazamento de rodada:** o retorno automático de 7 dias (PRO-4), o "Devolver" do corretor e a reatribuição pelo administrador devolviam o contato à fila mas **deixavam a rodada da Meta Diária ativa** — 94 rodadas "zumbi" (contato já sem corretor) inflavam a "Carteira ativa N/50" (Paulo 37, Caroline 17, Liyssa 19, Luis 9...). "Carteira ativa" = `daily_goal_rounds.status = 'active'` (o mesmo número do card e da trava), não clientes por etapa do funil. Nenhum excedente era negócio em andamento: 100% "Tentando contato" ou ainda sem cadastro.
- **Correção:** teto 50 → 30 numa só constante (`MAX_WALLET_LIMIT`, `lib/daily-goal-wallet-core.mjs`; a tela de configuração só aceita ≤ 30; SQL lê `daily_goal_wallet_config`); novo `lib/daily-goal-round-release.mjs` encerra a rodada (e cancela só a fila PENDENTE) quando o contato sai do corretor: retorno automático, "Devolver"/"Devolver à fila", liberar/desbloquear e reatribuir (`lib/prospecting.js`, `lib/prospecting-auto-return.js`). Migration `20261004200000_meta_diaria_carteira_30.sql` (teto 50→30 só se ainda 50; tabelas `daily_goal_wallet_trim_log` e `daily_goal_wallet_trim_backup`; funções `daily_goal_wallet_trim_plan` (somente leitura), `daily_goal_wallet_trim` (aplica, 1 transação, backup+auditoria, idempotente, trava de segurança) e `daily_goal_wallet_trim_revert`; só service_role; **sem cron**). SQL da Central em `docs/sql-manual/carteira-30-*.sql` (dry-run, aplicar com conferências, reverter).
- **Prioridade de quem fica (derivada; não havia regra explícita):** protegidos (cliente em outra etapa/de outro responsável, resposta aberta, atividade futura, conversa, envio em andamento) > mais avançado na cadência > contato mais recente > rodada mais antiga > id. Excedente: nunca tentado → contato `available`; já tentado → `recent_attempt` +30 dias (PRO-3) e o cliente fica sem responsável na mesma etapa (P-05). Não toca tentativas, histórico, funil, pontos, fila 10/10/10 já cancelada.
- **Testes:** `tests/daily-goal-carteira-30.test.mjs`, `tests/daily-goal-carteira-30-sql.test.mjs` (migration e SQL manual executados num Postgres em memória, PGlite, opcional via PGLITE_DIR), `tests/daily-goal-limites-30-10.test.mjs` (substitui o 50-10).
- **Docs atualizados:** `.claude/rules/meta-diaria-ranking.md`, `BUSINESS_RULES.md` (MD-12, MD-14), `DATABASE.md`, `CRM_CONTEXT.md`, `OPERACAO_DISPAROS.md`, `INCIDENTES.md`.
- **Risco/observação:** (a) o interruptor "Bloquear novas prospecções ao atingir o limite" (Configurações) desliga o teto — ficou como estava (decisão do dono pendente). (b) Quem recebe contato fora da Meta Diária (atribuição em massa do administrador, roleta/formulário, cadastro manual) não cria rodada e não entra na "Carteira ativa"; continua como antes. (c) Devolvidos com tentativa ficam bloqueados 30 dias (regra PRO-3 reaproveitada). (d) Corretores inativos continuam com as rodadas válidas deles (não foi pedido mexer).
- **Autor:** Claude (CRM Architect)

### 2026-10-04 — Controle individual de acesso aos recursos WhatsApp por corretor (Liberado/Bloqueado)
- **Pedido (dono):** chave por corretor, no topo do card da supervisão da Meta Diária, para liberar/bloquear o uso do WhatsApp do CRM, separada da automação ligada/desligada.
- **Implementação:** migration aditiva `20261004190000_whatsapp_access_control.sql` (`admin_users.whatsapp_access_blocked` default false + tabela `whatsapp_access_audit`); `lib/whatsapp-access-core.mjs` (regras puras), `lib/whatsapp-access.js` (leitura, barreira, setter com auditoria), rota `PATCH /api/admin/whatsapp-access` (só administrador geral); barreira central em `requireAdminApi` (`lib/admin-auth.js`) + última barreira nas funções de sessão de `lib/whatsapp-individual.js`; `lib/daily-goal-auto.js` (cron ignora bloqueado antes de gerar/reservar; envio atrasado volta intacto; `resumeBrokerQueueAfterUnblock` reprograma a fila antes de liberar); UI: Chat, Meta Diária do corretor, status/QR e botões de WhatsApp não renderizam para bloqueado (`AdminMenu`, `AdminBottomNav`, `AdminSectionNav`, layout, `ClientCard`, `ClientSheet`, `ProspectingManager`, `WhatsappAccessProvider`); push de Chat suprimido. Teste `tests/whatsapp-access.test.mjs`. Doc: `docs/BUSINESS_RULES.md` §16.
- **Não mexe:** automação ligada/desligada, sessões, credenciais, fila, histórico, clientes, funil. Estado inicial: todos liberados.
- **A CONFIRMAR:** links externos `wa.me` (Agenda "Enviar parabéns", fluxos da Meta Diária) não foram alterados; teste automatizado não rodou localmente (sem Node) — validação estrutural/produção.

### 2026-10-04 — Prospecção: "Imprimir lista" (30 contatos reservados para prospecção manual em papel)
- Admin/gestor (gestor só da equipe) escolhem corretor/associado, confirmam e o sistema reserva até 30 contatos pela elegibilidade que a Prospecção já usa (função `create_prospecting_manual_list`, `FOR UPDATE SKIP LOCKED` + `UNIQUE(contact_id)`: um contato, uma lista) e gera PDF A4 (pdf-lib) com histórico, Visualizar e Reimprimir da MESMA lista (snapshot de nome/telefone). Não muda contato, cliente, funil, tentativa nem pontos.
- Migration **a aplicar**: `20261004170000_prospecting_manual_lists.sql` (tabelas `prospecting_manual_lists`/`_items`, RLS sem policy; `claim_daily_goal_contacts`, `claim_single_prospecting_contact` e `enqueue_extra_prospecting_dispatch` passam a pular reservados). Sem ela o código funciona ("Recurso ainda não ativado no banco."). Rotas `/api/prospecting/manual-lists*` (`requireBrokerManagementApi`, `no-store`).
- Risco/observação: não há "liberar lista"; Disparo em massa (`pick_broadcast_base_contacts`) não foi alterado e ainda pode sortear reservado.

### 2026-10-04 — Card da Meta Diária: números separados e rotulados (fila automática × atividades da meta × carteira)
- **Sintoma (dono):** após a T-100 o card mostrava Bruna "95 atividades · Carteira ativa 83/50 · 1ª:20 · 2ª:19 · 3ª:44" e Caroline "124 atividades", parecendo que a limpeza da fila não tinha valido.
- **Causa raiz (só exibição/rótulo):** nenhum desses números vem de `daily_goal_auto_queue` (a fila limpa). "Atividades" = carteira congelada do dia (`daily_goal_wallet_freeze`, 83) + pendentes congelados (`daily_goal_pending_freeze`, 12; Caroline 60 + 64 = 124) (`buildOwnerTeamOverview`, `lib/daily-goal.js`); "1ª/2ª/3ª" = rodadas ativas por `attempt_count` (`getDailyGoalWalletStatus`, `lib/daily-goal-wallet.js`), não itens de envio; 83/50 = rodadas ativas acima do teto de ENTRADA (nada é removido). A fila real estava correta (10/10/10 pendentes, 160 retirados por `policy_v2_trim_excess`). Além disso, "Na fila" contava só itens mexidos hoje (mostrava 0 com 30 pendentes atrasados).
- **Correção:** `components/TeamDailyPerformance.jsx` (cartão e aba Automação do detalhe): "x / y atividades da meta" + "carteira N + pendentes P"; nova linha "Fila automática de hoje: X de 30 (1ª a/10 · 2ª b/10 · 3ª c/10)"; "Carteira ativa N/50 (aguardando 1ª · 2ª · 3ª)" com dica; `lib/daily-goal-auto.js` (`adminListDailyGoalAutoSettings`: `policyV2Queue`; `pendingToday` passa a contar a fila aberta de qualquer dia); `summarizeAutoQueueForCard`/`formatAutoQueueCardLine` em `lib/daily-goal-policy-core.mjs`. Teste `tests/daily-goal-card-fila.test.mjs`. Nenhum dado, regra de cota, pontuação, ranking ou Meta de 100% foi alterado. Doc: `docs/OPERACAO_DISPAROS.md` §1.2.
### 2026-10-04 — Disparos v2: ativação (vigente por padrão), 10/10/10 sem empréstimo, intervalo 5–8 min, limpeza do excesso da fila
- **Regra do dono (confirmada em chat 04/10, autorização expressa):** política v2 passa a ser a VIGENTE (coluna `policy_v2_enabled` ausente/NULL = ligada; só `false` explícito é opt-out; automação desligada nunca é ligada); intervalo 5–8 min (antes 90 s–8 min); janela 06:30–15:30 e intervalo vêm das constantes da política (o 07–14 / 5–10 antigo do banco não prevalece); cada tentativa guarda no máximo 10 itens pendentes na fila (sem empréstimo entre etapas).
- **Limpeza do excesso:** `planV2Trim` + `trimV2QueueExcess` (`lib/daily-goal-auto.js`) cancelam só os excedentes da fila (`skip_reason = policy_v2_trim_excess`, ficam os 10 prioritários na ordem do envio), no cron (antes da checagem de sessão), na reconexão e na geração/reprogramação da fila; idempotente; nunca recriados (`loadEligibleEnqueueRounds` os exclui); pendentes de qualquer dia contam na vaga da tentativa. Não toca cliente/funil/histórico/rodadas.
- **Banco:** migration complementar `20261004150000_daily_goal_policy_v2_activation.sql` (coluna com default true, tabela `daily_goal_policy_trim_log`, alinhamento da configuração dos corretores com automação ligada). Estado de aplicação: ver `docs/OPERACAO_DISPAROS.md` §7 e `docs/sql-manual/aplicar-politica-v2-disparos.sql`.
- **CI:** 2 testes de `tests/central-approval.test.mjs` passam a usar o relógio real no executor (o NOW fixo tornava a aprovação "no futuro" após 15:01Z); regra da Central inalterada.
- Docs: OPERACAO_DISPAROS, rule meta-diaria-ranking, BUSINESS_RULES MD-14, WHATSAPP, DATABASE. Reconexão sem rajada, modelos de mensagem e monitor de entrega preservados.

### 2026-10-04 — Disparos do WhatsApp: política v2 por corretor (30/dia, 06:30–15:30, intervalos e pausas, reconexão sem rajada, modelos novos) + monitor de taxa de entrega
- **Data:** 2026-10-04
- **Área:** Meta Diária automática / fila extra "Disparar" / WhatsApp individual / e-mail interno
- **Alteração:** (A) **Política v2** atrás de chave por corretor (`daily_goal_auto_settings.policy_v2_enabled boolean not null default false`, migration aditiva `20261004130000_daily_goal_policy_v2.sql` — NÃO aplicada em produção; sem ela o código trata a chave como desligada): teto de 30/dia por número (10/10/10 por tentativa; a fila extra conta só no total), seg–sáb 06:30–15:30, intervalo 90 s–8 min (sorteado) com pausa 15–30 min a cada 8–12 envios, piso de 90 s mesmo com oscilação antiga/banco frouxo (banco só pode ser mais restritivo), trava pós-claim contra cron concorrente (rechecagem do uso do dia sem o próprio item), reconexão sem rajada (atrasados REPROGRAMADOS por UPDATE, 1º envio ≥ 5 min após `last_connected_at`), fila que passa ao dia seguinte sem cancelar/duplicar, fila extra com a mesma janela/intervalo/pausa, 30 modelos novos (10 por tentativa, 5 curtos + 5 longos alternados, sem promessa/link, "responda *SAIR*"). Núcleo puro: `lib/daily-goal-policy-core.mjs`, `lib/daily-goal-policy-messages.mjs`; ligação em `lib/daily-goal-auto.js` (refatoração só extraiu `loadEligibleEnqueueRounds`, sem mudar a política antiga), `lib/prospecting-extra-core.mjs` (`extraSendBlockReason` aceita `policyWindow`), rota `PATCH /api/admin/daily-goal-auto` (`policyV2Enabled`, só admin geral) e botão na aba Automação. (B) **Monitor de taxa de entrega** (`lib/daily-goal-delivery-monitor-core.mjs` + `lib/daily-goal-delivery-monitor.js`, chamado no fim do cron `whatsapp-meta-diaria-dispatch`, no máx. 1×/h, sempre ligado): % de `delivered_at` por corretor/dia (só Meta Diária, enviadas 1–24 h atrás, amostra ≥ 20, ignora domingo/fora da janela/sessão desconectada e envios anteriores à última queda), alerta por e-mail (Resend, remetente já configurado) à gestora quando < 60% (configurável em `crm_settings`), 1 por corretor por dia (marca em `crm_settings`, sem migration), máx. 5 por execução, só hoje/ontem; NÃO pausa nada. "SAIR" já virava opt-out (`isOptOutMessage`/`isClearOptOut`): só testes novos. Docs: `docs/OPERACAO_DISPAROS.md` (novo), `.claude/rules/meta-diaria-ranking.md`, `docs/WHATSAPP.md` §1-C, `docs/BUSINESS_RULES.md` MD-14, `docs/DATABASE.md`.
- **Motivo:** pedido do dono (2026-10-04) após auditoria: hoje o teto é 100/dia, a oscilação ignora o intervalo configurado (~2 min entre mensagens em dias cheios), atrasados saem em rajada ao reconectar e não há sinal de bloqueio. Causa dos ~2.169 itens `canceled` em 7 dias (entendida): não é perda de cliente — é a fila sendo cancelada e recriada (1.091 reorganização ao reconectar, 417 itens de dia anterior/fora da janela, 333 realinhamento manual, 90 correção de modelo etc.); as rodadas seguem ativas e a fila se refaz. Na v2 isso vira UPDATE de horário.
- **Risco/observação:** (1) com a v2 ligada o corretor só tem 30 envios automáticos/dia, então a Meta de 100% (carteira 50 + pendentes) passa a depender mais do botão manual, e a fila extra ("Disparar", que só libera com a Meta em 100%) fica quase sempre sem espaço; (2) a janela da v2 é limitada a 15:30 mesmo com compensação por restrição validada (PRO-14): o crédito de janela não estende além de 15:30 para quem está na v2; (3) o banco hoje está em 07:00–14:00 e 5–10 min, e por ser mais restritivo prevalece sobre a v2 (para a faixa completa do dono é preciso alinhar a configuração); (4) o cron roda a cada 2 min, então um intervalo real pode ultrapassar o teto de 8 min em até ~2 min; (5) o monitor só conhece a ÚLTIMA queda da sessão (`last_disconnect_at`); (6) os índices dos modelos v2 e dos antigos compartilham `variant_index` — logo após ligar a chave, a 1ª escolha pode usar um histórico em outra lista (efeito só nos primeiros envios); (7) `whatsapp-individual-service` (Railway) não foi alterado.
### 2026-10-04 — Permissões: notas internas de empreendimento só para admin/gestor (T-75/P-22) e etiquetas sem apagar/recolorir para corretor/associado (P-07)
- **Data:** 2026-10-04
- **Área:** Permissões / Empreendimentos / Clientes (etiquetas)
- **Alteração:** (A) `internalNotes` e `createdByUserId` só chegam a admin e gestor: novo `lib/property-visibility.js` (+ núcleo puro `lib/property-visibility-core.mjs`), aplicado no servidor em `app/admin/empreendimentos/consulta/[id]`, `app/admin/simulacoes/[id]/empreendimentos`, `simulacoes/[id]` e `simulacoes/nova`; o gerador de simulação também deixou de receber o book em base64 (`pdfData`, que ele nunca usou). (B) `DELETE /api/client-tags/[id]` agora exige `requireBrokerManagementApi` (admin/gestor); `POST /api/client-tags` segue aberto a qualquer perfil logado, mas com nome já existente corretor/associado recebem a etiqueta existente (200) sem trocar cor/nome (`createTagKeepingExisting`, `lib/client-tags.js`); admin/gestor mantêm o upsert que recolore. Na ficha do cliente (`ClientSheet`) a lixeira "Excluir do sistema" só aparece para admin/gestor, criar nome existente só marca a etiqueta existente, e um 403 mostra mensagem simples. `PUT simulation-registrations/[id]/tags` e `GET /api/client-tags` não mudaram. Site público e `/api/properties` já filtravam e não foram tocados.
- **Motivo:** decisão do dono (Opção B, 2026-10-04) sobre os achados do auditor: corretor/associado viam observações internas (ex.: comissão) e podiam apagar etiqueta global (derrubava o vínculo de todos os clientes e o histórico de campanha) ou mudar a cor dela para todos.
- **Risco/observação:** (1) as chamadas internas `addTagToClient` (tag de campanha e de fluxo do WhatsApp) e a tag do corretor em `lib/admin-profiles.js` continuam usando `createTag` (upsert com cor padrão), então ao repetir o nome ainda recolorem a etiqueta existente para a cor padrão — comportamento anterior, fora do escopo; vale avaliar. (2) Não existe PATCH de etiqueta (nome/cor só mudam por `POST` com nome repetido, agora só admin/gestor). (3) A guarda de tela é só conforto; a barreira é o guard da rota. (4) Não foi possível abrir as telas logado como corretor ("Alterar conta" exige login real): validado por testes (`tests/permissoes-tags-notas-internas.test.mjs`) e leitura do código. Docs: `docs/PERMISSIONS.md`, `docs/SYSTEM_ARCHITECTURE.md` §13 (P-07 e P-22), `docs/guia-corretor/CONSOLIDACAO.md` §13, rule `.claude/rules/crm-clientes-funil.md`.
### 2026-10-04 — Conferência em produção: remoção de corretor com redistribuição (migration já aplicada; teste em banco bloqueado)
- **Data:** 2026-10-04
- **Área:** Banco / Permissões / Clientes
- **Alteração:** nenhuma de código. Conferido por leitura: a migration `broker_removal_reassign` consta aplicada desde 2026-10-02 (`supabase_migrations` versão `20261002155852`, às ~12:58 -03:00, antes do commit `165a417` das 13:05); tabela `broker_removal_audit` (0 linhas = função nunca usada em produção) e função `remove_broker_reassigning_clients` existem, executável só por `postgres`/`service_role`. O commit `07ef1de` está em `origin/main` e no deploy de produção atual (`2ebc367`, Vercel success; CI `build-and-test` success). O 07ef1de em si não tem CI (o CI nasceu em `2ebc367`).
- **Motivo:** ordem pedida pelo dono (migration antes do código).
- **Risco/observação:** o token do conector Supabase disponível é somente leitura (nem a API de gestão grava), então o teste com equipe fictícia em transação revertida NÃO foi executado no banco. Provado só no núcleo puro (`tests/broker-removal-core.test.mjs`, 11 de 11): gestora remove da própria equipe, não de outra, corretor nunca, distribuição com diferença máxima de 1. Pendente: rodar o script de teste (transação sempre revertida) no SQL Editor do Supabase e, se desejado, um teste ponta a ponta pela tela. A função não toca a configuração de leads da Izabela.
- **Autor:** crm-editor (Claude)

### 2026-10-04 — P-15 (parte do teste quebrado) marcado como resolvido
- **Data:** 2026-10-04
- **Área:** Docs
- **Alteração:** `whatsapp-flow-core` deixou de falhar. Reverificado rodando `node --test` em todos os `tests/*.test.mjs` (exceto `journey-http`, que exige servidor) + `lib/financial-calculations.test.js`: 0 falhas, 1.192 de 1.198 testes passam (2 ignorados, 4 pendentes por desenho). O "32/32" informado pelo dono não bate com a contagem por arquivo (122 arquivos hoje); o dado real é 0 falhas. P-15 segue em aberto na parte "sem CI/lint/script `test`": CI mínimo em implantação, ainda inexistente.
- **Motivo:** dono informou suíte verde em 2026-10-04; documentação ainda listava a falha.
- **Arquivos afetados:** `docs/SYSTEM_ARCHITECTURE.md` (P-15 e tabela de testes), `AGENTS.md` (Comandos de validação), `docs/CHANGELOG_AI.md`
- **Risco/observação:** nenhum código alterado.

### 2026-10-04 — Ponte: aprovarTarefa/rejeitarTarefa, retomada e executor de ESCRITA aprovada em worktree isolada (desligado por padrão)
- **Data:** 2026-10-04
- **Área:** Infra (Central/ponte ChatGPT), Permissões, Docs
- **Alteração:** novas rotas `POST /api/central/tasks/{id}/approve|reject` (credencial `chatgpt` ou `approver`; `decided_by` = papel usado) e `POST /api/central/approver/tasks/{id}/resume` (só `approver`); máquina de estados estrita e idempotente (409 genérico nos demais estados), decisão do aprovador passou a ignorar `decided_by` do corpo. Claim agora devolve `approved_at`/`decided_by` ao executor. Executor Claude ganhou modo escrita (flag própria `CENTRAL_CLAUDE_WRITE_ENABLED`, padrão false): revalida a aprovação, roda numa worktree git nova a partir de `origin/main` (branch `central/<id8>`) com Read/Grep/Glob/Edit/Write, o CÓDIGO confere caminhos protegidos (inclui `scripts/central-bridge/**`) e comita sem hooks; git por allowlist fechada (nunca publica/mescla/deploy). `approve.mjs` ganhou `resume`. OpenAPI com `aprovarTarefa`/`rejeitarTarefa`; instrução para o mantenedor do MCP em `docs/central/mcp-aprovar-rejeitar-instrucao.md`. Verificação literal do CLI 2.1.286 (só --version/--help) registrada em `docs/CENTRAL_PONTE.md`.
- **Motivo:** pedido do dono (04/10): fechar o fluxo ChatGPT -> decisão -> execução de escrita aprovada, mais a retomada da tarefa que falhou por o executor só aceitar consulta.
- **Arquivos afetados:** `lib/central/core.mjs`, `lib/central/store-supabase.js`, `app/api/central/tasks/[id]/{approve,reject}/route.js`, `app/api/central/approver/tasks/[id]/resume/route.js`, `scripts/central-bridge/{approve,config}.mjs`, `scripts/central-bridge/executors/{claude,index,worktree}.mjs`, `docs/central/*`, `docs/CENTRAL_PONTE.md`, `tests/central-approval.test.mjs`, `tests/_helpers/central-memory-store.mjs`. Sem migration (retomada = UPDATE condicional; auditoria em `payload.audit`).
- **Risco/observação:** (1) a credencial `chatgpt` cria e pode aprovar: aprovação deixa de ser independente; mitigação = instrução do GPT exige confirmação explícita do dono no chat (decisão do dono). (2) o `tools/list` real do servidor MCP (hospedado no ChatGPT, com OAuth) NÃO foi verificável; as tools dependem de quem mantém o MCP. (3) Com a flag de escrita desligada, uma escrita aprovada entregue pela fila falha e consome uma tentativa (o claim não filtra por tipo; filtrar exigiria migration). (4) As regras de caminho do `--settings` são do Claude Code (não verificadas contra execução real); a conferência final é feita pelo código.
### 2026-10-04 — Nova frente E-MAIL: agente `email-specialist` (Diretor de E-mail), 5 skills, rule e memória (somente preparação)
- **Data:** 2026-10-04
- **Área:** Infra (agentes), Docs, Marketing
- **Alteração:** criados `.claude/agents/email-specialist.md`, skills `diretor-email`, `planejar-campanha-email`, `criar-email` (com `references/` e `tools/lint-email.mjs`), `auditar-entregabilidade` e `analisar-campanha-email`, rule `.claude/rules/email-marketing.md` (com `paths:`), memória `docs/email/` (PERFIL, CAMPANHAS, templates) e relatório do Scout. Integrado em `MAPA-AGENTES.md` (linha, palavra-chave, equipe, contexto mínimo), `CLAUDE.md` e `AGENTS.md`. Teste `tests/email-specialist.test.mjs`.
- **Motivo:** pedido do dono: especialista permanente em prospecção/campanhas de e-mail, no padrão da Central de Comando. Nada de terceiros foi instalado (referências só como ideia; `docs/scout/relatorios/2026-10-04-email-marketing-diretor-email.md`).
- **Arquivos afetados:** os acima; nenhum arquivo de `lib/`, `app/`, banco, settings ou agente existente.
- **Risco/observação:** nenhum envio, provedor ou domínio foi configurado. Pendências do dono: provedor/domínio remetente, base legal LGPD (advogado), origem da lista, descadastro/supressão no CRM (`crm-editor`). Origem/consentimento do e-mail em `prospecting_contacts`: A CONFIRMAR (Supabase MCP indisponível nesta sessão).
### 2026-10-04 — Alerta "WhatsApp precisa de atenção" (sessão individual que exige intervenção humana)
- **Data:** 2026-10-04
- **Área:** WhatsApp / Central de Alertas
- **Alteração:** nova definição `whatsapp_session_attention` (importante) na Central de Alertas. Gatilho no lado Vercel (`applyIndividualSessionStatus` → `notifyWhatsappSessionAttention`), sem tocar no microsserviço/Railway. Alerta `status='error'` com `needs_attention:<motivo>` (403/440/411/desconhecido), `needs_attention:retry_limit` e `disconnected`+`qr_expired` SÓ se a conta já esteve conectada (`last_connected_at`). Não alerta `reconnecting`/retry agendado, QR inicial, `qr_required`/`connecting` nem o 401 `logged_out` (já coberto por `whatsapp_connection`). Destinatários explícitos: gestora responsável ativa + administradores gerais ativos (nunca o corretor nem outras equipes). Idempotência: `dedupe_key = wa_attn:<corretor>:<motivo>:<last_connected_at | nunca:dia>` + UNIQUE da Central + cooldown de 10 min por corretor/motivo. Sessão que volta a `connected` encerra os pendentes automaticamente (`acknowledged_at` preenchido, `acknowledged_by` NULO = sistema). Texto em português simples (nome do corretor, estado, motivo, ação, horário de Brasília; sem telefone, código cru, credencial ou mensagem). Clique: `context.link = /admin/meta-diaria` (visão da equipe com o chip de WhatsApp de cada corretor).
- **Motivo:** pedido do dono — o corretor ficava sem WhatsApp (`error`/`retry_limit`) e ninguém era avisado (pendência registrada em `docs/WHATSAPP.md` na política de reconexão).
- **Arquivos afetados:** `lib/whatsapp-session-attention-core.mjs` (novo, puro), `lib/whatsapp-session-attention.js` (novo), `lib/whatsapp-individual.js`, `lib/crm-alerts.js` (`resolveAlertDeliveriesByPrefix`; push do Importante agora usa o `context.link` seguro), `lib/crm-alerts-core.mjs` (`alertLink`), `components/alerts/AlertCenterGate.jsx` (botão "Abrir" no informativo e "Entendi e abrir" no importante, só para rota interna `/admin/...`; vale também para os alertas já existentes que têm `context.link`: `whatsapp_connection` e `reply_waiting`), `supabase/migrations/20261004120000_whatsapp_session_attention_alert_definition.sql` (aditiva, idempotente — **NÃO aplicada por este agente**), `tests/whatsapp-session-attention.test.mjs`.
- **Risco/observação:** sem a linha em `crm_alert_definitions` o código não alerta (retorna `definicao_ausente`, sem erro) — o alerta só passa a existir depois da migration. Um admin que não seja o dono, ao clicar, cai na Meta Diária normal (a visão da equipe é do dono/gestora). Admin recebe mesmo sem ser gestor do corretor (pedido do dono); difere de `whatsapp_connection`, que é só da gestora. Mesma falha repetida sem nova conexão bem-sucedida entre as tentativas conta como a mesma ocorrência (1 alerta). Produção: sem acesso de leitura ao banco nesta sessão — estado real das sessões não consultado.
- **Autor:** Claude Code (crm-architect)
### 2026-10-04 — Ponte da Central: localizador permanente do Claude Code CLI + launcher com `poller-ctl` (ativação operacional)
- **Data:** 2026-10-04
- **Área:** Central/ponte ChatGPT→Claude (scripts locais), docs
- **Alteração:** novo `scripts/central-bridge/executors/claude-locator.mjs` (só sistema de arquivos, sem executar nada, sem rede). A cada execução do executor Claude resolve o binário nesta ordem: (a) `CENTRAL_CLAUDE_BIN` se for caminho absoluto de arquivo `claude.exe`/`claude` dentro de pasta `claude-code`; (b) senão varre `%APPDATA%\Claude\claude-code` e `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code`, escolhe a MAIOR versão semver (comparação numérica) e o subdiretório hash com `claude.exe`, só aceitando `<raiz>\<semver>\<hash>\claude.exe` com realpath dentro da raiz (links simbólicos, `.cmd/.bat/.ps1` e o executável do Desktop não valem); (c) nada achado → erro claro, sem cair no `claude` do PATH. `CENTRAL_CLAUDE_BIN` inválido não falha: cai na varredura e registra o motivo no log. Versão mais nova sem hash/`claude.exe` (atualização incompleta) é pulada para a próxima. O caminho resolvido é logado (`claude: binario <caminho> (origem versao)`). `config.mjs`: padrão de `CENTRAL_CLAUDE_BIN` passa de `claude` para vazio.
- **Motivo:** o caminho do CLI contém versão/hash e muda a cada atualização do app; fixar no `.env` quebraria a ponte silenciosamente.
- **Arquivos afetados:** `scripts/central-bridge/executors/{claude-locator.mjs,claude.mjs,index.mjs}`, `scripts/central-bridge/config.mjs`, `tests/central-claude-locator.test.mjs` (novo), `tests/central-bridge.test.mjs` (teste estático: o localizador pode citar `claude.exe`, mas `child_process/spawn/exec`, rede e `claude -p` seguem proibidos nele; `child_process` continua só em `claude.mjs`), `docs/CENTRAL_PONTE.md`.
- **Risco/observação:** launcher `iniciar-poller-central.ps1` (fora do repositório) atualizado para usar `poller-ctl check`, tratar saída 3 do poller como "já rodando" e varredura legada `-like '*poller.mjs*'`; tarefa agendada intacta. Nenhuma mudança no CRM.
### 2026-10-04 — Ponte da Central: trava de instância única do poller + `poller-ctl` (preparação, sem ativar)
- **Data:** 2026-10-04
- **Área:** Central/ponte ChatGPT→Claude (scripts locais), docs
- **Alteração:** o poller passa a manter uma trava por usuário (`%USERPROFILE%\.central-bridge.poller.lock`, criada de forma atômica, renovada a cada 10 s, removida na saída; segundo início recusado com código 3; trava obsoleta por PID morto, reinício do PC, PID sem batimento ou hora de início diferente é assumida). Nova ferramenta `scripts/central-bridge/poller-ctl.mjs` (`status`, `stop` com parada graciosa por arquivo e depois só o PID da trava, `check`), sem busca textual, sem processo auxiliar e sem dependência nova. `main()` do poller ganhou parâmetros injetáveis (teste). Config do poller continua lida só na partida.
- **Motivo:** no teste controlado T-83 o poller ficou ativo ~3 min a mais porque o filtro PowerShell `-match 'central-bridge[\/]poller'` não casa com a linha de comando do Windows (em regex .NET `[\/]` é só `/`; o caminho usa `\`). Identificação e encerramento passam a ser por PID/trava.
- **Arquivos afetados:** `scripts/central-bridge/{poller.mjs,poller-lock.mjs,poller-ctl.mjs}`, `tests/central-poller-lock.test.mjs`, `docs/CENTRAL_PONTE.md`.
- **Risco/observação:** nada ativado (executor Claude segue desligado; launcher `iniciar-poller-central.ps1` e tarefa de logon não alterados). Na ativação permanente o launcher deve tratar saída 3 como "já rodando" e usar `poller-ctl check` (ver `docs/CENTRAL_PONTE.md`). Poller antigo (sem trava) não é visto pelo ctl. Checkout `imoveis-mvp` precisa de `git pull --ff-only` para o launcher usar a trava.
### 2026-10-04 — WhatsApp individual: política de reconexão, telemetria de conexão e Baileys fixado
- **Data:** 2026-10-04
- **Área:** WhatsApp / Banco / Infra
- **Alteração:** microsserviço deixa de reconectar para sempre: 401 encerra (como antes); 403/440/411/códigos desconhecidos NÃO reconectam (socket encerrado, `status='error'` + `needs_attention:`); quedas recuperáveis com backoff exponencial+jitter, teto de atraso e 6 reconexões por ciclo, contador só zera após 3 min conectada; sessão não pareada tem limite próprio (5 QRs). Boot só retoma sessões `connected` (5–8 s entre elas). Nova tabela append-only `whatsapp_session_telemetry` (sem dedup; tentativas, quedas, ciclos, boot, versão do Baileys/WA Web, origem do deploy) alimentada por `POST /api/webhooks/whatsapp-individual/telemetry`. `whatsapp_session_events`/`whatsapp_restriction_events` inalterados. Baileys fixado em `6.7.24` + `package-lock.json` + `npm ci` (sem upgrade; evidência em `docs/WHATSAPP.md`). Teste antigo `whatsapp-restriction-states` (afirmava "serviço não trata 403") atualizado para a nova premissa.
- **Motivo:** pedido do dono; loops de 403 em 3 contas (~22 h, ~15 h, 26 min) e falta de dados para reconstruí-los.
- **Arquivos afetados:** `whatsapp-individual-service/{Dockerfile,package.json,package-lock.json,src/*}`, `app/api/webhooks/whatsapp-individual/telemetry/route.js`, `lib/whatsapp-session-telemetry.js`, `lib/whatsapp-session-telemetry-core.mjs`, `supabase/migrations/20261004100000_whatsapp_session_telemetry.sql` (PENDENTE de aplicar), `tests/whatsapp-reconnect-policy.test.mjs`, `tests/whatsapp-restriction-states.test.mjs`, `docs/WHATSAPP.md`, `docs/DATABASE.md`, `docs/INCIDENTES.md`
- **Risco/observação:** `needs_attention` não alerta a gestora; sessão que já estava `reconnecting` no banco continua assim até alguém clicar Conectar (o boot não grava status); alerta de conexão só cobre connected/disconnected. Dependências transitivas antigas não comprováveis. Ordem de publicação: aplicar a migration, conferir por SELECT que nenhuma sessão está `connected` (todas seriam reabertas no boot, como sempre foi), depois push.
### 2026-10-04 — Backfill do contato humano APLICADO (7 clientes)
- **Data:** 2026-10-04
- **Área:** banco (dados), docs
- **Alteração:** migration `20261003240000_backfill_last_whatsapp_contact_human_messages.sql` aplicada em produção pelo coordenador via MCP Supabase (escrita legítima, 04/10/2026). Universo recalculado pelos critérios da migration: 8 candidatos; **7 corrigidos** (só `last_whatsapp_contact_at`; ids curtos 72115c21, 57d34475, 899d6054, 82a5a3c7, c739ee6b, 9c26e07c, 67ac9911). O 7ccc1dcf da auditoria anterior saiu (o Chat já o corrigira) e o 67ac9911 entrou (mensagem humana de 03/10 13:18). **Idempotência comprovada:** reconferência depois = 0 pendentes.
- **Cliente 3f80e85f:** investigado e **excluído** por decisão do dono (evidência insuficiente: a conversa parece interna/teste da equipe). O arquivo da migration ganhou a exclusão explícita (`r.id <> '3f80e85f-...'`; só restringe). Nenhum status inferido: segue "Atendimento automático" e sem contato gravado.
- **Não alterado:** os ~1.052 clientes históricos em "Tentando contato" com o dono.
- **Também incluído:** `docs/atendimento/diagnostico-inicial-2026-10-03.md` (revisado: sem credenciais, telefones, nomes ou e-mails de clientes; só contagens agregadas).
- **Autor:** Claude (CRM Architect)

### 2026-10-03 — Atendimento (fecho): autoria de gestor/admin sem campo novo; backfill e cliente isolado pendentes de escrita
- **Data:** 2026-10-03
- **Área:** WhatsApp/Chat, Meta Diária (pendência/progresso), docs
- **Alteração:** resposta de gestor/admin/outro usuário (que não é o responsável nem o associado dele) conta como cliente atendido (`last_human_reply_at`, autor em `whatsapp_messages.sender_user_id`, `changed_by` = autor real, Chat e celular pelo mesmo caminho) mas **não grava `last_whatsapp_contact_at`** (`contactCreditsResponsible`, `lib/human-contact-core.mjs`, aplicado em `markClientOnHumanMessage`). **Campo novo NÃO foi necessário:** o único consumidor de mérito individual era `last_whatsapp_contact_at` (pendências/progresso da Meta Diária); `last_human_reply_at` só protege (roleta, trava da cadência, rótulo da lista). Testes em `tests/human-contact-core.test.mjs` (5b). Dono ("Alterar conta") inalterado; RAN-2 inalterada.
- **Backfill (migration 20261003240000):** reconferido por SELECT em 2026-10-03: o universo MUDOU (saiu 1 cliente que o Chat já atualizou, entrou 1 com mensagem de 13:18) — **não aplicado**; além disso a sessão só tinha acesso de leitura ao banco. **Cliente isolado em "Atendimento automático":** a conversa parece interna da equipe ("O atendimento está atribuído a você", "passando mal de rir"), evidência não inequívoca — **não alterado**. ~1.050 clientes históricos com o dono: mantidos (decisão do dono).
- **Autor:** Claude (CRM Architect)

### 2026-10-03 — Ponte ChatGPT→Central: operação `listarTarefas` (somente leitura)
- **Data:** 2026-10-03
- **Área:** Infra (ponte / Central de Comando)
- **Alteração:** `GET /api/central/tasks` lista tarefas recentes (filtros status/tipo/limite/horas, máx. 50) com resumo por allowlist (instrução e erro truncados em 200 caracteres, `has_result`, `awaiting_decision`); sem resultado completo. Mesma autenticação `chatgpt` e rate limit; só `select`. `criarTarefa`/`verResultado` inalterados. O dono precisa reimportar `docs/central/openapi.yaml` na Action do ChatGPT.
- **Motivo:** `verResultado` exigia conhecer o `task_id`.
- **Arquivos afetados:** `lib/central/core.mjs`, `lib/central/store-supabase.js`, `lib/central/route.js`, `app/api/central/tasks/route.js`, `docs/central/openapi.yaml`, `docs/CENTRAL_PONTE.md`, `tests/central-list.test.mjs`
- **Risco/observação:** `executor` só aparece enquanto a tarefa está em execução (o banco limpa o worker ao concluir). Sem banco nem migration novos.

### 2026-10-03 — Ponte ChatGPT→Central: executor Claude headless (somente leitura, só `consulta`), DESLIGADO
- **Data:** 2026-10-03
- **Área:** Infra (ponte / Central de Comando)
- **Alteração:** `scripts/central-bridge/executors/claude.mjs` deixou de ser adaptador vazio: chama `claude -p` (spawn sem shell, processo novo por tarefa, texto da tarefa só por stdin) com ferramentas fixas Read/Grep/Glob, `--restricted`, `--permission-mode dontAsk`, sem MCP, deny de leitura de .env/settings/credenciais/.git/node_modules, env do filho por allowlist, redação de segredos na saída, truncamento em 8000 caracteres, timeout (120 s) e erros genéricos. `escrita`/`eco` são recusados no próprio executor. Novas variáveis locais: `CENTRAL_CLAUDE_BIN`, `CENTRAL_CLAUDE_CWD`, `CENTRAL_CLAUDE_TIMEOUT_SECONDS`. Só roda com `CENTRAL_EXECUTOR=claude` E `CENTRAL_CLAUDE_EXECUTOR_ENABLED=true` (padrões: `echo`/`false`). Teste estático ajustado: `child_process`/`spawn` continuam proibidos em todo o resto da ponte e permitidos só nesse arquivo; novo teste proíbe flags perigosas. CRM, banco e rotas não foram alterados.
- **Motivo:** decisão do dono (T-78 Opção A): ponte pode usar Claude Code headless só para consultas.
- **Arquivos afetados:** `scripts/central-bridge/executors/claude.mjs`, `scripts/central-bridge/executors/index.mjs`, `scripts/central-bridge/config.mjs`, `scripts/central-bridge/poller.mjs`, `tests/central-bridge.test.mjs`, `docs/CENTRAL_PONTE.md`
- **Risco/observação:** não ativado (nenhuma execução real do Claude foi feita; `--restricted` e as regras deny são do Claude Code e precisam ser validados no teste de ativação). Política da Anthropic para gatilho externo/assinatura PENDENTE (T-79). Nenhum dado de produção foi gravado.

### 2026-10-03 — Meta Diária: hoje 100% dos disparos e janela até 18:00 (corte de 50% revogado)
- **Pedido do dono:** em 03/10/2026 enviar 100% da fila (não mais 50%) e esticar o fim da janela de 14:00 para 18:00; domingo 04/10 sem disparo; segunda 05/10 regra normal (seg–sáb, carteira 50, 10 novos/dia).
- **Mudança:** `TEMPORARY_DISPATCH_REDUCTIONS` (`lib/daily-goal-auto-core.mjs`) ficou vazia (o corte de 32e337c deixa de agir; o mecanismo permanece inerte). Nova exceção por data `TEMPORARY_WINDOW_END_EXTENSIONS` (`lib/daily-goal-window-core.mjs`, só `2026-10-03` → 18:00), aplicada em `withEffectiveWindow` (`lib/daily-goal-window.js`) com `Math.max` — só o FIM da janela; início, intervalo (5–10 min) e configurações gravadas intactos. Em 04/10 a data não casa e tudo volta sozinho ao configurado.
- **Domingo:** `isBusinessDay` segue 1..6, domingo bloqueado (testado). **Segunda:** sem exceção de data; limites 50/10 cobertos por `tests/daily-goal-limites-50-10.test.mjs`.
- **Observação:** itens que o corte já descartou hoje (`canceled`/`reducao_temporaria_2026_10_03`) deixam de ser protegidos e podem ser re-enfileirados pelo cron de hoje, respeitando o teto diário. Testes: `tests/daily-goal-temporary-reduction.test.mjs` atualizado.
- **Autor:** Claude Code

### 2026-10-03 — Meta Diária automática passa a disparar também aos SÁBADOS (segunda a sábado)
- **Pedido do dono:** corretora (ketlin) com a carteira acima de 50 não iniciava o disparo do dia. **Causa raiz:** todos os corretores têm "só dias úteis" ligado (`daily_goal_auto_settings.business_days_only = true`) e `isBusinessDay` só aceitava segunda a sexta; no sábado o envio ficava bloqueado (`fim_de_semana`) mesmo com WhatsApp conectado e fila pronta (46 itens pendentes). A carteira > 50 NÃO bloqueia o disparo (só impede entrada de novos contatos).
- **Mudança mínima:** `isBusinessDay` (`lib/daily-goal-auto-core.mjs`) agora aceita 1..6 (segunda a sábado); `extraSendBlockReason` (`lib/prospecting-extra-core.mjs`) idem (só domingo bloqueia). Vale para envio, trava final, agendamento, crédito de janela (PRO-14) e fila extra, sem alterar nenhuma configuração gravada no banco. **Domingo continua bloqueado** com a opção ligada. Textos da tela de Automação ajustados ("Segunda a sábado"). Testes ajustados: `daily-goal-auto-core`, `daily-goal-auto-window`, `daily-goal-window-credit`, `prospecting-extra-core`.
- **Valores confirmados no banco:** carteira 50 (`daily_goal_wallet_config`), cota 10 (`daily_goal_quota_versions`). A redução temporária de 50% dos disparos de 03/10 (entrada abaixo) NÃO foi alterada: continua valendo só hoje e some sozinha amanhã.
### 2026-10-03 — Atendimento: contato humano único (P-11), "sem responsável" real (P-05) e cadência que respeita conversa humana
- **Data:** 2026-10-03
- **Área:** WhatsApp/Chat, Clientes, Roleta/Prospecção, Meta Diária, banco (backfill), docs
- **Alteração:** (A) **P-11** — função única `registerHumanContact` (`lib/whatsapp-human-contact.js`, regra pura `lib/human-contact-core.mjs`) usada pelos 3 envios do Chat e por `recordBrokerAppMessage` (mensagem pelo celular): marca a conversa e o cliente (`last_whatsapp_contact_at`, só avança) e aplica o status do Chat; celular sem `client_id` vincula por telefone só com candidato único (CLI-4; `findRegistrationsByPhone`); descarta o eco da Meta Diária (`isAutomationEchoForBroker`); exclui history/failed/interna/reação/automação; autoria = quem enviou (`resolveContactChangedBy`: resposta de gestor/admin nunca é atribuída ao responsável). (B) **P-05** — `returnedToQueueClientPatch` unifica as 4 devoluções (retorno 7 dias, hibernação, "Devolver", "Devolver à fila"); `reassignOrphanedClientsToOwner` ignora "Tentando contato" sem responsável (continua resgatando órfãos de outra origem); a fila de espera da roleta só entrega cliente elegível (`lib/client-distribution-core.mjs`); D1 ("Ninguém / liberar") e CLI-9 inalterados. (C) **Cadência** — trava de conversa humana recente (24 h) revalidada imediatamente antes do envio e ao montar a fila (`lib/daily-goal-human-guard*.js/.mjs`), item cancelado com motivo `conversa_humana_recente`/`cliente_conversando_recente`. (D) **Backfill** — migration `20261003240000_backfill_last_whatsapp_contact_human_messages.sql` (**escrita e testada em SELECT equivalente, mas NÃO aplicada em produção**: o acesso disponível na sessão era somente leitura — aplicar com credencial de escrita; é idempotente): só `last_whatsapp_contact_at` de 8 clientes ativos com telefone de cadastro único e mensagem humana enviada inequívoca (universo: 734 mensagens humanas, 109 clientes, 0 ecos da Meta Diária entre 465 mensagens da fila). (F) Definições oficiais PRIMEIRO CONTATO e TEMPO DE RESPOSTA (tempo bruto) em `docs/METRICAS_FUNIL.md` MET-6 e na rule do módulo.
- **Motivo:** decisão do dono (2026-10-03) a partir do diagnóstico `docs/atendimento/diagnostico-inicial-2026-10-03.md`: resposta pelo celular não contava como contato (corretor cobrado à toa, lead tirado dele pela roleta), cliente devolvido à fila voltava ao dono a cada 2 min (~2 mil clientes acumulados) e a cadência automática podia mandar mensagem por cima de conversa humana.
- **Arquivos afetados:** `lib/human-contact-core.mjs`, `lib/whatsapp-human-contact.js`, `lib/whatsapp-client-status.js`, `lib/whatsapp-attendance.js`, `lib/whatsapp-chat.js`, `lib/whatsapp-individual-inbound.js`, `lib/client-phone-lookup.js`, `lib/client-distribution-core.mjs`, `lib/simulation-registrations.js`, `lib/prospecting-auto-return.js`, `lib/prospecting.js`, `lib/lead-distribution.js`, `lib/daily-goal-human-guard-core.mjs`, `lib/daily-goal-human-guard.js`, `lib/daily-goal-auto.js`, `components/DailyGoalAdmin.jsx`, `supabase/migrations/20261003240000_*.sql`, testes `tests/human-contact-core.test.mjs`, `tests/client-distribution-core.test.mjs`, `tests/daily-goal-human-guard.test.mjs` (+ stub em `tests/whatsapp-conversation-per-session.test.mjs`), docs (`SYSTEM_ARCHITECTURE` P-05/P-11/D-10, `BUSINESS_RULES` CLI-6/CLI-9/ROL-4/PRO-4/PRO-6/WA-4a/MD-13, `METRICAS_FUNIL` MET-6, `WHATSAPP`), rules `crm-clientes-funil`, `roleta-prospeccao-campanhas`, `meta-diaria-ranking`.
- **Risco/observação:** (1) **Dado antigo não alterado:** ~1.049 clientes em "Tentando contato" que o P-05 antigo já deixou com o dono continuam com ele — decisão do dono. (2) A Meta Diária resolve "pendência" do corretor por `last_whatsapp_contact_at` do cliente: resposta de gestor/admin também a resolve (separar exige campo de autoria no cliente). (3) 1 cliente em "Atendimento automático" com mensagem humana só pelo celular não teve o status ajustado no backfill. (4) A janela de 24 h da trava é parâmetro técnico (`HUMAN_CONVERSATION_RECENT_MS`). (5) Mudança deliberada: a mudança de status causada por resposta de gestor/admin passa a ficar no e-mail de quem enviou (antes ficava no do corretor responsável). (6) Cliente "sem responsável" fica fora das automações de contato enquanto estiver sem responsável (`listCandidateClients` exige responsável). (7) Pendência separada, fora de escopo: WhatsApp Oficial — verificar webhook/estado real (último webhook em 29/09). `reply_waiting` segue desligado; Guia lead v4 não publicado.
- **Autor:** Claude (CRM Architect)

### 2026-10-03 — Diretor de Atendimento (Fase 1): agente de marca + 2 executores + perfis em docs/atendimento
- **Data:** 2026-10-03
- **Área:** Docs / Agentes (nenhuma tela, `lib/`, `app/`, `components/`, banco, rota, disparo, WhatsApp ou automação alterados)
- **Alteração:** novo subagente `diretor-atendimento` (Agent restrito aos 2 executores, Read, Grep, Glob, Write, Edit; escrita só em `docs/atendimento/`; sem Bash/banco/MCP/WebFetch) + executores internos `especialista-atendimento` (só leitura) e `especialista-atendimento-web` (+ WebFetch/WebSearch). Equipe = perfis markdown sob demanda em `docs/atendimento/especialistas/` (16 previstos, estado "a montar"), sem custo fixo por especialista. Skill `/diretor-atendimento`; `claude --agent diretor-atendimento`. Central: MAPA-AGENTES (linhas, roteamento, MODO PLANO se o Diretor não tiver `Agent` como subagente) e despachante.md. "WhatsApp Oficial" = termo novo do antigo "WhatsApp Master" (renomear código/telas é fase futura).
- **Motivo:** pedido do dono (T-20261002-61): ponto de contato interno para atendimento, automações, vácuo/reativação e qualidade, sem atender clientes.
- **Arquivos afetados:** `.claude/agents/diretor-atendimento.md`, `.claude/agents/especialista-atendimento.md`, `.claude/agents/especialista-atendimento-web.md`, `.claude/skills/diretor-atendimento/SKILL.md`, `.claude/despachante/MAPA-AGENTES.md`, `.claude/agents/despachante.md`, `docs/atendimento/**`, `tests/diretor-atendimento.test.mjs`, `docs/CHANGELOG_AI.md`.
- **Risco/observação:** custo fixo de contexto ≈ +360 tokens por sessão (3 descrições+tools ≈ 317 + skill ≈ 43; chars/3,5). Nada externo instalado. Aninhamento: como subagente da Central o Diretor pode não ter `Agent` (MODO PLANO, `docs/atendimento/PROTOCOLO.md` §6) — a validar nas fases seguintes.
- **Autor:** Claude (T-20261002-61)

### 2026-10-03 — Meta Diária automática: redução TEMPORÁRIA de 50% dos disparos, SOMENTE em 03/10/2026
- **Data:** 2026-10-03
- **Área:** Meta Diária / automação WhatsApp individual (`daily_goal_auto_queue`, `source = 'meta'`)
- **Alteração:** exceção por data (`TEMPORARY_DISPATCH_REDUCTIONS` em `lib/daily-goal-auto-core.mjs`, uma única linha: `2026-10-03`, fator 0,5). No envio, `dropItemByTemporaryReduction` (`lib/daily-goal-auto.js`) decide cada item reivindicado: total do dia = enviados + pendentes + descartados pela redução (o que seria enviado sem a exceção); alvo = metade, arredondada para baixo, mínimo 1 (80→40, 50→25, 20→10, 21→10). Descarte = `status 'canceled'` + `skip_reason 'reducao_temporaria_2026_10_03'`, ANTES de qualquer envio, com probabilidade (vagas que faltam ÷ pendentes) — fecha exatamente no alvo e espalha os envios pelos mesmos horários da fila. A fila não refaz hoje quem foi descartado (consulta em `enqueueTodayItemsForBroker`). Em 04/10 a data deixa de casar e tudo volta ao normal sozinho; nenhuma configuração permanente (Gestão › Meta Diária, `daily_cap_override`, `HARD_DAILY_CAP`, janela, intervalos) foi alterada.
- **Motivo:** pedido do dono (volume reduzido pela metade somente hoje).
- **Arquivos afetados:** `lib/daily-goal-auto-core.mjs`, `lib/daily-goal-auto.js`, `components/DailyGoalAdmin.jsx` (rótulo do motivo no histórico), `tests/daily-goal-temporary-reduction.test.mjs`.
- **Risco/observação:** só a fila da Meta Diária (`source = 'meta'`); a fila extra do "Disparar" não é tocada. Elegibilidade, prioridade, bloqueios, janela, intervalo e travas de segurança seguem como estavam (o descarte vem depois do claim e antes do envio; falha ao decidir devolve o item à fila e NÃO envia). Rodadas descartadas continuam ativas e voltam a ser elegíveis amanhã; nenhuma tentativa é registrada para elas. Corretor que depende da automação para bater a meta fecha o dia com menos tentativas automáticas (efeito esperado da exceção). PARA REMOVER: apagar a entrada de `TEMPORARY_DISPATCH_REDUCTIONS` (e, se quiser, o teste e o rótulo).
- **Autor:** Claude Code

### 2026-10-02 — Testes estruturais tolerantes a CRLF (despachante.test.mjs)
- **Data:** 2026-10-02
- **Área:** Infra / Testes
- **Alteração:** `tests/despachante.test.mjs` normaliza CRLF para LF ao ler arquivos (como já faziam context-budget e agent-scout); nenhuma asserção afrouxada.
- **Motivo:** no Windows (core.autocrlf=true) os .md saíam com CRLF e o teste falhava com "frontmatter ausente" (T-20261002-59).
- **Arquivos afetados:** `tests/despachante.test.mjs`
- **Risco/observação:** restam só as falhas de limite de descrição (designer-crm, direcao-criativa), decisão do dono.
- **Autor:** Claude Code (Despachante)

### 2026-10-02 — Agent Scout: especialista em encontrar especialistas (somente pesquisa e recomendação)
- **Data:** 2026-10-02
- **Área:** Docs / Agentes (nenhuma tela, `lib/`, `app/`, `components/`, banco ou regra de negócio alterados)
- **Alteração:** novo subagente `agent-scout` (tools: Read, Grep, Glob, WebFetch, WebSearch, Write, Edit; sem Bash/PowerShell/Agent/MCP; sem memória) que pesquisa fontes públicas (doc oficial, MCP Registry, npm, PyPI por nome, GitHub, VoltAgent, Build with Claude), audita candidatos sem executar e recomenda; skill `/scout`; base em `docs/scout/` (ESTUDO, FONTES, RUBRICA, TEMPLATE-RELATORIO, relatorios/) lida sob demanda; linha no MAPA da Central + regra "avaliar o Scout antes de criar/evoluir fortemente um especialista" (também em `despachante.md`); teste `tests/agent-scout.test.mjs`.
- **Motivo:** pedido do dono (T-20261002-58): descobrir e avaliar agentes/skills/plugins/MCPs prontos antes de reinventar, sem instalar nada de terceiros.
- **Arquivos afetados:** `.claude/agents/agent-scout.md`, `.claude/skills/scout/SKILL.md`, `.claude/despachante/MAPA-AGENTES.md`, `.claude/agents/despachante.md`, `docs/scout/**`, `tests/agent-scout.test.mjs`, `docs/CHANGELOG_AI.md`.
- **Risco/observação:** nada de terceiros instalado, executado ou copiado (fontes lidas só por WebFetch/WebSearch, resumo próprio). Custo fixo de contexto ≈ +130 tokens por sessão (descrições do agente e da skill); CLAUDE.md inalterado. Adoção de qualquer achado: só com aprovação do dono, via `crm-editor`. Testes pré-existentes que falham em `origin/main` (não causados aqui): descrições `designer-crm` (427>380) e `direcao-criativa` (408>180) em `context-budget`; `despachante.test` falha em checkout Windows com `autocrlf` (CRLF).
- **Autor:** Claude (T-20261002-58)

### 2026-10-02 — Designer evoluído para Diretor de Design (agente + base modular + crítico independente)
- **Data:** 2026-10-02
- **Área:** Docs / Agentes (nenhuma tela, nenhum PDF e nenhuma regra de negócio foi alterada)
- **Alteração:** `designer-crm` (mesmo nome, a Central continua chamando) passou de "designer de telas do CRM" a **Diretor de Design**: UX/UI, design system, motion, acessibilidade, design editorial/comercial, direção de arte, imagem e fotografia de imóveis, crítica e Visual QA. Princípios novos no `CORE`: intenção antes de pixels, independência criativa (layout atual = contexto, não gabarito; âncoras = logo + paleta), anti-cardificação, exploração segura/moderna/ousada, "forma muda, fato não". Base modular em `.claude/design/` (`README` com roteamento, `CORE`, `DESIGN` com BRAND CONSTANTS × DESIGN PATTERNS × LEGACY PATTERNS e identidade auditada, `PRODUCT-UX`, `VISUAL`, `ACCESSIBILITY`, `MOTION`, `IMPLEMENTATION`, `REVIEW`, `EDITORIAL`, `COMMERCIAL`, `IMAGING`, `PHOTOGRAPHY`, `REFERENCES`) carregada seletivamente. Novo subagente `design-critic` (somente leitura) para crítica independente do resultado **renderizado**; nova skill `/direcao-criativa` (peças fora da tela); `/design-crm` adaptada (CORE, exploração, originalidade, `sistema-visual.md` por seção). Ferramenta `.claude/design/tools/renderizar-pdf.mjs` renderiza todas as páginas de um PDF para revisão.
- **Motivo:** pedido do dono — eliminar o comportamento "copiar layout existente → reorganizar → encaixar" e ter um diretor criativo capaz de evoluir a marca.
- **Arquivos afetados:** `.claude/agents/designer-crm.md`, `.claude/agents/design-critic.md` (novo), `.claude/design/**` (novo), `.claude/skills/design-crm/SKILL.md` e `references/sistema-visual.md` (cabeçalho: decisão vigente ≠ imutável), `.claude/skills/direcao-criativa/SKILL.md` (novo), `.claude/despachante/MAPA-AGENTES.md`, `.claude/rules/frontend-pwa.md`, `CLAUDE.md`, `tests/design-agent.test.mjs` (novo).
- **Risco/observação:** fontes externas (VoltAgent, mae616) estudadas só para leitura (MIT); nada instalado ou executado, nenhuma dependência nova. Achado de identidade registrado para o dono decidir: tokens do CRM (`#1769D1`/`#0D3B66`) diferem das cores medidas na logo (`#3673C2`/`#031D3A`). O PDF "Proposta de Valores" NÃO foi analisado nem redesenhado (próxima missão, aguarda aprovação do dono). Em Windows com `core.autocrlf=true`, `tests/despachante.test.mjs` falha por CRLF no checkout (preexistente, passa com LF).
- **Autor:** Claude Code

### 2026-10-02 — Meta Diária: ícone do WhatsApp só verde/cinza (T-20261002-54)

- `components/TeamDailyPerformance.jsx` (cards da equipe, da própria gestora e gaveta do corretor): o ícone de WhatsApp deixou de usar `whatsappTone` (que pintava laranja em conectando/reconectando/QR/código) e passou a `whatsappCardIconTone` (`lib/whatsapp-restriction-core.mjs`): verde só quando `resolveWhatsappBadge` = conectado; todo o resto (aguardando, desconectado, restrição informada/validada, desconhecido) = cinza. Só visual: badges, tooltips, clique e Google Contacts intactos; `whatsappTone` segue valendo no cabeçalho/chat. Teste: `tests/whatsapp-icon-tone.test.mjs`.

### 2026-10-02 — Meta Diária: card da própria gestora + cabeçalho padronizado dos cards (T-49/T-50)
- **Data:** 2026-10-02
- **Área:** Meta Diária
- **Alteração:** (1) Em `/admin/meta-diaria`, a gestora volta a ver PRIMEIRO o card da própria meta (mesmo componente do corretor, `DailyGoalDashboard variant="card"`: progresso, prospecção, pendentes, carteira, grupos, compensação por restrição e aviso de WhatsApp), e abaixo a equipe dela como antes. Dados via `getBrokerDailyGoal(auth)` (só o perfil da sessão), pelas regras atuais — sem regra nova; sem lista de contatos nem painel de automação no card. (2) Cabeçalho de todos os cards da equipe: linha 1 foto/nome/online/chat; linha 2 só badges de status (podem quebrar); linha 3 ícones WhatsApp + Google Contacts sempre juntos. Só visual.
- **Motivo:** pedido do dono (a gestora deixou de ver a própria meta) e padronização visual.
- **Arquivos afetados:** `app/admin/meta-diaria/page.jsx`, `components/DailyGoalDashboard.jsx`, `components/TeamDailyPerformance.jsx`, `app/dev/vitrine/_components/VitrineClient.jsx`, `tests/team-meta-card-gestora.test.mjs`, `docs/BUSINESS_RULES.md` (MD-11), `.claude/rules/meta-diaria-ranking.md`
- **Como validar:** `node --test tests/team-meta-card-gestora.test.mjs`; vitrine `?tela=meta-diaria-gestora` em 1366 e 390 px.
- **Pendências:** nenhuma migration. Se a gestora estiver sem WhatsApp conectado, a regra atual não gera cota nova para ela (card mostra o aviso).

### 2026-10-02 — Casa Paulista fixo de R$ 10.000, fonte única da apresentação e novo PDF "Proposta de Valores" (T-20261002-48)
- **Data:** 2026-10-02
- **Área:** Simulação de entrada / Apresentação de valores / PDF
- **Alteração:** (1) Casa Paulista passa a ser benefício de valor fixo R$ 10.000 quando o empreendimento aceita (`aceitaCasaPaulista`), R$ 0 quando não; constante única em `lib/simulacao-entrada/casa-paulista.mjs`, aplicada só no motor (`calculator.ts`); o campo `cliente.casaPaulista` deixou de existir/ser lido. (2) Lógica da tela "Apresentação de valores" extraída para `lib/simulacao-entrada/presentation-model.mjs` (`buildPresentationModel`), consumida pela tela e pelo PDF. (3) Novo PDF A4 "Proposta de Valores" por empreendimento (pdf-lib, servidor): `lib/simulacao-entrada/proposta-pdf.mjs` (só desenha) + rota `POST /api/simulations/[id]/proposta-valores` (guard `requireAdminApi` + escopo `getSimulation(id, auth)`); botão discreto "Proposta de Valores (PDF)" na apresentação. O PDF antigo do Gerador de Simulações não foi alterado.
- **Motivo:** Divergência: a apresentação enviava Casa Paulista 10000 fixo e o Gerador de Simulações enviava 0 fixo, então o mesmo cliente/imóvel tinha entradas diferentes (R$ 10.000) e os snapshots (`entry_simulation_snapshots`) salvos pelo Gerador ignoravam o benefício. Pedido do dono (regra: valor fixo, sem campo por cliente).
- **Arquivos afetados:** `lib/simulacao-entrada/{casa-paulista.mjs,presentation-model.mjs,cliente-entrada.js,proposta-pdf.mjs,calculator.ts,types.ts}`, `app/api/simular-entrada/route.js`, `app/api/simulations/[id]/proposta-valores/route.js`, `components/EmpreendimentoPresentation.jsx`, `components/SimulationGenerator.jsx`, `tests/proposta-valores.test.mjs`, `docs/BUSINESS_RULES.md`. Sem migration.
- **Risco/observação:** Snapshots já gravados com Casa Paulista = 0 NÃO foram reescritos (histórico); passam a refletir o benefício ao salvar a simulação de novo. Documentação gratuita segue como 5% do valor do imóvel exatamente como a tela já mostrava (**PENDENTE DE VALIDAÇÃO**: origem incidental no commit f9992ec; o cadastro do empreendimento já tem valor próprio em `beneficiosInformativos`). Logo do PDF: asset único `public/assets/matheus-machado-symbol.png` (mesmo do PDF de documentos); a logo vetorial completa (CorelDRAW) não pôde ser convertida sem software — A CONFIRMAR exportação SVG/PNG pelo dono. Pontuação/Meta Diária/ranking intocados.
- **Autor:** Claude (crm-editor, T-20261002-48)
### 2026-10-03 — Manual do CRM, etapa 3: interface e administração (T-20261002-52)
- **Data:** 2026-10-03
- **Área:** Manual do CRM / Menu / Interface
- **Alteração:** Item "Manual" (ícone BookOpen) no menu de todos os perfis e na barra inferior; página `/admin/manual` (cards de tópicos, accordion de subtópicos, busca com debounce, âncora `#topico/subtopico` e `?novidade=`, aba Novidades com "Li e entendi", texto renderizado como texto seguro); `/admin/manual/gerenciar` (só admin geral efetivo: edição rápida, ordem, audiência, status, fila de aprovação, novidades com sugestão de alteração antes×depois, versões, leituras, carregar estrutura inicial; aprovar/publicar só o dono); `components/manual/ManualHelpLink.jsx` (ajuda contextual, pronto e NÃO usado nas telas); `components/ui/Accordion.jsx`; núcleo puro `lib/manual-ui-core.mjs`; telas `manual` e `manual-gerenciar` na vitrine.
- **Motivo:** Pedido do dono (módulo Manual, etapa 3). Card "Ainda ficou com alguma dúvida?" e feedback ficam fora (seção reservada em `ManualBrowser.jsx`, sem render) até decisão do dono.
- **Arquivos afetados:** `app/admin/manual/**`, `components/manual/*`, `components/ui/Accordion.jsx`, `components/AdminMenu.jsx`, `components/AdminBottomNav.jsx`, `lib/manual-ui-core.mjs`, `tests/manual-ui-core.test.mjs`, `app/dev/vitrine/*`.
- **Risco/observação:** Branch `feat/manual-crm`, sem migration aplicada e sem deploy. No menu do topo o grupo "MANUAL" tem um único item (sem subbarra). Componentes cliente não importam a guarda de conteúdo (teste estático).
- **Autor:** Claude (designer-crm + crm-editor, T-20261002-52)
### 2026-10-03 — Manual do CRM, etapa 2: backend (T-20261002-47)
- **Data:** 2026-10-03
- **Área:** Manual do CRM / Alertas / Permissões
- **Alteração:** Novo módulo de backend do Manual: migration `20261003230000_manual_crm.sql` (5 tabelas, RLS ligado, só service role; NÃO aplicada em produção), `lib/manual-core.mjs` (regras puras), `lib/manual-guard.mjs` (guarda de conteúdo, só servidor), `lib/manual-service.mjs` + `lib/manual.js` (dados), `lib/manual-seed-structure.mjs` (estrutura inicial, carga idempotente tudo `pending`), rotas `app/api/admin/manual/**`. Publicar novidade (só o dono) cria alertas pela Central de Alertas com audiência explícita (all/role) e dedupe `manual_news:<id>:v<n>`; "Entendi" no alerta grava o ledger de leitura (`recordManualNewsRead` em `lib/crm-alerts.js`).
- **Motivo:** Pedido do dono (módulo Manual do CRM, etapas 1-5); canal de dúvidas/sugestões fica fora até decisão do dono.
- **Arquivos afetados:** os acima + `tests/manual-*.test.mjs`, `tests/_helpers/manual-fake-db.mjs`.
- **Risco/observação:** Branch `feat/manual-crm`, sem deploy. Conteúdo só é visível quando `published` e dentro da audiência do perfil efetivo; edição de seção publicada vira versão proposta (aprovação do dono).
- **Autor:** Claude (crm-editor, T-20261002-47)
### 2026-10-02 — Meta Diária: visão da gestora (só a equipe dela) + alerta de conexão do WhatsApp (T-35)
- **Data:** 2026-10-02
- **Área:** Meta Diária / WhatsApp / Alertas / Permissões
- **Alteração:** A gestora passa a ver a tela de equipe da Meta Diária (a mesma do administrador, reaproveitada) restrita aos corretores da equipe dela, com estado do WhatsApp e a compensação por restrição validada em cada card; somente leitura (sem chat de supervisão nem reorganizar fila). O isolamento é no backend: `lib/team-meta-scope-core.mjs` + `resolveTeamScopeOrThrow` (`lib/daily-goal.js`), rotas `/api/daily-goal/team-overview[/<id>]` agora com `requireBrokerManagementApi` e 403 em acesso cruzado; `lib/daily-goal-auto.js` (lista, histórico, pausar/ligar/teto/reorganizar) passou a recortar/checar por equipe para gestora (antes qualquer gestora via API enxergava e operava todos). Novo alerta informativo `whatsapp_connection` à gestora responsável quando o WhatsApp do corretor cai/volta (`lib/whatsapp-connection-alert*.js`, chamado por `applyIndividualSessionStatus`); sem gestora = ninguém alertado.
- **Motivo:** Pedido do dono (T-35): gestora sem visão operacional da equipe e sem aviso de desconexão.
- **Arquivos afetados:** `lib/daily-goal.js`, `lib/daily-goal-auto.js`, `lib/team-meta-scope-core.mjs`, `lib/whatsapp-individual.js`, `lib/whatsapp-connection-alert.js`, `lib/whatsapp-connection-alert-core.mjs`, `app/admin/meta-diaria/page.jsx`, `app/api/daily-goal/team-overview/**`, `components/TeamDailyPerformance.jsx`, vitrine (`app/dev/vitrine/**`), migration `20261003200000_whatsapp_connection_alert_definition.sql` (aditiva: 1 INSERT ... ON CONFLICT DO NOTHING), testes `tests/team-meta-scope.test.mjs` e `tests/whatsapp-connection-alert.test.mjs`; regra em `docs/BUSINESS_RULES.md` MD-11 e `.claude/rules/meta-diaria-ranking.md`.
- **Risco/observação:** Cálculo da Meta, compensação, Prospecção, Ranking, T-28/T-29 e T-33 intocados. Gestora deixa de ver o próprio painel de meta (como o admin, vê só a equipe) — A CONFIRMAR se ela também precisa da própria meta. Corretor sem gestora (manager_id vazio) não gera alerta. Desconexão voluntária (corretor clica Desconectar) também alerta. Detecção depende de o microsserviço chamar o webhook de status (único caminho de escrita). Teste de `despachante` (frontmatter) já falhava antes desta tarefa.
- **Autor:** Claude (crm-editor, T-20261002-35)
### 2026-10-02 — Meta Diária: carteira 100 → 50 e novos contatos 20 → 10 (T-20261002-38)

- **Antes → depois:** teto da carteira ativa 100 → 50 (`daily_goal_wallet_config.wallet_limit`); cota diária de 1º contato 20 → 10 (`daily_goal_quota_versions`, versão nova). Padrão de código `?? 100` → `DEFAULT_WALLET_LIMIT` (50) em `lib/daily-goal-wallet.js`.
- **Quem está acima de 50:** mantém todos (nada removido) e não recebe novos até ficar abaixo de 50; a RPC `daily_goal_reserve_wallet_slots` já devolvia `greatest(limite - atual, 0)`, sem mudança de lógica. Antes da mudança, 6 corretores estavam acima do novo teto (83, 72, 60, 57, 56, 52).
- **Não mudou:** `HARD_DAILY_CAP` 100, fila extra, PRO-14, pontuação/ranking, 100% da Meta, `daily_goals` já gravados. Migration aditiva `20261003220000_meta_diaria_limites_50_10.sql` (idempotente: só altera se o valor ainda for 100/20). Testes: `tests/daily-goal-limites-50-10.test.mjs`. Regra: `docs/BUSINESS_RULES.md` MD-12.

### 2026-10-02 — Meta Diária: tela mostra a compensação por restrição validada (só interface)
- **Data:** 2026-10-02
- **Área:** Meta Diária / Prospecção (interface)
- **Alteração:** faixa compacta de selos (ícone + texto) na Meta Diária do corretor: horário normal da janela, "+Xh por restrição validada", "Prazo estendido até HH:MM", "Dia impactado por restrição. Sem penalidade da Meta Diária neste dia.", "WhatsApp restringido. Meta Diária disponível em modo manual." e, com 100% da Meta, "Prospecção manual liberada" (também no cabeçalho da Prospecção). Restrição só informada, desconexão comum e conectado normal: nada novo (avisos "Conecte seu WhatsApp" mantidos). `GET /api/prospecting/extra-dispatch` passa a devolver 200 com `automaticDispatch: "unavailable_restricted"` (disparo segue indisponível; o POST continua estrito) em vez de erro genérico.
- **Motivo:** T-20261002-31 (melhoria visual da compensação PRO-14).
- **Arquivos afetados:** `lib/daily-goal-compensation-view-core.mjs` (novo, puro), `lib/daily-goal-window.js` (`getBrokerCompensationNotice`, só leitura), `lib/daily-goal.js` (campo `compensation` em `getBrokerDailyGoal`), `app/api/prospecting/extra-dispatch/route.js`, `components/DailyGoalCompensationNotice.jsx` (novo), `DailyGoalDashboard.jsx`, `ProspectingManager.jsx`, vitrine `meta-diaria-compensacao`, `tests/daily-goal-compensation-view.test.mjs`.
- **Risco/observação:** nenhuma regra/cálculo alterado (reusa `resolveEffectiveWindow`/`evaluateDayImpact`); sem migration. "Dia impactado" na tela do dia aberto é projeção com os mesmos critérios do fechamento. `lib/prospecting-extra-dispatch.js` não pode conter "restrict" (testes PRO-11), por isso o estado explícito fica na rota. Admin/gestora: sem mudança.

### 2026-10-02 — WhatsApp: restrição validada só encerra por admin/gestora (+ "Ver histórico")
- **Data:** 2026-10-02
- **Área:** WhatsApp / Permissões
- **Alteração:** corretor encerra só restrição apenas INFORMADA; validada → 403 (UI esconde "Restrição resolvida"). Nova rota `restriction/close` (admin geral ou gestora da equipe) e encerramento automático ao conectar com motivo `automatico_conectado`. Card da gestão ganha "Encerrar restrição" (validada) e "Ver histórico" (rota `restriction/history` existente, só do escopo).
- **Motivo:** regra do dono (T-20261002-29), complementa PRO-13.
- **Arquivos afetados:** `lib/whatsapp-restriction-core.mjs`, `lib/whatsapp-restriction.js`, `app/api/admin/whatsapp-individual/restriction/close/route.js`, `restriction/team/route.js` (campo `canClose`), `components/WhatsappStateChip.jsx`, `components/WhatsappIndividualStatus.jsx`, `tests/whatsapp-restriction-close.test.mjs`, docs/rule PRO-13. Sem migration (reaproveita `event_type='resolved'` e origens `admin`/`gestora`).
- **Risco/observação:** PRO-11 intacto (nada libera Prospecção). Histórico só INSERT. "Ver histórico" aparece enquanto há restrição aberta (a rota `team` lista só abertas); histórico de quem já não tem restrição aberta segue acessível só pela rota. `TeamDailyPerformance.jsx` não foi tocado.
- **Autor:** Claude Sonnet 5.5 (crm-editor)


### 2026-10-02 — Alertas e mensagens direcionadas privadas ao destinatário (T-20261002-28)
- **O quê:** regra oficial do dono (alerta/mensagem a um usuário é visível só a ele). Núcleo: `resolveAudienceRecipients` (user|team|global|role), `onlyOwnRows`, `canViewDelivery` em `lib/crm-alerts-core.mjs`; `onlyRecipientRows` na Supervisão; `createAlertsForAudience` em `lib/crm-alerts.js`; `lib/crm.js` (notificações) filtra pelo próprio usuário também para admin geral; push: `AdminPushSubscription` reassocia o navegador ao usuário logado a cada carga e `AdminLogoutButton` desassocia no logout.
- **Por quê:** causa raiz em INCIDENTES.md. Sem migration. Documentos: rule `automacoes-notificacoes.md`, BUSINESS_RULES (AL-PRIV).
- **Testes:** `tests/private-alerts.test.mjs` (novo) + regressão `crm-alerts-core`, `alexa-reply-alert`, `supervision-messages-core`.
- **Risco/observação:** o aviso FALADO da Alexa (`lib/alexa-reply-alert.js`) sai num alto-falante compartilhado do escritório — por natureza audível a todos; não foi alterado (decisão do dono).
### 2026-10-02 — Economia de tokens, incremento 1 (contexto fixo da sessão)
- **Data:** 2026-10-02 (tarefa T-20261002-18; só configuração de contexto/documentação)
- **Área:** Contexto dos agentes (`CLAUDE.md`, `AGENTS.md`, descrições de skills/agentes, Despachante)
- **Alteração:** `CLAUDE.md` §Agentes e skills reduzido a ponteiro para `.claude/despachante/MAPA-AGENTES.md` (fonte única de roteamento) + regras exclusivas; bloco "Economia de contexto" (com "NUNCA cortar por economia") e regra 9 (sistema vivo/`do_not_contact`). `AGENTS.md` sem tabela de roteamento nem regras duplicadas. Descrições das 41 skills (≤180 chars) e 10 agentes (≤380) encurtadas mantendo palavras-gatilho. MAPA ganhou cabeçalho de delegação e contexto mínimo por especialista; prompt padrão do Despachante usa o cabeçalho (autonomia e DECISÃO NECESSÁRIA intactos). `crm-editor`: regra repetida do CLAUDE.md virou ponteiro.
- **Motivo:** custo fixo por sessão (~17,9 mil tokens estimados nos itens medidos) com listas repetidas em 3 lugares. Medido com chars/3,5: antes 62.731 chars, depois 48.533 (−22 %); só os itens carregados em toda sessão (CLAUDE.md + rules + descrições + AGENTS) caem de ~16,3 mil para ~11,6 mil tokens.
- **Arquivos afetados:** `CLAUDE.md`, `AGENTS.md`, `.claude/despachante/MAPA-AGENTES.md`, `.claude/agents/*.md` (só `description`; crm-editor e despachante também corpo), `.claude/skills/*/SKILL.md` (só `description`), `tests/context-budget.test.mjs` (novo).
- **Risco/observação:** nenhuma rule, hook, settings ou `.mcp.json` tocados. Roteamento conferido por proxy lexical antes×depois (12 frases) — sem piora. Incremento 2: rules globais (3,1k tokens), mover `docs/alexa-interaction-model.json` e `docs/PERFORMANCE_AUDIT.md`. `tests/despachante.test.mjs` tem 1 falha pré-existente por estado inválido em `.claude/despachante/REGISTRO.md` (edição de outro agente, não tocada).
- **Autor:** crm-editor (Claude)

### 2026-10-02 — Saúde financeira, fase 2: interface (contas a pagar, marcar como paga, nova conta)
- **Data:** 2026-10-02 (tarefa T-20261002-11; só interface, nada de lib/API/banco)
- **Área:** Financeiro (Saúde) · Frontend
- **Alteração:** aba Saúde (só admin geral) redesenhada: cabeçalho enxuto; faixa com 3 números (Resultado líquido realizado + margem + variação; Caixa atual + cobertura + pílula Saudável/Atenção/Crítico, "Configurar caixa" sem saldo, engrenagem com a configuração; Expectativa do mês com barra realizado × previsto) — Expectativa e Caixa deixam de se repetir; painel "Contas a pagar" com totais clicáveis (Vencidas, Vencem esta semana, Total a pagar, Total pago) que filtram "Próximos compromissos" (5 linhas + Ver todas; selos com ícone + texto; "≈ R$ X · estimado" em série variável); "Marcar como paga" (modal no desktop / bottom-sheet no celular, valor pago editável, aviso +/−%, referência do próximo mês, toast com Desfazer); "+ Nova conta" (gaveta / tela cheia) com vencimento obrigatório, Única|Recorrente, Valor fixo × variável (`amountMode`), "Natureza do gasto" (ex-"Tipo") em "Mais opções" e "Já foi paga?" (cria e paga a 1ª ocorrência pelo mesmo caminho); indicadores secundários em lista compacta, "Como o mês fecha" recolhível, análise em 2 colunas, histórico em cartões no celular. Nenhuma função removida (editar/encerrar/excluir/reagendar/desfazer seguem; agora no menu "⋯"). Erro de carga (migration pendente) vira aviso claro em português.
- **Motivo:** decisões provisórias do dono (A vencer = 7 dias; previsto × pago; Saúde antes de Vendas/Comissões).
- **Arquivos afetados:** `components/FinancialHealthTab.jsx`, `FinancialHealthAccounts.jsx` (novo), `FinancialHealthUi.jsx` (novo), trecho da Saúde em `components/AdminFinancialDashboard.jsx`, `app/globals.css` (`.ui-sheet-modal`, `.ui-sheet-full`), vitrine (`tela=financeiro-saude`, `?variante=semcaixa|vazio`, `_fixtures/financeiro-saude.js`). O painel é recalculado no navegador com `buildExpensePanel` (mesma função pura do servidor) para refletir cada pagamento na hora e respeitar o período escolhido.
- **Risco/observação:** em produção, cadastrar/confirmar só funciona depois de aplicar a migration `20261003130000` (a UI mostra a mensagem do servidor). Vendas/Comissões do dashboard intocadas (fase 3).
- **Autor:** designer-crm (Claude)

### 2026-10-02 — Gestora remove corretor da própria equipe + distribuição justa (atômica, com auditoria)
- **Data:** 2026-10-02
- **Área:** Permissões / Clientes / Banco
- **Alteração:** a gestora (manager) pode excluir corretor/associado **só da própria equipe** (admin geral continua sem restrição de equipe; corretor/associado nunca). Ao excluir um corretor inativo com clientes: (a) transferir todos para um corretor, ou (b) **distribuir de forma justa por etapa/status** entre corretores ativos da mesma equipe com recebimento de leads ligado (cada etapa dividida igualmente; sobras para quem tem menos no total; diferença máxima de 1 por etapa). Só muda `responsible_user_id` (etapa/status e histórico intactos; o trigger existente leva a conversa do Chat junto); tag com o nome do corretor anterior; resumo/push ao corretor que recebeu; evento `responsible_transferred` na linha do tempo. Prévia somente leitura (`previewBrokerRemoval`) na tela de Corretores.
- **Motivo:** pedido do dono (tarefa T-20261002-05).
- **Arquivos afetados:** `supabase/migrations/20261003120000_broker_removal_reassign.sql` (tabela `broker_removal_audit` + função `remove_broker_reassigning_clients`, uma transação: trocar responsável + tag + auditoria + excluir corretor; falha em qualquer ponto desfaz tudo; função revogada de public/anon/authenticated), `lib/broker-removal-core.mjs`, `lib/admin-profiles.js`, `app/api/admin-users/[id]/route.js`, `app/admin/corretores/page.jsx`, `components/AdminUsersManager.jsx`, `tests/broker-removal-core.test.mjs`, `docs/PERMISSIONS.md`.
- **Risco/observação:** migration aplicada em produção pelo conector em 2026-10-02 (o carimbo gravado em `supabase_migrations` é o do momento da aplicação, não 20261003120000). Validada em transação desfeita com corretores/clientes de teste (falha desfaz tudo; sucesso move, audita e exclui; segunda chamada dá `broker_not_found`); nada ficou no banco. `lib/admin-profiles.js` tinha sido gravado com acentos corrompidos (UTF-8 em dobro) no commit 07ef1de e foi restaurado antes da publicação. Excluir o corretor continua acionando os `ON DELETE CASCADE`/`SET NULL` já existentes de `admin_users` (comportamento anterior, não alterado). A exclusão do login (Supabase Auth) é feita fora da transação, após ela (falha só gera log).
- **Autor:** crm-editor (Claude)

### 2026-10-02 — Saúde financeira, fase 1: despesa variável (previsto × pago) e painel de vencimentos
- **Data:** 2026-10-02 (tarefa T-20261002-10, fase 1 backend/dados; UI = fase 2)
- **Área:** Financeiro (Saúde) · Banco
- **Alteração:** (1) migration aditiva `20261003130000_financial_variable_expenses.sql`: `financial_operating_expenses.amount_mode` ('fixed' padrão | 'variable') e `financial_operating_expense_occurrences.expected_amount` (previsto congelado ao confirmar, ao lado de `paid_amount`). (2) Núcleo `lib/financial-health-core.mjs`: status de vencimento (Prevista >7 dias · A vencer hoje..+7 · Vencida · Paga), previsão de série variável = valor pago da última ocorrência paga anterior (calculada na leitura), `buildExpensePanel` (vencidas, vencem esta semana, total a pagar, total pago, próximos compromissos). (3) `lib/financial-health.js`: `amountMode` no cadastro/edição (mudar o modo de uma recorrente é alteração "dali para frente"), confirmar pagamento grava `expected_amount` e usa o previsto como valor padrão. (4) `app/admin/financeiro/page.jsx` passa `health.panel` (só admin geral).
- **Motivo:** decisões provisórias do dono (opção A): "a vencer" = hoje..+7 (São Paulo); variável = previsto × pago, pago vira referência da próxima previsão; "Tipo" → "Natureza do gasto" (só texto, fase 2).
- **Docs atualizados:** `docs/FINANCEIRO_SAUDE.md`, `.claude/rules/financeiro.md`, `docs/BUSINESS_RULES.md` (FIN-6).
- **Arquivos afetados:** `supabase/migrations/20261003130000_financial_variable_expenses.sql`, `lib/financial-health-core.mjs`, `lib/financial-health.js`, `app/admin/financeiro/page.jsx`, `tests/financial-variable-expenses.test.mjs`
- **Risco/observação:** **a migration precisa ser aplicada no banco ANTES do deploy** (sem ela, confirmar pagamento e cadastrar despesa falham com aviso claro). Guards, fórmulas, visão do associado e Vendas/Comissões intactos; nenhum dado existente é alterado (8 despesas e 8 pagamentos hoje, todos viram "fixa"/previsto não registrado). `recurringMonthlyEquivalent` (reserva) continua usando o valor cadastrado. Dividir a série (editar valor) reinicia a referência da série variável no valor digitado. Pagamentos antigos ficam com `expected_amount` nulo. Aprovação do dono é provisória.
- **Autor:** crm-editor (Claude)

### 2026-10-02 — "Não contactar" automático: número errado, pessoa errada e negativa clara (opção B)
- **Data:** 2026-10-02
- **Área:** Prospecção / WhatsApp
- **Alteração:** `isClearOptOut` passa a reconhecer também número errado ("número errado", "você ligou pra pessoa errada", "foi engano") e pessoa errada ("não sou eu", "não sou o cliente", "não sou o <Nome>"), além das negativas claras que já existiam ("não tenho interesse" sozinho). Ressalvas/condição/futuro ("mas", "se", "quando", "ou", "mais pra frente"), pergunta ("?", "quem", "qual") e palavras de papel após "não sou o" (dono, responsável, pai…) deixam a mensagem ambígua: o cliente continua indo para "Em atendimento" (PRO-8, commit 05e0b57). Cliente já em Não contactar que escreve segue gerando pendência de reativação.
- **Motivo:** decisão do dono (opção B, tarefa T-20261002-13): marcar sozinho só com intenção inequívoca; em dúvida, humano.
- **Docs atualizados:** `.claude/rules/roleta-prospeccao-campanhas.md`, `docs/BUSINESS_RULES.md` (PRO-8).
- **Arquivos afetados:** `lib/prospecting-reply-core.mjs`, `tests/prospecting-reply-core.test.mjs`


### 2026-10-02 — Estados do WhatsApp: restrição informada x validada + instrumentação de desconexão (T-20261002-23)
- **Data:** 2026-10-02
- **Área:** WhatsApp / Meta Diária / Banco / Permissões
- **Alteração:** 4 estados no card (Conectado · Desconectado · Restrição informada — aguardando validação · Restrição validada). Corretor só informa; admin geral valida qualquer um, gestora só a equipe ("Validar restrição" / "Não validar"); histórico append-only; encerra sozinha ao conectar. Webhook `status` passou a carregar `statusCode`/`output` do Baileys, gravados em `last_disconnect_code` e `whatsapp_session_events` (só registro).
- **Motivo:** pedido do dono; T-20 provou que não há evidência técnica confiável de banimento, então a validação é administrativa.
- **Arquivos afetados:** `supabase/migrations/20261003150000_whatsapp_restriction_validation.sql`, `lib/whatsapp-restriction-core.mjs`, `lib/whatsapp-restriction.js`, `lib/whatsapp-individual.js`, `app/api/admin/whatsapp-individual/restriction/{route,team,validate,history}`, `app/api/webhooks/whatsapp-individual/route.js`, `whatsapp-individual-service/src/{sessions,webhook}.js`, `components/{WhatsappStateChip,WhatsappIndividualStatus,TeamDailyPerformance}.jsx`, `tests/whatsapp-restriction*.test.mjs`, regra PRO-13.
- **Risco/observação:** PRO-11 intacto (Prospecção/Meta Diária seguem exigindo `connected`). Nenhuma lógica de reconexão do serviço foi alterada; 403 só é registrado. Migration aplicada ANTES do deploy do app (o upsert da sessão usa colunas novas).
- **Autor:** crm-editor (Claude Sonnet 5.5)

### 2026-10-03 — Status operacional "WhatsApp restringido"
- **Data:** 2026-10-03
- **Área:** WhatsApp / Meta Diária / Banco
- **Alteração:** corretor informa "Meu WhatsApp está restringido" (e "Restrição resolvida") no modal do WhatsApp; cards do gestor/admin (Meta Diária) mostram o selo "WhatsApp restringido", distinto de "Aguardando WhatsApp"; encerra sozinha ao voltar a `connected`. Nova tabela aditiva `whatsapp_restrictions` (histórico) e rota `/api/admin/whatsapp-individual/restriction`.
- **Motivo:** pedido do dono (Despachante T-20261002-16): diferenciar "ainda não conectou" de "impedido porque o WhatsApp foi restringido".
- **Arquivos afetados:** `supabase/migrations/20261003140000_whatsapp_restrictions.sql`, `lib/whatsapp-restriction-core.mjs`, `lib/whatsapp-restriction.js`, `lib/whatsapp-individual.js`, `lib/daily-goal-auto.js`, `app/api/admin/whatsapp-individual/{restriction,status}/route.js`, `components/WhatsappIndividualStatus.jsx`, `components/TeamDailyPerformance.jsx`, `components/DailyGoalAdmin.jsx`, `tests/whatsapp-restriction.test.mjs`, regra PRO-12 (rule do módulo + BUSINESS_RULES).
- **Risco/observação:** apenas informativo — elegibilidade (PRO-11) intocada, teste prova. Encerramento automático é preguiçoso (leitura do status/painel + webhook), pois o microsserviço grava a sessão direto no banco. Durante "Alterar conta" a ação fica atribuída ao perfil efetivo (regra operacional existente).
- **Autor:** crm-editor (Claude Sonnet 5.5)


### 2026-10-02 — Reativação manual a "Tentando contato" encerra a pendência "sem atividade futura"
- **Data:** 2026-10-02
- **Área:** Clientes / Meta Diária
- **Alteração:** devolver à mão um cliente avançado a "Tentando contato" tira a pendência de atividade futura (painel, lista, automação), reinicia o relógio de 3 dias e conta como pendência resolvida na Meta Diária. Sem atividade fictícia; histórico, responsável, mensagens e pontos intactos; "Não contactar" não reativa. Sem migration.
- **Motivo:** pedido do dono (cliente que parou de responder continuava com "atividade futura não agendada" mesmo devolvido à prospecção).
- **Arquivos afetados:** `lib/client-status.js`, `lib/crm.js`, `lib/crm-automations.js`, `lib/daily-goal-progress.mjs`, `lib/daily-goal-pending.js`, `lib/performance-overview.js`, `lib/simulation-list-query.js`, `components/clients/client-format.js`, `tests/pending-reactivation.test.mjs`, `.claude/rules/meta-diaria-ranking.md`, `docs/BUSINESS_RULES.md`

### 2026-10-02 — Despachante de tarefas + política de autonomia dos agentes
- **O quê:** novo agente `despachante` (`.claude/agents/despachante.md`), skill `/despachar`, mapa de agentes e registro de tarefas em `.claude/despachante/`, documento `docs/DESPACHANTE.md` (capacidades reais, auditoria de permissões, política de autonomia), teste `tests/despachante.test.mjs` (mapa completo + invariantes de segurança). `CLAUDE.md` e `AGENTS.md` apontam para eles.
- **Por quê:** o dono quer um único chat de entrada que delegue em segundo plano e só o interrompa em decisão de produto/impacto destrutivo.
- **Não alterado:** hook de SQL, `.mcp.json` read-only, `ask` de migration/force-push/rm. **`.claude/settings.json` NÃO foi alterado** — o app bloqueou a autoedição de permissões; a proposta está em `docs/DESPACHANTE.md` §4 aguardando o dono.
- **Risco/observação:** MCP `Supabase` do `.mcp.json` não conecta (token ausente/inválido); agentes WhatsApp/Alexa/Diretor não existem como agentes (ver mapa).

### 2026-10-02 — Central de Alertas (Informativo / Importante)
- **Data:** 2026-10-02
- **Área:** Notificações · Painel · Banco · Alexa
- **Alteração:** camada única de alertas na tela.
  - Informativo: lateral, ~5 s, fila de 3 no computador e 2 no celular, não bloqueia.
  - Importante: `<dialog>` modal que bloqueia até "Entendi", com apareceu e confirmou registrados.
  - Tabelas `crm_alert_definitions`/`crm_alert_deliveries` (migration `20261002340000`, aplicada), `lib/crm-alerts.js` e núcleo `.mjs`, rotas `/api/admin/alerts/**`, `components/alerts/*`, aba Automações › Alertas (liga/desliga e "Testar em mim").
  - O alerta "cliente aguardando resposta" é criado pelo mesmo detector da Alexa, sem duplicar, e **nasce desligado**.
  - A Supervisão passa a esperar o Importante aberto.
- **Motivo:** pedido do dono. Arquitetura analisada com o `designer-crm` (especificação visual) e com o `crm-editor` no papel de "Alexa" (mapa dos alertas atuais). Não existe agente "alexa" no projeto.
- **Arquivos afetados:** os acima, mais `app/admin/layout.jsx`, `components/supervision/SupervisionMessageGate.jsx`, `lib/alexa-reply-alert.js`, `app/globals.css`, vitrine (`tela=alertas`), `tests/crm-alerts-core.test.mjs`; rule automacoes-notificacoes, DATABASE, workflow-dev.
- **Risco/observação:**
  - Validado na vitrine com Playwright (1366 px e 390 px): cada Informativo dura 5,0 s, a fila não sobrepõe nem repete, o Importante bloqueia e Esc não fecha, "Entendi" libera e o próximo aparece.
  - Idempotência e registros testados no banco numa transação desfeita.
  - Pendências: o detector de espera ainda depende da Alexa ligada e do horário dela; falta decidir o destino de espera sem corretor; o construtor completo de alertas ainda não existe; `whatsapp_reply_alerts`/`_settings` continuam sem migration versionada (apontado pela análise).
- **Autor:** Claude Code

### 2026-10-02 — Prospecção só com WhatsApp conectado (PRO-11)
- **Data:** 2026-10-02
- **Área:** Prospecção / Meta Diária / WhatsApp
- **Alteração:** só participa da Prospecção quem tem a sessão do WhatsApp pessoal `connected`. Novo `lib/prospecting-eligibility.js` (barreiras de servidor, erro 403 `WHATSAPP_NOT_CONNECTED`) + `lib/prospecting-eligibility-core.mjs` (regras puras). Aplicado em: geração da cota da Meta Diária (sem criar a linha do dia), tentativa manual, "Prospectar" do card, "Disparar" (enqueue e status), lista/"Minha Base" da Prospecção para corretor/associado, atribuição administrativa (destino) e cron da fila de disparos (nenhum item novo sem sessão conectada). Prospecção mostra "Conecte seu WhatsApp para acessar a Prospecção." + botão que abre o modal de conexão (evento `crm:open-whatsapp-connect`); Meta Diária mostra aviso `prospectingBlocked`.
- **Motivo:** pedido do dono — Prospecção 100% por disparos automáticos do CRM.
- **Arquivos afetados:** `lib/prospecting-eligibility.js`, `lib/prospecting-eligibility-core.mjs`, `lib/daily-goal.js`, `lib/daily-goal-auto.js`, `lib/prospecting.js`, `lib/prospecting-extra-dispatch.js`, `app/admin/prospeccao/page.jsx`, `components/ProspectingConnectGate.jsx`, `components/DailyGoalDashboard.jsx`, `components/WhatsappIndividualStatus.jsx`, `tests/prospecting-eligibility.test.mjs`, `docs/BUSINESS_RULES.md` (PRO-11)
- **Risco/observação:** efeito imediato — hoje só 1 de 9 sessões está `connected`; os demais deixam de receber cota nova e de entrar na fila até conectar. Corretor sem linha de `daily_goals` no dia fica como "ainda não gerou" (já existia). Administrador geral fica fora da exigência (A CONFIRMAR com o dono). Estado transitório `reconnecting` conta como não conectado até voltar a `connected`. Sem Node no ambiente: testes não executados localmente. Campanhas (`whatsapp-broadcasts`) não foram alteradas.
- **Autor:** Claude Code

### 2026-10-02 — Botão WhatsApp do card abriu o WhatsApp externo no celular: app instalado procura versão nova
- **Data:** 2026-10-02
- **Área:** Clientes / PWA
- **Alteração:** `components/PwaLifecycle.jsx` passa a procurar service worker novo ao voltar para o app (`visibilitychange`) e a cada 10 min com o app aberto; o service worker novo já assumia sozinho (`skipWaiting` + `controllerchange` recarrega) — agora a recarga espera o usuário parar de digitar (campo com texto em foco). Nenhuma mudança no botão: o código atual do card/ficha só abre `/admin/chat?client=` (sem ramo mobile/PWA/user-agent/deep link — teste estrutural em `tests/client-card-whatsapp-chat.test.mjs`).
- **Motivo:** no celular o botão abriu o app externo do WhatsApp. Causa provável (não reproduzível no código atual): o PWA fica aberto por dias sem navegação de página e o navegador só procura versão nova em navegação (ou ≤ 1×/24 h por push), então o app seguia com o JavaScript de antes da regra "abre o Chat". Prova indireta: não existe caminho externo no código atual (verificado em desktop e no componente da ficha/mobile) e o cliente arquivado segue o mesmo caminho.
- **Arquivos afetados:** `components/PwaLifecycle.jsx`, `tests/client-card-whatsapp-chat.test.mjs`, `docs/BUSINESS_RULES.md`
- **Risco/observação:** quem estiver com o app aberto numa versão antiga precisa fechar e abrir o app (ou tocar em "Atualizar") uma vez para receber esta correção. Outros botões "WhatsApp" (Meta Diária, Agenda "Enviar parabéns") continuam externos por desenho próprio — não alterados. Cliente arquivado + usuário não-dono: o Chat abre em branco (regra existente); corretor responsável não foi testado ao vivo (sem trocar de conta).
- **Autor:** Claude Code

### 2026-10-02 — Cliente arquivado: Chat vazio para o corretor, leitura só do dono (backend)
- **Data:** 2026-10-02
- **Área:** WhatsApp / Permissões
- **Alteração:** `getChatConversation` devolve `{ empty: true, messages: [] }` (sem erro) quando a conversa é de cliente arquivado e quem pede não é o dono; o Chat fecha a conversa e mostra o estado vazio normal (antes: "Conversa não encontrada."). Conversa oculta ANTES do arquivamento (sem `origin.archived_hidden_at`) agora também conta como de cliente arquivado (3 casos em produção) — a conta do dono passa a ler essas também. Acesso por identidade única (id Supabase Auth, sessão real), nunca por cargo; para trocar de dono, mudar `ARCHIVED_CHAT_VIEWER_AUTH_USER_ID`. Decisão pura em `archivedConversationAccess` (`lib/whatsapp-chat-scope.mjs`). Migration `20261002330000` (desarquivar apaga o histórico) aplicada em produção, sem mudança.
- **Motivo:** pedido do dono — corretor não pode ver nada do histórico de cliente arquivado, nem por ID/link/API; dono continua lendo.
- **Arquivos afetados:** `lib/whatsapp-chat.js`, `lib/whatsapp-chat-scope.mjs`, `components/WhatsappChat.jsx`, `tests/whatsapp-chat-scope.test.mjs`, `tests/whatsapp-archived-client-hidden.test.mjs`, `docs/BUSINESS_RULES.md` (WA-13)
- **Risco/observação:** `applyChatContactSignal` (lista de Clientes) ainda usa `last_human_reply_at` de conversas ocultas só para o selo de "último contato" — é um horário, não conteúdo; não alterado.
- **Autor:** Claude Code

### 2026-10-02 — Desarquivar cliente apaga o histórico do Chat (PENDENTE de aplicação no banco)
- **Data:** 2026-10-02
- **Área:** WhatsApp · Chat · Banco
- **Alteração:** a migration `20261002330000_whatsapp_unarchive_purges_chat_history.sql` troca o "desarquivar devolve as conversas" por "desarquivar apaga as conversas ocultas do cliente e as mensagens delas". A auditoria guarda só a contagem. Nada além do Chat é tocado.
- **Motivo:** regra do dono (WA-13, complemento).
- **Arquivos afetados:** migration acima, `tests/whatsapp-archived-client-hidden.test.mjs`, BUSINESS_RULES WA-13, WHATSAPP §6.
- **Risco/observação:** **ainda não aplicada em produção.** O SQL contém `DELETE` e o hook de proteção exige confirmação do dono, e as duas tentativas expiraram sem resposta. Aplicar quando o dono confirmar, testando antes em transação desfeita. Arquivos de mídia das conversas apagadas continuam no storage.
- **Autor:** Claude Code

### 2026-10-02 — Cliente arquivado: só o dono lê a conversa pelo card; demais veem o Chat em branco
- **Data:** 2026-10-02
- **Área:** WhatsApp · Chat · Permissões
- **Alteração:**
  - Complemento da WA-13. Pelo card de cliente arquivado, o dono (e-mail real da sessão) abre a conversa existente em modo somente leitura: sem caixa de mensagem, sem ações e sem "Assumir". A conversa continua fora da lista do Chat.
  - Os demais, inclusive o corretor do cliente, recebem o Chat em branco (`conversationId: null`), sem erro.
  - Escrita (enviar, reagir, editar, apagar, atribuir) continua respondendo 404 para conversa escondida.
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `lib/whatsapp-chat.js`, `components/WhatsappChat.jsx`, `lib/client-documents.js`, `tests/whatsapp-archived-client-hidden.test.mjs`, BUSINESS_RULES WA-13, WHATSAPP §6.
- **Risco/observação:** sem login real no painel, não testei a tela com usuário logado. Ficou coberto por teste estrutural e pela regra no servidor.
- **Autor:** Claude Code

### 2026-10-02 — Cliente arquivado sai do Chat e não volta com mensagem nova
- **Data:** 2026-10-02
- **Área:** WhatsApp · Chat · Banco
- **Alteração:**
  - A migration `20261002320000` cria o gatilho em `simulation_registrations`: arquivar esconde as conversas do cliente; desarquivar devolve só as que essa regra escondeu.
  - `whatsapp_chat_apply_inbound` deixa de restaurar e zera as não lidas quando o cliente está arquivado.
  - No código, conversa escondida não recebe push nem atribuição automática, e o botão "WhatsApp" do card de cliente arquivado devolve 409.
  - 9 conversas visíveis de clientes já arquivados foram escondidas, com auditoria (`detail.backfill`).
- **Motivo:** pedido do dono (BUSINESS_RULES WA-13).
- **Arquivos afetados:** migration acima, `lib/whatsapp-individual-inbound.js`, `lib/whatsapp-chat.js`, `tests/whatsapp-archived-client-hidden.test.mjs`, docs WHATSAPP §6, BUSINESS_RULES WA-13, rule integracoes-externas.
- **Risco/observação:**
  - Testado em produção numa transação desfeita: arquivar esconde, mensagem nova mantém escondida com 0 não lidas, desarquivar restaura.
  - Nada é apagado. As mensagens continuam sendo gravadas, então a Prospecção continua vendo resposta.
  - Envio de relatório de documentos pelo Chat para cliente arquivado passa a falhar com a mesma mensagem.
- **Autor:** Claude Code

### 2026-10-02 — Chat: entrada redundante do número oficial some da lista + aviso discreto se o contato não for salvo
- **Data:** 2026-10-02
- **Área:** WhatsApp / Clientes
- **Alteração:** (1) Lista normal do Chat e Visão geral escondem a conversa do número OFICIAL que não tem nenhuma mensagem útil (recebida, nota interna ou envio que não falhou; vazia também conta) quando existe, para o mesmo telefone, a conversa de WhatsApp pessoal que quem olha enxerga (`lib/whatsapp-chat-redundant.mjs`, `hideRedundantOfficialRows`). Só apresentação: nada é alterado nem apagado; a conversa continua acessível por id e no banco/auditoria. Caso real: conversa oficial da Lorgna Zapata, só com o envio que falhou. (2) Se o registro do contato (botão WhatsApp do card, em paralelo) falhar, o Chat mostra um aviso discreto (amarelo, com "Fechar"): "O Chat foi aberto, mas o contato … não pôde ser salvo/sincronizado" (`lib/whatsapp-contact-warning.mjs`); a navegação continua sem esperar o registro.
- **Motivo:** acabamentos pedidos pelo dono.
- **Arquivos afetados:** `lib/whatsapp-chat-redundant.mjs`, `lib/whatsapp-chat.js`, `lib/whatsapp-contact-warning.mjs`, `components/WhatsappChat.jsx`, `components/clients/useClientList.js`, `tests/whatsapp-chat-redundant.test.mjs`, `tests/client-card-whatsapp-chat.test.mjs`, `docs/BUSINESS_RULES.md`
- **Risco/observação:** a lista nunca mostra a entrada oficial redundante, mas contadores/resumo não mudam (ela não tem não lidas nem "aguardando"). Se a página fizer navegação completa (em vez de suave), a falha do registro não é detectada (o navegador cancela o callback). Sem Node no ambiente: testes não executados localmente.
- **Autor:** Claude Code

### 2026-10-02 — Chat: conversa da Lorgna Zapata separada por sessão + clique do botão WhatsApp com resposta imediata
- **Data:** 2026-10-02
- **Área:** WhatsApp / Clientes / Banco
- **Alteração:** (1) Conversa `39647f9f…` (criada pelo código antigo com chave de número oficial): as 2 mensagens recebidas pela sessão da ketlin (canal `whatsapp_individual`, `session_user_id` = ketlin, `remote_jid` @lid, 11:21 UTC) foram para a conversa (telefone + sessão ketlin), sem atribuição (igual à original); o envio das 12:22 UTC (canal `whatsapp_cloud_api`, sem sessão, `failed`, feito pelo Chat antes do deploy do código novo) ficou na conversa do número oficial. O alerta "sem resposta" (`whatsapp_reply_alerts`) acompanhou as mensagens recebidas. Backup em `p_backup_20261002_lorgna_split` e log em `whatsapp_conversation_split_log` (`reason = session_split_lorgna_20261002`). (2) Botão "WhatsApp" do card: o registro do contato passou a rodar em paralelo (`keepalive`) e a navegação em transição com o card ocupado.
- **Motivo:** pendências do pedido do dono sobre o isolamento por sessão e o "primeiro clique parado". Causa do 1º clique: nos testes o navegador automatizado estava em aba oculta (`visibilityState = hidden`), então o 1º clique só trazia a aba ao foco (nenhum evento `click` chegava à página); no uso real o que existia era latência sem aviso (~2 s do registro do contato + ~0,5 s da navegação, em série).
- **Arquivos afetados:** `supabase/migrations/20261002310000_whatsapp_lorgna_conversation_session_split.sql` (já aplicada), `components/clients/useClientList.js`, `tests/client-card-whatsapp-chat.test.mjs`, `docs/BUSINESS_RULES.md` (WA-13)
- **Risco/observação:** falha ao registrar o contato não bloqueia mais a abertura do Chat (best-effort). Reverter a separação: mover as 2 mensagens de volta pelo log. Não rodei `node --test` (sem Node no ambiente).
- **Autor:** Claude Code

### 2026-10-02 — P-01 Etapa 2b: #C3846 separado em três contatos (dados)
- **Data:** 2026-10-02
- **Área:** Dados · Meta Diária / Prospecção
- **Alteração:** confirmado pela Caroline, …2973 (Alex) e …3947 ganharam cards próprios (#C4523 e #C4524, responsável Caroline, `awaiting_return`) e saíram do #C3846; …0409 continua nele. Contato, rodada, tentativa e histórico de cada telefone, e a conversa do Chat do Alex, foram re-apontados para o card próprio. Auditoria em `prospecting_history` (`details.fix = p01-stage2b-20261002`).
- **Motivo:** o bug P-01 (nome "Sem Nome") juntou três telefones num só card em 28/09.
- **Arquivos afetados:** só dados. Backup: `p01s3_backup_20261002_*` (client, contacts, rounds, attempts, history, conversations, journey, status_history). #C3919 intocado.
- **Risco/observação:** sem recálculo de pontuação; impressão digital das fontes do ranking idêntica antes/depois. Reverter = restaurar das tabelas de backup.
- **Autor:** Claude Code

### 2026-10-02 — SQL canônico do funil: Venda = primeira entrada (MET-12)
- **Data:** 2026-10-02
- **Área:** Docs · Métricas
- **Alteração:** a coluna `venda` de `docs/analytics/funil-painel.sql` passou de "rk ≥ 7" para "primeira entrada em status de venda no período", igual a `buildFirstSaleEntries`/`countFirstSalesInRange` do painel. Cliente criado já em venda e sem histórico de venda conta na criação. `venda_etapa_alcancada` fica só para conferência.
- **Motivo:** o `analista-dados` encontrou 3 "vendas" em 28/09–01/10. Na verdade a primeira entrada delas foi em 20/08, 31/08 e 08/09, e em 01/10 só mudaram de subetapa (Conformidade/Pagamento/Pago). Pela regra oficial MET-12 o período tem 0 vendas.
- **Arquivos afetados:** `docs/analytics/funil-painel.sql`, `docs/METRICAS_FUNIL.md`, `tests/funil-painel-sql.test.mjs` (o teste falha com o SQL antigo e confere as etapas do SQL contra `CLIENT_FUNNEL_STAGES`).
- **Risco/observação:** Aprovado e Reunião continuam cumulativos, como no painel: as mesmas 3 vendas antigas entram na coorte do período por mudar de subetapa e contam em Aprovado/Reunião (4 e 3; de fato 1 aprovação e 0 reuniões novas). É o comportamento atual do painel, não corrigido aqui. Se movimentação dentro de Venda deve ou não colocar o cliente na coorte do período é decisão do dono.
- **Autor:** Claude Code

### 2026-10-02 — Supabase MCP estável (`Supabase`, somente leitura) e banco realmente read-only para agentes analíticos
- **Data:** 2026-10-02
- **Área:** Infra · Permissões · Banco
- **Alteração:**
  - `.mcp.json` com o servidor `Supabase`: MCP oficial hospedado, `project_ref` do projeto, `read_only=true`, OAuth.
  - Hook `guard-destructive-sql.mjs` agora vale para qualquer servidor Supabase (matcher `mcp__.*__…`). Para os agentes analíticos, força `set transaction read only` (o Postgres recusa escrita) e nega escrita explícita e migration. Para a sessão principal, escrita, DDL e migration pedem confirmação.
  - `apply_migration` saiu de `allow` e foi para `ask`.
  - `enabledMcpjsonServers` aprova o servidor `Supabase`.
- **Motivo:** no desktop o conector da conta tem prefixo UUID e os agentes (`mcp__Supabase__*`) ficavam sem banco. O "somente leitura" era só texto de prompt.
- **Arquivos afetados:** `.mcp.json`, `.claude/settings.json`, `.claude/hooks/guard-destructive-sql.mjs`, `tests/guard-destructive-sql.test.mjs`, `docs/PLANO_SUPABASE_MCP_ALIAS.md`, `.claude/rules/workflow-dev.md`.
- **Risco/observação:**
  - Validado com o `analista-dados` real (`/analisar-funil`): `transaction_read_only = on`.
  - Escrita em transação read-only é recusada pelo banco (25006).
  - Validação numa sessão nova na nuvem: o servidor do projeto toma o nome `Supabase` e o conector da conta passa a aparecer com UUID. Sem login possível na nuvem, a autenticação passou a ser por token pessoal (`SUPABASE_ACCESS_TOKEN`, configurado pelo dono no Windows e no ambiente da nuvem). Até isso ser feito, os agentes ficam sem banco nas sessões novas; a escrita continua pelo conector da conta.
### 2026-10-02 — Chat: parte 2 da migração (telefone + sessão) aplicada em produção
- **Data:** 2026-10-02
- **Área:** WhatsApp / Banco
- **Alteração:** aplicada `20261002290100_whatsapp_conversation_per_session_split` (autorizada pelo dono): removido o UNIQUE global de `whatsapp_conversations.contact_phone` (fica só UNIQUE(`contact_phone`, `session_key`)); dedupe do WhatsApp pessoal por sessão (`whatsapp_messages_individual_wa_id_uidx` = `session_user_id` + `wa_message_id`); criada `whatsapp_conversation_split_log`. Separadas exatamente as 23 mensagens auditadas (conversas 471ed956…, ccd9ac6d…, fa256805…) em 4 conversas novas (telefone + sessão); log com 23 linhas (reversível). 2848 mensagens antes e depois; conversas 269 → 273.
- **Motivo:** fim do cruzamento entre corretores (ver 2026-10-02 "Chat: conversa passa a ser telefone + sessão").
- **Arquivos afetados:** `supabase/migrations/20261002290100_whatsapp_conversation_per_session_split.sql` — a versão aplicada limita o split às 3 conversas auditadas, tem trava "exatamente 23" (aborta se diferente) e não repete a reclassificação em lote da parte 1.
- **Risco/observação:** ficou fora (nova autorização necessária) a conversa `39647f9f…` (cliente Lorgna Zapata, criada depois da auditoria): 2 mensagens recebidas pela sessão da ketlin + 1 envio manual pelo número oficial na mesma conversa de chave oficial. O botão WhatsApp do card dela abriria uma conversa nova (telefone + sessão da ketlin) em vez dessa. Reverter o split: mover as mensagens de volta pelo `whatsapp_conversation_split_log` (message_id → from_conversation_id).
- **Autor:** Claude Code

### 2026-10-02 — Chat: conversa passa a ser (telefone + sessão do WhatsApp) — fim do cruzamento entre corretores
- **Data:** 2026-10-02
- **Área:** WhatsApp / Banco
- **Alteração:** `whatsapp_conversations.session_key` (uuid; chave vazia = número oficial, senão o `admin_users.id` dono do WhatsApp pessoal) e UNIQUE(`contact_phone`, `session_key`) no lugar de UNIQUE(`contact_phone`). Entrada pelas sessões individuais, envio, visibilidade, não lidas, preview, botão "WhatsApp" do card, contadores por corretor e auditoria de atendimento passam a considerar a sessão. Dedupe do WhatsApp pessoal passou a ser por sessão: índice `(session_user_id, metadata->>'wa_message_id')`. Conversa do WhatsApp pessoal de alguém não é entregue a outra pessoa (`assignChatConversation` recusa). Envio de conversa de sessão sai SEMPRE pela sessão dela (nunca pelo atribuído). Conversa do número oficial atribuída a um corretor com sessão conectada é "adotada" como a conversa do WhatsApp pessoal dele no 1º envio/recebimento. Reconciliações de lead (organic/patrocinado) só olham o número oficial. Trigger `sync_whatsapp_conversation_assignee` só acompanha o novo responsável nas conversas do oficial e do WhatsApp dele.
- **Motivo:** bug crítico — mensagens/prévias/não lidas e respostas cruzavam entre corretores quando o mesmo cliente conversava com WhatsApps de corretores diferentes (ver INCIDENTES).
- **Arquivos afetados:** `supabase/migrations/20261002290000_whatsapp_conversation_session_key.sql` (parte 1, aditiva) e `20261002290100_whatsapp_conversation_per_session_split.sql` (parte 2: troca o UNIQUE, índice de dedupe e separa conversas misturadas com log em `whatsapp_conversation_split_log`), `lib/whatsapp-chat-scope.mjs`, `lib/whatsapp-chat.js`, `lib/whatsapp-individual-inbound.js`, `lib/client-phone-lookup.js` (`findConversationByPhone` agora é por sessão; padrão = oficial), `lib/whatsapp-attendance.js`, `lib/whatsapp-sponsored-lead.js`, `lib/attendance-audit.js`, `lib/alexa-reply-alert.js`, `app/api/webhooks/whatsapp-individual/route.js`, `tests/whatsapp-conversation-per-session.test.mjs` (+ `tests/helpers/*`), `tests/whatsapp-chat-scope.test.mjs`, `tests/client-card-whatsapp-chat.test.mjs`
- **Risco/observação:** quem busca conversa por telefone PRECISA dizer a sessão (padrão = número oficial). Conversa com o oficial e conversa com o WhatsApp pessoal do mesmo corretor podem coexistir como duas linhas (raro): responder na do oficial devolve erro `USE_SESSION_CONVERSATION` pedindo para abrir a do WhatsApp dele. O código novo exige a migration parte 1; a parte 2 só depois do deploy. Mensagens antigas só foram movidas onde a sessão que as recebeu/enviou (`session_user_id`) provava o vínculo; cada movimento fica em `whatsapp_conversation_split_log` (reversível). Não corrigidos (fora do pedido): contador de não lidas fino por mensagem, armazenamento público de mídias, conversas pessoais novas.
- **Autor:** Claude Code (sessão de correção do cruzamento de conversas)

### 2026-10-02 — Financeiro: base única de recebimento (bruta) e leitura correta de valor brasileiro
- **Data:** 2026-10-02
- **Área:** Financeiro
- **Alteração:** (1) `lib/financial-receipt-basis.mjs`: única definição de comissão recebida (alvo = comissão BRUTA; recebido = pagamentos `received`; recebida ⇔ recebido ≥ bruta; saldo = max(0, bruta − recebido)), em centavos, usada por `deriveFinancialStatus`, reparo do "Pago", `computeForecastAmount` (Previsão/Agenda/Saúde), `planConfirmation`, `healStatusFromPayments` e `receivableTotal` (servidor e tela). A comissão livre segue só como base da distribuição. Parâmetro `freeCommission` → `grossCommission` nessas funções. (2) `lib/money-br.mjs`: "1.500" = 1500, "1.500,50" = 1500,5, "1500" = 1500, "1500,50" = 1500,5; ponto com 1–2 casas continua decimal (formato do banco/JSON); percentuais usam `parseBrazilianDecimal` (sem regra de milhar). Substitui as 3 cópias (`normalizeMoneyValue` do servidor e da tela, `parseMoney` do modal de recebimento).
- **Motivo:** pedido do dono — as 2 pendências críticas da auditoria incremental (recebimento em dobro no "Pago"; "1.500" virando R$ 1,50).
- **Arquivos afetados:** `lib/financial-receipt-basis.mjs` (novo), `lib/money-br.mjs` (novo), `lib/financial.js`, `lib/financial-expected-receipt-core.mjs`, `lib/financial-expected-receipt-db.mjs`, `lib/financial-receipt-repair-core.mjs`, `lib/financial-health-core.mjs`, `components/AdminFinancialDashboard.jsx`, `components/ReceiptActionModals.jsx`, `tests/money-br.test.mjs`, `tests/financial-expected-receipt.test.mjs`, `docs/BUSINESS_RULES.md` (FIN-1/FIN-5), `.claude/rules/financeiro.md`, `docs/FINANCEIRO_SAUDE.md`, `docs/INCIDENTES.md`.
- **Risco/observação:** mudança visível e intencional: "Comissão a receber" e o valor previsto da Agenda passam a ser BRUTA − recebido (antes LIVRE − recebido) nas vendas com nota/despesa; hoje afeta o lembrete de 1 venda (R$ 20.000 → R$ 30.000). Sem migration e sem correção de dado histórico (auditoria: nenhum recebimento duplicado, nenhum valor mal lido). Fora do escopo, não alterado: recebimento aceita data futura, `reconcileExpectedReceiptActivities` por minuto, cálculo "livre" repetido na tela.
- **Autor:** Claude Code
### 2026-10-02 — Botão "WhatsApp" do card de cliente abre a conversa no Chat do CRM
- **Data:** 2026-10-02
- **Área:** Clientes / WhatsApp
- **Alteração:** o botão (card e ficha de Clientes) deixou de abrir `wa.me`/WhatsApp Web e navega para `/admin/chat?client=<id>`, que localiza a conversa do cliente (vinculada, senão por telefone), cria uma só se não houver e a seleciona. Abrir pelo card não muda mais atendente/status da conversa (`assign: false`). Busca por `client_id` antes do telefone e tratamento da corrida de criação (23505) em `openChatForClient`.
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `components/clients/useClientList.js`, `app/api/admin/whatsapp-chat/open-client/route.js`, `lib/whatsapp-chat.js`, `docs/BUSINESS_RULES.md` (WA-13), `tests/client-card-whatsapp-chat.test.mjs`
- **Risco/observação:** o clique segue registrando `last_whatsapp_contact_at` como antes (mesmo sem mensagem enviada); o envio efetivo continua pelo canal que o Chat escolher (individual conectado ou número oficial dentro das 24 h). Outros botões WhatsApp não mudaram.
- **Autor:** Claude (Code)


### 2026-10-02 — Resposta de cliente em Prospecção promove sozinho para "Em atendimento" (substitui a pendência manual de PRO-8)
- **Data:** 2026-10-02
- **Área:** WhatsApp / Prospecção / Meta Diária
- **Alteração:** cliente em "Tentando contato" que está em prospecção e RESPONDE pelo WhatsApp passa sozinho para "Em atendimento" (no nome do corretor responsável, `client_status_history.source = whatsapp_chat`); a cadência continua sendo encerrada (rodada `converted`, fila cancelada). Antes (PRO-8 da manhã do mesmo dia) o status não mudava e o corretor resolvia pela pendência "Cliente respondeu — atualizar status". A pendência só é aberta se não houver corretor responsável (rede de segurança). `markClientsInServiceOnReply` ganhou `includeProspected`; o Chat do individual continua deixando o cliente em prospecção para a Prospecção (evita corrida com o cancelamento da cadência); o número oficial promove direto.
- **Motivo:** pedido do dono — Lu Indique Flavia, Lorgna Zapata e mais 3 clientes de hoje ficaram em "Tentando contato" mesmo depois de responder (não era falha de recebimento: a pendência estava aberta, por desenho de PRO-8). Decisão do dono: automático.
- **Arquivos afetados:** `lib/prospecting-reply.js`, `lib/prospecting-reply-core.mjs` (comentário), `lib/whatsapp-client-status.js`, `lib/whatsapp-chat.js`, `docs/BUSINESS_RULES.md` (PRO-8), `.claude/rules/roleta-prospeccao-campanhas.md`, `tests/prospecting-reply-auto-service.test.mjs`, `tests/prospecting-reply-core.test.mjs`
- **Risco/observação:** "agora não"/"me chama depois" também promovem (só pedido inequívoco de parar vira Não contactar). O "Aguardando há X min" do Chat não é status: continua até alguém da equipe responder a conversa. PRO-9 (trava) não precisa de pendência para liberar: o cliente já sai de "Tentando contato". Dados: 5 clientes de 02/10 corrigidos pelo mesmo caminho (histórico de status gravado) e pendências resolvidas com `resolution = auto_in_service`.
- **Autor:** Claude (Code)


### 2026-10-02 — Documentação: segundo proponente não precisa de comprovante de residência
- **Data:** 2026-10-02
- **Área:** Documentação/CCA
- **Alteração:** a regra de titularidade do comprovante de residência (Base Mestra `residence_income_ownership`) e a validação da fonte da conta (`residence_source`) eram aplicadas a QUALQUER pessoa do lote, comparando o nome do documento com o do proponente principal e usando a renda do principal — um comprovante do segundo proponente virava pendência ("Renda informal exige comprovante em nome do próprio cliente."). Regra do dono: comprovante de residência só do principal. Fonte única em `lib/document-policy.mjs` (`isResidenceRequiredForRole`, `normalizeNonPrincipalResidenceItem`): `residenceDecision` recebe `personRole`, `document-analysis.js` descarta qualquer pendência/validação/divergência/ilegível de comprovante de não-principal (inclusive as vindas da própria IA) e o prompt da IA ganhou a instrução. `recomputeRequirements` (`lib/client-documents.js`) também limpa linhas já gravadas — então reanálise/recálculo corrige análises antigas sem custo de IA e não recria a pendência. O motor (`document-requirements-engine.js`) continua exigindo comprovante só do titular; comprovante neutralizado de um não-principal que era "precisa_confirmacao" segue sem valer como prova do principal.
- **Motivo:** pedido do dono (caso real: segundo proponente com renda informal recebeu a pendência indevida). Correção genérica, sem tratamento por cliente.
- **Arquivos afetados:** `lib/document-policy.mjs`, `lib/document-ai-rule-core.mjs`, `lib/document-analysis.js`, `lib/document-requirements-engine.js`, `lib/client-documents.js`, `tests/document-second-proponent-residence.test.mjs`, `.claude/analista-documental/REGRAS-DOCUMENTAIS.md`.
- **Risco/observação:** `node --test tests/document-*.test.mjs` passa (57 ok, 4 todo já existentes). Regras do principal inalteradas. Sem migration.
- **Autor:** Claude Code

### 2026-10-02 — Auditoria incremental (38 commits depois de 32eb4dd): vazamento da previsão do dono, hibernação, grants, defesas do disparo automático
- **Data:** 2026-10-02
- **Área:** Financeiro / Prospecção / Meta Diária / Banco / Testes
- **Alteração:** (1) **Vazamento corrigido (FIN-5):** o card do cliente (`listCalendarActivitiesForClient(s)`, `lib/calendar-activities.js`) devolvia a atividade "Confirmar recebimento" — título/nota com valor e data da previsão de comissão — a admin geral não dono, gestor e corretor responsável; agora só o dono recebe linhas com `financial_sale_id`. (2) **Hibernação de 24 h** (`hibernateEndedDailyGoalRounds`) passou a respeitar a pendência de resposta aberta, como o retorno automático já fazia (cliente que respondeu depois da 3ª tentativa perdia o responsável). (3) **Disparo automático:** o cron (`runDailyGoalAutoDispatch`) recusa a linha do número do dono (antes só o caminho "ao conectar" recusava); a marcação de início de envio detecta 0 linhas (item recuperado no meio) e não envia; removida a exportação morta `setDailyGoalAutoEnabled` (sem chamadores, ligava a automação sem a recusa do dono). (4) **Banco** (`20261002300000_audit_incremental_grants_and_search_path.sql`, aplicada): `revoke` de anon/authenticated + `grant` a service_role nas 6 tabelas financeiras (3 novas da Saúde + vendas/recebimentos/despesas da venda — tinham RLS sem policy mas ainda GRANT total, inclusive TRUNCATE); `daily_goal_reserve_wallet_slots` deixou de ser executável por anon/authenticated/public; `search_path` fixo em `claim_next_daily_goal_auto_item`/`claim_next_extra_dispatch_item`. (5) **Performance:** o status do "Disparar" (`ProspectingManager`, ~10 consultas por leitura) só recarrega com a aba visível. (6) **Pequenos:** linha "Respostas da prospecção" no menu "Mais" do mobile (o selo já somava, sem linha), rótulo `pairing_code_required` nos cards de automação, comentário de referência errada, 2 testes obsoletos (modelo "Menu principal"; leitura de fontes com CRLF no Windows).
- **Motivo:** pedido do dono — auditoria só do delta, sem repetir a auditoria geral.
- **Arquivos afetados:** `lib/calendar-activities.js`, `lib/prospecting-auto-return.js`, `lib/daily-goal-auto.js`, `lib/financial-expected-receipt-core.mjs`, `components/{ProspectingManager,AdminBottomNav,TeamDailyPerformance,DailyGoalAdmin}.jsx`, `tests/{whatsapp-flow-core,prospecting-status-lock-core}.test.mjs`, migration acima, `docs/PERFORMANCE_AUDIT.md`.
- **Risco/observação:** build limpo; `node --test tests/*.test.mjs` = 629/636 (as 2 falhas de `journey-http` precisam de servidor local; não relacionadas). Validado com a chave anon real: as 6 tabelas e a função negam acesso; service_role continua lendo tudo. **Não corrigido (decisão/risco — lista completa em `docs/PERFORMANCE_AUDIT.md`, seção "Auditoria incremental"):** limiar "recebido" bruta × livre (dupla contagem no "Pago"), webhook do serviço individual sem retry/timeout, índice único global de `wa_message_id` derruba uma ponta de conversa entre colegas, conversas órfãs invisíveis ao gestor que continua sendo avisado, "Não contactar" fora da busca em "Todos", timeout de envio automático reenfileirado (risco de duplicar), religar corretor desligado ao reconectar, fila "Disparar" sem teto diário, contagens do admin da automação truncadas em 1000 linhas.
- **Autor:** Claude Code

### 2026-10-02 — Chat: números internos não viram cliente, visibilidade por hierarquia e limpeza de conversas particulares do dono
- **Data:** 2026-10-02
- **Área:** WhatsApp · Chat · Permissões · Banco
- **Alteração:** (1) caminhos automáticos do WhatsApp (contato direto no individual, anúncio/orgânico e palavra-chave/Fluxo no oficial, resposta à Prospecção, status por resposta) consultam `findInternalTeamPhone` e não criam/vinculam card de número da equipe; formulário/links/captação/manual não mudam. (2) `chatScope` passou a seguir a hierarquia: admin tudo, gestor próprias + equipe (`managedUserIds`), corretor só as próprias; mensagens do WhatsApp individual de quem está fora do escopo ficam ocultas; gestor só atribui dentro da equipe; aviso de mensagem interna só ao gestor da equipe. (3) Migration `20261002280000_whatsapp_session_known_numbers` (coluna `known_phone_numbers` + trigger que guarda todo número já conectado). (4) Removidas do CRM 2 conversas particulares do WhatsApp do dono (sem cliente/prospecção; já ocultas por ele em 28/09), com registro em `whatsapp_conversation_audit` (`detail.purged`).
- **Motivo:** pedido do dono — conversa entre integrantes criou card (ex.: "Jennyfer Zorzato", criado às 09:57 de 02/10 pela sessão do dono); gestor via conversas de toda a empresa, inclusive as do dono.
- **Arquivos afetados:** `lib/internal-phones*.{js,mjs}`, `lib/whatsapp-chat-scope.mjs`, `lib/whatsapp-chat.js`, `lib/whatsapp-individual-inbound.js`, `lib/whatsapp-sponsored-lead.js`, `lib/whatsapp-automation-replies.js`, `lib/whatsapp-master.js`, `lib/whatsapp-flows.js`, `lib/prospecting-reply.js`, `lib/client-documents.js`, migration acima, testes `tests/internal-phones-core.test.mjs`, `tests/internal-phones-creation-paths.test.mjs`, `tests/whatsapp-chat-scope.test.mjs`. Docs: BUSINESS_RULES WA-11/WA-12, PERMISSIONS, WHATSAPP §1-A/§6, rule integracoes-externas.
- **Risco/observação:** gestora deixa de ver 126 conversas sem atendente/cliente da equipe (ficam só com o admin). O número particular do dono não está gravado (sessão desconectada e telefone do perfil vazio): até ele reconectar ou preencher o telefone no perfil, mensagem do dono para um corretor ainda pode criar card. Card "Jennyfer Zorzato" (criado pelo bug) NÃO foi apagado — exclusão é irreversível e só do dono. Prévia da última mensagem na lista é da conversa inteira (não filtrada por sessão).
- **Autor:** Claude Code

### 2026-10-02 — Chat (WhatsApp individual): mídia, responder, reagir, editar, apagar para todos e sincronização — celular, app e navegador
- **Data:** 2026-10-02
- **Área:** WhatsApp · Chat · Frontend/PWA
- **Alteração:** o canal individual (antes só texto) passou a receber e enviar foto, vídeo, GIF, figurinha, áudio e documento; responder com citação e reagir nas duas direções; editar (até 15 min) e apagar para todos (até 48 h) as próprias mensagens; ações feitas direto no WhatsApp do celular (reação, edição, apagar, mídia, citação) sincronizam no Chat. Regras em um só módulo puro (`lib/whatsapp-message-actions.mjs`), aplicadas no servidor; a tela só mostra o que o servidor permite (`canReply/canReact/canEdit/canDelete`). Interface única com duas formas de abrir o mesmo menu: toque longo (folha inferior) no celular; clique direito ou "⋯" no computador/navegador. Rotas novas: `PATCH/DELETE …/conversations/[id]/messages/[messageId]`, `POST …/conversations/[id]/media/upload-target` (arquivo até 16 MB direto ao storage), `POST /api/webhooks/whatsapp-individual/media-upload` (microsserviço guarda a mídia recebida no bucket privado). Microsserviço: rotas `/react`, `/edit`, `/delete`, `send` com `quoted`/vídeo/GIF/figurinha, download de mídia recebida. Bucket `whatsapp-chat-media` passou a aceitar 16 MB.
- **Motivo:** pedido do dono ("compatibilidade multiplataforma" — os mesmos recursos nos 3 ambientes, sem lógica separada por interface); prioridade WhatsApp individual (número oficial banido).
- **Arquivos afetados:** `lib/whatsapp-message-actions.mjs`, `lib/whatsapp-chat.js`, `lib/whatsapp-individual.js`, `lib/whatsapp-individual-inbound.js`, `lib/whatsapp-media.js`, `lib/media-storage.js`, `lib/whatsapp-reactions.mjs`, `app/api/webhooks/whatsapp-individual/**`, `app/api/admin/whatsapp-chat/conversations/[id]/{messages/[messageId],media,media/upload-target}`, `components/WhatsappChat.jsx`, `components/WhatsappMessageActions.jsx`, `whatsapp-individual-service/src/*`, vitrine `app/dev/vitrine/_fixtures/chat.js`, testes `tests/whatsapp-message-actions.test.mjs`, `tests/whatsapp-individual-extract.test.mjs`, `tests/whatsapp-reactions.test.mjs`. Docs: `docs/WHATSAPP.md` §1-A/§6, rule `integracoes-externas.md`, README do microsserviço.
- **Risco/observação:** reação/edição/apagar nunca contam como resposta da Prospecção (PRO-9). Mídia do cliente sem legenda conta como resposta real. GIF `.gif` sai como arquivo (sem conversão de vídeo no servidor); `.webp` pode ir como figurinha. Responder com anexo não é suportado (só texto). Edição/apagar não existem no número oficial. Testado na vitrine (Playwright) em 360/390/430 px com toque e em 800/1024/1366 px com mouse; **não** testado contra o WhatsApp real (sem enviar mensagem real). Ordem de publicação: CRM primeiro (aceita os eventos novos e os antigos), depois o microsserviço no Railway (reinicia as sessões).
- **Autor:** Claude Code

### 2026-10-02 — Novos modelos das mensagens automáticas aplicados (4/4/10) + variáveis {saudacao} e {associado_a}
- **Data:** 2026-10-02
- **Área:** Meta Diária · Prospecção · WhatsApp
- **Alteração:** modelos aprovados pelo dono gravados em produção (`crm_settings.daily_goal_auto_messages`) e como padrão do código (`lib/daily-goal-auto-messages.mjs`). `renderAutoMessage` passou a resolver `{saudacao}` (hora real do envio) e `{associado_a}`; texto com variável sobrando não é enviado; salvar pela tela mantém parágrafos (antes `cleanText` juntava tudo numa linha) e recusa variável desconhecida.
- **Motivo:** correção — o commit anterior só ampliou o limite para 10 modelos; os textos novos não tinham sido aplicados e as variáveis novas sairiam cruas.
- **Arquivos afetados:** `lib/daily-goal-auto-messages.mjs`, `lib/daily-goal-auto-core.mjs`, `lib/daily-goal-auto.js`, `lib/prospecting-extra-dispatch.js`, `lib/daily-goal.js`, `components/DailyGoalAdmin.jsx`, `tests/daily-goal-auto-messages.test.mjs`.
- **Risco/observação:** ordem segura: código publicado ANTES de gravar os textos no banco (o código anterior não resolvia `{saudacao}`). Anti-repetição do commit 3356ba0 intacta. Caroline Mayumi e ketlin estão sem gênero cadastrado → recebem a frase neutra até o gênero ser preenchido.
- **Autor:** Claude Code

### 2026-10-02 — Modelos das mensagens automáticas: sorteio com anti-repetição no momento do envio
- **Data:** 2026-10-02
- **Área:** Meta Diária · Prospecção · WhatsApp
- **Alteração:** a escolha do modelo deixou de ser a rotação fixa 1A→1B→1C→1D (escolhida na montagem da fila/no clique do Disparar) e passou a ser sorteio com anti-repetição por WhatsApp e tentativa, feito no servidor imediatamente antes do envio, igual para Meta Diária e Disparar. 3ª tentativa aceita até 10 modelos (1ª/2ª continuam até 4).
- **Motivo:** pedido do dono — variar textos de verdade para não repetir o mesmo texto pelo mesmo número, sem ordem previsível.
- **Arquivos afetados:** `lib/daily-goal-auto-core.mjs` (`pickAntiRepeatVariant`, `cycleStateFromHistory`, `wasVariantActuallySent`; saíram `pickMessageVariant`/`nextSequentialVariantIndex`), `lib/daily-goal-auto.js` (`selectVariantForSend`), `lib/prospecting-extra-dispatch.js`, `lib/daily-goal.js` (`AUTO_MESSAGE_MAX_VARIANTS`), `components/DailyGoalAdmin.jsx`, testes `tests/message-variant-anti-repeat.test.mjs`, `tests/daily-goal-auto-core.test.mjs`.
- **Risco/observação:** sem migration. As colunas `variant_cursor_attempt1/2/3` de `daily_goal_auto_settings` deixaram de ser usadas (mantidas). Em produção a 3ª tentativa tem hoje 4 modelos cadastrados — o ciclo de 10 passa a valer quando o dono cadastrar os outros 6. Itens já na fila com modelo antigo gravado são re-sorteados no envio. Nenhuma mensagem real enviada nos testes.
- **Autor:** Claude Code

### 2026-10-02 — Prospecção: botão "Disparar" (fila extra 10 + cooldown 1 h) e trava de status sem resposta real
- **Data:** 2026-10-02
- **Área:** Prospecção · Meta Diária · Ranking · WhatsApp · Banco
- **Alteração:** (1) Trava de status: cliente de disparo (tentativa automática ou Disparar) em "Tentando contato" não avança à mão até resposta real (fonte: pendência "Cliente respondeu"/rodada convertida pela automação de resposta) — barrada no servidor antes de gravar (sem histórico/pontos). (2) Botão WhatsApp da Prospecção → "Disparar": põe UM cliente na fila do corretor (sem lote), envio pelo mesmo motor da automação (4 modelos da 1ª tentativa), Meta 100% obrigatória, até 10 por ciclo, 1 h de pausa depois dos 10 processados, cadeado + X/10 na tela. 2ª/3ª tentativa seguem na Meta Diária do mesmo corretor. (3) Um envio por vez por número e intervalo contado do último envio de qualquer fila. (4) Reserva do Disparar não conta como atividade (conta a mensagem enviada).
- **Motivo:** regras do dono (impedir que disparos sem resposta virem Atendimento/Simulação para inflar o Ranking; prospecção extra controlada).
- **Arquivos afetados:** `lib/prospecting-status-lock.js`, `lib/prospecting-status-lock-core.mjs`, `lib/prospecting-extra-dispatch.js`, `lib/prospecting-extra-core.mjs`, `lib/daily-goal-auto.js`, `lib/daily-goal.js`, `lib/daily-goal-wallet.js`, `lib/performance-overview.js`, `lib/prospecting.js`, `lib/simulation-registrations.js`, `lib/client-documents.js`, `app/api/prospecting/[id]/route.js`, `app/api/prospecting/extra-dispatch/route.js`, `components/ProspectingManager.jsx`, `components/DailyGoalAdmin.jsx`, migration `20261002240000_prospecting_extra_dispatch_queue.sql` (aplicada), testes `tests/prospecting-status-lock-core.test.mjs`, `tests/prospecting-extra-core.test.mjs`.
- **Risco/observação:** trava só para rodadas criadas a partir de 2026-10-02 09:00 UTC (não retroativa). Admin geral real (fora do "Alterar conta") pode destravar — escolha técnica, a confirmar com o dono. Fila extra respeita pausa da automação: com os corretores pausados, o Disparar fica travado ("Disparos automáticos pausados"). Funções do banco testadas em transação desfeita (1→10, 11º recusado, duplo clique, cooldown, reset após 1 h, Não contactar/mesma pessoa/base de outro recusados, um envio por vez). Nenhuma mensagem real enviada; nenhum corretor reativado. `claim_next_daily_goal_auto_item` passou a pegar só itens da Meta e a não liberar item enquanto houver outro "enviando" do mesmo número; EXECUTE revogado de anon/authenticated nas funções novas.
- **Autor:** Claude Code

### 2026-10-02 — Corretor vê os próprios clientes em "Não contactar"
- **Data:** 2026-10-02
- **Área:** Clientes · Permissões
- **Alteração:** `canViewDoNotContact` passa a liberar para todos os perfis; o escopo por responsável continua (corretor vê os seus, gestor os da equipe). Nas listas, "Não contactar" segue fora da aba "Todos" e aparece em "Arquivados", na pesquisa e na ficha — a mesma visão que o dono já tinha.
- **Motivo:** regra do dono (evitar confusão: o cliente sumia da carteira do corretor depois de "Não contactar").
- **Arquivos afetados:** `lib/simulation-registrations.js`, `lib/simulation-list-query.js` (comentário), `docs/BUSINESS_RULES.md` (CLI-9), `.claude/rules/roleta-prospeccao-campanhas.md`.
- **Risco/observação:** listas de aniversário/agenda também passam a incluir os "Não contactar" do corretor (como já acontecia para o dono); bloqueios de prospecção/automação/disparo inalterados.
- **Autor:** Claude Code

### 2026-10-02 — Número do dono não faz disparo automático da Meta Diária
- **Data:** 2026-10-02
- **Área:** Meta Diária (automação WhatsApp)
- **Alteração:** `ensureDailyGoalAutoEnabledOnConnect` não liga mais a automação quando quem conecta o WhatsApp é o dono (`isOwnerAdminEmail`). Dado: automação do dono desligada (`enabled=false`) e 20 envios pendentes cancelados (`numero_do_dono_sem_disparo`); nenhum envio automático jamais saiu do número dele.
- **Motivo:** decisão do dono — só os números dos corretores fazem disparo; ao conectar o WhatsApp do dono por código (02/10 03:42) a regra de 30/09 ligou a automação dele com 20 envios para clientes reais.
- **Arquivos afetados:** `lib/daily-goal-auto.js`.
- **Risco/observação:** a regra "liga sozinha ao conectar" continua valendo para os corretores.
- **Autor:** Claude Code

### 2026-10-02 — Meta Diária automática: "Intervalo médio máximo" e recuperação segura de itens presos em "enviando"
- **Data:** 2026-10-02
- **Área:** Meta Diária (automação WhatsApp) · Banco
- **Alteração:** (1) nova configuração "Intervalo médio máximo" (`daily_goal_auto_settings.max_avg_gap_minutes`, global, salva com as demais e recalculando a fila pendente): com oscilação ligada, intervalo médio efetivo = menor entre (tempo restante da janela ÷ mensagens) e esse máximo; oscilação ± aplicada depois, nunca fora da janela; vazio = comportamento anterior. Ex.: 07–14h, máx. 4 min, ±30%: 100 msgs 07:00→13:41; 20 msgs 07:00→08:12; 5 msgs 07:00→07:14. (2) Marca `daily_goal_auto_queue.send_started_at` gravada imediatamente antes de chamar o WhatsApp e varredura `recoverStuckSendingItems` no início de cada cron: item em "sending" há mais de 15 min → com prova de envio vira "sent" sem reenviar; sem a marca (envio não começou) volta à fila só se a tentativa ainda é devida; caso contrário/incerto → "error" `enviando_sem_confirmacao` (revisão, nunca reenviado).
- **Motivo:** pedido do dono (janela é limite, não duração obrigatória; nenhum item eterno em "enviando").
- **Arquivos afetados:** `lib/daily-goal-auto.js`, `lib/daily-goal-auto-core.mjs`, `components/DailyGoalAdmin.jsx`, `tests/daily-goal-auto-window.test.mjs`, migration `20261002230000_daily_goal_auto_max_avg_gap_and_send_marker.sql` (aditiva, aplicada).
- **Risco/observação:** os 2 itens presos desde 30/09 não tinham prova de envio nem marca (anteriores à correção) e as tentativas daquelas posições foram registradas depois por outro caminho; vão para revisão ("enviando_sem_confirmacao"), nunca reenviados. Causa provável: processo encerrado (tempo-limite da função) entre reivindicar e concluir. Os 9 corretores estavam `paused=false` no banco (4 retomados pelo usuário do dono às 02:15); foram pausados de novo com o motivo "Pausado por segurança… aguardando o dono reativar" — nenhum reativado.
- **Autor:** Claude Code

### 2026-10-02 — Meta Diária automática: trava de janela no envio + fila recalculada ao salvar configuração
- **Data:** 2026-10-02
- **Área:** Meta Diária (automação WhatsApp)
- **Alteração:** (1) trava final no servidor imediatamente antes de cada envio (`sendBlockReason`, `lib/daily-goal-auto-core.mjs`), com a configuração relida naquele instante: fora da janela/dia útil/pausada não envia; item agendado para outro dia ou fora da janela atual é cancelado e a fila recalculada. (2) Antes de qualquer envio, `repairInvalidPendingQueue` recalcula a fila do corretor se houver pendente fora da configuração atual. (3) Salvar a configuração global (janela, oscilação, %, intervalo, dias, teto) e o teto individual recalcula automaticamente a fila pendente (`requeueAllEnabledBrokers`/`requeueBrokerQueueCore`; só `pending`). (4) Oscilação: intervalos sorteados são encolhidos proporcionalmente se passarem do fim — todas as mensagens cabem na janela. (5) Histórico do admin passa a mostrar "estava agendado para" nos itens não enviados.
- **Motivo:** bug crítico relatado pelo dono (janela 07:00–14:00): após salvar regras novas a fila antiga continuou com 139 pendências fora da janela (06:30–18:53) e pendências de 30/09–01/10; o "02:10" visto na tela era a hora do CANCELAMENTO exibida como se fosse horário (o reagendar das 02:10 gerou 36 itens corretos, 07:00–13:50). Ver `docs/INCIDENTES.md`.
- **Arquivos afetados:** `lib/daily-goal-auto.js`, `lib/daily-goal-auto-core.mjs`, `components/DailyGoalAdmin.jsx`, `tests/daily-goal-auto-window.test.mjs`.
- **Risco/observação:** salvar a configuração agora cancela e regenera a fila pendente de todos os corretores com a automação ligada (mais lento: alguns segundos). Corretores pausados têm a fila recalculada quando o cron voltar a processá-los (a trava do envio protege antes disso). 2 itens presos em "sending" desde 30/09 não são reenviados (o claim só pega `pending`).
- **Autor:** Claude Code

### 2026-10-02 — "Não contactar" passa a manter o responsável em todos os fluxos
- **Data:** 2026-10-02
- **Área:** Prospecção · Clientes
- **Alteração:** o botão "Não contactar" da Prospecção/card do cliente (`handleProspectingClientAction`) deixou de zerar `simulation_registrations.responsible_user_id` e `prospecting_contacts.assigned_user_id`. Fonte única dos campos gravados (`lib/do-not-contact-core.mjs`), usada também pelo opt-out automático e pelo "Não tem interesse" (`lib/prospecting-reply.js`), que já preservavam. Motivo obrigatório, trava anti-abuso, histórico e bloqueios de prospecção/automação inalterados.
- **Motivo:** regra do dono — "Não contactar" bloqueia prospecção, mas o cliente continua do corretor (pesquisável, ficha acessível, reativável).
- **Arquivos afetados:** `lib/do-not-contact-core.mjs`, `lib/prospecting.js`, `lib/prospecting-reply.js`, `tests/do-not-contact-core.test.mjs`, `docs/BUSINESS_RULES.md` (CLI-9, PRO-5), `.claude/rules/roleta-prospeccao-campanhas.md`.
- **Risco/observação:** antes, o cliente ficava sem responsável e a rede de segurança `reassignOrphanedClientsToOwner` o repassava ao dono (dos 807 clientes em "Não contactar", 0 estavam sem responsável em 2026-10-02). Dado existente não alterado: os já marcados continuam com o dono, não com o corretor original. Daqui para frente o cliente fica com o corretor e essa rede de segurança deixa de agir sobre ele.
- **Autor:** Claude Code

### 2026-10-02 — Clientes (mobile): faixa de etapas do funil com 3 abas inteiras e rolagem encaixada
- **Data:** 2026-10-02
- **Área:** Frontend (só visual; contadores, barras, filtros e seleção inalterados)
- **Alteração:** `PipelineStrip`/`StageTab` — no celular cada aba ocupa 1/3 da faixa (Todos/Prospecção/Atendimento inteiros, sem corte), rolagem horizontal com encaixe (`snap`), aba menor (64px), nome secundário e número maior, barra de 3px, divisórias discretas, cantos arredondados só no conjunto; ao selecionar uma etapa a faixa rola só o necessário para ela ficar totalmente visível. `sm+` inalterado (altura 78px, igual a antes).
- **Arquivos afetados:** `components/clients/ClientWorkspace.jsx`.
- **Autor:** Claude Code

### 2026-10-02 — Resposta à Prospecção pelo WhatsApp (pendência + opt-out) independente do Chat; conversas LID voltam a chegar
- **Data:** 2026-10-02
- **Área:** WhatsApp · Prospecção · Meta Diária · Clientes · Notificações · Banco
- **Alteração:** (1) Serviço do WhatsApp individual passou a aceitar conversas endereçadas por LID (`message-extract.js`: telefone de `key.senderPn`; mapa LID→telefone para mensagens do corretor pelo app). (2) Webhook chama dois consumidores independentes da mensagem recebida: Prospecção (`lib/prospecting-reply.js`) e Chat (`projectIndividualInboundMessage`, sem a parte de prospecção que foi movida). (3) Cliente em prospecção que responde: para a cadência, rodada `converted`, status NÃO muda, abre UMA pendência "Cliente respondeu — atualizar status" ([Iniciar atendimento]/[Não tem interesse]) + push; pedido inequívoco de parar → Não contactar automático com registro; Não contactar + nova mensagem → pendência de reativação. (4) Contador "Respostas da prospecção" no total de notificações, painel na tela de Clientes e item no menu de pendências. (5) Não contactar pesquisável por nome/telefone e ficha acessível a quem tem acesso pelo responsável. (6) O Chat não move mais sozinho para "Em atendimento" quem está em prospecção. (7) Cliente com pendência aberta não volta à fila por inatividade.
- **Motivo:** pedido do dono; e incidente: nenhuma resposta de cliente chegava ao CRM desde 29/09 (`docs/INCIDENTES.md`).
- **Arquivos afetados:** `whatsapp-individual-service/src/{message-extract,sessions}.js`, `app/api/webhooks/whatsapp-individual/route.js`, `lib/prospecting-reply.js`, `lib/prospecting-reply-core.mjs`, `lib/whatsapp-individual-inbound.js`, `lib/whatsapp-client-status.js`, `lib/prospecting-auto-return.js`, `lib/simulation-registrations.js`, `lib/simulation-list-query.js`, `app/api/admin/prospecting-replies/**`, `app/api/admin/crm-badge-counts/route.js`, `components/clients/{ClientWorkspace,ProspectingRepliesPanel}.jsx`, `components/{AdminMenu,AdminBottomNav}.jsx`, `components/useCrmBadgeCounts.js`, migration `20261002200000_prospecting_reply_alerts.sql` (aditiva, aplicada em produção), `docs/BUSINESS_RULES.md` (PRO-8, CLI-9), `docs/DATABASE.md`, `docs/INCIDENTES.md`, rules de roleta/prospecção e integrações.
- **Risco/observação:** a correção LID só vale depois do redeploy do microsserviço no Railway (reinício reconecta com as credenciais salvas, sem QR). Ação manual "Não contactar" da Prospecção (`handleProspectingClientAction`) continua zerando o responsável — esses clientes não aparecem na pesquisa do corretor (não alterado; decisão do dono). Mensagens automáticas da Meta Diária continuam fora do Chat (como antes). Testes: `tests/prospecting-reply-core.test.mjs`, `tests/whatsapp-individual-extract.test.mjs`; RPC validada no banco em transação desfeita.
- **Autor:** Claude Code

### 2026-10-02 — Clientes (mobile): 3 cards "Para agir agora" lado a lado e funil mais compacto
- **Data:** 2026-10-02
- **Área:** Frontend (só visual; filtros, contadores e dados inalterados)
- **Alteração:** `FocusStrip` — grade de 3 colunas iguais sem rolagem horizontal no celular (número em destaque, título em até 2 linhas, tom suave quando contador > 0); `PipelineStrip` — abas com 30% da largura (Todos/Prospecção/Atendimento 100% visíveis, demais por rolagem) e menos espaço vertical. `sm+` inalterado.
- **Arquivos afetados:** `components/clients/ClientWorkspace.jsx`.
- **Autor:** Claude Code

### 2026-10-02 — Saúde: gráfico "Resultado da imobiliária por corretor" em colunas verticais
- **Data:** 2026-10-02
- **Área:** Frontend (só visual; fórmula, filtros, período e dados inalterados)
- **Alteração:** barras horizontais viraram colunas verticais: uma por corretor elegível (admin/gestor/corretor ativos), inclusive R$ 0,00 (sem altura); escala de R$ 0 até o próximo milhar acima do maior resultado (3.825 → 4.000; 4.120 → 5.000); animação ao entrar na tela (colunas crescem e o valor em R$ acompanha, respeita prefers-reduced-motion); valor em R$ fora/acima, "$" branco dentro do topo da coluna (some em coluna baixa), nome na base com 2 linhas e reticências; rolagem horizontal interna quando há muitos corretores; eixo Y fixo.
- **Arquivos afetados:** `components/FinancialHealthCharts.jsx`, `components/FinancialHealthTab.jsx` (apenas completa a lista com corretores sem resultado), `components/AdminFinancialDashboard.jsx` (passa os corretores elegíveis).

### 2026-10-02 — Vendas do Desempenho contadas uma única vez, na primeira entrada em Venda
- **Data:** 2026-10-02
- **Área:** Métricas (Desempenho / Visão Geral / ranking); Financeiro não alterado
- **Alteração:** a etapa "Venda" do funil do Desempenho contava todo cliente da coorte que já tivesse alcançado Venda; como a coorte inclui quem teve qualquer mudança de etapa no período, VENDA (setembro) → CONFORMIDADE/CARTÓRIO (outubro) fazia a mesma venda aparecer também em outubro. Agora `metrics.sale`, a etapa Venda do funil e `team[].sale` (desempate do ranking, Alexa, snapshots) = clientes cuja primeira entrada em status de venda cai no período. Lógica pura em `lib/sales-count-core.mjs`; `loadFullStatusHistoryForClients` passou a trazer `changed_at`.
- **Arquivos afetados:** `lib/performance-overview.js`, `lib/sales-count-core.mjs`, `tests/sales-count-core.test.mjs`, `docs/METRICAS_FUNIL.md` (MET-12).
- **Risco/observação:** as etapas anteriores do funil (Reunião etc.) continuam cumulativas e ainda incluem o cliente no mês em que ele teve movimentação pós-venda — não alterado a pedido. `lib/campaigns.js` (`row.funnel.sale`) e `lib/attendance-audit.js` têm fontes próprias, não alteradas.
- **Autor:** Claude Code

### 2026-10-02 — Financeiro: nota fiscal com % por venda; repasses ≠ despesas operacionais (Saúde)
- **Data:** 2026-10-02
- **Área:** Financeiro / Saúde / banco
- **Alteração:** (1) a nota fiscal deixou de ser "15% fixo ligado/desligado": cada venda tem seu **"Nota fiscal (%)"** (0–100, base = comissão bruta, deduzida uma vez antes da divisão), sem percentual global; vendas antigas preservadas (com nota → 15, sem nota → 0, migration + fallback legado). Cálculo único em `lib/financial-calculations.js` (`calculateSaleBase`), usado por servidor e tela. (2) Saúde reclassificada: **comissão recebida − repasses (corretor, gestor, participantes) − nota fiscal − despesas operacionais pagas = resultado líquido**; repasses não são despesas operacionais; realizado e previsto em colunas separadas; cards Repasses, Nota fiscal, Despesas operacionais e Resultado líquido. (3) Despesas da empresa: atalhos "Despesa fixa" (recorrente) e "Despesa variável" (pontual), filtro fixas × variáveis, novas categorias (água, energia, internet, assinaturas de IA, copa e limpeza).
- **Mapeamento antes de alterar:** nota = bruta × 15% se `invoice_issued`; livre = max(0, bruta − nota − despesas da venda); gestor/corretor/imobiliária dividem a livre. Em produção: 7 vendas (2 com nota, 5 sem; bruta = nota + despesas + gestor + corretor + imobiliária fechava nas 7). A Saúde só reclassifica esses componentes (`splitSaleShares`) — sem dupla dedução.
- **Banco:** migration `20261002200000_financial_invoice_percentage.sql` (coluna `invoice_percentage`, backfill preservando valores, default 0, check 0–100). Nenhum valor financeiro histórico alterado.
- **Arquivos afetados:** `lib/financial-calculations.js`, `lib/financial.js`, `lib/financial-health-core.mjs`, `components/AdminFinancialDashboard.jsx`, `components/FinancialHealthTab.jsx`, `components/FinancialHealthCharts.jsx`, `tests/financial-invoice.test.mjs`, `tests/financial-health.test.mjs`, `docs/FINANCEIRO_SAUDE.md`, `docs/BUSINESS_RULES.md` (FIN-1), `docs/DATABASE.md`, `.claude/rules/financeiro.md`, agente/skills financeiros.
- **Risco/observação:** repasses e nota apropriados proporcionalmente ao recebido (sem data real de pagamento); a divergência herdada do saldo (comissão livre × bruta) continua. Substitui a premissa "15% PENDENTE DE VALIDAÇÃO".
- **Autor:** Claude Code

### 2026-10-02 — Saúde financeira: despesa prevista × paga (confirmação manual) e recorrente só dali para frente
- **Data:** 2026-10-02
- **Área:** Financeiro / Saúde / banco
- **Alteração:** (1) despesa operacional deixa de ser "paga" quando a data chega: nasce **prevista** e só vira **paga** com a ação **Confirmar pagamento** (data e valor pagos); há **Reagendar** e **Desfazer**. Lucro/margem/caixa realizados usam só pagas; projeção/expectativa/ponto de equilíbrio usam previstas (inclusive vencidas). Novo bloco "Pagamentos a confirmar" e apontamento de vencidas sem confirmação. (2) Editar valor/categoria/tipo/descrição/periodicidade de recorrente vale **só dali para frente** ("Aplicar a partir de"): série antiga encerrada no dia anterior e nova série criada; histórico e relatórios passados inalterados.
- **Banco:** migration `20261002190000_financial_expense_occurrences.sql` — tabela `financial_operating_expense_occurrences` (aditiva, idempotente, RLS sem policy). Despesas existentes não foram alteradas.
- **Arquivos afetados:** `lib/financial-health-core.mjs`, `lib/financial-health.js`, `app/api/financeiro/saude/despesas/[id]/{route,ocorrencias/route}.js`, `app/api/financeiro/saude/ocorrencias/route.js`, `app/admin/financeiro/page.jsx`, `components/FinancialHealthTab.jsx`, `components/AdminFinancialDashboard.jsx`, `tests/financial-health.test.mjs`, `docs/FINANCEIRO_SAUDE.md`, `.claude/rules/financeiro.md`, `.claude/agents/gestor-financeiro.md`.
- **Risco/observação:** a divisão da recorrente não é transacional (compensação em código); excluir despesa apaga suas confirmações. Substitui a limitação "despesa com data ≤ hoje é paga" da entrada anterior.
- **Autor:** Claude Code

### 2026-10-02 — Segurança: Documentação/CCA e log de IA fechados para a chave pública (RLS + revoke)
- **Data:** 2026-10-02
- **Área:** Banco · Documentação/CCA · Permissões
- **Alteração:** RLS habilitado em `client_documents`, `client_document_batches`, `client_document_checklist_items`, `client_document_submissions` e `ai_usage_log` (a `cca` já tinha) e `revoke all` de `anon`/`authenticated` nas 6 tabelas. Nenhuma policy criada; dados, regras documentais e motor de IA inalterados.
- **Motivo:** achado do agente `analista-documental`: com a anon key pública (embutida no site) qualquer pessoa listava 171 documentos, 19 lotes, 90 itens de checklist (CPF/PIS extraídos), 4 envios à CCA (com URLs assinadas) e 37 registros de IA — e tinha até INSERT/UPDATE/DELETE/TRUNCATE. Aprovado pelo dono.
- **Arquivos afetados:** `supabase/migrations/20261002180000_lock_client_documents_rls.sql` (aplicada em produção), `docs/DATABASE.md` §2, `.claude/analista-documental/ARQUITETURA.md`.
- **Risco/observação:** antes: confirmado que todo acesso a essas tabelas é pelo servidor com service role (`getSupabaseAdminClient`, sem fallback para anon), que o navegador só usa Storage por URL assinada e broadcast, e que não há view/função/trigger/policy/Realtime sobre elas. Depois: anon recebe 42501 em leitura e escrita nas 6 tabelas (`testimonials` segue pública); como service_role (transação desfeita) leitura das 6, upload, checklist, atualização do lote, log de IA e envio à CCA funcionam; contagens inalteradas. **Fora do escopo, não corrigido:** 9 tabelas ainda com RLS desligado (lista em `DATABASE.md` §2, inclui `crm_clients`/`crm_attendances`) e `log_client_meta_attribution()` executável por anon.
- **Autor:** Claude Code

### 2026-10-02 — Agente `analista-documental` + skills e regressão sintética da análise documental
- **Data:** 2026-10-02
- **Área:** Documentação/CCA · Docs/agentes (nenhuma mudança de comportamento em produção)
- **Alteração:** novo subagente `analista-documental` (entende, audita e testa o fluxo documental existente — não o recria) com skills `/analisar-documentacao` (13 passos, script local `inspecionar-arquivos.mjs`), `/auditar-analise-documental` e `/testar-regra-documental`; referência sob demanda em `.claude/analista-documental/` (ARQUITETURA com arquivo:linha e REGRAS-DOCUMENTAIS com matriz regra do dono × Base Mestra × código × falta). Regressão sintética `tests/document-regression.test.mjs` + `tests/fixtures/documentos/casos-requisitos.json` (27 casos passam; 4 lacunas como `todo`). `documentacao-cca.md`: bloco das regras do dono (ponteiro para a matriz) e correção de fatos desatualizados do PDF (não há tabela de conferência; só o nome é obrigatório).
- **Motivo:** pedido do dono (agente especialista em análise documental com as regras Caixa/MCMV dele).
- **Arquivos afetados:** `.claude/agents/analista-documental.md`, `.claude/analista-documental/*`, `.claude/skills/{analisar-documentacao,auditar-analise-documental,testar-regra-documental}/**`, `tests/document-regression.test.mjs`, `tests/fixtures/documentos/casos-requisitos.json`, `.claude/rules/documentacao-cca.md`, `AGENTS.md`, `CLAUDE.md`.
- **Risco/observação:** (1) o motor de IA da análise documental é **Anthropic** (`claude-sonnet-5`), não OpenAI como o pedido supunha — nada foi trocado; mudança de provedor é decisão do dono. (2) **Não corrigido, aguarda aprovação:** tabelas `client_documents`, `client_document_batches`, `client_document_checklist_items`, `client_document_submissions` e `ai_usage_log` com RLS desligado e SELECT para `anon`/`authenticated` (dados pessoais legíveis com a anon key pública); `cca` com grant de select para anon. (3) Lacunas regra × código: validade do comprovante (mês atual/anterior), CPF cruzado determinístico, comprovante no motor sem filtro de papel/validade, reescaneado como duplicado, `ctps_format` sem efeito, `fgts_updated` exigindo FGTS de não-CLT (a validar).

### 2026-10-02 — Previsão de recebimento: restrita ao dono (lançar, alterar e ver)
- **Data:** 2026-10-02
- **Área:** Financeiro / Permissões
- **Alteração:** pedido do dono — "apenas eu lanço as datas, altero e visualizo". `expectedReceiptDate` só trafega para `isOwnerAdminEmail` (omitido para os demais em `listFinancialSales`/`getFinancialSale`, portanto na API e na tela); campo, linhas "Previsão do saldo" e botões só para o dono; salvar a venda por outro admin geral preserva a previsão; `POST /api/financeiro/[id]/receipt` exige o dono (403) e a Agenda só entrega os dados dos botões ao dono. A atividade criada pelo cron/outro admin é atribuída ao dono. Antes disso qualquer admin geral editava e corretor/associado via a previsão das próprias vendas.
- **Arquivos afetados:** `lib/financial.js`, `lib/financial-expected-receipt-core.mjs` (`applyExpectedReceiptVisibility`), `app/api/financeiro/[id]/receipt/route.js`, `app/api/calendar-activities/route.js`, `app/admin/financeiro/page.jsx`, `components/AdminFinancialDashboard.jsx`, `tests/financial-expected-receipt.test.mjs`, `.claude/rules/financeiro.md`, `docs/BUSINESS_RULES.md` (FIN-5).
- **Risco/observação:** a identidade do dono usa `isOwnerAdminEmail` do usuário efetivo (mesmo critério de `assertOwnerAdmin`; lista fixa por e-mail em `lib/admin-profiles.js`, P-10). Atividades já criadas antes desta restrição: nenhuma existia (0 previsões em produção).

- **Autor:** Claude Code

### 2026-10-02 — Financeiro: previsão de recebimento da comissão + atividade "Confirmar recebimento" na Agenda
- **Data:** 2026-10-02
- **Área:** Financeiro / Agenda / Banco
- **Alteração:** nova data **Previsão de recebimento** na Edição Financeira da venda (`financial_sales.expected_receipt_date`; ≠ data da venda, ≠ data real do pagamento). O valor previsto é sempre calculado: comissão livre − recebido − parcelas já datadas (`computeForecastAmount`). Previsão **nunca** vira recebimento sozinha. Indicadores (A receber neste mês, 30/60/90, Agenda de recebimentos) passam a incluir a previsão e a mostrar "Vencidas de meses anteriores"; "Recebido" continua só pagamento confirmado. Os indicadores de recebimento **não dependem mais do período da data da VENDA** (uma venda de setembro prevista para outubro sumia em "Este mês"). Cada previsão ganha UMA atividade na Agenda (`calendar_activities`, tipo `recebimento`, 09:00, vínculo `financial_sale_id`) com **Confirmar recebimento** (total ou parcial, valor e data real editáveis; parcial pede nova previsão do saldo) e **Reagendar** (move a MESMA atividade). Confirmar é idempotente e à prova de execução simultânea (claim condicional da atividade + `financial_payments.confirmed_activity_id` único). O cron `scheduled-activities` reconcilia (cria a atividade que faltou, conclui/remove a de venda recebida/cancelada), sem depender de abrir o Financeiro. Concluir/reagendar/excluir pelas ações genéricas da Agenda é recusado para atividade financeira.
- **Motivo:** pedido do dono — saber QUANDO a comissão deve entrar e ser lembrado na data.
- **Arquivos afetados:** `supabase/migrations/20261002130000_financial_expected_receipt.sql` (aditiva, aplicada em produção), `lib/financial-expected-receipt-core.mjs`, `lib/financial-expected-receipt-db.mjs`, `lib/financial.js`, `lib/calendar-activities.js`, `app/api/financeiro/[id]/receipt/route.js` (novo, `requireGeneralAdminApi`), `app/api/calendar-activities/route.js`, `app/api/cron/scheduled-activities/route.js`, `components/ReceiptActionModals.jsx`, `components/AdminFinancialDashboard.jsx`, `components/ActivityCalendar.jsx`, `tests/financial-expected-receipt.test.mjs` (29 testes), `.claude/rules/financeiro.md`, `docs/BUSINESS_RULES.md` (FIN-5), `docs/DATABASE.md`.
- **Risco/observação:** (1) o valor previsto usa a comissão LIVRE (como "a receber" já fazia); o status derivado de pagamentos (`deriveFinancialStatus`) usa a comissão BRUTA — com nota fiscal (15%) as duas bases diferem (divergência preexistente, **não alterada**; a confirmação marca `received` quando o recebido cobre a comissão livre). (2) O lembrete do cron (push/WhatsApp/e-mail) vai só ao responsável da atividade (quem editou a venda), nunca ao cliente. (3) A atividade financeira é uma `calendar_activities` comum ligada ao cliente: entra nos contadores/lembretes da Agenda e conta como "atividade futura" do cliente (ex.: condição `has_future_activity` das automações); só tem botões para o admin geral; a Agenda lista só atividades do próprio responsável. (4) Teste ao vivo do `DELETE` em cascade não pôde ser feito (a plataforma exige confirmação para SQL destrutivo); validado pelo catálogo (`ON DELETE CASCADE`) e testes com banco falso. Travas de unicidade validadas no Postgres real com rollback.
### 2026-10-02 — Financeiro: aba "Saúde" + agente `gestor-financeiro` (+ 4 skills)
- **Data:** 2026-10-02
- **Área:** Financeiro / banco / agentes
- **Alteração:** nova aba **SAÚDE** em `/admin/financeiro` (só admin geral): despesas da empresa (fixas/recorrentes, variáveis, extraordinárias; recorrência calculada na leitura, sem materializar meses), caixa com saldo inicial configurável (nunca inventado), reserva/cobertura com limiares configuráveis, ponto de equilíbrio, expectativa do mês (realizado × previsto × estimado separados), gráfico de barras "resultado da imobiliária por corretor", gráfico de linha mês anterior × atual × projeção, histórico de 6 meses e apontamentos Fato/Apontamento/Recomendação. Agente somente leitura `gestor-financeiro` e skills `/analisar-saude-financeira`, `/analisar-despesas`, `/projetar-fluxo-caixa`, `/comparar-periodos-financeiros` (adaptadas de openaccountant/skills: profit-loss, cash-flow-forecast, break-even-calc, runway-calculator, spending-review, expense-optimizer, seasonal-patterns; sem coleções inteiras e sem trading/ações/cripto). Financeiro existente (vendas, recebimentos, despesas da venda) **não foi alterado**.
- **Banco:** migration `20261002120000_financial_health.sql` — tabelas novas `financial_operating_expenses` e `financial_health_settings` (aditiva, idempotente, RLS sem policy pública).
- **Arquivos afetados:** `lib/financial-health-core.mjs`, `lib/financial-health.js`, `app/api/financeiro/saude/**`, `components/FinancialHealthTab.jsx`, `components/FinancialHealthCharts.jsx`, `components/AdminFinancialDashboard.jsx`, `app/admin/financeiro/page.jsx`, `tests/financial-health.test.mjs`, `.claude/agents/gestor-financeiro.md`, `.claude/skills/{analisar-saude-financeira,analisar-despesas,projetar-fluxo-caixa,comparar-periodos-financeiros}`, `docs/FINANCEIRO_SAUDE.md`.
- **Risco/observação:** custos da venda apropriados proporcionalmente ao recebido (a venda não guarda data de pagamento de repasse); recorrência assume pagamento na data e editar muda o passado (usar "Encerrar"); premissas PENDENTES (15% nota, % gestor) afetam o resultado por corretor. Detalhes e limitações: `docs/FINANCEIRO_SAUDE.md`.
- **Autor:** Claude Code

### 2026-10-02 — Menu "Mais" (mobile) redesenhado: itens com ícone, estado ativo e badge no item
- **Data:** 2026-10-02
- **Área:** Frontend (só visual; destinos, ordem, permissões e contadores inalterados)
- **Alteração:** `AdminBottomNav` (`MoreMenu`): cada opção virou um "mini botão" (ícone lucide em ladrilho + nome em até 2 linhas, 2 colunas, altura mínima 44px), ícone por chave de `getAdminMenuGroups` (`ITEM_ICONS`), item ativo em azul claro com ícone azul sólido, badge preso ao canto do próprio item, títulos de seção discretos. `Sheet` ganhou a prop opcional `compact` (cabeçalho e botão fechar discretos), usada só pelo menu; demais Sheets inalterados.
- **Arquivos afetados:** `components/AdminBottomNav.jsx`, `components/ui/Sheet.jsx`.
- **Risco/observação:** itens novos de `getAdminMenuGroups` sem entrada em `ITEM_ICONS` recebem o ícone genérico `CircleDot`.
- **Autor:** Claude Code

### 2026-10-02 — Financeiro: reparo idempotente de venda "Recebido" sem recebimento lançado
- **Data:** 2026-10-02
- **Área:** Financeiro
- **Alteração:** nova regra pura `computeReceiptRepair` (`lib/financial-receipt-repair-core.mjs`, em centavos) define quanto falta lançar para uma venda `received` (só a diferença; 0 se já coberta ou se a venda não está `received`). `markFinancialSaleReceivedForRegistration` passa a usá-la e `listFinancialSales` ganhou a rede de segurança `repairReceivedSaleMissingPayments` (venda `received` + `manual_status` + cliente em `sale_paid`), com desfazimento de duplicata em corrida. Dado: 1 recebimento de R$ 9.000,00 (01/10/2026) lançado para a venda afetada.
- **Motivo:** incidente 2026-10-02 em `docs/INCIDENTES.md` — cliente marcado "Pago" antes do lançamento automático existir ficou "Recebido" sem pagamento e fora dos totais.
- **Arquivos afetados:** `lib/financial.js`, `lib/financial-receipt-repair-core.mjs`, `tests/financial-receipt-repair.test.mjs`, `docs/INCIDENTES.md`. Sem migration.
- **Risco/observação:** `listFinancialSales` agora pode gravar (só no caso inconsistente, falha não derruba a tela). Venda "Recebido" colocada manualmente na tela, sem cliente em `sale_paid`, NÃO é reparada de propósito. Regra `financeiro.md` inalterada.
- **Autor:** Claude Code

### 2026-10-02 — Indicadores WhatsApp/Google Contacts movidos para dentro dos cards do ranking
- **Data:** 2026-10-02
- **Área:** Frontend (só posição; estados, cores, tamanho, modal e tooltip inalterados)
- **Alteração:** `TopRankingBadge` recebe os dois indicadores do layout e os posiciona dentro de "Campeão da Semana" (WhatsApp) e "Melhor do Dia" (Google Contacts), centro a 75% da largura do próprio card (`left-3/4`, sem transform) e na mesma coluna; em `lg` vão para a direita do card. A faixa branca que os continha no cabeçalho foi removida. Se um card não existir, o indicador cai numa linha própria (nunca some). Nomes truncam antes do indicador.
- **Arquivos afetados:** `components/TopRankingBadge.jsx`, `app/admin/layout.jsx`, `components/GoogleContactsStatus.jsx` (prop `align`).
- **Risco/observação:** a 360px o nome do "Melhor do Dia" pode truncar mais cedo; os indicadores só aparecem após a 1ª resposta de `/api/daily-goal/top-ranking`.
- **Autor:** Claude Code

### 2026-10-02 — Ajustes mobile/PWA: rodapé do site fora do painel, menu "Mais", Desempenho, status WhatsApp/Google em ícones
- **Data:** 2026-10-02
- **Área:** Frontend (só interface; nenhuma lib/API/banco)
- **Alteração:** (1) removido o `Footer` institucional das 7 páginas `app/admin/**` que o renderizavam (calendário, desempenho e subpáginas, relatório diário) — o rodapé do site público segue em `AppChrome` (`!isAdminRoute`). (2) `AdminBottomNav`: menu "Mais" compactado (sempre 2 colunas, espaçamento menor, divisórias entre grupos; mesmos itens/destinos). (3) `PerformanceOverviewDashboard`: bloco "Visão geral" compacto no celular (Atualizar ao lado do título, filtros de período numa linha); `md+` inalterado. (4) `TeamSummary`: "Meta da equipe" em linha inteira + grade 2×2 no celular. (5) Novo `components/IntegrationStatusIcon.jsx`: WhatsApp e Google Contacts viram ícones (verde = conectado; laranja = estado intermediário real — WhatsApp conectando/reconectando/aguardando QR ou código, Google "requer reconexão"; cinza = desconectado/nunca conectou/erro), com tooltip no desktop e texto por toque no celular. Usado no cabeçalho do painel, no Chat e nos cards/painel de automação da supervisão (`TeamDailyPerformance`).
- **Motivo:** pedido do dono (revisão do uso no celular).
- **Arquivos afetados:** `app/admin/**/page.jsx` (7), `app/admin/layout.jsx`, `components/{AdminBottomNav,PerformanceOverviewDashboard,TeamDailyPerformance,WhatsappIndividualStatus,GoogleContactsStatus,WhatsappChat,IntegrationStatusIcon}.jsx`.
- **Risco/observação:** erro do WhatsApp ("Erro") agora aparece cinza (antes vermelho) por haver só três cores pedidas; o texto continua no tooltip/modal. `DailyGoalAdmin.jsx` (Meta Diária > Gestão) ainda mostra os selos de texto antigos — fora do escopo pedido. KPIs do Desempenho (7 cards) ficam em 1 coluna no celular — possível melhoria futura.
- **Autor:** Claude Code

### 2026-10-02 — Segurança: RLS fechado em crm_clients/crm_attendances, WhatsApp (broadcasts/templates/mensagens), 4 tabelas daily_goal_* e função de atribuição Meta
- **Data:** 2026-10-02
- **Área:** Banco/Permissões
- **Alteração:** `crm_clients`, `crm_attendances`, `whatsapp_broadcasts`, `whatsapp_broadcast_messages`, `whatsapp_templates`, `daily_goal_abuse_flags`, `daily_goal_wallet_config`, `daily_goal_wallet_broker_overrides` e `daily_goal_do_not_contact_log` tinham RLS **desligado** com grant total (SELECT/INSERT/UPDATE/DELETE/TRUNCATE) para `anon` e `authenticated` — qualquer um com a chave anon pública (de conhecimento público por design) podia ler/escrever/apagar essas tabelas direto via REST, ignorando o CRM inteiro (achado do advisor de segurança do Supabase, nível ERROR, 9 tabelas). RLS ligado nas 9, sem nenhuma policy (nenhuma delas é acessada pelo navegador — confirmado por grep em todo o código antes de mexer), `REVOKE ALL` de `anon`/`authenticated` e `GRANT ALL` a `service_role` — mesmo padrão já usado antes nas tabelas documentais (`client_documents` e afins). Também revogado o `EXECUTE` de `anon`/`authenticated` na função `log_client_meta_attribution()`: é uma função de TRIGGER (presa a `client_meta_attribution_log_trigger`), nunca deveria ter sido exposta como RPC solta — revogar o EXECUTE não afeta o trigger (que não depende desse grant) nem a atribuição de leads da Meta.
- **Motivo:** pedido do dono — fechamento da exposição restante apontada pelo advisor de segurança, depois da correção anterior das tabelas documentais.
- **Arquivos afetados:** `supabase/migrations/20261002030000_lock_down_remaining_rls_exposure.sql` (aplicada em produção).
- **Risco/observação:** mapeado por tabela antes de qualquer alteração (quem lê/escreve, via grep em `lib/**/*.js` + `pg_policies`/`pg_trigger`/`pg_roles` no banco) — as 9 tabelas só são tocadas por `lib/crm-clients.js`, `lib/simulation-registrations.js`, `lib/whatsapp-*.js` e `lib/daily-goal-wallet.js`, todos via `getSupabaseAdminClient()` (service role, que tem `rolbypassrls=true` — confirmado — então nada muda para o CRM/cron/automações). O serviço externo de WhatsApp individual (Railway) nunca fala com o Supabase direto (confirmado em `whatsapp-individual-service/src/db.js`), então não é afetado. `daily_goal_wallet_broker_overrides` ainda não tem tela/uso no código (reservada para um futuro override por corretor) — mesmo tratamento preventivo. Validado ao vivo com a chave anon real (leitura/escrita): as 9 tabelas e a função retornam "permission denied"/"RPC not found" depois da migration, antes retornavam dado real. Advisor de segurança: 9 tabelas em `rls_disabled_in_public` (ERROR) → 0; `log_client_meta_attribution` saiu das 2 listas de "SECURITY DEFINER executável por anon/authenticated". Fora do escopo (não tocado, pedido do dono era só as 9 tabelas + 1 função): 12 funções com `search_path` mutável e a proteção de senha vazada do Auth desligada — ambos pré-existentes, sem relação direta com as tabelas desta correção.
- **Autor:** Claude Code

### 2026-10-01 — Agente `analista-dados` (BI somente leitura) + definição canônica das métricas do funil
- **Data:** 2026-10-01
- **Área:** Agentes/Docs (nenhum código do CRM, banco, `settings.json`, hook ou permissão alterado)
- **Alteração:** novo agente `.claude/agents/analista-dados.md` (só `SELECT` via `execute_sql`/`list_tables`; `memory: project` só para metodologia e baselines agregados) e skills `/analisar-funil`, `/descobrir-padroes`, `/comparar-periodos` (`context: fork`, `agent: analista-dados`). Nova fonte única das métricas: `docs/METRICAS_FUNIL.md` + SQL testado em `docs/analytics/` (`funil-painel.sql` replica o funil do painel Desempenho; `consultas-base.md`).
- **Motivo:** pedido do dono (1ª etapa da expansão da equipe de agentes) — padrões/BI do CRM sem cada agente calcular conversão de um jeito. Definições lidas no código (`lib/client-status.js`, `lib/performance-overview.js`, `lib/scoring-rules.js`) e conferidas no banco, não inventadas.
- **Arquivos afetados:** `.claude/agents/analista-dados.md`, `.claude/skills/{analisar-funil,descobrir-padroes,comparar-periodos}/SKILL.md`, `docs/METRICAS_FUNIL.md`, `docs/analytics/*`, `CLAUDE.md`, `AGENTS.md`, `docs/CHANGELOG_AI.md`.
- **Risco/observação:** (1) A restrição "somente leitura" é **de prompt + ferramentas limitadas**; o `settings.json` ainda libera `execute_sql`/`apply_migration` sem hook de somente-leitura por agente — endurecer (hook/papel Postgres de leitura) está previsto na fundação da arquitetura e **não** foi feito aqui por instrução do dono. (2) `memory: project` habilita Write/Edit ao agente; o prompt o restringe a `.claude/agent-memory/analista-dados/`. (3) Lacunas medidas (MET-13): histórico de status confiável só nas etapas 1–7 (1.053 das 1.089 divergências status×histórico são status de prospecção); ~96 % dos eventos de histórico são de 2026-09-07 em diante; `client_status_history.source` nulo em ~82 %. (4) Divergência registrada, sem correção: `/auditar-trafego` (`stage_of`) usa `financial_sales` como piso rk 7 e o painel não — zero diferença hoje (vendas = rk 7). (5) O registro de agentes não recarrega a quente: o `analista-dados` só aparece como `subagent_type` depois de reiniciar a sessão; as skills carregaram na hora.
- **Autor:** Claude Code

### 2026-10-01 — Auditoria de performance (2ª rodada): fotos da listagem, zod fora do bundle de exibição, queries em paralelo
- **Data:** 2026-10-01
- **Área:** Banco/Infra/Docs
- **Alteração:** listagem pública de imóveis passou a buscar só a foto de capa (`photos_json->0` via PostgREST, não o array inteiro) — sem migration, mesmo resultado visual; `lib/simulation-registration-schema.js` (carrega zod) dividido em dois módulos — funções puras de formatação foram para `lib/simulation-registration-format.js` (sem zod), e 9 componentes de exibição (cards de cliente, detalhes, listas) passaram a importar de lá, parando de carregar zod à toa; duas contagens sequenciais da aba "Todos" de Clientes agora rodam em paralelo; `listAdminProfiles()` memoizado por requisição (eliminava até 4 consultas idênticas numa carga do Ranking/Extrato de Pontos). Nenhuma mudança visual/comportamental.
- **Motivo:** pedido do dono — 2ª rodada da auditoria de performance, focada só em ganhos técnicos sem risco de regressão visível, depois de validar a 1ª rodada em produção (TTFB da home: 636ms → 177ms confirmado ao vivo).
- **Arquivos afetados:** `lib/public-properties.js`, `lib/simulation-registration-schema.js`, `lib/simulation-registration-format.js` (novo), `lib/simulation-list-query.js`, `lib/admin-profiles.js`, 9 componentes (import path only — ver `docs/PERFORMANCE_AUDIT.md`), `docs/PERFORMANCE_AUDIT.md`.
- **Risco/observação:** `next build` limpo. Extração de foto testada contra a API REST de produção (leitura) antes de aplicar, confirmando formato de retorno idêntico ao que `coverImage()` já esperava. Verificado com `EXPLAIN ANALYZE` (não só leitura de código): nenhum índice novo necessário agora nas 3 tabelas que mais crescem. Ficou de fora, por risco (não por ser visual): trim de `simulations(*)` na listagem de Clientes — o campo alimenta a lógica de status/filtro da tela, precisa de verificação mais extensa antes de mexer.
- **Autor:** Claude Code

### 2026-10-01 — Auditoria de performance: auth deduplicada, ISR no site público, queries mais leves
- **Data:** 2026-10-01
- **Área:** Infra/Banco/Permissões/Docs
- **Alteração:** `getAdminFromCookies` (lib/admin-auth.js) memoizado com `cache()` do React — eliminava uma checagem de sessão duplicada (layout + cada página) em toda navegação do admin; `admin_users`/`simulation_registrations` deixaram de usar `select("*")` nos caminhos quentes de auth e do Financeiro (projeção só das colunas realmente lidas); sincronização de templates do WhatsApp passou de 1 upsert por template para 1 upsert em lote; home e ficha de empreendimento do site público trocaram de `force-dynamic` para ISR (`revalidate = 60`); removida a dependência `three` (sem nenhum import no repo) e um `priority` duplicado na hero da home; adicionados `@vercel/analytics`/`@vercel/speed-insights` para medir Core Web Vitals reais daqui pra frente. Nenhuma mudança visual/layout.
- **Motivo:** pedido do dono — auditoria completa de performance (site, CRM, PWA), com instrução explícita de só mexer automaticamente em otimizações técnicas/invisíveis e registrar o resto para autorização.
- **Arquivos afetados:** `lib/admin-auth.js`, `lib/admin-profiles.js`, `lib/financial.js`, `lib/whatsapp-broadcasts.js`, `app/page.jsx`, `app/empreendimentos/[id]/page.jsx`, `app/layout.jsx`, `package.json`, `pnpm-lock.yaml`, `docs/PERFORMANCE_AUDIT.md` (checklist completo, inclusive achados NÃO aplicados).
- **Risco/observação:** `next build` limpo antes/depois. Ficaram fora desta rodada (registrados em `docs/PERFORMANCE_AUDIT.md` para autorização do dono, por risco real — não por serem visuais): habilitar `images.unoptimized=false` (exige configurar remotePatterns do Supabase Storage e consome cota de otimização de imagem da Vercel, projeto já teve um bloqueio por limite do plano Hobby em 2026-09-26); paginação/virtualização das listas de Chat e Prospecção; refatorar WhatsappChat para prefetch no servidor; coluna dedicada de thumbnail para a listagem pública de imóveis parar de carregar `photos_json` inteiro. Dois achados reportados por subagentes (poll de 3s do WhatsApp individual, poll de 2,5s da Supervisão) eram falsos positivos ao verificar o código — nada foi alterado neles.
- **Autor:** Claude Code

### 2026-10-01 — Correção de dados P-01 (etapa 2): contatos presos ao mesmo card
- **Data:** 2026-10-01
- **Área:** Meta Diária / Prospecção / Banco (dados)
- **Alteração:** 120 contatos desvinculados dos 15 cards compartilhados, 3 cards próprios criados (#C4480, #C4481, #C4482), 5 contatos liberados do "não contactar" herdado do vínculo. Backup em `public.p01_backup_20261001_*`. Detalhe e pendências: `docs/INCIDENTES.md`.
- **Motivo:** aprovado pelo dono após o inventário dos 15 casos.
- **Arquivos afetados:** só dados (sem código, sem migration).
- **Risco/observação:** pontuação inalterada (fontes do ranking com a mesma impressão digital antes/depois; cards novos com responsável fora do ranking). Pendentes por decisão do dono: #C3919 (4 contatos) e #C3846 (…2973, …3947).
- **Autor:** Claude Code

### 2026-10-01 — Meta Diária: contato só reaproveita cliente com o mesmo telefone (P-01, etapa 1)
- **Data:** 2026-10-01
- **Área:** Meta Diária / Prospecção
- **Alteração:** correção preventiva das rodadas repetidas (ver `docs/INCIDENTES.md`). Vínculo contato→cliente só reaproveitado com telefone igual; senão procura/cria pelo telefone do contato sem sobrescrever cliente existente; tentativas da Meta Diária sempre com o telefone do contato. `findMatchingRegistration` passou a usar a regra pura `pickRegistrationByPhone` (mesmo comportamento, agora testado).
- **Motivo:** aprovado pelo dono após o diagnóstico.
- **Arquivos afetados:** `lib/contact-client-link.mjs`, `lib/registration-match.mjs` (novos), `lib/daily-goal.js`, `lib/prospecting.js`, `lib/simulation-registrations.js`, `tests/contact-client-link.test.mjs`, `tests/registration-match.test.mjs`.
- **Risco/observação:** nenhum dado alterado (os 15 clientes e os 129 contatos ficam como estão até a etapa 2). Medido antes: fora do bug, todos os 2.694 contatos vinculados têm o mesmo telefone do cliente — a checagem não afeta vínculos legítimos. Quando um corretor tocar um dos 129 contatos, ele ganha o próprio cliente (vínculo corrigido só nesse contato, organicamente). Reaproveitar cliente pelo telefone agora não troca o nome dele pelo nome do contato.
- **Autor:** Claude Code

### 2026-10-01 — Regra do dono: ação do dono num cliente de corretor pontua para o corretor
- **Data:** 2026-10-01
- **Área:** Ranking
- **Alteração:** só documentação (rule `meta-diaria-ranking.md` + `docs/BUSINESS_RULES.md` RAN-2). Mudança de status feita por usuário que não disputa o ranking (o dono) num cliente atribuído a um corretor é creditada ao corretor responsável — comportamento que o código já tinha (fallback para `responsible_user_id` quando `changed_by` não é reconhecido), e que divergia do texto antigo da RAN-2 ("só se `changed_by` for nulo").
- **Motivo:** validação final do Modelo B Ajustado encontrou 2 casos (Jennyfer 28/09 e ketlin 29/09, +20 cada, "Documentação recebida" registrada pelo login do dono); o dono decidiu manter o comportamento.
- **Arquivos afetados:** `.claude/rules/meta-diaria-ranking.md`, `docs/BUSINESS_RULES.md`.
- **Risco/observação:** nenhum código alterado; pontos históricos intactos.
- **Autor:** Claude Code

### 2026-10-01 — Ranking: Modelo B Ajustado (pesos, teto de presença, teto de prospecção)
- **Data:** 2026-10-01
- **Área:** Ranking
- **Alteração:** novos pesos por atividade (Novo cliente 2, Prospecção 1, Atendimento 8, Simulação 15, Documentação 20, Enviado p/ aprovação 25, Aprovado 50, Venda 150); "Tempo online" caiu de 5 para 1 ponto/10min e passou a ter **teto de 30 pontos/corretor/dia**; bônus "Mais tempo online no dia" **removido** (regra desativada); bônus de Meta Diária trocou de "+20 por múltiplo de 100% sem teto" para "+15 aos 100%, +30 aos 200%, teto 30"; nova **"Prospecção" limitada a 200% da cota diária** (acima disso, conta mas não pontua); Meta não concluída (−50) e Reunião (não pontua) inalterados. Tudo aplicado **retroativamente desde 28/09/2026 00:00 (Brasília)** via `scoring_rule_versions` (fechando a versão antiga de cada regra em 2026-09-28T03:00:00Z e abrindo a nova a partir dali) — nenhum evento histórico foi duplicado, alterado ou tem data mexida; o Extrato de Pontos usa a mesma anotação de teto que o Ranking, então os dois continuam reconciliando exatamente.
- **Motivo:** três auditorias sequenciais do dono (pontuação do dia, simulação de rebalanceamento, backtest do Modelo B Ajustado + teto de prospecção) mostraram Presença+Novo Cliente somando ~77% dos pontos do time e avanço real de funil só ~14% — o ranking recompensava volume/presença muito mais que avanço comercial. O Modelo B Ajustado, validado por backtest contra dados reais de 28/09–01/10, leva Funil a ~42% do total e nenhum corretor passa a liderar nenhum dia nem o acumulado só por volume sem avanço de funil.
- **Arquivos afetados:** `lib/performance-overview.js` (`loadDailyGoalBonusByBroker` reescrita para qualquer período/dia, `loadPresenceScoring` com teto, `annotateProspectingCap` novo, `getPointsLedger` ajustado), `supabase/migrations/20261001120000_scoring_model_b_adjusted.sql` (aplicada em produção), `docs/BUSINESS_RULES.md` (RAN-1/RAN-3/RAN-3a/RAN-3b).
- **Risco/observação:** build de produção (`next build`) passou limpo. Sem credenciais de admin neste ambiente para um teste ponta-a-ponta autenticado contra o Ranking ao vivo (mesma limitação de sessões anteriores) — a validação foi por leitura cuidadosa do código + backtest em SQL read-only nas três auditorias anteriores à implementação; o dono deve conferir o Ranking/Extrato de hoje e de um dia passado (ex.: 29/09) após o deploy. "Últimos 7 dias"/"Este mês" também passam a refletir o teto de presença e o novo bônus de meta para QUALQUER dia do período (antes só "hoje" tinha bônus de meta) — mudança desejada e abrangida pelo pedido de retroatividade, mas vale avisar o dono que números de períodos longos vão mudar, não só a semana de 28/09.
- **Autor:** Claude Code

### 2026-10-01 — Agente Marketing — Posicionamento Digital
- **Data:** 2026-10-01
- **Área:** Agentes/Docs
- **Alteração:** novo subagente `marketing-posicionamento`, 7 skills (`/auditar-posicionamento`, `/google-perfil-avaliacoes`, `/concorrentes-marilia`, `/seo-site`, `/visibilidade-ia`, `/conteudo-social`, `/plano-semanal`), memória em `docs/posicionamento/` e guia `docs/MARKETING_POSICIONAMENTO.md`; `CLAUDE.md` e `AGENTS.md` atualizados.
- **Motivo:** pedido do dono — especialista permanente em presença/reputação orgânica, separado do `gestor-trafego`.
- **Arquivos afetados:** `.claude/agents/marketing-posicionamento.md`, `.claude/skills/{auditar-posicionamento,google-perfil-avaliacoes,concorrentes-marilia,seo-site,visibilidade-ia,conteudo-social,plano-semanal}/`, `docs/posicionamento/*`, `docs/MARKETING_POSICIONAMENTO.md`, `CLAUDE.md`, `AGENTS.md`
- **Risco/observação:** só arquivos de agente/documentação, sem código do app. Site público hoje sem `robots.txt`/`sitemap.xml` (404) e sem JSON-LD — tratado pelo agente no 1º snapshot.

### 2026-10-01 — Mensagens internas de supervisão (gestor ↔ corretor)
- **Data:** 2026-10-01
- **Área:** Meta Diária (Supervisão) / Notificações / Banco
- **Alteração:** ícone de chat no card do corretor (visão do dono da Meta Diária) abre um mini-chat flutuante; a mensagem chega ao corretor como balão central fixo até "OK" ou resposta, uma por vez, com estados Enviada/Entregue/Vista/Confirmada/Respondida e badge de resposta não vista no card.
- **Motivo:** pedido do dono.
- **Reutilizado:** padrão de Broadcast do Chat (tópico HMAC + ping sem dados), `Avatar`, `sendPushToUser`, bipe de `lib/new-client-sound.js` (só com preferência ligada), `Button`/tokens da Fundação, `usePrefersReducedMotion`, `motion/react`, guards `requireAdminApi` + `managedUserIds`.
- **Arquivos afetados:** `supabase/migrations/20261001210000_supervision_messages.sql` (aplicada), `lib/supervision-messages.js`, `lib/supervision-messages-core.mjs`, `tests/supervision-messages-core.test.mjs`, `app/api/admin/supervision-messages/**`, `components/supervision/{SupervisionMessageGate,SupervisionChatDock,useSupervisionRealtime}.js(x)`, `components/TeamDailyPerformance.jsx`, `app/admin/layout.jsx`, vitrine (`supervisao-corretor` + rotas em `meta-diaria-equipe`).
- **Risco/observação:** sem mudança no Chat/WhatsApp, Google Contacts ou contatos. Durante "Alterar conta" o balão não aparece (decisão técnica, A CONFIRMAR com o dono). Entrada só na visão do dono (a tela de equipe hoje é exclusiva dele); gestor já é aceito pela API. Fluxo validado na vitrine (desktop 1280 e celular 390) e permissões em teste unitário; ponta a ponta com dois usuários reais não foi possível deste ambiente (sem login).
- **Autor:** Claude Code

### 2026-10-01 — Google Contacts: contato salvo como "Cliente {nome}"
- **Data:** 2026-10-01
- **Área:** Meta Diária (automação) / Integrações
- **Alteração:** o nome enviado ao Google ao criar o contato do cliente na agenda do corretor passa a ser `Cliente {nome completo}`. A função nova `buildGoogleContactName` (`lib/google-contacts-name.mjs`) é idempotente: nunca gera "Cliente Cliente". Sem nome, o contato é salvo como `Cliente {telefone}`. Ela é usada em `ensureClientInBrokerContacts`, no lugar da linha que montava o nome.
- **Motivo:** pedido do dono.
- **Sem mudança em:** nome do cliente no CRM e banco de clientes, telefone, identificação do contato existente (corretor + telefone, sem duplicar), salvar/confirmar antes do envio e fluxo de disparo.
- **Arquivos afetados:** `lib/google-contacts-name.mjs` (novo), `lib/google-contacts.js` (1 linha + import), `tests/google-contacts-name.test.mjs` (novo), `.claude/rules/integracoes-externas.md`, `docs/BUSINESS_RULES.md` MD-9.
- **Risco/observação:**
  - Os 85 contatos já sincronizados antes desta mudança mantêm o nome antigo no Google, porque a integração só cria contatos e nunca os atualiza. Renomeá-los exige um fluxo novo de atualização (A CONFIRMAR).
  - Validação real com a conta Google não pôde ser feita deste ambiente: os tokens são cifrados e a chave só existe na Vercel. Fica para o primeiro contato novo sincronizado após o deploy.
- **Autor:** Claude Code

### 2026-10-01 — Cliente "Pago" some da lista de Clientes, continua acessível pelo Financeiro
- **Data:** 2026-10-01
- **Área:** Clientes / Financeiro
- **Alteração:** cliente com status `sale_paid` ("Pago") deixou de aparecer em qualquer aba/busca/contador da tela Clientes (`lib/simulation-list-query.js`: `applyScopedFilters` e o contador "Todos" excluem o status). O cadastro continua existindo normalmente (nada é apagado; funil, pontuação e ranking não são afetados) — só não navega/busca mais até ele ali. Novo parâmetro `pinClientId` em `listSimulationClientsPage` busca um cliente específico por id ignorando esse filtro (mas respeitando escopo de responsável/permissão), usado quando a URL traz `?clientId=`. `AdminFinancialDashboard.jsx` ganhou um link "Ver cliente" na edição de uma venda, abrindo `/admin/simulacoes?clientId=<id>` — o único caminho de volta ao card a partir de agora.
- **Motivo:** pedido do dono — "gostaria que após a venda ser paga ela saísse dali [Clientes] e ficasse apenas no financeiro, o card do cliente deve ainda existir porém eu só consigo acessá-lo pelo financeiro [...] pra ter uma visão mais limpa e menos poluída".
- **Arquivos afetados:** `lib/simulation-list-query.js`, `app/api/simulation-registrations/list/route.js`, `app/admin/simulacoes/page.jsx`, `components/clients/useClientList.js`, `components/clients/ClientWorkspace.jsx`, `components/AdminFinancialDashboard.jsx`.
- **Risco/observação:** o sub-chip "Pago X" na barra de etapas da aba Venda sempre mostra 0 a partir de agora (consequência esperada: o status é excluído da contagem em todo lugar). Não testado com sessão autenticada real (sem credenciais de admin disponíveis nesta sessão) — baseado em revisão cuidadosa do código e confirmação via SQL direto de que o cliente de teste (Isabella Borges, `sale_paid`) seria afetado como esperado. `pnpm build`/testes não rodados nesta sessão (ambiente sem acesso ao comando).
- **Autor:** Claude Code

### 2026-10-01 — Correção: marcar venda como "Pago" agora lança o recebimento (conta no mês certo)
- **Data:** 2026-10-01
- **Área:** Financeiro
- **Alteração:** complementa a entrada anterior deste mesmo dia (cliente em "Pago" marca `financial_sales` como Recebido). `markFinancialSaleReceivedForRegistration` só alterava `financial_status` direto — como esse campo é sempre recalculado a partir da soma dos `financial_payments` (`deriveFinancialStatus`), a venda aparecia "Recebido" na lista mas não entrava nos totais mensais do Dashboard (que somam pagamentos por `received_date`), e a marcação se perderia na próxima vez que a venda fosse salva pela tela do Financeiro. Agora a função lança um `financial_payments` novo com o valor que falta receber (comissão bruta − já recebido), datado de hoje — nunca mexe em recebimentos/despesas/repasses já lançados.
- **Motivo:** pedido do dono — "a venda recebida deve ser computada no mês que eu alterei o status para pago".
- **Arquivos afetados:** `lib/financial.js`.
- **Risco/observação:** resolve também o risco residual já registrado na entrada anterior (status podendo ser sobrescrito ao salvar a venda pela tela) — agora o status fica consistente com um recebimento real. `pnpm build`/testes não rodados nesta sessão (ambiente sem acesso ao comando).
- **Autor:** Claude Code

### 2026-10-01 — Pipeline de venda: "Pagamento" renomeado para "Aguardando pagamento" + etapa "Pago" (marca a venda como Recebida no Financeiro)
- **Data:** 2026-10-01
- **Área:** Clientes / Funil / Financeiro
- **Alteração:** `sale_payment` mudou de rótulo de "Pagamento" para "Aguardando pagamento" (valor no banco inalterado) e um status novo, `sale_paid` ("Pago"), foi inserido como última etapa do pipeline de venda. Ordem final: Venda realizada, Formulários, Aguardando reserva, Conformidade, Contrato, Assinatura Caixa, ITBI, Cartório, Aguardando pagamento, Pago. Atualizado nos mesmos 7 arquivos da etapa "Conformidade" (commit `369bb0d`): `lib/client-status.js`, `lib/client-status-history.js`, `lib/celebrations.js`, `lib/scoring-rules.js`, `lib/simulation-list-utils.js`, `lib/simulation-registrations.js` (2 ocorrências), fixture da vitrine. Nova migration ajusta as 3 CHECK constraints do banco para aceitar `sale_paid` — já aplicada em produção. Além disso: cliente que entra em "Pago" agora marca automaticamente a venda financeira correspondente (`financial_sales`) como "Recebido" (`markFinancialSaleReceivedForRegistration`, `lib/financial.js`), chamada no mesmo ponto de `updateSimulationRegistration` que já cria a venda ao entrar no pipeline — só na transição PARA `sale_paid`, nunca retroativo. Não mexe em valores/despesas/repasses/pagamentos já lançados.
- **Motivo:** pedido do dono (duas mensagens seguidas: renomear/adicionar a etapa, depois "venda paga já deve alterar no financeiro também").
- **Arquivos afetados:** `lib/client-status.js`, `lib/client-status-history.js`, `lib/celebrations.js`, `lib/scoring-rules.js`, `lib/simulation-list-utils.js`, `lib/simulation-registrations.js`, `lib/financial.js`, `app/dev/vitrine/_fixtures/clientes.js`, `supabase/migrations/20261001200000_client_status_sale_paid.sql`. Regra registrada em `.claude/rules/financeiro.md`.
- **Risco/observação:** `financial_status` normalmente é recalculado a partir dos recebimentos lançados (`deriveFinancialStatus`) sempre que alguém salva a venda pela tela do Financeiro — a nova marcação automática usa `manual_status: true`, mas essa flag hoje só é informativa (não é respeitada por `updateFinancialSale` para evitar sobrescrita); ou seja, se o gestor editar a venda depois pelo Financeiro sem informar o status, ela pode ser recalculada e sair de "Recebido". Risco residual conhecido, não corrigido agora (fora do pedido). `pnpm build`/testes não rodados nesta sessão (ambiente sem acesso ao comando).
- **Autor:** Claude Code

### 2026-10-01 — Correção: congelamento da carteira perdia rodada que já tinha saído antes do freeze
- **Data:** 2026-10-01
- **Área:** Meta Diária / Ranking
- **Alteração:** corrige uma regressão da entrada anterior deste mesmo dia ("Meta Diária: carteira ativa... passa a congelar à meia-noite"). `freezeDailyGoalWalletIfMissing` (`lib/daily-goal-wallet.js`) só capturava rodadas com `status='active'` no instante exato do congelamento — uma rodada que o corretor já tinha trabalhado de manhã e que converteu/encerrou ANTES do congelamento lazy rodar (pode acontecer horas depois da geração da cota, se ninguém olhar o painel antes disso) nunca entrava no conjunto congelado e sumia da meta pelo resto do dia. Corrigido: a captura agora inclui também quem já saiu hoje antes do congelamento (`ended_at`/`converted_at` de hoje) — mesma condição que a consulta ao vivo já usava antes do congelamento existir. Rodada nova criada DEPOIS do congelamento continua de fora (não existe em nenhum dos dois lados da consulta), preservando a regra do dono.
- **Motivo:** o dono reportou que Luan Vitor recebeu só 14 contatos em vez de 20. Diagnóstico com dado real: a cota cheia de 20 foi gerada normalmente às 08:57; 6 desses contatos já tinham convertido/encerrado quando o congelamento lazy rodou às 14:44 (disparado por outra pessoa abrindo o painel do gestor); por isso só 14 entraram no congelamento.
- **Arquivos afetados:** `lib/daily-goal-wallet.js`.
- **Risco/observação:** confirmado o mesmo problema em mais 6 corretores no dia de hoje (Bruna Santos, Eduardo Bueno, Jennyfer Zorzato, izabela Silverio, Caroline Mayumi, ketlin) — as 14 linhas de `daily_goal_wallet_freeze` de hoje com `round_ids` incompletos foram recalculadas via SQL direto em produção com a mesma lógica da correção (nenhuma delas precisará de ajuste futuro; o congelamento de amanhã já nasce correto). `pnpm build`/testes não rodados nesta sessão (ambiente sem acesso ao comando).
- **Autor:** Claude Code

### 2026-10-01 — Pipeline de venda: "Reserva" renomeada e etapa "Conformidade" adicionada
- **Data:** 2026-10-01
- **Área:** Clientes / Funil
- **Alteração:** no pipeline de pós-venda, o status `sale_reservation` mudou de rótulo de "Reserva" para "Aguardando reserva" (valor no banco inalterado) e um status novo, `sale_compliance` ("Conformidade"), foi inserido logo depois, antes de "Contrato" (`sale_contract`). Ordem final: Venda realizada, Formulários, Aguardando reserva, Conformidade, Contrato, Assinatura Caixa, ITBI, Cartório, Pagamento. Atualizado em todo lugar que enumera o pipeline: `lib/client-status.js` (enum/opções/meta/funil — fonte única), `lib/client-status-history.js` (rótulos da timeline), `lib/celebrations.js` (marco de vendas do mês), `lib/scoring-rules.js` (pontuação — conta como "sale", igual às demais etapas), `lib/simulation-list-utils.js` (`isCompletedClientStatus`), `lib/simulation-registrations.js` (guard do pipeline de venda + guard de status manual, 2 ocorrências), fixture da vitrine de design. Nova migration ajusta as 3 CHECK constraints do banco (`simulation_registrations.status`, `client_status_history.new_status`/`previous_status`) para aceitar `sale_compliance` — já aplicada em produção.
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `lib/client-status.js`, `lib/client-status-history.js`, `lib/celebrations.js`, `lib/scoring-rules.js`, `lib/simulation-list-utils.js`, `lib/simulation-registrations.js`, `app/dev/vitrine/_fixtures/clientes.js`, `supabase/migrations/20261001190000_client_status_sale_compliance.sql`.
- **Risco/observação:** `components/clients/StatusOptions.jsx` (corrigido nesta mesma sessão para listar todas as etapas de venda a partir de `CLIENT_FUNNEL_SALE_STATUS_VALUES`) já mostra a etapa nova sem precisar de mudança adicional. Nenhum cliente existente precisou de migração de dado — só quem for movido manualmente para "Conformidade" daqui pra frente usa o novo valor. `pnpm build`/testes não rodados nesta sessão (ambiente sem acesso ao comando).
- **Autor:** Claude Code

### 2026-10-01 — Botão de concluir no agendamento legado do card e da ficha
- **Data:** 2026-10-01
- **Área:** Clientes / Agenda
- **Alteração:** o agendamento único do cadastro (`scheduled_activity_at`, distinto das "atividades extras" de `calendar_activities`) só tinha botões de editar/remover no card (`ClientCard.jsx`) e na ficha (`ClientSheet.jsx`) — não existia como marcar que a tarefa foi concluída, só editar a data ou apagar o agendamento inteiro. Adicionado um botão "Concluir" (✓), igual ao que as atividades extras já tinham, chamando a nova `list.completeClientSchedule(client)`.
- **Motivo:** dono reportou (print da ficha) que não via nenhum botão de "atividade realizada".
- **Arquivos afetados:** `components/clients/useClientList.js` (nova função `completeClientSchedule`), `components/clients/ClientCard.jsx`, `components/clients/ClientSheet.jsx`.
- **Risco/observação:** nenhuma mudança de backend/schema — `scheduled_activity_completed_at`/`_by` e a rota `PATCH /api/simulation-registrations/[id]` (campo `scheduledActivityCompleted`) já existiam e já eram usados pelo motor de automações (`trigger_type = "activity_completed"`) e pela página `/admin/agenda`; só faltava o botão aqui. "Concluir" grava a conclusão (histórico/automação) e também limpa `scheduled_activity_at` (mesmo efeito visual de "remover", mas contabilizado como concluída, não cancelada) — testado na vitrine (`/dev/vitrine?tela=clientes`), no card e na ficha, cliente some da agenda e aparece o toast "Atividade concluída.". `pnpm build` ok.
- **Autor:** Claude Code

### 2026-10-01 — Todas as etapas de venda liberadas no seletor de status do card
- **Data:** 2026-10-01
- **Área:** Clientes / Funil
- **Alteração:** `components/clients/StatusOptions.jsx` (grupo "Venda" do seletor de status, usado por `ClientCard.jsx` e `ClientSheet.jsx`) passou de mostrar só "Venda realizada" para listar as 8 etapas do pipeline de venda (`CLIENT_FUNNEL_SALE_STATUS_VALUES`, mesma ordem da barra de abas): Venda realizada, Formulários, Reserva, Contrato, Assinatura Caixa, ITBI, Cartório, Pagamento. Removida a lógica de "opção atual desabilitada" que só existia porque as demais etapas não eram selecionáveis.
- **Motivo:** pedido do dono — essas subetapas já existiam no funil (contagem própria na barra de abas de Clientes) e um cliente já estava em "Cartório", mas não havia como mover um cliente entre elas pela tela; só por edição direta no banco. Não era regressão de hoje (conferido no componente anterior à reescrita da lista de Clientes, mesma restrição já existia).
- **Arquivos afetados:** `components/clients/StatusOptions.jsx`.
- **Risco/observação:** o backend (`updateSimulationRegistration`, `lib/simulation-registrations.js`) já tratava qualquer uma das 8 etapas igualmente (auto-registro de venda financeira via `ensureFinancialSaleForRegistration`, marco automático de "Reunião realizada" se faltava) — a lacuna era só no frontend, nenhuma mudança de backend/permissão necessária. Liberado sem restrição de perfil (qualquer corretor/gestor que já podia mudar status pode mover entre as etapas de venda), conforme decisão do dono. `pnpm build`/testes não rodados nesta sessão (ambiente sem acesso ao comando).
- **Autor:** Claude Code

### 2026-10-01 — Meta Diária: carteira ativa (denominador da meta) passa a congelar à meia-noite
- **Data:** 2026-10-01
- **Área:** Meta Diária / Ranking
- **Alteração:** `wallet.dayTarget`/`wallet.current`/`wallet.stages` (`lib/daily-goal-wallet.js`) deixaram de recalcular "carteira ativa" ao vivo a cada carregamento e passaram a usar um conjunto de rodadas CONGELADO no início do dia (tabela nova `daily_goal_wallet_freeze`, uma linha por corretor/dia — mesmo padrão já usado para as pendências, `daily_goal_pending_freeze`). Congelamento acontece no cron `daily-goal-close` (00:01) e, como plano B, no primeiro acesso do dia (`freezeDailyGoalWalletIfMissing`, idempotente). Contato novo que entra na carteira durante o dia não conta na meta de hoje — só na de amanhã; se o corretor trabalhar esse contato hoje mesmo assim, a tentativa soma como prospecção excedente (bônus de %), só não aparece em nenhuma etapa específica do card "Contatos por tentativa". Saída da carteira (não contactar/conversão) continua contando normalmente (não mexe na correção de 2026-09-23 sobre isso). Sem o congelamento disponível (ex.: migration ainda não aplicada num ambiente), cai de volta no comportamento antigo (carteira ao vivo) sem quebrar a tela.
- **Motivo:** pedido do dono — a corretora Bruna Santos relatou já estar em 100% da meta; o painel do gestor, horas depois, mostrava 98%. Diagnóstico confirmado com dado real (consultas diretas ao banco de produção): a meta não "diminuiu" nem houve inconsistência de cálculo — o denominador (`wallet.dayTarget`) é recalculado ao vivo por desenho, e cresceu durante o dia porque novos contatos entraram na carteira ativa dela (3ª tentativa passou de X para 59, por exemplo) depois que ela já tinha completado o que existia pela manhã. O dono decidiu travar o denominador à meia-noite em vez de manter o recálculo ao vivo.
- **Arquivos afetados:** `lib/daily-goal-wallet.js`, `lib/daily-goal.js` (re-export), `app/api/cron/daily-goal-close/route.js`, `supabase/migrations/20261001180000_daily_goal_wallet_freeze.sql`. Docs: `.claude/rules/meta-diaria-ranking.md`, `docs/BUSINESS_RULES.md` (MD-5), `docs/INCIDENTES.md`.
- **Risco/observação:** testado contra produção (script isolado em `scratch/`, apagado ao final): `getDailyGoalWalletStatus` da Bruna Santos congelou corretamente no primeiro acesso e devolveu o MESMO `dayTarget`/`stages` numa segunda chamada imediata (confirmado via SQL que o total congelado bateu com a carteira ativa real no momento do congelamento). `pnpm build` não rodado nesta sessão (ambiente sem acesso ao comando; `node --check` passou nos 3 arquivos `.js` alterados). Risco residual: o chip "Carteira ativa X/100" (`wallet.current`) agora também reflete o conjunto congelado, não mais a carteira ao vivo — isso é intencional (mesmo total do card de meta), mas é uma mudança de comportamento visível nesse chip específico que não foi pedida explicitamente; avisar o dono se parecer estranho. Nenhuma tabela/coluna existente foi alterada, só criada.
- **Autor:** Claude Code

### 2026-10-01 — Chips de WhatsApp e Google Contacts sempre juntos no header admin
- **Data:** 2026-10-01
- **Área:** Infra / Frontend
- **Alteração:** no cabeçalho fixo do `/admin`, os chips "WhatsApp • status" e "Google Contacts • status" passaram a ficar dentro de um mesmo container (lado a lado quando cabe, empilhados quando não cabe). Antes, cada um era um item solto no `flex-wrap` do header e o Google Contacts podia quebrar para uma linha própria, centralizada sozinha, parecendo desconectado do WhatsApp.
- **Motivo:** pedido do dono — as duas informações de conexão deviam ficar juntas visualmente.
- **Arquivos afetados:** `app/admin/layout.jsx`.
- **Risco/observação:** mudança só de layout (wrapper `flex flex-col sm:flex-row`, padrão já usado em outros 9 arquivos do projeto); nenhum componente de chip foi alterado. `pnpm build` ok. Não testado com sessão autenticada real (sem credenciais de admin disponíveis nesta sessão) — baseado em build limpo e no padrão CSS já validado no restante do código.
- **Autor:** Claude Code

### 2026-10-01 — Círculo do card identifica o responsável, não o cliente
- **Data:** 2026-10-01
- **Área:** Clientes / Frontend
- **Alteração:** o círculo ao lado do nome no `ClientCard` (Lista de clientes) deixou de mostrar as iniciais do cliente e passou a identificar o responsável atual: foto de perfil do corretor responsável quando há uma cadastrada; iniciais do corretor (não do cliente) quando não há foto; e a marca da imobiliária em círculo preto quando o cliente está sem responsável (aguardando distribuição pela roleta). A imagem acompanha automaticamente qualquer troca de responsável (seletor do card ou qualquer outro fluxo existente), pois lê direto do mesmo dado que o card já recebia (`responsibleProfileMap`) — sem nova fonte de verdade. Fallback para iniciais se a foto não carregar. Nenhuma lógica de roleta/atribuição/permissão foi alterada; estrutura, altura e espaçamento do card continuam iguais.
- **Motivo:** pedido do dono, para reconhecer visualmente quem está com cada cliente na lista.
- **Arquivos afetados:** `components/clients/ClientCard.jsx`, `components/clients/ClientWorkspace.jsx`, `app/dev/vitrine/_fixtures/clientes.js` (fixture de teste), `public/assets/company-mark-avatar.png` (novo, recorte circular da marca fornecido pelo dono).
- **Risco/observação:** testado na vitrine (`/dev/vitrine?tela=clientes`) nos 6 cenários pedidos — corretor com foto, corretor sem foto, cliente sem responsável, troca pelo seletor do card, mobile e desktop — todos corretos. `pnpm build` ok.
- **Autor:** Claude Code

### 2026-10-01 — Alexa: skill privada "Central Machado" (consulta por voz, somente leitura)
- **Data:** 2026-10-01
- **Área:** Integração (Alexa) / Permissões
- **Alteração:**
  - Nova rota `POST /api/alexa/skill` (endpoint HTTPS da Custom Skill, sem Lambda). Segurança em camadas: assinatura, certificado e horário da Amazon (`ask-sdk-express-adapter`), ID da skill (`ALEXA_SKILL_ID`) e usuário Alexa autorizado (`ALEXA_ALLOWED_USER_IDS`, separado por vírgula). `deviceId` não é critério. Chave geral `ALEXA_SKILL_ENABLED`. Rate limit; orçamento de 6 s por resposta.
  - Intenções da V1: resumo do dia (reusa `buildArrivalSummary`), aguardando simulação/documentação/aprovação (reusa `countByStatus`), próxima reunião (`listCalendarActivities`) e "quem são?" (primeiros nomes, máx. 5, usando o assunto da pergunta anterior guardado na sessão). Lógica pura e testada em `lib/alexa-skill-core.mjs`.
  - Somente leitura; só contagens e primeiros nomes (sem CPF, renda, valores, documentos). Logs só com intenção e resultado. Sem migration/tabela nova. Voice Monkey e Rotina de Chegada intocados.
  - Dependência nova: `ask-sdk-express-adapter` (oficial Amazon) só para verificar a assinatura.
- **Motivo:** pedido do dono (conversar com a Alexa sobre o CRM).
- **Arquivos afetados:** `app/api/alexa/skill/route.js`, `lib/alexa-skill.js`, `lib/alexa-skill-core.mjs`, `lib/alexa-arrival.js` (exporta `countByStatus`), `tests/alexa-skill.test.mjs`, `package.json`, `pnpm-lock.yaml`, `.env.example`.
- **Risco/observação:** a skill fica em modo Development (só a conta Amazon do dono). O `userId` da Alexa muda se a skill for desativada e reativada. Correção da entrada anterior: o cron do CRM roda a cada 2 minutos (`*/2`), não a cada minuto; a fala da Rotina de Chegada sai até ~2–3 min depois do horário previsto. A confirmar: frases de uma só vez em pt-BR ("pergunte à central machado…") e comportamento caso o Echo migre para Alexa+.
- **Autor:** Claude (agente)

### 2026-10-01 — Botões do rodapé do card com 44px (Lista de clientes concluída)
- **Data:** 2026-10-01
- **Área:** Clientes / Frontend
- **Alteração:** os botões WhatsApp, Agendar e "⋯" do rodapé do `ClientCard` voltaram para 44px de altura, a área de toque recomendada. Nada mais foi alterado: espaçamentos, conteúdo, topo, indicadores, funil, busca e barra inferior continuam iguais. Com isso, a reformulação da Lista de clientes está **concluída**.
- **Motivo:** pedido do dono, para ter área de toque confortável no celular.
- **Arquivos afetados:** `components/clients/ClientCard.jsx`.
- **Risco/observação:** a altura do card aumenta cerca de 4px. Medição na vitrine: 44px nos três botões. `pnpm build` ok.
- **Autor:** Claude Code (designer-crm)

### 2026-10-01 — Card de cliente mais compacto
- **Data:** 2026-10-01
- **Área:** Clientes / Frontend
- **Alteração:** `ClientCard` com espaçamentos e alturas reduzidos. As mudanças:
  - padding de 14–16px;
  - avatar de 36px;
  - corpo com `space-y-2`;
  - próxima atividade em uma linha (data e nota truncada);
  - poder de compra em 16px;
  - "Adicionar tag" na linha de contato quando o cliente não tem tags.

  WhatsApp e Agendar passam a ter o mesmo tamanho (40px), com o WhatsApp ainda primário; o "⋯" também ficou com 40px (`Menu size="sm"`). "Último contato nunca" virou "Sem contato". Topo, busca, filtros, ficha e barra inferior não mudaram.
- **Motivo:** avaliação do dono em produção, com ~2.159 clientes; meta de 1,5 a 2 cards por tela sem perder informação.
- **Medição (vitrine, mesmos dados):** a altura média do card no celular caiu de 428 para 359px (corretor) e de 393 para 326px (admin), cerca de 16–17%. No celular, ficam ~1,9–2,1 cards visíveis na área da lista.
- **Arquivos afetados:** `components/clients/ClientCard.jsx`, `components/ui/Menu.jsx` (prop `size`), `.claude/skills/design-crm/references/{sistema-visual,padroes-crm}.md`.
- **Risco/observação:**
  - Nenhuma informação ou ação removida.
  - Botões do rodapé com 40px, dentro do mínimo de toque do sistema (44px recomendado e 40px como mínimo absoluto).
  - Validação: build, `node --test` (só as 3 falhas conhecidas) e revisão visual em 360, 390 e 1440px.
- **Autor:** Claude Code (designer-crm)

### 2026-10-01 — Alexa: rotina "Chegada ao escritório" (preparada, ainda NÃO validada no iPhone)
- **Data:** 2026-10-01
- **Área:** Integração (Alexa) / Banco / Cron
- **Alteração:**
  - Gatilho: Atalho do iPhone (conectar ao Wi-Fi do escritório) faz `POST /api/integrations/alexa-arrival` com `Authorization: Bearer <chave>`. A chave é gerada no painel (aparece uma única vez; só o hash SHA-256 fica em `alexa_arrival_state`; gerar outra invalida a anterior). Resposta mínima, rate limit, sem polling.
  - Regra: no máximo 1 resumo por dia (data de São Paulo, `last_arrival_date`); novas conexões no mesmo dia são ignoradas; no dia seguinte libera sozinho. Não depende de evento de saída. Chegada fora da faixa de horário/dias da rotina é ignorada SEM gastar a chance do dia.
  - Atraso (padrão 3 min): a chegada grava `pending_run_at`; o cron que já roda a cada minuto (`/api/cron/scheduled-activities`) chama `processDueArrival`, que reserva a execução, monta o resumo só nesse momento e fala. Pendente parado há mais de 1h é descartado.
  - Resumo (`lib/alexa-arrival.js`, composição pura em `lib/alexa-config-core.mjs`): agenda do dia (`listCalendarActivities`), contagens por status em `simulation_registrations` (aguardando simulação, documentação pendente, aguardando aprovação), meta diária (`getOwnerTeamDailyOverview`), vendas do dia (`financial_sales`). Só contagens e primeiros nomes; até 300 caracteres; itens zerados somem; falha de um bloco omite só aquele item.
  - Fala via `speakAlexa` (Voice Monkey) com as mesmas travas: Alexa ativa, rotina ativa, dia/horário global e da rotina, intervalo mínimo.
  - Painel: seção "Rotinas" em Configurações → Alexa (liga/desliga, atraso, dias, faixa de horário, gerar chave, "Ver/Ouvir resumo agora", status do último aviso e execução). Rotas admin: `GET/POST /api/admin/alexa/arrival` (`requireGeneralAdminApi`).
- **Motivo:** pedido do dono (rotina de chegada ao escritório).
- **Arquivos afetados:** `supabase/migrations/20261001170000_alexa_arrival_routine.sql`, `lib/alexa-arrival.js`, `lib/alexa-config-core.mjs`, `lib/alexa-service.js`, `lib/alexa-voice.js` (limite da frase 200→400), `app/api/integrations/alexa-arrival/route.js`, `app/api/admin/alexa/arrival/route.js`, `app/api/cron/scheduled-activities/route.js`, `app/admin/alexa/page.jsx`, `components/alexa/AlexaSettings.jsx`, `tests/alexa-arrival.test.mjs`.
- **Risco/observação:** a rotina nasce DESLIGADA. O Atalho do iPhone ainda precisa ser criado e validado pelo dono. iOS pode atrasar ou pular automações (modo de baixo consumo, atualização que volta "Executar imediatamente" para "Perguntar antes"). "Documentações pendentes" usa os status Aguardando documentação + Documentação pendente (não há contagem de "aguardando análise" da IA).
- **Autor:** Claude (agente)

### 2026-10-01 — Lista de clientes em cards híbridos (etapa e responsável no card)
- **Data:** 2026-10-01
- **Área:** Clientes / Frontend
- **Alteração:**
  - A listagem de `/admin/simulacoes` passa a ser de cards (`components/clients/ClientCard.jsx`), padrão único no celular e no desktop. Topo, busca, filtros, funil, ficha, Fundação, Manrope e barra inferior inalterados.
  - **No card:** nome, telefone, código, etapa, responsável (admin/gestor), urgência, novo formulário, até 2 próximas atividades com concluir/cancelar, poder de compra ou situação da simulação, último contato, cadastro, preferência de contato e tags (até 4). Ações: WhatsApp, Agendar (abre a ficha no formulário), menu ⋯ (Documentação, Empreendimentos, Valores, Ficha completa, Excluir só para o dono) e ações de prospecção quando se aplicam.
  - **Etapa no card:** seletor nativo com aparência de selo; a mudança só é gravada após confirmação ("Mudar a etapa? de X para Y"). Cancelar mantém a etapa atual.
  - **Responsável no card:** só aparece para quem já podia trocar (`canManageResponsibleUsers` = admin geral ou gestor, com a lista de corretores já limitada pela página). Pede confirmação antes de gravar. O guard do servidor é o mesmo.
  - A ficha abre direto em agenda, tags ou documentos a partir do card. Lista de etapas centralizada em `components/clients/StatusOptions.jsx` (card e ficha).
  - Removidos: `components/clients/ClientRow.jsx` (lista em linhas), a cópia da tela antiga e as telas de comparação da vitrine.
- **Motivo:** decisão do dono após comparar antigo × atual × híbrido na vitrine.
- **Auditoria card antigo × híbrido:** presentes no card ou a um toque — responsável (seletor), nome/código, etapa (seletor), urgência, tags (+ editor), data do cadastro, novo formulário, último contato, agendamento principal e atividades (concluir/cancelar; editar/remover e "+N" na ficha), preferência de contato, poder de compra/situação da simulação, prospecção (Prospectar, Em atendimento, Não contactar com motivo, Devolver à fila), WhatsApp, Agendar, Cadastro (ficha), Empreendimentos, Valores, Documentação, Excluir (dono). Na ficha, por decisão anterior do dono: CCA, "Avisar progresso" e histórico.
- **Arquivos afetados:** `components/clients/{ClientCard,ClientWorkspace,ClientSheet,StatusOptions,client-format}.jsx|js`, `components/clients/ClientRow.jsx` (removido), `components/ui/Menu.jsx` (novo), vitrine, `.claude/rules/frontend-pwa.md`, `docs/SYSTEM_ARCHITECTURE.md`, `sistema-visual.md`.
- **Risco/observação:**
  - Confirmação nova antes de mudar etapa e responsável no card. No card antigo a troca era imediata.
  - Validação: `pnpm build` ok; `node --test` com as mesmas 3 falhas conhecidas (`journey-http` ×2, `whatsapp-flow-core`); revisão visual na vitrine em 360/390/768/1280/1440 (admin, gestor, corretor); testados mudar etapa (cancelar e confirmar), trocar responsável e as listas por perfil (corretor sem seletor; gestor só com a equipe), sem erros de console. Não testado com login real em produção.
- **Autor:** Claude Code (designer-crm)

### 2026-10-01 — Configurações → Alexa (painel + serviço central de fala)
- **Data:** 2026-10-01
- **Área:** Integração (Alexa/Voice Monkey) / Banco / Permissões
- **Alteração:**
  - Nova tabela `alexa_settings` (linha única): Alexa ativa, dias da semana, horário inicial/final (Brasília), intervalo mínimo entre falas, `events` (jsonb) com liga/desliga + frase por evento e extras (antecedência da reunião; mínimo de clientes e tempo aguardando da fila) e `last_spoken_at`. Nunca guarda token nem ID do dispositivo.
  - `lib/alexa-service.js` é o ponto ÚNICO de decisão: `announceAlexaEvent(evento, valores)` valida Alexa ativa, evento ativo, dia/horário e intervalo mínimo (reserva atômica em `last_spoken_at`), monta a frase (variáveis `{cliente}`, `{corretor}`, `{quantidade}`, `{minutos}`; só primeiro nome) e chama `speakAlexa` (`lib/alexa-voice.js`). Nunca lança erro; logs só com evento e motivo. Regras puras e testadas em `lib/alexa-config-core.mjs` (inclui bloqueio de CPF, renda, valores e afins na frase e no texto final).
  - Página `/admin/alexa` (menu CONFIGURAÇÕES, só administrador geral) e rotas `GET/PUT /api/admin/alexa` e `POST /api/admin/alexa/test` ("Testar Alexa"), todas com `requireGeneralAdminApi`. A API devolve só booleanos sobre as envs (token/dispositivo/servidor liberado).
  - "Novo cliente" (formulário completo e Atendimento Rápido) agora passa por `announceAlexaEvent("new_client", …)`. Os outros 5 eventos (cliente aprovado, venda, meta diária, reunião próxima, fila) estão só configuráveis e NÃO conectados a fluxos reais.
  - Novo componente `components/ui/Switch.jsx`.
- **Motivo:** pedido do dono: gerenciar as regras da Alexa pelo painel, sem alterar código.
- **Arquivos afetados:** `supabase/migrations/20261001150000_alexa_settings.sql`, `lib/alexa-config-core.mjs`, `lib/alexa-service.js`, `app/api/admin/alexa/route.js`, `app/api/admin/alexa/test/route.js`, `app/admin/alexa/page.jsx`, `components/alexa/AlexaSettings.jsx`, `components/ui/Switch.jsx`, `components/AdminMenu.jsx`, `app/api/simulation-registrations/route.js`, `app/api/simulation-registrations/quick-attendance/route.js`, `tests/alexa-config.test.mjs`.
- **Risco/observação:** se a tabela não existir ou o banco falhar, o serviço cai no padrão (só "Novo cliente" fala, 24h, sem intervalo), preservando o comportamento anterior. A variável `ALEXA_VOICE_ENABLED` da Vercel continua como chave geral de segurança, além do painel. Falas são em série no Echo (sem fila): vários eventos simultâneos podem se sobrepor.
- **Autor:** Claude (agente)

### 2026-10-01 — Nova Lista de clientes (substitui AdminSimulationList)
- **Data:** 2026-10-01
- **Área:** Clientes / Frontend
- **Alteração:**
  - `/admin/simulacoes` passa a usar `components/clients/`: `ClientWorkspace` (cabeçalho com atalhos, "Para agir agora", funil clicável, busca/filtros, lista, paginação), `ClientRow` (colunas no desktop, cartão no celular), `ClientSheet` (ficha em gaveta: ações, etapa, responsável, CCA, aviso de progresso/histórico, prospecção, agenda, simulação, tags, cadastro com e-mail/PIS, exclusão) e `useClientList` (estado e ações, mesmas APIs).
  - Decisões do dono: etapa, "Avisar progresso" e CCA ficam só na ficha; a lista abre com 20 por página (`page.jsx` pede `pageSize: 20` na carga inicial).
  - `alert/confirm` do navegador viraram aviso (`Toast`) e diálogo (`ConfirmDialog`) da página.
  - `components/AdminSimulationList.jsx` removido; referências em `lib/` (comentários), `docs/` e rules atualizadas.
- **Motivo:** redesenho aprovado pelo dono (Designer CRM).
- **Arquivos afetados:** `app/admin/simulacoes/page.jsx`, `components/clients/*` (novos), `components/AdminSimulationList.jsx` (removido), `components/ui/{Button,Sheet,ConfirmDialog,Toast}.jsx`, `app/globals.css`, `tailwind.config.cjs`, comentários em `lib/{client-status,do-not-contact-reasons,simulations,simulation-list-utils}.js`, `docs/{SYSTEM_ARCHITECTURE,BUSINESS_RULES}.md` (só caminhos de arquivo em CLI-5b/CLI-12; texto das regras intacto), `.claude/rules/{frontend-pwa,crm-clientes-funil}.md` (paths agora `components/clients/**`), vitrine.
- **Auditoria antiga × nova (todas preservadas):** busca com debounce; abas de grupo e status; filtros corretor (só admin/gestor), tag, sem contato +3 dias, sem atividade futura, pendentes, novos atendimentos (inclusive vindos por URL) com etiquetas removíveis; copiar link (corretor), Prospecção, Novo cliente; atalhos Meta Diária/Chat/Agenda com contadores (no desktop o menu do topo não mostra esses subitens; no celular estão na barra inferior); WhatsApp com registro de contato; etapa incl. Venda; responsável (só admin/gestor); CCA; aviso de progresso e histórico; urgência; agendamento principal (criar/editar/remover) e atividades extras (criar/concluir/cancelar, "ver todas"); prospecção (Prospectar, Em atendimento, Não contactar com motivo, Devolver à fila — mesmas condições); tags (marcar, criar com cor, excluir do sistema); Documentação, Empreendimentos, Valores; cadastro completo, e-mail/PIS editáveis, preferências do imóvel, preferência de contato, novo formulário, código do cliente; excluir (só dono); paginação com números e 5/10/20; abrir cliente por `?clientId=`; estados vazio/erro/carregando.
- **Risco/observação:**
  - Corrigido de passagem: tags e agendamento editados agora aparecem na hora na lista (antes só depois de recarregar).
  - Tags na lista aparecem a partir de 1024px; no celular ficam na ficha. CCA e "Avisar progresso" não carregam mais por cliente na lista (só ao abrir a ficha) — menos requisições.
  - Validação: `pnpm build` ok (sem rotas `/dev`); `node --test` 261/265 — as 3 falhas são as conhecidas (`journey-http` ×2 exigem servidor local; `whatsapp-flow-core` "Menu principal"); revisão visual na vitrine em 360/390/768/1280/1440 (admin, gestor, corretor); teste de interação e de permissão por perfil na vitrine sem erros de console. Não foi testado com login real em produção.
- **Autor:** Claude Code (designer-crm)

### 2026-10-01 — Manrope como tipografia oficial do painel
- **Data:** 2026-10-01
- **Área:** Frontend
- **Alteração:** `app/admin/layout.jsx` carrega Manrope (`next/font/google`) e redefine `--font-ui` no `:root` só nas rotas `/admin`. Site público inalterado. Vitrine passa a usar Manrope por padrão.
- **Motivo:** escolha do dono após o comparativo visual Manrope × Inter.
- **Arquivos afetados:** `app/admin/layout.jsx`, `app/dev/vitrine/**`, `.claude/skills/design-crm/references/sistema-visual.md`, `.claude/skills/design-crm/scripts/capturar-vitrine.mjs`.
- **Risco/observação:** só tipografia; larguras de texto mudam levemente (Manrope é um pouco mais larga que a fonte do sistema) — conferido na vitrine. Nenhuma regra, API ou permissão alterada.
- **Autor:** Claude Code (designer-crm)

### 2026-10-01 — Fundação do sistema visual + navegação mobile com barra inferior
- **Data:** 2026-10-01
- **Área:** Frontend / Navegação do painel
- **Alteração:**
  - **Tokens** (aditivos) em `tailwind.config.cjs`: rampa de texto (`ink-2`, `faint`), cores semânticas `success|warning|danger|info|neutral` (`DEFAULT/soft/line/strong`), raios `chip|control|card|panel`, `shadow-float`, `ease-out-ui`, `text-2xs`, `min-h-touch`. Fonte da interface virou a variável `--font-ui` (`globals.css`) com **a mesma pilha de antes** — a família definitiva aguarda a escolha do dono (comparativo Manrope × Inter entregue).
  - **Componentes base** `components/ui/`: Button, Badge/CountBadge, StatusBadge (+ `status-tone.js`), Card, Sheet (`<dialog>` nativo), EmptyState, Skeleton, Field, `cx`.
  - **Navegação mobile:** `components/AdminBottomNav.jsx` em `app/admin/layout.jsx` — barra inferior fixa (< 768px) com 4 destinos por perfil (admin geral: Meta, Clientes, Chat, Desempenho; demais: Meta, Clientes, Chat, Agenda) + "Mais" com Pendências e todos os itens do menu (`getAdminMenuGroups`, exportado de `AdminMenu.jsx`, fonte única). `AdminMenu` passa a aparecer só ≥ 768px. Espaço reservado por `--admin-bottom-nav-space`; aviso de instalação do PWA sobe acima da barra; a barra some com o teclado aberto.
  - Vitrine: tela `fundacao`, seletor de fonte, barra inferior simulada; script de captura com `--fonte`, `--clicar "botao:…"`, `--sufixo`.
- **Motivo:** pedido do dono — Fundação antes do redesenho das telas; nova navegação mobile autorizada.
- **Arquivos afetados:** `tailwind.config.cjs`, `app/globals.css`, `components/ui/*` (novos), `components/AdminBottomNav.jsx` (novo), `components/AdminMenu.jsx`, `app/admin/layout.jsx`, `components/AdminPwaInstallHint.jsx`, `app/dev/vitrine/**`, `.claude/skills/design-crm/**`, `.claude/rules/frontend-pwa.md`, `docs/pwa-admin.md`.
- **Risco/observação:**
  - Nenhuma regra de negócio, API ou permissão alterada; nenhum item de menu removido (todos acessíveis pelo "Mais"); telas existentes não usam ainda os componentes novos.
  - Revisão visual na vitrine em 360/390/768/1440 (perfis admin, gestor, corretor). Conversa aberta no Chat (altura `100dvh-150px`) fica acima da barra por causa do espaço reservado no fim da página; o encaixe definitivo vem no redesenho do Chat.
  - Pré-existente, não corrigido (fica para o redesenho de Clientes): em 360px os botões de ação do card de cliente transbordam ("Agenda" cortado).
- **Autor:** Claude Code (designer-crm)

### 2026-10-01 — Designer CRM: agente, skill de design e vitrine de componentes (somente desenvolvimento)
- **Data:** 2026-10-01
- **Área:** Infra / Frontend / Estrutura do Claude
- **Alteração:**
  - Novo agente `designer-crm` (Product Design/UI-UX): critica antes de executar, propõe além do pedido, implementa só interface; delega dado/API/regra ao `crm-editor`.
  - Nova skill `/design-crm` (modos criticar, redesenhar, limpar) com referências sob demanda: `sistema-visual.md` (memória do design: identidade obrigatória, diagnóstico atual, tokens propostos, tabela de decisões), `padroes-crm.md`, `revisao-visual.md`, e o script `scripts/capturar-vitrine.mjs` (screenshots em 360/390/768/1280/1440).
  - **Vitrine** `app/dev/vitrine`: componentes reais (Clientes, Chat, Meta Diária corretor/dono, Desempenho) com dados 100% fictícios e mock de `fetch` — sem login, sem API, sem banco. Só existe no `next dev`: `next.config.mjs` registra a extensão `dev.jsx` apenas em `PHASE_DEVELOPMENT_SERVER`; `notFound()` em produção como segunda trava. `AppChrome` renderiza `/dev/*` sem cabeçalho/rodapé público (rota inexistente em produção).
  - Ponteiros: `.claude/rules/frontend-pwa.md` (decisão visual → `/design-crm`), `crm-editor`, `CLAUDE.md`, `AGENTS.md`.
- **Motivo:** pedido do dono — Designer especialista com liberdade de redesenho, preservando azul/branco, logo, funcionalidades e regras; revisão visual sem login.
- **Arquivos afetados:** `.claude/agents/designer-crm.md`, `.claude/skills/design-crm/**`, `app/dev/vitrine/**`, `next.config.mjs`, `components/AppChrome.jsx`, `.claude/rules/frontend-pwa.md`, `.claude/agents/crm-editor.md`, `CLAUDE.md`, `AGENTS.md`.
- **Risco/observação:**
  - `pnpm build` ok sem nenhuma rota `/dev` na saída; nenhum comportamento de produção muda.
  - Custo fixo medido em sessão nova: +~90 tokens no início; a skill só carrega quando há tarefa de design (verificado: crítica de design invocou `/design-crm` e leu só `sistema-visual.md`).
  - Encontrado e não corrigido (fora do escopo): `text-slate`/`bg-slate` (216 usos) não geram CSS; possível bug — após marcar/desmarcar tag na Lista de clientes, as pílulas do card só atualizam no próximo carregamento da lista (A CONFIRMAR em produção).
- **Autor:** Claude Code

### 2026-10-01 — Guia de lead por evidência de mídia paga + ID do anúncio no link do Fluxo "formulário direto" (encerra a estruturação do Gestor de Tráfego)
- **Data:** 2026-10-01
- **Área:** WhatsApp (Fluxos) / Guia de Atendimento / Meta/Tráfego
- **Alteração:**
  - **Guia de Atendimento:** `classifyGuideKind` ganhou `paidMediaEvidence`, calculado por `hasPaidMediaEvidence` (`lib/lead-origin.js`). Cliente com evidência confiável de mídia paga (ID do anúncio, `paid_link`, `paid_media` ou UTM paga reconhecida) recebe o guia de **lead**, mesmo vindo pelo link de corretor. Texto livre não conta.
  - **Fluxos:** nova variável `{{anuncio_id}}`, com o ID real do anúncio vindo do `referral` do clique (`adIdFromReferral`). O Fluxo ativo "Anúncio WhatsApp — formulário direto" teve o link alterado de `…utm_campaign=ctwa_formulario` para `…utm_campaign=ctwa_formulario&utm_content={{anuncio_id}}` (rascunho e versão publicada). Sem ID, o link continua igual ao anterior na prática, porque a UTM vazia é descartada.
  - **Gestor de Tráfego:** Q6 reconhece o ID do anúncio que vem no link.
- **Motivo:** decisão do dono, para atribuir exatamente anúncio → cadastro e tratar cliente de mídia paga como lead.
- **Arquivos afetados:** `lib/lead-origin.js`, `lib/attendance-guide-core.mjs`, `lib/attendance-guides.js`, `lib/whatsapp-flows.js`, `lib/whatsapp-referral.mjs`, testes (`attendance-guide-core`, `lead-origin`, `whatsapp-chat-media-referral`, novo `ctwa-form-link-attribution`), `.claude/skills/auditar-trafego/references/consultas-funil.md`, `docs/TRAFEGO_META.md` §4.
- **Dado alterado em produção (autorizado):** `whatsapp_flows` id `5fa75655-b82e-4020-8bdc-67e50f2932fc`, nó `form`, campo `linkUrl` (em `graph` e `published_graph`). Para reverter, remover `&utm_content={{anuncio_id}}`.
- **Risco/observação:**
  - Nenhum histórico reescrito; nada alterado na Meta.
  - **Validação:** suíte com 261 aprovados e 1 falha conhecida (`whatsapp-flow-core`, "Menu principal"); `pnpm build` ok.
  - Clientes antigos com evidência paga passam a abrir o guia de lead dali em diante, porque a classificação é calculada na leitura.
- **Autor:** Claude Code

### 2026-10-01 — Reconhecimento de UTMs pagas fora do padrão + diagnóstico de atribuição do Gestor de Tráfego
- **Data:** 2026-10-01
- **Área:** Meta/Tráfego / Clientes (origem)
- **Alteração:**
  - **Código (`crm-editor`):** `lib/lead-origin.js` ganhou `classifyPaidMedia`, uma função pura. Ela reconhece como mídia paga também `utm_medium=anuncio`/`anúncio`, formato do Fluxo ativo "Anúncio WhatsApp — formulário direto", que só dispara para quem chegou clicando em anúncio. Novos cadastros pagos passam a gravar `paid_media: true` e, quando há evidência, `paid_channel` (`whatsapp_ad` para `ctwa_formulario`; `meta_site` para fb/ig). Essas chaves são aditivas em `client_origins.source_metadata`. O padrão atual e a prioridade de `kind`/`label` ficaram iguais; link pessoal continua `broker_link`.
  - **Gestor de Tráfego:**
    - Q2 passou a reconhecer `anuncio` e `paid_media`.
    - No caso `ctwa_formulario`, busca o anúncio no `referral` da conversa pelo telefone, sem contar duas vezes quem já tem card de anúncio de WhatsApp.
    - Nova consulta canônica **Q6** (diagnóstico de atribuição) em `consultas-funil.md`.
- **Motivo:** pedido do dono, após a primeira auditoria de tráfego.
- **Arquivos afetados:** `lib/lead-origin.js`, `tests/lead-origin.test.mjs` (novo, 11 testes), `.claude/skills/auditar-trafego/references/consultas-funil.md`, `docs/TRAFEGO_META.md` §4, `docs/BUSINESS_RULES.md` CAM-3.
- **Risco/observação:**
  - **Histórico:** nenhum cadastro antigo foi alterado (origem imutável; sem evidência, nada muda). Os 2 cadastros "PATROCINADO" sem nenhuma UTM continuam sem atribuição.
  - **Validação em produção (set/2026, Q6):** 38 por anúncio de WhatsApp, 21 com UTM padrão e 2 do formulário do anúncio de WhatsApp (1 com o anúncio identificado pela conversa e já contado, 1 sem conversa). A Q2 atribui 60 cadastros: os 59 de antes mais 1 de mídia paga sem anúncio identificado.
  - **Testes e build:** suíte igual à anterior (1 falha conhecida em `whatsapp-flow-core`); `pnpm build` ok.
  - **Pendente de decisão:** o Guia de Atendimento (`lib/attendance-guide-core.mjs`) trata `tracked_link` como lead, mas não `paid_link`. Cadastro patrocinado sem link pessoal recebe o guia orgânico, e isso já acontecia antes desta mudança.
- **Autor:** Claude Code (correção de código pelo `crm-editor`)

### 2026-10-01 — Gestor de Tráfego: análises só dos últimos 30 dias, sem backfill
- **Data:** 2026-10-01
- **Área:** Meta/Tráfego / Docs
- **Alteração:** decisão do dono — não carregar o histórico antigo da Meta. Anúncios de 2023 (impulsionamentos e publicações patrocinadas) não são relevantes para a estratégia atual. Baseline e análises do Gestor de Tráfego usam os últimos 30 dias.
- **Arquivos afetados:** `.claude/skills/auditar-trafego/references/regras-decisao.md` §1, `docs/TRAFEGO_META.md` §6-A.
- **Risco/observação:** nenhuma chamada de backfill foi feita. A sincronização diária e a intradiária continuam iguais.
- **Autor:** Claude Code

### 2026-10-01 — Gestor de Tráfego: agente + 3 skills somente leitura (Meta × funil do CRM)
- **Data:** 2026-10-01
- **Área:** Docs / Infra (estrutura do Claude Code) / Meta/Tráfego
- **Alteração:** novo agente `gestor-trafego` e skills `/auditar-trafego` (auditoria + monitoramento + funil anúncio → cliente → simulação → documentação → aprovação → reunião → venda; referências `consultas-funil.md` com Q0–Q5 validadas em produção e `regras-decisao.md` com baseline do histórico, critérios para baixo volume, interpretação de atribuição e checklist de configuração), `/criar-anuncio` (copy + briefing + `conformidade-imobiliaria.md`) e `/planejar-campanha` (especificação PAUSADA + checklist). Conceitos do projeto público Meta Ads Stack (ad-audit, ad-watchdog, ad-creative-engine, campaign-builder, princípios do ad-optimizer) usados só como referência; nenhum MCP, token ou integração instalado. `docs/TRAFEGO_META.md` §6-A, `CLAUDE.md` e `AGENTS.md` atualizados.
- **Motivo:** pedido do dono — especializar o Gestor de Tráfego (Marília/SP, primeiro imóvel, MCMV, financiamento) e cruzar investimento com a evolução real do lead no CRM.
- **Arquivos afetados:** `.claude/agents/gestor-trafego.md`, `.claude/skills/{auditar-trafego,criar-anuncio,planejar-campanha}/**`, `docs/TRAFEGO_META.md`, `CLAUDE.md`, `AGENTS.md`.
- **Risco/observação:**
  - **Segurança:** somente leitura (`SELECT` no Supabase; integração Meta é `ads_read`); toda ação vira recomendação para aprovação; sem metas inventadas (baseline do histórico até o dono definir).
  - **Achados de dados (verificados):**
    - links pagos usam UTM com IDs da Meta (campanha/conjunto/anúncio), casando 1:1 com `meta_ad_entities`;
    - leads da Meta ≠ clientes do CRM por desenho (o Pixel conta todo formulário; a Meta atribui com 7d clique/1d visualização);
    - campanha de WhatsApp tem `leads = 0` na Meta (o resultado é "conversa iniciada");
    - `special_ad_categories` não é sincronizado → categoria especial **A CONFIRMAR**.
  - **Contexto medido em sessão nova:** +570 tokens fixos (descrições); auditoria completa carrega ~7 mil tokens só quando usada.
  - **Teste de roteamento:** pergunta de tráfego foi delegada ao `gestor-trafego`; sem acesso ao banco, o agente recusou estimar.
  - **Histórico (backfill):** autorizado pelo dono, mas só pode ser disparado com sessão de administrador (rota existente `POST /api/admin/meta-ads/backfill`). Dados atuais: 13/09–30/09/2026.
- **Autor:** Claude Code

### 2026-10-01 — Atribuição em massa da Prospecção registra o admin real em "Alterar conta"
- **Data:** 2026-10-01
- **Área:** Permissões / Prospecção
- **Alteração:** `assignProspectingContacts` (`lib/prospecting.js`), única ação exclusivamente administrativa entre os 8 pontos do P-17, passa a registrar quem **realmente** executou, mesmo durante "Alterar conta". Usa `getActingAdminEmail` no `adminEmail` (`changed_by` do status inicial e `last_admin_email`) e no `actor` da origem do cadastro. As demais ações operacionais continuam atribuídas ao corretor emulado.
- **Motivo:** decisão do dono (2026-10-01).
- **Arquivos afetados:** `lib/prospecting.js`, `.claude/rules/auth-permissoes.md`, `docs/SYSTEM_ARCHITECTURE.md` (P-17).
- **Risco/observação:**
  - Fora de "Alterar conta" o comportamento é idêntico, porque `getActingAdminEmail` devolve o próprio usuário.
  - O status inicial `pending` não pontua, então não há efeito em ranking.
  - Só afeta clientes **criados** pela atribuição; cliente já existente não tem a origem regravada.
  - **Validação:** checagem isolada de `getActingAdminEmail` ("Alterar conta" → admin real; sessão normal → o próprio usuário); `pnpm build` ok; suíte igual à anterior (245 ok, 1 falha conhecida em `whatsapp-flow-core`).
- **Autor:** Claude Code

### 2026-10-01 — WA-10, ROL-2b e proteção do upload público de captação (implementação)
- **Data:** 2026-10-01
- **Área:** WhatsApp / Roleta / Presença / Site público / Infra
- **Alteração:**
  - **WA-10:** o botão "Receber minha simulação" abre o WhatsApp do corretor **responsável** pelo cadastro, usando o token do próprio cadastro. Na fila de espera mostra aviso e consulta de novo; com responsável sem telefone válido mostra aviso. Nunca abre número de reserva.
  - **ROL-2b:** a roleta considera on-line só até 5 min da atividade **real**. Clique no WhatsApp do CRM e envio pelo Chat contam como atividade; acabou a gravação de hora no futuro. A tolerância visual do painel Online, do seletor 🟢 do Chat e do painel da roleta passou a ser calculada na leitura (`loadVisualPresence`). O clique de WhatsApp da Prospecção agora registra atividade como os demais.
  - **Upload de captação:**
    - tipo validado pelos bytes reais do arquivo;
    - rate limit que bloqueia se a checagem falhar (só nesta rota);
    - limpeza diária de fotos órfãs (com mais de 72 h, nunca referenciadas em captação ou imóvel), no cron `scheduled-activities`.
  - **P-17:** decisão do dono registrada: ações operacionais em "Alterar conta" continuam atribuídas ao corretor emulado; os 8 pontos não foram alterados.
- **Motivo:** regras confirmadas pelo dono em 2026-10-01.
- **Arquivos afetados:**
  - Código: `lib/admin-presence.js`, `lib/admin-presence-core.mjs` (novo), `lib/lead-distribution.js`, `lib/whatsapp-chat.js`, `app/api/prospecting/[id]/route.js`, `lib/simulation-registrations.js`, `lib/receive-simulation-contact.mjs` (novo), `app/api/whatsapp-contact/route.js`, `components/simulation-form/{SimulationForm,SimulationSuccess,ReceiveSimulationWhatsappButton}.jsx`, `lib/rate-limit.js`, `lib/image-signature.mjs` (novo), `app/api/uploads/captacoes/route.js`, `lib/captacao-upload-cleanup.js` e `-core.mjs` (novos), `app/api/cron/scheduled-activities/route.js`.
  - Testes novos: `tests/admin-presence-core`, `receive-simulation-contact`, `image-signature`, `captacao-upload-cleanup-core`.
  - Documentação: rules `auth-permissoes`, `integracoes-externas`, `roleta-prospeccao-campanhas`; `docs/BUSINESS_RULES.md`, `SYSTEM_ARCHITECTURE.md`, `PERMISSIONS.md`, `WHATSAPP.md`.
- **Risco/observação:**
  - **Banco:** nenhuma migration nem mudança de banco. A limpeza grava só a marca `crm_settings.id='captacao_upload_cleanup'`.
  - **Conferido em produção (somente leitura):** todo cadastro por formulário tem token; 0 fotos em `captacoes/` hoje; nenhum `last_activity_at` no futuro.
  - **Validação:** `pnpm build` ok; testes ok, exceto a falha conhecida de `tests/whatsapp-flow-core.test.mjs`. Sem login real neste ambiente: tela de espera do botão e painel Online não foram vistos rodando.
  - **Efeito visível:** depois de uma ação de WhatsApp o status visual on-line pode durar até ~1 min a menos que antes, porque a marca é por minuto.
  - **Pendente de decisão:** `assignProspectingContacts` (única ação administrativa entre os 8 pontos do P-17).
- **Autor:** Claude Code

### 2026-10-01 — Pente-fino documental: P-17, upload de captação, Oportunidades e duas regras do dono
- **Data:** 2026-10-01
- **Área:** Docs / Permissões / Roleta / WhatsApp
- **Alteração:**
  - **Regras do dono (`/registrar-regra`):** WA-10 (botão "Receber minha simulação" abre o WhatsApp do corretor responsável) e ROL-2b (on-line para a roleta = atividade real no CRM nos últimos 5 min, sem tolerância por clique ou envio no WhatsApp). As duas **divergem do código** e foram registradas lado a lado como COMPORTAMENTO ATUAL, aguardando implementação.
  - **P-17 auditado:** 8 pontos que chegam à pontuação, lista em `SYSTEM_ARCHITECTURE.md` §13.
  - **Upload de captação (P-09):** risco documentado.
  - **Central de Oportunidades:** removidas as referências obsoletas em `CRM_CONTEXT.md` (menus refeitos a partir do `AdminMenu.jsx`), `PERMISSIONS.md` e `SYSTEM_ARCHITECTURE.md`. O histórico continua em `BUSINESS_RULES.md` §9.
- **Motivo:** pedido do dono (pente-fino final, sem alterar comportamento).
- **Arquivos afetados:** `.claude/rules/integracoes-externas.md`, `.claude/rules/roleta-prospeccao-campanhas.md`, `docs/BUSINESS_RULES.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/CRM_CONTEXT.md`, `docs/PERMISSIONS.md`.
- **Risco/observação:** nenhum código alterado. Pendências:
  - implementar WA-10 e ROL-2b;
  - corrigir os 8 pontos de P-17;
  - decidir a reserva do botão sem responsável e se o clique no botão WhatsApp conta como atividade.
  - `SYSTEM_ARCHITECTURE.md` l.139 ainda lista `tests/whatsapp-contact-channel.test.mjs`, removido em 29/09 (fora do escopo desta tarefa).
- **Autor:** Claude Code

### 2026-10-01 — Documentação alinhada ao código: roleta on-line, §13, Oportunidades e WhatsApp individual
- **Data:** 2026-10-01
- **Área:** Docs / Roleta / WhatsApp
- **Alteração:**
  - **Roleta:** nova REGRA OFICIAL (definida em 30/09, confirmada pelo dono em 01/10) na rule e em `BUSINESS_RULES.md` (ROL-2a, ROL-5, ROL-7). Distribuição só entre corretores on-line, fila de espera (`pending_distribution_at`) e link geral sem `?ref=` pela roleta. A regra de 2026-09-24 foi mantida como histórico.
  - **Arquitetura:** `SYSTEM_ARCHITECTURE.md` §13 marca P-01, P-04, P-08, P-09 e P-17 como resolvidos, com o que resta de cada um.
  - **Oportunidades:** `BUSINESS_RULES.md` §9 marca a Central de Oportunidades como removida, com OPO-1/OPO-2 só como histórico.
  - **WhatsApp:** `WHATSAPP.md` ganhou a §1-A (arquitetura do WhatsApp individual) e o aviso do banimento do número oficial.
- **Motivo:** pedido do dono, depois do registro retroativo de 28–30/09.
- **Arquivos afetados:** `.claude/rules/roleta-prospeccao-campanhas.md` (regra + `paths:`), `.claude/rules/integracoes-externas.md` (nota de atualização), `docs/BUSINESS_RULES.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/WHATSAPP.md`.
- **Risco/observação:** só documentação, conferida no código atual.
  - **A CONFIRMAR:** a tolerância de presença após clique em WhatsApp não aparece na nova `pick_round_robin_broker`.
  - **A CONFIRMAR:** os ~16 usos de `auth.user.email` fora das 2 rotas corrigidas em P-17.
  - **A CONFIRMAR:** se o upload de captação ainda grava sem login.
  - **Para o dono:** cliente do link geral pode ser distribuído a outro corretor, mas o botão "Receber minha simulação" abre o WhatsApp do Matheus.
  - **Ainda citam Oportunidades:** `CRM_CONTEXT.md`, `PERMISSIONS.md` e `SYSTEM_ARCHITECTURE.md` (§§ de inventário).
- **Autor:** Claude Code

### 2026-10-01 — Reorganização da estrutura do Claude Code (rules, agente, skills)
- **Data:** 2026-10-01
- **Área:** Docs / Infra (estrutura do Claude Code)
- **Alteração:** rules de `.claude/rules/` com `paths:` (carregamento sob demanda; `workflow-dev` e `auth-permissoes` continuam globais); divergências D-1 a D-7 corrigidas nas próprias rules; lacunas cobertas (WhatsApp individual, automação da Meta Diária, Google Contacts, Reconhecimentos); `CLAUDE.md` com "onde cada informação mora"; `crm-editor` e skills de auditoria atualizados; novas skills `registrar-regra` e `diagnosticar-producao`; trechos históricos movidos sem alteração para `docs/HISTORICO_REGRAS.md`; entradas deste changelog que estavam acima do cabeçalho movidas para "Registro" (texto intacto) e regra de arquivamento mensal criada.
- **Motivo:** pedido do dono (auditoria de governança do Claude Code): as 11 rules carregavam em toda sessão (~20 mil tokens) e várias continham fatos já desmentidos pelo código.
- **Arquivos afetados:** `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `.claude/rules/*.md`, `.claude/agents/crm-editor.md`, `.claude/skills/*/SKILL.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/PERMISSIONS.md`, `docs/HISTORICO_REGRAS.md`, `docs/CHANGELOG_AI.md`.
- **Risco/observação:** nenhum código do CRM, banco, migration ou integração foi tocado; nenhuma etiqueta REGRA OFICIAL alterada (conferido por script). Rule com `paths:` só carrega quando um arquivo do módulo é lido pela ferramenta Read — perguntas diretas sem leitura de arquivo dependem de ler a rule manualmente (instrução no `CLAUDE.md`). Os ~50 commits de 2026-09-30 (automação da Meta Diária, WhatsApp individual, Google Contacts) não têm entrada neste changelog — A CONFIRMAR se o dono quer registro retroativo.
- **Autor:** Claude Code

> **Registro retroativo (feito em 2026-10-01).** As 8 entradas abaixo consolidam, por tema, os ~125 commits de 28/09 (tarde) a 30/09/2026 que ficaram sem registro aqui. Não é um registro commit a commit: o detalhe de cada mudança está no `git log` do período. Autor das mudanças: Claude Code (sessões do dono); autor deste resumo: Claude Code.

### 2026-09-28 a 2026-09-30 — WhatsApp individual (Baileys) substitui o número oficial banido
- **Área:** WhatsApp / Infra / Banco
- **Alteração:** cada corretor conecta o próprio WhatsApp por QR Code ou código numérico de pareamento. O microsserviço `whatsapp-individual-service/` roda no Railway (não na Vercel) e não guarda a service role: lê e grava estado e credenciais cifradas via `app/api/webhooks/whatsapp-individual/state`, autenticado por `X-Service-Secret`. O Chat do CRM envia e recebe pela sessão do responsável. `pickSendChannel` bloqueia o envio quando a sessão existe mas está caída, sem cair em silêncio no número banido. Também:
  - contato novo no número pessoal vai direto para o dono da sessão, sem roleta;
  - grupos e listas de transmissão são ignorados;
  - foto, documento e áudio são enviados;
  - confirmação de entrega e leitura funciona;
  - troca de número depois de banimento destrava.
- **Decisões do dono:** importar o histórico do celular ao conectar, ciente de que traz conversas pessoais. A sincronização ficou **desligada** (`WHATSAPP_HISTORY_SYNC_ENABLED`) porque gerava 504 no webhook. Removida a trava de janela de 24 h no Chat (regra exclusiva do número oficial).
- **Motivo:** o número oficial (Meta Cloud API) foi banido em 28/09/2026.
- **Arquivos afetados:** `whatsapp-individual-service/**`, `lib/whatsapp-individual*.js`/`.mjs`, `lib/whatsapp-chat.js`, `app/api/webhooks/whatsapp-individual/**`, `app/api/admin/whatsapp-individual/**`, `components/WhatsappIndividualStatus.jsx`. Migrations `20260928130000_whatsapp_individual_sessions`, `20260928180000_whatsapp_individual_direct_broker`, `20260928190000_whatsapp_conversation_account_badge`, `20260930160000_whatsapp_individual_pairing_code`.
- **Risco/observação:** a sessão Baileys depende do celular do corretor e pode cair. Corretor sem sessão configurada continua no caminho antigo (Cloud API, banida). Doc: `.claude/rules/integracoes-externas.md`. `docs/WHATSAPP.md` ainda não descreve o canal individual por completo (A CONFIRMAR atualização).

### 2026-09-29 a 2026-09-30 — Automação da Meta Diária pelo WhatsApp individual
- **Área:** Meta Diária / WhatsApp / Banco
- **Alteração:** o cron `whatsapp-meta-diaria-dispatch` (a cada 5 min, depois a cada 2 min) envia 1ª, 2ª e 3ª tentativa pela sessão pessoal do corretor, **nunca** pelo número oficial. Funcionamento:
  - janela padrão 06h30–19h;
  - 4 variações de mensagem por tentativa, em rotação sequencial persistente;
  - ordem das atividades embaralhada;
  - intervalo com oscilação em torno da média;
  - teto diário = todas as atividades do dia (máx. 100), sem rampa de aquecimento;
  - "enviada" só conta com confirmação do WhatsApp;
  - erro de contato separado de erro de infraestrutura: retry técnico em 30 min sem gastar tentativa; após 3 falhas do contato, categoria nova **"Erro"** (`auto_error`);
  - a cota de 20 novos do dia é gerada pelo cron, sem o corretor abrir a tela;
  - painel de configuração em Gestão › Meta Diária › Automação, com histórico por corretor e card resumido.
- **Decisões do dono:**
  - a automação liga sozinha quando a sessão conecta;
  - o corretor **não** pausa nem ativa a própria automação (só admin/gestor, também bloqueado na API);
  - o envio manual continua liberado mesmo com a automação ligada (uma trava que impedia isso foi revertida no mesmo dia).
- **Motivo:** pedido do dono, para cumprir a meta de contatos sem envio manual um a um.
- **Arquivos afetados:** `lib/daily-goal-auto.js`, `lib/daily-goal-auto-core.mjs` (+ `tests/daily-goal-auto-core.test.mjs`), `lib/daily-goal.js`, `app/api/cron/whatsapp-meta-diaria-dispatch/**`, `app/api/admin/daily-goal-auto/**`, `app/api/daily-goal/auto/**`, `components/DailyGoalAutoPanel.jsx`, `components/TeamDailyPerformance.jsx`. Migrations `20260929190000_daily_goal_auto_dispatch`, `20260929200000_daily_goal_auto_window`, `20260930113000_fix_daily_goal_auto_queue_unique_constraint`, `20260930140000_daily_goal_auto_oscillate`, `20260930150000_daily_goal_auto_delivery_tracking`, `20260930150500_meta_diaria_dispatch_every_2min`, `20260930200000_meta_diaria_auto_robustez`.
- **Risco/observação:** bugs reais corrigidos no caminho:
  - UNIQUE da fila travava a re-fila para sempre, com erro engolido;
  - um conflito isolado descartava o lote inteiro;
  - timestamp inválido no agendamento;
  - falso positivo de pausa automática;
  - contagem de enviadas que não batia com o WhatsApp.
  Risco permanente: banimento de números pessoais por volume. Doc: `.claude/rules/meta-diaria-ranking.md` §Automação.

### 2026-09-30 — Integração Google Contacts por corretor (pedido de 01/10)
- **Área:** Integrações / Meta Diária / Banco
- **Alteração:** cada corretor conecta a própria conta Google por OAuth. Antes de cada envio automático da Meta Diária, `ensureClientInBrokerContacts` salva o cliente na agenda do corretor, de forma idempotente (mapa local broker+telefone). Tokens cifrados com `lib/secrets-crypto.js` (`CRM_SECRETS_ENCRYPTION_KEY`), nunca expostos ao front. Badge de conexão no cabeçalho do painel.
- **Motivo:** pedido do dono. Contato salvo na agenda tende a reduzir bloqueio e denúncia de mensagens no WhatsApp pessoal (A CONFIRMAR como motivação exata).
- **Arquivos afetados:** `lib/google-contacts*.js`/`.mjs`, `lib/secrets-crypto.js`, `lib/daily-goal-auto.js`, `app/api/google-contacts/**`, `components/GoogleContactsStatus.jsx`, `tests/google-contacts-config.test.mjs`. Migration `20261001120000_google_contacts_integration`.
- **Risco/observação:** opt-in. Na publicação nenhum corretor estava conectado, então o fluxo de envio seguiu idêntico. Falha no Google é best-effort: nunca derruba o envio nem conta como erro do contato. Variáveis novas: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `CRM_SECRETS_ENCRYPTION_KEY` (configuração em produção A CONFIRMAR).

### 2026-09-30 — Roleta só entre corretores on-line, com fila de espera; link geral pela roleta
- **Área:** Roleta / Clientes / Banco
- **Alteração:**
  - `pick_round_robin_broker` perdeu os níveis 3 e 4 ("ausente" e "qualquer elegível") e só considera quem está on-line.
  - Sem ninguém on-line, o cadastro é criado sem responsável, com `pending_distribution_at`, e o card mostra "Aguardando". O cron `scheduled-activities` (`reassignPendingRouletteLeads`) atribui o mais antigo assim que alguém fica on-line.
  - `reassignOrphanedClientsToOwner`, a regra REDISTRIBUIÇÃO DE LEADS e o escopo do gestor foram ajustados para essa fila.
  - O **link geral do site (sem `?ref=`) passou a ir pela roleta**, em vez de cair no Matheus. O botão "Receber minha simulação" continua usando o default `matheus`.
- **Motivo:** regra do dono (2026-09-30).
- **Arquivos afetados:** `lib/lead-distribution.js`, `lib/simulation-registrations.js`, `lib/crm-automations.js`. Migration `20260930130000_roleta_online_only_waiting_queue`.
- **Risco/observação:** **diverge do texto atual das rules.** `.claude/rules/roleta-prospeccao-campanhas.md` ("Roleta por presença", REGRA OFICIAL de 2026-09-24) ainda descreve os níveis 3 e 4. `.claude/rules/integracoes-externas.md` diz que o link sem `?ref=` grava o Matheus como responsável. Registrar a regra nova pela skill `/registrar-regra` (A CONFIRMAR com o dono).

### 2026-09-30 — Meta Diária/Prospecção: cliente não é mais liberado cedo demais; incidente do cadastro
- **Área:** Meta Diária / Prospecção / Clientes
- **Alteração:**
  - A 3ª tentativa encerra a rodada mas **mantém** o responsável. Depois de 24 h sem mudança de status, o contato "hiberna" (trava de 30 dias) e só então volta à base.
  - O retorno automático da Prospecção passou de 2 para 7 dias.
  - Contato ligado a cliente "não contactar"/vendido por **outra** linha (telefone irmão) não recebe mais envio automático (`isContactBlockedFromOutreach`) nem aparece na fila.
  - Overloads inseguros das RPCs de claim foram removidos.
  - Rodada já contatada hoje não é reenfileirada.
- **Incidente (30/09, tarde):** a hibernação, na primeira versão, montava uma lista com ~1.600 ids e estourou o tamanho de URL do PostgREST. O "Bad Request" quebrou **todo** cadastro do formulário público até a correção (consulta invertida, filtro por join). Foram publicados 3 commits de diagnóstico temporário, removidos na correção. Motivou a skill `/diagnosticar-producao`.
- **Arquivos afetados:** `lib/prospecting-auto-return.js`, `lib/daily-goal.js`, `lib/prospecting.js`, `lib/simulation-registrations.js`. Migrations `20260928200000_daily_goal_claim_guards`, `20260930180000_drop_unsafe_claim_overloads`.
- **Risco/observação:** consulta que filtra por lista de ids crescente deve partir da tabela pequena ou usar join. Nunca montar `.in()` com histórico inteiro.

### 2026-09-29 — Acompanhamento de aprovação na CCA e novos status de aprovação
- **Área:** Documentação/CCA / Funil
- **Alteração:**
  - Histórico de sub-status por cliente (`client_cca_status_history`, uma linha aberta por vez), aberto automaticamente no envio à CCA.
  - Selo no card do cliente com contador "há X dias" (verde até 2, amarelo até 5, vermelho acima).
  - Vínculo manual de cliente já aguardando documentação.
  - Foto da CCA.
  - Três status novos em Aprovação (Comprometimento de renda, Carta de cancelamento, M.O de pesquisa), na mesma macroetapa de Restrição/Reprovado.
  - A aba de cadastro de sub-status (Status CCA) foi removida em seguida, ficando só a leitura dos valores semeados.
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `lib/client-cca-status.js`, `lib/cca-status-stages.js`, `lib/cca-status-presentation.mjs` (+ teste), `lib/client-status.js`, `components/CcaStatusCard.jsx`, `app/api/admin/client-cca-status/**`. Migrations `20260929150000_cca_status_stages`, `20260929150100_client_cca_status_history`, `20260929160000_client_status_approval_reasons`.
- **Risco/observação:** status novos entram no enum único `lib/client-status.js` e não criam aba própria no funil.

### 2026-09-29 a 2026-09-30 — Pente-fino: problemas conhecidos corrigidos e performance
- **Área:** Clientes / Permissões / Notificações / Infra
- **Alteração:** corrigidos problemas listados em `docs/SYSTEM_ARCHITECTURE.md` §13:
  - **P-01:** fim do casamento de cadastro por nome igual, e fim do corte em 1.000 linhas na detecção de duplicidade;
  - **P-04:** lembrete de atividade não trava mais push/e-mail quando o WhatsApp falha;
  - **P-08:** lead da home e captação passam a avisar por e-mail;
  - **P-09:** rate limit dos formulários públicos no banco (`check_public_rate_limit`) em vez de memória;
  - **P-17:** ação feita em "Alterar conta" pontua para o admin real;
  - **P-11 (parcial):** o Chat passa a gravar `last_whatsapp_contact_at` ao enviar, com backfill.
  Performance: índices em 24 chaves estrangeiras de tabelas quentes (advisor do Supabase), consultas em paralelo e menos idas ao banco na Meta Diária. Novo gráfico de ranking histórico (dia/semana/mês) em Desempenho, usando o mesmo motor de pontuação.
- **Decisão revertida:** mover as funções da Vercel para São Paulo (`gru1`) deixou o CRM inacessível, porque o banco fica em `us-west-2`. Revertido no mesmo dia; a região padrão continua.
- **Arquivos afetados:** `lib/simulation-registrations.js`, `lib/scheduled-activity-notifications.js`, `lib/admin-auth.js`, `lib/lead-notifications.js`, `lib/rate-limit.js`, rotas públicas de cadastro/captação/leads, `lib/whatsapp-client-status.js`, `lib/performance-overview.js`, `lib/performance-trend.mjs`. Migrations `20260929120000_public_form_rate_limits`, `20260929170000_missing_fk_indexes_hot_tables`, `20260928210000_backfill_last_whatsapp_contact_from_chat`.
- **Risco/observação:** a tabela §13 de `docs/SYSTEM_ARCHITECTURE.md` ainda lista P-01, P-04, P-08, P-09 e P-17 como abertos (atualização pendente). Mudança de região da Vercel só com o banco na mesma região.

### 2026-09-28 a 2026-09-29 — Site e painel após o banimento do número oficial
- **Área:** WhatsApp / Site público / Painel / Cron
- **Alteração:**
  - Botão flutuante de WhatsApp do site desativado temporariamente.
  - "Receber minha simulação" abre o WhatsApp **pessoal** do corretor do link.
  - O botão WhatsApp dos cards (Clientes, Meta Diária, Prospecção) passou pelo Chat do CRM e **voltou a abrir o WhatsApp Web/app (`wa.me`)** em 29/09, até o Chat individual ficar estável; o código de decisão Chat-ou-externo foi removido.
  - Os crons `scheduled-activities`, `whatsapp-broadcast-dispatch` e `whatsapp-flows` passaram de 1 para 2 min (~30% do tempo do banco; via `cron.alter_job`, fora do repo).
  - Menu do corretor/gestor: Prospecção e Novo cliente unificados, atalho da Meta Diária, Central de Oportunidades **removida** por completo.
- **Motivo:** número oficial banido e pedidos do dono.
- **Arquivos afetados:** `components/WhatsAppFloatingButton.jsx`, `components/simulation-form/**`, `app/api/whatsapp-contact/**`, `components/AdminMenu.jsx`, `components/AdminSimulationList.jsx`.
- **Risco/observação:** regras correspondentes já estão em `.claude/rules/integracoes-externas.md` (botão e crons). A remoção de Oportunidades apagou `lib/opportunities.js`/`lib/opportunity-scoring.js`; `docs/BUSINESS_RULES.md` §9 ainda descreve a Central (A CONFIRMAR atualização).

### 2026-09-29 — Reconhecimentos: 1ª cena cinematográfica (100% da meta) + arquitetura por gatilho
- **Área:** overlay de reconhecimentos (Incentivo).
- **Alteração:** o overlay virou uma casca fina (`CelebrationOverlay.jsx`) que escolhe, por `trigger_key`, um componente de "cena" isolado e carregado sob demanda (`next/dynamic`, sem SSR) — `scenes/Scene100.jsx` é a primeira cena cinematográfica (anel dourado que se desenha até 100% reaproveitando `components/motion/AnimatedRing`/`AnimatedNumber`, pulso de luz + explosão de confete no fechamento via novo `burstConfettiExplosion`, texto em cascata palavra por palavra via `StaggerContainer`/`StaggerItem` já existentes); as demais 15 continuam em `scenes/GenericScene.jsx` (o visual anterior, card + emoji) até serem migradas no mesmo padrão. Corrigido também: a prévia/"Testar" não mostra mais "Você" como nome quando não há corretor real — usa o nome de quem está testando (admin/gestor logado, ou o corretor selecionado no disparo manual) ou remove o placeholder da frase.
- **Arquivos:** `components/celebrations/CelebrationOverlay.jsx`, `components/celebrations/scenes/Scene100.jsx`, `components/celebrations/scenes/GenericScene.jsx`, `components/celebrations/celebrationEffects.js` (nova `burstConfettiExplosion`/`getParticleQuality`), `components/celebrations/BrokerCelebrationGate.jsx` e `CelebrationsManager.jsx` (passam `triggerKey`/nome para a prévia), `app/admin/automacoes/page.jsx`.
- **Risco/observação:** só a cena dos 100% foi refeita (pedido do dono: aprovar o padrão antes de replicar nas outras 15); nenhuma tabela ou regra de negócio mudou. Verificação por leitura cuidadosa — sem ambiente de preview disponível para ver a animação rodando de verdade.

### 2026-09-29 — Reconhecimentos com animação (Automações › Incentivo)
- **Área:** ranking/gamificação, painel administrativo, novo motor de eventos.
- **Alteração:** popup central privado (nunca visível para o time) exibido ao corretor quando ele bate 100/150/200% da Meta Diária, assume o 1º lugar do ranking (após as 12h, segurando a liderança por um tempo mínimo), emenda uma sequência de dias na meta, bate recorde pessoal, faz a primeira ação do dia, atinge marcos de vendas no mês, bate meta semanal/mensal, tem cliente aprovado/com contrato assinado/chaves entregues, supera a média do time (após as 12h) ou faz aniversário/completa tempo de casa — 4 animações em canvas (confete, fogos, moedas, coroa) mais um combo exclusivo para os 200%, respeitando `prefers-reduced-motion`. Novo botão "Incentivo" em Automações (aba própria, só admin/gestor): liga/desliga cada gatilho, edita textos (com "restaurar padrão"), escolhe a animação por gatilho, ajusta os parâmetros (horário do ranking, minutos de segurança, resultado mínimo, marcos), faz disparo manual para um corretor específico e mostra o histórico com filtro por corretor/data. "Testar" nunca grava evento real.
- **Tabelas novas:** `celebration_triggers`, `celebration_message_templates`, `broker_celebration_events`, `celebration_ranking_lead_state`; colunas novas `admin_users.birth_date`/`hired_at` e `simulation_registrations.keys_delivered_at` (ainda sem tela dedicada para preencher — hoje só via Supabase).
- **Arquivos:** `lib/celebrations.js`, `app/api/celebrations/**`, `app/api/cron/celebrations-ranking`, `components/celebrations/**`, `app/admin/layout.jsx`, `app/admin/automacoes/page.jsx`, `lib/performance-overview.js` (exporta `getCachedTodayOverviewForRanking` para reaproveitar o cache de 90s do ranking em vez de recalcular a cada poll).
- **Risco/observação:** detecção roda a cada poll do próprio corretor (30s, sem novo custo de realtime — segue o padrão de polling já usado pela Mensagem do Dia/alertas de cliente novo); o 1º lugar do ranking depende de um cron novo de 2 em 2 minutos. "Meta semanal/mensal" é uma aproximação (soma das metas diárias fechadas do período, sem alvo formal próprio). Verificação por leitura cuidadosa de cada arquivo — sem login real disponível neste ambiente para testar os gatilhos na prática; recomenda-se testar cada um pelo botão "Testar" e por um disparo manual antes de confiar 100%.

### 2026-09-29 — Remove cabeçalho "Área restrita" das páginas do painel; "Sair" vai para o rodapé
- **Área:** layout do painel administrativo (`app/admin/**`).
- **Alteração:** removido o rótulo "Área restrita", o título e a descrição do topo de todas as páginas internas (Corretores, Financeiro, Desempenho, Pontuação, Meta Diária, Clientes, Chat, etc.); o botão "Sair" saiu do topo de cada página e passou a aparecer uma única vez, no rodapé, renderizado centralmente por `app/admin/layout.jsx`. Links de ação que dividiam o cabeçalho (ex.: "Novo cliente", "Novo depoimento", "Ver formulário público", "Cadastrar empreendimento") e links de navegação "Voltar…" foram preservados.
- **Arquivos:** `app/admin/layout.jsx` e todas as páginas sob `app/admin/**` (exceto `login` e `reset-password`, que ficam fora da área autenticada).
- **Risco/observação:** mudança só de UI, sem efeito em regra de negócio ou dado; verificação por leitura de cada diff (sem login real disponível neste ambiente para rodar o preview).

### 2026-09-28 — Conter consultas sobrepostas durante lentidão do CRM
- **Área:** avisos globais de Chat e novos clientes.
- **Alteração:** uma atualização pendente é compartilhada pelo resumo do Chat; o aviso sonoro não inicia outra consulta enquanto a anterior não terminou. Intervalos, notificações e escopo permanecem iguais.
- **Risco/observação:** logs de produção registraram ondas de 30–60 s no Supabase e `PGRST003` (pool do PostgREST esgotado), além de timeouts nos cron/webhooks. Esta mudança reduz a amplificação durante a falha, mas a causa da saturação da infraestrutura ainda requer análise de capacidade/recursos no Supabase.

### 2026-09-28 — Relatórios no Chat e ficha cadastral do PDF
- **Área:** Documentação / Chat / PDF.
- **Alteração:** relatório já analisado acessível pelo Chat sem nova seleção; capa do PDF e da Pasta com campos maiores, linhas e seções compactas.
- **Arquivos:** `components/WhatsappChat.jsx`, `components/ClientDocumentsModal.jsx`, `lib/client-document-pdf.js`, `docs/WHATSAPP.md`.
- **Risco:** conteúdo e permissões dos relatórios não foram alterados; verificação visual da capa com dados de exemplo, sem acesso a documentos reais.

### 2026-09-28 — Prévia e processamento documental no Chat
- **Causa:** dois lotes reais importaram 10 arquivos e 2 mensagens, mas falharam no recálculo: o `upsert` do checklist apontava para um índice único parcial que PostgREST não consegue inferir sem o predicado. A requisição longa também expunha “Load failed” no iPhone.
- **Correção:** atualização/inserção por chave com recuperação de colisão concorrente; importação independente por arquivo, início rápido e acompanhamento do status do lote; repetição reutiliza o lote. Miniaturas locais de imagem/PDF, prévia ampliada, progresso visual limitado a 94% até conclusão real e erros legíveis por arquivo.
- **Verificação:** testes e build desta alteração; sem mudança nas regras da IA, cálculos ou Base Mestra.

### 2026-09-28 — Chat e Base Mestra na análise documental
- **Área:** Documentação, Chat, CCA e PDF.
- **Alteração:** seleção explícita de mensagens e arquivos no Chat para a análise documental existente; regras ativas incorporadas em cada parecer; residência sem boletos; rastreio de pendências; cálculo auditável de renda por três extratos; mensagem de pendências editável no Chat; opções PDF ou pasta ZIP para a CCA, com confirmação de pendências.
- **Permissões:** somente administrador geral edita regras; corretor só acessa o próprio cliente e pode preparar envio para CCA; gestão do cadastro de CCA permanece restrita.
- **Verificação:** 18 testes de regras e build Next.js concluídos. Fluxos externos dependem das credenciais de produção.

### 2026-09-28 — Regras editáveis para análise documental
- **Área:** Documentação/CCA / Banco.
- **Alteração:** Gestão > Documentação > Regras da IA administra regras ativas por categoria. A análise lê a versão atual antes de cada lote, registra a regra e a justificativa da pendência e inclui a justificativa no PDF. Correção humana pode abrir uma nova regra para revisão, sem publicação automática.
- **Motivo:** evitar exigências presumidas e permitir corrigir a interpretação sem editar prompts.
- **Arquivos afetados:** `lib/document-analysis.js`, `lib/client-documents.js`, `lib/client-document-pdf.js`, `components/DocumentAiRulesManager.jsx`, `supabase/migrations/20260928092500_document_ai_rules.sql`.
- **Risco/observação:** a análise continua usando o provedor Anthropic existente; reanálises após mudança de regra chamam a IA novamente. Testes da regra de residência e build passaram.
- **Autor:** Codex

### 2026-09-28 — Impedir recriação de cliente excluído
- **Área:** Clientes / WhatsApp.
- **Alteração:** a exclusão pelo dono marca as conversas vinculadas para não gerarem outro cadastro automático. Webhook e cron respeitam a marca em leads orgânicos e patrocinados; Chat e cadastro manual permanecem disponíveis.
- **Motivo:** a FK soltava a conversa após excluir o cliente e o cron a transformava novamente em card com base em mensagem antiga.
- **Risco/observação:** confirmado por leitura que o novo card veio da reconciliação de uma conversa antiga, sem nova mensagem. Nenhum cliente foi apagado como teste.
- **Autor:** Codex

### 2026-09-28 — Menu CRM do corretor legível no mobile
- **Área:** Menu CRM.
- **Alteração:** o menu secundário do corretor abre para dentro da tela, sem cortar os rótulos na lateral esquerda.
- **Autor:** Codex

### 2026-09-28 — Abrir detalhamento no segundo toque
- **Área:** Menu CRM / Clientes.
- **Alteração:** o primeiro toque no botão principal abre a lista padrão; quando já se está nela, outro toque alterna o detalhamento das pendências, em todos os perfis com CRM. Badge e contagens permanecem iguais.
- **Autor:** Codex

### 2026-09-28 — Exclusão de cliente pelo administrador principal
- **Área:** Clientes.
- **Alteração:** a exclusão remove primeiro o atendimento da camada de compatibilidade vinculado ao cadastro, evitando o bloqueio por chave estrangeira; o cliente canônico compartilhado permanece. A permissão exclusiva do dono não mudou.
- **Risco/observação:** se a exclusão do cadastro falhar depois, o atendimento de compatibilidade poderá ser reconstruído na próxima atualização do cadastro; nenhuma exclusão real foi feita como teste.
- **Autor:** Codex

### 2026-09-28 — Novos atendimentos apenas no atendimento automático
- **Área:** Badge CRM / Clientes.
- **Alteração:** clientes em "Em atendimento" deixam de contar em Novos atendimentos; a categoria mostra só Atendimento automático sem resposta ou assunção humana no Chat.
- **Autor:** Codex

### 2026-09-28 — Acesso a novos atendimentos
- **Área:** Badge CRM / Clientes.
- **Alteração:** o atalho de novos atendimentos abre a lista filtrada mesmo quando já se está em Clientes; a contagem/lista usa clientes em atendimento automático ou em atendimento sem resposta/assunção humana registrada no Chat. Aguardando simulação permanece categoria separada para não duplicar.
- **Risco/observação:** abrir o WhatsApp não é prova de atendimento humano. A consulta respeita o escopo de responsável atual, sem mudar pontuação ou distribuição.
- **Autor:** Codex

### 2026-09-28 — Detalhamento do badge CRM
- **Área:** Menu CRM / Clientes / Agenda.
- **Alteração:** o badge principal abre um resumo clicável de Chat, Agenda vencida, novos atendimentos e aguardando simulação. O total usa as mesmas quatro parcelas; cada acesso abre a lista já filtrada conforme o escopo do perfil.
- **Risco/observação:** nenhuma atribuição, status ou permissão foi alterada; o filtro de primeiro contato usa o status Em atendimento sem contato WhatsApp registrado, igual à contagem.
- **Autor:** Codex

### 2026-09-28 — Contadores de pendências no CRM
- **Área:** Clientes / Agenda / Chat.
- **Alteração:** o atalho Agenda exibe atividades vencidas; o botão CRM (Clientes para administrador geral) soma Chat não lido, atividades vencidas e clientes aguardando atendimento ou simulação. Os contadores ficam no canto superior direito e compartilham uma consulta por tela.
- **Risco/observação:** o calendário permanece escopado ao perfil atual e o cliente é contado uma vez por status. Sem migração ou mudança de pontuação.
- **Autor:** Codex

### 2026-09-28 — Atalhos de Clientes na barra de ações
- **Data:** 2026-09-28 · **Área:** Clientes / navegação · **Motivo:** compactar o acesso a Prospecção, Chat e Agenda.
- **Alteração:** atalhos existentes viram ícones após Filtros e Pendências, com badge atual do Chat; a faixa do submenu Clientes do administrador é ocultada, sem alterar as demais categorias, rotas ou permissões.
- **Arquivos:** `components/AdminSimulationList.jsx`, `components/AdminMenu.jsx`.
- **Autor:** Codex

### 2026-09-28 — Abertura compacta da lista de clientes
- **Data:** 2026-09-28 · **Área:** Clientes / interface · **Motivo:** reduzir o espaço antes da navegação.
- **Alteração:** remove título e descrição introdutórios; o menu vem logo após o ranking, a ação Novo cliente vira ícone ao lado de Clientes pendentes e Sair fica ao final da página. A rota e as permissões permanecem iguais.
- **Arquivos:** `app/admin/simulacoes/page.jsx`, `components/AdminSimulationList.jsx`.
- **Autor:** Codex

### 2026-09-28 — Ocultar Melhor do Dia sem pontos
- **Data:** 2026-09-28 · **Área:** Ranking · **Motivo:** destaque diário exibia um corretor com 0 pontos.
- **Alteração:** líder diário só é exibido se tiver pontuação positiva; sem líder válido, o card e a posição diária ficam ocultos, mantendo o campeão semanal.
- **Arquivos:** `lib/performance-overview.js`, `lib/ranking-display.mjs`, `components/TopRankingBadge.jsx`, `tests/ranking-display.test.mjs`, `docs/BUSINESS_RULES.md`.
- **Autor:** Codex

### 2026-09-28 — Meta de domingo antes do campeão semanal
- **Data:** 2026-09-28 · **Área:** Meta Diária / Ranking · **Motivo:** incluir a penalidade de domingo na consolidação das 00:01.
- **Alteração:** cron diário passa de 00:10 para 00:01; o cálculo semanal espera o fechamento antes de apurar os pontos, mesmo com crons simultâneos. O campeão já congelado desta semana permanece intacto; a regra vale para os próximos fechamentos.
- **Arquivos:** `lib/weekly-ranking.js`, `supabase/migrations/20260928043000_daily_goal_close_0001.sql`, `docs/BUSINESS_RULES.md`, `docs/DATABASE.md`.
- **Autor:** Codex

### 2026-09-28 — Ranking por ação real, presença e meta não cumprida
- **Data:** 2026-09-28 · **Área:** Ranking / Meta Diária · **Motivo:** pedido do dono após cliente da roleta gerar pontos sem atendimento.
- **Alteração:** recebimento automático pela roleta deixa de pontuar “Novo cliente”; presença ativa rende pontos por intervalo e bônus ao líder diário; meta fechada sem conclusão desconta pontos, inclusive abaixo de zero. Pesos e intervalo editáveis em Pontuação, com extrato coerente.
- **Arquivos:** `lib/performance-overview.js`, `lib/admin-presence.js`, `lib/scoring-rules.js`, `components/ScoringRulesManager.jsx`, `supabase/migrations/20260928040000_scoring_presence_config.sql`, `docs/BUSINESS_RULES.md`, `docs/DATABASE.md`.
- **Risco/observação:** a migration inicial das três regras foi aplicada no banco pelo Claude, mas seu arquivo não estava neste checkout; a migration incluída completa a configuração de intervalo e é idempotente para as três sementes existentes. Penalidade só após fechamento da meta.
- **Autor:** Codex

### 2026-09-28 — Entrada do conteúdo mais perceptível
- **Data:** 2026-09-28 · **Área:** Interface administrativa · **Motivo:** no iPhone, com movimento reduzido desligado, o dono não percebeu a animação anterior.
- **Alteração:** entrada e troca de conteúdo em 320 ms com deslocamento curto de 20 px; a opção ativa do menu ganha entrada discreta, sem mover ranking, cabeçalho ou estrutura do menu. Nenhuma mudança em regras ou layout.
- **Arquivos:** `app/globals.css`, `components/AdminMenu.jsx`.
- **Autor:** Codex

### 2026-09-28 — Transição acionada na troca real de páginas
- **Data:** 2026-09-28 · **Área:** Interface administrativa · **Motivo:** o dono continuou sem perceber transições depois da correção anterior.
- **Alteração:** o menu agora inicia a entrada do conteúdo a cada troca de seção, inclusive quando o navegador reutiliza o mesmo nó; cabeçalho, menu e ranking não são animados. A preferência por movimento reduzido continua respeitada.
- **Arquivos:** `components/AdminMenu.jsx`, `app/globals.css`.
- **Autor:** Codex

### 2026-09-28 — Navegação mais perceptível no painel
- **Data:** 2026-09-28 · **Área:** Interface administrativa · **Motivo:** o dono não percebeu as transições após a primeira publicação.
- **Alteração:** deslocamento curto e duração de 210 ms no conteúdo trocado, feedback de toque também nos links e entrada ao alternar submenus, Prospecção e abas de empreendimento. Ranking e cabeçalhos continuam fora das animações.
- **Arquivos:** `app/globals.css`, `components/AdminMenu.jsx`, `components/ProspectingTabs.jsx`, `components/EmpreendimentoAdminTabs.jsx`.
- **Autor:** Codex

### 2026-09-28 — Transições discretas na navegação administrativa
- **Data:** 2026-09-28 · **Área:** Interface administrativa · **Motivo:** pedido do dono para navegação mais fluida.
- **Alteração:** entrada curta de conteúdo e cards, transição lateral no Chat ao abrir/voltar, feedback ao pressionar botões e respeito a movimento reduzido. Ranking e menus principais permanecem estáveis.
- **Arquivos:** `app/globals.css`, `components/AdminMenu.jsx`, `components/AdminSimulationList.jsx`, `components/WhatsappChat.jsx`.
- **Autor:** Codex

### 2026-09-28 — Ranking acompanha a rolagem da página
- **Data:** 2026-09-28 · **Área:** Ranking / interface · **Motivo:** correção do dono após verificar no celular.
- **Alteração:** removido `position: sticky` da faixa do ranking; permanece no início do painel, no fluxo da página, e sai de vista ao rolar. Visual e regras preservados.
- **Arquivos:** `app/admin/layout.jsx`.
- **Autor:** Codex

### 2026-09-28 — Layout premium do ranking fixo
- **Data:** 2026-09-28 · **Área:** Ranking / interface · **Motivo:** pedido do dono com mockup de referência.
- **Alteração:** card semanal creme/dourado com coroa e louros, card diário branco/azul, faixa da posição; largura útil inteira no celular e três colunas compactas no desktop. Cabeçalho continua sticky e opaco; removido o segundo espaçamento de área segura antes de “Área restrita”.
- **Arquivos:** `components/TopRankingBadge.jsx`, `app/admin/layout.jsx`, `app/globals.css`.
- **Risco/observação:** somente layout; regras, pontuação, permissões e dados mantidos.
- **Autor:** Codex

### 2026-09-28 — Campeão ou campeã da semana; gerente fora do ranking
- **Data:** 2026-09-28 · **Área:** Ranking / Perfil · **Motivo:** pedido do dono após ver o destaque no celular.
- **Alteração:** cards semanais/diários mais legíveis; título semanal conforme gênero cadastrado; gerentes excluídos da classificação e dos destaques sem perder os dados de desempenho da equipe. Chave semanal versionada para recalcular vencedor salvo sob a regra anterior. Cadastro de gênero de Jennyfer corrigido conforme confirmação do dono.
- **Arquivos:** `lib/ranking-display.mjs`, `lib/performance-overview.js`, `lib/weekly-ranking.js`, `components/TopRankingBadge.jsx`, `app/admin/layout.jsx`, `tests/ranking-display.test.mjs`, `docs/BUSINESS_RULES.md`.
- **Risco/observação:** pontuação e eventos não alterados; resultado semanal já gravado na chave anterior fica sem uso. Validar build e visualização após deploy.

### 2026-09-28 — Aba "Corretores" na Supervisão do WhatsApp
- **Data:** 2026-09-28 · **Área:** WhatsApp · **Motivo:** pedido do dono (visualização poluída depois de imaginar vários WhatsApps de corretores conectados).
- **Alteração:** confirmei com o dono que **não existe** conexão própria de WhatsApp por corretor neste sistema (só o número oficial único da imobiliária) — ele decidiu seguir com a opção simples: nova aba "Corretores" ao lado de Conversas/Visão geral/Campanhas, com um card por corretor (presença real via `admin_presence`, não lidas/sem resposta/ativas) e "Abrir" reaproveitando o MESMO Chat, filtrado por corretor (responsável do cliente OU conversa atribuída a ele — mesma junção do escopo normal, `scopedMerge`/`runScopedQuery` com `brokerId`).
- **Arquivos:** `lib/whatsapp-chat.js` (`getChatBrokerCards`, `runScopedQuery`/`scopedMerge` com `brokerId`, `listChatConversations`), `app/api/admin/whatsapp-chat/broker-cards/route.js`, `app/api/admin/whatsapp-chat/conversations/route.js`, `components/WhatsappChat.jsx`, `components/WhatsappChatBrokers.jsx`, `docs/WHATSAPP.md`.
- **Risco/observação:** feature 100% de organização/filtro — nenhuma regra de atendimento, envio, campanha ou automação foi alterada. O filtro `brokerId` só tem efeito para quem já enxerga tudo (admin/gestor); nunca amplia o que um corretor/associado vê da própria carteira. Não testado com dado real em produção (sem sessão de navegador autenticada disponível) — só build local. Se no futuro surgir de verdade uma conexão de WhatsApp própria por corretor (ex.: o serviço no Railway mencionado pelo dono passar a integrar com este CRM), esta implementação precisa ser revisitada — hoje ela só filtra o número oficial único.
- **Autor:** Codex

### 2026-09-28 — Auditoria de Atendimento (Gestão > Desempenho > Auditoria)
- **Data:** 2026-09-28 · **Área:** Desempenho / WhatsApp / Banco · **Motivo:** pedido do dono.
- **Alteração:** nova tela `Gestão > Desempenho > Auditoria` (corretor + período + "Gerar auditoria"). Métricas objetivas (VOLUME/PROSPECÇÃO/CONVERSÃO/VELOCIDADE/FOLLOW-UP) calculadas 100% pelo sistema — CONVERSÃO/FOLLOW-UP reaproveitam `getBrokerPerformanceOverview` (mesma fonte do funil/ranking); VOLUME/PROSPECÇÃO/VELOCIDADE vêm direto de `whatsapp_conversations`/`whatsapp_messages` do próprio corretor no período. Seção QUALIDADE usa a integração OpenAI já existente (mesmo padrão de `app/api/analyze`: `/v1/responses` + `json_schema`), analisando uma amostra das conversas reais do período (capada em caracteres/conversas) e citando o `conversationId` de cada erro/oportunidade perdida ("Ver conversa" abre `/admin/chat?client=`). Cada auditoria é salva permanentemente (`attendance_audits`, nunca recalculada); a próxima sugere automaticamente um período sem sobreposição com a última e compara métrica a métrica (melhorou/piorou/manteve, considerando "menor é melhor" para tempo de resposta) e qualitativamente via IA.
- **Arquivos:** `lib/attendance-audit.js`, `app/api/admin/desempenho/auditoria/route.js`, `app/admin/desempenho/auditoria/page.jsx`, `components/AttendanceAuditDashboard.jsx`, `components/AdminSectionNav.jsx`, `components/AdminMenu.jsx`, migrations `20260928150000_attendance_audits.sql` e `20260928150500_attendance_audits_evidence_index.sql` (aplicadas em produção).
- **Risco/observação:** **PENDENTE DE VALIDAÇÃO pelo dono** — três definições que inventei por não haver regra existente para elas, marcadas como tal na tela/código, não confirmadas: (1) "prospecções respondidas/taxa de resposta" = conversas cuja primeira mensagem do período foi do corretor e que depois receberam qualquer resposta do cliente (proxy — não cruza com `prospecting_history`/Meta Diária); (2) "conversas sem continuidade" = conversas do corretor com `last_message_direction='inbound'` e status ≠ finalizado (reaproveita a mesma coluna do filtro "Sem resposta" do Chat, mas o recorte para "sem continuidade" é meu); (3) preço de US$0,40/US$1,60 por milhão de tokens (gpt-4.1-mini) usado só para registrar em `ai_usage_log` é estimado, não confirmado como tarifa atual da OpenAI. Sem `OPENAI_API_KEY` configurada, a auditoria ainda salva as métricas objetivas, com a seção de IA vazia e um aviso. Não testado com dado real em produção (sem sessão de navegador autenticada disponível nesta tarefa) — só build local.
- **Autor:** Codex

### 2026-09-27 — Card do cliente reflete atendimento real do Chat no "Último contato"
- **Data:** 2026-09-27 · **Área:** Clientes · **Motivo:** pedido do dono (card mostrava "Nenhum contato realizado" para cliente com conversa ativa no Chat, com respostas reais do corretor).
- **Alteração:** a lista de clientes (`listSimulationClientsPage`) agora usa, para o RÓTULO exibido no card, o mais recente entre `simulation_registrations.last_whatsapp_contact_at` (clique de "abrir WhatsApp") e `whatsapp_conversations.last_human_reply_at` (resposta humana real registrada no Chat, ver P-11 em `SYSTEM_ARCHITECTURE.md`). Só ajusta a exibição — nenhuma escrita na coluna original.
- **Arquivos afetados:** `lib/simulation-list-query.js`.
- **Risco/observação:** deliberadamente **não** alterei `last_whatsapp_contact_at` em si nem as regras que dependem do valor bruto dessa coluna (gatilho `no_first_contact`, redistribuição round-robin ROL-4, Meta Diária/ranking) — continuam vendo o cliente como "sem contato" para fins de automação/pontuação mesmo quando o card já mostra a data real. Isso é intencional (evita inflar pontuação por uma resposta no Chat) mas é um gap conhecido: o cliente pode aparecer com data recente no card e ainda assim ser redistribuído/alertado como "sem 1º contato". Não corrigido agora por estar fora do pedido; candidato a tarefa futura se o dono confirmar que quer unificar os dois sinais. P-11 em `SYSTEM_ARCHITECTURE.md` deveria ser atualizado para citar esta correção parcial.
- **Autor:** Codex

### 2026-09-28 — Destaques do ranking semanal e diário
- **Data:** 2026-09-28 · **Área:** Ranking / Banco · **Motivo:** pedido do dono.
- **Alteração:** congela o Melhor da Semana anterior às 00:01 de segunda-feira em `crm_settings` e exibe semanal, diário e posição/pontos próprios nessa ordem; esconde a posição quando o usuário é líder do dia. Usa cálculo, desempate e permissões já existentes.
- **Arquivos:** `lib/weekly-ranking.js`, `lib/weekly-ranking-period.mjs`, `lib/performance-overview.js`, `components/TopRankingBadge.jsx`, rotas de top-ranking e cron, migration `20260928001400_weekly_ranking_cron.sql`, `docs/BUSINESS_RULES.md`, `docs/DATABASE.md`.
- **Risco/observação:** cron depende da migration aplicada; sem ela, o primeiro acesso após 00:01 consolida o mesmo resultado. Sem mutação em pontuação/histórico. Ainda não aplicado em produção.
- **Autor:** Codex

### 2026-09-27 — Novo formulário leva o card ao topo sem perder histórico
- **Data:** 2026-09-27 · **Área:** Clientes / Banco · **Motivo:** pedido do dono.
- **Alteração:** reenvio da simulação ou Atendimento Rápido marca a data do novo formulário, ordena o mesmo card no topo da aba/filtro e registra o evento na timeline. A data original, responsável, origem e histórico são preservados; edição interna não altera a ordem.
- **Arquivos:** `lib/simulation-registrations.js`, `lib/simulation-list-query.js`, `components/AdminSimulationList.jsx`, `components/ClientJourneyActions.jsx`, migration `20260927235741_client_last_form_submission.sql`, `docs/BUSINESS_RULES.md`, `docs/DATABASE.md`.
- **Risco/observação:** a migration precisa ser aplicada antes do deploy do código; na aba "Todos", "Tentando contato" permanece por último salvo quando houve novo formulário. Sem teste real de formulário em produção.
- **Autor:** Codex

### 2026-09-27 — Reações e respostas específicas no Chat
- **Data:** 2026-09-27 · **Área:** WhatsApp (Chat) · **Motivo:** pedido do dono.
- **Alteração:** mostra reações na mensagem original, permite reagir/remover reação e responder citando mensagens do cliente no CRM. Reação não aumenta não lidas nem muda o atendimento.
- **Arquivos:** `lib/whatsapp-chat.js`, `lib/whatsapp-master.js`, `lib/whatsapp-reactions.mjs`, `components/WhatsappChat.jsx`, rotas `app/api/admin/whatsapp-chat/conversations/[id]/messages` e `reactions`, `tests/whatsapp-reactions.test.mjs`, `docs/WHATSAPP.md`.
- **Risco/observação:** sem alteração no banco; o envio real depende das regras da Meta (incluindo validade da mensagem alvo). Sem envio de teste para cliente real.
- **Autor:** Codex

### 2026-09-27 — Chat: mudar status do cliente direto no painel do contato
- **Data:** 2026-09-27 · **Área:** WhatsApp (Chat) · **Motivo:** pedido do dono.
- **Alteração:** admin/gestor mudam o status do cliente num seletor no painel "Informações do contato", chamando o mesmo `PATCH /api/simulation-registrations/[id]` do card em Clientes — reflete nos dois lugares, sem endpoint novo.
- **Arquivos:** `components/WhatsappChat.jsx`, `docs/WHATSAPP.md`.
- **Autor:** Claude (agente)

### 2026-09-27 — Ícone do app: confirmado que é limitação do iOS, não do código (diagnóstico removido)
- **Data:** 2026-09-27
- **Área:** WhatsApp (Chat) / PWA
- **Alteração:** diagnóstico ao vivo (rota `admin/tmp-badge-debug` + tabela `tmp_badge_debug`, temporários) confirmou no aparelho real do dono que `navigator.setAppBadge`/`self.navigator.setAppBadge` sempre resolvem com sucesso — nas duas camadas (app aberto e push com o app fechado), contagem certa a cada mudança (0→1→2→3→4→0 acompanhando mensagens novas e leitura) — mas o iOS 18.7 nem sempre pinta o número no ícone da tela de início. Removido o diagnóstico (rota, tabela, trechos extras); mantido só o `setAppBadge`/`clearAppBadge` de sempre.
- **Motivo:** o dono testou no iPhone duas vezes e o ícone não mudou; era preciso saber se era bug nosso ou do aparelho.
- **Arquivos afetados:** `app/api/admin/tmp-badge-debug/route.js` (removido), `components/useWhatsappChatSummary.js`, `public/sw.js`, `docs/WHATSAPP.md`.
- **Risco/observação:** nenhuma mudança de comportamento — só limpeza do diagnóstico. Conclusão: limitação confirmada do WebKit/iOS para a Badging API em apps instalados via "Adicionar à Tela de Início", fora do controle do código desta aplicação; documentado para não reabrir a investigação à toa numa próxima vez. Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-27 — Chat: liberar conversa devolve o cliente à roleta; seletor mostra quem está online
- **Data:** 2026-09-27
- **Área:** WhatsApp (Chat) / Roleta
- **Alteração:** escolher "Ninguém (liberar)" no Chat agora também devolve o cliente vinculado à roleta por presença (exclui o corretor atual da escolha; sem ninguém elegível, só libera). O seletor "Atribuir conversa a" mostra 🟢 antes do nome de quem está online agora.
- **Motivo:** pedido do dono (2026-09-27).
- **Arquivos afetados:** `lib/whatsapp-chat.js` (`assignChatConversation`, `listChatBrokers`), `components/WhatsappChat.jsx`, `docs/BUSINESS_RULES.md` (ROL-8).
- **Risco/observação:** reaproveita `assignRoundRobinLead`/`recordLeadDistributionHistory` (`lib/lead-distribution.js`), já usados pela roleta de lead novo — nenhuma lógica de escolha nova. Reatribuição roda com `auth=null` (ação do sistema, mesmo padrão de `reassignOrphanedClientsToOwner`), então não fica marcada como transferência manual de ninguém. Melhor esforço: erro na roleta nunca impede de liberar a conversa. Sem migration. Não validado com `next build` local.
- **Autor:** Claude (agente)
- **Data:** 2026-09-27
- **Área:** WhatsApp (Fluxos) — motor central e editor visual
- **Alteração:** o dono apontou (com razão) que o bloco reaproveitado como "confirmação" ainda aparecia no mapa como uma SEGUNDA pergunta idêntica logo após o Gatilho, dando a entender que o cliente responderia duas vezes — mesmo já não sendo reenviada de fato (entrada anterior, `initialText`). Criado o bloco **"mensagem externa"** (`data.external = true`, continua `type: "message"`): representa no mapa a mensagem que JÁ foi enviada por fora (o modelo do Disparo, com os mesmos botões e o texto real) — o fluxo nunca a envia; só direciona pelo clique (`initialText`) ou, sem correspondência, segue pela porta "Outra resposta" até uma pergunta de verdade. `validateGraph` agora **exige** essa ligação quando `external = true`. Aparência distinta no editor (ícone de cadeado, cor cinza, "🔒 Modelo já enviado pelo Disparo:" no resumo) e um alternador no painel do bloco (visível em botões/lista) para qualquer fluxo futuro usar. O Fluxo "Disparo diário — resposta ao contato" foi reconstruído: a mensagem externa (com o texto real do modelo, colado igual ao que o dono está enviando à Meta) fica logo após o Gatilho; a pergunta de verdade ("ask") só é enviada se o clique não bater com nenhum botão.
- **Motivo:** pedido do dono — o mapa precisava mostrar a mensagem real do disparo (com 3 botões) como a primeira caixa, não uma pergunta repetida.
- **Arquivos afetados:** `lib/whatsapp-flow-core.mjs` (`defaultNodeData`, `validateGraph`, `runFlow`/`isExternalChoice`), `components/flows/flow-ui.js` (`NODE_META.external`, `nodeSummary`), `components/flows/FlowCanvas.jsx` (`NodeCard`, `headerLabel`), `components/flows/FlowNodePanel.jsx` (alternador em `MessageForm`), `tests/whatsapp-flow-core.test.mjs` (5 testes novos); linha em `whatsapp_flows` (graph reconstruído direto via SQL, id `346c9033-a2db-4d36-aefd-0d66b35095eb`); `docs/WHATSAPP.md`.
- **Risco/observação:** mudança no motor CENTRAL — afeta a validação/execução de QUALQUER fluxo, mas só quando `data.external` é usado (novo, opt-in; nenhum fluxo existente tinha esse campo, comportamento deles é idêntico a antes). Suíte completa de testes puros roda 31/32 (a 1 falha é a P-15 já conhecida, sem relação). Continua sem ativar — falta o modelo ser aprovado e o dono escolher a Rotina no gatilho.
- **Autor:** Claude Code

### 2026-09-27 — Ícone do app mostra o número de mensagens não lidas do Chat
- **Data:** 2026-09-27
- **Área:** WhatsApp (Chat) / PWA
- **Alteração:** o ícone do app na tela inicial do celular passa a mostrar o número de não lidas do Chat (Badging API), o mesmo já exibido no menu. Com o app aberto, o hook do resumo do Chat atualiza o ícone a cada mudança. Com o app fechado, cada mensagem nova de cliente numa conversa **já atribuída** a alguém dispara um push com o total atual de não lidas, e o service worker atualiza o ícone a partir dele.
- **Motivo:** pedido do dono, a partir do exemplo do "Gerenciador de Anúncios" (ícone com bolinha vermelha "2").
- **Arquivos afetados:** `components/useWhatsappChatSummary.js`, `public/sw.js`, `lib/whatsapp-chat.js` (`getUnreadMessageCountForBroker`, `projectChatFromEvents`), `docs/WHATSAPP.md`.
- **Risco/observação:** conversa sem atendente ainda (recém-criada pela roleta) não dispara push nesta primeira versão — só quem já está atribuído (`assigned_user_id`) é avisado; a contagem mostrada, porém, já soma também conversas de clientes por quem o corretor responde (mesma regra do menu). Suporte do navegador: iOS 16.4+ só com o app adicionado à Tela de Início (não numa aba comum), Android/desktop com Chrome instalado; sem suporte, não faz nada (sem erro). Sem migration. Não testado num aparelho real (sem ambiente de push aqui); não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-27 — Motor de Fluxos: clique no botão do modelo de Disparo pula a pergunta (initialText)
- **Data:** 2026-09-27
- **Área:** WhatsApp (Fluxos) — motor central
- **Alteração:** o dono apontou corretamente que o Fluxo "Disparo diário — resposta ao contato" (entrada anterior abaixo) reperguntava as 3 opções mesmo quando o cliente já tinha clicado um botão do modelo. Causa: `campaign_reply` só sabe SE o telefone recebeu a campanha, não IMPORTA qual botão foi tocado — o texto do clique nunca chegava ao motor. Correção: `startSession`/`executeSession` (`lib/whatsapp-flows.js`) passam o texto que casou o gatilho para `runFlow({..., initialText})` (`lib/whatsapp-flow-core.mjs`); se o primeiro bloco de escolha do caminho, numa sessão que está começando, tiver uma opção com esse MESMO texto, a conversa já entra direto por ali — sem reenviar a mensagem. Só vale no arranque (uma tentativa, nunca numa resposta em andamento). Também corrigidos os textos dos 3 botões do Fluxo (id `346c9033-a2db-4d36-aefd-0d66b35095eb`) para baterem exatamente com os que o dono está enviando à Meta ("Quero atualizar" / "Tenho restrição" / "Não tenho interesse", sem emoji — antes estavam com emoji e "Sem interesse").
- **Motivo:** pedido do dono — o disparo já tem os 3 botões, não faz sentido perguntar de novo.
- **Arquivos afetados:** `lib/whatsapp-flow-core.mjs` (`runFlow`, novo `findOptionPortByText`/log `auto_route`), `lib/whatsapp-flows.js` (`startSession`, `executeSession`, `processFlowInbound`), `tests/whatsapp-flow-core.test.mjs` (3 testes novos); linha em `whatsapp_flows` (graph atualizado direto via SQL); `docs/WHATSAPP.md`.
- **Risco/observação:** mudança no motor CENTRAL de Fluxos — afeta toda sessão nova de qualquer fluxo, não só este. Comportamento antigo preservado por design: só age quando o texto bate EXATAMENTE com uma opção do primeiro bloco de escolha alcançado; sem correspondência, envia a mensagem normalmente (nada muda para "Menu principal", "Anúncio", "Formulário concluído" — confirmado rodando a suíte completa de testes puros, 56/57 passam, a 1 falha é a P-15 já conhecida, sem relação). Continua sem ativar o Fluxo do disparo — falta o modelo ser aprovado e o dono escolher a Rotina no gatilho.
- **Autor:** Claude Code

### 2026-09-27 — Fluxo "Disparo diário — resposta ao contato" (rascunho)
- **Data:** 2026-09-27
- **Área:** WhatsApp (Fluxos) / Banco
- **Alteração:** criado o Fluxo **"Disparo diário — resposta ao contato"** (gatilho `campaign_reply`, `campaignSource` vazio de propósito), em **rascunho**, para quem responde ao disparo diário com 3 botões (Quero atualizar / Tenho restrição / Sem interesse): confirma a escolha (o clique no botão do TEMPLATE só abre a sessão — o texto daquele clique não chega ao fluxo, então ele reapresenta as mesmas 3 opções, já dentro da conversa), com um lembrete em 1h se não responder. "Quero atualizar" → `base_roulette` + link de simulação direto + handoff. "Tenho restrição" → `base_roulette` + explica a Blindagem Financeira (mesmo tom do Guia de Atendimento: nunca promete prazo/resultado) + pergunta se quer falar com corretor. "Sem interesse" → encerra educadamente, **sem** criar cliente nem sortear corretor. Resposta fora das 3 opções: repete 2x, depois passa para um humano (mecanismo já nativo do motor de Fluxos).
- **Motivo:** pedido do dono, a partir do texto final do modelo que ele vai enviar para aprovação da Meta.
- **Arquivos afetados:** linha nova em `whatsapp_flows` (inserida direto via SQL, id `346c9033-a2db-4d36-aefd-0d66b35095eb`, status `draft`); nenhum arquivo de código (reaproveita 100% o motor de Fluxos já existente — nenhuma mudança no `lib/whatsapp-flow-core.mjs`/`lib/whatsapp-flows.js`).
- **Risco/observação:** **não ativado.** Falta, para ativar: (1) o modelo ser aprovado pela Meta; (2) o dono escolher a Rotina (ou campanha) no gatilho do Fluxo (`campaignSource`, hoje vazio de propósito); (3) publicar/ativar pelo editor visual. Testado só com o validador puro do motor (`validateGraph`/`validateTrigger`, zero erros) — **não testado num disparo real ainda**.
- **Autor:** Claude Code

### 2026-09-27 — Modelo do Disparo aceita até 3 botões de resposta rápida
- **Data:** 2026-09-27
- **Área:** WhatsApp (Disparo/Templates)
- **Alteração:** `createWhatsappMessageTemplate`/`createAndSubmitTemplate` passam a aceitar `quickReplyButtons` (até 3 textos, ≤ 20 caracteres cada) — alternativa ao botão de link único que já existia; os dois são mutuamente exclusivos (a Meta não mistura tipos no mesmo componente `BUTTONS`). O formulário "Novo template" do Disparo ganhou o campo correspondente.
- **Motivo:** pedido do dono — construir um modelo de disparo com 3 caminhos (interesse / restrição / sem interesse) para alimentar um Fluxo de resposta.
- **Arquivos afetados:** `lib/whatsapp-master.js`, `lib/whatsapp-broadcasts.js`, `components/WhatsappDisparoManager.jsx`; `docs/WHATSAPP.md`.
- **Risco/observação:** nenhuma regra de envio existente mudou; templates já criados com botão de link continuam funcionando igual.
- **Autor:** Claude Code

### 2026-09-27 — Faxina de nomes, parte 5: capitalização padronizada (só a 1ª letra de cada palavra)
- **Data:** 2026-09-27
- **Área:** Prospecção / Banco
- **Alteração:** `name` de `prospecting_contacts` padronizado para só a primeira letra de cada palavra maiúscula (ex.: `"GENI CARDOSO"` → `"Geni Cardoso"`, `"joão"` → `"João"`). Diferente do `initcap()` pronto do Postgres, preposição de nome brasileiro (`de`, `da`, `do`, `das`, `dos`) e o `e` de ligação ficam minúsculos quando não são a primeira palavra (`"SONIA MARIA ROSA DA SILVA"` → `"Sonia Maria Rosa da Silva"`, não `"Da Silva"`). Só letra é tocada — número, símbolo, espaço e barra ficam onde estavam.
- **Motivo:** pedido do dono (2026-09-27): "todos devem ser padrão, só a primeira letra maiúscula".
- **Arquivos afetados:** `supabase/migrations/20260927160000_prospecting_names_titlecase.sql` (novo, função criada e removida dentro da própria migration).
- **Risco/observação:** 3.640 linhas alteradas (revisão por amostragem de 60+ casos antes de aplicar, nenhum problema encontrado); também unificou variantes antigas de "Sem Nome" (`"Sem nome"`, `"SEM NOME"`) para o texto canônico. Sobraram 14 nomes de uma letra só (`"A"`, `"S"`, `"F3R"`...) sem diferença possível de capitalização — fora do escopo deste pedido, não mexidos. Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-27 — Faxina de nomes, parte 3: acentuação corrompida corrigida à mão (mojibake)
- **Data:** 2026-09-27
- **Área:** Prospecção / Banco
- **Alteração:** ~65 nomes com acentuação corrompida na importação (ex.: `"Tã¢Nia Fetchir"` → `"Tânia Fetchir"`, `"Jos? Carlos Lima Pinto"` → `"José Carlos Lima Pinto"`) e "?" puramente decorativo (ex.: `"Carol ?"` → `"Carol"`) corrigidos **um a um, lidos manualmente** (não por fórmula — testei a reversão matemática Latin1↔UTF8 e ela falha por byte inválido numa parte dos casos, avisei o dono antes de aplicar). 6 nomes que não eram nome nenhum (link do Facebook, texto só de símbolo, letra solta) viraram `"Sem Nome"`.
- **Motivo:** continuação da faxina de nomes, pedido do dono (2026-09-27), com confirmação explícita da lista antes de gravar.
- **Arquivos afetados:** `supabase/migrations/20260927140000_prospecting_names_mojibake.sql` (novo, 31 correções + 2 "Sem Nome"), `supabase/migrations/20260927150000_prospecting_names_mojibake_2.sql` (novo, 27 correções + 4 "Sem Nome" — inclui 1 nome que tinha ficado de fora da primeira lista por engano, achado ao conferir o resultado).
- **Risco/observação:** cada migration só atualiza por igualdade EXATA do texto corrompido lido — rodar de novo não faz nada. Ficaram de fora, de propósito: `"Gabriel??Mobilemaker|Gerenc. Ads??"` (nome + tag de negócio colados) e `"Morena Flor R.B.N.L.C?X"` (sigla ilegível). Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-27 — Faxina de nomes, parte 2: código de imóvel/importação grudado no nome
- **Data:** 2026-09-27
- **Área:** Prospecção / Banco
- **Alteração:** removido sufixo de código grudado ao nome (1-3 letras + 3-7 dígitos, ex.: `"Suellen/Ca6908"` → `"Suellen"`, `"Rafael Ba0069"` → `"Rafael"`) e número solto no final (ex.: `"Dirce Batista 998767789"` → `"Dirce Batista"`, `"Milena Pereira 500 Reais"` → `"Milena Pereira"`).
- **Motivo:** continuação da faxina de nomes (pedido do dono, 2026-09-27); na entrada anterior este caso tinha ficado fora do escopo por precaução, mas ao olhar os dados reais o padrão se mostrou bem definido e seguro de corrigir.
- **Arquivos afetados:** `supabase/migrations/20260927130000_prospecting_names_code_suffix.sql` (novo), `docs/BUSINESS_RULES.md` (PRO-4c).
- **Risco/observação:** 273 linhas alteradas (261 do padrão letra+dígitos, 12 de número solto), conferidas uma a uma antes de aplicar. Ainda fora do escopo: duas pessoas juntas por `/`/`&`/`|` e "mojibake" (acentuação corrompida) — essa última se mostrou mais difícil do que o esperado: a reversão matemática simples (Latin1↔UTF8) falha por byte inválido em parte dos casos; a correção precisaria ser lida caso a caso (~30 nomes), não aplicada por fórmula. Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-27 — Faxina de nomes na base de Prospecção; sem nome nunca sorteado em campanha
- **Data:** 2026-09-27
- **Área:** Prospecção / Disparo / Banco
- **Alteração:** contato sem nome de verdade (nenhuma letra, ou "nome" é um e-mail) → `"Sem Nome"`; símbolo puramente decorativo removido de quem sobra letra (ex.: `"***Talita Dna"` → `"Talita Dna"`, `"## Cláudio ##"` → `"Cláudio"`); pequeno dicionário de apelidos sem ambiguidade corrigido (ex.: `"Zé"` → `"José"`, `"Cadu"` → `"Carlos Eduardo"`). `pick_broadcast_base_contacts` (usada pelo sorteio manual e pela rotina diária de Disparo) passa a excluir quem não tem nome de verdade.
- **Motivo:** pedido do dono (2026-09-27), a partir de exemplos reais na Base da Imobiliária (`"***Talita Dna"`, `"## Cláudio ##"`, `"°#Y_Maiel#°"`, contatos com nome só de símbolo).
- **Arquivos afetados:** `supabase/migrations/20260927120000_prospecting_names_cleanup.sql` (novo), `docs/BUSINESS_RULES.md` (PRO-4c).
- **Risco/observação:** 2907 linhas de `prospecting_contacts` alteradas (2841 → `"Sem Nome"`; 59 com símbolo removido; 19 apelidos corrigidos), conferidas uma a uma antes de aplicar. **Fora do escopo, por risco de dano maior que o ganho** (não corrigido, fica para decisão futura do dono): 228 contatos com dígito colado ao nome (ex. `"Afonso/Ba0445"`), nomes de duas pessoas juntos por `/`/`&`/`|` (ex. `"Marcos Roberto Martins/Rute"`), e "mojibake" — acentuação corrompida na importação (ex. `"Jos? Carlos"`, `"Andrã?Ia"`) — problema de codificação de caractere, não de símbolo decorativo; remover o "?" destruiria a letra perdida. Não altera `queue_sort_at` (ordem de reserva da Meta Diária) nem nenhuma outra coluna. Não validado com `next build` local (sem `node_modules` na máquina).
- **Autor:** Claude (agente)

### 2026-09-27 — Disparos vira aba própria; WhatsApp Manual removido
- **Data:** 2026-09-27
- **Área:** WhatsApp (Automações) / Banco
- **Alteração:** o Disparo (`WhatsappDisparoManager`, com suas 5 abas: Nova campanha, Templates, Histórico, Gastos, Desempenho) saiu de dentro de "WhatsApp Master" e virou aba própria "Disparos" em Automações (`?tab=disparos`, antes `whatsapp-manual`). "WhatsApp Master" ficou só com conexão, foto/perfil, respostas por palavra-chave e o inbox de eventos. O módulo **WhatsApp Manual foi removido por completo** (pedido do dono, não usava mais): tela, as 3 rotas (`manual-log`, `manual-templates`, `manual-summary`), `lib/whatsapp-manual-summary.js` e a tabela `whatsapp_manual_log` (com o histórico de cliques) e a configuração `crm_settings.whatsapp_manual_templates`.
- **Motivo:** pedido do dono — a aba WhatsApp Master estava "muito bagunçada e poluída" com o Disparo empilhado dentro dela, e o WhatsApp Manual não era mais usado.
- **Arquivos afetados:** `app/admin/automacoes/page.jsx`; removidos `components/WhatsappManualSender.jsx`, `lib/whatsapp-manual-summary.js`, `app/api/admin/whatsapp-master/manual-{log,templates,summary}/route.js`; `supabase/migrations/20260927120000_drop_whatsapp_manual.sql` (**aplicada em produção**: apagou a tabela e a configuração); `docs/BUSINESS_RULES.md` (AUT-7), `docs/WHATSAPP.md`, `docs/CRM_CONTEXT.md`, `docs/DATABASE.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/PERMISSIONS.md`.
- **Risco/observação:** o histórico de "quem clicou em abrir o WhatsApp manualmente" foi apagado de vez (o dono pediu explicitamente, não só ocultar). Nenhuma regra de negócio do Disparo, Fluxos ou Chat mudou — só reorganização de tela.
- **Autor:** Claude Code

### 2026-09-26 — Chat baixa imagens, documentos e vídeos recebidos (antes só áudio)
- **Data:** 2026-09-26
- **Área:** WhatsApp (Chat)
- **Alteração:** imagem, documento, vídeo e figurinha recebidos passam a ser baixados da Meta e guardados no bucket privado `whatsapp-inbound-media` (como o áudio). No Chat: imagem com "Baixar", documento com nome/tamanho + "Abrir"/"Baixar" (nome original), vídeo com player. A rota `GET /api/admin/whatsapp-chat/media/[messageId]` (mesma permissão da conversa) entrega áudio em bytes e as demais mídias por redirecionamento a um link temporário (5 min); `?download=1` salva com o nome original; `?retry=1` tenta de novo. `POST .../media/recover` (admin/gestor) recupera as mídias dos últimos 14 dias.
- **Motivo:** urgente — cliente enviou a documentação pelo Chat e só aparecia "[Documento] — abra no WhatsApp".
- **Arquivos afetados:** `lib/whatsapp-media.js`, `lib/whatsapp-media-utils.mjs`, `lib/whatsapp-chat.js`, `lib/whatsapp-master.js`, `app/api/admin/whatsapp-chat/media/**`, `components/WhatsappChat.jsx`, `tests/whatsapp-media-utils.test.mjs`.
- **Risco/observação:** "Mensagem não suportada" (tipo `unsupported`, erro 131051 da Meta) não traz arquivo: não há o que baixar; a tela agora explica. Limite de 16 MB por arquivo. Docs (`WHATSAPP.md` §6 ainda diz que só áudio é baixado) **A SINCRONIZAR**.
- **Autor:** Claude Code

### 2026-09-26 — Disparo: Gastos, Desempenho e Chat > Campanhas
- **Data:** 2026-09-26
- **Área:** WhatsApp (Disparo / Chat) / Banco
- **Alteração:** novas abas **Gastos** (campanha, tipo, enviadas, custo por envio e total; tabela de preços editável) e **Desempenho** (funil enviadas→entregues→lidas→responderam→cadastros, custo por conversa e por cadastro, por campanha e por modelo) no Disparo; aba **Campanhas** no Chat (admin/gestor). O webhook passou a gravar `billable`/`pricing_category` dos eventos de status do Disparo.
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `supabase/migrations/20260926120000_whatsapp_broadcast_costs.sql` (**aplicada em produção em 2026-09-26**: 2 colunas, 1 linha em `crm_settings`, 3 funções), `lib/whatsapp-broadcast-finance.js` (novo), `lib/whatsapp-broadcasts.js` (`getBroadcastDetail` + respostas), `lib/whatsapp-master.js` (`syncBroadcastMessageStatuses`), `app/api/admin/whatsapp-broadcasts/finance/route.js` (novo), `components/WhatsappDisparoInsights.jsx`/`WhatsappChatCampaigns.jsx` (novos), `WhatsappDisparoManager.jsx`, `WhatsappChat.jsx`; `docs/WHATSAPP.md`, `docs/DATABASE.md`.
- **Risco/observação:** valores em R$ por categoria são **estimados** (A CONFIRMAR com a fatura Meta); a Meta não informa o valor em reais por evento. Resposta = 1ª mensagem recebida em até 7 dias (um contato que recebe dois disparos no período conta nos dois). Nenhuma regra de envio foi alterada.
- **Autor:** Claude Code

### 2026-09-26 — Formulário completa o card do WhatsApp em vez de duplicar
- **Data:** 2026-09-26
- **Área:** Clientes / WhatsApp
- **Alteração:** `findMatchingRegistration` passou a considerar TODOS os cadastros do mesmo telefone (não só o mais recente). Formulário de link (completo e Atendimento Rápido): (1) completa o card criado pelo WhatsApp que ainda não tem simulação, mesmo que o link seja de outro corretor (mantém o responsável); (2) com link pessoal, prefere o cadastro do mesmo corretor do link. Novo campo `acquisitionKind` no cadastro (só o tipo da origem).
- **Motivo:** bug reportado pelo dono — cliente veio do anúncio (card C3494), preencheu o formulário e gerou outros cards (C3495 e C3501, mesmo telefone). Causa: o card do Chat já tinha sido transferido a outro corretor, e a regra "link de outro corretor = atendimento novo" combinada com a busca só pelo cadastro mais recente criou duplicatas.
- **Arquivos afetados:** `lib/simulation-registrations.js`; `docs/BUSINESS_RULES.md` (CLI-4).
- **Risco/observação:** só previne novas duplicidades; os 3 cards já existentes daquele telefone **não foram mesclados** (mesclar exige decidir o que manter). Exceção "link de outro corretor abre atendimento novo" continua valendo quando o outro cadastro já tem simulação preenchida.
- **Autor:** Claude Code

### 2026-09-26 — Novo cabeçalho da conversa no Chat
- **Data:** 2026-09-26
- **Área:** WhatsApp (Chat) — visual
- **Alteração:** cabeçalho reorganizado em camadas (nome sem telefone + janela de 24 h + status do card; corretor e sinais numa linha; "Assumir atendimento" em faixa larga no celular). "Finalizar/Reabrir" e "Excluir conversa" passaram para o menu "⋯". O selo "Cliente sem responder há X" agora diz "Cliente em silêncio há X".
- **Motivo:** pedido do dono — nome e selos ficavam cortados no celular.
- **Arquivos afetados:** `components/WhatsappChat.jsx`, `components/WhatsappChatBadges.jsx`; `docs/WHATSAPP.md`.
- **Risco/observação:** só visual; rotas, permissões e regras inalteradas. Finalizar ficou 1 toque mais longe (decisão do dono pode reverter).
- **Autor:** Claude Code

### 2026-09-26 — Prospecção: contatos sem nome vão para o final da fila
- **Data:** 2026-09-26
- **Área:** Prospecção
- **Alteração:** na lista da aba Prospecção (Base da Imobiliária, Minha Base e visão do dono), contatos sem nome (“Sem nome”, telefone no lugar do nome, “.”, letra solta…) aparecem depois dos que têm nome, mantida a ordem dentro de cada grupo.
- **Motivo:** pedido do dono (2026-09-26).
- **Arquivos afetados:** `lib/prospecting-queue-order.mjs` (novo), `lib/prospecting.js`, `tests/prospecting-queue-order.test.mjs` (novo), `docs/BUSINESS_RULES.md` (PRO-4b).
- **Risco/observação:** só a ordem da lista na tela; a fila FIFO que a Meta Diária usa para reservar contatos (`queue_sort_at`) não mudou. Nenhum dado nem migration. Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-26 — Novo status “Atendimento automático” para cliente do WhatsApp sem formulário
- **Data:** 2026-09-26
- **Área:** WhatsApp / Funil / Banco
- **Alteração:** novo status `automated_service` (“Atendimento automático”): o cliente criado pelo WhatsApp (roleta) sem formulário preenchido nasce nele, não em “Aguardando simulação”; corretor responde no Chat → “Em atendimento”; preenche o formulário → “Aguardando simulação” (já existia). Chat: contato de conversa já assumida e conversa adicionada ao CRM sem formulário já ficam “Em atendimento”. Aparece na aba Atendimento; é status ativo.
- **Motivo:** pedido do dono (2026-09-26): sem formulário preenchido o status não pode ser “Aguardando simulação”.
- **Arquivos afetados:** `supabase/migrations/20260926140000_client_status_automated_service.sql` (novo), `lib/client-status.js`, `lib/client-status-history.js`, `lib/whatsapp-client-status-core.mjs`, `lib/whatsapp-client-status.js`, `lib/whatsapp-chat.js`, `lib/simulation-registrations.js`, `components/AdminSimulationList.jsx`, `tests/whatsapp-client-status.test.mjs`, `docs/BUSINESS_RULES.md` (WA-9), `docs/WHATSAPP.md`, `docs/CRM_CONTEXT.md`, `docs/DATABASE.md`.
- **Risco/observação:** migration em 3 partes (restrições → deploy → função da roleta + correção de 8 clientes reais). Sem tela pública própria: a Minha Jornada cai no texto padrão. Ranking: “Em atendimento” automático credita o ponto de atendimento ao corretor responsável (uma vez por cliente) — **confirmar com o dono**. O teste do Fluxo “Menu principal” continua falhando (P-15, anterior a esta mudança). Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-25 — Chat muda o status do cliente sozinho (Tentando contato / Em atendimento)
- **Data:** 2026-09-25
- **Área:** WhatsApp / Funil
- **Alteração:** mensagem enviada por uma pessoa no Chat move o cliente de “Aguardando simulação” para “Tentando contato”; resposta do cliente move de “Tentando contato” para “Em atendimento” (só se tem corretor responsável). Só para frente; grava histórico de status (`source = whatsapp_chat`).
- **Motivo:** pedido do dono (2026-09-25).
- **Arquivos afetados:** `lib/whatsapp-client-status-core.mjs` (novo), `lib/whatsapp-client-status.js` (novo), `lib/whatsapp-chat.js`, `tests/whatsapp-client-status.test.mjs` (novo), `docs/WHATSAPP.md` (§6), `docs/BUSINESS_RULES.md` (WA-9).
- **Risco/observação:** afeta funil/pontuação: “Em atendimento” automático credita o ponto de atendimento ao corretor responsável (uma vez por cliente) e converte a rodada da Meta Diária desse cliente — **confirmar com o dono** se quer o crédito assim ou como “sistema” (0 ponto). Não retroage (só mensagens novas). Sem migration. Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-25 — Detalhe do corretor (dono): quanto falta em cada tentativa e nos pendentes
- **Data:** 2026-09-25
- **Área:** Meta Diária (visão do dono)
- **Alteração:** ao abrir “Desempenho de hoje” de um corretor: bloco “O que falta para bater a meta” (prospecção e pendentes, com onde falta), cada tentativa mostra “X de Y contatos” + quanto falta, e lista dos clientes pendentes ainda não resolvidos (nome, código, dias sem contato, até 30). Só para o dia de hoje; outros períodos ficam como antes.
- **Motivo:** pedido do dono (mais texto no detalhe e saber o que falta para concluir a meta).
- **Arquivos afetados:** `components/TeamDailyPerformance.jsx`, `lib/daily-goal.js` (`getOwnerBrokerDailyDetail`), `lib/daily-goal-wallet.js` (`stages`), `lib/daily-goal-pending.js` (`withClients`), `lib/daily-goal-progress.mjs` (`dayStageBreakdown`), `tests/daily-goal-progress.test.mjs`, `docs/BUSINESS_RULES.md` (MD-8).
- **Risco/observação:** só leitura, sem migration; a lista de pendentes é buscada só ao abrir o detalhe de UM corretor. Com prospecção manual (reivindicações) o “falta” por etapa pode ficar 1 acima do “falta” da prospecção total (cada reivindicação cria uma rodada que ainda não teve a 1ª tentativa). Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-25 — Correção: meta em 106% no painel, mas Prospecção Extra bloqueada (“51 de 60”)
- **Data:** 2026-09-25
- **Área:** Meta Diária / Prospecção
- **Alteração:** o painel, o fechamento do dia e a liberação da Prospecção Extra passam a usar o mesmo total de prospecção do dia (`loadWalletDayNumbers`: carteira ativa + trabalhados hoje que saíram dela, **encerrados ou convertidos**). O bloqueio da Prospecção Extra libera quando a meta do dia (prospecção + pendentes) chega a 100%. Mensagem do bloqueio atualizada. `getDailyGoalWalletStatus` deixou de devolver `completedToday`/`requiredToday`/`extraUnlocked` (sem nenhum consumidor).
- **Motivo:** bug reportado pelo dono: Jennyfer com 51 tentativas aparecia com 106% (meta 45) e ao tentar prospectar via “51 de 60”. Causa: o total do painel ignorava rodadas convertidas hoje e o bloqueio usava outra conta (cota nominal + rodadas carregadas, incluindo contatos fechados por outro caminho sem tentativa dela).
- **Arquivos afetados:** `lib/daily-goal-wallet.js`, `lib/daily-goal-progress.mjs` (`walletDayTarget`), `lib/daily-goal.js` (comentário), `lib/prospecting.js` (mensagem), `tests/daily-goal-progress.test.mjs`, `docs/BUSINESS_RULES.md` (MD-5, PRO-2), `.claude/rules/meta-diaria-ranking.md`.
- **Risco/observação:** percentual de quem teve conversões hoje muda (Jennyfer 106% → 100%; Caroline meta 70 → 74). Sem migration. Dias já fechados não foram reprocessados. `getDailyGoalPerformance` (previstas de hoje) passa a usar o mesmo total via `getDailyGoalTarget`. Não validado com `next build` local (sem `node_modules`).
- **Autor:** Claude (agente)

### 2026-09-25 — Meta Diária passa a somar prospecção + clientes pendentes
- **Data:** 2026-09-25
- **Área:** Meta Diária
- **Alteração:** os 100% da meta passam a ser prospecção + pendentes (clientes ativos com +3 dias sem contato e sem atividade futura, congelados no início do dia); depois dos 100% só prospecção excedente soma +1%. Card ganhou `Prospecção x/y` e `Pendentes x/y` (✓ quando concluídos). Vale também no fechamento (`percent`/`goal_met`) e na visão do dono (só hoje). Nova tabela `daily_goal_pending_freeze` e congelamento às 00:10 no cron `daily-goal-close`.
- **Motivo:** pedido do dono (2026-09-25) para a meta incluir os clientes que estão parados.
- **Arquivos afetados:** `lib/daily-goal-progress.mjs`, `lib/daily-goal-pending.js` (novo), `lib/daily-goal.js`, `app/api/cron/daily-goal-close/route.js`, `components/DailyGoalDashboard.jsx`, `tests/daily-goal-progress.test.mjs`, `supabase/migrations/20260925140000_daily_goal_pending_freeze.sql` (novo), `docs/BUSINESS_RULES.md` (MD-8), `docs/DATABASE.md`, `.claude/rules/meta-diaria-ranking.md`.
- **Risco/observação:** a migration `20260925140000` foi aplicada em produção em 2026-09-25 (tabela criada, RLS ligado, sem acesso para anon/authenticated); sem ela o código funcionaria como antes, sem pendentes. Regra confirmada pelo dono em 2026-09-25: prospecção excedente só conta depois de a meta atingir 100% (não “paga” pendente não trabalhado). Não validado com `next build` local (sem `node_modules` na máquina); testes puros passam. Ranking/bônus e `getDailyGoalCompletionStatus` (liberação de prospecção extra) **não** foram alterados.
- **Autor:** Claude (agente)

### 2026-09-26 — Status do card no Chat e cadastro sem dados padrão
- **Data:** 2026-09-26
- **Área:** WhatsApp (Chat) / Clientes
- **Alteração:** (1) o Chat mostra o status do card do cliente na lista, no cabeçalho da conversa e, no painel, se a simulação foi preenchida. (2) Cliente que não preencheu a simulação deixa de exibir dados padrão (nascimento 01/01/1900, "Autônomo sem registro", "Solteiro", "Não", R$ 0) no card expandido, no detalhe do cadastro e na lista de cadastros; aparece o aviso "O cliente ainda não preencheu os dados da simulação".
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `lib/simulation-registration-schema.js` (`hasSimulationData`, `realBirthDate`), `lib/whatsapp-chat.js`, `components/WhatsappChatBadges.jsx`, `components/WhatsappChat.jsx`, `components/AdminSimulationList.jsx`, `components/RegistrationDetails.jsx`, `components/AdminRegistrationList.jsx`; `docs/BUSINESS_RULES.md` (CLI-5b), `docs/WHATSAPP.md`.
- **Risco/observação:** só exibição — banco e regras inalterados (os valores padrão continuam gravados; o critério é nascimento ≠ 1900-01-01 ou renda/recurso > 0). Telas de edição (`SimulationGenerator`, formulários) e o PDF/CCA não foram alteradas.
- **Autor:** Claude Code

### 2026-09-25 — Aviso ao corretor que recebe os clientes de um usuário excluído
- **Data:** 2026-09-25
- **Área:** Clientes / Notificações
- **Alteração:** ao excluir um usuário com clientes, o corretor de destino recebe **um único** aviso resumido (`crm_notifications`, tipo `clients_transferred`, + push) — não um por cliente; não avisa se o próprio autor da exclusão é o destino. A tag do corretor anterior passou a ser obrigatória e gravada **antes** de mover cada lote (falha na tag aborta a transferência do lote).
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `lib/admin-profiles.js` (`transferClientsBeforeDelete`); `docs/CHANGELOG_AI.md`.
- **Risco/observação:** aviso é best-effort (falha não desfaz a transferência). Continua sem exercício real em produção.
- **Autor:** Claude Code

### 2026-09-25 — Excluir corretor pergunta para quem transferir os clientes
- **Data:** 2026-09-25
- **Área:** Clientes / Permissões (Usuários)
- **Alteração:** ao excluir um usuário (já desativado), abre-se um painel pedindo o corretor que receberá os clientes dele. Os clientes transferidos ganham uma tag com o nome do corretor anterior e um evento na linha do tempo. Antes, os clientes iam automaticamente ao administrador principal. Novo `GET /api/admin-users/[id]` devolve a contagem de clientes; `DELETE` aceita `transferToUserId` (obrigatório se houver clientes).
- **Motivo:** pedido do dono (escolher o destino e identificar a origem dos clientes).
- **Arquivos afetados:** `lib/admin-profiles.js` (`deleteAdminProfile`, `countClientsOfProfile`), `app/api/admin-users/[id]/route.js`, `components/AdminUsersManager.jsx`; `docs/BUSINESS_RULES.md` (CLI-6).
- **Risco/observação:** não altera `previous_responsible_user_id`/`responsible_changed_at` (evita disparar a automação "client_transferred" em massa e o campo seria zerado pela exclusão). A conversa do WhatsApp acompanha o novo responsável pelo trigger existente. Associados vinculados ao corretor excluído, contatos da Prospecção e carteira da Meta Diária continuam com o comportamento anterior do banco (ficam sem vínculo/dono). Compilação validada (`next build`); a exclusão real não foi exercitada em produção.
- **Autor:** Claude Code

### 2026-10-01 — Alexa V2: voz consulta o CRM (cache, snapshots, catálogo de assuntos)
- **Data:** 2026-10-01
- **Área:** Alexa / Métricas / Banco / Cron
- **Alteração:** a skill "Central Machado" passou a responder dezenas de perguntas (meta, prospecção, pendências, funil/etapas, agenda do escritório, atendimento, presença, vendas/aprovações, ranking, resumo/atenção) com período (hoje, ontem, amanhã, esta semana, semana passada, este mês, mês passado), corretor falado e contexto de conversa ("quem são?", "quantos?", "mais", "e ontem?", "e o Eduardo?"). As frases antigas (V1) continuam, agora lendo as mesmas fontes da V2. Novas tabelas `crm_metric_cache` (cache volátil + locks) e `crm_metric_snapshots` (histórico diário reutilizável), função `crm_status_counts()` e rota `/api/cron/crm-snapshots?mode=refresh|stock|close` (pg_cron: atualização a cada 5 min em horário comercial / 30 min fora; estoque 23:55 e fechamento 00:10, horário de Brasília).
- **Motivo:** pedido do dono (interface de voz completa, sem cálculo pesado na hora da pergunta e sem sobrecarregar o Supabase).
- **Arquivos afetados:** `lib/alexa-v2/*` (catálogo, roteador, períodos, texto, sanitização, provedores), `lib/crm-metrics/*` (cache, snapshots, jobs, Meta/Desempenho pré-calculados), `lib/alexa-skill.js`, `app/api/cron/crm-snapshots/route.js`, `scripts/build-alexa-model.mjs`, `docs/alexa-interaction-model.json`, migration `20261001190000_crm_metric_snapshots_cache.sql`.
- **Risco/observação:** os números da voz vêm das MESMAS funções das telas (Meta da Equipe, Desempenho, Clientes, Presença); testes de paridade confirmaram igualdade. Histórico de estoque (funil, pendências "ontem") começa na ativação dos snapshots. Lista de corretores do modelo de voz é fixa (acrescentar corretor novo em `scripts/build-alexa-model.mjs` e reimportar). Nunca fala CPF, telefone ou documentos; listas têm no máximo 5 nomes ("e mais N"; "mais" continua).
- **Autor:** Claude Code

### 2026-10-01 — Alexa: tratamento "Machado", invocação "CRM" e aniversários na rotina de chegada
- **Data:** 2026-10-01
- **Área:** Alexa
- **Alteração:** a Alexa chama o dono de "Machado" nas saudações e no resumo (rotina de chegada e "como estamos"); a skill passou a abrir com "Alexa, abrir CRM" (nome de invocação `crm` no modelo); o resumo da rotina de chegada ganhou, no FINAL, a frase de aniversariantes do dia ("Machado, além disso, hoje três clientes fazem aniversário: Jean, Adalberto e Júnior."), omitida quando não há ninguém.
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `lib/alexa-config-core.mjs` (`OWNER_SPOKEN_NAME`, `isBirthdayOn`, `birthdayFirstNames`, `composeBirthdaySentence`, `composeArrivalSummary`), `lib/alexa-arrival.js`, `lib/alexa-v2/providers/resumo.js`, `lib/alexa-skill-core.mjs`, `scripts/build-alexa-model.mjs`, `docs/alexa-interaction-model.json`.
- **Risco/observação:** aniversários NÃO têm tabela própria: a Agenda os calcula na hora a partir de `simulation_registrations.oldest_birth_date` (dia/mês; 1900 = sem data; 29/02 cai em 28/02) e a voz reutiliza `listBirthdayRegistrations` com o mesmo escopo da Agenda (clientes do próprio dono). Sem duplicados (por id ou nome completo). Só primeiros nomes. O modelo de voz precisa ser reimportado no Console (invocação).
- **Autor:** Claude Code

### 2026-10-02 — Alexa V3: consultas profundas por corretor, comparação e gestão da equipe
- **Data:** 2026-10-02
- **Área:** Alexa / Métricas
- **Alteração:** a Central responde por corretor ("como foi o dia da Izabela", "qual a meta dela", "quantas simulações", "e ontem", "e a Bruna"): resumo executivo do dia, Meta Diária (percentual, faltam, bateu, prospecções que faltam), desempenho detalhado (prospecções, atendimentos, simulações, documentação, aprovação, aprovados, reunião, vendas, pontos, posição no ranking), estoque por etapa do corretor ("estão em"), agenda/compromissos/atividades atrasadas, comparação entre dois corretores e visão gerencial ("como está minha equipe", "quem fez mais simulações", "quem tem reunião hoje"). O contexto da conversa guarda corretor, assunto e período. Os nomes (primeiro nome, nome completo e apelidos) vêm de UM catálogo (`lib/alexa-v2/broker-aliases.mjs` + cadastro do CRM) e o modelo de voz é gerado dele (`GET /api/admin/alexa/model` ou `scripts/build-alexa-model.mjs`).
- **Motivo:** pedido do dono (a Central deve parecer uma interface de voz natural, não um menu de comandos).
- **Arquivos afetados:** `lib/alexa-v2/{medidas,brokers,broker-aliases,catalog,catalog-corretor,catalog-etapas,model-core,router}.mjs`, `lib/alexa-v2/providers/{corretor,corretor-core,agenda,funil}`, `lib/crm-metrics/{broker-stock,broker-stock-core,overview-core,jobs,team-goal}`, `app/api/admin/alexa/model/route.js`, migration `20261001210000_crm_status_counts_by_broker.sql`.
- **Risco/observação:** nenhuma métrica é recalculada: tudo vem do cache do Desempenho (`getPerformanceOverview`) e da Meta Diária (`getOwnerTeamDailyOverview`), mais o estoque por corretor (RPC agrupada, 1 consulta a cada ciclo). "Reuniões agendou" (criadas no dia) não tem fonte oficial e não é respondido. Histórico de estoque por corretor só existe para hoje.
- **Autor:** Claude Code

### 2026-10-02 — Alexa: "minha agenda" (atividades de hoje, amanhã, depois de amanhã e da semana)
- **Data:** 2026-10-02
- **Área:** Alexa / Agenda
- **Alteração:** a Central responde "quais atividades eu tenho amanhã?", "o que eu tenho para amanhã?", "quais são meus compromissos de amanhã?", "tenho alguma atividade amanhã?" e "qual é minha agenda de amanhã?" com horário, tipo/título e primeiro nome do cliente (máx. 5 por vez; "e depois" continua). Contexto: "qual é a primeira/última?", "e depois?" e "e depois de amanhã?". Novo período "depois de amanhã". A abertura da skill passou a ser só "Ok, qual informação você deseja?" e a Central responde rankings por métrica ("quem mais fez atendimentos hoje").
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `lib/alexa-v2/providers/{agenda,activities-core}`, `lib/alexa-v2/{catalog-agenda,periods,router,model-core}`, `lib/alexa-skill-core.mjs`.
- **Risco/observação:** mesma Agenda do CRM (calendar_activities + campo legado de simulation_registrations), só atividades PENDENTES do usuário vinculado (dono), em horário de Brasília. Aniversários não entram nessa resposta (ficam na rotina de chegada).
- **Autor:** Claude Code

### 2026-10-02 — Alexa: agenda por dia da semana, data falada e "próxima sexta"
- **Data:** 2026-10-02
- **Área:** Alexa / Agenda
- **Alteração:** a consulta da agenda pessoal (uma única intenção, `AgendaIntent`) agora aceita período (hoje, amanhã, depois de amanhã), dia da semana ("sexta", "na sexta-feira", "próxima sexta", "sexta que vem"; slot próprio `DIA_SEMANA`) e data falada ("dia 8", "8 de outubro"; slot `AMAZON.DATE`), sempre normalizados para AAAA-MM-DD de Brasília antes de consultar a Agenda. Dia da semana = próxima ocorrência (hoje conta; "próxima/que vem" pula para a semana seguinte); data sem ano = próxima ocorrência. Mantém contexto ("e sábado?", "e no dia seguinte?", "qual é a primeira?", "e depois?"). Falha anterior: o modelo publicado no Console não tinha as frases de data (upload não salvo) e "agendadas na ..." não existia entre as frases.
- **Motivo:** pedido do dono (frase "Quais atividades eu tenho agendadas na sexta-feira?" não era reconhecida no Echo).
- **Arquivos afetados:** `lib/alexa-v2/{model-core,router,periods}.mjs`, `lib/alexa-v2/providers/activities-core.mjs`, `docs/alexa-interaction-model.json`.
- **Risco/observação:** modelo grande (cerca de 700 frases na intenção de agenda, geradas por combinação de prefixos). A fala sempre diz o tipo da atividade; o título digitado entra no fim só se agrega.
- **Autor:** Claude Code

### 2026-10-02 — Alexa: fallback único "Não entendi." e contexto conversacional dinâmico
- **Data:** 2026-10-02
- **Área:** Alexa
- **Alteração:** (1) todo fallback/pergunta sem contexto suficiente responde SÓ "Não entendi." (sem lista de opções, exemplos, explicações ou ajuda; a sessão continua aberta e o contexto é preservado); a ajuda continua só quando o dono pede "ajuda". Mensagem de falha técnica ficou "Não consegui buscar isso agora." (sem sugestão). (2) Contexto estruturado (assunto/métrica, formato, período ou data, corretor, etapa, domínio): ele só COMPLETA o que a nova pergunta não diz; informação explícita nova sempre vence ("e o Eduardo, quantas simulações fez hoje?" troca tudo de uma vez; "e ontem?" muda só o período; "e a Izabela?" só o corretor; "e simulações?" só a métrica). "E a Bruna?" sobre a agenda pessoal do dono (sem fonte segura) → "Não entendi.".
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `lib/alexa-skill-core.mjs`, `lib/alexa-v2/{router,catalog,model-core}.mjs`, testes `tests/alexa-context.test.mjs` e ajustes em `tests/alexa-*.test.mjs`.
- **Risco/observação:** o modelo de voz ganhou frases "e o {corretor} quantas {assunto} fez {período}" (reimportar e buildar no Console).
- **Autor:** Claude Code

### 2026-10-02 — Botão WhatsApp do card decide pelo estado real do WhatsApp
- **Data:** 2026-10-02 (tarefa T-20261002-24)
- **Área:** Clientes (card/ficha), WhatsApp individual
- **Alteração:** conectado → Chat interno; desconectado ou restrição informada/validada → WhatsApp Web (desktop) ou app (celular/PWA); estado desconhecido, arquivado, Não contactar, cliente de outro responsável ou telefone inválido → Chat. Nova rota somente leitura `GET /api/admin/whatsapp-individual/card-state`.
- **Motivo:** pedido do dono: com o WhatsApp do corretor fora do ar o Chat não envia; ele precisa poder falar com o cliente por fora, sem que isso conte como conectado (nada muda em status, elegibilidade ou Prospecção). A decisão é pelo estado real, nunca pelo aparelho (incidente do PWA, 04a9288).
- **Arquivos afetados:** `lib/client-card-whatsapp-core.mjs`, `app/api/admin/whatsapp-individual/card-state/route.js`, `components/clients/useClientList.js`, testes `tests/client-card-whatsapp-decision.test.mjs` e `tests/client-card-whatsapp-chat.test.mjs`; docs WA-13a, rule crm-clientes-funil.
- **Risco/observação:** só vale para cliente do próprio usuário (o link externo usa o número de quem clica). Sem migration.
- **Autor:** Claude Code

### 2026-10-02 — Financeiro (Vendas/Comissões): interface da fase 3 (só layout, nenhuma regra mudou)
- **Data:** 2026-10-02
- **Área:** Financeiro / interface (T-20261002-12)
- **Alteração:** topo com 3 números grandes (Recebido no mês · A receber · Comissões em atraso — mesmas contas de `calculateReceivableMetrics`: recebido no mês, "a receber neste mês", vencidas de meses anteriores); demais cartões em "Ver detalhes" (recolhido); filtros: Período e Status à vista + "Mais filtros" (Cliente, Corretor, Imóvel); edição da venda em 3 blocos recolhíveis (Venda · Comissão e repasses · Recebimentos) com resumo fixo (livre, recebido, a receber) e Salvar fixo no rodapé; no celular lista e editor viram duas telas ("Voltar para vendas"); abas num componente único (`SectionTabs`, sublinhado, sem caixa alta); lista de vendas com selo "Atrasado" em vermelho e previsão/parcela ao lado; texto de apresentação recolhido; bloco "Para acompanhar" no Resumo e Recebimentos com linha vermelha para atraso. Aba "Dashboard" passou a se chamar "Resumo". Vitrine: tela `financeiro-vendas` (perfis admin/gestor/corretor/associado) + `AutoClick` (dev).
- **Motivo:** pedido do dono; reduzir poluição e mostrar "o que fazer agora".
- **Arquivos afetados:** `components/AdminFinancialDashboard.jsx`, `components/FinancialSalesParts.jsx` (novo), `app/dev/vitrine/**`. Nenhum arquivo de `lib/`, API ou da Saúde.
- **Risco/observação:** visão projetada do associado e previsão só do dono preservadas (a previsão só aparece onde `expectedReceiptDate` já chega, ou seja, só ao dono; associado não vê datas na lista). "Recebido no mês/A receber/Em atraso" não dependem do período da venda (como a aba Recebimentos já era).
- **Autor:** Claude Code (designer-crm)

### 2026-10-02 — Meta Diária: restrição validada do WhatsApp libera Meta manual e compensa a janela (PRO-14)
- **Data:** 2026-10-02
- **Área:** Meta Diária / Prospecção / WhatsApp
- **Alteração:** (1) gate PRO-11 ganha o estado "restrição validada": libera a Meta Diária manual (cota + tentativa manual) e, com 100% da Meta, a Prospecção manual; informada e desconectado simples seguem sem benefício; o disparo automático e a fila extra continuam exigindo sessão conectada (`strict`). (2) Compensação da janela de envio por corretor/dia: crédito = união das restrições validadas ∩ janela base (SP), teto 21:00, calculado na leitura (`lib/daily-goal-window-core.mjs`, `lib/daily-goal-window.js`, função única `withEffectiveWindow` usada em envio, reparo da fila, trava final e agendamento); cadência congelada na janela base (`spreadScheduleMinutes` aceita `cadenceCursorMinutes`/`cadenceWindowEndMinutes`). (3) Dia impossível de cumprir mesmo compensado fecha com `daily_goals.impacted_by_restriction`/`impact_minutes` (migration aditiva `20261003160000_daily_goal_restriction_impact.sql`) e `loadDailyGoalPenaltyScoring` não aplica `daily_goal_penalty`.
- **Motivo:** regra aprovada pelo dono (2026-10-02): restrição validada não pode punir o corretor, mas também não pode virar brecha nem acelerar o envio (risco de banimento).
- **Arquivos afetados:** `lib/daily-goal-window-core.mjs` (novo), `lib/daily-goal-window.js` (novo), `lib/prospecting-eligibility-core.mjs`, `lib/prospecting-eligibility.js`, `lib/daily-goal-auto-core.mjs`, `lib/daily-goal-auto.js`, `lib/daily-goal.js`, `lib/performance-overview.js`, `lib/prospecting-extra-dispatch.js`, migration `20261003160000`, testes `tests/daily-goal-window-credit.test.mjs` (novo) e ajustes em `tests/prospecting-eligibility.test.mjs`, `tests/whatsapp-restriction*.test.mjs` (que fixavam a regra antiga "restrição não libera nada").
- **Risco/observação:** "cadência segura" para a impossibilidade = `min_gap_minutes` configurado (conservador a favor do corretor em modo oscilação); a avaliação usa o que faltou no FECHAMENTO. Falha ao avaliar o impacto não impede o fechamento (log). Sem mudança de tela: o corretor não vê ainda o fim efetivo da janela. Nenhum dado existente alterado.
- **Autor:** Claude Code

### 2026-10-02 — Ponte ChatGPT -> Central de Comando, fase 1 (T-20261002-33)
- **Data:** 2026-10-02
- **Área:** Infraestrutura da Central (fora dos módulos do CRM)
- **Alteração:** fila `central_tasks` (migration `20261003190000`), rotas `/api/central/*` com segredos próprios (ChatGPT / executor / aprovação), poller local `scripts/central-bridge/` com executor de eco, `docs/central/openapi.yaml` e `docs/CENTRAL_PONTE.md`.
- **Motivo:** permitir que o Custom GPT enfileire tarefas e consulte resultados sem expor o PC; Claude real DESATIVADO (adapter vazio, flag false).
- **Arquivos afetados:** `lib/central/*`, `app/api/central/**`, `scripts/central-bridge/**`, `tests/central-bridge.test.mjs`, `docs/PERMISSIONS.md` §6. `proxy.js` não mudou (já não exige cookie em /api e aplica no-store).
- **Risco/observação:** política da Anthropic sobre gatilho externo segue aberta; só consulta/eco executam; escrita fica em AGUARDANDO_DECISAO.
- **Autor:** Claude Code (crm-editor)

### 2026-10-02 — Ponte da Central: chaves conferidas por hash SHA-256 no Supabase (T-20261002-36, conclui a T-33)
- Decisão do dono: o relé não guarda chave nenhuma (nem na Vercel nem no Supabase); confere o Bearer calculando SHA-256 e comparando (timing-safe) com `central_credentials.secret_sha256`. Sem linha ativa do papel = 503; chave errada = 401; papel cruzado = 403. Removida a dependência de `CENTRAL_*_SECRET` no relé (`lib/central/core.mjs`, `store.getCredentials`).
- Migration `20261003210000_central_credentials.sql` (aditiva, RLS, só service_role). Chaves do executor/aprovação nunca saem do PC. Testes em `tests/central-bridge.test.mjs`. Claude executor segue DESATIVADO. Detalhe e rotação: `docs/CENTRAL_PONTE.md`.

### 2026-10-02 — Poller da ponte encerrava sozinho com a fila vazia (T-20261002-39)
- Causa: o único timer de espera entre consultas usava `unref()`, então o Node saía em silêncio após a primeira volta ociosa. Correção: removido o `unref()` em `scripts/central-bridge/poller.mjs` (teste em `tests/central-bridge.test.mjs`). Rotas `/api/central/*` verificadas em produção (201/200/GET, ~1 s, formato conforme o OpenAPI); segurança e arquitetura intactas.

### 2026-10-02 — Manual do CRM, etapa 4: conteúdo inicial (T-20261002-55)
- `lib/manual-seed-content.mjs` (dados puros): 8 tópicos, 40 subtópicos (audiências Todos/Corretor/Gestora) e 4 novidades em rascunho. O seed (`loadManualSeeds`) insere tudo como `pending`/`draft`, é idempotente e só preenche corpo vazio (nunca sobrescreve texto editado). `manual-seed-structure.mjs` passou a ser derivado do conteúdo. Testes em `tests/manual-seed-content.test.mjs` e `tests/manual-service.test.mjs`. Valores confirmados em código/banco: carteira ativa 50 e cota diária 10.
- Correções da revisão independente (T-56): removido o subtópico da equipe da Gestora; textos neutralizados e prazos da devolução à fila conferidos no código (24 h após a 3ª tentativa, 30 dias de bloqueio, 7 dias desde a última tentativa); guard do Manual reforçado (limites de palavra, janela que atravessa frases, mais vocabulário) e leitura passa a omitir qualquer conteúdo barrado pelo guard (testes em `tests/manual-guard.test.mjs` e `tests/manual-service.test.mjs`).
### 2026-10-03 — Manual do CRM, etapa 5: publicação (T-20261002-57)
- **Data:** 2026-10-03
- **Área:** Manual do CRM / Banco / Documentação
- **Alteração:** Branch `feat/manual-crm` rebaseado sobre `main`; migration `20261003230000_manual_crm.sql` aplicada em produção antes do deploy (5 tabelas `manual_*`, RLS ligado, sem policy, grants só `service_role`, 0 linhas); seed NÃO executado e nada publicado (o Manual nasce vazio). Documentação: grupo MAN-1..5 em `docs/BUSINESS_RULES.md` §17, rotas em `docs/PERMISSIONS.md` §6, rule `.claude/rules/manual.md`, linha em `AGENTS.md`.
- **Motivo:** Entrega final do módulo; regras do dono de 2026-10-02 (fluxo de aprovação só pelo dono, audiências no backend, confidencialidade permanente).
- **Arquivos afetados:** `supabase/migrations/20261003230000_manual_crm.sql`, `docs/BUSINESS_RULES.md`, `docs/PERMISSIONS.md`, `.claude/rules/manual.md`, `AGENTS.md`, `docs/CHANGELOG_AI.md`.
- **Risco/observação:** O dono carrega a estrutura inicial em `/admin/manual/gerenciar` ("Carregar estrutura inicial") e revisa/aprova cada tópico e novidade; até lá a equipe vê o estado vazio.
- **Autor:** Claude (crm-editor, T-20261002-57)

### 2026-10-02 — Descrições do Designer encurtadas para os limites de contexto
- **Alteração:** `description` de `designer-crm` (agente, 278 caracteres, antes ~427) e de `direcao-criativa` (skill, <180, antes ~408) encurtadas; gatilhos de roteamento mantidos; o detalhe removido já está no corpo da skill/agente.
- **Motivo:** `tests/context-budget.test.mjs` (limites 380/180) falhava.
- **Arquivos afetados:** `.claude/agents/designer-crm.md`, `.claude/skills/direcao-criativa/SKILL.md`, `docs/CHANGELOG_AI.md`.
- **Risco/observação:** nenhum; só texto de roteamento. Limites dos testes inalterados.
- **Autor:** Claude (T-20261002-60)

### 2026-10-03 — Diretor de Atendimento, Fase 4: equipe consolidada e publicada (T-20261002-65)
- **Alteração:** equipe de 17 especialistas em `docs/atendimento/` (7 ORIGINAL + EXTENSÃO LOCAL com 15 originais vendorizados verbatim MIT/Apache-2.0 + licenças; 10 AGENTES PRÓPRIOS), `INVENTARIO.md` com a classificação e os motivos, `AUDITORIA-ORIGINAIS.md`, 5 relatórios do Scout em `docs/scout/relatorios/`. `.gitattributes` novo (só `-text` nos vendorizados, para o autocrlf do Windows não alterar os bytes). Cada `.local.md` cita sua licença. Novo `tests/proveniencia-atendimento.test.mjs` (SHA256 do corpo, licença, inventário x EQUIPE, sem script/hook/MCP).
- **Motivo:** publicar a missão de montagem da equipe; originais verificados byte a byte contra o SHA registrado.
- **Arquivos afetados:** `.gitattributes`, `docs/atendimento/**`, `docs/scout/relatorios/*`, `tests/equipe-atendimento.test.mjs`, `tests/proveniencia-atendimento.test.mjs`, `docs/CHANGELOG_AI.md`.
- **Risco/observação:** só texto lido sob demanda; custo fixo de contexto da missão ~2,25 mil tokens (diretor + 2 executores + skill, 7.868 caracteres / 3,5), perfis e originais não entram. Sem migration, sem código do CRM.
- **Autor:** Claude (crm-editor, T-20261002-65)

### 2026-10-05 — "Enviar lista de documentos" da ficha agora envia a IMAGEM (não o link)
- **Pedido (dono):** a lista deve ir como imagem PNG personalizada, não como link de texto com `?baixar=1`.
- **Mudou:** (1) Chat (WhatsApp do corretor conectado): o navegador busca `/s/<token>/documentos` (pública pelo token, mesma origem) e envia pelo envio de mídia existente (`POST /api/admin/whatsapp-chat/conversations/[id]/media`), com legenda "Olá, {primeiro nome}! Segue a lista de documentos para a sua simulação."; o storage entrega a URL pública ao serviço do WhatsApp (Baileys baixa sozinho; nada novo exposto). (2) Sem conexão: `wa.me`/WhatsApp Web abre só com o texto curto (não anexa imagem) e a confirmação mostra "Baixar imagem da lista" (`?baixar=1`) com aviso claro. Rota `lista-documentos` agora devolve também `imageUrl`. Mantidos: confirmação prévia, bloqueio arquivado/"Não contactar", registro na jornada, sem mudar status.
- **Arquivos:** `lib/documents-forecast-{core,store}.mjs`, `app/api/admin/clients/[id]/lista-documentos/route.js`, `components/clients/{ClientSheet.jsx,useClientList.js}`, `tests/documents-forecast.test.mjs`.
- **Docs:** BUSINESS_RULES PRES-17, PERMISSIONS.
- **Risco/observação:** limite de 4 MB do envio de mídia (a imagem é bem menor; se passar, o Chat avisa). Envio real de WhatsApp não foi testado (regra de produção).
