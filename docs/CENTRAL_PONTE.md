# Ponte ChatGPT -> Central de Comando (Fase 1)

Infraestrutura da ponte. O executor padrao e o de eco; o executor Claude (somente leitura, so `consulta`) existe, mas fica DESLIGADO ate o dono ativar.

## Arquitetura
Custom GPT (Action HTTPS) -> `/api/central/*` na Vercel -> tabela `central_tasks` (Supabase) -> poller local no PC (so conexoes de saida, nenhuma porta aberta) -> executor (eco) -> resultado no rele -> Action consulta -> ChatGPT apresenta.

- Nucleo puro: `lib/central/core.mjs` (zod estrito, auth, handlers); store Supabase: `lib/central/store-supabase.js`; rotas finas em `app/api/central/**`.
- Banco: migrations `20261003190000_central_tasks.sql` (fila) e `20261003210000_central_credentials.sql` (hashes das chaves); fila: (RLS ligado, so service_role; claim com `FOR UPDATE SKIP LOCKED` + lease de 120 s, max 3 tentativas).
- Texto do ChatGPT e NAO CONFIAVEL: guardado em envelope `{schema:1, trust:"untrusted", source:"chatgpt", tipo, instruction_text}`. So `consulta` e `eco` entram como AGUARDANDO; qualquer outro valor/ausencia = `escrita` -> `AGUARDANDO_DECISAO`. A unica saida desse estado e `POST /api/central/approver/tasks/{id}/decision` com a credencial de aprovacao (ou `scripts/central-bridge/approve.mjs`). Aprovar so devolve a tarefa a fila; nesta fase o eco apenas ecoa.

## Rotas e credenciais (Bearer; nunca cookie de admin)
| Rota | Papel (central_credentials.role) |
|---|---|
| `POST /api/central/tasks`, `GET /api/central/tasks` (listarTarefas), `GET /api/central/tasks/{id}` | `chatgpt` |
| `POST /api/central/executor/claim`, `.../requeue`, `.../tasks/{id}/result`, `.../tasks/{id}/heartbeat` | `executor` |
| `POST /api/central/approver/tasks/{id}/decision` | `approver` |

Credencial de outro papel = 403; ausente/invalida = 401; papel sem hash ativo cadastrado (ou erro ao ler a tabela) = 503, falha fechado; limite de falhas por IP e por minuto (contagem no banco).

## Chaves conferidas por HASH (decisao do dono, T-36; substitui as variaveis da Vercel da T-33)
- O rele **nao tem chave nenhuma**: calcula SHA-256 do Bearer recebido e compara (timing-safe, 32 bytes fixos) com `central_credentials.secret_sha256` (hex, 64 chars, linha `active`). Sem fallback para variavel de ambiente: nenhuma variavel `CENTRAL_*_SECRET` existe na Vercel.
- Tabela `central_credentials` (role PK: chatgpt|executor|approver, secret_sha256, active, created_at, rotated_at): RLS ligado, so service_role. Os 3 hashes devem ser distintos. Hash nao autentica; a chave nunca e gravada no banco, no repositorio, em log ou resposta.
- As chaves do **executor** e da **aprovacao** ficam so no PC (`%USERPROFILE%\.central-bridge.env`: `CENTRAL_EXECUTOR_SECRET`, `CENTRAL_APPROVER_SECRET`). A do **ChatGPT** esta no mesmo arquivo (`CENTRAL_CHATGPT_SECRET`); e a **unica chave que o dono copia manualmente**, para a configuracao da Action no ChatGPT.
- Outras variaveis locais: `CENTRAL_BASE_URL` (padrao producao), `CENTRAL_POLL_SECONDS` (15), `CENTRAL_WORKER_ID`, `CENTRAL_EXECUTOR` (echo), `CENTRAL_CLAUDE_EXECUTOR_ENABLED` (false).
- **Rotacao:** gerar chave nova localmente (>= 32 caracteres aleatorios), gravar no arquivo local, calcular o SHA-256 em Node (nunca imprimir a chave) e atualizar so a linha do papel (`update central_credentials set secret_sha256 = '<hash>', rotated_at = now() where role = '<papel>'`) via conector Supabase. Desativar = `active = false` (papel passa a responder 503). Rotacionou a do ChatGPT: atualizar a Action.

## Rodar o poller (PC do dono)
```
C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe scripts\central-bridge\poller.mjs
```
Parar: Ctrl+C (termina a tarefa atual e sai). `--once` processa ate a fila esvaziar e sai. Ao iniciar, devolve a fila leases proprios expirados.

## Testar com eco
Crie tarefa `{"tipo":"eco","instruction_text":"oi"}` -> rode o poller -> consulte: resultado `PONTE_OK / task_id / recebido / executor: echo`. Testes: `node --test tests/central-bridge.test.mjs`.

## Action no ChatGPT
Importe `docs/central/openapi.yaml` (Authentication: API Key tipo Bearer, cole o valor de `CENTRAL_CHATGPT_SECRET` do arquivo local; feito pelo dono). As instrucoes sugeridas para o GPT estao no fim do arquivo.

