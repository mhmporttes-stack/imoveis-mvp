# Ponte ChatGPT -> Central de Comando (Fase 1)

Infraestrutura da ponte. O executor padrao e o de eco; o executor Claude existe, mas fica DESLIGADO ate o dono ativar: `consulta` (somente leitura) e, com uma flag propria, `escrita` aprovada (worktree isolada; ver "Escrita aprovada" abaixo).

## Arquitetura
Custom GPT (Action HTTPS) -> `/api/central/*` na Vercel -> tabela `central_tasks` (Supabase) -> poller local no PC (so conexoes de saida, nenhuma porta aberta) -> executor (eco) -> resultado no rele -> Action consulta -> ChatGPT apresenta.

- Nucleo puro: `lib/central/core.mjs` (zod estrito, auth, handlers); store Supabase: `lib/central/store-supabase.js`; rotas finas em `app/api/central/**`.
- Banco: migrations `20261003190000_central_tasks.sql` (fila) e `20261003210000_central_credentials.sql` (hashes das chaves); fila: (RLS ligado, so service_role; claim com `FOR UPDATE SKIP LOCKED` + lease de 120 s, max 3 tentativas).
- Texto do ChatGPT e NAO CONFIAVEL: guardado em envelope `{schema:1, trust:"untrusted", source:"chatgpt", tipo, instruction_text}`. So `consulta` e `eco` entram como AGUARDANDO; qualquer outro valor/ausencia = `escrita` -> `AGUARDANDO_DECISAO`. A unica saida desse estado e uma decisao registrada: `POST /api/central/tasks/{id}/approve|reject` (credencial `chatgpt` OU `approver`) ou `POST /api/central/approver/tasks/{id}/decision` / `scripts/central-bridge/approve.mjs` (so `approver`). Aprovar so devolve a tarefa a fila (nada executa no endpoint); quem executa e o poller, e a escrita so com as duas flags locais (abaixo).

## Rotas e credenciais (Bearer; nunca cookie de admin)
| Rota | Papel (central_credentials.role) |
|---|---|
| `POST /api/central/tasks`, `GET /api/central/tasks` (listarTarefas), `GET /api/central/tasks/{id}` | `chatgpt` |
| `POST /api/central/executor/claim`, `.../requeue`, `.../tasks/{id}/result`, `.../tasks/{id}/heartbeat` | `executor` |
| `POST /api/central/tasks/{id}/approve` (aprovarTarefa), `POST /api/central/tasks/{id}/reject` (rejeitarTarefa) | `chatgpt` **ou** `approver` (decided_by = o papel usado) |
| `POST /api/central/approver/tasks/{id}/decision` (legado), `POST /api/central/approver/tasks/{id}/resume` (retomar) | so `approver` |

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
Parar: Ctrl+C (termina a tarefa atual e sai) ou `poller-ctl stop` (abaixo). `--once` processa ate a fila esvaziar e sai. Ao iniciar, devolve a fila leases proprios expirados.

### Instancia unica, status/stop/check (`poller-lock.mjs`, `poller-ctl.mjs`)
O poller so roda **uma instancia por usuario**. Na partida cria, de forma atomica (flag `wx`), `%USERPROFILE%\.central-bridge.poller.lock` (fora do repositorio; `CENTRAL_BRIDGE_LOCK` troca o caminho) com `{pid, token, startedAt, processStartTime, bootTime, script, host}`. Segundo inicio: recusado com mensagem clara e **codigo de saida 3**, antes de consultar a fila. A trava e removida na saida (fim normal, Ctrl+C/SIGTERM, `process.exit`, excecao nao tratada; so se o token ainda for dele).

