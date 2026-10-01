---
name: pre-mortem
description: Análise preventiva de uma implementação grande ANTES de publicar — pergunta "suponha que isso entrou em produção e deu problema; quais são as formas plausíveis de falhar?" em vez de auditar o que já existe. Use antes de fazer merge/push de uma feature grande, migration arriscada, ou mudança que toca módulo compartilhado deste CRM.
---

# Pre-mortem de uma implementação

Mesmo agente e mesmo rigor de evidência de `/auditar-crm` (`.claude/agents/auditor-crm.md` — leia a seção "Pre-mortem" de lá), com a pergunta invertida: não "o que já está quebrado", e sim **cenários plausíveis de falha** da implementação específica que está prestes a ir pro ar.

## O que analisar (só o que é real para esta implementação, nunca lista genérica)

Dados, permissões, concorrência, mobile, integrações externas, estado parcial, retries, usuários simultâneos, deploy, migration, rollback, dependência externa — igual à lista do agente. Adicione um ângulo específico deste projeto: **código gerado por agente de IA tende a falhar silenciosamente** — a superfície funciona (a tela abre, o botão clica) mas a lógica interna tem uma lacuna que só aparece com um dado real específico (ex.: `distribution_type='round_robin'` não excluído de uma regra de pontuação nova, um `status` novo esquecido num `CHECK` constraint). Procure esse tipo de lacuna com prioridade, não só falha de infraestrutura clássica.

## Como conduzir

1. Releia o diff/PR da implementação (ou os arquivos relevantes se ainda não houver diff) — não analise de memória do que foi pedido, analise o código que vai mesmo subir.
2. Para cada camada que se aplica a essa mudança específica (não todas): que dado real poderia fazer isso quebrar? Que usuário simultâneo? Que retry duplica algo? Que migration falha pela metade?
3. Classifique cada cenário com a mesma severidade (P0-P3) e evidência (COMPROVADO/RISCO/NÃO CONFIRMADO) do agente — aqui quase tudo nasce RISCO (é hipotético por definição), e isso é esperado; só suba para COMPROVADO se você reproduziu o cenário de verdade.

## Relatório

Mesmo formato do agente, mas cada item é um cenário de falha, não um problema já existente:

```
PRE-MORTEM — <implementação>

P0: <n>  P1: <n>  P2: <n>  P3: <n>

1. [P1] <cenário curto>
   Gatilho: <o que precisa acontecer pra isso ocorrer>
   Evidência: <por que é plausível neste código>
   Impacto: <o que quebra>
   Recomendação: <o que fazer antes de publicar>
```

Sem cenário plausível relevante: diga isso — não invente risco para preencher a seção.
