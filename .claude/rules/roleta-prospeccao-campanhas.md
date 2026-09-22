# Roleta (distribuição de leads), prospecção e campanhas

## Links pessoais vs. roleta

Dois fluxos distintos, não confundir:

**Link pessoal** (`buildBrokerSimulationLink`/`buildBrokerCaptacaoLink`, `lib/admin-profiles.js`): o formulário público lê `?ref=` da URL, o backend resolve essa referência (`simulation_ref`/`captacao_ref`) em `admin_users`, e o cadastro é atribuído diretamente àquele usuário — **sem** a marca `distribution_type = 'round_robin'`. Vale também para gestor: cadastros do link pessoal dele pertencem a ele, não são distribuídos pra equipe automaticamente.

**Roleta** (`?ref=equipe`): aciona a função Postgres `assign_round_robin_lead`, que escolhe o próximo usuário ativo com distribuição habilitada (fila em `lead_distribution_state`, transação com lock para evitar corrida), grava `distribution_type = 'round_robin'` e histórico em `lead_distribution_history`. O recebedor vai para o fim da fila.

**Ponto de atenção herdado**: a atribuição via RPC acontece numa chamada separada do INSERT do cliente — uma falha depois da RPC pode avançar a fila sem o cadastro ser concluído (não é atômico). Se for mexer nesse fluxo, considere se vale a pena tornar atômico, mas não assuma que já é.

## Regra de retorno automático (round-robin sem contato)

Cliente de origem roleta sem contato registrado por WhatsApp dentro do prazo configurado deve voltar pra fila (transferência contínua). Implementado em `lib/prospecting-auto-return.js` — roda a cada carregamento da lista principal de clientes (não é um cron isolado hoje). Batching: usa `.in("id", ids)` agrupado por corretor em vez de um update por contato (já foi um N+1 real, corrigido).

## Fila de prospecção manual

`lib/prospecting.js` + `components/ProspectingManager.jsx`: assumir atendimento, registrar tentativa, marcar indisponibilidade temporária, devolver à fila, "não contactar" (com trava anti-abuso — 5 ações do mesmo usuário em 10 minutos dispara flag, ver `lib/daily-goal-wallet.js` `checkDoNotContactAbuse`), importação em lote, atribuição administrativa. Compartilha `prospecting_contacts`/`prospecting_history` com a Meta Diária — qualquer mudança de status/trava precisa considerar os dois consumidores.

`getTimeGreeting()` (`lib/daily-report.js`) é a fonte única da saudação por horário (bom dia/boa tarde/boa noite) usada nas mensagens — não duplique essa lógica num novo arquivo (já existiu uma cópia divergente em `daily-goal.js`, corrigida).

## Campanhas / Gerador de Links

Especificação completa em `docs/spec-gerador-de-links.md`. Resumo: **Gestão → Gerador de Links** cria URLs de campanha vinculadas a uma regra de distribuição (roleta ou corretor específico); o cadastro que chega por essa URL registra a origem permanentemente (`campaigns`, `campaign_link_views`) e ganha tag automática. **O cadastro convencional sem link de campanha permanece 100% inalterado** — não altere o fluxo padrão ao mexer em campanhas.

## Automações que tocam clientes de prospecção

Clientes desta fila também são alvo do motor de automações (`lib/crm-automations.js`) — a trava contra notificar cliente arquivado/não-contactar (`OUTREACH_TRIGGER_TYPES`/`OUTREACH_NEGATIVE_STATUSES`) é descrita em `.claude/rules/automacoes-notificacoes.md`; qualquer mudança na fila de prospecção que afete `client.status` deve considerar esse motor também.
