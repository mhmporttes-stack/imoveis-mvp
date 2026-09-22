---
name: corrigir-bug
description: Corrige um bug relatado no CRM imoveis-mvp investigando a causa raiz antes de editar qualquer código. Use quando o usuário relatar um comportamento errado ("isso não devia acontecer", "esse número está errado", "essa tela não está funcionando") sobre este projeto.
---

# Corrigir um bug

A metodologia completa (localizar código, causa raiz, dependências, impacto, preservar o que funciona, verificar depois) já está em `.claude/agents/crm-editor.md` — use esse agente para a investigação e a correção em si. Esta skill cobre só o que é específico de **entrar pela porta de um bug relatado**, antes de acionar o agente.

## 1. Reproduzir/confirmar o problema com dado real primeiro

Se o usuário deu um exemplo concreto (print, número específico, passo a passo), comece por aí. Se o relato for vago, peça um exemplo concreto ANTES de investigar às cegas — ou, se for mais rápido, investigue você mesmo o suficiente pra formular uma hipótese testável (chamar a API relevante autenticado via script em `scratch/`, comparando esperado vs. observado).

Prefira sempre confirmar com dado real (consulta ao banco, chamada de API) a assumir que o código "parece" ter o bug — este projeto já teve casos onde a explicação óbvia estava errada e a causa real era mais sutil, ou onde o comportamento "estranho" era design intencional, não bug (ver a seção de provenância de cada arquivo em `.claude/rules/`).

## 2. Delegar a investigação e correção ao `crm-editor`

Com o problema confirmado e um exemplo concreto em mãos, siga o checklist do agente (causa raiz, não sintoma; mapear dependências e impacto; corrigir sem mascarar).

## 3. Reportar

Explique a causa raiz encontrada (não só "corrigi X"), em português, com arquivo:linha, e mostre o antes/depois com o mesmo dado real usado para confirmar o problema.