### listarTarefas (somente leitura)
`GET /api/central/tasks?status=&tipo=&limite=&horas=&ordenar_por=` (mesma credencial `chatgpt`; limite 60/min). Padrao: 10 itens, maximo duro 50, mais recentes primeiro (`created_at`, ou `updated_at`); `horas` = janela (1 a 8760). Parametro desconhecido/invalido/repetido = 400 generico. Sem paginacao (limite + janela bastam). Por tarefa devolve so uma allowlist: `task_id, status, tipo, origem, executor` (worker, so durante a execucao), `instruction_summary` (200 chars, `instruction_truncated`), `created_at, updated_at, completed_at, has_result, awaiting_decision, error_summary` (200 chars). O resultado completo continua so em `verResultado(task_id)`. Apenas `select`; `PUT/PATCH/DELETE` nao existem (405). Depois de publicar, o dono precisa **reimportar o `openapi.yaml` na Action do ChatGPT** para a operacao aparecer. Testes: `tests/central-list.test.mjs`.

## Executor Claude (headless, SOMENTE LEITURA) — implementado, DESLIGADO por padrao
`scripts/central-bridge/executors/claude.mjs` chama `claude -p` (CLI do Claude Code) so quando **as duas chaves locais** indicam isso: `CENTRAL_EXECUTOR=claude` **e** `CENTRAL_CLAUDE_EXECUTOR_ENABLED=true` (lidas so do ambiente/arquivo local do PC, nunca do payload). Padrao: `echo` e `false`. Decisao do dono (T-78 Opcao A): so `consulta`.

**Regras impostas em codigo (nao pelo texto da tarefa):**
- So `tipo=consulta` (tipo do servidor e do envelope). `escrita`/`eco`/outro: recusado com erro antes de abrir qualquer processo, mesmo que a fila entregue (`escrita` segue em AGUARDANDO_DECISAO e nunca roda sozinha). Com `CENTRAL_EXECUTOR=claude`, tarefas `eco` tambem sao recusadas.
- Ferramentas: apenas `Read`, `Grep`, `Glob` (`--tools` + `--allowedTools`); `--disallowedTools` lista Bash, PowerShell, Edit, Write, MultiEdit, NotebookEdit, WebFetch, WebSearch, Task, Agent. `--restricted` (remove ferramentas de execucao, ignora settings de usuario/projeto, confina arquivos ao cwd), `--permission-mode dontAsk`, `--strict-mcp-config` (sem MCP), `--disable-slash-commands`, `--no-session-persistence`, `--settings` inline com `permissions.deny` de leitura (`.env*`, `.claude/settings*`, credenciais, `.git/**`, `node_modules/**`, `*.pem`, `*.key`, `.mcp.json`, `scratch/**`...). Nao usa `--bare` (ele desliga a autenticacao por assinatura). Nao usa `--max-turns` (nao consta no `--help` da versao 2.1.286); o limite e o timeout.
- `instruction_text` e entrada NAO CONFIAVEL: entra so por **stdin**, delimitado; nunca em argv/flags/shell/env/settings. O prompt de sistema (`--append-system-prompt`) diz isso. `spawn` com array de argumentos e `shell:false`; processo novo por tarefa.
- Env do filho por allowlist (PATH, USERPROFILE, APPDATA, TEMP etc.). Nao passa `CENTRAL_*`, `ANTHROPIC_API_KEY`, tokens, cookies, chaves.
- Saida: `--output-format json`; resultado redigido (JWT, chaves `sk-`/`sb_`/`ghp_`, Bearer, URL com senha, `NOME_SECRET=valor`, hash de 64 hex, bloco PEM e valores literais de variaveis secretas do ambiente) e truncado em **8000 caracteres** (limite do contrato `resultado`; termina com `[...resultado truncado em 8000 caracteres]`). stderr e descartado; erros viram mensagens genericas (`codigo N`, tempo limite, saida invalida, binario nao encontrado). Logs: so id curto, codigo, tempo — sem prompt nem env.
- Timeout padrao 120 s (`CENTRAL_CLAUDE_TIMEOUT_SECONDS`, 10–600): mata o processo (SIGKILL). Teto de 2 MB de stdout.
- Resultado grava pelo mesmo `client.complete` do echo (mesmo contrato do `verResultado`).

**Variaveis locais (arquivo `%USERPROFILE%.central-bridge.env` ou ambiente):** `CENTRAL_EXECUTOR`, `CENTRAL_CLAUDE_EXECUTOR_ENABLED`, `CENTRAL_CLAUDE_BIN` (caminho do `claude.exe`; o spawn nao usa shell, entao `.cmd` nao funciona), `CENTRAL_CLAUDE_CWD` (padrao: raiz do repo), `CENTRAL_CLAUDE_TIMEOUT_SECONDS`. O poller le a config so na partida: **reiniciar o poller** para aplicar.

**Testes:** `node --test tests/central-bridge.test.mjs` (runner injetavel/mocks; nada chama o Claude). Integracao real opcional: `CENTRAL_CLAUDE_INTEGRATION_TEST=1` (usa a assinatura; so local, so com autorizacao).

**Limitacao conhecida:** as regras `deny` de caminho e o `--restricted` sao mecanismos do Claude Code, nao verificados aqui contra uma execucao real (o teste real nao foi rodado, por ser uso da assinatura). Validar no teste de ativacao antes de confiar.

## Lacuna de politica pendente
A politica da Anthropic sobre disparar o Claude por gatilho externo ainda esta ABERTA (T-17/T-22/T-32). PENDENTE DE POLITICA (T-79): gatilho externo + autenticacao por assinatura. O executor ja esta implementado atras da flag desligada; ativar so apos decisao do dono.
