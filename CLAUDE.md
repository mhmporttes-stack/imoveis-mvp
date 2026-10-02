# Matheus Machado Imóveis — imoveis-mvp

CRM imobiliário completo: site público (imóveis, empreendimentos, simulação de financiamento, captação) + painel interno multiusuário (CRM, prospecção, roleta de leads, Meta Diária, ranking, documentação/CCA, financeiro, automações, WhatsApp, disparo).

Produção: https://www.matheusmachadoimoveis.com.br (Vercel, projeto `imoveis-mvp`) · Banco: Supabase Postgres (`tshhasbbchjcvhoyizoo`).

## Camada central de contexto (leia primeiro)

`AGENTS.md` (raiz) é o manual obrigatório para qualquer agente e aponta para `docs/`. **O Claude Code não carrega `AGENTS.md` sozinho quando existe `CLAUDE.md`** — leia-o no início de qualquer tarefa que altere arquivos. Documentos de `docs/`: `CRM_CONTEXT.md` (visão funcional), `BUSINESS_RULES.md` (regras confirmadas no código), `SYSTEM_ARCHITECTURE.md` (arquitetura, divergências e problemas conhecidos), `PERMISSIONS.md`, `DATABASE.md`, `WHATSAPP.md`, `TRAFEGO_META.md` e `CHANGELOG_AI.md` (registrar alterações importantes). Estes documentos foram verificados contra o código em 2026-09-24; quando divergirem de `.claude/rules/*`, vale o código e, depois dele, `docs/`. As divergências D-1 a D-7 de `docs/SYSTEM_ARCHITECTURE.md` §12 foram reconciliadas nas rules em 2026-10-01; divergência nova encontrada → corrija a rule (fato técnico) ou registre em §12 (se envolver regra do dono).

## Stack

Next.js 16 (App Router) · React 19 · Supabase JS · Tailwind · Zod · pdf-lib · xlsx. Sem TypeScript no app em geral — só `lib/simulacao-entrada/*.ts` (motor de cálculo de entrada) usa TS. `pnpm` é o gerenciador (lockfile no repo).

Armadilhas do ambiente local (npm quebrado, sem lint/testes formais, builds lentos) e o workflow de build/deploy/teste completo estão em `.claude/rules/workflow-dev.md` — leia antes de rodar qualquer comando local pela primeira vez.

## Como este projeto é organizado

```
app/            rotas Next.js (App Router) — admin/, api/, páginas públicas
components/     componentes React (client components em sua maioria)
lib/            TODA a lógica de negócio e acesso a dados — nunca acessar Supabase direto de um componente
supabase/       migrations/ (schema incremental), tests/ (SQL), schema.sql
docs/           camada central de referência (ver acima) + specs pontuais (minha-jornada, pwa-admin, gerador-de-links)
scripts/        scripts de build/manutenção (ex.: stamp-service-worker)
tests/          testes unitários `node --test`
whatsapp-individual-service/  microsserviço do WhatsApp individual (Baileys), publicado no Railway — não na Vercel
scratch/        scripts descartáveis de investigação/teste — ignorado pelo git, sempre apagar ao terminar
mcmv-calculator/  motor de cálculo ANTIGO/de referência — está no .gitignore e normalmente ausente do clone; NÃO é o que roda em produção
```

Documentação **histórica** (não use como fonte do comportamento atual): `DOCUMENTACAO-TECNICA-DESENVOLVEDOR.md`, `README.md` (obsoleto) e `docs/HISTORICO_REGRAS.md` (trechos retirados das rules em 2026-10-01).

## Onde cada informação mora (uma casa por tipo — não duplique)

| Tipo de informação | Lugar |
|---|---|
| Regra inviolável que vale para o projeto inteiro | este `CLAUDE.md` (curto) |
| Instrução de trabalho por módulo + regras do dono com etiqueta (REGRA OFICIAL etc.) | `.claude/rules/<módulo>.md` — curtas, diretivas, sem narrativa de incidente |
| Referência detalhada verificada no código (tabelas, rotas, fluxos, IDs de regra) | `docs/*.md` |
| Histórico do que mudou e por quê (incidentes, nomes, números do caso) | `docs/CHANGELOG_AI.md` (+ `git log`) |
| Histórico de bugs buscável por sintoma (causa raiz + correção) | `docs/INCIDENTES.md` |
| Procedimento repetível | `.claude/skills/` |

Regra nova confirmada pelo dono → skill `/registrar-regra`. Rule nunca carrega a história do incidente — só a instrução e um link.

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

**Como isso é carregado (verificado na doc oficial do Claude Code em 2026-10-01):** `CLAUDE.md` é lido no início da sessão. Skills só carregam a descrição no início; o corpo entra quando são invocadas. Rules **sem** `paths:` no frontmatter (`workflow-dev.md`, `auth-permissoes.md`) carregam em toda sessão. As demais têm `paths:` e **só entram no contexto quando o Claude lê (ferramenta Read) um arquivo que casa com os globs** — inclusive em subagentes. `grep`/`cat` pelo Bash **não** disparam o carregamento. Por isso: ao responder sobre um módulo sem ter lido arquivo dele (pergunta direta no chat, planejamento), leia manualmente a rule da tabela acima. Ao criar arquivo novo de um módulo, confira se o nome casa com o `paths:` da rule; se não casar, ajuste os globs.

**Provenância das regras:** todo item de regra de negócio em `.claude/rules/` carrega uma das três etiquetas abaixo — não assuma que um comportamento do código é regra oficial só porque é o que o código faz hoje.

