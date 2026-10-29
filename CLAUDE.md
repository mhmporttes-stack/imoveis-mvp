# Matheus Machado Corretor de Imóveis — imoveis-mvp

CRM imobiliário completo: site público (imóveis, empreendimentos, simulação de financiamento, captação) + painel interno multiusuário (CRM, prospecção, roleta de leads, Meta Diária, ranking, documentação/CCA, financeiro, automações, WhatsApp, disparo).

Produção: https://www.matheusmachadoimoveis.com.br (Vercel, projeto `imoveis-mvp`) · Banco: Supabase Postgres (`tshhasbbchjcvhoyizoo`).

## Camada central de contexto (leia primeiro)

`AGENTS.md` (raiz) é o manual obrigatório para qualquer agente e aponta para `docs/`. **O Claude Code não carrega `AGENTS.md` sozinho quando existe `CLAUDE.md`** — leia-o no início de qualquer tarefa que altere arquivos. Documentos de `docs/`: `CRM_CONTEXT.md` (visão funcional), `BUSINESS_RULES.md` (regras confirmadas no código), `SYSTEM_ARCHITECTURE.md` (arquitetura, divergências e problemas conhecidos), `PERMISSIONS.md`, `DATABASE.md`, `WHATSAPP.md`, `TRAFEGO_META.md` e `CHANGELOG_AI.md` (registrar alterações importantes). Quando divergirem de `.claude/rules/*`, vale o código e, depois dele, `docs/`. As divergências D-1 a D-7 de `docs/SYSTEM_ARCHITECTURE.md` §12 foram reconciliadas nas rules em 2026-10-01; divergência nova encontrada → corrija a rule (fato técnico) ou registre em §12 (se envolver regra do dono).

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
```

**Histórico — não use como fonte do comportamento atual:** `README.md` (obsoleto), `DOCUMENTACAO-TECNICA-DESENVOLVEDOR.md`, `docs/HISTORICO_REGRAS.md` e `mcmv-calculator/` (motor antigo, ignorado pelo git; o motor real é `lib/simulacao-entrada/*` — corrigir só lá não corrige produção).

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
4. **Nunca remover, simplificar ou "limpar" uma funcionalidade existente que não faz parte do pedido**, mesmo que pareça código morto ou redundante à primeira vista — muita coisa aqui tem uma razão de negócio documentada em comentário. Ver a filosofia completa do agente `crm-editor`.
5. **Sistema vivo em produção:** nunca enviar mensagem/e-mail/push real, rodar disparo ou gravar em produção como "teste"; cliente `do_not_contact` e telefones bloqueados nunca recebem contato automático; nunca imprimir/commitar segredos (só o nome da variável).
6. **Identidade visual única (dono, 2026-10-04):** só a identidade atual (`public/assets/matheus-machado-symbol.png`, `og-matheus-machado-v2.png`, `public/icons/*-mm.png`); logos antigas foram apagadas — nunca restaurar nem recriar; variante nova, pedir ao dono (trava: `tests/brand-assets.test.mjs`). Nome oficial: “Matheus Machado Corretor de Imóveis” (`.claude/rules/frontend-pwa.md`).
7. **Regras que ficam nos arquivos do módulo:** UNIQUE por telefone, nome das migrations (14 dígitos) e `scratch/` → `.claude/rules/database-supabase.md` e `.claude/rules/workflow-dev.md` (carregam sozinhas ao mexer na área).

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
| Marketplace do Facebook (roleta, chat, extensão) | `.claude/rules/marketplace-chat.md` |
| Documentação do cliente, IA, envio à CCA | `.claude/rules/documentacao-cca.md` |
| Automações, notificações, push, mensagem diária | `.claude/rules/automacoes-notificacoes.md` |
| Financeiro (comissões, despesas, recebimentos) | `.claude/rules/financeiro.md` |
| Integrações externas (WhatsApp, IA, e-mail, cron) | `.claude/rules/integracoes-externas.md` |
| Assistente de voz Henry (voz, treino, bom dia) | `.claude/rules/henry-assistente-voz.md` |
| E-mail marketing / prospecção por e-mail | `.claude/rules/email-marketing.md` |
| Convenções de frontend, PWA | `.claude/rules/frontend-pwa.md` |
| Academia (formação dos corretores) | `.claude/rules/academia.md` |
| Indicadores Econômicos (aba, Radar, correção, alertas econômicos) | `.claude/rules/indicadores-economicos.md` |
| Workflow de dev, build, deploy, testes | `.claude/rules/workflow-dev.md` |

**Provenância das regras:** todo item de regra de negócio em `.claude/rules/` carrega uma das três etiquetas abaixo — não assuma que um comportamento do código é regra oficial só porque é o que o código faz hoje.

- **[REGRA OFICIAL DE NEGÓCIO]** — definida e confirmada pelo dono do CRM diretamente (nesta conversa ou anteriormente documentada como tal). Fonte de verdade para o que o sistema *deveria* fazer.
- **[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO]** — é assim que o código funciona hoje; pode estar certo, pode estar desatualizado, pode ser só uma escolha técnica sem peso de regra de negócio. Não presuma que é permanente.
- **[PENDENTE DE VALIDAÇÃO]** — comportamento encontrado no código cuja intenção ainda não foi confirmada pelo dono. Pode virar regra oficial ou ser corrigido, dependendo da resposta.

**Carregamento das rules:** as rules sem `paths:` (`workflow-dev.md`, `auth-permissoes.md`) entram em toda sessão; as demais só quando você lê (ferramenta Read) um arquivo do módulo. Ao responder sobre um módulo sem ter lido arquivo dele, leia a rule da tabela acima; `grep`/`cat` não carregam.

Quando uma REGRA OFICIAL diverge do COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO, o arquivo de regras documenta os dois lado a lado — isso não é uma inconsistência a "resolver" silenciosamente editando o código; é um gap conhecido esperando uma tarefa de implementação explícita.

## Agentes e skills

Quem faz o quê, quando NÃO usar cada agente, skills e regras de cada um: **`.claude/despachante/MAPA-AGENTES.md` (fonte única)**; entrada padrão do dono: agente `despachante` (`/despachar`). Política de autonomia dos agentes (parar só em decisão de negócio ou ação irreversível em dado real; em segundo plano termina com `DECISÃO NECESSÁRIA`): `docs/DESPACHANTE.md` §5. Qualquer alteração de código → `crm-editor`; bug → `/diagnosticar-bug`; depois de corrigir → `/verificar-correcao`; regra nova do dono → `/registrar-regra`.

## Economia de contexto

- Ler o mínimo: Grep primeiro, Read com offset/limit; arquivo >20 KB só em trecho (`CHANGELOG_AI`, `BUSINESS_RULES`, `WHATSAPP` nunca inteiros).
- **Nível de esforço dos subagentes (regra do dono, 2026-10-29):** subagentes de busca e tarefas simples rodam em `effort: low`; de escrita e pequenas alterações, em `medium`; de revisão, decisão e coordenação de outros agentes (Diretores, auditoria, crítica), em `high`; exceções por decisão do dono (2026-10-29): `despachante` e `analista-documental` em `medium`. Todo agente novo em `.claude/agents/` precisa declarar `effort` no cabeçalho.
- Delegar com cabeçalho curto e caminho:linha (modelo no MAPA); não colar regras que já estão neste CLAUDE.md.
- Não reler/reinvestigar o que já foi lido ou registrado (`REGISTRO` do Despachante, `git log`).
- **Regra do dono (2026-10-17): toda resposta ao dono deve ser curta e objetiva** — direto ao ponto, poucas linhas, sem explicação que ele não pediu. Relatórios curtos (≤~60 linhas), decisão e números primeiro; sem relatório `.md`. Uma fonte por informação. Paralelizar só tarefas independentes.
- **NUNCA cortar por economia:** hooks/guard de SQL e settings, banco somente leitura dos analíticos, regras de dado real, guards de permissão, testes `node --test` e build, verificação de produção, `/verificar-correcao`, leitura da rule do módulo antes de editar, registro em `docs/CHANGELOG_AI.md` e etiquetas de proveniência.
