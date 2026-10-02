---
name: analisar-funil
description: "Mede o funil comercial: conversão e tempo entre etapas, por origem e corretor, com amostra. Use para \"como está o funil\", \"gargalo\". Só leitura. CPL é /auditar-trafego."
argument-hint: "[período: hoje | ontem | 7d | 30d | mês | AAAA-MM-DD a AAAA-MM-DD] [filtro opcional: corretor ou origem]"
context: fork
agent: analista-dados
---

# Analisar funil

Você executa como o agente `analista-dados` (somente leitura — política de segurança do agente vale integralmente). Argumentos recebidos: `$ARGUMENTS` (se vazio: últimos 7 dias completos, terminando ontem).

Definições **canônicas**: `docs/METRICAS_FUNIL.md`. SQL testado: `docs/analytics/funil-painel.sql` e `docs/analytics/consultas-base.md`. Não redefina conversão.

## Passo a passo

1. **Período.** Converta o argumento em `[início 00:00, fim 00:00)` em `America/Sao_Paulo` (fim exclusivo; "hoje" = dia corrente parcial — avise que é parcial). Informe as datas no topo.
2. **Saúde dos dados.** Rode **Q-COBERTURA-DO-HISTÓRICO**. Se o período começa antes de 2026-09-07, avise que o histórico é raro/curto (MET-13). Anote lacunas que afetam esta análise.
3. **Funil do painel (MET-4).** Rode `funil-painel.sql` com o período. Calcule: base, cada etapa, conversão etapa a etapa e total (Venda/base). Declare que a base mistura coortes. Se um número de etapa alta (aprovado/reunião/venda) for 1–3, verifique se o cliente é **de teste** antes de comentar (MET-13 item 6) — sem expor nome.
4. **Coorte-criação (MET-5)** do mesmo período (**Q-COORTE-CRIAÇÃO**): % dos criados que chegou a Simulação/Documentação/Aprovado/Venda, com a **idade da coorte** em dias. Compare as duas visões e explique a diferença se for grande (a primeira inclui quem já estava no funil; a segunda só os leads novos).
5. **Quebra por origem (MET-8).** Mostre por `source_kind`, **comparando só a partir de Simulação** (origens `broker_link`/`whatsapp_*`/`campaign` nascem em Atendimento — não compare "% atendimento"). Origem com n < 10: só liste.
6. **Quebra por corretor (opcional ou se pedido).** Funil por **responsável atual** (MET-4/MET-11), com n por corretor; sem ranquear pessoas com n < 30 e sem julgar — diga quando a diferença pode ser de carteira/origem, não de desempenho.
7. **Tempo entre etapas (MET-6)** (**Q-TEMPO-ENTRE-ETAPAS**, filtrando pela chegada à etapa seguinte no período): mediana, p75, n e "fora de ordem". Etapas com n < 10: não reporte tempo.
8. **Prospecção (MET-9)**, se o pedido envolver topo do funil: tentativas `manual` × `auto` e taxa de conversão das rodadas **decididas**, com n.
9. **Gargalo:** a etapa com **maior queda relativa** que seja estatisticamente defensável (Wilson, MET-14). Se nenhuma for, diga "sem gargalo defensável com esta amostra".
10. **Reconciliação:** soma das partes = total; funil decrescente; compare com o painel Desempenho quando o dono tiver o número (o SQL replica o painel — divergência = investigar, não "ajustar").

## Saída

Formato do agente `analista-dados` (resumo → escopo/n/fonte → números → achados → limitações → consultas). Inclua uma tabela do funil: etapa | clientes | conversão da etapa | conversão acumulada. Nunca exponha dados pessoais de cliente. Recomendações viram **perguntas ou propostas para o dono** — você não altera nada.
