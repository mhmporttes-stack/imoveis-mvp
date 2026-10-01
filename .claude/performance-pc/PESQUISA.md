# Performance PC — pesquisa de ferramentas (2026-10-01)

Critério: maturidade, compatibilidade Windows/Claude Code, segurança, valor. Nada de terceiros foi instalado ou executado.

| Solução | Veredito | Motivo |
|---|---|---|
| **ChromeDevTools/chrome-devtools-mcp** (oficial Google; Apache-2.0; ~53k★; plugin Claude Code com skills) | **Adotar (preparado, desativado)** | Única fonte madura para trace/rede/memória/Lighthouse do Chrome. Exige Node (ausente) e expõe conteúdo de páginas → ver `chrome-devtools-mcp.md`. |
| **/stuck e /doctor do Claude Code** (nativos) | **Reaproveitar conceitos** | Critérios do `/stuck` (CPU ≥ 90% sustentado, RSS ≥ 4 GB, filho travado, zumbi) viraram regras de `/diagnosticar-claude`; skill nativo segue disponível. |
| **Sysinternals Autoruns/autorunsc** (Microsoft, atual v14.3) | **Conceito agora; ferramenta opcional** | Padrão-ouro de inicialização, mas é download; o coletor cobre Run/Startup/tarefas/serviços com PowerShell nativo. Instalar só com "sim". |
| **LibreHardwareMonitor / PowerShell.HardwareMonitor** | **Opcional (não instalado)** | Única forma confiável de temperaturas/ventoinhas além do `nvidia-smi`/ACPI. É driver de kernel de terceiros → pede autorização. |
| **Cmdlets nativos** (CIM, Get-Counter, Get-StorageReliabilityCounter, powercfg, Get-WinEvent, Test-NetConnection, Resolve-DnsName) | **Base do agente** | Zero dependência, somente leitura, mantidos pela Microsoft. |
| julianprincipe/windows-pc-optimizer (MIT, 10★) | **Adaptar só o conceito** | Boa ideia: baseline pré/pós, ponto de restauração, aprovação por plano. Descartado: foco em jogo/áudio, tweaks MPO/HAGS/timer, execução como Admin, projeto jovem. |
| PapaAL0s16/optimizar-pc (MIT, 1★) | **Adaptar só o conceito** | Bom: dry-run, `deshacer.json`, lista de protegidos. Descartado: instalador `irm \| iex`, remoção de bloatware/serviços, projeto mínimo. |
| josh-stephens/claude-skill-windows-diagnostics (MIT, 0★) | **Ignorar** | Gaming/NVIDIA, e-mail SMTP com credenciais, grava config em `~/.claude`. |
| Otimizadores genéricos, registry cleaners, debloaters, "boosters" | **Descartado** | Proibido pelo briefing; risco > benefício. |
| agent-shells/powershell-skills | **Não necessário** | Guardrails de PowerShell p/ agentes; nosso coletor já é ASCII/somente leitura. |

## Lacunas conhecidas

- Temperatura de CPU/GPU AMD/Intel sem sensor: indisponível sem LibreHardwareMonitor.
- Orçamento de CPU por processo é amostrado em 2 s (indicativo, não profiling).
- Chrome por aba: só via DevTools MCP ou Shift+Esc no Chrome.
