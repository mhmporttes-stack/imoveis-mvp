# Ponte ChatGPT -> Central de Comando (Fase 1)

Infraestrutura da ponte. **O Claude NAO executa nada nesta fase** (executor de eco apenas).

## Arquitetura
Custom GPT (Action HTTPS) -> `/api/central/*` na Vercel -> tabela `central_tasks` (Supabase) -> poller local no PC (so conexoes de saida, nenhuma porta aberta) -> executor (eco) -> resultado no rele -> Action consulta -> ChatGPT apresenta.

- Nucleo puro: `lib/central/core.mjs` (zod estrito, auth, handlers); store Supabase: `lib/central/store-supabase.js`; rotas finas em `app/api/central/**`.
- Banco: migration `20261003190000_central_tasks.sql` (RLS ligado, so service_role; claim com `FOR UPDATE SKIP LOCKED` + lease de 120 s, max 3 tentativas).
- Texto do ChatGPT e NAO CONFIAVEL: guardado em envelope `{schema:1, trust:"untrusted", source:"chatgpt", tipo, instruction_text}`. So `consulta` e `eco` entram como AGUARDANDO; qualquer outro valor/ausencia = `escrita` -> `AGUARDANDO_DECISAO`. A unica saida desse estado e `POST /api/central/approver/tasks/{id}/decision` com a credencial de aprovacao (ou `scripts/central-bridge/approve.mjs`). Aprovar so devolve a tarefa a fila; nesta fase o eco apenas ecoa.

## Rotas e credenciais (Bearer; nunca cookie de admin)
| Rota | Credencial |
|---|---|
| `POST /api/central/tasks`, `GET /api/central/tasks/{id}` | `CENTRAL_CHATGPT_SECRET` |
| `POST /api/central/executor/claim`, `.../requeue`, `.../tasks/{id}/result`, `.../tasks/{id}/heartbeat` | `CENTRAL_EXECUTOR_SECRET` |
| `POST /api/central/approver/tasks/{id}/decision` | `CENTRAL_APPROVER_SECRET` |

Credencial errada para a rota = 403; ausente/invalida = 401; limite de falhas por IP e por minuto (contagem no banco). Segredos: >= 32 caracteres e distintos entre si; nao reutilizam `CRON_SECRET`.

## Variaveis
Vercel: `CENTRAL_CHATGPT_SECRET`, `CENTRAL_EXECUTOR_SECRET`, `CENTRAL_APPROVER_SECRET`.
Local (arquivo `%USERPROFILE%\.central-bridge.env`, fora do repositorio): `CENTRAL_EXECUTOR_SECRET`, `CENTRAL_APPROVER_SECRET`, `CENTRAL_BASE_URL` (padrao producao), `CENTRAL_POLL_SECONDS` (15), `CENTRAL_WORKER_ID`, `CENTRAL_EXECUTOR` (echo), `CENTRAL_CLAUDE_EXECUTOR_ENABLED` (false).
O segredo do ChatGPT fica no mesmo arquivo como `CENTRAL_CHATGPT_SECRET` (so para o dono colar na Action).

## Rodar o poller (PC do dono)
```
C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe scripts\central-bridge\poller.mjs
```
Parar: Ctrl+C (termina a tarefa atual e sai). `--once` processa ate a fila esvaziar e sai. Ao iniciar, devolve a fila leases proprios expirados.

## Testar com eco
Crie tarefa `{"tipo":"eco","instruction_text":"oi"}` -> rode o poller -> consulte: resultado `PONTE_OK / task_id / recebido / executor: echo`. Testes: `node --test tests/central-bridge.test.mjs`.

## Action no ChatGPT
Importe `docs/central/openapi.yaml` (Authentication: API Key tipo Bearer, cole `CENTRAL_CHATGPT_SECRET`). As instrucoes sugeridas para o GPT estao no fim do arquivo.

## Claude real: DESATIVADO
`scripts/central-bridge/executors/claude.mjs` e adapter vazio: lanca erro mesmo com `CENTRAL_CLAUDE_EXECUTOR_ENABLED=true` (lida so do ambiente local, nunca do payload). Nao ha `child_process`/`claude -p`/Agent SDK no diretorio (teste estatico).

## Lacuna de politica pendente
A politica da Anthropic sobre disparar o Claude por gatilho externo ainda esta ABERTA (T-17/T-22/T-32). Ativar o executor Claude (Fase 2) so apos decisao do dono.
