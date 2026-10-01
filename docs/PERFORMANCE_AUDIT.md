# PERFORMANCE_AUDIT — checklist de performance (site + CRM + PWA)

> Checklist reutilizável da auditoria de performance pedida pelo dono em 2026-10-01. Reexecute esta mesma auditoria (3 agentes paralelos: frontend/Next.js, Supabase/queries, Chat-WhatsApp/PWA, + verificação manual de cada achado antes de aplicar) periodicamente e atualize este arquivo — não crie um novo.
>
> **Regra seguida nesta rodada:** nenhuma mudança visual/layout/cor/componente. Toda alteração de comportamento (não visual) com risco baixo/médio foi aplicada direto; risco alto ou qualquer coisa com efeito visual relevante fica só registrada abaixo, aguardando autorização.
>
> **Lição desta rodada:** 2 dos "achados de alto impacto" reportados pelos subagentes (poll de 3s do WhatsApp individual, poll de 2,5s da Supervisão) eram falsos positivos — ao ler o código直, o primeiro só roda com o modal de QR aberto e em transição; o segundo é uma checagem local de DOM (`querySelector`), não uma chamada de rede. Ambos descartados sem alteração. Sempre confirme um achado no código antes de agir.

## ETAPA 1 — Baseline (2026-10-01)

- TTFB do site público (home, medido via `performance` API no navegador real, produção): **636ms**. domContentLoaded 773ms, load 795ms, 20 requisições na carga inicial.
- Causa raiz do TTFB: `app/page.jsx` e `app/empreendimentos/[id]/page.jsx` eram `force-dynamic` — toda visita recalculava tudo e batia no Supabase, sem cache de CDN. **Corrigido nesta rodada** (ver checklist).
- Instrumentação de CWV real (LCP/INP/CLS/TTFB/FCP) **não existia** antes desta auditoria — adicionada (`@vercel/analytics` + `@vercel/speed-insights`), dados aparecerão no painel da Vercel a partir de agora.
- Build de produção (`next build`) antes e depois das mudanças: limpo, sem erros/warnings, nas duas vezes.

## ETAPA 2 — Checklist

### 1. Front-end

- [x] **Verificação de sessão duplicada em toda navegação do admin** — impacto: alto | risco: baixo | situação: `app/admin/layout.jsx` e cada `page.jsx` chamavam `getAdminFromCookies()` de forma independente (1 round-trip ao Supabase Auth + 1 query em `admin_users` cada), dobrando o custo de auth antes do primeiro paint. | ação: memoizado com `cache()` do React em `lib/admin-auth.js` — **feito**.
- [x] **`<Image priority>` duplicado na hero do site público** — impacto: baixo | risco: baixo | situação: logo pequena (`matheus-machado-symbol.png`) e a foto de fundo da hero disputavam o mesmo preload prioritário (`app/page.jsx`). | ação: `priority` removido da logo, mantido só na imagem real de LCP — **feito**.
- [x] **Dependência `three` sem nenhum import real** — impacto: baixo | risco: baixo | situação: `package.json` listava `three@0.186.0`; grep completo no repo não achou nenhum import. | ação: removida do `package.json` e do `pnpm-lock.yaml` — **feito**.
- [ ] **WhatsApp Chat e Prospecção sem paginação/virtualização na lista** — impacto: médio | risco: médio (muda comportamento/UX) | situação: `components/WhatsappChat.jsx` (lista de conversas) e `components/ProspectingManager.jsx` (Base da Imobiliária) renderizam toda a lista retornada, sem scroll infinito nem `react-window`; o backend do Chat já suporta `?before=` (só usado no modal de documentação). | ação recomendada: adicionar "carregar mais"/scroll infinito reaproveitando o `before` que já existe — **não aplicado, precisa de autorização** (muda a experiência de rolagem).
- [ ] **WhatsappChat sem prefetch no servidor (fetch client-side em cascata)** — impacto: alto | risco: alto | situação: `app/admin/chat/page.jsx` só valida auth no servidor; a primeira página de conversas só chega depois de um `useEffect` no cliente — visitante sempre vê um loading antes de qualquer conversa aparecer. | ação recomendada: refatorar para buscar a 1ª página no servidor e passar como prop inicial — **não aplicado** (reescrita grande de um componente de 1600+ linhas, risco real de regressão).
- [x] **Checklist de `useMemo`/intervalos de poll avaliados e descartados por não terem ganho mensurável** — `DailyGoalAdmin.jsx` (sort de ~8 corretores), `BrokerPerformanceDetail.jsx` (Math.max em lista de ~7 etapas), `WhatsappIndividualStatus` (poll de 3s só ocorre com modal de QR aberto) e `SupervisionMessageGate` (intervalo de 2,5s é checagem local de DOM, não rede) — confirmados como não sendo gargalo real; nenhuma mudança feita (evita "micro-otimização sem benefício mensurável", regra explícita do dono).

