# Autenticação e permissões

Login via Supabase Auth. Cookies do painel (`lib/admin-auth.js`): `mm_admin_access_token` (1h), `mm_admin_refresh_token` (7 dias), `mm_admin_view_as` (conta efetiva ao usar "Alterar conta"). HttpOnly, SameSite=Lax, Secure em produção. `proxy.js` faz a checagem inicial de sessão e aplica `no-store` no painel/APIs — mas a autorização de verdade é sempre feita pelos guards abaixo, nunca confie só na existência do cookie.

## Guards de API (`lib/admin-auth.js`) — use o mais restritivo que a operação exigir

| Função | Quem passa |
|---|---|
| `requireAdminApi` | Qualquer perfil ativo (admin/gestor/corretor/associado) |
| `requireBrokerManagementApi` | admin ou gestor (gestão de corretores/equipe) |
| `requireFinancialManagerApi` | admin ou gestor, para dados financeiros/edição de empreendimentos |
| `requireFinancialAccessApi` | Acesso financeiro (inclui visão adaptada de associado) |
| `requirePerformanceApi` | Acesso a telas de desempenho/ranking |
| `requirePrimaryAdminApi` | Só o admin principal (dono) |
| `requireRealGeneralAdminApi` | Admin geral **real** (não considera "Alterar conta" — usado em `/api/admin/view-as`) |
| `requireGeneralAdminApi` | Admin geral (efetivo, considera view-as) |

Equivalentes para páginas (Server Components): `requireAdminPage`, `requirePrimaryAdminPage`, `requirePerformancePage`, `requireGeneralAdminPage`, `requireFinancialAccessPage`, `requireBrokerManagementPage`.

**Toda rota em `app/api/admin/**` e toda página em `app/admin/**` precisa chamar um desses ANTES de tocar em dado** — não depois, nunca condicionalmente pulado. Já foi auditado uma vez (2026-09) e todas as ~30 rotas admin passaram; ao adicionar uma rota nova, mantenha esse padrão.

## Perfis (`admin_users.role`)

- **admin** — administração geral, visão global. O dono (`isOwnerAdminEmail`) tem tratamento especial hardcoded por e-mail em algumas libs — mudança de titularidade exige revisão explícita desses pontos.
- **manager** (gestor) — vê e opera sobre sua equipe: ele mesmo + subordinados diretos + associados vinculados aos corretores subordinados. Essa lista é montada por `attachDataAccessScope`/`listVisibleTeamProfiles` (`lib/admin-profiles.js`) e chega como `managedUserIds`.
- **broker** (corretor) — clientes/financeiro próprios (`responsible_user_id` == ele).
- **associate** (associado) — clientes/financeiro do corretor ao qual está vinculado (`linked_broker_id`), com visão financeira **projetada** (ver `.claude/rules/financeiro.md`), não a real.

## Escopo por responsável

- `applyResponsibleUserScope` (`lib/simulation-registrations.js` e outras libs de listagem) filtra queries por `responsible_user_id`/`managedUserIds`.
- `assertCanAccessResponsibleUser` (`lib/admin-access.js`) valida uma operação sobre UM cliente específico.
- `assertGeneralAdmin`, `assertGeneralAdminOrManager`, `assertOwnerAdmin` (`lib/admin-access.js`) — checagens de perfil sem escopo de cliente.

**A filtragem visual (o que aparece no menu/tela) nunca é a barreira de autorização.** Um corretor não ver o seletor de "transferir responsável" na UI não significa que a API que faz a transferência rejeita a chamada — sempre confirme que o guard do lado do servidor cobre exatamente a operação, não só a tela.

## "Alterar conta" (view-as)

`/api/admin/view-as` (POST/DELETE, exige `requireRealGeneralAdminApi`) grava `mm_admin_view_as`. O admin real continua autenticado; o contexto efetivo passa a usar o perfil selecionado (`auth.realUser`/`auth.realProfile` vs. o perfil efetivo, ver `accountSwitchMode`). **Não é obtenção de senha nem sessão Supabase independente do outro usuário** — é uma troca de contexto de autorização dentro da mesma sessão do admin real. Os nomes internos (`AdminViewAsSelector`, `applyViewAsProfile`) são legado de uma versão anterior chamada "Visualizar como" — não presuma que isso implica modo somente-leitura; hoje permite operar como o perfil selecionado.

## Ao adicionar uma permissão/regra nova

Pergunte explicitamente: essa regra vale para os 4 perfis ou só alguns? O guard de API cobre exatamente isso, ou só cobre um subconjunto mais permissivo (ex.: `requireAdminApi` quando deveria ser `requireBrokerManagementApi`)? A UI escondendo um botão não substitui a checagem — adicione a checagem no `lib/*.js`/route handler.
