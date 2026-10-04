> Origem: plano técnico aprovado da Academia (feat/academia), copiado sem alterações do repasse de 2026-10-04.
> Estado: F0 e F1 feitas; F2 em diante são PLANO. Visão geral atual: [`../ACADEMIA.md`](../ACADEMIA.md).
> O que vale sobre o código é `../ACADEMIA.md`; este arquivo é a referência do plano.

# Plano técnico: Academia dentro do CRM (imoveis-mvp)

Só plano. Nada foi alterado no repositório nem no Supabase. Base: AGENTS.md, CLAUDE.md, rules auth/database/frontend/workflow, docs/DATABASE.md, PERMISSIONS.md, SYSTEM_ARCHITECTURE.md §12/§13 e o código atual. Itens marcados A CONFIRMAR dependem do dono ou de leitura em produção (não feita).

## 1. Encaixe na arquitetura

**Rotas.** Páginas em `app/academia/**` (Server Components que chamam `lib/`, mesmo padrão de `app/admin/**`): `page.jsx` (Início), `trilha/`, `evolucao/`, `aula/[lessonId]`, `prova/[examId]` (Questão/quiz), `conquista/[moduleId]`, `certificacao/[enrollmentId]`, `gestao/**` (só gestor/admin), `editor/**` (só admin). APIs em **`app/api/admin/academia/**`** (e não em `/api/academia`): fica sob o inventário de guards já auditado (`docs/PERMISSIONS.md` §6) e os cookies têm `path: "/"` (`lib/admin-auth.js:76-96`), então o login atual vale em `/academia` sem mudança. Mesmo login, mesma sessão, mesmos usuários.

**Layout sem nav do CRM.** `app/academia/layout.jsx` próprio, `force-dynamic`, chama `getAdminFromCookies()` (cache por request, `lib/admin-auth.js:284`). Não herda `app/admin/layout.jsx` (que monta heartbeat, gates de alerta/celebração/supervisão, ranking, `AdminBottomNav` e botão Sair, l.29-87), pois `/academia` fica fora de `/admin`. Mas três peças globais olham o caminho e precisam de ajuste mínimo e aditivo:
- `components/AppChrome.jsx:46-62`: hoje qualquer rota não `/admin` ganha Header/Footer do site, MetaPixel, CampaignLinkCapture, WhatsApp flutuante e modal de captura. Adicionar um ramo `if (pathname?.startsWith("/academia")) return <><PwaLifecycle/><ViewportZoomLock/>{children}</>` (mesmo padrão de `/minha-jornada/` e `/dev/`, l.34-39). Sem isso o site público aparece por cima da Academia e o Pixel dispara para corretores.
- `proxy.js:36` (`matcher`) e `proxy.js:11-22`: só protegem `/admin` e `/api`. Incluir `/academia/:path*` no matcher, com redirecionamento ao login sem cookie e `no-store` (cópia da lógica de `/admin`, sem alterar o que já existe).
- `components/AdminSessionKeeper.jsx:13-15` só renova a sessão em `/admin*`. Reutilizar o componente passando o prefixo `/academia` (ou um mount próprio no layout da Academia) para a sessão de 1 h não expirar no meio de uma prova.

**Service worker/PWA.** `public/sw.js:138-140`: `isPrivateRoute` cobre só `/admin` e `/api`; `/academia` cairia em `networkFirstNavigation` (l.179) e o HTML autenticado poderia ser guardado. Acrescentar `|| pathname.startsWith("/academia")` ali (mudança real de lógica no SW, então o `public/sw.js` entra no commit; o hash do prebuild continua sendo revertido se for só ele). Offline: nenhum no MVP (a Academia exige login e rede; `networkOnly` já devolve `/offline.html`). `app/manifest.js` não muda (scope `/`, start_url do CRM). Arte pesada vai em `public/academia/` e fica coberta pelo cache-first de `/_next/static` só se for importada pelo bundle; arquivos em `public/` NÃO são cacheados (só `/assets` e `/icons` são, l.142-149): usar `/assets/academia/**` se quisermos cache imutável.

**Guards (login reaproveitado).** Página: `requireAdminPage()` (l.293) para aluno; `requireBrokerManagementPage("/academia")` para `gestao`; `requireGeneralAdminPage("/academia")` para `editor`. Observação: os redirects desses helpers vão a `/admin/login` e fallback `/admin`; aceitável (login é um só), mas o fallback deve ser passado explicitamente (`"/academia"`).

