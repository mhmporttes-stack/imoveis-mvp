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

1. Acrescente a entrada **no topo** da seção “Registro” (mais recente primeiro).
2. Uma entrada por mudança lógica (não uma por arquivo). Escreva em **português do Brasil**, objetivo e sem jargão desnecessário.
3. **Nunca** inclua tokens, segredos, valores de variáveis de ambiente, dados pessoais de clientes ou telefones/e-mails reais.
4. Se a alteração afetou regras/arquitetura, **atualize também** o documento correspondente em `docs/` (e diga qual na entrada).
5. Se algo não pôde ser provado no código, escreva **A CONFIRMAR** — não invente.
6. Não apague entradas antigas. Para corrigir uma, acrescente uma nova referenciando a anterior.

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
