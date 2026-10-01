# Workflow de desenvolvimento, build, deploy e testes

Esta rule é **global** (sem `paths:`), carregada em toda sessão. Mantenha-a curta.

## Ambientes — dois, com armadilhas diferentes

- **Máquina do dono (Windows, runtime Node isolado do Codex):** `npm` puro **não funciona**. Use `pnpm` (via `node <caminho>\pnpm\bin\pnpm.cjs ...` se o `pnpm` global não estiver no PATH) ou `node node_modules/next/dist/bin/next dev`. `.claude/launch.json` aponta para o node desse ambiente (caminho Windows) — não reverta para `npm run dev` sem testar.
- **Claude Code na web (container Linux efêmero):** clone novo a cada sessão, sem `.env` de produção e sem login real no painel; `node_modules` pode não estar instalado (rode `pnpm install` só quando for de fato buildar/testar). `launch.json` não serve aqui.
- Em qualquer um: builds (`next build`/Turbopack) podem levar 5–10 min — build "parado" aos 2–3 min não é falha.

## Permissões do Claude Code

`.claude/settings.json` (versionado) libera sem perguntar o trabalho rotineiro (ler/editar arquivos do projeto, `pnpm`/`node`, testes/build, git do dia a dia, leitura e SQL rotineiro no Supabase, deploy `vercel --prod`). Continua pedindo autorização: `rm`, force-push/reset --hard/clean/apagar branch, editar `.env*`/o próprio settings, `vercel env|rm|domains`, CLI `supabase`, branches/pausa/restauração de projeto Supabase e SQL de alto risco (DROP, TRUNCATE, DELETE, UPDATE sem WHERE, GRANT público, RLS/policy, papéis/senhas — hook `.claude/hooks/guard-destructive-sql.mjs`). Ao mudar essa política, edite os dois arquivos juntos.

## Validação (não há `lint` nem `test` no `package.json`)

- `pnpm build` — compila e checa o TS de `lib/simulacao-entrada/*`. O `prebuild` regenera `public/sw.js`: se só o hash mudou, `git checkout -- public/sw.js` antes de commitar.
- Testes unitários (Node ≥ 20, sem dependências): `node --test tests/<arquivo>.test.mjs` (há ~33 arquivos em `tests/`) e `node --test lib/financial-calculations.test.js`. Rode os da área que você mexeu. Exceções e falhas conhecidas: `AGENTS.md` §Comandos de validação (`journey-http` exige servidor local; `journey-auth.integration` mexe em banco — nunca contra produção).

## Migrations

Formato de nome e fluxo real de aplicação (não é `supabase db push`): `.claude/rules/database-supabase.md`. Migration destrutiva (drop/alter que perde dado): teste a query isolada antes, e só aplique com pedido explícito.

## `scratch/` e diagnósticos

`scratch/` (ignorado pelo git) é para scripts descartáveis — sempre apagar ao terminar. Investigação de problema em produção segue a skill `/diagnosticar-producao` (logs e consultas de leitura antes de publicar qualquer código de diagnóstico).

## Deploy

Vercel, projeto `imoveis-mvp`. **`git push` para `main` = deploy automático em produção.** Publicação manual: `pnpm dlx vercel --prod --yes`. Build local bem-sucedido não significa que já está no ar — confirme o deploy. O microsserviço `whatsapp-individual-service/` é publicado à parte (Railway), não pela Vercel.

## Antes de considerar uma tarefa concluída

1. `git status`/`git diff` — só o pretendido (reverter `public/sw.js` se só mudou o hash).
2. `pnpm build` limpo quando a mudança participa do build; testes `node --test` da área.
3. Testar de verdade quando envolve dado real (antes/depois), sem gravar em produção como "teste".
4. Limpar `scratch/` e qualquer rota de diagnóstico temporária.
5. Mudou regra, arquitetura, tabela, rota, permissão ou integração → atualizar `docs/` correspondente e registrar em `docs/CHANGELOG_AI.md` (regra do dono nova → skill `/registrar-regra`).
6. Commit descrevendo o quê e por quê (causa raiz, não só o sintoma).
