---
name: auditar-crm
description: "Auditoria preventiva do CRM: acha risco, inconsistência, regressão, código morto ou regra violada antes de virar bug. Use para \"audite X\", pente-fino, \"antes de publicar\"."
---

# Auditoria preventiva do CRM

A metodologia completa (camadas A-I, severidade P0-P3, evidência obrigatória, passada de verificação, formato do relatório, "auditoria ≠ correção") já está em `.claude/agents/auditor-crm.md` — **use esse agente** para a auditoria em si. Esta skill cobre só o que é específico de **entender o pedido e escolher o protocolo certo** antes de acionar o agente.

## 1. Entenda o escopo e a profundidade sozinho

Não pergunte "qual protocolo devo aplicar" — decida pela frase do pedido:

| O usuário disse... | Profundidade | Escopo |
|---|---|---|
| "audite essa alteração/isso antes de publicar" | Foco | Só os arquivos tocados + quem os importa/chama |
| "audite Clientes" / "audite o WhatsApp" / nomeia um módulo | Módulo | A rule do módulo (tabela em `CLAUDE.md`) + camadas relevantes a ele |
| "faça uma auditoria geral" / "procure coisas que podem quebrar" / "verifique se existe código antigo" sem módulo | Geral | Projeto inteiro, dividido em sub-auditorias paralelas (ver agente) |
| "faça um pre-mortem dessa implementação" | — | Não é esta skill: é `/pre-mortem` (mesmo agente, modo diferente) |

## 2. Antes de reportar, confira o que já é conhecido

Leia `docs/SYSTEM_ARCHITECTURE.md` §13 (ledger de risco/arquitetura, P-01…P-21) e §12 (divergências doc×código) inteiros, e consulte `docs/INCIDENTES.md` (bugs já confirmados e corrigidos — skill `/consultar-incidentes`) antes de procurar algo novo. Não reporte de novo o que já está em qualquer um dos dois — diga só se procede, piorou ou foi resolvido.

## 3. Rode a auditoria

Siga `.claude/agents/auditor-crm.md` do passo da camada escolhida até o relatório. Se o escopo pedir banco de dados especificamente, use `/auditar-banco`; se pedir permissões especificamente, use `/revisar-permissoes` — não duplique essas duas, delegue.

## 4. Depois do relatório

Auditoria não corrige. Se o usuário autorizar corrigir um ou mais achados, acione `/diagnosticar-bug` (comportamento errado) ou o agente `crm-editor` (estrutural) só para os itens apontados — nunca para a lista inteira sem pedido explícito.
