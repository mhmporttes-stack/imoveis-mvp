---
name: auditar-crm
description: Auditoria geral do CRM imoveis-mvp — procura inconsistências, bugs, duplicidades, problemas de regra de negócio, banco de dados e permissões. Use quando o usuário pedir um "pente-fino", uma auditoria geral, ou disser "verifique erros e regras não aplicadas" sem apontar um módulo específico.
---

# Auditoria geral do CRM

Leia `CLAUDE.md` e os arquivos relevantes de `.claude/rules/` antes de começar — eles já documentam vários bugs reais encontrados e corrigidos em auditorias anteriores; não redescubra o que já está documentado, use como ponto de partida e verifique se ainda procede.

## Como conduzir

Esta é uma tarefa de pesquisa ampla — para um projeto deste tamanho (~88 arquivos em `lib/`, ~87 em `components/`, ~100+ migrations), prefira dividir em auditorias paralelas por área em vez de uma varredura sequencial única. Áreas sugeridas (ajuste conforme o que o usuário pedir ou o que já foi auditado recentemente):

1. **Performance** — N+1 queries (loop com `await` dentro fazendo uma consulta por item), `select("*")` em tabelas grandes/hot paths, ausência de paginação em listas que crescem, `await` sequencial que podia ser `Promise.all`.
2. **Regras de negócio e drift** — enums/rótulos duplicados que podem ter divergido entre arquivos (ver histórico em `.claude/rules/crm-clientes-funil.md`), regras descritas em comentário mas não realmente aplicadas no código logo abaixo, `person_label` usado como identidade em vez de `person_role`, status hardcoded como string solta em vez de `CLIENT_STATUS.X`.
3. **API/segurança** — toda rota em `app/api/admin/**` tem guard de `lib/admin-auth.js` ANTES de tocar em dado (ver `.claude/rules/auth-permissoes.md`); webhooks públicos validam assinatura/token; rotas de diagnóstico temporárias esquecidas (`tmp-`/`debug-`/`test-` no nome da pasta).
4. **Banco de dados** — ver skill `/auditar-banco` para uma auditoria dedicada; aqui, só uma verificação superficial de migrations órfãs/duplicadas se o tempo permitir.
5. **Permissões** — ver skill `/revisar-permissoes` para uma auditoria dedicada.

Cada achado deve ter: arquivo:linha, o que está errado, por que importa (cenário concreto de falha, não hipotético), severidade (HIGH = bug real de comportamento/segurança agora; MEDIUM = risco de drift ainda não visível; LOW = cosmético). **Não confunda "design intencional documentado" com bug** — vários comportamentos deste sistema parecem estranhos à primeira vista mas têm um comentário explicando a razão (ex.: funil cumulativo, geração preguiçosa da Meta Diária). Leia o comentário antes de reportar como bug.

## Depois de encontrar os achados

Não corrija tudo silenciosamente. Para cada achado HIGH: confirme com dado real quando possível (query direta, chamada de API autenticada via script em `scratch/`) antes de reportar como certeza. Priorize e pergunte ao usuário quais corrigir agora vs. quais só documentar — auditorias anteriores mostraram que mudanças de maior escopo (ex.: reescrever paginação de uma tela) merecem confirmação explícita antes de começar, mesmo que pareçam a correção "óbvia".

Ao corrigir algo encontrado na auditoria, siga a filosofia do agente `crm-editor` (`.claude/agents/crm-editor.md`): causa raiz, impacto, preservar o que funciona, testar antes/depois com dado real quando a mudança tocar produção.
