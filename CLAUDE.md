# Matheus Machado Imóveis — imoveis-mvp

CRM imobiliário completo: site público (imóveis, empreendimentos, simulação de financiamento, captação) + painel interno multiusuário (CRM, prospecção, roleta de leads, Meta Diária, ranking, documentação/CCA, financeiro, automações, WhatsApp, disparo).

Produção: https://www.matheusmachadoimoveis.com.br (Vercel, projeto `imoveis-mvp`) · Banco: Supabase Postgres (`tshhasbbchjcvhoyizoo`).

## Stack

Next.js 16 (App Router) · React 19 · Supabase JS · Tailwind · Zod · pdf-lib · xlsx. Sem TypeScript no app em geral — só `lib/simulacao-entrada/*.ts` (motor de cálculo de entrada) usa TS. `pnpm` é o gerenciador (lockfile no repo).

Armadilhas do ambiente local (npm quebrado, sem lint/testes formais, builds lentos) e o workflow de build/deploy/teste completo estão em `.claude/rules/workflow-dev.md` — leia antes de rodar qualquer comando local pela primeira vez.

## Como este projeto é organizado

```
app/            rotas Next.js (App Router) — admin/, api/, páginas públicas
components/     componentes React (client components em sua maioria)
lib/            TODA a lógica de negócio e acesso a dados — nunca acessar Supabase direto de um componente
supabase/       migrations/ (schema incremental), tests/ (SQL), schema.sql
docs/           specs pontuais já escritas (minha-jornada, pwa-admin, gerador-de-links)
scratch/        scripts descartáveis de investigação/teste — nunca committar, sempre apagar ao terminar
mcmv-calculator/  motor de cálculo ANTIGO/de referência — NÃO é o que roda em produção (ver regra abaixo)
```

Documentação técnica geral (histórica, pode estar desatualizada em detalhes recentes): `DOCUMENTACAO-TECNICA-DESENVOLVEDOR.md`. Regras por módulo, mais específicas e atualizadas: `.claude/rules/`.

## Regras que nunca podem ser quebradas

1. **`lib/` é a única camada de acesso a dados.** Toda leitura/escrita no Supabase passa por uma função em `lib/*.js`, chamada a partir de uma Server Component/Route Handler. Componentes client nunca chamam o Supabase diretamente (exceto os poucos casos já existentes com `supabase-browser.js`, que usam o anon key, não o service role).
2. **O service role key do Supabase só existe no servidor.** RLS está habilitado na maioria das tabelas mas **sem policies públicas** — a autorização real é feita em código (`lib/admin-access.js`, `lib/admin-auth.js`), não pelo Postgres. Nunca exponha `SUPABASE_SERVICE_ROLE_KEY` ao cliente. Ver `.claude/rules/database-supabase.md`.
3. **Toda API/página em `app/admin/**` e `app/api/admin/**` precisa de um guard de `lib/admin-auth.js`** (`requireAdminApi`, `requireBrokerManagementApi`, `requireFinancialManagerApi`, `requireRealGeneralAdminApi`, etc.) antes de tocar em dado. Ver `.claude/rules/auth-permissoes.md`.
4. **`mcmv-calculator/` é histórico/referência — o motor real é `lib/simulacao-entrada/*`.** Corrigir um bug só no `mcmv-calculator` não corrige produção.
5. **Nunca criar UNIQUE por telefone em `simulation_registrations`.** Um telefone pode ter vários atendimentos distintos (incidente real já corrigido, ver `.claude/rules/database-supabase.md`).
6. **Migrations sempre com nome `YYYYMMDDHHMMSS_descricao.sql` (14 dígitos), nunca `YYYYMMDD_` (8 dígitos)** — já causou um bug real de ordenação. Detalhe e como aplicar migrations neste projeto (não é `supabase db push`): `.claude/rules/database-supabase.md`.
7. **`scratch/` é para scripts de investigação/teste descartáveis, sempre apagados ao terminar — nunca committados.** Detalhe: `.claude/rules/workflow-dev.md`.
8. **Nunca remover, simplificar ou "limpar" uma funcionalidade existente que não faz parte do pedido**, mesmo que pareça código morto ou redundante à primeira vista — muita coisa aqui tem uma razão de negócio documentada em comentário. Ver a filosofia completa do agente `crm-editor`.