- **Como a trava prova que o dono esta vivo (e nao um PID reaproveitado):** o poller renova o arquivo a cada 10 s (mtime). Trava e **obsoleta** se: o PID nao existe; o PC reiniciou depois dela (`bootTime`); o PID existe mas ninguem renova ha mais de 120 s; ou (quando houver como obter) a hora de inicio do PID difere da registrada. Obsoleta e assumida sozinha no proximo inicio: reiniciar o PC ou matar o processo a forca nunca bloqueia a partida seguinte. Windows nao oferece API nativa para a hora de inicio de PID alheio sem processo auxiliar; por isso a prova principal e o batimento (o poller registra a propria hora de inicio por `process.uptime()`).
- Sem busca textual na linha de comando, sem processo auxiliar, sem nova porta, sem dependencia npm.
- `node scripts\central-bridge\poller-ctl.mjs status` mostra RODANDO (PID, inicio, ultimo batimento) ou PARADO (sem trava / trava obsoleta e o motivo).
- `... poller-ctl.mjs stop` le o PID da trava, pede parada graciosa por arquivo (`<trava>.stop`, conferido a cada batimento; termina a tarefa atual; ate 20 s), depois encerra exatamente esse PID (`process.kill`; confere de novo que a mesma trava ainda vale), remove a trava e **confirma 0 instancias** (codigo 0; 1 se ainda houver). Trava obsoleta: so limpa a trava, **nao mata nenhum processo** (nada prova que o PID e o poller).
- `... poller-ctl.mjs check` codigo 0 se 0 instancias, 1 se ha poller rodando (so le).
- Limite conhecido: um poller iniciado por versao anterior (sem trava) nao e visto pelo ctl; conferir uma vez com `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*poller.mjs*' }`.
- Causa da falha do T-83 (04/10): o filtro `-match 'central-bridge[\/]poller'` nao casou porque em regex .NET `[\/]` e so a barra `/` (`\/` e uma barra escapada); o Windows grava a linha de comando com `\` (`...node.exe" scripts\central-bridge\poller.mjs`). O poller estava la; o padrao nunca o encontraria. Correto: `[\\/]` ou `-like '*poller.mjs*'`, ou melhor, o ctl pela trava. O launcher `iniciar-poller-central.ps1` ja usa `[\\/]` (correto).

### Resolucao permanente do Claude Code (`executors/claude-locator.mjs`)
- Roda a cada execucao de tarefa (sem cache, sem reiniciar o poller para pegar atualizacao). So le o sistema de arquivos: sem `child_process`, sem rede.
- Ordem: (a) `CENTRAL_CLAUDE_BIN` se absoluto, arquivo `claude.exe`/`claude`, dentro de pasta `claude-code`, realpath ainda valido; (b) varredura de `%APPDATA%\Claude\claude-code` e `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code`: maior versao semver (numerica: 2.10.0 > 2.1.286 > 2.1.9), subpasta hash com `claude.exe`; formato obrigatorio `<raiz>\<semver>\<hash>\claude.exe` com realpath dentro da raiz; (c) nada achado: erro claro, nunca o `claude` do PATH.
- Nao aceita: executavel do Claude Desktop (outra pasta), `.cmd/.bat/.ps1`, link simbolico que saia da arvore. Versao mais nova sem hash/`claude.exe` e pulada para a proxima.
- `CENTRAL_CLAUDE_BIN` invalido NAO derruba a ponte: cai na varredura e o log mostra `claude: CENTRAL_CLAUDE_BIN ignorado (motivo)`. Caminho resolvido sempre logado (`claude: binario <caminho> (origem versao)`).
- Testes: `tests/central-claude-locator.test.mjs` (diretorios temporarios falsos).

**Na ativacao permanente** (o launcher `iniciar-poller-central.ps1` fica fora do repositorio; foi atualizado na ativacao operacional de 04/10 conforme os itens 1-2 abaixo, com copia de seguranca ao lado):
1. Hoje ele detecta instancia por `Get-CimInstance ... -match 'scripts[\\/]central-bridge[\\/]poller\.mjs'`. Trocar por `node scripts\central-bridge\poller-ctl.mjs check` (codigo 0 = pode iniciar) ou deixar o proprio poller recusar (codigo 3).
2. Tratar saida **3** do poller como "ja ha um rodando" (`exit 0`), nao como queda (hoje qualquer saida vira `exit 1`).
3. Para reiniciar apos mudar o `.env`: `poller-ctl.mjs stop` (o launcher termina com 1 ao ver o filho sair) e depois `Start-ScheduledTask Central-Claude-Poller`, ou novo logon. O poller le a config so na partida.
4. Ele zera `CENTRAL_EXECUTOR`/`CENTRAL_CLAUDE_*` do ambiente: a ativacao e so editar o `.central-bridge.env` (nunca o launcher).
5. No codigo do repositorio, o checkout `imoveis-mvp` precisa estar com este commit (`git pull --ff-only`), pois o launcher roda os scripts de la.

