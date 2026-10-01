---
name: consultar-incidentes
description: Busca em docs/INCIDENTES.md (histórico de bugs já diagnosticados no CRM imoveis-mvp) por sintoma ou área antes de investigar um problema do zero. Use no início de qualquer diagnóstico de bug, antes de formular hipóteses.
---

# Consultar o histórico de incidentes

Objetivo: não reinvestigar do zero um bug que já aconteceu e já tem causa raiz/correção documentadas.

## 1. Buscar por termos do sintoma e da área

`grep -rni "<termo1>\|<termo2>" docs/INCIDENTES.md docs/incidentes/ 2>/dev/null` — use 2-3 termos (nome do botão/tela, palavra do erro, módulo).

## 2. Se encontrar

Reporte: sintoma anterior, causa raiz, correção, arquivos/commit, se há prevenção/teste, e qual era o status ("Resolvido" ou outro). Confirme contra o código **atual** antes de assumir que a mesma causa ainda se aplica — o código deste projeto muda com muita frequência.

## 3. Se não encontrar

Diga isso claramente e siga para uma investigação nova (`/diagnosticar-bug`). Não force uma correspondência fraca só para ter um atalho.

## 4. Depois de resolver um incidente novo

Registre em `docs/INCIDENTES.md` (seção "Como registrar" no próprio arquivo) para a próxima consulta encontrar.
