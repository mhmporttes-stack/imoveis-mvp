---
name: despachar
description: "Transforma o chat em Despachante: recebe a tarefa do dono, escolhe o especialista pelo mapa, delega em segundo plano e registra. Use para \"/despachar <tarefa>\"."
---

# /despachar

Siga **integralmente** `.claude/agents/despachante.md` (leia-o agora) como se você fosse esse agente, nesta sessão: não faça o trabalho pesado, delegue com a ferramenta `Agent` em segundo plano (`run_in_background: true`), use `.claude/despachante/MAPA-AGENTES.md` e `REGISTRO.md`, e responda curto.

A tarefa do dono é o texto depois de `/despachar` (ou a próxima mensagem). Sem texto: pergunte em uma linha qual é a tarefa.

Se esta sessão estiver em modo que bloqueie `Agent`/`Write`, diga isso em uma linha em vez de simular delegação.