### Checklist de ativacao permanente (nada disso foi feito; so com decisao do dono)
- [ ] Politica da Anthropic para gatilho externo resolvida (T-79) e uso por assinatura autorizado.
- [ ] Checkout `imoveis-mvp` atualizado (trava presente); `poller-ctl check` = 0 e nenhum `node` com `poller.mjs`.
- [x] Binario do Claude Code: resolvido a cada execucao por `executors/claude-locator.mjs` (ver "Resolucao permanente do Claude Code" abaixo); `CENTRAL_CLAUDE_BIN` virou so a primeira opcao e deixou de ser fragil.
- [ ] `ANTHROPIC_API_KEY` ausente (usuario/maquina/.env) e credencial por assinatura presente.
- [ ] `.central-bridge.env`: `CENTRAL_EXECUTOR=claude`, `CENTRAL_CLAUDE_EXECUTOR_ENABLED=true` (editar so as linhas; conferir tamanho/valores sem imprimir segredos).
- [ ] Ajustar o launcher conforme acima; reiniciar o poller por `poller-ctl stop` + tarefa agendada.
- [ ] Teste de ativacao com UMA tarefa `consulta` inocua; confirmar `poller-ctl check`/`status`, nenhum `claude.exe -p` sobrando e que as regras `deny` do executor Claude funcionam de fato (limitacao conhecida abaixo).
- [ ] Para desativar: flag volta a `false` e `poller-ctl stop`.

## Testar com eco
Crie tarefa `{"tipo":"eco","instruction_text":"oi"}` -> rode o poller -> consulte: resultado `PONTE_OK / task_id / recebido / executor: echo`. Testes: `node --test tests/central-bridge.test.mjs`.

## Action no ChatGPT
Importe `docs/central/openapi.yaml` (Authentication: API Key tipo Bearer, cole o valor de `CENTRAL_CHATGPT_SECRET` do arquivo local; feito pelo dono). As instrucoes sugeridas para o GPT estao no fim do arquivo.

### listarTarefas (somente leitura)
`GET /api/central/tasks?status=&tipo=&limite=&horas=&ordenar_por=` (mesma credencial `chatgpt`; limite 60/min). Padrao: 10 itens, maximo duro 50, mais recentes primeiro (`created_at`, ou `updated_at`); `horas` = janela (1 a 8760). Parametro desconhecido/invalido/repetido = 400 generico. Sem paginacao (limite + janela bastam). Por tarefa devolve so uma allowlist: `task_id, status, tipo, origem, executor` (worker, so durante a execucao), `instruction_summary` (200 chars, `instruction_truncated`), `created_at, updated_at, completed_at, has_result, awaiting_decision, error_summary` (200 chars). O resultado completo continua so em `verResultado(task_id)`. Apenas `select`; `PUT/PATCH/DELETE` nao existem (405). Depois de publicar, o dono precisa **reimportar o `openapi.yaml` na Action do ChatGPT** para a operacao aparecer. Testes: `tests/central-list.test.mjs`.

## Executor Claude (headless, SOMENTE LEITURA) — implementado, DESLIGADO por padrao
`scripts/central-bridge/executors/claude.mjs` chama `claude -p` (CLI do Claude Code) so quando **as duas chaves locais** indicam isso: `CENTRAL_EXECUTOR=claude` **e** `CENTRAL_CLAUDE_EXECUTOR_ENABLED=true` (lidas so do ambiente/arquivo local do PC, nunca do payload). Padrao: `echo` e `false`. Decisao do dono (T-78 Opcao A): so `consulta`.