- **[REGRA OFICIAL DE NEGÓCIO]** — definida e confirmada pelo dono do CRM diretamente (nesta conversa ou anteriormente documentada como tal). Fonte de verdade para o que o sistema *deveria* fazer.
- **[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO]** — é assim que o código funciona hoje; pode estar certo, pode estar desatualizado, pode ser só uma escolha técnica sem peso de regra de negócio. Não presuma que é permanente.
- **[PENDENTE DE VALIDAÇÃO]** — comportamento encontrado no código cuja intenção ainda não foi confirmada pelo dono. Pode virar regra oficial ou ser corrigido, dependendo da resposta.

Quando uma REGRA OFICIAL diverge do COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO, o arquivo de regras documenta os dois lado a lado — isso não é uma inconsistência a "resolver" silenciosamente editando o código; é um gap conhecido esperando uma tarefa de implementação explícita.

## Agente e skills deste projeto

- Subagente `crm-editor` (persona **CRM Architect**) — use-o para qualquer alteração de código neste CRM; ele já carrega a filosofia de investigar causa raiz e impacto antes de editar.
- Subagente `gestor-trafego` — análise de tráfego pago (Meta) **somente leitura**, cruzando investimento com o funil do CRM; skills `/auditar-trafego`, `/criar-anuncio`, `/planejar-campanha`. Nunca altera campanha/orçamento — só recomenda. Contexto: `docs/TRAFEGO_META.md` §6-A.
- Subagente `designer-crm` — Product Design/UI-UX: critica, redesenha e implementa **só interface** (identidade obrigatória: azul/branco + logo; funcionalidades e regras preservadas); skill `/design-crm`; revisão visual sem login na vitrine `app/dev/vitrine` (só `next dev`).
- Subagente `marketing-posicionamento` — presença/reputação **orgânica** (Google Meu Negócio/Maps, avaliações, SEO local do site, Instagram/Facebook, concorrentes de Marília, GEO/AEO): audita, recomenda com evidência e implementa (código do site público + rascunhos; nunca publica/responde/envia em nome do dono sem "sim" por ação). Não faz mídia paga (isso é o `gestor-trafego`). Skills `/auditar-posicionamento`, `/google-perfil-avaliacoes`, `/concorrentes-marilia`, `/seo-site`, `/visibilidade-ia`, `/conteudo-social`, `/plano-semanal`. Memória persistente em `docs/posicionamento/` (PERFIL, HISTORICO, BACKLOG); guia: `docs/MARKETING_POSICIONAMENTO.md`.
- Subagente `performance-pc` — desempenho do **computador Windows do dono** (não do CRM): diagnóstico somente leitura, baseline ANTES×DEPOIS e otimizações seguras/reversíveis (autorização para o arriscado). Skills `/diagnosticar-pc`, `/otimizar-pc`, `/comparar-performance`, `/diagnosticar-chrome|claude|rede|memoria|disco`, `/verificar-inicializacao`. Memória do PC fica fora do repo (`~/.claude/agent-memory/performance-pc/`). Pesquisa e integração Chrome DevTools MCP (desativada, falta Node): `.claude/performance-pc/`.
- Subagente `auditor-crm` — auditoria preventiva **somente leitura** (acha risco/inconsistência/código morto/violação de regra ANTES de virar bug; nunca corrige); skills `/auditar-crm` (geral ou por módulo, entende sozinho o protocolo pela frase do pedido) e `/pre-mortem` (antes de publicar algo grande). Severidade P0-P3, evidência obrigatória (COMPROVADO/RISCO/NÃO CONFIRMADO). Ledger de problemas conhecidos (risco/arquitetura, ainda não virou bug): `docs/SYSTEM_ARCHITECTURE.md` §13. Bug já confirmado/corrigido → `docs/INCIDENTES.md` (não duplique entre os dois).
- Subagente `analista-dados` — BI/análise de dados **somente leitura** (cruza origem, prospecção, atendimento, etapas do funil, corretor, horário, tempo entre etapas, conversão, produtividade, ranking; acha padrões que o dashboard não mostra; informa período, amostra e fonte; separa correlação de causa). Skills `/analisar-funil`, `/descobrir-padroes`, `/comparar-periodos`. **Definição canônica de funil/conversão/tempo: `docs/METRICAS_FUNIL.md`** (+ SQL em `docs/analytics/`) — qualquer agente que calcule conversão deve usá-la. Atribuição de anúncio/CPL continua com `gestor-trafego`.
- Subagente `analista-documental` — análise documental Caixa/MCMV: entende, audita e testa o fluxo existente (IA Anthropic em `lib/document-analysis.js` → Base Mestra `document_ai_rules` → motor de requisitos → devolutiva → PDF/CCA) sem recriá-lo; hierarquia regras fixas > Base Mestra ativa > cadastro > documentos > mensagens; nunca inventa exigência nem implementa regra documental nova sem o dono. Skills `/analisar-documentacao`, `/auditar-analise-documental`, `/testar-regra-documental`; referência sob demanda em `.claude/analista-documental/` (ARQUITETURA, REGRAS-DOCUMENTAIS com matriz de cobertura); regressão sintética em `tests/document-regression.test.mjs`.
- Skills: `/auditar-crm`, `/pre-mortem`, `/nova-funcionalidade`, `/auditar-banco`, `/revisar-permissoes`, `/registrar-regra` (regra nova do dono → lugar certo, sem duplicar) e, para bugs/incidentes: `/diagnosticar-bug` (entrada padrão para qualquer bug relatado, mesmo vago), `/diagnosticar-producao` (logs e consultas de leitura antes de publicar código de diagnóstico), `/verificar-correcao` (depois de corrigir, antes de dar por resolvido) e `/consultar-incidentes` (busca em `docs/INCIDENTES.md` por sintoma antes de investigar do zero).
