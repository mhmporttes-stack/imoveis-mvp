# Supabase MCP estável (`Supabase`) e acesso somente leitura dos agentes

Implementado em 2026-10-02. O plano original (investigação anterior) não estava no repositório; este arquivo registra o que foi validado e aplicado.

## Problema

- Os agentes declaram ferramentas no padrão `mcp__Supabase__*` (`.claude/agents/*.md`).
- No app de desktop, o conector Supabase da conta aparece com prefixo UUID (`mcp__<uuid>__execute_sql`). Por isso `analista-dados`, `auditor-crm`, `gestor-trafego`, `gestor-financeiro`, `analista-documental` e `marketing-posicionamento` não recebiam `execute_sql`/`list_tables`.
- O "somente leitura" dos agentes analíticos era só instrução de prompt.

## Solução

1. **`.mcp.json` (projeto) — servidor estável `Supabase`**, oficial e hospedado, com escopo do projeto e modo leitura:
   `https://mcp.supabase.com/mcp?project_ref=tshhasbbchjcvhoyizoo&read_only=true&features=database,debugging,development,docs`.
   - `read_only=true`: o próprio servidor executa as consultas com um usuário Postgres somente leitura.
   - Ficam fora as ferramentas de escrita, de Edge Functions, de branches e de conta.
   - Autenticação por OAuth (registro dinâmico): uma vez por máquina, em `/mcp` → `Supabase` → *Authenticate*. Sem token no repositório.
   - `.claude/settings.json` traz `enabledMcpjsonServers: ["Supabase"]`, que só vale em pasta confiável. No desktop, aprove o servidor na primeira vez que o Claude Code perguntar.
2. **Hook `.claude/hooks/guard-destructive-sql.mjs`**, que vale para qualquer servidor Supabase. O matcher é `mcp__.*__execute_sql|mcp__.*__apply_migration`, então cobre o estável e o conector com UUID.
   - **Agentes analíticos** (`analista-dados`, `auditor-crm`, `gestor-trafego`, `gestor-financeiro`, `marketing-posicionamento`, identificados pelo `agent_type` do hook):
     - toda consulta recebe o prefixo `set transaction read only;`, e o Postgres recusa qualquer escrita, inclusive dentro de função (erro `25006`);
     - escrita explícita, `SET` e controle de transação são negados;
     - migration é negada.
     - Isso vale mesmo quando o agente usa o conector com acesso total, como acontece nas sessões na nuvem.
   - **Sessão principal e demais agentes:**
     - leitura passa sem pergunta;
     - escrita, DDL e migration pedem confirmação;
     - destrutivo (DROP, TRUNCATE, DELETE, UPDATE sem WHERE, GRANT/REVOKE, RLS/policy, papéis/senhas, secrets/vault, pg_cron, SECURITY DEFINER) pede confirmação com o motivo.
   - Testes simulados, sem banco: `tests/guard-destructive-sql.test.mjs`.
3. **Permissões (`.claude/settings.json`):**
   - leitura e diagnóstico do Supabase em `allow`;
   - `apply_migration` saiu de `allow` e foi para `ask`;
   - Edge Functions, branches, projeto e CLI `supabase` continuam em `ask`;
   - editar `settings.json`, hooks e `.env*` continua em `ask`.

## Escrita no banco (migrations, correções de dados)

Vai pelo conector da conta (desktop: `mcp__<uuid>__…`; nuvem: `mcp__Supabase__…`), sempre com confirmação pelo hook. O servidor `Supabase` do projeto é somente leitura e não aplica migration.

## Duplicidade (conector da conta × servidor do projeto)

- O Claude Code deduplica conector e servidor pela URL, não pelo nome (docs oficiais de MCP, "scope hierarchy").
- A URL do projeto tem `project_ref`/`read_only`, então os dois convivem.
- **Desktop:** o conector tem nome UUID e o do projeto se chama `Supabase`, sem conflito de nome. Os agentes usam o `Supabase` (leitura) e a sessão principal usa o conector para escrever.
- **Nuvem (claude.ai/code):** o conector da conta já se chama `Supabase`. Ver o resultado da validação em sessão nova no `docs/CHANGELOG_AI.md` (2026-10-02).

## Validação (2026-10-02)

- `analista-dados` real via `/analisar-funil 2026-09-28 a 2026-10-01`:
  - recebeu `mcp__Supabase__execute_sql`/`list_tables`;
  - `select current_setting('transaction_read_only')` devolveu `on`, o que mostra o hook aplicado na chamada real do subagente.
- Escrita dentro de `set transaction read only` (INSERT de zero linhas, que não altera nada em nenhum caso): `ERROR 25006: cannot execute INSERT in a read-only transaction`. A chamada seguinte voltou a `transaction_read_only = off`, então o modo não vaza.