**Regras impostas em codigo (nao pelo texto da tarefa):**
- Modo consulta: so `tipo=consulta` (tipo do servidor e do envelope). `escrita` so roda pelo modo de escrita aprovada (secao propria, flag `CENTRAL_CLAUDE_WRITE_ENABLED`); `eco`/outro: recusado com erro antes de abrir qualquer processo, mesmo que a fila entregue (`escrita` segue em AGUARDANDO_DECISAO e nunca roda sozinha). Com `CENTRAL_EXECUTOR=claude`, tarefas `eco` tambem sao recusadas.
- Ferramentas: apenas `Read`, `Grep`, `Glob` (`--tools` + `--allowedTools`); `--disallowedTools` lista Bash, PowerShell, Edit, Write, MultiEdit, NotebookEdit, WebFetch, WebSearch, Task, Agent. `--restricted` (remove ferramentas de execucao, ignora settings de usuario/projeto, confina arquivos ao cwd), `--permission-mode dontAsk`, `--strict-mcp-config` (sem MCP), `--disable-slash-commands`, `--no-session-persistence`, `--settings` inline com `permissions.deny` de leitura (`.env*`, `.claude/settings*`, credenciais, `.git/**`, `node_modules/**`, `*.pem`, `*.key`, `.mcp.json`, `scratch/**`...). Nao usa `--bare` (ele desliga a autenticacao por assinatura). Nao usa `--max-turns` (nao consta no `--help` da versao 2.1.286); o limite e o timeout.
- `instruction_text` e entrada NAO CONFIAVEL: entra so por **stdin**, delimitado; nunca em argv/flags/shell/env/settings. O prompt de sistema (`--append-system-prompt`) diz isso. `spawn` com array de argumentos e `shell:false`; processo novo por tarefa.
- Env do filho por allowlist (PATH, USERPROFILE, APPDATA, TEMP etc.). Nao passa `CENTRAL_*`, `ANTHROPIC_API_KEY`, tokens, cookies, chaves.
- Saida: `--output-format json`; resultado redigido (JWT, chaves `sk-`/`sb_`/`ghp_`, Bearer, URL com senha, `NOME_SECRET=valor`, hash de 64 hex, bloco PEM e valores literais de variaveis secretas do ambiente) e truncado em **8000 caracteres** (limite do contrato `resultado`; termina com `[...resultado truncado em 8000 caracteres]`). stderr e descartado; erros viram mensagens genericas (`codigo N`, tempo limite, saida invalida, binario nao encontrado). Logs: so id curto, codigo, tempo — sem prompt nem env.
- Timeout padrao 120 s (`CENTRAL_CLAUDE_TIMEOUT_SECONDS`, 10–600): mata o processo (SIGKILL). Teto de 2 MB de stdout.
- Resultado grava pelo mesmo `client.complete` do echo (mesmo contrato do `verResultado`).

**Variaveis locais (arquivo `%USERPROFILE%.central-bridge.env` ou ambiente):** `CENTRAL_EXECUTOR`, `CENTRAL_CLAUDE_EXECUTOR_ENABLED`, `CENTRAL_CLAUDE_BIN` (caminho do `claude.exe`; o spawn nao usa shell, entao `.cmd` nao funciona), `CENTRAL_CLAUDE_CWD` (padrao: raiz do repo), `CENTRAL_CLAUDE_TIMEOUT_SECONDS`. O poller le a config so na partida: **reiniciar o poller** para aplicar.

**Testes:** `node --test tests/central-bridge.test.mjs` (runner injetavel/mocks; nada chama o Claude). Integracao real opcional: `CENTRAL_CLAUDE_INTEGRATION_TEST=1` (usa a assinatura; so local, so com autorizacao).

**Limitacao conhecida:** as regras `deny` de caminho e o `--restricted` sao mecanismos do Claude Code, nao verificados aqui contra uma execucao real (o teste real nao foi rodado, por ser uso da assinatura). Validar no teste de ativacao antes de confiar.

