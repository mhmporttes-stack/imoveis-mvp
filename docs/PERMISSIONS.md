# PERMISSIONS — perfis, guards e escopo

> Fonte: `lib/admin-auth.js`, `lib/admin-access.js`, `lib/admin-profiles.js`, `proxy.js`, todas as rotas de `app/api/**` e páginas de `app/admin/**` (varredura automatizada por método HTTP em 2026-09-24, commit `3c82f72`).
> Visão funcional: [`CRM_CONTEXT.md`](CRM_CONTEXT.md) · Regras: [`BUSINESS_RULES.md`](BUSINESS_RULES.md) · Manual: [`../AGENTS.md`](../AGENTS.md). Complementa `.claude/rules/auth-permissoes.md` (que tem imprecisões, ver §8).

**Princípio:** a autorização real é **em código**. RLS está ligado sem policy pública; o app usa a service role no servidor. Esconder botão/menu **nunca** substitui o guard do servidor.

## 1. Autenticação

- Login com **Supabase Auth** (e-mail/senha; reset em `/admin/reset-password`). O navegador troca o token por cookies via `POST /api/admin/session`: `mm_admin_access_token` (1 h), `mm_admin_refresh_token` (7 dias), `mm_admin_view_as` (conta efetiva), todos `HttpOnly`, `SameSite=Lax`, `Secure` em produção.
- `proxy.js` (matcher `/admin/*` e `/api/*`): sem nenhum dos dois cookies → redireciona `/admin/**` (exceto `/admin/login` e `/admin/reset-password`) para o login; aplica `Cache-Control: no-store`. **Não autoriza** — só checa a existência do cookie.
- Cada guard revalida o token no Supabase (`auth.getUser`), tenta refresh se expirou, carrega o perfil em `admin_users` (por `auth_user_id` ou e-mail) e aplica o escopo.
- Sem linha em `admin_users`: só passa se o e-mail estiver na lista de e-mails autorizados (`ADMIN_EMAIL`, `ADMIN_EMAILS` + e-mails fixos no código) e recebe um **perfil de fallback** (`isFallback`, sem escopo de banco). `ADMIN_OWNER_EMAILS` amplia a lista de donos.
- Usuário `inactive` → 403 (o dono nunca é inativado).

## 2. Perfis e funções de classificação (`lib/admin-profiles.js`)

| Função | Verdadeiro para |
|---|---|
| `isGeneralAdminProfile/Auth` | `role='admin'` **ou** e-mail dono (fixos no código) |
| `isOwnerAdminEmail` | **administrador principal (dono)**. ⚠ Existem **duas** implementações: `lib/admin-profiles.js` (só os e-mails fixos no código — usada por `assertOwnerAdmin`, Meta Diária, Prospecção, listas de equipe e por várias páginas) e `lib/admin-auth.js` (fixos + `ADMIN_EMAIL` + `ADMIN_OWNER_EMAILS` — usada na promoção a admin em `buildAuthorizedAdminResult` e nas páginas `meta-diaria`/`prospeccao`). Trocar o dono exige revisar os dois (P-10) |
| `isManagerProfile` | `role='manager'` e não dono |
| `isBrokerProfile` | `role` **`broker` ou `associate`** e não dono (⚠ inclui associado) |
| `isAssociateProfile` | `role='associate'` e não dono |
| `canUseProfileDatabaseScope` | perfil real (com `id`, não fallback) |

**Dono ≠ qualquer admin.** Algumas ações são só do dono (`assertOwnerAdmin`/`isOwnerAdminEmail`): ver “não contactar”, excluir cliente, Meta Diária gerencial (visão de equipe), bases individuais de corretores, devolver contato à fila, importar prospecção em lote, modelos de WhatsApp (`admin/whatsapp-master/templates`), excluir cliente de simulação, dados internos de captação.

## 3. Guards de API (`lib/admin-auth.js`)

| Guard | Passa |
|---|---|
| `requireAdminApi` | qualquer perfil ativo (admin/gestor/corretor/associado); aplica “Alterar conta” |
| `requirePerformanceApi` | tudo exceto **associado** |
| `requireBrokerManagementApi` | **admin ou gestor** (via `requirePerformanceApi`) |
| `requireFinancialManagerApi` | admin ou gestor |
| `requireFinancialAccessApi` | tudo exceto **gestor** (admin, corretor, associado) |
| `requireGeneralAdminApi` (e `requirePrimaryAdminApi`) | **administrador geral** (`admin` ou dono, considerando “Alterar conta”). ⚠ `requirePrimaryAdminApi` é só um alias com outra mensagem — **não** restringe ao dono |
| `requireRealGeneralAdminApi` | administrador geral **real** (ignora “Alterar conta”) — usado em `/api/admin/view-as` |

