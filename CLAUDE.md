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
9. **Sistema vivo em produção:** nunca enviar mensagem/e-mail/push real, rodar disparo ou gravar em produção como "teste"; cliente `do_not_contact` e telefones bloqueados nunca recebem contato automático; nunca imprimir/commitar segredos (só o nome da variável).
10. **Identidade visual única (regra do dono, 2026-10-04):** “A única identidade visual autorizada é a identidade visual atual do Matheus Machado. Logos antigas são descontinuadas e NÃO podem ser utilizadas, copiadas, restauradas ou usadas como referência em nenhuma nova implementação. Sempre reutilizar os assets oficiais atuais existentes no projeto.” Assets oficiais: `public/assets/matheus-machado-symbol.png` (símbolo "M"), `public/assets/og-matheus-machado-v2.png` (marca completa com texto, sobre azul-marinho) e `public/icons/*-mm.png` (favicon/PWA/avatar). A logo antiga (prédios/skyline: `matheus-machado-logo*`, `*-premium*`, `company-mark-avatar`, ícones `icon-*`/`favicon-32`/`apple-touch-icon` sem `-mm`) foi **apagada** — nunca restaurar do git nem recriar. Não criar nem redesenhar logo; precisando de variante nova, pedir ao dono. Trava: `tests/brand-assets.test.mjs`.

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
| E-mail marketing / prospecção por e-mail | `.claude/rules/email-marketing.md` |
| Convenções de frontend, PWA | `.claude/rules/frontend-pwa.md` |
| Academia (formação dos corretores) | `.claude/rules/academia.md` |
| Workflow de dev, build, deploy, testes | `.claude/rules/workflow-dev.md` |

**Como isso é carregado (verificado na doc oficial do Claude Code em 2026-10-01):** `CLAUDE.md` é lido no início da sessão. Skills só carregam a descrição no início; o corpo entra quando são invocadas. Rules **sem** `paths:` no frontmatter (`workflow-dev.md`, `auth-permissoes.md`) carregam em toda sessão. As demais têm `paths:` e **só entram no contexto quando o Claude lê (ferramenta Read) um arquivo que casa com os globs** — inclusive em subagentes. `grep`/`cat` pelo Bash **não** disparam o carregamento. Por isso: ao responder sobre um módulo sem ter lido arquivo dele (pergunta direta no chat, planejamento), leia manualmente a rule da tabela acima. Ao criar arquivo novo de um módulo, confira se o nome casa com o `paths:` da rule; se não casar, ajuste os globs.

**Provenância das regras:** todo item de regra de negócio em `.claude/rules/` carrega uma das três etiquetas abaixo — não assuma que um comportamento do código é regra oficial só porque é o que o código faz hoje.

- **[REGRA OFICIAL DE NEGÓCIO]** — definida e confirmada pelo dono do CRM diretamente (nesta conversa ou anteriormente documentada como tal). Fonte de verdade para o que o sistema *deveria* fazer.
- **[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO]** — é assim que o código funciona hoje; pode estar certo, pode estar desatualizado, pode ser só uma escolha técnica sem peso de regra de negócio. Não presuma que é permanente.
- **[PENDENTE DE VALIDAÇÃO]** — comportamento encontrado no código cuja intenção ainda não foi confirmada pelo dono. Pode virar regra oficial ou ser corrigido, dependendo da resposta.

Quando uma REGRA OFICIAL diverge do COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO, o arquivo de regras documenta os dois lado a lado — isso não é uma inconsistência a "resolver" silenciosamente editando o código; é um gap conhecido esperando uma tarefa de implementação explícita.

## Agentes e skills

**Roteamento: fonte única `.claude/despachante/MAPA-AGENTES.md`** (quem faz o quê, quando NÃO usar, skills de cada um, cabeçalho de delegação). Entrada padrão do dono: agente `despachante` (`claude --agent despachante` ou `/despachar`). Política de autonomia de TODOS os agentes (executar sem pedir confirmação; parar só em decisão de produto/negócio ou ação irreversível em dado real, em português simples e com o impacto, nunca SQL/comando): `docs/DESPACHANTE.md` §5. Agente em segundo plano não pergunta: termina com `DECISÃO NECESSÁRIA`.

Regras que só existem aqui:
- Qualquer alteração de código → `crm-editor` (investiga causa raiz e impacto antes de editar). Bug relatado, mesmo vago → `/diagnosticar-bug`; produção → `/diagnosticar-producao`; depois de corrigir → `/verificar-correcao`; sintoma já visto → `/consultar-incidentes` (`docs/INCIDENTES.md`); regra nova do dono → `/registrar-regra`.
- `gestor-trafego` (Meta, **nunca altera** campanha/orçamento, só recomenda) e `gestor-financeiro` (somente leitura; definições em `docs/FINANCEIRO_SAUDE.md`). Atribuição de anúncio/CPL é do `gestor-trafego`.
- `analista-dados`/qualquer cálculo de funil, conversão ou tempo: definição canônica `docs/METRICAS_FUNIL.md` (SQL em `docs/analytics/`).
- `analista-documental` **nunca inventa exigência** nem cria regra documental sem o dono; regressão sintética: `tests/document-regression.test.mjs`.
- `designer-crm` = **Diretor de Design**: UX/UI, PDF/material comercial, direção de arte, imagem/foto, design system; altera **só apresentação** (âncoras: logo + paleta; fatos, funcionalidade e regras preservados). Conhecimento modular em `.claude/design/` (índice `README.md`; carregue só os módulos da tarefa); crítica independente pelo subagente `design-critic`; revisão visual sem login em `app/dev/vitrine` (só `next dev`), PDF via `.claude/design/tools/renderizar-pdf.mjs`.
- `marketing-posicionamento`: orgânico; nunca publica/responde/envia em nome do dono sem "sim" por ação; memória em `docs/posicionamento/`.
- `auditor-crm`/`/pre-mortem`: somente leitura, severidade P0-P3 com evidência; ledger de riscos em `docs/SYSTEM_ARCHITECTURE.md` §13.
- `email-specialist` (**Diretor de E-mail**): estratégia, copy, HTML/MJML, entregabilidade, conformidade e métricas de e-mail; escreve só em `docs/email/`; **não envia nada** nem configura provedor/domínio sem decisão do dono; implementação no CRM é do `crm-editor`. Skills `/diretor-email`, `/planejar-campanha-email`, `/criar-email`, `/auditar-entregabilidade`, `/analisar-campanha-email`; memória em `docs/email/`.
- `performance-pc`: PC do dono, fora do CRM; memória fora do repo.
- Agentes analíticos têm banco somente leitura (hook força); não contorne.

## Economia de contexto

- Ler o mínimo: Grep primeiro, Read com offset/limit; arquivo >20 KB só em trecho (`CHANGELOG_AI`, `BUSINESS_RULES`, `WHATSAPP` nunca inteiros).
- Delegar com cabeçalho curto e caminho:linha (modelo no MAPA); não colar regras que já estão neste CLAUDE.md.
- Não reler/reinvestigar o que já foi lido ou registrado (`REGISTRO` do Despachante, `git log`).
- Respostas e relatórios curtos (≤~60 linhas), decisão e números primeiro; sem relatório `.md`. Uma fonte por informação. Paralelizar só tarefas independentes.
- **NUNCA cortar por economia:** hooks/guard de SQL e settings, banco somente leitura dos analíticos, regras de dado real, guards de permissão, testes `node --test` e build, verificação de produção, `/verificar-correcao`, leitura da rule do módulo antes de editar, registro em `docs/CHANGELOG_AI.md` e etiquetas de proveniência.
