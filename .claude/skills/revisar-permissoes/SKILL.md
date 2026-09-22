---
name: revisar-permissoes
description: Verifica o comportamento de permissões entre Admin, Gestor, Corretor e Associado no CRM imoveis-mvp — se os guards de API/página realmente restringem o que deveriam, e se o escopo por responsável/equipe está correto. Use para uma auditoria dedicada de permissões, ou antes de mexer em qualquer rota/tela que deveria se comportar diferente por perfil.
---

# Revisão de permissões

Leia `.claude/rules/auth-permissoes.md` primeiro — lista os guards existentes (`lib/admin-auth.js`) e as funções de escopo (`lib/admin-access.js`).

## O que verificar

1. **Toda rota admin tem guard.** Liste `app/api/admin/**/route.js` (e, se o escopo pedir, também as rotas fora de `admin/` que deveriam ser protegidas, como `/api/financeiro`, `/api/crm-automation-rules`, `/api/daily-goal*`, `/api/performance-overview`) e confirme que cada método (GET/POST/PATCH/DELETE) chama um guard de `lib/admin-auth.js` **antes** de qualquer leitura/escrita de dado, nunca depois nem condicionalmente pulado.
2. **O guard é forte o suficiente pra operação.** Uma rota de escrita/exclusão usando um guard mais fraco que uma rota irmã de leitura é suspeito — confirme se é intencional (ex.: corretor pode criar rascunho, só gestor edita/publica — padrão real já existe em `properties`/`testimonials`) ou descuido.
3. **Escopo por responsável é aplicado no servidor, não só escondido na UI.** Para cada tela que lista clientes/dados de um perfil não-admin, confirme que a API por trás usa `applyResponsibleUserScope`/`assertCanAccessResponsibleUser` (ou equivalente) — um botão escondido no frontend para corretor NÃO é proteção se a API aceita a chamada de qualquer usuário autenticado.
4. **Escopo de gestor está correto.** Gestor deve ver: ele mesmo + subordinados diretos + associados vinculados aos corretores subordinados (`managedUserIds`, `lib/admin-profiles.js`). Teste (com dado real ou lendo o código com atenção) se um gestor consegue ver/mexer em alguém fora dessa árvore.
5. **Associado só vê o que devia.** Clientes do corretor vinculado (`linked_broker_id`), financeiro projetado (10% fixo, nunca a visão real com despesas/participação de gestor/imobiliária — ver `.claude/rules/financeiro.md`).
6. **"Alterar conta" (view-as) não vaza privilégio.** POST/DELETE de `/api/admin/view-as` exige `requireRealGeneralAdminApi` (admin real, ignora view-as em andamento) — confirme que nenhuma outra rota sensível aceita o contexto "efetivo" quando deveria exigir o admin real de verdade (ex.: nunca deveria ser possível, estando "vendo como" um corretor, trocar de conta de novo pra outro perfil sem voltar a ser o admin real primeiro).
7. **E-mails/perfis com tratamento especial hardcoded.** Verifique se o e-mail do dono (`isOwnerAdminEmail`) ou outros fallbacks fixos no código ainda fazem sentido — mudança de titularidade ou de e-mail do dono exige atualizar esses pontos, eles não seguem sozinhos.

## Como testar de verdade

Prefira confirmar com uma chamada real: autenticar via magic link (script em `scratch/`, apagado ao final) como um perfil específico (ou usando "Alterar conta" quando aplicável) e chamar a API em questão, confirmando que ela aceita/rejeita como esperado — ler o código dá uma boa hipótese, mas testar com uma chamada real é a única forma de confirmar que o guard está realmente no caminho de execução (não só declarado, mas de fato chamado antes do dado).

## Reportar

Para cada achado: rota/tela, perfil que consegue fazer algo que não deveria (ou o oposto: perfil bloqueado de algo que deveria poder), severidade. Não corrija uma falha de permissão sem confirmar com o usuário se é intencional — algumas assimetrias aparentes (corretor cria, só gestor edita) são regra de negócio real, não bug.
