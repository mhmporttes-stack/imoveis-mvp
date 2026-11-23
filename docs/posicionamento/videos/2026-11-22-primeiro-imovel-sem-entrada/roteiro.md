# Roteiro — "Primeiro imóvel em Marília" (RASCUNHO v2, versão recomendada, COM VOZ)

Reels 1080×1920 · 38,5 s · animação 2D (corretor + cliente + filho) · voz sintética gratuita (Kokoro `pm_alex`, pt-BR) + efeitos sonoros · rodapé legal.
Gancho: número + pergunta ("com R$ 86 mil de ajuda?") + "Presta atenção na conta" · gatilhos: ajuda de R$ 86 mil, subsídio, desconto, grátis, 3 anos sem IPTU, aluguel (dor) · fecho irônico (pedido do dono).
**Não publicar** antes de o dono confirmar os itens "A CONFIRMAR".

## 1. Números (motor `lib/financiamento-estimativa-core.mjs` + `simularEntrada` + cadastro `empreendimentos.regras`, 2026-11-22/23)
| Item | Pedido do dono | Motor / CRM | Usado no v2 |
|---|---|---|---|
| Renda / dependente | R$ 1.800 + 1 | Faixa 1; financiado R$ 108.446 (FGTS 3 anos) / R$ 101.726; 4,25–4,75% a.a., 420 meses | R$ 1.800 + 1 dependente |
| Subsídio MCMV | R$ 55 mil | R$ 53.583 / R$ 54.366 (teto R$ 55 mil) | **R$ 54 mil** (estimado) |
| Parcela | 30% = R$ 600 | 30% de R$ 1.800 = R$ 540; **1ª parcela R$ 525** (30% − R$ 15,03); R$ 600 só com renda ≈ R$ 2.000 | **R$ 525** |
| Casa Paulista | R$ 10 mil ("cheque paulista") | Casa Paulista = R$ 10 mil fixos, mas o cadastro do Terras de SP está **"aceita = não"** (09/10/2026) | **fora do vídeo — A CONFIRMAR** |
| Desconto da construtora | R$ 35 mil | cadastro: **R$ 32.100** (09/10/2026) | **R$ 32 mil — A CONFIRMAR** |
| Total de ajuda | R$ 100 mil | 54 + 32 | **R$ 86 mil** |
| "Sem entrada" | zero | imóvel R$ 235 mil → sobra entrada **R$ 40.871** (60x de R$ 909,15 c/ juros 1% a.m.); com os números do pedido R$ 27.971 (60x de R$ 622,20) | **não afirmado**: "entrada parcelada direto com a construtora" |
| Documentação grátis | sim | confirmado (13/10); CRM: R$ 11.750 | sim |
| 3 anos sem IPTU | sim | sem registro no CRM | **A CONFIRMAR (fonte)** |
| Casa / terreno | casa nova, terreno inteiro | casa térrea 44,50 m² em terreno de 160 m² (8×20), 2 quartos, Fase 5 em obras, entrega 2027 | ok |

## 2. Locução e legenda (tempos reais do vídeo)
| Cena | Tempo (s) | Locução (para gravar, se preferir a sua voz) | Legenda |
|---|---|---|---|
| 1 Gancho | 0.4–2.0 | Primeiro imóvel em Marília, | Primeiro imóvel em Marília, |
| 1 Gancho | 2.1–4.3 | com oitenta e seis mil reais de ajuda? | com R$ 86 mil de ajuda? |
| 1 Gancho | 4.4–6.0 | Presta atenção na conta. | Presta atenção na conta. |
| 2 A conta | 6.3–8.3 | Renda de mil e oitocentos reais | Renda de R$ 1.800 |
| 2 A conta | 8.4–9.5 | e um dependente. | e 1 dependente. |
| 3 Os descontos | 9.8–13.3 | Subsídio do Minha Casa Minha Vida: cerca de cinquenta e quatro mil. | Subsídio do MCMV: R$ 54 mil |
| 3 Os descontos | 13.4–15.7 | Desconto da construtora: trinta e dois mil. | Desconto da construtora: R$ 32 mil |
| 3 Os descontos | 15.8–18.1 | Juntos, cerca de oitenta e seis mil reais! | Juntos: R$ 86 mil ! |
| 4 A parcela | 18.4–19.3 | E a parcela? | E a parcela? |
| 4 A parcela | 19.4–21.0 | Trinta por cento da renda: | 30% da renda : |
| 4 A parcela | 21.1–23.6 | uns quinhentos e vinte e cinco reais por mês. | uns R$ 525 por mês |
| 5 O lugar | 23.9–25.3 | No Terras de São Paulo: | No Terras de São Paulo, |
| 5 O lugar | 25.4–27.0 | casa nova, terreno inteiro | casa nova e terreno inteiro, |
| 5 O lugar | 27.1–28.8 | e três anos sem i pê tê u. | 3 anos sem IPTU |
| 6 A entrada | 29.1–30.2 | Sobrou entrada? | Sobrou entrada? |
| 6 A entrada | 30.3–32.2 | Parcela direto com a construtora. | Parcela direto com a construtora |
| 6 A entrada | 32.3–34.1 | E a documentação é grátis! | Documentação grátis ! |
| 7 Fecho | 34.4–35.4 | E aí? | E aí? |
| 7 Fecho | 35.5–37.5 | Por que você ainda paga o aluguel mesmo? | Por que você ainda paga o aluguel mesmo? |

Voz: sintética (Kokoro `pm_alex`, velocidade 1,18), verificada por transcrição automática (Whisper): inteligível; "Marília" correto; "paga **o** aluguel" (sem o "o" a voz embola). Para usar a SUA voz: grave cada frase (ids em `locucao.json`) em `voz-dono/<id>.wav` e rode `./montar.sh` — a animação se ajusta à duração de cada gravação.

## 3. Legenda do post
"Primeiro imóvel em Marília com cerca de R$ 86 mil de ajuda (subsídio do Minha Casa Minha Vida + desconto da construtora), documentação grátis e entrada parcelada direto com a construtora. Faça sua simulação grátis pelo link. *Valores estimados, sujeitos à análise de crédito. Condições da construtora. Imagens ilustrativas. CRECI 323106-F."
