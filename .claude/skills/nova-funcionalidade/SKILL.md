---
name: nova-funcionalidade
description: Planeja e implementa uma funcionalidade nova no CRM imoveis-mvp, analisando arquitetura e impacto antes de escrever código. Use quando o usuário pedir algo que ainda não existe no sistema (uma tela nova, uma regra nova, um campo novo, uma automação nova).
---

# Implementar uma funcionalidade nova

A metodologia completa de impacto/implementação/verificação já está em `.claude/agents/crm-editor.md` — use esse agente para implementar. Esta skill cobre o que é específico de **começar do zero** (funcionalidade que ainda não existe): entender o pedido sem ambiguidade e, principalmente, não reinventar o que já existe.

## 1. Entender o pedido de verdade

Antes de qualquer código: o que exatamente deve acontecer, pra quem (todos os perfis ou só alguns?), e em que condições? Se houver ambiguidade real sobre o comportamento esperado (não sobre detalhes triviais de implementação), pergunte — decisões de regra de negócio erradas custam muito mais para desfazer depois do que uma pergunta agora.

## 2. Procurar se já existe algo parecido (o mais importante desta skill)

Este sistema já tem estrutura pronta para muita coisa — antes de desenhar algo novo, verifique se não é uma extensão de algo que já existe:

- Precisa de um enum/status novo? `CLIENT_STATUS` (`lib/client-status.js`) já pode cobrir, ou precisa de extensão controlada.
- Precisa notificar alguém? `crm_notifications`/push (`.claude/rules/automacoes-notificacoes.md`) já existe.
- Precisa reagir a um evento/condição de cliente automaticamente? O motor de automações (`lib/crm-automations.js`) já existe — pode ser um gatilho/ação novos em vez de um mecanismo paralelo.
- Precisa registrar algo na timeline do cliente? `logClientJourneyEvent(s)` já é o ponto único.
- Precisa de um rótulo/label que aparece em mais de uma tela? Verifique se já existe um arquivo de labels compartilhado (`lib/document-status-labels.js`, `lib/do-not-contact-reasons.js`) antes de criar um novo hardcoded.
- Precisa de escopo por perfil? Os guards de `lib/admin-auth.js` e `lib/admin-access.js` já cobrem os padrões usuais (ver `.claude/rules/auth-permissoes.md`).

**Não crie uma solução paralela pra um problema que já tem estrutura no sistema.**

## 3. Onde uma funcionalidade nova costuma precisar encaixar neste projeto

Pontos de integração específicos deste CRM que o checklist genérico de impacto do `crm-editor` não nomeia (verifique se cada um se aplica): rota nova em `app/admin/**` precisa de entrada de menu (`AdminSectionNav`/`AdminMenu`); tabela nova segue o padrão de RLS sem policy pública (`.claude/rules/database-supabase.md`); mudança que toca `simulation_registrations`/`client_status_history` pode afetar funil, ranking e financeiro ao mesmo tempo, mesmo parecendo isolada (ver módulos específicos em `.claude/rules/`).

## 4. Implementar, verificar e reportar

Siga o restante da filosofia do `crm-editor` (implementação mínima, reutilizar código, build limpo, teste com dado real, teste negativo de permissão, resumo do que mudou). Registre aqui qualquer decisão de design que você tomou sozinho por ambiguidade do pedido — documentada, não escondida.
