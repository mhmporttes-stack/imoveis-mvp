---
paths:
  - "supabase/**"
  - "**/*.sql"
  - "lib/supabase*.js"
  - "lib/db.js"
  - "scripts/**"
---

# Banco de dados e Supabase

Postgres 17 no Supabase, projeto `tshhasbbchjcvhoyizoo`, região `us-west-2`. ~160 migrations incrementais em `supabase/migrations/` (162 em 2026-10-01) (nenhum schema único "canônico" — o histórico de migrations É o schema).

## Como as migrations funcionam aqui

- Nome do arquivo: `YYYYMMDDHHMMSS_descricao.sql` (14 dígitos, timestamp completo). **Nunca use `YYYYMMDD_descricao.sql` (8 dígitos)** — a ordenação lexicográfica de string coloca esse formato DEPOIS de qualquer timestamp completo do mesmo dia, porque `_` (0x5F) vem depois dos dígitos em ASCII. Isso já causou um bug real: duas migrations de 21/09/2026 faziam `ALTER TABLE`/`CREATE INDEX` numa tabela que só era criada por um arquivo `YYYYMMDD_` do mesmo dia — em qualquer replay do zero, elas rodariam antes da tabela existir. Corrigido renomeando o arquivo-base para `..._000000_...`.
- **Não há `supabase/config.toml`** — este projeto não usa `supabase db push`/CLI para deploy de schema, então não há tracking de migrations aplicadas pela ferramenta. O fluxo real: escrever o `.sql`, aplicar direto em produção via script Node descartável usando o client `pg` com a connection string do `.env`, depois commitar o arquivo `.sql` (registro, não fonte de aplicação).
- Migrations usam `create table if not exists`, `create index if not exists`, `drop constraint if exists` antes de recriar — idempotência é o padrão esperado neste projeto, mantenha isso em migrations novas.
- Nomes de arquivo variam entre formatos ao longo do histórico (alguns dias têm `_leads_filters.sql` sem hora nenhuma) — isso é dívida técnica conhecida, não motivo para reproduzir o mesmo padrão em migrations novas.

## RLS não é a camada de autorização real

A maioria das tabelas tem `enable row level security` mas **sem nenhuma policy pública** — nenhuma linha é acessível para `anon`/`authenticated` diretamente. Isso é proposital: o app usa `SUPABASE_SERVICE_ROLE_KEY` no servidor (que ignora RLS) para tudo, e a autorização real acontece em código (`lib/admin-access.js`, `lib/admin-auth.js`). O advisor do Supabase avisa "RLS enabled, no policy" para essas tabelas — isso é esperado, não um bug a corrigir criando policies aleatórias.

Exceções com policy pública de verdade, por serem genuinamente lidas fora do servidor:
- `testimonials` — leitura pública dos depoimentos publicados (`supabase/migrations/20260714_testimonials.sql`).
- `admin_users` — policy "managed by service role" (reforço, não abre acesso).

Ao criar uma tabela nova: siga o padrão (RLS habilitado, sem policy pública) a menos que a tabela seja genuinamente destinada a leitura direta do browser com a anon key — nesse caso, escreva a policy explicitamente e documente por quê.

## Nunca recrie UNIQUE por telefone

Incidente real (corrigido 08/09/2026, ver `supabase/migrations/20260908204500_allow_repeat_simulation_phone.sql`): um índice `simulation_registrations_phone_normalized_unique` impedia um cliente de ser recadastrado com o mesmo telefone, quebrando a regra de negócio real (um telefone pode ter vários atendimentos distintos, inclusive com corretores diferentes — um novo atendimento é um novo registro, não uma fusão). Identidade de um cadastro é o `id`, nunca o telefone. Qualquer rotina que agrupe por telefone precisa ser revisada com cuidado para não fundir atendimentos que deveriam ser distintos.

## Inventário de tabelas

O inventário completo e verificado (~72 tabelas, funções/triggers SQL e jobs `pg_cron`) está em `docs/DATABASE.md` — não mantenha uma segunda lista aqui (a lista antiga, incompleta, foi para `docs/HISTORICO_REGRAS.md`). Antes de uma mudança de schema, confirme também contra o código: `grep -roh '\.from("[a-z_]*")' lib/ | sort -u`.

Para **ler** o estado real do banco (tabelas, advisors, `cron.job`, consultas de conferência), prefira as ferramentas do MCP do Supabase quando estiverem disponíveis na sessão (`list_tables`, `get_advisors`, `execute_sql` só com SELECT) em vez de um script com a service role. Escrita em produção continua exigindo pedido explícito.

## Fetch de listas grandes

Várias funções em `lib/*.js` usam um helper `fetchAllRows` que pagina em blocos de 1000 para contornar o limite padrão do PostgREST — ao escrever uma query nova que pode retornar mais de 1000 linhas, use o mesmo padrão em vez de `.select()` sem `.range()`/paginação (senão a lista trunca silenciosamente em 1000).

## Chave administrativa

`SUPABASE_SERVICE_ROLE_KEY` só é usada em código server-only (`lib/supabase.js` → `getSupabaseAdminClient()`, importado por arquivos com `import "server-only"` no topo). Nunca importe esse client num Client Component nem passe a chave para o browser.
