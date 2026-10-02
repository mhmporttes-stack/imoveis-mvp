# Ponte ChatGPT -> Central de Comando (Fase 1)

Infraestrutura da ponte. **O Claude NAO executa nada nesta fase** (executor de eco apenas).

## Arquitetura
Custom GPT (Action HTTPS) -> `/api/central/*` na Vercel -> tabela `central_tasks` (Supabase) -> poller local no PC (so conexoes de saida, nenhuma porta aberta) -> executor (eco) -> resultado no rele -> Action consulta -> ChatGPT apresenta.

- Nucleo puro: `lib/central/core.mjs` (zod estrito, auth, handlers); store Supabase: `lib/central/store-supabase.js`; rotas finas em `app/api/central/**`.
- Banco: migrations `20261003190000_central_tasks.sql` (fila) e `20261003210000_central_credentials.sql` (hashes das chaves); fila: (RLS ligado, so service_role; claim com `FOR UPDATE SKIP LOCKED` + lease de 120 s, max 3 tentativas).
- Texto do ChatGPT e NAO CONFIAVEL: guardado em envelope `{schema:1, trust:"untrusted", source:"chatgpt", tipo, instruction_text}`. So `consulta` e `eco` entram como AGUARDANDO; qualquer outro valor/ausencia = `escrita` -> `AGUARDANDO_DECISAO`. A unica saida desse estado e `POST /api/central/approver/tasks/{id}/decision` com a credencial de aprovacao (ou `scripts/central-bridge/approve.mjs`). Aprovar so devolve a tarefa a fila; nesta fase o eco apenas ecoa.

## Rotas e credenciais (Bearer; nunca cookie de admin)
| Rota | Papel (central_credentials.role) |
|---|---|
| `POST /api/central/tasks`, `GET /api/central/tasks/{id}` | `chatgpt` |
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

## Claude real: DESATIVADO
`scripts/central-bridge/executors/claude.mjs` e adapter vazio: lanca erro mesmo com `CENTRAL_CLAUDE_EXECUTOR_ENABLED=true` (lida so do ambiente local, nunca do payload). Nao ha `child_process`/`claude -p`/Agent SDK no diretorio (teste estatico).

## Lacuna de politica pendente
A politica da Anthropic sobre disparar o Claude por gatilho externo ainda esta ABERTA (T-17/T-22/T-32). Ativar o executor Claude (Fase 2) so apos decisao do dono.
