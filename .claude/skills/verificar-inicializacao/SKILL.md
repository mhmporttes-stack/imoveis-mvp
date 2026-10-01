---
name: verificar-inicializacao
description: Audita o que inicia com o Windows (Run, pasta Startup, tarefas de logon, serviços de terceiros, tempo dos últimos boots) e aponta itens que atrasam o boot ou consomem em segundo plano (somente leitura). Use para lentidão ao ligar ou processos desnecessários em segundo plano.
---

# Verificar inicialização

Somente leitura. Agente responsável: `performance-pc`. Memória: `~/.claude/agent-memory/performance-pc/`.

## Passos

1. Rode a coleta (não altera nada):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\User\Documents\Codex\imoveis-mvp\.claude\skills\diagnosticar-pc\scripts\coletar.ps1" -Modulo inicializacao -Rotulo verificar-inicializacao
   ```
   Leia o JSON indicado em `SNAPSHOT:`.
2. Classifique cada item: **essencial** (segurança, drivers, o que o dono usa: Claude, Chrome, sync), **dispensável** (updaters redundantes, launchers, suítes de fabricante), **desconhecido** (pesquise o nome antes de opinar; nunca presuma malware nem apague).
3. Desativar item = reversível (Gerenciador de Tarefas > Inicializar) → só proponha; execute após o "sim" do dono, anotando o item na memória para poder reverter. Desinstalar = sempre pede autorização.

## Saída (curta, em português simples)

Veredito (OK / atenção / problema) → evidência (números do JSON) → causa provável → ação recomendada, marcando qual é **automática segura** e qual **pede autorização**. Registre achados novos em `diagnosticos.md` da memória do agente. Não aplique correção aqui — correções são `/otimizar-pc`.
