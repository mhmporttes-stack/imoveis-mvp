---
paths:
  - "components/**"
  - "app/**/*.jsx"
  - "app/manifest.js"
  - "public/sw.js"
  - "public/offline.html"
  - "scripts/stamp-service-worker.mjs"
  - "tailwind.config.cjs"
---

# Convenções de frontend e PWA

## Next.js App Router

- Páginas em `app/admin/**` são Server Components por padrão (buscam dado direto de `lib/*.js`), passando dado inicial pra um Client Component (`"use client"`) que gerencia estado/interação (`components/*.jsx`). Padrão comum: `initialGoal`/`initialOverview` como prop, com `useEffect` refazendo o fetch via `/api/...` quando filtros mudam — mantenha uma guarda contra refetch duplicado na primeira montagem (`isFirstRender` ref), já foi um bug de dobrar consulta ao banco sem essa guarda.
- APIs (`app/api/**/route.js`) seguem o padrão: guard de auth primeiro, `try/catch` no corpo, retorno `NextResponse.json({ error: "..." }, { status })` em erro. Ao adicionar uma rota nova, siga exatamente esse formato — já foi feita uma auditoria confirmando que praticamente todas as rotas seguem esse padrão; não introduza uma exceção sem motivo.
- Combine múltiplas queries independentes com `Promise.all`/`Promise.allSettled` em vez de `await` sequencial quando não há dependência entre elas — várias telas do painel já tiveram esse ajuste depois de medição real de lentidão.

## Componentes grandes/centrais

A Lista de clientes é `components/clients/` (`ClientWorkspace` tela, `useClientList` estado/ações/API, `ClientCard` card, `ClientSheet` ficha, `StatusOptions` lista única de etapas). Busca, filtros e paginação são feitos **no servidor** (`/api/simulation-registrations/list` → `lib/simulation-list-query.js`); a tela só exibe a página atual e os contadores devolvidos pela API. Ao mexer em filtro/aba/contador, altere a query do servidor, não um filtro local no componente (divergência D-1 de `docs/SYSTEM_ARCHITECTURE.md` §12, reconciliada em 2026-10-01).

`components/PerformanceOverviewDashboard.jsx`, `components/DailyGoalDashboard.jsx`, `components/TeamDailyPerformance.jsx` — telas de ranking/Meta Diária, ver `.claude/rules/meta-diaria-ranking.md`.

## Estilo

**Decisão visual é do agente `designer-crm`** (Diretor de Design; conhecimento em `.claude/design/`, índice `README.md`). Crítica, redesenho, revisão visual ou ajuste de layout/mobile → **invoque a skill `/design-crm`** (ou delegue ao `designer-crm`) antes de responder ou editar; PDF, proposta, material comercial, imagem/foto e identidade → `/direcao-criativa`. Para quem só implementa ajuste local (não redesenha), toda mudança de interface segue `.claude/skills/design-crm/references/sistema-visual.md` (tokens, escalas, decisões) — não invente raio, tamanho de texto ou cor de status solta. Componentes base em `components/ui/` (Button, Badge, StatusBadge, Card, Sheet, EmptyState, Skeleton, Field, Tabs/`tabClasses` para abas em pílula, Kpi para indicadores) — use-os em vez de recriar; o que as telas antigas ainda desenham à mão é normalizado no painel pela camada "telas" de `app/admin-theme.css`. Navegação no celular = `AdminBottomNav` (barra inferior); no computador (≥ 768px) o menu lateral recolhível (`AdminMenu`, montado em `app/admin/layout.jsx`, visual novo de 2026-10-22), ambos de `getAdminMenuGroups`; ícones em `components/admin-nav-icons.js`. Cabeçalho do painel: `components/AdminTopBar.jsx`. Tokens do visual novo só valem com `html.mm-panel` (painel), o site público não muda. Revisão visual sem login: vitrine `app/dev/vitrine` (só `next dev`, nunca em produção).

Tailwind CSS, identidade visual azul institucional/navy, português do Brasil em toda a interface. Datas/horários sempre em `America/Sao_Paulo` (helpers em `lib/daily-report.js`: `getTodayInSaoPaulo`, `getTimeGreeting`, etc. — reutilize, não reimplemente cálculo de fuso horário). Valores monetários em BRL com formatação brasileira (`Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`).

