---
paths:
  - "lib/client-*.js"
  - "lib/simulation-*.js"
  - "lib/simulations.js"
  - "lib/crm.js"
  - "lib/crm-clients.js"
  - "lib/performance-overview.js"
  - "lib/document-status-labels.js"
  - "lib/do-not-contact-reasons.js"
  - "lib/journey-presentation.js"
  - "components/clients/**"
  - "components/ClientJourney*.jsx"
  - "components/RegistrationDetails.jsx"
  - "app/minha-jornada/**"
  - "app/admin/simulacoes/**"
  - "app/api/simulation-registrations/**"
  - "app/api/client-*/**"
---

# Clientes, status e funil comercial

## Fonte única de status

`lib/client-status.js` é a **única** fonte de verdade do enum `CLIENT_STATUS` e de qualquer agrupamento derivado dele (`ACTIVE_CLIENT_STATUS_VALUES`, `CLIENT_FUNNEL_STAGES`, `CLIENT_STATUS_META`, `CLIENT_FUNNEL_SALE_STATUS_VALUES`). **Nunca crie uma cópia local de um conjunto de status em outro arquivo** — já houve um bug real de produção assim: `lib/crm.js` mantinha sua própria cópia de "status ativos" para o contador de "aguardando ação" do dashboard, ficou desatualizada (faltavam `meeting_pending`/`meeting_done`) e subcontava clientes por meses até ser corrigida importando de `client-status.js`.

Cliente principal: `simulation_registrations` (persistência em `lib/simulation-registrations.js`). Um cliente pode ter uma `simulation` associada (`lib/simulations.js`) — a lista principal (`components/clients/`, lógica em `useClientList.js`) agrupa os dois.

## Macroetapas do funil (7, não 8 — comentário antigo no código já corrigido)

`service → simulation → documentation → approval → approved → meeting → sale`, mais "Prospecção" (base, fora do array, tratada em `performance-overview.js`) e "Arquivados"/"Não contactar" (fora do funil ativo). Reprovado/Restrição/Blindagem **não tiram o cliente do funil** — continuam contando dentro da macroetapa "Aguardando aprovação" (regra de negócio explícita).

## `person_role` vs `person_label` — nunca use texto livre como identidade

Se uma funcionalidade nova precisar identificar "qual pessoa" (titular/cônjuge/dependente/outro) dentro de um cliente, use sempre um campo de enum estável (`person_role`), nunca um texto livre extraído por IA ou digitado (`person_label`, que varia entre acentuação/capitalização entre reanálises). Isso já causou duplicidade real de registros no módulo de documentação e um bug de agrupamento errado na tela — ambos corrigidos. `person_label` só serve para exibição amigável, nunca para chave de agrupamento/dedupe/upsert.

## Funil comercial (`lib/performance-overview.js`)

O funil é **cumulativo por design**: se um cliente já alcançou "Aprovado", ele também conta em "Atendimento"/"Simulação"/"Documentação" mesmo sem um evento próprio registrado nessa etapa intermediária dentro do período — olha o histórico completo (sem limite de data) do cliente para achar a etapa mais avançada já alcançada. Isso é intencional (garante um funil de verdade, decrescente) e **não é um bug** — não "corrija" isso removendo a cumulatividade sem pedido explícito.

O que **já foi** um bug real (corrigido 2026-09-22): a coorte de "quem entra no funil do período" (`getProspectingClientIds`) só incluía clientes com evento formal de prospecção (fila manual/Meta Diária) ou link direto. Um cliente cadastrado direto pelo corretor (sem passar pela fila) nunca gerava esse evento e ficava invisível no funil mesmo fechando venda dentro do período. Corrigido incluindo também: cliente criado no período E cliente que AVANÇOU de etapa (`client_status_history` com `new_status` numa etapa do funil) no período — refinado em 2026-09-24: mudança para Não contactar/Arquivado/Aguardando retorno NÃO inclui o cliente (um cliente de teste aprovado dias atrás aparecia como "Aprovações: 1" só por ter sido marcado Não contactar hoje). Se o funil parecer "não bater com a data" de novo, comece verificando essa função antes de qualquer outra hipótese.

## Rótulos e labels — fonte única

`lib/document-status-labels.js` centraliza rótulos de estado civil, tipo de renda, status de documento e papel da pessoa — usado tanto pela tela de documentação quanto pelo PDF gerado. `lib/do-not-contact-reasons.js` centraliza os motivos de "não contactar novamente" (o backend em `lib/daily-goal-wallet.js` é `server-only`, por isso o componente client precisa importar do arquivo compartilhado, não duplicar a lista). Ao adicionar um rótulo/enum novo que aparece em mais de um lugar (tela + PDF + WhatsApp, por exemplo), pare e pergunte: existe uma fonte única para isso, ou vou criar mais uma cópia que pode divergir?

## Tags e jornada pública