**"Alterar conta" (view-as, P-17).** Regra vigente: ação **operacional** feita pelo admin como corretor fica atribuída ao emulado (`.claude/rules/auth-permissoes.md`). Treinamento não é ação operacional: se o admin concluísse aulas/provas "como" um corretor, falsificaria progresso e geraria certificado em nome de outra pessoa. **Proposta:** em `auth.accountSwitchMode` a Academia é **somente leitura** (admin vê a Academia como o corretor vê, mas toda escrita de progresso/tentativa/certificado é recusada 403 no servidor, `lib/academy-access.js`), igual à lógica ainda PENDENTE da Supervisão (`automacoes-notificacoes.md`). Ações administrativas (publicar, atribuir) gravam o admin real via `getActingAdminEmail` (`lib/admin-auth.js:208`). Decisão do dono (item 8).

**Entrada no CRM.** Item "Academia" em `components/AdminMenu.jsx` dentro de `getAdminMenuGroups` (l.194, fonte única também da barra inferior `AdminBottomNav`), para os 4 perfis, atrás da flag (seção 5). É um `<a href="/academia">` simples (navegação completa, fora do `SceneTransitionRoot`). "Voltar ao CRM" discreto na Academia = link para `/admin/simulacoes` (start_url do app). A flag decide se o item existe; a rota continua protegida pelo servidor mesmo com o item escondido.

## 2. Modelo de dados

Convenções do projeto (`docs/DATABASE.md` §1-2, §7; `20260821_broker_users_access.sql`): `id uuid primary key default gen_random_uuid()`, `created_at/updated_at timestamptz not null default now()`, usuários referenciam `admin_users(id)` (uuid; aluno = `admin_users.id`, nunca e-mail), enums como `text` + `check`, tabela nova com `enable row level security` + `revoke all ... from anon, authenticated` e SEM policy (padrão de `20261003210000_central_credentials.sql`; regra 6 de DATABASE §7). Prefixo `academy_`. Nenhum UNIQUE por telefone (a Academia nem usa telefone). Nenhuma coluna nova em tabela existente.

**Versionamento (regra central):** conteúdo publicado é **imutável**. Editar = criar nova versão da trilha (cópia das linhas de módulos/aulas/atividades/provas, que guardam `stable_key uuid` para reconhecer "a mesma aula" entre versões). Matrícula fica presa à versão em que começou; tentativas e certificados guardam snapshot do que foi servido. Nada é apagado, só `retired`.

