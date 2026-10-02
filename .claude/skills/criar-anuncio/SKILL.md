---
name: criar-anuncio
description: "Cria ângulos, copies e briefing visual de anúncios Meta (primeiro imóvel, MCMV). Use para \"cria um anúncio\", \"copy para campanha\". Entrega lote para aprovação; nunca publica."
---

# Criar anúncio (copy + briefing de criativo)

Conceito do `ad-creative-engine` (Meta Ads Stack) adaptado: o anúncio é uma **peça completa**, não uma foto; poucos ângulos bons; **um lote por aprovação**. Sem gerador de imagem nem raspagem automática da Biblioteca de Anúncios — a saída é texto + briefing visual para o designer/Canva.

Antes de escrever, leia `references/conformidade-imobiliaria.md` (obrigatório).

## Entradas

- **Objetivo/canal:** WhatsApp (clique para conversar), formulário/simulação no site (`/simulacao`), ou lembrança de marca. Define o CTA.
- **Oferta:** empreendimento específico (dados de `properties`/`empreendimentos`, nunca inventados) ou captação geral (primeiro imóvel / MCMV / financiamento).
- **Público:** quem é (ex.: casal que paga aluguel, jovem saindo da casa dos pais, quem tem FGTS parado).
- Opcional: o que já funcionou — rode `/auditar-trafego` (Q2 nível anúncio) para ver quais anúncios geraram mais **simulações**, não só cliques; ou anúncios de concorrentes que o dono colar.

## Passo a passo

1. **3 a 5 ângulos** distintos (nunca o mesmo ângulo 5 vezes). Para cada: persona, enquadramento (dor | desejo | autoridade — um só) e o gancho em 1 frase. Ângulos que costumam servir ao nosso público: aluguel × parcela; FGTS na entrada; "primeiro imóvel" / sair do aluguel; subsídio do MCMV conforme renda (sem prometer valor); bairro/empreendimento em Marília; "simule em 2 minutos sem compromisso"; atendimento humano/local.
2. **Copy por ângulo:** texto principal (até ~125 caracteres visíveis antes do "ver mais"; gancho na 1ª linha), título (até ~40 caracteres), descrição curta, CTA verbal e específico ("Simular agora", "Falar no WhatsApp", "Ver condições").
3. **Briefing visual** por ângulo — as 8 camadas: base (foto real do empreendimento/cliente, nunca banco de imagem genérico que pareça outro lugar), chamada do público, gancho, título, linha de prova (só fatos verificáveis), botão/CTA, marca (canto superior), selo de confiança verdadeiro (ex.: correspondente Caixa, CRECI). Formatos: 1080×1350 (feed), 1080×1080, 1080×1920 (stories/reels).
4. **Rastreamento:** para anúncio de site, inclua o link com UTM no padrão (`utm_source=fb|ig&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`) — sem isso o anúncio não aparece no funil do CRM.
5. **Autoavaliação** (0–10; abaixo de 8, refaça): persona clara em 2 s; gancho específico; CTA claro; nenhuma promessa proibida (conformidade); prova verificável; legível no celular.

## Saída e aprovação

Tabela por ângulo (persona, gancho, texto, título, descrição, CTA, briefing visual, link com UTM) com status **"aguardando aprovação"**. Um lote por vez: não crie o próximo lote antes de o dono aprovar ou descartar o atual. Publicar/criar o anúncio é ação do dono no Gerenciador (ou via `/planejar-campanha`, sempre pausado).
