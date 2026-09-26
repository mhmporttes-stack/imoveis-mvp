# CRM_CONTEXT — visão funcional do CRM

> Objetivo: um agente novo entender em minutos **como o CRM funciona**. Detalhe de regra: [`BUSINESS_RULES.md`](BUSINESS_RULES.md). Detalhe técnico: [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md). Permissões: [`PERMISSIONS.md`](PERMISSIONS.md). Manual dos agentes: [`../AGENTS.md`](../AGENTS.md).
> Verificado contra o código em 2026-09-24 (commit `3c82f72`). O que só existe no banco de produção está marcado **A CONFIRMAR**.

## 1. O que é

Um único app Next.js com duas faces:

1. **Site público** (`/`, `/empreendimentos/[id]`, `/simulacao`, `/simulacao/equipe`, `/captacao` = `/venda-seu-imovel`, `/minha-jornada/[token]`, `/politica-de-privacidade`): vitrine de imóveis/empreendimentos em Marília, formulários que **geram clientes** para o CRM e captação de imóveis para venda.
2. **Painel interno** (`/admin/**`, PWA instalável): CRM multiusuário para o dono, gestores, corretores e associados.

Tudo passa por Supabase (Postgres + Auth + Storage + Realtime + `pg_cron`) e é publicado na Vercel. Integrações: WhatsApp Cloud API, Meta (Pixel/Conversions API/Marketing API), Anthropic, OpenAI (opcional), Resend, Web Push.

## 2. Perfis (`admin_users.role`)

| Perfil | Quem é | Escopo de clientes | Observações |
|---|---|---|---|
| `admin` | dono / administrador geral | todos | e-mails “dono” são fixos no código (`OWNER_ADMIN_EMAILS`); só o dono vê “não contactar”, exclui cliente, abre a Meta Diária gerencial |
| `manager` (gestor) | gestor de equipe | ele + subordinados diretos (`manager_id`) + associados vinculados a esses corretores | **sem** acesso ao Financeiro da imobiliária |
| `broker` (corretor) | corretor | só `responsible_user_id` = ele | |
| `associate` (associado) | vinculado a um corretor (`linked_broker_id`) | clientes do corretor vinculado | financeiro em **visão projetada** (10%); sem Desempenho |

Regras de acesso completas (guards por rota/página): [`PERMISSIONS.md`](PERMISSIONS.md). O admin pode “Alterar conta” (view-as) para operar como outro perfil.

## 3. Menus do painel (`components/AdminMenu.jsx`)

- **Administrador geral**: SUPERVISÃO (Meta Diária, Desempenho, Online) · CLIENTES (Clientes, Chat, Prospecção, Agenda) · CADASTROS (Imóveis, Empreendimentos, Cadastro de empreendimentos, Captações, Depoimentos, Corretores, Gerador de Links) · FINANCEIRO (Financeiro, Gastos de IA) · CONFIGURAÇÕES (Meta Diária gestão, Pontuação, Automações, Minha Jornada).
- **Gestor**: CRM (Meta Diária, Clientes, Chat, Oportunidades, Empreendimentos, Agenda, Prospecção) · CADASTROS (Imóveis, Captações, Depoimentos) · GESTÃO (Corretores, Empreendimentos, Gerador de Links, Minha Jornada, Automações, Meta Diária gestão, Desempenho). O que ele não pode ver é barrado nas páginas/consultas, não escondido do menu.
- **Corretor**: CRM (Meta Diária, Clientes, Chat, Oportunidades, Empreendimentos, Agenda, Prospecção) · CADASTROS (Cadastrar imóvel, Cadastrar depoimento) · DESEMPENHO (Relatório Diário, Financeiro).
- **Associado**: como corretor, sem Oportunidades e só com Financeiro no grupo de desempenho.
- Telas fora do menu: `/admin/notificacoes`, `/admin/cadastros` (lista legada), `/admin/simulacoes/[id]` (a entidade “simulação”), `/admin/automacoes/fluxos/[id]` (editor de Fluxos). `/admin/whatsapp-master` só redireciona para `/admin/automacoes?tab=whatsapp-master`.
- Automações tem abas: `rules` (regras), `roulette` (roleta), `daily-message`, `whatsapp-master`, `flows`, `whatsapp-manual`.

## 4. Como um cliente nasce (entradas)

Cliente = linha em `simulation_registrations` (código de cliente, telefone normalizado, `responsible_user_id`, `status`, `acquisition_context`…). Entradas:

| Entrada | Como | Responsável definido por |
|---|---|---|
| Link pessoal do corretor `/simulacao?ref=<ref>` | formulário completo ou Atendimento Rápido | o corretor do `ref` (marca `direct_broker_link`, sem `distribution_type='round_robin'`) |
| Link da equipe `/simulacao/equipe` (`ref=equipe`) | idem | **roleta** (`pick_round_robin_broker`), grava `distribution_type='round_robin'` + histórico |
| Link de campanha `?c=<id>` (Gerador de Links / Disparo) | idem | regra da campanha: corretor específico ou roleta; campanha inativa cai no fluxo comum |
| Sem `ref`/`c` | idem | corretor padrão do site (ref `matheus`) |
| Cadastro manual no CRM | “Novo cliente”, Clientes, Agenda etc. (`/api/simulation-registrations/manual`) | quem cadastra (corretor) ou o escolhido por gestor/admin |
| Prospecção / Meta Diária | contato da fila vira cliente ao ser assumido (Prospecção) ou no 1º toque real (Meta Diária) | o corretor que assumiu/trabalhou o contato |
| WhatsApp (lead patrocinado — Click to WhatsApp —, resposta automática por palavra-chave “forward_to_roleta”, Fluxos com ação “roleta”, Chat “Adicionar ao CRM”) | telefone desconhecido vira cliente | **roleta** (lead patrocinado, automações; a conversa fica com o mesmo corretor) ou quem adicionou (Chat) |

Se já existe cliente com o mesmo telefone (qualquer formato de 9º dígito/DDI) ou mesmo nome, o formulário **atualiza o atendimento existente** (não duplica, não gasta vez da roleta); exceção: link pessoal de **outro** corretor abre atendimento novo. Detalhes: [`BUSINESS_RULES.md`](BUSINESS_RULES.md) §Clientes.

Outras entradas públicas que **não** criam cliente: modal da home (`/api/leads` → tabela `leads`), formulário de captação de imóvel (`captacoes`), depoimentos (moderados).

## 5. Ciclo de vida do cliente e funil

Status (fonte única `lib/client-status.js`, 25 valores): `automated_service` (Atendimento automático — cliente do WhatsApp que ainda não preencheu o formulário) → `pending` (Aguardando simulação) → `completed` → `simulation_sent` → `in_service` → `awaiting_return` (Tentando contato) → `documentation_pending` / `documents_pending` → `approval_pending` → `restriction` / `shielding` / `rejected` / `approved` → `meeting_pending` / `meeting_done` → 8 status de venda (`sale_completed` … `sale_payment`) e fora do funil `archived` / `do_not_contact`.

**Funil comercial (7 macroetapas)**: Atendimento → Simulação → Aguardando documentação → Aguardando aprovação (inclui restrição/blindagem/reprovado) → Cliente aprovado → Reunião → Venda; base = “Prospecção/novos clientes do período”. É **cumulativo** por design. Abas da tela Clientes: Todos, Prospecção, Atendimento, Simulação, Documentação, Aprovação, Aprovados, Reunião, Venda, Arquivados.

Marcos automáticos: entrar em qualquer status de venda cria a **venda financeira** (`financial_sales`, sem duplicar) e, se não houve Reunião, um marco “Reunião realizada” assinado por `sistema` (0 pontos); enviar à CCA muda para `approval_pending`.

## 6. Responsáveis e transferência

- Todo cliente deve ter responsável; “órfãos” (`responsible_user_id` nulo) são devolvidos ao **administrador principal** por rede de segurança, executada dentro de `/api/cron/scheduled-activities` (pensada para rodar a cada minuto — agendamento em `pg_cron`, ver `DATABASE.md`).
- Transferência manual: admin/gestor pela tela Clientes (ou atribuindo a conversa no Chat) → grava `previous_responsible_user_id`/`responsible_changed_at` e evento na jornada.
- Transferência automática: regra “devolver para distribuição automática” (roleta sem contato) — só para `distribution_type='round_robin'` sem `last_whatsapp_contact_at` e sem atendimento humano recente no Chat; trava anti-giro (1 volta por 24 h).
- A **conversa do WhatsApp acompanha** o responsável do cliente (trigger no banco).

## 7. Módulos e o que cada um faz

