---
name: diagnosticar-claude
description: Diagnostica Claude Desktop, Claude Code, MCPs e o app ChatGPT/Codex neste PC: processos node/claude, RAM/CPU, órfãos, tamanho de ~/.claude, MCPs configurados e logs. Use quando o Claude estiver lento, travando, com sessão degradada ou consumindo muita RAM.
---

# Diagnosticar Claude / Claude Code

Somente leitura. Agente responsável: `performance-pc`. Memória: `~/.claude/agent-memory/performance-pc/`.

## Passos

1. Rode a coleta (não altera nada):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\Documents\Codex\imoveis-mvp\.claude\skills\diagnosticar-pc\scripts\coletar.ps1" -Modulo claude -Rotulo diagnosticar-claude
   ```
   Leia o JSON indicado em `SNAPSHOT:`.
2. Interprete (critérios do /stuck do Claude Code): CPU ≥ 90% sustentado = loop; RSS ≥ 4 GB = vazamento; `node.exe` sem pai vivo (`nodeOrfaos`) = servidor MCP/subprocesso órfão; processo filho parado (git/node/shell) trava o pai; `~/.claude/projects`/`file-history`/`shell-snapshots` enormes = sessões antigas pesando; muitos MCPs = cada um é um processo e contexto a mais.
3. `node` ausente no PATH (`nodeInstalado=false`) = MCPs via npx não funcionam neste PC.
4. Sessão degradada (respostas lentas, ferramentas falhando): recomende nova sessão/`/compact` antes de qualquer mexida no sistema. Matar processo órfão = reversível, mas confirme o PID e que não é a sessão atual.
5. Para travamento ativo, o skill nativo `/stuck` complementa; para diagnóstico de instalação, `claude doctor` (terminal).

## Saída (curta, em português simples)

Veredito (OK / atenção / problema) → evidência (números do JSON) → causa provável → ação recomendada, marcando qual é **automática segura** e qual **pede autorização**. Registre achados novos em `diagnosticos.md` da memória do agente. Não aplique correção aqui — correções são `/otimizar-pc`.
