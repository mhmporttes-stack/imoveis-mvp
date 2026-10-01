---
name: plano-semanal
description: Fecha o ciclo do Marketing/Posicionamento — define o que melhorar esta semana (máx. 7 itens priorizados), implementa o que for autorizado, mede o resultado contra o histórico e acompanha o BACKLOG. Use para "o que devemos melhorar esta semana", "implemente as melhorias que você encontrou", "o que mudou desde a última vez", "funcionou?".
---

# Plano semanal, implementação e medição

Agente: `marketing-posicionamento`. Arquivos: `docs/posicionamento/BACKLOG.md` e `HISTORICO.md`.

## "O que melhorar esta semana?"
1. Leia `BACKLOG.md` e o último snapshot. Se o último snapshot tiver mais de 14 dias, rode versão enxuta de `/auditar-posicionamento` (site + consultas-alvo + o que o dono enviar).
2. **Reavalie itens vencidos**: para cada item com data de checagem ≤ hoje, meça o indicador e marque **Funcionou / Não funcionou / Inconclusivo** com o número antes/depois. Não funcionou → registre a hipótese revista (não repita a mesma ação).
3. Escolha **até 7 itens** por impacto × esforço (P1 primeiro) e separe por quem executa: **[Claude implementa]**, **[Matheus aprova e publica]**, **[Matheus fornece dado/acesso]**.
4. Entregue: lista numerada (evidência · ação · como saber se falhou · quem) + tempo estimado do Matheus (ideal ≤ 30 min/semana).

## "Implemente as melhorias"
1. Liste o que vai fazer e o que **não** pode (precisa dele) — espere o "ok" apenas se houver ação externa (GMN, redes, e-mail, WhatsApp, publicação em produção). Mudança local de código/rascunho pode começar.
2. **Código do site** → `/seo-site` §Implementar (build ok, changelog; **push só com pedido explícito**).
3. **Textos para canais externos** (respostas, posts, bio, descrição GMN, perguntas e respostas) → entregar prontos, numerados, no chat e salvos em `docs/posicionamento/rascunhos/AAAA-MM-DD.md`, para o Matheus colar. Se ele autorizar o Chrome, pode preencher campos, mas **clicar em publicar/enviar/responder só com sim explícito daquela ação**.
4. Atualize `BACKLOG.md` (status, data da publicação, indicador-base, data da checagem).

## "Funcionou?" / "O que mudou?"
Compare snapshot atual × anterior por área e por número-chave; atribua mudança só quando houver evidência temporal (ação publicada em X, indicador mudou depois). Correlação sem evidência = "inconclusivo". Grave em `HISTORICO.md`.

## Regras
Sem metas inventadas; sem item sem checagem de falha; sem lista com mais de 7 ativos. Recorrência (semanal) só se o dono pedir e **somente leitura/rascunho** — nada que publique sozinho (`mcp__scheduled-tasks__*` / `/schedule` apenas para gerar o relatório).