### 2. Next.js

- [x] **Home e ficha de empreendimento públicas em `force-dynamic`** — impacto: alto | risco: baixo | situação: ambas são páginas 100% públicas (sem cookies/sessão), mas recalculavam tudo a cada visita. | ação: trocado para `export const revalidate = 60` (ISR) em `app/page.jsx` e `app/empreendimentos/[id]/page.jsx` — **feito**, build confirma `/` agora estático com revalidate 1 min.
- [ ] **`images.unoptimized: true` no `next.config.mjs` (desde o commit inicial)** — impacto: médio-alto | risco: alto | situação: nenhuma imagem do site (fotos de imóveis, avatares, mídia do Chat) passa por resize/conversão WebP/AVIF da Vercel. | ação recomendada: habilitar o otimizador configurando `images.remotePatterns` para o domínio do Supabase Storage. **Não aplicado — precisa autorização**: exige configurar remotePatterns corretamente (ou toda imagem externa quebra com erro 400), consome a cota de "Image Optimization" do plano Vercel (o projeto já teve um bloqueio por limite de CPU do plano Hobby em 2026-09-26) e o ganho real só aparece combinado com uma campanha de trocar `<img>` por `<Image>` nos locais listados abaixo.
  - Locais que mais ganhariam (hoje usam `<img>` cru): `components/Avatar.jsx`, `components/ClientCard.jsx`, `components/EmpreendimentoPresentation.jsx`, `components/WhatsappChat.jsx` (mídia), `components/PropertyForm.jsx`, `components/SimulationGenerator.jsx`. CLS hoje é baixo (todos já têm tamanho fixo), então o ganho seria só de peso/formato, não de estabilidade visual.
- [x] **`xlsx` e `pdfjs-dist`** — já usam `await import()` dinâmico nos dois pontos de uso (`WhatsappDisparoManager.jsx`, `ProspectingManager.jsx`, `WhatsappChat.jsx`) — confirmado, nenhuma ação necessária.
- [x] **`proxy.js` (middleware)** — enxuto, só checa cookie, matcher restrito a `/admin` e `/api` (não roda no site público) — confirmado, nenhuma ação necessária.
- [ ] **Baseline de CWV não existia** — impacto: alto (visibilidade) | risco: baixo | ação: `@vercel/analytics` + `@vercel/speed-insights` adicionados em `app/layout.jsx` — **feito**. Dados reais de LCP/INP/CLS passam a aparecer no dashboard da Vercel a partir do próximo deploy.

### 3. Supabase/banco

- [x] **Auth: `admin_users` com `select("*")` em toda request autenticada** — impacto: alto | risco: baixo | situação: `findAdminProfileByAuthOrEmail` (`lib/admin-profiles.js`) trazia todas as colunas da tabela em toda checagem de sessão. | ação: projeção explícita só das colunas que `rowToAdminProfile` lê — **feito**.
- [x] **Financeiro: join trazia a tabela inteira de clientes por venda, sem limite** — impacto: alto | risco: baixo (verificado campo a campo) | situação: `listFinancialSales`/`getFinancialSale` (`lib/financial.js`) usavam `client:simulation_registrations!inner(*)` — tabela larga, inteira, por venda; conferido que só `full_name`, `phone` e `responsible_user_id` são usados. | ação: projeção trocada para essas 3 colunas — **feito**.
- [x] **N+1: sincronização de templates do WhatsApp (1 upsert por template)** — impacto: médio | risco: baixo | situação: `runTemplateSyncFromMeta` (`lib/whatsapp-broadcasts.js`) fazia 1 `upsert` por linha num loop. | ação: upsert em lote (1 chamada com o array todo) — **feito**.
- [ ] **Listagem pública de imóveis inclui `photos_json` completo** — impacto: médio | risco: alto para mexer agora | situação: `PUBLIC_LIST_COLUMNS` (`lib/public-properties.js`) inclui `photos_json` **de propósito documentado no próprio código** — os cards da home mostram foto, e não existe hoje uma coluna separada de thumbnail. O incidente de 28/09 (uma propriedade com 1,35MB de base64 na linha) já foi corrigido na origem (dado), não na arquitetura. | ação recomendada: criar uma coluna dedicada de thumbnail/primeira foto (migration + backfill + ajuste no fluxo de upload) para a listagem parar de carregar o JSON completo de fotos. **Não aplicado** — contraria uma decisão já documentada no código e exige schema novo, não é uma mudança "invisível" de baixo risco.
- [ ] **59 foreign keys sem índice / 105 índices nunca usados (advisor do Supabase)** — impacto: baixo (maioria é severidade INFO, tabelas de auditoria/baixo tráfego) | risco: médio (apagar índice "nunca usado" pode ser estatística recente, não necessariamente morto) | ação recomendada: revisar caso a caso com `EXPLAIN ANALYZE` antes de qualquer `DROP INDEX`/`CREATE INDEX`. **Não aplicado** — nenhum dos 59 FKs mapeia para uma coluna filtrada num caminho quente conhecido hoje.
- [ ] **N+1 de menor volume, não corrigidos (baixo tráfego, sem ganho mensurável agora):** `lib/lead-distribution.js` (reatribuição em loop, roda só quando há fila pendente), `lib/whatsapp-master.js` (reconciliação de contagem de broadcast, 1 update por broadcast), `lib/simulation-registrations.js` (supressão de conversas ao excluir cliente, 1-3 linhas por cliente). Registrados para quando o volume crescer.

