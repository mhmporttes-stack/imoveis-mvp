# HISTÓRICO DE REGRAS — trechos retirados de `.claude/rules/` (somente histórico)

> **Documento histórico.** Em 2026-10-01 as rules de `.claude/rules/` foram enxugadas para conter só instruções atuais. Os trechos abaixo foram movidos para cá **sem alteração de texto** (narrativa de incidentes, fatos superados, listas duplicadas). Não use como fonte do comportamento atual — a versão vigente está na rule indicada em cada bloco, em `docs/` e no código. Nenhuma etiqueta de REGRA OFICIAL DE NEGÓCIO foi movida para cá.


## Retirado de `.claude/rules/roleta-prospeccao-campanhas.md`

## Regra de retorno automático (round-robin sem contato)

Cliente de origem roleta sem contato registrado por WhatsApp dentro do prazo configurado deve voltar pra fila (transferência contínua). Implementado em `lib/prospecting-auto-return.js` — roda a cada carregamento da lista principal de clientes (não é um cron isolado hoje). Batching: usa `.in("id", ids)` agrupado por corretor em vez de um update por contato (já foi um N+1 real, corrigido).


## Retirado de `.claude/rules/roleta-prospeccao-campanhas.md`

**[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO — corrigido em 2026-09-27] Nome de exibição do WhatsApp com 1 caractere (emoji sozinho, etc.) travava o cadastro automático para sempre.** O banco exige `length(btrim(full_name)) > 1` (`simulation_registrations_full_name_check`). `routeOrganicLead`/`routeSponsoredLead` (`lib/whatsapp-sponsored-lead.js`) e `materializeClientFromAutomationReply` (`lib/whatsapp-automation-replies.js`) usavam o nome de perfil do WhatsApp direto como `full_name` — um contato cujo nome de exibição é só "🙏" (ou qualquer 0-1 caractere) fazia o INSERT falhar com essa checagem, a cada webhook E a cada execução do cron de reconciliação (a cada minuto, para sempre, sem nunca se autocorrigir) — a conversa ficava eternamente "Não cadastrado"/"Sem corretor" mesmo com corretor disponível na roleta. `sanitizeContactFullName` (`lib/whatsapp-referral.mjs`, puro) agora troca qualquer nome de 0-1 caractere por "Cliente WhatsApp" ANTES do INSERT, nos três pontos que cadastram cliente a partir do nome do WhatsApp. Caso real corrigido manualmente em 2026-09-27 (contato "🙏", +5514998224022) antes da correção existir.


## Retirado de `.claude/rules/roleta-prospeccao-campanhas.md`

**[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO — corrigido em 2026-09-28] `claim_daily_goal_contacts`/`claim_single_prospecting_contact` (RPC que alimenta a Meta Diária e a Prospecção manual) nunca filtravam contato sem nome usável nem contato ligado a um cliente `do_not_contact`/`sale_completed`.** A regra "nunca reivindicar contato sem nome" (`is_usable_contact_name`) só existia em `pick_broadcast_base_contacts` (Disparo, migration 20260927090000) — corretor continuava recebendo "Sem Nome" na Meta Diária. Mais grave: cliente marcado "Não contactar novamente" reapareceu na Meta Diária da Jennyfer no mesmo dia — causa raiz, a mesma pessoa tinha 5 linhas em `prospecting_contacts` (5 telefones diferentes, mesmo `registration_id`, herança da importação); marcar "não contactar" numa linha nunca propagava pras outras, que continuavam `available`/`recent_attempt` e eram reivindicadas de novo, mandando mensagem pra quem pediu pra parar — risco direto de banimento do número no WhatsApp. Corrigido em `supabase/migrations/20260928200000_daily_goal_claim_guards.sql`: as duas RPCs agora exigem nome usável E ausência de vínculo (por `registration_id` OU `phone_normalized`) com cliente `do_not_contact`/`sale_completed`; faxina retroativa marcou como `do_not_contact` toda linha presa nessa situação e encerrou as rodadas ativas afetadas (o corretor completa a cota sozinho no próximo carregamento).


## Retirado de `.claude/rules/meta-diaria-ranking.md`

- **[COMPORTAMENTO ANTIGO, hoje proibido]** Armadilha real já corrigida: nunca assuma que uma rodada recebe no máximo 1 tentativa por dia. Um corretor atrasado pode legitimamente fazer a 2ª E a 3ª tentativa da mesma rodada no mesmo dia (catching up). Ao decidir "essa rodada está descansando em qual etapa", use sempre o `attempt_count` ATUAL da rodada (o estágio mais avançado), nunca o `attempt_number` de uma linha específica de `daily_goal_attempts` — se você indexar por `round_id` num `Map` a partir de `daily_goal_attempts`, uma rodada com duas tentativas no mesmo dia vai sobrescrever a entrada e você perde uma delas.


