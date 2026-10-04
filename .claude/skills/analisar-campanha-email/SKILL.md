---
name: analisar-campanha-email
description: "Analisa e otimiza campanha de e-mail após o envio: entrega, cliques, simulações, saúde da lista, vencedor de A/B e ajustes. Só leitura."
---

# Analisar e otimizar campanha de e-mail

Agente: `email-specialist`. Sem dado de envio (nenhuma campanha rodou ainda) não há o que analisar: diga isso e **não estime números**. Dados do CRM (leads com `utm_source=email`, funil) vêm da Central/`analista-dados` (somente leitura); métricas do provedor vêm de export/print do dono. Definições de funil: `docs/METRICAS_FUNIL.md`. Método A/B: `.claude/skills/planejar-campanha-email/references/estrategia.md`.

## Passo a passo
1. **Janela e amostra**: campanha, variante, período, tamanho enviado; avise se pequeno demais para concluir.
2. **Saúde primeiro (proteção)**: bounce duro/suave, reclamação, descadastro, entrega. Acima do limite do provedor → recomende **pausar** e acione `/auditar-entregabilidade` antes de qualquer otimização.
3. **Funil**: enviados → entregues → cliques (únicos) → visitas `/simulacao` → simulações iniciadas/concluídas → atendimento → cliente. Taxa por etapa e por variante/segmento. Abertura é indicador fraco (privacidade da Apple); use como apoio.
4. **Atribuição**: UTMs (`utm_source=email`, `utm_campaign`, `utm_content`) em `source_metadata`/`client_origins` (`lib/lead-origin.js`); conversões sem UTM (abriu e foi direto ao site/WhatsApp) são limitação a declarar.
5. **A/B**: vencedor só se a hipótese e o critério foram definidos antes, a amostra é suficiente e a diferença supera o ruído; senão "inconclusivo — repetir/mais tempo". Uma variável por vez.
6. **Otimização**: no máximo 3 mudanças priorizadas (impacto × esforço), cada uma com evidência, ação, como saber se falhou e prazo. Nunca otimizar contra a conformidade (mais urgência/promessa) nem contra a saúde da lista.
7. **Registro**: atualizar `docs/email/CAMPANHAS.md` (resultado, decisão, próximo teste). Comparar só com o histórico próprio, sem meta inventada.

## Entrega (≤40 linhas)
Resumo em 3 linhas · tabela de números (fonte e período) · vencedor/inconclusivo · 3 recomendações · limitações dos dados. Sem nome/telefone/e-mail de cliente no relatório.