Guards de página (`redirect`): `requireAdminPage`, `requirePerformancePage`, `requireBrokerManagementPage`, `requireGeneralAdminPage` (`requirePrimaryAdminPage` = alias), `requireFinancialAccessPage`.

Asserts de negócio (`lib/admin-access.js`, dentro dos `lib/*.js`): `assertGeneralAdmin`, `assertGeneralAdminOrManager`, `assertOwnerAdmin`, `assertCanAccessResponsibleUser`. **Muitas rotas passam só em `requireAdminApi` e a restrição real está no `lib`** (ver §5).

## 4. Escopo por responsável

- `applyResponsibleUserScope(query, auth, column, explicitResponsibleUserId)`: admin = tudo (ou filtra pelo id explícito, `"unassigned"` = sem responsável); corretor/associado = `responsible_user_id` ∈ `[próprio id, linkedBrokerId]`; gestor = `managedUserIds` (ele + subordinados diretos + associados vinculados aos corretores subordinados); perfil de fallback/sem id = nada (`EMPTY_UUID`).
- `assertCanAccessResponsibleUser(auth, id)`: mesmo critério para uma operação sobre **um** cliente/usuário.
- `resolveTeamVisibilityScope` / `listVisibleTeamProfiles`: decidem **quem aparece** em listas de equipe (admin todos; gestor sua equipe; demais só si). Nunca usar para decidir quais eventos pontuam.
- `applyDoNotContactScope`: esconde `do_not_contact` de quem não é dono.
- Chat: `chatScope` — admin/gestor veem todas as conversas; corretor/associado veem as de clientes que respondem **ou** atribuídas a eles; conversas excluídas (`deleted_at`) não aparecem em nenhuma listagem. **Mensagens internas e exclusão de conversa** usam `canManageConversation` (backend): administrador geral, gestor, atendente da conversa ou responsável atual pelo cliente — **só o próprio id** (o vínculo associado→corretor **não** vale); quem não pode nem recebe as mensagens internas na leitura. Áudio recebido: a rota de mídia repete a checagem de acesso da conversa; recuperar áudios (`media/recover`) é só admin/gestor.

## 5. Matriz por perfil (o que cada um pode, confirmado no código)

| Capacidade | Admin/dono | Gestor | Corretor | Associado |
|---|---|---|---|---|
| Clientes: ver/editar | todos | equipe | próprios | do corretor vinculado |
| Transferir responsável | sim | dentro da equipe; “sem responsável” sim | só para quem tem acesso (na prática si) | idem corretor |
| Excluir cliente | **só dono** | não | não | não |
| Ver “não contactar” | **só dono** | não | não | não |
| Documentação: enviar arquivos, ver checklist, reanalisar | sim | sim (equipe) | sim (próprios) | sim (do vinculado) |
| Documentação: gerar PDF, enviar à CCA, aviso ao corretor, apagar todos, corrigir item | sim | sim | **não** (`assertGeneralAdminOrManager`) | não |
| CCAs (cadastro) | sim | sim | não | não |
| Roleta: ver/reordenar | sim | sim | não | não |
| Meta Diária: tela `/admin/meta-diaria` | dono → **visão de equipe** (não vê a própria); outro admin → a própria | a própria | a própria | a própria |
| Meta Diária: configurar cota/mensagens | admin | não (só leitura de config) | não | não |
| Meta Diária: visão de equipe (`team-overview`) | **só dono** | não | não | não |
| Desempenho/Ranking/Online/Pontuação | sim (editar regras/ajustes) | sim (Pontuação só leitura) | não (Relatório Diário sim) | não |
| Financeiro (lista) | sim | **não** | próprios | visão projetada 10% |
| Financeiro: editar/excluir venda | **só administrador geral** | não | não | não |
| Gastos de IA | administrador geral | não | não | não |
| Automações (regras do CRM) | criar/editar: admin; ver: admin/gestor | ver | não | não |
| Fluxos / Respostas por palavra-chave / Disparo / WhatsApp Manual | sim | sim | não | não |
| Chat | tudo | tudo | escopo próprio | escopo do vinculado |
| Chat: mensagens internas / excluir conversa | tudo | tudo | só se for atendente da conversa ou responsável pelo cliente | só se **ele próprio** for atendente/responsável (o vínculo com o corretor não vale) |
| Oportunidades | equipe | equipe | próprios | (sem menu; URL funciona — A CONFIRMAR) |
| Gerador de Links / Campanhas | sim | sim | não | não |
| Usuários (criar/editar/excluir) | sim | só **corretores e associados** (anti-escalonamento: não cria nem promove admin/gestor) | não | não |
| Imóveis/depoimentos: criar | sim | sim | sim (**não publicado**) | sim (não publicado) |
| Imóveis/depoimentos: publicar/editar/excluir | sim | sim | não | não |
| Captações: ver/editar | sim | sim (**sem** dados internos) | não | não |
| Captações: dados internos | **só dono** | não | não | não |
| Meta Ads (status/backfill) | administrador geral | não | não | não |
| “Alterar conta” (view-as) | **só admin real** | não | não | não |

