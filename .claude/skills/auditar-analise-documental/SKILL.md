---
name: auditar-analise-documental
description: Audita um resultado da análise documental do CRM — compara documentos originais + regras ativas da Base Mestra + resultado gravado pela IA/motor e aponta falso aprovado, falsa pendência, regra ignorada, regra inventada, classificação errada, extração errada, divergência exagerada, ilegível tratado como válido, interferência de duplicado e cálculo de renda errado. Use para "a IA errou nesse cliente?", "confira esse lote", "audite a análise documental" (um cliente ou uma amostra). Somente leitura. Execute com o agente `analista-documental`.
---

# Auditar análise documental

Somente leitura: nunca corrige status, não reanalisa lote (custa IA e muda dado) e não envia devolutiva. Correção é tarefa separada, com pedido explícito.

## Escopo

- **Um cliente/lote:** o dono indica o cliente (ou o lote).
- **Amostra:** últimos N lotes concluídos (`client_document_batches where status = 'analyzed' order by created_at desc limit N`) — diga o N e o período.

## Passos

1. **Regras vigentes:** `document_ai_rules where active` + revisão usada no lote (`summary.ruleRevision`, `summary.usedRules`). Se o lote usou regras diferentes das atuais, audite contra as **daquele momento** e avise.
2. **Gabarito independente:** refaça o caso com `/analisar-documentacao` (cadastro + documentos). Para os documentos, use as mídias do Storage só no scratchpad (URL assinada via código existente ou download manual do dono), nunca no repo; apague ao final. Sem acesso ao documento ⇒ audite só a consistência (regra × cadastro × checklist) e marque o resto NÃO CONFIRMADO.
3. **Comparar linha a linha** (`client_document_checklist_items`) com o gabarito e classificar cada diferença:

| Tipo de erro | Como reconhecer |
|---|---|
| Falso aprovado | `conforme` mas o documento está vencido, ilegível, é de outra pessoa ou viola regra ativa |
| Falsa pendência | `pendencia`/`ausente` para algo presente, ou exigência que não se aplica (ex.: cônjuge sem a regra, IR para CLT) |
| Regra ignorada | Regra ativa aplicável sem efeito no resultado |
| Regra inventada | Exigência sem regra fixa nem regra ativa que a fundamente (conhecimento geral da IA) |
| Classificação errada | Tipo ou pessoa (`personRole`) errados |
| Extração errada | Nome/CPF/data/valor diferente do documento |
| Divergência exagerada | Diferença só de caixa/acento/abreviação marcada como divergência |
| Ilegível tratado como válido | Dado completado ou `conforme` em documento ilegível |
| Interferência de duplicado | Duplicado contado duas vezes, gerando pendência ou contando para 3 meses |
| Renda errada | Média ≠ soma/3, exclusão sem parentesco comprovado, menos de 3 meses calculado |

4. **Causa provável** de cada erro: IA (prompt/modelo), motor (`document-requirements-engine.js`), política (`document-policy.mjs`/`document-ai-rule-core.mjs`), Base Mestra (regra inativa/ausente/texto ambíguo) ou cadastro errado. Cite arquivo:linha ou `rule_key`.
5. **Reprodução:** todo erro do motor/política vira caso sintético proposto para `/testar-regra-documental` (sem dado real).

## Relatório

```
ESCOPO: <cliente ou amostra N, período> · regras: <ruleRevision>
RESUMO: X linhas conferidas · Y corretas · Z erros (por tipo)
ERROS (mais grave primeiro):
- [tipo] <pessoa> · <documento> · gravado: … · correto: … · evidência … · causa: … · COMPROVADO|RISCO|NÃO CONFIRMADO
LACUNAS DE REGRA (precisa do dono): …
CASOS DE REGRESSÃO PROPOSTOS: …
```

Sem CPF/RG/PIS completo, sem endereço completo, sem valores de renda atribuídos a um nome real em texto que vá para arquivo versionado.
