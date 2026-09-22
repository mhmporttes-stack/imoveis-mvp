# Workflow de desenvolvimento, build, deploy e testes

## Ferramentas locais — armadilhas reais deste ambiente

- **`npm` puro não funciona neste ambiente de desenvolvimento** (Windows, runtime Node isolado). Use `pnpm` (via `node <caminho>\pnpm\bin\pnpm.cjs ...` se o `pnpm` global não estiver no PATH) ou, para rodar o dev server diretamente, `node node_modules/next/dist/bin/next dev`. `.claude/launch.json` (se existir) já deve apontar pro node/next corretos — não reverta para `npm run dev` sem testar antes.
- Builds (`next build` via Turbopack) neste ambiente podem ser **lentos** (minutos, não segundos) por causa de I/O de disco mais lento no diretório do projeto — não assuma que um build "travado" às 2-3 minutos falhou; builds de 5-10 minutos já foram observados terminando com sucesso.
- Não existe script de `lint` nem suíte de testes formal (`package.json` sem `scripts.lint`/`scripts.test`). "Rodar os testes" = `pnpm build` (compila + checa TS do motor de entrada) + rodar manualmente os arquivos relevantes em `tests/*.test.mjs`/`.test.js` com `node <arquivo>`.

## Migrations

Formato de nome e fluxo real de aplicação (não é `supabase db push`): `.claude/rules/database-supabase.md`. Adicional específico de workflow: sempre teste a query num script isolado antes de rodar contra produção quando a migration for destrutiva (drop/alter que perde dado).

## `scratch/`

Pasta para scripts de investigação/teste descartáveis (ex.: autenticar via magic link do Supabase e chamar uma API de produção pra confirmar um comportamento antes/depois de uma correção). Sempre apagar tudo de `scratch/` ao final da tarefa — nunca fica versionado.

## Deploy

Vercel, projeto `imoveis-mvp`, domínio de produção `https://www.matheusmachadoimoveis.com.br`. Publicação usual: `git push` pra `main` (deploy automático via integração Vercel↔GitHub) ou `pnpm dlx vercel --prod --yes` quando publicação manual for necessária. Build local bem-sucedido não significa que o código já está em produção — confirme o deploy antes de considerar uma correção "no ar".

## Antes de considerar uma tarefa concluída

1. `git status`/`git diff` — revisar exatamente o que mudou, nada além do pretendido (`git checkout -- public/sw.js` se só o hash do service worker mudou por causa do build local).
2. `pnpm build` limpo.
3. Testar a mudança de verdade — quando envolve dado real, prefira validar com um script autenticado (`scratch/`) contra o comportamento esperado, antes/depois, em vez de assumir que o código está certo só porque compila.
4. Limpar `scratch/` e qualquer rota de diagnóstico temporária criada só para investigação.
5. Commit com mensagem descrevendo o quê e por quê (causa raiz, não só o sintoma corrigido).
