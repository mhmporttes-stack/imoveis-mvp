---
name: descobrir-padroes
description: "Busca padrões e correlações não óbvios nos dados do CRM, separando padrão real de artefato. Use para \"tem algum padrão que não vejo\", \"que horário converte mais\". Só leitura."
argument-hint: "[tema ou pergunta] [período: padrão últimos 30 dias]"
context: fork
agent: analista-dados
---

# Descobrir padrões

Você executa como o agente `analista-dados` (somente leitura). Argumentos: `$ARGUMENTS` (se vazio: varredura geral nos últimos 30 dias completos). Definições: `docs/METRICAS_FUNIL.md`; SQL de apoio: `docs/analytics/consultas-base.md`.

## Passo a passo

1. **Escopo e saúde dos dados.** Defina `[início, fim)` (America/Sao_Paulo), variável-resposta (ex.: alcançou Simulação, alcançou Aprovado, converteu na rodada, tempo até Atendimento) e a coorte. Prefira **COORTE-CRIAÇÃO** (MET-5) para perguntas de resultado, e declare a idade da coorte. Rode **Q-COBERTURA-DO-HISTÓRICO**.
2. **Lista de hipóteses antes de consultar.** Escreva (e conte) as hipóteses que vai testar — o número de comparações é parte do resultado. Dimensões úteis: origem (`source_kind`, roleta × link), responsável, dia da semana, faixa de horário de criação/1º contato, tempo até o primeiro avanço, tentativa que converteu, tipo de renda/estado civil/região de preferência (faixas, nunca individual), valor de financiamento (faixas), presença de documentação, canal WhatsApp × formulário.
3. **Teste cada hipótese** com agregação no SQL (nunca linhas brutas), sempre com `n`, taxa e **IC de Wilson 95 %**. Só considere **candidato** quando: n ≥ 30 por grupo, ICs sem sobreposição e efeito de tamanho relevante para o negócio (não só estatístico).
4. **Procure o artefato antes de aceitar o padrão** (obrigatório, registre o resultado de cada checagem):
   - **Definição:** a diferença some se comparar só a partir de Simulação? (origens que nascem em Atendimento, MET-8).
   - **Composição:** controle por origem e por corretor (Simpson): o padrão sobrevive dentro de cada fatia?
   - **Maturação:** coortes recentes têm menos tempo para avançar — compare coortes com a mesma idade.
   - **Dado de teste / pouco volume / corretor novo / 1–2 dias de dado:** (ex.: conversão de rodada 0–100 % entre corretores é, em parte, uso diferente da rodada — MET-13 item 7).
   - **Lacuna do histórico:** o resultado depende de `client_status_history` fora de etapa 1–7? (MET-13).
   - **Mudança de regra no período:** consulte `docs/CHANGELOG_AI.md`/`docs/BUSINESS_RULES.md` por regra que mudou nas datas do padrão.
5. **Validação cruzada:** divida o período em duas metades (ou use um período anterior). Padrão que não aparece nas duas = **inconclusivo**.
6. **Classifique cada achado:** *Confirmado* (passou 3–5) · *Candidato* (passou 3–4, falta validar) · *Provável artefato* (explicado por 4) · *Inconclusivo* (amostra). Só *Confirmado* vira recomendação; *Candidato* vira "o que medir/coletar a mais".
7. **Correlação ≠ causa:** para cada achado, 1–2 explicações alternativas e o que provaria causa (teste controlado, antes/depois com regra constante).
8. **Pontos que merecem atenção do dono mesmo sem padrão:** contradição com REGRA OFICIAL (possível bug → `crm-editor`), concentração suspeita (um corretor/origem explicando quase tudo), campo sempre vazio/ruim (lacuna de dado).

## Saída

Formato do `analista-dados`, com: nº de hipóteses testadas · tabela de achados (classificação, n, taxa+IC, checagens de artefato, confiança) · 3 primeiros próximos passos. Registre na memória do agente os padrões **investigados** (confirmado/refutado/inconclusivo e por quê — sem dado pessoal). Não recomende mudar processo, meta, regra ou ranking com base em *Candidato*.
