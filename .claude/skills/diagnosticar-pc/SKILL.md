---
name: diagnosticar-pc
description: Diagnóstico completo (somente leitura) deste PC Windows — hardware, Windows, CPU, RAM, SSD, GPU, energia, rede, inicialização, Chrome e Claude — e geração do BASELINE ANTES de qualquer otimização. Use quando o PC estiver lento, antes de otimizar, ou para registrar o estado geral.
---

# Diagnosticar PC (e gerar baseline)

Somente leitura. Agente responsável: `performance-pc`. Prioridade de uso: Claude/Claude Code > ChatGPT > Chrome > desenvolvimento do CRM (não é PC para jogos).

## Passos

1. Verifique a memória do agente (`~/.claude/agent-memory/performance-pc/MEMORY.md`): hardware conhecido, problemas recorrentes, último baseline.
2. Coleta completa (não altera nada; ~30–60 s; rede envia poucos pings/DNS):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\Documents\Codex\imoveis-mvp\.claude\skills\diagnosticar-pc\scripts\coletar.ps1" -Modulo tudo -Rotulo baseline
   ```
   Use `-Rotulo antes-<ajuste>` quando for preceder uma otimização, e `depois-<ajuste>` após. Sem admin, alguns campos (Windows\Temp, algumas contagens) saem vazios — registre isso, não peça admin à toa.
3. Leia o JSON de `SNAPSHOT:` e sintetize por área: Hardware/Windows (versão, uptime longo, updates pendentes, drivers com erro, plano de energia ≠ Equilibrado/Alto desempenho) · CPU · RAM · Disco · GPU/temperatura (se não houver sensor, diga "indisponível sem LibreHardwareMonitor"; não instale) · Rede · Inicialização · Chrome · Claude.
4. Se for o primeiro baseline: grave em `baselines/baseline-<data>.md` na memória do agente um resumo (hardware completo + métricas-chave + estado geral) e atualize `MEMORY.md`.
5. Aprofunde com as skills específicas só onde houver problema: `/diagnosticar-memoria`, `/diagnosticar-disco`, `/diagnosticar-rede`, `/verificar-inicializacao`, `/diagnosticar-chrome`, `/diagnosticar-claude`.

## Saída (curta, para dono não técnico)

Nota geral (OK/atenção/problema) · 3–5 achados priorizados por impacto no Claude/ChatGPT/Chrome · para cada: evidência → ação → *automática segura* ou *pede autorização*. Nunca aplique correção aqui; é `/otimizar-pc`.
