---
name: diagnosticar-memoria
description: "Diagnostica RAM, pagefile e maiores consumidores de memória deste PC (só leitura). Use quando o PC estiver lento ou com pouca RAM."
---

# Diagnosticar memória

Somente leitura. Agente responsável: `performance-pc`. Memória: `~/.claude/agent-memory/performance-pc/`.

## Passos

1. Rode a coleta (não altera nada):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\Documents\Codex\imoveis-mvp\.claude\skills\diagnosticar-pc\scripts\coletar.ps1" -Modulo memoria -Rotulo diagnosticar-memoria
   ```
   Leia o JSON indicado em `SNAPSHOT:`.
2. Interprete: uso > 85% sustentado, livre < 2 GB, Pages/sec alto (> 100 sustentado), pagefile quase cheio ou gerenciado manualmente = problema. Agrupe por programa (`topPorNome`), não por PID: Chrome e Claude somam muitos processos.
3. Compare com o baseline em memória (`baselines/`), se existir.

## Saída (curta, em português simples)

Veredito (OK / atenção / problema) → evidência (números do JSON) → causa provável → ação recomendada, marcando qual é **automática segura** e qual **pede autorização**. Registre achados novos em `diagnosticos.md` da memória do agente. Não aplique correção aqui — correções são `/otimizar-pc`.
