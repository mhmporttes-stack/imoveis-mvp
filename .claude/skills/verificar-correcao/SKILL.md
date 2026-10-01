---
name: verificar-correcao
description: Verifica se uma correção aplicada no CRM imoveis-mvp realmente resolveu o problema — reproduz o cenário original, testa o fluxo afetado, procura regressão em componentes compartilhados, roda testes e build. Use depois de qualquer correção de bug, mesmo pequena, antes de considerar resolvido ou publicar.
---

# Verificar uma correção

Build aprovado sozinho **não significa bug resolvido** — só significa que o código compila. Esta skill é o passo entre "corrigi" e "está resolvido".

## 1. Reproduzir o cenário original

Com o **mesmo dado/caso** usado para confirmar o bug (não um caso novo parecido), confirme que o comportamento esperado agora acontece.

## 2. Testar o fluxo afetado de ponta a ponta

Não só o ponto exato do bug — o fluxo inteiro em que ele está (ex.: corrigiu um cálculo? confira a tela que mostra o resultado, não só a função isolada).

## 3. Procurar regressão em componentes/funções compartilhadas

Se a correção tocou algo usado em mais de um lugar (`lib/*.js` compartilhado, componente usado em várias telas, trigger/função de banco), confira os outros consumidores — ver `.claude/agents/crm-editor.md` §"Abrangência sem virar refatoração".

## 4. Rodar testes e build

- `node --test tests/<área>*.test.mjs` relevantes (falhas conhecidas em `AGENTS.md` §Comandos de validação).
- `pnpm build` quando a mudança toca código que participa do build.

## 5. Validar em produção quando aplicável

Se a correção já foi publicada e o bug só era reproduzível em produção, confirme lá com o mesmo caso — seguindo a mesma disciplina de `/diagnosticar-producao` (leitura antes de qualquer ação).

## 6. Reportar

Diga explicitamente o que foi verificado e como (não só "funcionou"): cenário testado, resultado antes/depois, testes/build rodados, se validou em produção. Se encontrar uma regressão, trate como um bug novo (volte para `/diagnosticar-bug`) — não finja que a correção original está completa.
