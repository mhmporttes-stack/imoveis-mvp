---
name: comparar-periodos
description: "Compara dois períodos do CRM (funil, conversão, produtividade) separando mudança real de ruído. Use para \"esta semana contra a passada\". Só leitura."
argument-hint: "[período A] vs [período B] — ex.: 2026-09-21 a 2026-09-27 vs 2026-09-28 a 2026-10-04; vazio = últimos 7 dias × 7 anteriores"
context: fork
agent: analista-dados
---

# Comparar períodos

Você executa como o agente `analista-dados` (somente leitura). Argumentos: `$ARGUMENTS`. Vazio: **A** = últimos 7 dias completos (até ontem), **B** = os 7 anteriores. Definições: `docs/METRICAS_FUNIL.md`; SQL: `docs/analytics/*`.

## Passo a passo

1. **Períodos comparáveis.** Duas janelas `[início, fim)` em America/Sao_Paulo, **mesma duração e mesma composição de dias da semana** (7 × 7, 28 × 28…). Se não forem, avise e normalize por dia. Se um período tem dias parciais ("hoje"), exclua ou sinalize.
2. **Saúde dos dados** (Q-COBERTURA-DO-HISTÓRICO): o período B é anterior a 2026-09-07? Então o histórico dele é raro — **diga que a comparação é frágil** e prefira métricas que não dependem de histórico (clientes criados, tentativas de Meta Diária) em vez de etapas/tempos.
3. **Mudou alguma regra ou processo entre A e B?** Consulte `docs/CHANGELOG_AI.md` e `git log` (somente leitura) pelas datas; liste mudanças relevantes (roleta, Meta Diária, WhatsApp/automação, status automático, pontuação, novos corretores). Isso é **o primeiro suspeito** de qualquer diferença — as métricas só são comparáveis se a regra era a mesma.
4. **Mesma métrica nos dois lados, com a definição canônica:**
   - Volume: clientes criados, coorte do funil (MET-4), prospecção (tentativas `manual`/`auto`, rodadas decididas).
   - Funil: base, cada etapa, conversão etapa a etapa — **FUNIL-PAINEL** para "o que o painel mostraria" e **COORTE-CRIAÇÃO** para "qualidade dos leads" (nesta, **compare coortes com a mesma idade**: a mais nova subestima etapas tardias — MET-5; se não der, compare só etapas iniciais).
   - Tempo entre etapas (mediana, p75, n) só onde n ≥ 10 nos dois lados.
   - Origem: mix de `source_kind` (mudança de mix explica mudança de conversão — decomponha em *efeito mix* × *efeito taxa*).
   - Por corretor, se pedido: n por pessoa e por dia; não ranquear com n < 30.
5. **Significância.** Para cada taxa: n, taxa, IC de Wilson 95 % nos dois períodos e a diferença em pontos percentuais. **Mudou de verdade** = ICs sem sobreposição; caso contrário **ruído/inconclusivo** (diga o n necessário aproximado para detectar a diferença observada).
6. **Decomposição das mudanças grandes:** volume × mix de origem × corretor × dia da semana × dado de teste × maturação × regra nova. Atribua o que puder; diga o que sobra **sem explicação**.
7. **Evolução de corretor/time:** use as mesmas regras; trate ramp-up de corretor novo, férias/ausência (presença em `admin_presence`/volume por dia) e mudança de carteira como confusores. Sem julgar pessoa: números e contexto.
8. **Conclusão honesta:** liste (a) o que **melhorou com evidência**, (b) o que **piorou com evidência**, (c) o que é **ruído**, (d) o que **não dá para comparar** e por quê.

## Saída

Formato do `analista-dados`, com tabela lado a lado: métrica | A (n, valor, IC) | B (n, valor, IC) | Δ pp | veredito (melhorou / piorou / ruído / não comparável). Termine com mudanças de regra no intervalo e o que medir nas próximas semanas. Grave na memória do agente apenas o **baseline agregado datado** (sem dado pessoal) para a próxima comparação.
