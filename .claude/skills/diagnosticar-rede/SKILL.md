---
name: diagnosticar-rede
description: Diagnostica rede deste PC: adaptador, Wi-Fi, gateway, DNS, latência/perda e alcance de claude.ai, api.anthropic.com, chatgpt.com e google.com (somente leitura). Use quando Claude/ChatGPT/sites estiverem lentos ou caindo.
---

# Diagnosticar rede

Somente leitura. Agente responsável: `performance-pc`. Memória: `~/.claude/agent-memory/performance-pc/`.

## Passos

1. Rode a coleta (não altera nada):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\Documents\Codex\imoveis-mvp\.claude\skills\diagnosticar-pc\scripts\coletar.ps1" -Modulo rede -Rotulo diagnosticar-rede
   ```
   Leia o JSON indicado em `SNAPSHOT:`.
2. Interprete: gateway > 10 ms ou perda > 0% = problema local (Wi-Fi/roteador); gateway ok mas 1.1.1.1 alto = provedor; DNS > 100 ms = trocar/avaliar DNS (mudança de DNS pede autorização); proxy habilitado inesperado = atenção; tcp443 falho para um host só = problema do serviço/bloqueio, não do PC.
3. Se Wi-Fi: sinal/canal/banda (prefira 5 GHz).

## Saída (curta, em português simples)

Veredito (OK / atenção / problema) → evidência (números do JSON) → causa provável → ação recomendada, marcando qual é **automática segura** e qual **pede autorização**. Registre achados novos em `diagnosticos.md` da memória do agente. Não aplique correção aqui — correções são `/otimizar-pc`.
