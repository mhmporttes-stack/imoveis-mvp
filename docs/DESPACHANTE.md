# Despachante e autonomia dos agentes

> Criado em 2026-10-02. Fonte dos fatos: ferramentas reais expostas à sessão do Claude Code Desktop nesta data + configuração do repositório. O que não pôde ser provado está marcado **A CONFIRMAR**.

## 1. Fluxo
`Matheus → Despachante → (Agent em segundo plano) → especialista(s) → notificação volta → Despachante registra → resposta curta`.
Arquivos: `.claude/agents/despachante.md` (comportamento), `.claude/despachante/MAPA-AGENTES.md` (quem faz o quê), `.claude/despachante/REGISTRO.md` (tarefas), skill `/despachar`.

## 2. O que a plataforma realmente permite (verificado)
| Capacidade | Situação | Base |
|---|---|---|
| Subagente em segundo plano | **Sim.** `Agent` roda em background por padrão; a sessão principal fica livre e é notificada ao terminar | descrição da própria ferramenta `Agent` desta sessão |
| Vários em paralelo | **Sim** (várias chamadas `Agent` na mesma resposta) | idem; limite numérico **A CONFIRMAR** (pesquisa citou 20 por padrão) |
| Retomar/falar com um agente | **Sim**: `SendMessage` (por nome/ID, retoma do transcript); `ListAgents` mostra quem está ocupado | descrições de `SendMessage`/`ListAgents` |
| Outras sessões do app | Listar/ler metadados e **enviar mensagem** a sessões existentes (`list_sessions`, `SendMessage`); **não há ferramenta para criar sessão nova** nesta build | ferramentas `ccd_session_mgmt` carregadas; `start_session` é citado na descrição mas **não está exposto** |
| Sessão nova independente | Só pelo usuário (nova aba/sessão) ou chip `spawn_task` (um clique do dono) | `mcp__ccd_session__spawn_task` |
| Worktree por tarefa | `EnterWorktree` / `isolation: worktree` existem; **não usados** aqui (deploy = push em `main`; dois agentes de escrita na mesma área ficam em fila em vez de gerar merge) | decisão deste projeto |
| Subagente aninhado | Pesquisa indicou até 3 níveis; **A CONFIRMAR** neste app. O design evita depender disso: só o Despachante delega | pesquisa |
| Agente como “chat de entrada” | `claude --agent despachante`, seletor de agente da sessão, ou skill `/despachar` em qualquer chat | **A CONFIRMAR** o seletor no Desktop; a skill funciona sempre |
| Pergunta ao dono vinda de agente em segundo plano | **Não** (background não interage). Por isso o protocolo `DECISÃO NECESSÁRIA` | design |
| Ferramenta não pré-aprovada em segundo plano | Tende a ser **negada** (não há quem aprove) → a lista `allow` precisa cobrir o trabalho rotineiro | **A CONFIRMAR** por teste (§7) |

Limite honesto: o Despachante só acompanha o que está **neste app aberto**; se a sessão fechar, o registro em arquivo é a memória.

## 3. Por que você recebe tantos pedidos de autorização (auditoria)
**A) Confirmações inúteis (operacionais)**
1. `defaultMode` não definido → modo padrão pergunta tudo que não está na lista.
2. A lista `allow` só cobre `Bash`. Você está no **Windows**, onde as sessões usam `PowerShell` — nenhum comando PowerShell está liberado (prova: `settings.local.json` acumulou 5 comandos PowerShell avulsos, aprovados um a um).
3. Sem liberação para `Agent`, `Skill`, `SendMessage`, `WebFetch`, `WebSearch` → delegar a um especialista e pesquisar na web pedem permissão.
4. Conector Supabase da conta (prefixo UUID): só `execute_sql`/`apply_migration` estavam liberados; `list_tables`, `get_advisors`, `query_logs`… pedem permissão. Windsor (leitura) e navegador embutido também.
5. `Supabase` estável do `.mcp.json` **não conecta** (401, `SUPABASE_ACCESS_TOKEN` ausente/inválido neste ambiente) → agentes analíticos ficam sem banco e empurram você para o conector.
6. Subagentes em segundo plano não conseguem pedir autorização: tudo que não está na lista falha ou trava.
7. Mensagem do hook de SQL é técnica (“SQL de alto risco…”), sem o impacto em português.

**B) Decisões que merecem você:** escolha de produto com mais de um caminho correto; apagar/alterar dado real em massa; migration em produção; publicar o que você não pediu; enviar mensagem/e-mail/push real; mexer em campanha/orçamento (Meta), perfil Google (Windsor `execute_action`).

