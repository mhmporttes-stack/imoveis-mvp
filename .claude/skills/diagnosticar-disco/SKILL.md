---
name: diagnosticar-disco
description: "Diagnostica SSD/disco deste PC: espaço, saúde, latência, lixo limpável (só leitura). Use para lentidão de abertura/gravação ou pouco espaço."
---

# Diagnosticar disco/SSD

Somente leitura. Agente responsável: `performance-pc`. Memória: `~/.claude/agent-memory/performance-pc/`.

## Passos

1. Rode a coleta (não altera nada):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\Documents\Codex\imoveis-mvp\.claude\skills\diagnosticar-pc\scripts\coletar.ps1" -Modulo disco -Rotulo diagnosticar-disco
   ```
   Leia o JSON indicado em `SNAPSHOT:`.
2. Interprete: livre < 15% no C:, saúde ≠ Healthy, desgaste alto, latência > 20 ms ou fila > 2 sustentadas, TRIM desativado (`DisableDeleteNotify = 0` é o correto/ativo) = problema.
3. Mostre quanto é limpável (`limpavel`) e proponha `/otimizar-pc` só para temporários seguros.

## Saída (curta, em português simples)

Veredito (OK / atenção / problema) → evidência (números do JSON) → causa provável → ação recomendada, marcando qual é **automática segura** e qual **pede autorização**. Registre achados novos em `diagnosticos.md` da memória do agente. Não aplique correção aqui — correções são `/otimizar-pc`.