Listas de equipe/ranking excluem os e-mails dono (`listVisibleTeamProfiles`).

## 6. Inventário de rotas por guard (app/api)

**Só `requireGeneralAdminApi` (administrador geral):** `admin/meta-ads/backfill`, `admin/meta-ads/sync-status`, `admin/whatsapp-master/profile`, `admin/whatsapp-master/profile/photo`, `financeiro/[id]` (PATCH/DELETE), `scoring-rules` (escrita), `scoring-adjustments` (escrita). `admin/view-as` = `requireRealGeneralAdminApi`.

**`requireBrokerManagementApi` (admin/gestor):** `admin-users`, `admin-users/[id]`, `admin-users/[id]/photo`, `admin/presence`, `admin/presence/report`, `admin/whatsapp-flows` (todas), `admin/whatsapp-master/automation-replies*`, `admin/whatsapp-master/manual-*`, `campaigns`, `campaigns/[id]`, `captacoes` (GET), `captacoes/[id]`, `captacoes/[id]/publish`, `crm-automation-rules*`, `crm-settings/whatsapp-master*`, `daily-message/cards*`, `daily-message/dispatch*`, `daily-message/settings`, `lead-distribution`, `performance-overview*`, `scoring-rules` (GET/history), `whatsapp-master/events`.

**`requireFinancialManagerApi` (admin/gestor):** `empreendimentos/[id]`, `properties/[id]` (PUT/DELETE), `testimonials/[id]`, `testimonials/[id]/publish`, `uploads/documents`.

**`requirePerformanceApi` (não-associado):** `daily-report`, `financeiro/[id]` (GET — e bloqueia gestor dentro da rota). **`requireFinancialAccessApi` (não-gestor):** `financeiro` (GET).

**`requireAdminApi` (qualquer perfil) — restrição real no `lib` ou por escopo do cliente:**
`admin/cca*` (lib: admin/gestor), `admin/client-documents/*` (escopo do cliente; `cca-submission` e `reset` admin/gestor), `admin/heartbeat`, `admin/opportunities*`, `admin/session` (GET), `admin/whatsapp-broadcasts/*` (lib: admin/gestor), `admin/whatsapp-chat/*` (escopo do Chat; inclui `conversations/[id]/internal`, `DELETE conversations/[id]`, `media/[messageId]` — permissão decidida no `lib`; `media/recover`: admin/gestor), `admin/whatsapp-master/templates` (owner), `analyze`, `calendar-activities*` (escopo do cliente), `client-journey/[id]`/`settings` (escrita: admin/gestor), `client-tags*` (**sem checagem de perfil**, ver P-07), `crm-notifications*`, `daily-goal/*` (própria do corretor; ler configuração: admin/gestor; alterar cota/mensagens: admin; `performance`: admin/gestor; `team-overview*`: dono), `daily-message/pending|[historyId]/complete`, `properties` (POST — cria não publicado para corretor), `prospecting*` (lib por ação; `bulk` = dono), `push/*`, `simular-entrada`, `simulation-registrations/*` (escopo; DELETE dono), `simulations*` (escopo; excluir simulação: dono), `testimonials` (POST), `uploads/images`, `uploads/testimonials`.

**Crons (`GET`, bearer):** `cron/daily-goal-close`, `cron/daily-report`, `cron/meta-ads-daily-consolidation`, `cron/meta-ads-intraday-sync`, `cron/scheduled-activities`, `cron/whatsapp-broadcast-dispatch`, `cron/whatsapp-flows`. Comparam `Authorization: Bearer` com `CRON_SECRET` **ou** o hash SHA-256 do token do `pg_cron` com `SUPABASE_CRON_TOKEN_HASH` (`timingSafeEqual`); **falham fechado** sem segredo configurado.

