# AGENTS.md — manual obrigatório para qualquer agente neste projeto

> Vale para qualquer agente de IA (Claude Code, Codex, etc.) e para qualquer pessoa que altere este repositório.
> Última verificação completa contra o código: **2026-09-24** (commit `ae510d1`). Se algo aqui divergir do código, **o código vence** — e a divergência deve ser corrigida na documentação (ver `docs/CHANGELOG_AI.md`).

## O que é o sistema

**imoveis-mvp** = CRM imobiliário em **produção real** (https://www.matheusmachadoimoveis.com.br) da Matheus Machado Imóveis: site público (imóveis, empreendimentos, simulação de financiamento, captação, "Minha Jornada") + painel interno multiusuário (clientes/funil, agenda, roleta de leads, Meta Diária, ranking, documentação/CCA, financeiro, automações, WhatsApp Chat/Fluxos/Disparo, Meta Ads). O dono é não técnico e usa o sistema todo dia: **interface e respostas ao dono sempre em português do Brasil**.

## Tecnologias

Next.js 16 (App Router) · React 19 · Supabase (Postgres + Auth + Storage + Realtime + `pg_cron`) · Vercel · Tailwind 3 · Zod 4 · pdf-lib · xlsx · `pnpm`. JavaScript (sem TypeScript), exceto `lib/simulacao-entrada/*.ts`. APIs externas: WhatsApp Cloud API (Meta), Meta Pixel/Conversions API/Marketing API, Anthropic (análise de documentos), OpenAI (opcional), Resend (e-mail), Web Push (VAPID).

## Fontes de verdade (ordem de confiança)

1. **O código e as migrations** (`lib/`, `app/`, `components/`, `supabase/migrations/`).
2. **`docs/` (esta camada central)** — verificada contra o código em 2026-09-24.
3. `CLAUDE.md` + `.claude/rules/*.md` — regras por módulo, com etiquetas de proveniência (REGRA OFICIAL DE NEGÓCIO / COMPORTAMENTO ATUAL / PENDENTE DE VALIDAÇÃO). Úteis, mas parte está desatualizada (lista em `docs/SYSTEM_ARCHITECTURE.md` §Divergências).
4. `DOCUMENTACAO-TECNICA-DESENVOLVEDOR.md` — histórica. `README.md` — **obsoleto** (descreve SQLite/backup local que não existem em produção): não use.
5. Estado do banco de produção: **não está no repositório**. O que só existe lá (regras de automação, pontuação vigente, cotas, cron ativos) está marcado **A CONFIRMAR**.

## Qual documento ler (leia antes de mexer)

| Tarefa envolve… | Leia |
|---|---|
| Qualquer coisa (comece aqui) | `docs/CRM_CONTEXT.md` → `docs/BUSINESS_RULES.md` → `docs/SYSTEM_ARCHITECTURE.md` |
| Perfis, guards, escopo por responsável, rotas públicas | `docs/PERMISSIONS.md` |
| Tabelas, migrations, funções/triggers SQL, crons | `docs/DATABASE.md` |
| WhatsApp (Chat, Fluxos, Disparo, webhook, janela 24h, templates) | `docs/WHATSAPP.md` |
| Pixel, Conversions API, Meta Ads, UTMs, campanhas/links | `docs/TRAFEGO_META.md` |
| Registrar o que você mudou | `docs/CHANGELOG_AI.md` |
| Regras detalhadas de um módulo específico | `.claude/rules/<módulo>.md` (tabela em `CLAUDE.md`) |

## Regras de segurança (inegociáveis)

- **Nunca** escreva, imprima, commite ou cole tokens, chaves, segredos, valores de variáveis de ambiente ou `.env`. Documente só o **nome** da variável (e em `.env.example`, sem valor).
- `SUPABASE_SERVICE_ROLE_KEY` só existe no servidor. Componente client nunca acessa o banco direto; toda leitura/escrita passa por `lib/*.js`.
- RLS está ligado **sem policy pública** (proposital). A autorização real é feita em código — nunca a tela. Toda rota `app/api/admin/**` e página `app/admin/**` precisa de guard **antes** de tocar em dado (`docs/PERMISSIONS.md`).
- Este é um sistema **vivo**: mensagens de WhatsApp reais, dados pessoais de clientes (CPF, renda, documentos), dinheiro (comissões). Nunca envie mensagem/e-mail/push real, rode disparo, ou grave em produção como “teste”.
- Não publique (push em `main` = deploy automático), não aplique migration em produção e não rode nada destrutivo **sem pedido explícito** da tarefa. Nunca `git push --force`, nunca pular hooks.
- Cliente `do_not_contact` (“não contactar”) e telefones bloqueados nunca podem receber contato automático.

## Antes de alterar código

1. **Nunca assumir que uma funcionalidade não existe. Pesquisar primeiro no código** (Grep em `lib/`, `app/api/`, `components/`, `supabase/migrations/`). Nomes de arquivo não provam comportamento — leia a implementação.
2. **Não alterar regras de negócio não relacionadas à tarefa.** Muito código “estranho” aqui é correção de incidente real (veja comentários e `docs/BUSINESS_RULES.md`).
3. **Não criar migrations ou alterar banco sem necessidade confirmada.** Nome do arquivo `YYYYMMDDHHMMSS_descricao.sql` (14 dígitos), idempotente (`if not exists`); aplicação segue `.claude/rules/database-supabase.md` (não é `supabase db push`).
4. **Antes de alterar uma área compartilhada, verificar dependências.** `simulation_registrations`, `lib/client-status.js`, `lib/admin-profiles.js`, `lib/whatsapp-master.js`, `lib/phone-utils.js`, `lib/crm-automations.js` e `lib/performance-overview.js` alimentam muitos módulos (mapa em `docs/SYSTEM_ARCHITECTURE.md`).
5. **Preservar compatibilidade**: rotas, formato de payload, colunas e links já publicados (URLs de campanha `?c=`/`?ref=`, `/minha-jornada/<token>`, webhook da Meta, cron URLs) não podem quebrar.
6. **Analisar impacto** em: perfis (admin/gestor/corretor/associado), funil e status, ranking/pontuação, Meta Diária, WhatsApp, financeiro, notificações e banco.
7. Fonte única: status em `lib/client-status.js`; telefone em `lib/phone-utils.js` + `lib/client-phone-lookup.js`; rótulos de documento em `lib/document-status-labels.js`; saudação/fuso em `lib/daily-report.js`. Não crie cópias.
8. **Nunca** crie UNIQUE por telefone em `simulation_registrations` (um telefone pode ter vários atendimentos — incidente real).
9. Bug fora do escopo? **Não corrija junto**: registre em `docs/CHANGELOG_AI.md` (Risco/observação) e avise o dono.

## Comandos de validação (reais)

Não há scripts `lint` nem `test` no `package.json`. O que existe:

- `pnpm build` — compila e checa o TS do motor de entrada (`prebuild` regenera `public/sw.js`: se só o hash mudou, `git checkout -- public/sw.js`). No Windows do dono `npm` puro não funciona: use `pnpm`, ou `node node_modules/next/dist/bin/next ...` (detalhes em `.claude/rules/workflow-dev.md`). Builds podem levar minutos.
- Testes unitários (Node ≥ 20, sem dependências): `node --test tests/<arquivo>.test.mjs` e `node --test lib/financial-calculations.test.js`.
  Estado em 2026-09-24: passam todos, **exceto** `tests/whatsapp-flow-core.test.mjs` → 1 falha conhecida (`modelo 'Menu principal'`, texto esperado desatualizado; existe desde antes desta documentação). `tests/journey-http.test.mjs` exige servidor local em `:3107`; `tests/journey-auth.integration.mjs` exige `JOURNEY_QA_CLIENT_ID` + credenciais (mexe em banco — **não rode contra produção**).
- Dev server: `.claude/launch.json` (`dev`, porta 3020).
- Scripts de investigação descartáveis vão em `scratch/` e são apagados ao terminar (nunca commitados). Rotas temporárias de diagnóstico não podem começar com `_` (o App Router as ignora) e devem ser removidas e reimplantadas depois.

## Ao terminar

- Revise `git diff`: só o pedido, nada além.
- Se mudou regra de negócio, arquitetura, tabela, rota, permissão ou integração: **atualize o(s) documento(s) de `docs/` correspondente(s)** e registre em `docs/CHANGELOG_AI.md`.
- Marque como **A CONFIRMAR** tudo que você não conseguiu provar no código. Não invente regra.