| Tabela | Colunas principais | Chaves/índices | MVP? |
|---|---|---|---|
| `academy_tracks` | `slug`, `title`, `kind` check (`formacao_inicial`,`aperfeicoamento`,`especializacao`,`reciclagem`,`atualizacao`), `status` (`draft`,`active`,`archived`), `is_mandatory_default bool` | unique `slug` | Essencial |
| `academy_track_versions` | `track_id`, `version_number int`, `status` (`draft`,`published`,`retired`), `published_at/by`, `change_note`, `settings jsonb` (`unlock_mode`, `pass_score`, `max_attempts`, `certificate_rule`) | unique `(track_id, version_number)`; unique parcial 1 `draft` e 1 `published` por trilha | Essencial |
| `academy_modules` | `track_version_id`, `stable_key`, `position`, `title`, `summary`, `unlock_rule jsonb`, `is_final bool` | idx `(track_version_id, position)` | Essencial |
| `academy_lessons` | `module_id`, `stable_key`, `position`, `title`, `est_minutes`, `body jsonb` (blocos; vazio no MVP) | idx `(module_id, position)` | Essencial (estrutura); corpo em F3 |
| `academy_activities` | `lesson_id`, `position`, `kind`, `config jsonb` (interações/atividades) | idx `lesson_id` | Preparado (F3) |
| `academy_questions` (banco) | `stable_key`, `qversion int`, `type` (`single`,`multi`,`true_false`), `statement`, `options jsonb`, `correct jsonb`, `explanation`, `topic`, `status` | idx `(stable_key, qversion)` | F4 |
| `academy_exams` | `module_id` ou `track_version_id`, `kind` (`module`,`final`), `pass_score` (nulo = padrão da versão), `max_attempts`, `time_limit_min`, `selection jsonb` (fixa/aleatória, quantidade) | idx módulo | F4 |
| `academy_exam_questions` | `exam_id`, `question_id` (linha exata e versão), `position`, `weight` | pk `(exam_id, question_id)` | F4 |
| `academy_enrollments` | `user_id` → `admin_users`, `track_id`, `track_version_id`, `source` (`manual`,`auto_new_broker`,`recommendation`,`recycle`), `required bool`, `due_at`, `status` (`assigned`,`in_progress`,`completed`,`expired`,`cancelled`), `assigned_by`, `started_at`, `completed_at` | unique parcial `(user_id, track_id)` onde status ativo (permite refazer reciclagem depois); idx `user_id`, idx `due_at` | Essencial |
| `academy_lesson_progress` | `enrollment_id`, `lesson_id`, `status`, `completed_at`, `seconds_spent` | unique `(enrollment_id, lesson_id)` (idempotência) | Essencial |
| `academy_exam_attempts` | `enrollment_id`, `exam_id`, `attempt_number`, `started_at`, `submitted_at`, `score`, `passed`, `status`, `served jsonb` (snapshot das questões servidas) | unique `(enrollment_id, exam_id, attempt_number)` | F4 |
| `academy_attempt_answers` | `attempt_id`, `question_id`, `answer jsonb`, `is_correct`, `points` | unique `(attempt_id, question_id)` | F4 |
| `academy_certificates` | `enrollment_id` (unique), `user_id`, `track_version_id`, `code` (aleatório, unique), `issued_at`, `issued_by` (nulo = automático), `snapshot jsonb` (nome, trilha, versão, nota, datas), `revoked_at/reason` | unique `code`, idx `user_id` | F5 |
| `academy_achievements` | `user_id`, `kind`, `ref_id`, `earned_at` | unique `(user_id, kind, ref_id)` | F5 (módulo concluído é derivável antes) |
| `academy_events` | `actor_user_id`, `real_actor_email`, `user_id`, `action`, `ref`, `meta jsonb` | idx `(user_id, created_at)` | F2 (publicar/atribuir/emissão) |
| `academy_assignment_rules`, `academy_recommendations` | regra de auto-matrícula (novo corretor, recorrência/prazo) e recomendações vindas de auditoria de atendimento | — | **Só F7, não criar antes** |

Progresso de módulo = **derivado** (aulas concluídas + prova aprovada) em `lib/`, sem tabela, para não divergir. Gabarito (`correct`) nunca sai do servidor antes do envio. Percentual global = aulas concluídas / aulas da versão da matrícula (prédio: 1 aula = 1 andar).

**Migrations** (14 dígitos; última existente `20261003230000_manual_crm.sql`; datas são sugestão, ajustar ao dia real): `YYYYMMDD100000_academy_content.sql` (tracks, versions, modules, lessons, activities) → `..110000_academy_enrollment_progress.sql` (enrollments, lesson_progress, events) → `..120000_academy_questions_exams_attempts.sql` → `..130000_academy_certificates_achievements.sql` → `..140000_academy_assignment_rules_recommendations.sql` (F7). Todas aditivas e idempotentes (`create table if not exists`, `create index if not exists`, `drop constraint if exists`), só objetos novos, sem tocar `admin_users`/`simulation_registrations`. Reversão = abandonar (flag desligada) ou `drop table` das próprias tabelas `academy_*` com pedido explícito (nunca antes de haver dado real). Aplicação (não é `supabase db push`, sem `config.toml`): script Node descartável em `scratch/` com `pg`, só com pedido explícito do dono, depois commitar o `.sql`; testar antes o SQL em transação com rollback (`supabase/tests/*.sql`, padrão existente). Estado real em produção é A CONFIRMAR (consulta de leitura só quando for aplicar).

## 3. Camada lib/, APIs e permissões

