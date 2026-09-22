---
name: auditar-banco
description: Revisa schema, migrations, relacionamentos, constraints, RLS, triggers e consistência dos dados do banco Supabase do CRM imoveis-mvp. Use para uma auditoria dedicada de banco de dados, ou quando o usuário suspeitar de inconsistência de dados/schema.
---

# Auditoria de banco de dados

Leia `.claude/rules/database-supabase.md` primeiro — já documenta o padrão de migrations deste projeto, o modelo de RLS (habilitado sem policy pública na maioria das tabelas, proposital) e o inventário conhecido de tabelas.

## O que verificar

1. **Ordenação de migrations.** Liste `supabase/migrations/` ordenado por nome de arquivo e procure arquivos fora do formato `YYYYMMDDHHMMSS_` (14 dígitos) — o porquê isso importa está em `.claude/rules/database-supabase.md`. Já houve um bug real assim, corrigido — verifique se não voltou a acontecer com migrations novas.
2. **Migrations duplicadas/redundantes.** Dois arquivos criando o mesmo índice/constraint com definição equivalente, ou um arquivo copiado por engano de outro (conteúdo sem relação com o nome do arquivo).
3. **Índices ausentes em colunas de filtro frequente.** Para as tabelas mais consultadas (`simulation_registrations`, `client_document_checklist_items`, `client_journey_events`, `daily_goal_*`, `whatsapp_*`), confirme índice em `client_id`/`broker_id`/`responsible_user_id`/`status`/colunas usadas para ordenar listas grandes. Só reporte como achado se não houver nenhuma consulta real que precise (não sugira índice especulativo sem uso).
4. **RLS.** Toda tabela nova tem RLS habilitado? Alguma tabela tem RLS habilitado MAS ganhou uma policy pública que não deveria existir (verifique se há razão documentada, como `testimonials`)? Alguma tabela sensível está com RLS desabilitado?
5. **Constraints e integridade.** Chaves estrangeiras sem `on delete`/`on update` definidos onde deveriam existir; `check` constraints que não refletem mais o enum real do código (ex.: `CLIENT_STATUS` ganhou um valor novo em `lib/client-status.js` mas o `check` da coluna no banco não foi atualizado); UNIQUE constraints que podem estar violando uma regra de negócio real (ver o incidente histórico de telefone único, `.claude/rules/database-supabase.md`) — nunca recrie esse padrão.
6. **Triggers e funções.** Liste `create trigger`/`create or replace function` das migrations relevantes ao que está sendo investigado — confirme que o comportamento documentado no comentário da migration ainda bate com o código da função atual (funções podem ter sido substituídas por uma migration posterior sem atualizar o comentário da primeira).
7. **Consistência dos dados** (quando relevante à investigação): rode queries read-only contra produção (via script em `scratch/`, autenticado com a service role, apagado ao final) para confirmar hipóteses com números reais — nunca infira do schema sozinho quando dá pra confirmar com dado real.

## Regras

- Isto é uma auditoria — **não aplique nenhuma migration nova nem altere dado em produção** sem confirmar explicitamente com o usuário primeiro, mesmo que o achado pareça claramente um bug. Reporte o achado, proponha a correção, espere autorização para migrations que alteram schema (nem toda correção de código precisa dessa pausa — mas mudança de schema em produção sim).
- Todo achado precisa de evidência concreta (trecho da migration, resultado de query) — não especule sem verificar.