## Perfis de usuário

Quatro papéis em `admin_users.role`: **admin** (geral), **manager** (gestor de equipe), **broker** (corretor), **associate** (associado, vinculado a um corretor). Cada tela e API se comporta diferente por perfil — nunca assuma que uma regra vale para todos. Detalhes em `.claude/rules/auth-permissoes.md`.

## Onde estão as regras de cada módulo

| Módulo | Arquivo de regras |
|---|---|
| Banco de dados, Supabase, migrations, RLS | `.claude/rules/database-supabase.md` |
| Autenticação, perfis, permissões, escopo | `.claude/rules/auth-permissoes.md` |
| Clientes, funil/status, tags, jornada pública | `.claude/rules/crm-clientes-funil.md` |
| Meta Diária, carteira ativa, ranking/pontuação | `.claude/rules/meta-diaria-ranking.md` |
| Roleta, prospecção, campanhas/gerador de links | `.claude/rules/roleta-prospeccao-campanhas.md` |
| Documentação do cliente, IA, envio à CCA | `.claude/rules/documentacao-cca.md` |
| Automações, notificações, push, mensagem diária | `.claude/rules/automacoes-notificacoes.md` |
| Financeiro (comissões, despesas, recebimentos) | `.claude/rules/financeiro.md` |
| Integrações externas (WhatsApp, IA, e-mail, cron) | `.claude/rules/integracoes-externas.md` |
| Convenções de frontend, PWA | `.claude/rules/frontend-pwa.md` |
| Workflow de dev, build, deploy, testes | `.claude/rules/workflow-dev.md` |

**Importante sobre como isso é carregado:** `CLAUDE.md` é lido automaticamente pelo Claude Code no início da sessão. `.claude/agents/*.md` e `.claude/skills/*/SKILL.md` são descobertos automaticamente (aparecem como subagente/skills disponíveis). **`.claude/rules/*.md` não tem carregamento automático nativo** — esses arquivos só são lidos quando algo instrui explicitamente a lê-los (esta tabela, o agente `crm-editor`, ou uma skill). Ao trabalhar neste projeto sem passar pelo agente/skills (ex.: perguntado algo direto no chat principal), leia manualmente o arquivo de regras do módulo relevante antes de responder sobre ele.

**Provenância das regras:** todo item de regra de negócio em `.claude/rules/` carrega uma das três etiquetas abaixo — não assuma que um comportamento do código é regra oficial só porque é o que o código faz hoje.

- **[REGRA OFICIAL DE NEGÓCIO]** — definida e confirmada pelo dono do CRM diretamente (nesta conversa ou anteriormente documentada como tal). Fonte de verdade para o que o sistema *deveria* fazer.
- **[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO]** — é assim que o código funciona hoje; pode estar certo, pode estar desatualizado, pode ser só uma escolha técnica sem peso de regra de negócio. Não presuma que é permanente.
- **[PENDENTE DE VALIDAÇÃO]** — comportamento encontrado no código cuja intenção ainda não foi confirmada pelo dono. Pode virar regra oficial ou ser corrigido, dependendo da resposta.

Quando uma REGRA OFICIAL diverge do COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO, o arquivo de regras documenta os dois lado a lado — isso não é uma inconsistência a "resolver" silenciosamente editando o código; é um gap conhecido esperando uma tarefa de implementação explícita.

## Agente e skills deste projeto

- Subagente `crm-editor` (persona **CRM Architect**) — use-o para qualquer alteração de código neste CRM; ele já carrega a filosofia de investigar causa raiz e impacto antes de editar.
- Skills: `/auditar-crm`, `/corrigir-bug`, `/nova-funcionalidade`, `/auditar-banco`, `/revisar-permissoes`.