## Aprovacao, rejeicao e retomada (maquina de estados)
Em todas as operacoes o servidor so grava o novo estado: **nada executa no endpoint**. `decided_by` e o papel da credencial (`chatgpt` ou `approver`), nunca valor enviado no corpo (corpo com campos = 400); `approved_at` e a hora do servidor.
| Operacao | De | Para | Repetir / outros estados |
|---|---|---|---|
| aprovar | `AGUARDANDO_DECISAO` | `AGUARDANDO` (approved_at, decided_by) | tarefa ja aprovada ainda na fila: 200 `idempotent_replay:true`, sem efeito; rejeitada/em execucao/concluida/consulta: 409 `estado_invalido` |
| rejeitar | `AGUARDANDO_DECISAO` | `ERRO` (sem approved_at, com decided_by) | tarefa ja rejeitada: 200 replay; aprovada/em execucao/concluida: 409 |
| retomar (so `approver`) | `ERRO` com approved_at e `attempts < max_attempts` | `AGUARDANDO` (preserva task_id, approved_at, decided_by, attempts; zera erro/completed_at) | ja retomada e na fila: 200 replay; rejeitada, esgotada, concluida, consulta: 409; auditoria em `payload.audit` (`{event:"resume", by, at, attempts, prev_error}`) |
Unica transicao atomica no banco: `central_decide_task` (ja existente). A retomada e um UPDATE condicional (status ERRO + approved_at + mesmas tentativas + mesmo updated_at): se a linha mudou entre a leitura e a escrita, 409 e nada e gravado. Nenhuma migration nova. Erro 404 tarefa desconhecida, 400 id invalido, 401/403/503 como no resto da ponte, 429 limite (30/min por papel decisor).
Aprovar de fora (como o dono): `node scripts\central-bridge\approve.mjs <task_id> approve|reject|resume` (segredo lido do arquivo local, nunca impresso). No ChatGPT: operacoes `aprovarTarefa`/`rejeitarTarefa` do `docs/central/openapi.yaml` (+ tools MCP: `docs/central/mcp-aprovar-rejeitar-instrucao.md`; o `tools/list` do servidor MCP do ChatGPT esta fora do repositorio e NAO e verificavel daqui).

**RISCO (decisao do dono: a operacao MCP pedida):** a credencial `chatgpt` cria e tambem pode aprovar tarefas de escrita, entao a aprovacao deixa de ser independente do ChatGPT. Mitigacoes: (1) a instrucao do GPT/MCP exige confirmacao explicita do dono no chat antes de `aprovarTarefa` (texto no fim do `openapi.yaml`); (2) `decided_by` distingue `chatgpt` de `approver` (auditoria); (3) executor de escrita com privilegio minimo, desligado por padrao e que revalida a aprovacao; (4) nada publica sozinho. Quem quiser aprovacao 100% independente: desligar a rota (`chatgpt` fora de `DECIDER_ROLES` em `lib/central/core.mjs`) e aprovar so por `approve.mjs`.

## Escrita aprovada (executor Claude, privilegio minimo) — DESLIGADA por padrao
Roda so se **todas** as condicoes valem: `CENTRAL_EXECUTOR=claude`, `CENTRAL_CLAUDE_EXECUTOR_ENABLED=true`, **`CENTRAL_CLAUDE_WRITE_ENABLED=true`** (flag propria, padrao false, lida so do ambiente/arquivo local) e **aprovacao verificavel revalidada no momento de executar**: o claim devolve `approved_at`/`decided_by` do servidor e o executor exige `tipo=escrita` (do servidor e do envelope), status `EM_EXECUCAO`, `approved_at` valido e nao futuro, `decided_by` em `approver|chatgpt`. Sem isso, erro antes de abrir qualquer processo. Com a flag de escrita desligada uma tarefa de escrita aprovada que a fila entregar **falha (consome uma tentativa)**: por isso nao aprove escrita com a flag desligada; se falhar, use `resume`.
- **Worktree isolada por tarefa** (`executors/worktree.mjs`): nova pasta em `%USERPROFILE%\.central-bridge-worktrees\central-<id8>-<tentativa>` (`CENTRAL_WRITE_WORKTREE_DIR` troca), a partir de `origin/main` (apos `git fetch origin main`), branch `central/<id8>` (`-<n>` nas tentativas seguintes; branch ja existente = recusa). O poller roda do checkout principal, que nunca e alterado.
- **Ferramentas do Claude:** Read, Grep, Glob, Edit, Write. Negados: Bash, PowerShell, MultiEdit, NotebookEdit, WebFetch, WebSearch, Task, Agent; sem MCP, sem slash commands, `--restricted` (confina arquivos ao cwd, ignora settings do usuario/projeto), `--no-session-persistence`. Texto da tarefa so por stdin (dado nao confiavel); argv/env/cwd montados so por codigo.
- **Caminhos protegidos** (Edit/Write em `--settings` E conferidos pelo CODIGO sobre a lista de arquivos alterados antes do commit; qualquer violacao = nada commitado, tarefa em ERRO, worktree e branch descartadas): `.env*`, `*.env`, `.central-bridge*`, `.claude/settings*`, `.claude/hooks/**`, `.claude.json`, credenciais, `.mcp.json`, `.git/**`, `.gitmodules`, `node_modules`, `.vercel`, `supabase/.temp`, `scratch`, `*.pem/*.key/*.pfx`, `id_rsa*`, `.npmrc/.netrc`, **`scripts/central-bridge/**`** (poller, executor, trava, approve) e `iniciar-poller-central*` (launcher). Decisao de projeto: alterar o proprio executor remotamente e o pior caso; mudancas nele so por humano. `lib/central/**` e `app/api/central/**` ficam editaveis (so entram em producao por revisao humana + deploy). Limite de 100 arquivos alterados.
- **Quem comita e o codigo, nao o Claude**: `git add -A` + `git commit --no-verify` na worktree, com `core.hooksPath` vazio (hooks nao rodam), autor `Central Executor`. Comandos git passam por **allowlist fechada** (`assertSafeGitArgs`): so fetch de `origin main`, worktree add/remove/prune, branch -D `central/*`, rev-parse, status, add -A, diff, log, commit. **Nunca publicar, mesclar, rebase, reset, config, remoto, deploy ou migration**; publicar continua humano. Resultado: `branch + commit + diffstat + resumo do Claude` (redigido, max 8000 caracteres). Sem alteracoes: branch descartada.
- **Limpeza:** em falha/timeout/bloqueio remove a worktree e a branch sem commit; so apaga dentro da pasta-base e so pastas `central-<8hex>-<n>`. Branch com commit e mantida (worktree removida).
- **Timeout:** `CENTRAL_CLAUDE_WRITE_TIMEOUT_SECONDS` (padrao 900, limites 60 a 1800), maior que o de consulta; heartbeat renova o lease. `CENTRAL_GIT_BIN` (padrao `git`).
- **Limite de privilegio conhecido:** o Claude de escrita roda como o usuario do dono dentro da worktree; as regras de caminho do `--settings` sao do Claude Code (nao verificadas contra execucao real aqui) — por isso a conferencia final dos caminhos e feita pelo codigo. A consulta continua somente leitura (testes: `tests/central-approval.test.mjs`).
- **Mudanca remota de escopo:** o executor nao le config do payload; trocar flags exige editar `%USERPROFILE%\.central-bridge.env` e reiniciar o poller.