**C) Proteções que permanecem (não mexer):** hook `guard-destructive-sql.mjs` (SQL destrutivo/escrita/migration pedem confirmação; agentes analíticos em `SET TRANSACTION READ ONLY`); `ask` para `git push --force`, `reset --hard`, `clean`, `rm`, `vercel env|rm|domains`, CLI `supabase`, branches/pausa/restauração de projeto, edição de `.env*`, `settings.json` e hooks; `.mcp.json` com `read_only=true`; `apply_migration` sempre pede.

## 4. Mudança de permissões — STATUS: **proposta, não aplicada**
O app bloqueou a edição de `.claude/settings.json` feita pelo agente (classificador de segurança: automodificação de permissões). A proposta (texto, nada em vigor) é: `defaultMode: "acceptEdits"` + liberação dos itens do §3-A (PowerShell rotineiro, `Agent`/`Skill`/`SendMessage`/web, leituras do conector Supabase/Windsor/navegador). **Não remove nenhuma proteção** (§3-C). Itens a somar em `permissions.allow` de `.claude/settings.json`: `Agent`, `Skill`, `SendMessage`, `ListAgents`, `TaskStop`, `AskUserQuestion`, `WebFetch`, `WebSearch`, `Write`; PowerShell: `Get-*`, `Select-String *`, `Test-Path *`, `git status*|diff*|log*|show*|add *|commit *|push *|pull *|fetch *|checkout *|switch *`, `pnpm *`, `node *`, `npx next *`; Bash: `date*`, `test *`, `cd *`, `npx tsc*`, `railway logs*`, `railway status*`; `mcp__Claude_Browser__*`; conector Supabase da conta (prefixo UUID `ec08adab…`): `list_tables`, `list_migrations`, `list_extensions`, `get_advisors`, `get_project`, `get_project_url`, `query_logs`, `search_docs`, `list_edge_functions`, `get_edge_function`, `list_branches`, `generate_typescript_types`; Windsor (leitura): `get_connectors|get_options|get_fields|get_data|list_actions`. E `permissions.defaultMode: "acceptEdits"`. Aplicação: o dono (ou outro chat com autorização explícita) edita o `settings.json`. Depois, rodar `node --test tests/despachante.test.mjs` (garante que as proteções continuam).
Não incluído de propósito: Windsor `execute_action` (escreve em Meta/Google), `railway up|variables`, `vercel env`, `rm`, `git push --force`.
Aviso: `git push` para `main` já estava liberado (= deploy). Continua valendo a regra “só publica se a tarefa pediu” (AGENTS.md).

## 5. Política de autonomia (vale para todos os agentes)
- **Sem perguntar:** ler, editar, criar arquivo, testes, build, lint, consulta somente leitura, diagnóstico, deploy/commit/push que a tarefa pediu, rotina necessária.
- **Pergunta ao dono (e só nestes casos):** (1) decisão de produto/negócio com mais de um caminho correto; (2) ação irreversível/destrutiva em dado real.
- **Forma da pergunta:** português simples, sem SQL/comando; opções com consequência; impacto concreto (“apagará definitivamente N mensagens de M clientes”). O dono decide o impacto, o agente decide a técnica. Quando for possível, o agente **conta** o que será afetado com consulta somente leitura antes de perguntar.
- **Em segundo plano** o agente não pergunta: termina com `DECISÃO NECESSÁRIA` (formato em `.claude/agents/despachante.md`); o Despachante traduz, pergunta e retoma com `SendMessage`.
- Proteções do banco nunca são contornadas para “ganhar tempo”.

## 6. Pendências de decisão do dono
1. Aplicar a proposta de permissões (§4).
2. Corrigir `SUPABASE_ACCESS_TOKEN` (token pessoal válido no ambiente) para o MCP estável voltar.
3. Criar ou não agentes dedicados **WhatsApp**, **Alexa** e **Diretor** (hoje `crm-editor`; ver `MAPA-AGENTES.md`).
4. Mensagens do hook de SQL em português com impacto: editar o hook também cai em `ask`/bloqueio do app; fica como melhoria futura (o Despachante já traduz).

## 7. Testes
- `tests/despachante.test.mjs`: mapa cobre todos os agentes; frontmatter do Despachante (sem Bash/PowerShell, com `Agent`); registro só com estados válidos; **invariantes de segurança** (`ask` de migration/force-push/rm, hook registrado, `.mcp.json` `read_only=true`, sem `bypassPermissions`/`dontAsk` como padrão).
- Simulação de duas tarefas em paralelo: ver `docs/CHANGELOG_AI.md` (entrada de 2026-10-02).