### 4. Chat/WhatsApp

- Realtime do Chat já usa um único canal Broadcast compartilhado (store singleton em `components/useWhatsappChatSummary.js`), com poll de segurança de 30s só com a aba visível — **padrão já correto**, nenhuma ação.
- [ ] Histórico de mensagens limitado a 100 sem "carregar mais" na tela normal do Chat (só existe dentro do modal de documentação) — ver item de paginação acima.
- [ ] Mídia recebida (fotos/áudio) sempre no tamanho original, sem thumbnail — depende da mesma decisão de `images.unoptimized`/pipeline de mídia acima.
- [ ] Qualquer mudança em qualquer conversa recarrega lista + conversa aberta de todos os clientes conectados (o broadcast "changed" não carrega o id da conversa afetada) — impacto cresce com volume de mensagens simultâneas; não corrigido nesta rodada (mudança de protocolo do broadcast, risco médio).

### 5. PWA/App mobile

- Service worker (`public/sw.js` + `components/PwaLifecycle.jsx`) já registra só após o load, cache-first para estáticos, network-only para `/admin` e `/api`, com fallback offline — **já correto**, nenhuma ação.
- `AdminPresenceHeartbeat` já é 100% orientado a interação real, sem timer periódico — **já correto**.
- [ ] Sem `vercel.json`/`headers()` para `Cache-Control` explícito em `/public` (ícones, `sw.js`, decoder de áudio vendorizado) — impacto baixo, risco baixo; não aplicado nesta rodada por falta de ganho mensurável comprovado (Vercel já aplica cache razoável por padrão a estáticos).
- [ ] Ícones órfãos em `public/icons/` (conjunto antigo sem sufixo `-mm`, não referenciado em produção) — peso morto no repo, zero efeito em produção hoje; limpeza de baixa prioridade.

### 6. Rede/API — achados já cobertos nas seções acima (auth duplicada, financeiro, templates).

### 7. Vercel/Produção

- Build de produção limpo antes/depois (`next build`, sem erros/warnings).
- Sem acesso a logs de runtime da Vercel neste ambiente (sem token/CLI configurado) — não foi possível medir duração de function/cold start diretamente; a instrumentação do Speed Insights cobre isso a partir de agora.

### 8. Core Web Vitals — medido (ver Baseline acima); comparação "antes/depois" de LCP/INP real só estará disponível depois de alguns dias de tráfego com o Speed Insights ativo.

### 9. Telas críticas — cobertas via os achados de Chat, Ranking (auditoria de pontuação já feita em 2026-10-01, arquitetura de pontuação não tem gargalo de performance identificado), Financeiro, Prospecção acima.

## ETAPA 5 — Alterações visuais que precisam de autorização

Nenhuma. Todos os achados com risco real (`images.unoptimized`, paginação do Chat/Prospecção, prefetch do WhatsappChat, coluna de thumbnail de imóveis) são mudanças de **comportamento/arquitetura**, não de aparência — ficaram registrados acima como "não aplicado, precisa autorização" em vez de forçados automaticamente, pela extensão do risco (não pelo critério visual).
