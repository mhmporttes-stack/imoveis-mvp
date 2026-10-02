---
name: diagnosticar-chrome
description: "Diagnostica o Chrome deste PC: RAM/CPU por processo, extensões, caches, crashes (e ChatGPT lento). Use para Chrome pesado ou abas lentas."
---

# Diagnosticar Chrome (e ChatGPT no navegador)

Somente leitura. Agente responsável: `performance-pc`. Memória: `~/.claude/agent-memory/performance-pc/`.

## Passos

1. Rode a coleta (não altera nada):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\Documents\Codex\imoveis-mvp\.claude\skills\diagnosticar-pc\scripts\coletar.ps1" -Modulo chrome -Rotulo diagnosticar-chrome
   ```
   Leia o JSON indicado em `SNAPSHOT:`.
2. Interprete: processos `renderer` altos = abas pesadas; `extension`/muitas extensões = suspeitas (liste nomes); `gpu` com CPU alto ou aceleração desligada = problema de GPU/driver; cache > 2 GB = avaliar limpeza (só cache, nunca cookies/senhas/histórico); `possiveisOrfaos` > 0 = processos sem pai; `crashpad14d`/`erros14dEventLog` > 0 = instabilidade.
3. Página lenta específica (ex.: chatgpt.com): use o Chrome DevTools MCP **se** `chrome-devtools` estiver configurado (ver `.claude/performance-pc/chrome-devtools-mcp.md`): `performance_start_trace`/`performance_stop_trace`/`performance_analyze_insight`, `list_network_requests`, `take_memory_snapshot`, `lighthouse_audit`. Sem MCP: use o resultado do coletor + `chrome://process-internals` e o Gerenciador de Tarefas do Chrome (Shift+Esc) com o dono.
4. Nunca leia URLs, histórico, cookies ou senhas do perfil; o DevTools MCP expõe o conteúdo das páginas abertas — use perfil isolado/aba de teste e peça permissão antes de inspecionar páginas logadas.

## Saída (curta, em português simples)

Veredito (OK / atenção / problema) → evidência (números do JSON) → causa provável → ação recomendada, marcando qual é **automática segura** e qual **pede autorização**. Registre achados novos em `diagnosticos.md` da memória do agente. Não aplique correção aqui — correções são `/otimizar-pc`.