**Arquivos novos (`lib/`, toda leitura/escrita Supabase só aqui, `import "server-only"`):**
- `academy-core.mjs` (puro, testável): `computeUnlock`, `computeProgress`, `gradeAttempt`, `canStartAttempt` (tentativas/prazo), `pickExamQuestions`, `certificateEligibility`, `nextVersionDraft`. Padrão idêntico a `crm-alerts-core.mjs`/`supervision-messages-core.mjs`.
- `academy-access.js`: `getAcademyScope(auth)` (admin = todos; gestor = `auth.profile.managedUserIds`; demais = só ele; reutiliza `resolveTeamVisibilityScope`, `lib/admin-profiles.js:161`) e `assertCanReadUserProgress(auth, userId)`/`assertCanWriteOwnProgress(auth)` (bloqueia `accountSwitchMode`), no estilo de `lib/admin-access.js`.
- `academy-content.js` (CRUD de rascunho, publicar, clonar versão), `academy-enrollments.js` (atribuir, prazos, listar), `academy-progress.js` (concluir aula, andar/percentual), `academy-exams.js` (iniciar/enviar tentativa, correção no servidor), `academy-certificates.js` (emitir, código, revogar), `academy-flags.js` (flag), `academy-seed.js` (trilha de exemplo com títulos neutros, só por ação explícita do admin, não em migration).
- Quem chama: páginas `app/academia/**` (leitura) e rotas `app/api/admin/academia/**` (escrita). Componentes client só falam com rotas.

**Rotas e guards (padrão `{ error }` + status, guard primeiro):**
| Rota | Guard | Escopo |
|---|---|---|
| `GET /academia/me` (trilhas, matrícula, progresso, andar) | `requireAdminApi` | próprio `profile.id` |
| `POST /academia/lessons/[id]/complete` | `requireAdminApi` + `assertCanWriteOwnProgress` | próprio, idempotente |
| `POST /academia/exams/[id]/attempts`, `PUT .../attempts/[id]` | idem | próprio; nota/gabarito só no servidor |
| `GET /academia/team` e `/team/[userId]` | `requireBrokerManagementApi` | `managedUserIds` (admin: todos) |
| `POST /academia/enrollments` (atribuir) | `requireBrokerManagementApi` | gestor só para sua equipe; trilha obrigatória para todos = só admin |
| `GET/POST/PATCH /academia/content/**`, `POST .../publish` | `requireGeneralAdminApi` | admin geral efetivo (em view-as vira 403 de propósito) |
| `POST /academia/certificates` (emitir manual/revogar) | `requireGeneralAdminApi` | admin |
| `GET /academia/certificates/[id]` | `requireAdminApi` + checagem de dono/equipe | ver abaixo |

**Matriz por perfil** (proposta; itens com * dependem de decisão do dono):
| Ação | Admin | Gestor | Corretor | Associado* |
|---|---|---|---|---|
| Ver trilhas atribuídas/publicadas | sim (todas, inclui rascunho) | sim | sim | sim* |
| Fazer aulas/provas | sim (como ele mesmo) | sim | sim | sim* |
| Ver o próprio progresso | sim | sim | sim | sim* |
| Ver progresso da equipe | todos | só equipe (`managedUserIds`, inclui associados) | não | não |
| Editar conteúdo/publicar | sim | não* | não | não |
| Atribuir treinamento | todos | sua equipe | não | não |
| Emitir/revogar certificado | sim | não | não (auto-emissão por regra) | não |
| Ver certificado de outro | todos | só equipe | não | não |
**A UI esconder o botão não substitui nada:** toda linha acima precisa estar no guard da rota E no `lib/academy-access.js` (por usuário alvo), igual à regra de `auth-permissoes.md`. Em especial: `userId` vindo do corpo/URL nunca é confiado; o servidor usa `auth.profile.id` para escrita própria; leitura de terceiro passa por `assertCanReadUserProgress`. Nota: `requireBrokerManagementApi` já exclui corretor e associado (`lib/admin-auth.js:258`).

## 4. Front-end