**Webhook:** `webhooks/whatsapp-master` — GET valida `hub.verify_token` (`WHATSAPP_WEBHOOK_VERIFY_TOKEN`); POST exige `x-hub-signature-256` válido (HMAC com `WHATSAPP_APP_SECRET`), senão 401.

**Rotas públicas SEM guard (por design, cada uma com sua proteção):**

| Rota | Uso | Proteção existente |
|---|---|---|
| `POST /api/simulation-registrations` | formulário completo | validação Zod; dedup; sem rate limit |
| `POST /api/simulation-registrations/quick-attendance` | Atendimento Rápido | validação; dedup; sem rate limit |
| `PATCH /api/simulation-registrations/[id]/preferences` | preferências pós-cadastro | **token** `preferences_access_token` |
| `POST /api/captacoes` | captação de imóvel | validação Zod |
| `POST /api/uploads/captacoes` | fotos da captação (bucket público de imóveis) | só JPG/PNG/WEBP; rate limit **em memória** (10 / 5 min por IP) |
| `POST /api/leads` | modal da home | rate limit **em memória** (1/min por IP+telefone); grava só em `leads` |
| `POST /api/campaigns/track-view` | contar abertura de link | best-effort |
| `GET /api/properties`, `/api/properties/[id]` | catálogo público | só publicados (`lib/public-properties.js`) |
| `GET /api/whatsapp-contact` | número oficial p/ botão “Receber minha simulação” | só o número de exibição (não é segredo) |
| `POST /api/admin/session`, `DELETE` | criar/limpar cookies | valida o access token no Supabase |
| `/minha-jornada/[token]` (página) | jornada pública | token de 64 hex; allowlist de campos; `no-store` |

## 7. Páginas do painel (guard)

`requireBrokerManagementPage` (admin/gestor): `automacoes`, `automacoes/fluxos/[id]`, `cadastros*`, `captacoes*`, `corretores`, `desempenho*` (inclui `online`, `pontuacao`, `corretor/[id]`), `gerador-de-links*`, `meta-diaria/gestao`, `minha-jornada`. `requireGeneralAdminPage`: `gastos-ia`. `requireFinancialAccessPage`: `financeiro`. `requirePerformancePage`: `relatorio-diario`. `requireAdminPage` (qualquer): `/admin` (redireciona corretor/associado), `calendario`, `chat`, `depoimentos*`, `empreendimentos*`, `meta-diaria`, `notificacoes`, `novo`, `oportunidades`, `prospeccao`, `simulacoes*`. Sem guard (públicas por natureza): `login`, `reset-password`; `whatsapp-master` apenas redireciona.

## 8. Diferenças em relação a `.claude/rules/auth-permissoes.md`

1. Aquele arquivo diz que `requirePrimaryAdminApi` é “só o admin principal (dono)”. No código é alias de `requireGeneralAdminApi` (qualquer administrador geral).
2. Diz que “todas as ~30 rotas admin” foram auditadas; hoje há **152 arquivos de rota** em `app/api`: 7 crons, 1 webhook, 1 rota **temporária** de testes (`admin/tmp-chat-tests`, protegida por hash de segredo em vez dos guards de perfil — ver `WHATSAPP.md` §14) e o restante autenticado, com **11 rotas que expõem ao menos um método público** (tabela acima). Várias rotas `requireAdminApi` dependem do `lib` para a restrição real — ao criar rota nova, **coloque o assert no `lib`** ou use o guard mais restritivo.
3. Não menciona que `lib/admin-profiles.js` e `lib/admin-auth.js` têm `isOwnerAdminEmail` diferentes (ver §2), nem o anti-escalonamento de privilégio na criação de usuários por gestor.

## 9. Regras para mudar permissões

- Pergunte: vale para os 4 perfis? O guard cobre exatamente a operação ou só um subconjunto mais permissivo?
- Coloque a checagem no `lib/*.js` (reutilizado por página e API) e o guard mais restrito na rota.
- Não afrouxe `requireBrokerManagementApi`/`requireGeneralAdminApi` sem pedido explícito; não trate `associate` como `broker` sem revisar financeiro e desempenho (`isBrokerProfile` os junta).
- Toda rota nova em `app/api/admin/**` ou `app/admin/**`: guard **antes** de tocar em dado.
- Pontos frágeis conhecidos: [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) §Problemas (P-07, P-09, P-10).
