# Clientes, status e funil comercial

## Fonte única de status

`lib/client-status.js` é a **única** fonte de verdade do enum `CLIENT_STATUS` e de qualquer agrupamento derivado dele (`ACTIVE_CLIENT_STATUS_VALUES`, `CLIENT_FUNNEL_STAGES`, `CLIENT_STATUS_META`, `CLIENT_FUNNEL_SALE_STATUS_VALUES`). **Nunca crie uma cópia local de um conjunto de status em outro arquivo** — já houve um bug real de produção assim: `lib/crm.js` mantinha sua própria cópia de "status ativos" para o contador de "aguardando ação" do dashboard, ficou desatualizada (faltavam `meeting_pending`/`meeting_done`) e subcontava clientes por meses até ser corrigida importando de `client-status.js`.

Cliente principal: `simulation_registrations` (persistência em `lib/simulation-registrations.js`). Um cliente pode ter uma `simulation` associada (`lib/simulations.js`) — a lista principal (`AdminSimulationList.jsx`) agrupa os dois.

## Macroetapas do funil (7, não 8 — comentário antigo no código já corrigido)

`service → simulation → documentation → approval → approved → meeting → sale`, mais "Prospecção" (base, fora do array, tratada em `performance-overview.js`) e "Arquivados"/"Não contactar" (fora do funil ativo). Reprovado/Restrição/Blindagem **não tiram o cliente do funil** — continuam contando dentro da macroetapa "Aguardando aprovação" (regra de negócio explícita).

## `person_role` vs `person_label` — nunca use texto livre como identidade

Se uma funcionalidade nova precisar identificar "qual pessoa" (titular/cônjuge/dependente/outro) dentro de um cliente, use sempre um campo de enum estável (`person_role`), nunca um texto livre extraído por IA ou digitado (`person_label`, que varia entre acentuação/capitalização entre reanálises). Isso já causou duplicidade real de registros no módulo de documentação e um bug de agrupamento errado na tela — ambos corrigidos. `person_label` só serve para exibição amigável, nunca para chave de agrupamento/dedupe/upsert.

## Funil comercial (`lib/performance-overview.js`)

O funil é **cumulativo por design**: se um cliente já alcançou "Aprovado", ele também conta em "Atendimento"/"Simulação"/"Documentação" mesmo sem um evento próprio registrado nessa etapa intermediária dentro do período — olha o histórico completo (sem limite de data) do cliente para achar a etapa mais avançada já alcançada. Isso é intencional (garante um funil de verdade, decrescente) e **não é um bug** — não "corrija" isso removendo a cumulatividade sem pedido explícito.

O que **já foi** um bug real (corrigido 2026-09-22): a coorte de "quem entra no funil do período" (`getProspectingClientIds`) só incluía clientes com evento formal de prospecção (fila manual/Meta Diária) ou link direto. Um cliente cadastrado direto pelo corretor (sem passar pela fila) nunca gerava esse evento e ficava invisível no funil mesmo fechando venda dentro do período. Corrigido incluindo também: cliente criado no período E cliente com mudança de `client_status_history` no período. Se o funil parecer "não bater com a data" de novo, comece verificando essa função antes de qualquer outra hipótese.

## Rótulos e labels — fonte única

`lib/document-status-labels.js` centraliza rótulos de estado civil, tipo de renda, status de documento e papel da pessoa — usado tanto pela tela de documentação quanto pelo PDF gerado. `lib/do-not-contact-reasons.js` centraliza os motivos de "não contactar novamente" (o backend em `lib/daily-goal-wallet.js` é `server-only`, por isso o componente client precisa importar do arquivo compartilhado, não duplicar a lista). Ao adicionar um rótulo/enum novo que aparece em mais de um lugar (tela + PDF + WhatsApp, por exemplo), pare e pergunte: existe uma fonte única para isso, ou vou criar mais uma cópia que pode divergir?

## Tags e jornada pública

- Tags: `tags` + `client_tags` (tabela associativa), gerenciadas em `lib/client-tags.js`. Mudança de tags grava eventos na timeline do cliente — ver o ponto único de escrita em `.claude/rules/automacoes-notificacoes.md`.
- "Minha Jornada" (`/minha-jornada/[token]`, spec completa em `docs/minha-jornada.md`): página pública sem login, token de 256 bits, mostra progresso do cliente numa linguagem amigável. Tabelas: `client_journeys` (token, maior progresso já alcançado, estado anterior), `client_journey_events` (timeline), `client_origins` (origem/campanha/UTM). A página pública recebe só uma allowlist de campos, nunca o registro completo. Avisos manuais de WhatsApp são registrados como "acionamento", não como confirmação de entrega/leitura.
- `client_status_history` é gravado por trigger de banco em mudanças reais de status (inclusive por automação) — avisos da jornada NÃO são inseridos ali, para não distorcer pontuação/relatórios que leem esse histórico.

## Prospecção/roleta como origem de cliente

Um cliente pode entrar no CRM por: link pessoal do corretor, link de "equipe" (roleta), cadastro manual pelo corretor, ou fila de prospecção (Meta Diária/Base da Imobiliária). `classifyClientOrigin` (`lib/crm-automations.js`) categoriza isso (`"form"`/`"manual"`/etc.) — usado por automações e pelo funil. Ver `.claude/rules/roleta-prospeccao-campanhas.md` para o fluxo completo.