- **Server vs client.** Páginas = Server Components que buscam dados em `lib/` e passam props iniciais a um client `AcademiaShell` (estado: tela atual, câmera, reduced motion). Aula/Questão = planos sólidos, majoritariamente server + formulário client pequeno. JS puro (sem TS), `.jsx`, `pnpm`.
- **Motor de cena** em `components/academia/scene/` como módulo client carregado com `next/dynamic({ ssr: false })` só dentro de `app/academia/**` (nunca importado por layout/menu do CRM, então o bundle do CRM não muda; o item do menu é um link, não um import). Portar o protótipo em: `camera.js` (estado único + mola criticamente amortecida, passo ≤50 ms, rAF só enquanto algo se move, `visibilitychange`), `quality.js` (níveis N1-N3: mediana dt >24 ms ou >10% >33 ms, §6.1 do direcao.md), `layers/*.jsx` (céu, nuvens, skyline, torre 18 andares, guindaste, tinta/luzes: SVG/CSS rasterizado uma vez, só `transform`/`opacity` animam), `useScrollCamera` (rolagem passiva, sem scroll-jacking). Estado dos andares vem dos dados reais (aulas concluídas), a cena é função pura do snapshot.
- **Tokens/CSS isolados:** CSS Module + variáveis `--ac-*` escopadas em `.academia-root` (nada em `:root`, nada em `app/globals.css` nem em `tailwind.config.cjs`). Tailwind só onde não houver risco de vazar; cena e transições em CSS Module (clip-path, camadas), pela precisão do protótipo. Não usar `components/ui/*` do CRM na cena (visual independente), mas reutilizar `cx.js`/ícones `lucide-react`. Visual segue `designer-crm`/`design-critic` (decisão visual não é deste plano).
- **Fontes.** Hoje o protótipo usa Google Fonts por `<link>` (runtime, dependência externa, risco de privacidade/LCP). Em Next: `next/font/google` (Fraunces + Manrope) no `app/academia/layout.jsx`, baixada e hospedada no build (como `app/admin/layout.jsx:26` faz com Manrope), com `display: "swap"` e subset `latin`. Variáveis só no wrapper da Academia. Risco: o build precisa de rede para as fontes (`NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt NODE_USE_ENV_PROXY=1`, `workflow-dev.md`). Fraunces é fonte nova: pedir OK do dono (item 8); fallback Georgia.
- **Reduced motion:** reaproveitar `components/motion/usePrefersReducedMotion.js` + botão "Reduzir movimento" (`aria-pressed`), persistido em `localStorage`; estados trocam na hora, Evolução abre no presente, Conquista em texto ("de 50% para 56%").
- **Acessibilidade:** `aria-label` na navegação (nada de texto visually-hidden duplicado, lição do §10 do direcao.md), foco visível 3 px, alvos ≥44 px, ordem de foco lógica, região viva dentro do app, contraste do §6.5, estado nunca só por cor. Layout com `safe-area-inset-top` (iPhone standalone, `app/layout.jsx:47` já usa `viewportFit: cover`).
- **Assets/performance.** SVG inline/CSS; imagens (se houver) em `public/assets/academia/`. Orçamento proposto: JS inicial da rota ≤150 KB gz, cena (chunk dinâmico) ≤60 KB gz, fontes ≤90 KB, 0 imagem raster na cena; meta de quadros do protótipo (≤3% >33 ms a 4x no celular). Início e Trilha renderizam texto antes da cena (cena carrega depois, com placeholder de gradiente igual ao céu, sem layout shift). Medir com `@vercel/speed-insights` já global. Impacto no bundle do CRM: nulo, desde que nenhum arquivo de `app/admin`/`components/` do CRM importe `components/academia/**`.
- **Alerta de herança do root:** `app/layout.jsx` monta Analytics/SpeedInsights e `ViewportZoomLock` (zoom travado, ok). `MetaPixel`/`CampaignLinkCapture` ficam fora pelo ramo do `AppChrome`.

## 5. Fases, flag e publicação

**Flag e exposição.** Variável de ambiente `ACADEMIA_ENABLED` (nome apenas; lida em `lib/academy-flags.js`), mais lista opcional `ACADEMIA_ALLOWED_EMAILS` para piloto. Desligada: `app/academia/layout.jsx` chama `notFound()`, o item de menu some e as APIs devolvem 404; ligada só para admin/lista até o dono liberar. `git push` em `main` = deploy em produção (`workflow-dev.md`): trabalhar em branch `feat/academia`, abrir PR, testar no **preview da Vercel** (URL por branch; preview usa as mesmas env de produção A CONFIRMAR, por isso preview nunca pode apontar para banco de produção com escrita de teste: usar flag + conta do dono com dado marcado, ou Supabase branch com autorização). Merge em `main` só com flag desligada em produção; ligar por env, sem novo deploy de código. Criar/alterar env da Vercel pede autorização (`vercel env`).

