---
name: planejar-campanha
description: "Planeja campanha Meta nova como ESPECIFICAÇÃO, sempre PAUSADA (objetivo, público, orçamento, UTMs). Use para \"monta uma campanha\", \"quanto investir\". Nunca ativa nada."
---

# Planejar campanha (especificação pausada)

Conceito do `campaign-builder` (Meta Ads Stack) adaptado: especificar **certo na criação** (editar depois reinicia o aprendizado), tudo **PAUSADO**, conferir depois de criado. Aqui não há ferramenta de escrita: a saída é a especificação; **quem cria é o dono**, no Gerenciador de Anúncios, depois de aprovar.

Leia antes: `../criar-anuncio/references/conformidade-imobiliaria.md` e, para orçamento e números, `../auditar-trafego/references/regras-decisao.md` §1–§2 e §4.

## Pré-requisitos (sem eles, pare e diga o que falta)

- Baseline do canal calculado por `/auditar-trafego` (custo por cliente/simulação do histórico real). Sem baseline, o orçamento sai como **teste** declarado, não como projeção.
- Copies/briefing aprovados (`/criar-anuncio`) — ou marque "criativos pendentes".
- Rastreamento: para site, a página de destino é `/simulacao` (ou link de campanha `?c=` do Gerador de Links) com Pixel ativo; para WhatsApp, o anúncio de clique para WhatsApp (o CRM liga o cliente pelo `ad_id`).

## Especificação (entregar nesta ordem)

1. **Objetivo e canal**: leads/conversa para captação (WhatsApp → mensagens; site → leads com evento `Lead` do Pixel). Evitar reconhecimento/tráfego/perfil para captação — histórico mostra gasto sem cliente no CRM.
2. **Estrutura enxuta** (baixo volume): 1 campanha, 1–2 conjuntos, 2–4 anúncios (um ângulo por anúncio). Não fragmentar.
3. **Público e região**: Marília/SP e cidades de atuação confirmadas pelo dono; tipo de localização "mora/esteve recentemente"; expansão automática de público — decisão explícita do dono (pode entregar fora da região). Idade/gênero/interesses: **não especificar** até a confirmação de categoria especial (**A CONFIRMAR**).
4. **Categoria especial (moradia/crédito)**: campo marcado como **decisão do dono na criação** — não presumir.
5. **Orçamento**: diário por conjunto, justificado pelo baseline (ex.: quantos clientes/simulações esperar por semana com aquele valor). Sem baseline, "teste de 7 dias com R$ X/dia" e o critério de leitura (§2 das regras).
6. **Rastreamento**: link do site com `utm_source=fb|ig&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}` (padrão que o CRM já atribui). Nome de campanha/conjunto/anúncio legível (canal | público | ângulo | data).
7. **Anúncios**: referência aos criativos aprovados (ID do lote/ângulo) e CTA de cada um.
8. **Status: PAUSADO em tudo.** Ativação = passo separado do dono, em horário comercial, depois de ver a prévia em todos os posicionamentos.

## Checklist de lançamento (para o dono conferir antes de ativar)

- [ ] Objetivo compatível com o canal (mensagens / leads).
- [ ] Região correta (Marília/SP e região de atuação; nada de Brasil inteiro ou cidade homônima de outro estado).
- [ ] Expansão automática de público: decisão consciente.
- [ ] Categoria especial: decidida pelo dono.
- [ ] UTMs completas no link (site) / anúncio de clique para WhatsApp configurado para o número/sessão certo.
- [ ] Conformidade da copy (sem promessa de aprovação; "sujeito a análise de crédito").
- [ ] Tudo criado PAUSADO; 7 dias sem mexer depois de ativar, salvo emergência.
- [ ] Depois de criar: rodar `/auditar-trafego` (Q4) para conferir a segmentação que a Meta realmente salvou.