- Tags: `tags` + `client_tags` (tabela associativa), gerenciadas em `lib/client-tags.js`. Mudança de tags grava eventos na timeline do cliente — ver o ponto único de escrita em `.claude/rules/automacoes-notificacoes.md`.
- **[REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-04] Etiquetas (tags):** qualquer perfil logado (inclusive corretor e associado) CRIA etiqueta nova e marca/desmarca em clientes do próprio escopo. **Só dono (admin) e gestor** apagam etiqueta (`DELETE /api/client-tags/[id]` = `requireBrokerManagementApi`; apagar remove o vínculo de todos os clientes) e mudam a cor de uma já existente (`POST` com nome repetido recolore só para admin/gestor; para corretor/associado devolve a existente intacta). A lixeira "Excluir do sistema" só aparece para admin/gestor, mas a barreira é o guard da rota. Chamadas internas (`addTagToClient`, tag do corretor em `lib/admin-profiles.js`) seguem usando `createTag` (upsert) como antes.
- **[REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-04] Notas internas de empreendimento** (`internalNotes`, "Informações internas"): só admin e gestor veem. Corretor/associado veem nome, fotos, região, diferenciais, condições comerciais (`terms`/`salesText`) e e-book. Filtro no SERVIDOR (`lib/property-visibility.js`) antes de passar props a qualquer componente; telas novas que listem empreendimento para qualquer perfil devem passar por ele.
- "Minha Jornada" (`/minha-jornada/[token]`, spec completa em `docs/minha-jornada.md`): página pública sem login, token de 256 bits, mostra progresso do cliente numa linguagem amigável. Tabelas: `client_journeys` (token, maior progresso já alcançado, estado anterior), `client_journey_events` (timeline), `client_origins` (origem/campanha/UTM). A página pública recebe só uma allowlist de campos, nunca o registro completo. Avisos manuais de WhatsApp são registrados como "acionamento", não como confirmação de entrega/leitura.
- `client_status_history` é gravado **pelo código** (`recordClientStatusChange`, `lib/client-status-history.js`) — **não existe trigger de banco** para ele (divergência D-2, reconciliada em 2026-10-01). Consequência: uma mudança de `status` feita por UPDATE direto sem chamar essa função não entra no histórico, nem no funil/pontuação que leem essa tabela (problema conhecido P-02 em `docs/SYSTEM_ARCHITECTURE.md` §13). Avisos da jornada NÃO são inseridos ali, para não distorcer pontuação/relatórios que leem esse histórico. (Os triggers que existem em `simulation_registrations` são outros: `capture_client_journey`, `guard_client_identity`, criação de venda financeira.)

## Prospecção/roleta como origem de cliente

Um cliente pode entrar no CRM por: link pessoal do corretor, link de "equipe" (roleta), cadastro manual pelo corretor, ou fila de prospecção (Meta Diária/Base da Imobiliária). `classifyClientOrigin` (`lib/crm-automations.js`) categoriza isso (`"form"`/`"manual"`/etc.) — usado por automações e pelo funil. Ver `.claude/rules/roleta-prospeccao-campanhas.md` para o fluxo completo.

- **Botão WhatsApp do card [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-02]:** o destino vem do estado REAL da sessão do corretor (`lib/client-card-whatsapp-core.mjs`): conectado → Chat interno; desconectado ou restrição informada/validada → WhatsApp Web (desktop) / app (celular/PWA). Nunca decidir "por ser mobile". Estado desconhecido, cliente arquivado/Não contactar, cliente de outro responsável ou telefone inválido → Chat. Não altera status/elegibilidade/Prospecção. Detalhe: WA-13a em `docs/BUSINESS_RULES.md`.

## Contato humano, primeiro contato e tempo de resposta

**[REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-03] PRIMEIRO CONTATO** = entrada do lead → **primeira mensagem humana efetivamente enviada ao cliente**. **Não conta:** clique no botão WhatsApp, abertura de conversa, nota interna, mensagem automática (Fluxo, palavra-chave, Disparo, Meta Diária e o eco dela no celular), tentativa sem evidência de envio (status `failed`), reação, histórico importado. A autoria é preservada (`whatsapp_messages.sender_user_id`).
**[REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-03] TEMPO DE RESPOSTA** = **mensagem do cliente → primeira resposta humana subsequente**, em **TEMPO BRUTO** (sem desconto de expediente; não misturar com um futuro "dentro do expediente"). Só a definição foi registrada (`docs/METRICAS_FUNIL.md` MET-6): nenhum painel, alerta ou métrica nova.
**[REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-03] Separar três coisas:** (1) o cliente recebeu atendimento humano — resposta de gestor/admin conta; (2) **autoria** — quem enviou de verdade, nunca atribuída ao responsável; (3) responsável atual. Gestor/admin respondendo NÃO é ação do corretor responsável (o marco "Atendimento automático → Em atendimento" só fica no nome do responsável quando quem enviou é ele ou o associado dele).
**[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO — P-11 resolvido em 2026-10-03]** Fonte única: `registerHumanContact` (`lib/whatsapp-human-contact.js`; regra pura em `lib/human-contact-core.mjs`), chamada pelos 3 envios do Chat (texto, modelo, mídia/atalho) e por `recordBrokerAppMessage` (mensagem pelo celular). Grava a conversa (`last_human_reply_at`) e o cliente (`last_whatsapp_contact_at`, só avança) e aplica o status do Chat (WA-9). Celular com conversa sem `client_id`: procura pelo telefone (`findRegistrationsByPhone`) e só vincula com candidato único (CLI-4), nunca com cliente arquivado nem número da equipe. **Não crie outro ponto que grave contato humano.** O clique no botão continua gravando `last_whatsapp_contact_at` pelo caminho dele (não é mensagem enviada). Ver `docs/BUSINESS_RULES.md` WA-4a.
**[REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-03]** Resposta de gestor/admin (ou de quem não é o responsável nem o associado dele) conta como cliente atendido (conversa + autoria na mensagem + `changed_by` do status = autor real), mas **não grava `last_whatsapp_contact_at`**: não credita ao corretor responsável pendência/progresso da Meta Diária nem pontuação por contato. Sem campo novo (`contactCreditsResponsible`, `lib/human-contact-core.mjs`).
