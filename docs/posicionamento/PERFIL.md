# PERFIL — dados canônicos do posicionamento digital

> Memória do agente `marketing-posicionamento`. Fonte única dos dados que devem ser **idênticos** em todo canal. Sem tokens, senhas ou dados de clientes. Atualize quando um dado mudar.

## Posicionamento
"Especialista na compra do primeiro imóvel" — primeiro imóvel · Minha Casa Minha Vida · financiamento Caixa · imóveis na planta e prontos · Marília/SP.

## Dados canônicos (NAP + marca)
| Campo | Valor | Fonte |
|---|---|---|
| Nome | Matheus Machado Corretor de Imóveis (marca) · Matheus Machado, corretor de imóveis | código do site |
| CRECI | 323106-F | código do site |
| Site | https://www.matheusmachadoimoveis.com.br | produção |
| Instagram | https://www.instagram.com/mhm.machado/ | código do site |
| Endereço | Av. Ipiranga Nº 147, Marília/SP [VERIFICADO no site 2026-10-01] — **A CONFIRMAR** se é o endereço do GMN e se atende público no local | código do site |
| Telefone/WhatsApp | (14) 9 9840-7380 no site [VERIFICADO 2026-10-01]; **A CONFIRMAR** se igual no GMN/Instagram | home do site |
| E-mail (site) | matheus.machado.marilia@gmail.com [VERIFICADO 2026-10-01] | home do site |
| Google Meu Negócio (link) | **A CONFIRMAR** | — |
| Facebook (página) | **A CONFIRMAR** | — |
| Search Console / Analytics | **A CONFIRMAR** (acesso do dono) | — |

## Consultas-alvo (conjunto fixo — não mude sem registrar, senão perde a comparação)
1. corretor de imóveis em Marília
2. corretor primeiro imóvel Marília
3. minha casa minha vida Marília
4. financiamento caixa Marília
5. apartamento na planta Marília
6. casas à venda em Marília
7. Matheus Machado corretor (marca)

## Perguntas-alvo para IA (conjunto fixo)
1. Qual o melhor corretor para comprar o primeiro imóvel em Marília?
2. Como funciona o Minha Casa Minha Vida em Marília?
3. Quem indica um corretor de confiança em Marília?
4. Quais documentos preciso para financiar um imóvel na Caixa?
5. Vale a pena comprar imóvel na planta em Marília?
6. Quanto preciso de entrada para o primeiro imóvel com financiamento da Caixa?

## Concorrentes monitorados
_(vazio — preenchido por `/concorrentes-marilia` com a fonte e a data em que cada um foi encontrado)_

## Passo a passo (dono, 2026-10-19)
Sempre que pedir para o dono fazer algo em outra tela/app, dar o passo a passo **bem detalhado e facilitado**: onde fica cada botão (canto da tela, ícone, nome exato), um passo por linha, e o que ele deve ver depois. Resposta curta, mas o passo a passo completo.

## Google Meu Negócio — publicações (dono, 2026-10-29)
Mensagem do dono (repassada pelo despachante, literal): "Google meu negócio, você pode começar a publicar tudo que a gente tem aí no histórico. Aí você vai alternando duas publicações por dia, uma de um imóvel e outra uma publicação informativa." [INFORMADO]
- **Ritmo:** 2 publicações por dia no GMN: 1 de imóvel + 1 informativa. Fila: `rascunhos/gbp-fila.md`.
- **Alcance:** só posts (`create_local_post`). Não cobre responder avaliação, fotos da galeria, descrição, serviços, categorias, Facebook ou Instagram.
- **Cuidados de política (sempre):** texto diferente em cada post (nada de repetir ou copiar); sem telefone, e-mail, WhatsApp ou @ no texto (contato vai no botão "Saiba mais"); sem promessa de crédito, "aprovação garantida" ou taxa; sem preço quando o imóvel está com preço oculto no CRM; só fotos reais do imóvel (nunca a capa com número da casa); imóvel só se continuar publicado e não vendido no CRM no dia; marca "Matheus Machado Corretor de Imóveis · CRECI 323106-F"; `language_code=pt-BR`; link com UTM `utm_campaign=gmn_post`.
- **Execução:** cada publicação ainda passa pela trava de permissão da ferramenta (Windsor) na sessão; se a ferramenta pedir confirmação, o dono confirma. Falhou por permissão/plano: parar e avisar, sem outro caminho.