| Módulo | Onde | Resumo |
|---|---|---|
| Clientes | `/admin/simulacoes` | lista server-side paginada (5/10/20), filtros, tags, status, responsável, jornada, documentação, WhatsApp |
| Agenda | `/admin/calendario` | atividades (`calendar_activities` + campo legado no cliente), lembretes por push/WhatsApp/e-mail (cron) |
| Roleta | Automações > `roulette` | fila de distribuição, presença online, histórico |
| Prospecção / Base | `/admin/prospeccao` | fila `prospecting_contacts` (Base da Imobiliária e bases individuais), importação, atribuição |
| Meta Diária | `/admin/meta-diaria` (+ `/gestao`) | cota diária de 1ª/2ª/3ª tentativa por corretor (o dia começa com exatamente a cota de contatos aguardando 1º contato; **uma tentativa por contato por dia**), carteira ativa, fechamento diário |
| Desempenho / Ranking / Pontuação | `/admin/desempenho/*`, `/admin/relatorio-diario` | funil, pontos por evento (regras versionadas; **cada marco vale uma vez por cliente**), Online (presença), relatório diário por e-mail |
| Oportunidades | `/admin/oportunidades` | score/urgência/prioridade determinísticos por cliente (Fase 1) |
| Documentação / CCA | modal no cliente | upload em lote, IA classifica, motor determinístico decide o que falta, PDF, envio à CCA (link `wa.me`) |
| Financeiro | `/admin/financeiro` | venda → comissão → despesas/recebimentos; visão projetada p/ associado |
| Chat WhatsApp | `/admin/chat` | caixa de entrada do número oficial, janela 24h, modelos, mídia, atalhos, **mensagens internas** (só equipe; o cliente não vê), **excluir conversa** (lógica), **áudio recebido** tocável; leads de anúncio entram pela roleta |
| Fluxos / Respostas / Disparo / Manual | Automações | robô visual estilo ManyChat; palavra-chave; envio em massa por modelo; mensagens manuais para a equipe |
| Automações do CRM | Automações > `rules` | `crm_automation_rules` (13 gatilhos × 7 ações), avaliadas em `/api/cron/scheduled-activities` (a cada minuto **se** o `pg_cron` estiver ativo — A CONFIRMAR em produção); as regras vigentes vivem no banco |
| Minha Jornada | `/minha-jornada/[token]` | página pública de progresso do cliente + timeline interna (`client_journey_events`) |
| Gerador de Links | `/admin/gerador-de-links` | campanhas `?c=`, link oficial por corretor, contagem de aberturas/cadastros |
| Meta Ads | (sem tela ainda) | sincronização **somente leitura** de campanhas/insights + Pixel/Conversions API |
| Imóveis / Empreendimentos / Captações / Depoimentos | `/admin`, `/admin/empreendimentos`, `/admin/captacoes`, `/admin/depoimentos` | catálogo público, regras de entrada (motor de simulação), moderação (publicar só admin/gestor) |
| Mensagem diária | Automações > `daily-message` | card motivacional/devocional exibido 1×/dia (não é a Meta Diária) |
| Gastos de IA | `/admin/gastos-ia` | custo das chamadas Anthropic (`ai_usage_log`) |
| Usuários | `/admin/corretores` | criar/editar/desativar usuários, foto, comissão padrão, participação na roleta |

## 8. Relações entre módulos (quem alimenta quem)

```
Site público / links ─┐
Cadastro manual ──────┼─▶ simulation_registrations ──▶ Funil/Status ──▶ Ranking/Desempenho ◀── Meta Diária
WhatsApp (auto) ──────┘        │  │  │                     │                   ▲
                               │  │  └─ Financeiro (venda) └─ Oportunidades    │
                               │  └──── Documentação/CCA ─▶ status              │
                               └──── Roleta ◀── presença (Online)         Prospecção ◀─ Base/Importação
Automações (cron 1 min) ─▶ push / e-mail / WhatsApp modelo / notificações / transferências
WhatsApp webhook ─▶ Chat ─▶ Fluxos / Respostas ─▶ (cliente + roleta + tag + notificação)
Campanhas ─▶ client_origins ─▶ Minha Jornada / Gerador de Links / (futuro) Meta Ads
```

## 9. Vocabulário

**Roleta** = distribuição automática de leads (fila + presença). **Carteira ativa** = rodadas ativas da Meta Diária de um corretor (limite global padrão semeado: 100). **Base da Imobiliária** = `prospecting_contacts` sem `owner_user_id`. **CCA** = correspondente/central de crédito parceira. **Janela de 24 h** = prazo em que a Meta permite mensagem livre após a última mensagem do cliente. **Disparo** = envio em massa por modelo aprovado. **Fluxo** = robô visual do WhatsApp. **Associado** = usuário vinculado a um corretor. **Dono** = administrador principal (e-mails fixos no código).