| Fase | Entrega | Pronto quando | Rollback |
|---|---|---|---|
| F0 | `academy-flags`, ramos em `AppChrome`/`proxy`/`sw.js`, rota `/academia` vazia atrás da flag, item de menu atrás da flag | Flag off = CRM idêntico (diff só em 3 arquivos + menu); `pnpm build` verde; testes do CRM passam | Reverter PR; nada no banco |
| F1 | Experiência completa (Início/Trilha/Aula/Questão/Conquista/Evolução/Certificação) com **dados de exemplo em memória**, zero banco, zero API | QA visual (vitrine/preview) nos 4 viewports do protótipo, reduced motion, N1-N3, orçamento atendido, dono aprova | Flag off |
| F2 | Migrations 1-2 + `lib` de matrícula/progresso + rotas `me`/`complete` + `academy_events`; trilha "Formação Inicial" com títulos neutros | Progresso real do próprio corretor persiste; view-as bloqueia escrita; testes de desbloqueio e permissão verdes | Flag off; tabelas ficam inertes |
| F3 | Editor de aulas/atividades, rascunho/publicar/versão | Publicar cria versão imutável; matrícula antiga mantém a versão; histórico visível | Despublicar = voltar versão anterior (nada apagado) |
| F4 | Banco de questões, provas, tentativas, nota mínima, histórico | Correção só no servidor; limite de tentativas; snapshot do servido; nota e aprovação deterministas | Desligar prova por trilha (settings) |
| F5 | Certificados internos com código, Conquista/Certificação com dados reais | Emissão idempotente (1 por matrícula), regra aprovada pelo dono; revogação auditada | Revogar, sem apagar |
| F6 | Visão de gestão (equipe, atrasos, filtros), atribuição por gestor | Gestor vê só `managedUserIds`; admin tudo; teste negativo (gestor tentando fora da equipe = 403) | Flag de gestão |
| F7 | Reciclagens com prazo, auto-matrícula do novo corretor, recomendação por auditoria de atendimento (**só preparar/ler, sem disparar**) | Regras criadas desligadas; nenhuma notificação/WhatsApp real sem decisão do dono | Regras `off` |

Notificação de prazo (push/`crm_notifications`) fica para F7 e reutiliza o ponto único existente (`automacoes-notificacoes.md`); nunca criar outro mecanismo.

## 6. Testes e validação

- **Unitários `node --test`** (novo `tests/academy-core.test.mjs`, sem dependências, sobre `lib/academy-core.mjs`): desbloqueio sequencial e por regra; nota mínima padrão e por prova (limites 69,9/70); tentativas (esgotada, nova só após regra); versão (matrícula presa à versão; nova versão não altera quem já começou; `stable_key` mantém progresso); idempotência de concluir aula; percentual 10/18 = 56%; elegibilidade de certificado; `getAcademyScope` por perfil (admin/gestor/corretor/associado) e bloqueio em `accountSwitchMode`; correção nunca expõe `correct`. Rodar também `tests/private-alerts.test.mjs`/`crm-alerts-core` como regressão do padrão.
- **Build:** `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt NODE_USE_ENV_PROXY=1 pnpm build` (5-10 min é normal; reverter `public/sw.js` se só o hash mudou; nesta entrega o `sw.js` tem mudança real).
- **QA visual:** `app/dev/vitrine` (arquivos `*.dev.jsx`, só `next dev`, `next.config.mjs`) com fixtures de estado da Academia (sem login nem banco, mesma técnica de `app/dev/vitrine/_fixtures`); PDF/captura via ferramentas do `designer-crm`. Medir quadros como no §6.1 do direcao.md.
- **Sem gravar em produção:** F1 sem banco; F2+ validar SQL em transação com rollback (`supabase/tests/`), lib testada com doubles; teste de API contra ambiente local com Supabase de teste, nunca contra produção (`tests/journey-auth.integration.mjs` é o exemplo do que NÃO rodar em produção). Preview da Vercel não é isolado do banco: tratar como produção para escrita.

## 7. Riscos e o que NÃO tocar

