---
name: planejar-campanha-email
description: "Planeja campanha de e-mail (prospecção/nutrição) como especificação: público, cadência, CTA, KPIs e A/B. Use para \"monta campanha de e-mail\". Não envia."
---

# Planejar campanha de e-mail (especificação)

Agente: `email-specialist`. Antes: `.claude/rules/email-marketing.md` e `docs/email/PERFIL.md`. Referência de método: `references/estrategia.md` (leia). Saída é um plano; nada é enviado e nada é gravado no CRM.

## Passo a passo
1. **Objetivo único e mensurável** (ex.: "X simulações iniciadas") e o evento que o prova (envio de `/simulacao` com `utm_source=email`). Um e-mail = um objetivo = um CTA.
2. **Público e origem** (gate de conformidade): quem entra, de onde veio o contato, com que base (consentimento / legítimo interesse — **A CONFIRMAR com advogado** em massa), quem é excluído (`do_not_contact`, descadastro, clientes em atendimento/ganhos, bounce). Origem desconhecida = fora. Tamanho da lista vem de `analista-dados` (peça pela Central); não estime.
3. **Segmentos** (poucos, por situação e não por dado sensível): ex. paga aluguel · já simulou e parou · pediu info e não avançou. Mensagem diferente por segmento; sem renda/CPF/estado civil individual no texto.
4. **Oferta e prova**: o que a pessoa ganha ("descubra seu poder de compra em 2 minutos, sem compromisso") e prova verificável. Sem promessa proibida (conformidade).
5. **Sequência/cadência**: 1 a 3 e-mails, espaçados (`references/estrategia.md`); regra de parada (clicou, simulou, respondeu, descadastrou). Coordenar com WhatsApp/Prospecção para **não contactar a mesma pessoa em dois canais no mesmo dia** (consulte `diretor-atendimento`/Central).
6. **Volume e rampa**: lote inicial pequeno e crescente, só após `/auditar-entregabilidade` aprovar. Sem número fixo inventado.
7. **Medição**: UTMs (`utm_source=email&utm_medium=email&utm_campaign=<slug>&utm_content=<variante>`), KPIs primários e de proteção (descadastro, reclamação, bounce), janela de leitura e **critério de parada** (ex.: reclamação acima do limite do provedor).
8. **A/B**: uma variável por teste, hipótese escrita, tamanho mínimo e decisão antes de ver o resultado (`references/estrategia.md`).
9. **Pré-requisitos e decisões do dono**: provedor, domínio/subdomínio remetente, base legal, descadastro no CRM (→ `crm-editor`).

## Entrega
Plano ≤60 linhas (tabela objetivo/público/exclusões/sequência/KPIs/A-B/riscos/pré-requisitos) + registro em `docs/email/CAMPANHAS.md` com status **planejada**. Peças vão para `/criar-email`.
