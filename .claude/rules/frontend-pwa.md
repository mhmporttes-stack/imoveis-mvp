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

`components/AdminSimulationList.jsx` é a lista principal do CRM (~2.260 linhas). Busca, filtros e paginação são feitos **no servidor** (`/api/simulation-registrations/list` → `lib/simulation-list-query.js`); o componente só exibe a página atual e os contadores devolvidos pela API. Ao mexer em filtro/aba/contador, altere a query do servidor, não um filtro local no componente (divergência D-1 de `docs/SYSTEM_ARCHITECTURE.md` §12, reconciliada em 2026-10-01).

`components/PerformanceOverviewDashboard.jsx`, `components/DailyGoalDashboard.jsx`, `components/TeamDailyPerformance.jsx` — telas de ranking/Meta Diária, ver `.claude/rules/meta-diaria-ranking.md`.

## Estilo

Tailwind CSS, identidade visual azul institucional/navy, português do Brasil em toda a interface. Datas/horários sempre em `America/Sao_Paulo` (helpers em `lib/daily-report.js`: `getTodayInSaoPaulo`, `getTimeGreeting`, etc. — reutilize, não reimplemente cálculo de fuso horário). Valores monetários em BRL com formatação brasileira (`Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`).

## PWA

`app/manifest.js`, `public/sw.js`, `public/offline.html`. `public/sw.js` é **regenerado automaticamente** a cada build (`scripts/stamp-service-worker.mjs`, script `prebuild`) — não edite o hash de versão nele manualmente nem commit uma mudança nesse arquivo que seja só o hash mudando (reverta com `git checkout -- public/sw.js` antes de commitar se não houver mudança de lógica real no service worker). Doc dedicada: `docs/pwa-admin.md`.

## Não confundir

- `properties` (imóveis/empreendimentos, conteúdo) com `empreendimentos` (regras comerciais de cálculo de entrada em JSON, mesmo ID do produto).
- O catálogo interno de CRM de empreendimentos não é a mesma tela que o cadastro administrativo de empreendimentos.
- `mcmv-calculator/` vs. `lib/simulacao-entrada/*` — ver regra global em `CLAUDE.md`.