## Verificacao do CLI Claude Code 2.1.286 (04/10, so `--version` e `--help`, sem modelo)
Binario: localizador do projeto (`...\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code\2.1.286\<hash>\claude.exe`). `--help` literal: `-c, --continue` ("Continue the most recent conversation in the current directory"); `-r, --resume [value]` ("by session ID, or open interactive picker"); `--session-id <uuid>` ("Use a specific session ID ... valid UUID"); `--fork-session`; `--no-session-persistence` ("sessions will not be saved to disk and cannot be resumed (only works with --print)"); `--output-format <format>` json|stream-json|text ("only works with --print"); `--from-pr`; `--bg/--background`; `--restricted` (descricao oficial confirma confinamento de arquivos ao cwd). Subcomandos: `agents [--json] [--all] [--cwd]` ("Print active sessions (interactive and background) as a JSON array"), `attach <id>`, `logs <id>`, `stop|kill <id>`, `respawn`, `rm <id>`, `project purge`. **Nao ha subcomando que liste sessoes persistidas (historico) retomaveis**; o `--resume` sem valor abre seletor interativo. O `--help` **nao diz** que o JSON de `--output-format json` traz `session_id` (**NAO CONFIRMADO** pelo help; so uma execucao real provaria, e ela foi proibida aqui). Persistencia: `%USERPROFILE%\.claude\projects` existe (3 pastas de projeto, 216 arquivos `.jsonl`; so contagem, nenhum conteudo lido). **Vinculo com o "chat visual" do aplicativo: NAO CONFIRMADO** (o app guarda metadados proprios em `...\Claude\claude-code-sessions`, que nao foram lidos; nem o help nem a documentacao consultada provam que sessoes `-p` aparecem na lista do app). O executor continua usando `--no-session-persistence` (nada fica salvo nem retomavel; decisao T-78/T-79 inalterada).

## Lacuna de politica pendente
A politica da Anthropic sobre disparar o Claude por gatilho externo ainda esta ABERTA (T-17/T-22/T-32). PENDENTE DE POLITICA (T-79): gatilho externo + autenticacao por assinatura. O executor ja esta implementado atras da flag desligada; ativar so apos decisao do dono.
