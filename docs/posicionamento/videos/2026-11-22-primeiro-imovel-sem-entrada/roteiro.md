# Roteiro — "Primeiro imóvel em Marília" (RASCUNHO v1 — não gravar a narração antes de fechar os números)

Reels 1080×1920 · 37,6 s · animação 2D (corretor + cliente + filho) · efeitos sonoros incluídos · sem narração (o dono grava depois).
Gancho: pergunta + número ("sem dar entrada?") · gatilhos: sem entrada, subsídio, desconto, grátis, 3 anos sem IPTU, "R$ 100 mil", aluguel (dor) · fecho irônico (pedido do dono).

## 1. Números conferidos (motor `lib/financiamento-estimativa-core.mjs` + `simularEntrada` + cadastro do CRM, 2026-11-22/23)
| Item | Pedido | Motor / CRM | Situação |
|---|---|---|---|
| Renda / dependente | R$ 1.800 + 1 | Faixa 1 (até R$ 3.200); financiado R$ 108.446 (FGTS 3 anos) ou R$ 101.726; 4,25–4,75% a.a., 420 meses | ok |
| Subsídio MCMV | R$ 55 mil | R$ 53.583 (FGTS 3 anos) / R$ 54.366; teto R$ 55 mil | **dizer "até R$ 55 mil"** |
| Parcela | 30% da renda = R$ 600 | 30% de R$ 1.800 = R$ 540; **1ª parcela estimada R$ 525** (30% − R$ 15,03). R$ 600 só com renda ≈ R$ 2.000 (parcela R$ 585, subsídio ≈ R$ 42–43 mil) | **R$ 600 não bate com R$ 1.800** |
| "Cheque Paulista" R$ 10 mil | R$ 10 mil | nome oficial no sistema: **Casa Paulista** (R$ 10 mil fixos), mas o cadastro do Terras de SP está **"aceita = não"** (09/10/2026) | **confirmar** |
| Desconto da construtora | R$ 35 mil | cadastro: **R$ 32.100** (09/10/2026) | **confirmar** |
| Entrada ("sem entrada") | zero | imóvel R$ 235 mil → sobra entrada: **R$ 40.871** com os números do CRM (60x de R$ 909,15 c/ juros 1% a.m.) ou **R$ 27.971** com os do pedido (60x de R$ 622,20). Mensal = Caixa R$ 525 + entrada parcelada | **"sem entrada" não se sustenta** |
| Documentação grátis | sim | confirmado pelo dono (13/10); CRM: valor R$ 11.750 | ok |
| 3 anos sem IPTU | sim | sem registro no CRM | **informado — confirmar fonte** |
| Casa / terreno | casa nova, terreno inteiro | casa térrea de 44,50 m² em terreno de 160 m² (8×20), 2 quartos, Fase 5 em obras, entrega 2027 | ok |

## 2. Cena a cena (v1 = como pedido)
| Tempo | Visual | Locução | Sons |
|---|---|---|---|
| 0–4,2 | etiqueta "Sem entrada?"; corretor pula e acena; cliente entra; cartão "Entrada R$ 0 ?" | "Primeiro imóvel em Marília, sem dar entrada? Presta atenção na conta." | boing, pouso, pop, whoosh |
| 4,2–8,2 | "A conta": cartões Renda R$ 1.800 e 1 dependente; o filho entra | "Renda de mil e oitocentos reais e um dependente." | swipe, pops, boing |
| 8,2–17,2 | "Os descontos": 3 cartões em sequência + total; corretor aponta cada um; todos comemoram | "Subsídio do Minha Casa Minha Vida: até cinquenta e cinco mil. Casa Paulista: mais dez mil. Desconto da construtora: trinta e cinco mil. Até cem mil reais!" | moeda + ding por cartão, sparkle |
| 17,2–22,6 | "A parcela": medidor até 30% e cartão R$ 525 | "E a parcela? Trinta por cento da renda: uns quinhentos e vinte e cinco reais por mês." | whoosh, click, ding |
| 22,6–28,2 | "Terras de São Paulo": casa + 3 selos (casa nova, terreno 160 m², 3 anos sem IPTU) | "No Terras de São Paulo, em Marília: casa nova, terreno inteiro e três anos sem IPTU." | boing, pops |
| 28,2–33 | "Sobrou entrada?": entrada parcelada direto na construtora + documentação grátis | "Sobrou entrada? Parcela direto com a construtora. E a documentação é grátis!" | pops, ding, sparkle |
| 33–37,6 | "E aí?": recibo de aluguel rasga; corretor com sobrancelha de ironia; cliente sem graça; "Simule grátis ↓" | "E aí? Por que você ainda paga aluguel mesmo?" | tear, **womp** |

Narração corrida (96 palavras ≈ 33 s no ritmo normal, +pausas): leia a coluna "Locução" na ordem. Ideal: uma frase por arquivo de áudio (ou um áudio só com pausa de 1 s entre cenas) — a linha do tempo se re-sincroniza pelos tempos de `SC` e `CAP` em `video.html`.

## 3. Versão recomendada (honesta) — o que muda
- **Gancho:** "Primeiro imóvel em Marília com até R$ 85 mil de ajuda e entrada parcelada direto com a construtora. Presta atenção na conta." (etiqueta "Entrada parcelada").
- **Descontos:** só o que o cadastro confirma: subsídio "até R$ 55 mil" + desconto da construtora R$ 32 mil (sem Casa Paulista, salvo confirmação). Total "cerca de R$ 85 mil".
- **Parcela:** "Financiamento na Caixa: uns R$ 525 por mês (30% da renda)" — sem dizer "parcela de R$ 600".
- **Entrada:** "O que sobrar de entrada parcela direto com a construtora, em até 60 vezes" (juros 1% a.m. no cadastro — decidir se entra no vídeo/legenda).
- **Fecho:** igual (irônico). Rodapé legal já está no vídeo: "Valores estimados, sujeitos à análise de crédito · Condições da construtora · Imagens ilustrativas · CRECI 323106-F".

## 4. Legenda do post (para a versão recomendada)
"Primeiro imóvel em Marília com cerca de R$ 85 mil de ajuda (subsídio do Minha Casa Minha Vida + desconto da construtora), documentação grátis e entrada parcelada direto com a construtora. Faça sua simulação grátis pelo link. *Valores estimados, sujeitos à análise de crédito. Condições da construtora. Imagens ilustrativas. CRECI 323106-F."
