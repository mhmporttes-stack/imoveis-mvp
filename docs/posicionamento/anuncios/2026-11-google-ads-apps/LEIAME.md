# Google Ads, display em apps (Marília/SP, financiamento do 1º imóvel), 2026-11

Frase: "Descubra seu poder de compra em menos de 2 minutos". CTA no banner: "Simular Agora" (principal) e "Quero Simular" (sufixo `-quero-simular`). Todos em JPG ≤150 KB (Google aceita até 5 MB; PNG de foto/degradê passava de 400 KB).

## Arquivos (16 = 4 formatos × 2 fundos × 2 CTAs)
`google-ads-apps-<formato>-<fundo>[-quero-simular].jpg`

| Formato | Tamanho | Uso no Google Ads |
|---|---|---|
| `quadrado` | 1200×1200 (1:1) | imagem quadrada |
| `paisagem` | 1200×628 (1,91:1) | imagem paisagem |
| `vertical-4x5` | 1080×1350 | feed/retrato |
| `vertical-9x16` | 1080×1920 | tela cheia/interstitial (topo e base sem texto) |

Fundos: `foto` = sala real do imóvel COD4354 (Palmital, já publicado no site; interior, sem número de casa); `institucional` = azul-marinho da marca com ícone de casa discreto. Só assets oficiais (`public/assets/matheus-machado-symbol.png`), fonte Inter (a do site). Texto sempre ≥10% longe das bordas. Regerar: `node docs/posicionamento/anuncios/2026-11-google-ads-apps/_fonte/gerar.mjs` (precisa de `google-chrome` e ImageMagick).

## Textos para o Google (contagem conferida)
**Títulos curtos (≤30):** 1. Poder de compra em 2 minutos (28) · 2. Simule seu financiamento (24) · 3. Sonho da casa própria (21) · 4. Simulação rápida e online (25) · 5. Primeiro imóvel em Marília (26)

**Título longo (≤90):** Descubra seu poder de compra em menos de 2 minutos e simule o financiamento do 1º imóvel (88)

**Descrições (≤90):**
1. Simule em menos de 2 minutos e descubra seu poder de compra para comprar o 1º imóvel. (85)
2. Quer sair do aluguel? Faça a simulação e veja quanto pode financiar em Marília/SP. (82)
3. Simulação sem compromisso. Análise de crédito e aprovação dependem do banco. (76)
4. Entenda entrada, parcela e as condições do financiamento de forma simples e sem jargão. (88)
5. Matheus Machado, corretor de imóveis em Marília/SP. Simule agora e fale comigo. (79)

**Nome da empresa (≤25):** Matheus Machado Corretor (24). O nome oficial completo ("Matheus Machado Corretor de Imóveis", 35) não cabe no limite; nunca usar "Matheus Machado Imóveis".

## Atenção
- Sem promessa de aprovação, preço, "garantido" ou dado pessoal.
- O Google pode reduzir a entrega de imagens com botão/texto sobrepostos; o botão do banner é pedido do dono. Se a campanha entregar pouco, subir também versões sem o botão.
- Nada foi publicado; a conta do Google Ads não foi tocada.
