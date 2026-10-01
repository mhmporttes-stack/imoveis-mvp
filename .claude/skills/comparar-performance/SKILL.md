---
name: comparar-performance
description: Compara dois snapshots de desempenho deste PC (ANTES x DEPOIS) e diz o que melhorou, piorou ou foi ruído. Use após /otimizar-pc ou para acompanhar a evolução do PC entre semanas.
---

# Comparar performance (ANTES × DEPOIS)

Somente leitura. Agente: `performance-pc`.

1. Liste os snapshots: `Get-ChildItem "$env:USERPROFILE\.claude\agent-memory\performance-pc\snapshots"`. Se não houver um "depois", rode `coletar.ps1 -Modulo tudo -Rotulo depois-<ajuste>` (ver `/diagnosticar-pc`).
2. Compare (sem argumentos = os dois mais recentes):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\Documents\Codex\imoveis-mvp\.claude\skills\diagnosticar-pc\scripts\comparar.ps1" [-Antes <a.json> -Depois <b.json>]
   ```
3. Interprete com honestidade: compare condições parecidas (mesmo nº de abas do Chrome/sessões do Claude abertas, uptime parecido); CPU e rede oscilam — variação < 10% é ruído; RAM/disco livre/processos órfãos/limpável são mais confiáveis. Se ficou igual ou pior, diga.
4. Registre em `benchmarks.md` na memória do agente: data, ações feitas, tabela curta antes/depois, veredito.