Do ledger (`docs/SYSTEM_ARCHITECTURE.md` §12/§13): **P-17** (atribuição em "Alterar conta": a Academia define a sua própria regra, não mexer nos pontos pendentes de `lib/whatsapp-chat.js`/`daily-goal.js`/`prospecting.js`); **P-10** (duas `isOwnerAdminEmail`: não usar e-mail do dono para decidir permissão na Academia, usar `role`); **P-07** (rota só com login não é padrão: toda rota da Academia tem guard e escopo); **P-03** (todas as páginas com `AdminSectionNav` carregam clientes: a Academia não deve usá-lo nem `calculateCrmMetrics`, para ficar leve); **P-18** (nome de migration de 8 dígitos); **P-14/dados sensíveis** não se aplicam, não armazenar CPF/telefone na Academia.
Outros pontos: `app/api/admin/*` hoje ~85 rotas (inventário em `docs/PERMISSIONS.md` §6 deve ganhar as novas); `public/sw.js` é regenerado no build; `AdminMenu`/`AdminBottomNav` compartilham `getAdminMenuGroups`; `proxy.js` afeta todas as rotas `/admin` e `/api`; `MobileAdminEntryRedirect` só roda em `/admin` (ok).
**Não tocar:** funções/telas do CRM por treinamento (sem bloqueio de CRM nesta fase); `simulation_registrations`, `client_status_history`, pontuação/ranking/Meta Diária (a Academia não grava nada ali); `admin_users` (sem coluna nova: matrícula é tabela própria); `lib/client-status.js`; `public/manifest`/ícones; comportamento atual de `/admin` no `proxy.js`; webhooks e crons. Nenhum envio real (push/WhatsApp/e-mail) em teste.

## 8. Decisões do dono (linguagem simples)

1. **Quem edita o conteúdo?** Recomendo só o administrador geral. Gestor editar traz risco de conteúdo divergente da regra da empresa; pode vir depois como "sugerir alteração".
2. **A Formação Inicial é obrigatória? Para quem?** Recomendo obrigatória para todo corretor novo e opcional para os atuais (você decide se quer exigir dos atuais). Por enquanto só orienta e mostra atraso; não trava nada do CRM.
3. **Nota mínima e tentativas.** Recomendo nota mínima 70% e 3 tentativas por prova, ajustável por prova; ao esgotar, o gestor libera nova tentativa.
4. **Certificado só com 100%?** Recomendo: certificado só com todas as aulas concluídas e a prova final aprovada. Se a trilha mudar depois, quem já tem certificado mantém o da versão que fez.
5. **Admin em "Alterar conta".** Recomendo que, vendo como o corretor, o admin só olhe: não conclui aula nem prova pelo corretor (senão o progresso e o certificado ficam falsos). O admin faz a própria formação com o próprio login.
6. **Prova final = último andar (a coroa)?** Recomendo sim: coroa só acende após a prova final aprovada.
7. **Fonte Fraunces.** Hospedamos no nosso site (sem depender do Google em tempo de uso). Preciso do seu OK para adotar uma fonte nova só na Academia; alternativa: usar a Manrope do painel em tudo (visual um pouco menos editorial).
8. **Metáfora do prédio com guindaste.** Aprovar ou trocar o guindaste (marca, tom). Impacto só visual, sem custo técnico relevante.
9. **Associados participam?** Recomendo sim, fazendo a própria trilha; o gestor da equipe enxerga o progresso deles. Se não, ficam fora das matrículas.
10. **Quem vê o certificado e existe verificação pública por código?** Recomendo certificado visível ao próprio, ao gestor da equipe e ao admin; verificação pública só se você quiser (exige uma página sem login, com dados mínimos).
11. **Retenção e versionamento.** Recomendo nunca apagar conteúdo publicado nem tentativas (só arquivar), para provar o que cada corretor estudou e quando. Prazo de guarda e se corretor desligado mantém histórico: definir.
12. **Conteúdo técnico.** A implementação inicial leva só estrutura e títulos neutros; o conteúdo real (financiamento, MCMV, documentação) entra depois, vindo de regras/Base Mestra aprovadas. Preciso saber quem aprova cada aula antes de publicar.
13. **Bloqueio de funções do CRM por treinamento** (ex.: não receber leads sem a Formação): fora desta fase; só com decisão sua depois de ver o uso real.