## Retirado de `.claude/rules/meta-diaria-ranking.md`

O denominador (`target`) desse cálculo é a **carteira ativa de hoje** (`wallet.current` — rodadas com `status='active'` agora), não `wallet.requiredToday`/`getDailyGoalTarget` (que soma rodadas carregadas de dias anteriores e serve a um propósito diferente: liberar prospecção extra, `getDailyGoalCompletionStatus`). Confundir os dois já foi um bug real corrigido duas vezes na mesma tarde (2026-09-22): primeiro a fórmula proporcional sem teto (394%), depois o denominador errado usando `requiredToday` (123% em vez de 191%) — ambos em `buildDailyGoalSnapshot` e `buildOwnerTeamOverview` (`lib/daily-goal.js`). Se o percentual exibido algum dia não bater com "meta = carteira ativa de hoje, +1%/contato extra", comece verificando esses dois pontos antes de qualquer outra hipótese. **[Atualização 2026-09-25 — unificado]** `getDailyGoalTarget`, a liberação da prospecção extra (`getDailyGoalCompletionStatus`) e o fechamento do dia **deixaram de ser uma conta diferente**: usam o MESMO total do painel (`loadWalletDayNumbers` em `lib/daily-goal-wallet.js` = carteira ativa + trabalhados hoje que já saíram dela, **encerrados OU convertidos em atendimento**). Bug real corrigido: rodada convertida hoje ficava fora do total mas contava como feita (Jennyfer: 51 de 45 = 106% no painel, enquanto o bloqueio pedia “51 de 60”; o correto era 51 de 51 = 100%). Rodada que saiu da carteira sem tentativa do corretor no dia não é obrigação dele.


## Retirado de `.claude/rules/database-supabase.md`

## Inventário de tabelas por domínio (não exaustivo — confirme com Grep antes de assumir)

| Domínio | Tabelas |
|---|---|
| Usuários/perfis | `admin_users` |
| Catálogo público | `properties`, `empreendimentos`, `testimonials`, `captacoes`, `leads` |
| CRM/simulações | `simulation_registrations`, `simulations`, `simulation_properties`, `simulation_property_benefits` |
| Status/histórico/tags | `client_status_history`, `tags`, `client_tags` |
| Jornada pública do cliente | `client_journeys`, `client_journey_events`, `client_origins` |
| Agenda | `calendar_activities` |
| Automação/notificação | `crm_automation_rules`, `crm_automation_executions`, `crm_notifications`, `crm_settings` |
| Roleta/distribuição | `lead_distribution_state`, `lead_distribution_history` |
| Campanhas | `campaigns`, `campaign_link_views` |
| Prospecção | `prospecting_contacts`, `prospecting_history` |
| Meta Diária / carteira | `daily_goals`, `daily_goal_rounds`, `daily_goal_attempts`, `daily_goal_quota_versions`, `daily_goal_wallet_config`, `daily_goal_broker_messages`, `daily_goal_do_not_contact_log`, `daily_goal_abuse_flags` |
| Documentação do cliente / CCA | `client_documents`, `client_document_batches`, `client_document_checklist_items`, `client_document_submissions`, `cca` |
| Gastos de IA | `ai_usage_log` |
| Financeiro | `financial_sales`, `financial_expenses`, `financial_payments` |
| WhatsApp | `whatsapp_master_events`, `whatsapp_broadcasts`, `whatsapp_broadcast_messages`, `whatsapp_templates` |
| Push/mensagem diária | `push_subscriptions` (mensagem diária usa `crm_settings` + tabela própria — confirme antes de assumir o nome exato) |

Antes de confiar nesta lista para uma mudança de schema, rode `grep -roh '\.from("[a-z_]*")' lib/ | sort -u` para confirmar contra o código atual — este arquivo pode ficar desatualizado se tabelas forem adicionadas depois.


## Retirado de `.claude/rules/integracoes-externas.md`

**Contexto operacional (2026-09-21)**: o número real de produção ficou preso numa WABA antiga com forma de pagamento bloqueada por uma linha de crédito compartilhada do ManyChat, sem via self-service de liberação. Foi criada uma WABA nova com pagamento funcionando; a migração do número (ou troca por um número novo) ainda pode estar em andamento — confirme o estado atual de `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_BUSINESS_ACCOUNT_ID` no ambiente antes de assumir que o Disparo está operacional.
