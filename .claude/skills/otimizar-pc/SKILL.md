---
name: otimizar-pc
description: "Aplica otimizações seguras e reversíveis neste PC, com baseline ANTES e comparação DEPOIS. Use só após /diagnosticar-pc e quando o dono pedir."
---

# Otimizar PC

Agente: `performance-pc`. **Sem baseline do mesmo dia = pare e rode `/diagnosticar-pc` primeiro.** Não há "otimizador milagroso", registry cleaner, debloat agressivo nem script desconhecido: toda ação precisa de justificativa técnica ligada a uma evidência do diagnóstico.

## Fluxo

1. Baseline: `coletar.ps1 -Modulo tudo -Rotulo antes-<ajuste>` (ver `/diagnosticar-pc`).
2. Plano: liste cada ação com evidência, ganho esperado, risco e como reverter. Classifique:
   - **Automática** (pode executar sem perguntar): temporários do usuário com > 7 dias (`scripts\limpar-temp.ps1`, rode primeiro sem `-Aplicar` e mostre o total), reiniciar/encerrar processo órfão confirmado (PID, nome e que não é a sessão atual), ajuste reversível de plano de energia para Alto desempenho/Equilibrado quando justificado, cache do Chrome (apenas `Cache`/`Code Cache`/`GPUCache`, com Chrome fechado).
   - **Pede autorização** (pergunte e espere "sim" por ação): desinstalar programa, apagar dados pessoais, BIOS, qualquer mudança de Registro, desativar segurança/Defender/UAC/Update, remover componentes, mexer em pagefile, trocar DNS, desativar serviço ou item de inicialização, instalar software (inclusive Node.js, LibreHardwareMonitor, Autoruns), qualquer coisa irreversível.
3. Antes de ação reversível que não seja só limpeza: crie ponto de restauração (`Checkpoint-Computer`, exige admin) ou anote o valor anterior para desfazer; registre em `alteracoes.md` na memória do agente (data, o quê, valor anterior, como reverter).
4. Execute uma ação por vez; reverifique com o coletor do módulo afetado.
5. Depois: `coletar.ps1 ... -Rotulo depois-<ajuste>` e `/comparar-performance`. Registre resultado e se valeu a pena (ganho < ruído = diga que não valeu e considere reverter).

## Fora do escopo

Jogos, overclock, "tweaks" de latência, desativar mitigação de segurança, limpar Registro, remover apps da Microsoft em lote.