**[REGRA OFICIAL DE NEGÓCIO — definida pelo dono em 2026-10-16] Nome da marca.** “não é Matheus Machado Imóveis, [é] Matheus Machado Corretor de Imóveis.” Todo texto lido por cliente ou corretor (site, SEO/JSON-LD/Open Graph, mensagens de WhatsApp e fluxos, e-mails, PDFs, avisos do CRM, Manual/guias) usa “Matheus Machado Corretor de Imóveis” (em frase: “da equipe do Matheus Machado Corretor de Imóveis”); nunca “Matheus Machado Imóveis”. Não mudam: domínio `matheusmachadoimoveis.com.br`, e-mails/URLs, nomes de arquivo/asset, variáveis de ambiente, docs históricos. Fonte do nome no SEO: `BUSINESS_NAME` (`lib/public-seo.js`). Textos no banco (fluxos, guias, Manual, `crm_settings`, modelos da Meta) precisam de ajuste à parte. Trava: `tests/brand-assets.test.mjs`. Detalhes: `docs/BUSINESS_RULES.md` MARCA-1.

Academia (`/academia`): fonte Fraunces e a metáfora do prédio com guindaste aprovadas pelo dono; o orçamento de 150 KB vale só para a parte própria da Academia — `.claude/rules/academia.md` (ACA-3 a ACA-6).

## PWA

`app/manifest.js`, `public/sw.js`, `public/offline.html`. `public/sw.js` é **regenerado automaticamente** a cada build (`scripts/stamp-service-worker.mjs`, script `prebuild`) — não edite o hash de versão nele manualmente nem commit uma mudança nesse arquivo que seja só o hash mudando (reverta com `git checkout -- public/sw.js` antes de commitar se não houver mudança de lógica real no service worker). Doc dedicada: `docs/pwa-admin.md`.

Versão nova (dono, 2026-10-26: "quando eu saio do app e volto, ele tem que carregar tudo de novo"): **nunca recarregar ao sair/voltar para o app**. A atualização fica pendente e entra na próxima troca de tela (link vira abertura completa; `router.push` recarrega depois), nunca digitando — `components/PwaLifecycle.jsx` + regra pura `components/pwa-update-policy.mjs` (`tests/pwa-update-policy.test.mjs`). Não reintroduza `location.reload` em `visibilitychange`/`pageshow`.

**[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] O app do dono abre no Início (INI-6).** "Quando eu iniciar o aplicativo, eu quero que ele abra na página de início e não na página clientes." Só o dono (conta real, fora de "Alterar conta"); demais perfis como antes. Entrada única `app/admin/abrir` (decisão em `lib/painel-entrada-core.mjs`): `start_url` do manifest, `CRM_HOME` do app de desktop e destino do login/2FA — não espalhe outra decisão de tela inicial. Detalhe: `docs/BUSINESS_RULES.md` INI-6.

Pré-carregamento do painel (dono, 2026-10-22: "Carregue primeiro a aba Clientes e depois vá carregando tudo"): `components/AdminWarmup.jsx` + plano puro `components/admin-warmup-plan.mjs` (Clientes → barra/cabeçalho → menu inteiro do perfil; celular e computador). Tela que grava ou chama serviço externo ao abrir entra em `ROUTE_ONLY_PATHS` (só rota) — a Meta Diária nunca é montada (MD-16). Tela nova com dados buscados no cliente pode usar o cache por conta (`readViewerData`/`saveViewerData`, nome em `components/panel-cache-names.js`) e um aquecedor em `DATA_WARMERS`. Detalhe: `docs/pwa-admin.md`.

Henry no app (dono, 2026-10-22, só o dono): botão do anel no canto inferior ESQUERDO, logo acima da barra inferior (`bottom: max(safe-area, --admin-bottom-nav-space)`, `z-[35]`) — não o mova para cima da barra nem para a direita (botões flutuantes das telas). Cena cheia com safe-area, sem rolagem por trás, "voltar" e arrastar para baixo minimizam. Detalhe: `docs/BUSINESS_RULES.md` HENRY-1.

## Não confundir

- `properties` (imóveis/empreendimentos, conteúdo) com `empreendimentos` (regras comerciais de cálculo de entrada em JSON, mesmo ID do produto).
- O catálogo interno de CRM de empreendimentos não é a mesma tela que o cadastro administrativo de empreendimentos.
- `mcmv-calculator/` vs. `lib/simulacao-entrada/*` — ver regra global em `CLAUDE.md`.
