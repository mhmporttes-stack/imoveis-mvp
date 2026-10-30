# Fila de publicações do Google Meu Negócio (GBP)

> Regra: `docs/posicionamento/PERFIL.md` §"Google Meu Negócio — publicações". 2 por dia: **1 imóvel + 1 informativa**, texto sempre diferente.
> Perfil: `locations/11870750752232851669`. Ação Windsor: `google_my_business` → `create_local_post` (reler o schema com `list_actions` antes; `language_code=pt-BR`; botão "Saiba mais").
> Montada em 2026-10-29 a partir do CRM (tabela `properties`, só `is_published=true`, status "Pronto para morar"; nenhum marcado como vendido). **Antes de cada post de imóvel: reconferir no CRM se continua publicado/não vendido.** Preço fica fora do texto (todos estão com `hide_price=true`).
> Fotos: lâminas reais do carrossel do imóvel (foto do imóvel com rótulo do bairro/código), conferidas visualmente em 2026-10-29, URL pública com HTTP 200. Nunca a lâmina 1 (capa com texto grande e, na 4362, o número da casa).

## Status
> **Automático (autorização permanente do dono, 2026-10-30):** 2 posts por dia, todo dia às 6h (Brasília), até a fila acabar (rotina agendada). Cada execução pega o próximo "na fila" de imóvel + o próximo informativo, reconfere no CRM, publica e atualiza esta tabela. **Informativos a partir do N3 vão com foto** (capa do carrossel, seção "Informativas a partir do dia 3"). Uma única rotina publica (a das 6h); a de 9h23 foi desligada em 2026-10-30 porque duplicava os posts.
| # | Dia | Tipo | Assunto | Status |
|---|---|---|---|---|
| I1 | 1 | Imóvel | COD4362 Jd. Santa Antonieta | PUBLICADO 2026-10-29 (localPosts/6008231067595434958) |
| N1 | 1 | Informativa | Primeiro imóvel: por onde começar (Post 1 aprovado 02/10) | PUBLICADO 2026-10-29 (localPosts/7534848968843610473) |
| I2 | 2 | Imóvel | COD4361 Maria Angélica | PUBLICADO 2026-10-30 (localPosts/6391459089878422979) |
| N2 | 2 | Informativa | MCMV e faixas de renda (Post 2 aprovado 02/10) | PUBLICADO 2026-10-30 (localPosts/5521620600090932402) |
| I3 | 3 | Imóvel | COD4360 Torres de Marília | na fila |
| N3 | 3 | Informativa | 5 passos para o primeiro imóvel (com foto) | na fila |
| I4 | 4 | Imóvel | COD4359 Nova Marília | na fila |
| N4 | 4 | Informativa | Quitar antes do prazo (com foto) | na fila |
| I5 | 5 | Imóvel | COD4356 Praça Esmeraldas | na fila |
| N5 | 5 | Informativa | Registrato: o que os bancos veem sobre você (com foto) | na fila |
| I6 | 6 | Imóvel | COD4354 Palmital | na fila |
| N6 | 6 | Informativa | Erros que fazem continuar no aluguel (com foto) | na fila |
| I7 | 7 | Imóvel | COD4352 Cavalari | na fila |
| N7 | 7 | Informativa | Coisas que ninguém te conta sobre o 1º imóvel (com foto) | na fila |

Links: imóvel = `https://www.matheusmachadoimoveis.com.br/empreendimentos/<id>?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=cod<código>` · informativa = `https://www.matheusmachadoimoveis.com.br/simulacao?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=<id do post>`.

---

## Imóveis

### I1 — COD4362 · Casa no Jd. Santa Antonieta
- Foto: `https://raw.githubusercontent.com/mhmporttes-stack/imoveis-mvp/5e5fabbded8a963eb2a402dfdd91ba35f9a9f29a/docs/posicionamento/carrosseis/2026-10-26-santa-antonieta-casa/ig/lamina-02.jpg`
- Link: `https://www.matheusmachadoimoveis.com.br/empreendimentos/361178f3-6c77-4474-9efe-5ca0b1c9dcd6?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=cod4362`
> Casa desocupada e com pintura nova no Jd. Santa Antonieta, em Marília. Dá para mudar sem reforma.
>
> 2 quartos, sala ampla integrada à cozinha americana, banheiro com box de vidro, área de serviço coberta, garagem coberta para 2 carros e quintal fácil de manter.
>
> Aceita financiamento e o proprietário analisa proposta e permuta. Toque em "Saiba mais" para ver todas as fotos.
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### I2 — COD4361 · Casa no Maria Angélica
- Foto: `https://raw.githubusercontent.com/mhmporttes-stack/imoveis-mvp/b3150408899821c9f93d5926b51c851a5442d107/docs/posicionamento/carrosseis/2026-10-26-maria-angelica-casa/ig/lamina-02.jpg`
- Link: `https://www.matheusmachadoimoveis.com.br/empreendimentos/86d38706-b05d-4bdd-bc87-1d3f005e5bde?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=cod4361`
> Quintal amplo para a família aproveitar: casa térrea no Maria Angélica, em Marília.
>
> São 2 quartos, sala integrada à cozinha planejada, banheiro com box de vidro, lavanderia fechada e área coberta no quintal.
>
> Quer saber se ela cabe no seu orçamento? Veja as fotos em "Saiba mais" e faça a simulação.
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### I3 — COD4360 · Apartamento no Condomínio Torres de Marília (Zona Norte)
- Foto: `https://raw.githubusercontent.com/mhmporttes-stack/imoveis-mvp/60260b82626da869d0a178d55e30071e069610be/docs/posicionamento/carrosseis/2026-10-24-torres-de-marilia-ape/ig/lamina-02.jpg`
- Link: `https://www.matheusmachadoimoveis.com.br/empreendimentos/901fe375-85ca-4694-bfc8-db1b71bf25b7?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=cod4360`
> Apartamento em condomínio fechado na Zona Norte de Marília (Torres de Marília), pronto para morar.
>
> Cozinha planejada com cooktop e forno embutido, sala com sanca iluminada e parede em cimento queimado, 2 quartos e banheiro com box de vidro.
>
> Um bom ponto de partida para quem está saindo do aluguel. Todas as fotos em "Saiba mais".
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### I4 — COD4359 · Casa reformada no Nova Marília
- Foto: `https://raw.githubusercontent.com/mhmporttes-stack/imoveis-mvp/262e235464d0e0f977a728f44fcb8e1d008a62a2/docs/posicionamento/carrosseis/2026-10-23-nova-marilia-casa/ig/lamina-02.jpg`
- Link: `https://www.matheusmachadoimoveis.com.br/empreendimentos/ed88c8d1-1c4d-409f-a211-79aedf12871b?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=cod4359`
> Totalmente reformada e vazia: casa térrea no Nova Marília, em Marília.
>
> 2 quartos, sala e cozinha com armários, banheiro com box de vidro, garagem coberta para 2 carros, quintal gramado e quartinho de despensa nos fundos. Terreno de 8 x 20 m (160 m²).
>
> Aceita financiamento. Veja as fotos em "Saiba mais".
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### I5 — COD4356 · Apartamento reformado no Praça Esmeraldas
- Foto: `https://raw.githubusercontent.com/mhmporttes-stack/imoveis-mvp/bc70744bbbbe85581f75718bdc4111b6ec60ebfd/docs/posicionamento/carrosseis/2026-10-18-praca-esmeraldas-ape/ig/lamina-02.jpg`
- Link: `https://www.matheusmachadoimoveis.com.br/empreendimentos/861a1a8b-4e33-4b65-ab56-04df30ff3b46?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=cod4356`
> Apartamento todo reformado no Praça Esmeraldas, em Marília, com vários itens que ficam no imóvel.
>
> 2 dormitórios (1 suíte), 2 vagas de garagem, ar-condicionado nos 2 quartos, coifa, cooktop e forno, e varanda com fechamento. Acabamento claro e moderno.
>
> Fotos e detalhes em "Saiba mais".
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### I6 — COD4354 · Casa nova no Palmital (Zona Norte)
- Foto: `https://tshhasbbchjcvhoyizoo.supabase.co/storage/v1/object/public/property-media/cod4354-palmital/carrossel-1792087330563--lamina-02.jpg`
- Link: `https://www.matheusmachadoimoveis.com.br/empreendimentos/de60e613-c9fa-432b-b342-1f4f7e0926fe?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=cod4354`
> Casa nova no Palmital, Zona Norte de Marília, com acabamento moderno do portão até o último cômodo.
>
> 2 dormitórios, sala integrada com pé-direito alto, cozinha com planejados e bancada em granito, área gourmet, garagem coberta e porcelanato em toda a casa. Terreno de 165 m² (5,5 x 30 m).
>
> Tem carro ou outro imóvel? O proprietário estuda como parte da entrada. Veja em "Saiba mais".
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### I7 — COD4352 · Casa + edícula no Cavalari
- Foto: `https://tshhasbbchjcvhoyizoo.supabase.co/storage/v1/object/public/property-media/cod4352-cavalari/carrossel-1792068229759-fee9962b-lamina-03.jpg` (a lâmina 2 é só texto)
- Link: `https://www.matheusmachadoimoveis.com.br/empreendimentos/d0fbfae5-646c-47ec-b29f-e5b42474e099?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=cod4352`
> Duas casas em um só terreno, no Cavalari, em Marília: para morar com a família por perto ou ter uma renda extra com aluguel.
>
> Casa principal com 3 dormitórios (1 suíte), cozinha planejada, área gourmet com churrasqueira e acabamento moderno. Edícula nos fundos com 2 dormitórios e entrada independente.
>
> Fotos completas em "Saiba mais".
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

---

## Informativas a partir do dia 3 — capas dos carrosséis já publicados no Instagram (dono, 2026-10-30)
> Substituem os rascunhos antigos N3–N7 (mantidos abaixo só como histórico). Foto = capa do carrossel (1200 px, JPG). Publicar com `photo_url`.

### N3 — 5 passos para o primeiro imóvel (carrossel "Vai comprar seu primeiro imóvel?")
- Foto: `https://raw.githubusercontent.com/mhmporttes-stack/imoveis-mvp/1362e949596bf745ca01154d4fb286120b09bae7/docs/posicionamento/gmn/n3-cinco-passos.jpg`
- Link: `https://www.matheusmachadoimoveis.com.br/simulacao?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=n3-cinco-passos`
> Vai comprar seu primeiro imóvel em Marília? 5 passos para decidir com mais segurança:
>
> 1. Organize as finanças: entrada, limite da parcela e a melhor forma de pagar.
> 2. Escolha pela sua rotina: trabalho, família, escola e transporte.
> 3. Visite além das fotos: luz, ventilação, estrutura e o bairro em horários diferentes.
> 4. Considere documentos e custos: registro, certidões, IPTU, condomínio e seguro.
> 5. Comece: o primeiro imóvel é o primeiro passo para construir patrimônio.
>
> Toque em "Saiba mais" e faça a simulação para saber quanto você pode financiar.
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### N4 — Quitar antes do prazo (carrossel "Financiar e pagar 2 imóveis? Tô fora")
- Foto: `https://raw.githubusercontent.com/mhmporttes-stack/imoveis-mvp/1362e949596bf745ca01154d4fb286120b09bae7/docs/posicionamento/gmn/n4-quitar-antes.jpg`
- Link: `https://www.matheusmachadoimoveis.com.br/simulacao?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=n4-quitar-antes`
> Financiar e pagar 2 imóveis no final? Na prática, quase ninguém precisa pagar os 30 anos.
>
> Num financiamento de R$ 200 mil em 30 anos, o total pago passa de R$ 420 mil. Com 3 atitudes, o prazo cai bastante:
> • Metade do 13º todo ano para amortizar: cerca de 24,7 anos.
> • Mais R$ 100 por mês: cerca de 21,5 anos.
> • Mais o FGTS a cada 2 anos: cerca de 14 anos, com uns R$ 113 mil a menos de juros.
>
> Simulação ilustrativa: SAC, 7,66% ao ano, sem seguros e taxas. O uso do FGTS segue as regras do Fundo e do banco.
>
> Toque em "Saiba mais" e simule o seu caso.
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### N5 — Registrato: o que os bancos veem sobre você (carrossel "Como consultar o Bacen")
- Foto: `https://raw.githubusercontent.com/mhmporttes-stack/imoveis-mvp/1362e949596bf745ca01154d4fb286120b09bae7/docs/posicionamento/gmn/n5-registrato.jpg`
- Link: `https://www.matheusmachadoimoveis.com.br/simulacao?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=n5-registrato`
> Você sabe o que os bancos veem sobre você antes de aprovar um financiamento?
>
> O Registrato, do Banco Central, mostra dívidas, empréstimos e limites de crédito no seu CPF. A consulta é gratuita e feita pelo celular, com a conta gov.br (prata ou ouro).
>
> No site do Banco Central, entre em "Empréstimos e Financiamentos (SCR)", solicite o relatório e baixe o PDF. Se aparecer algo que você não reconhece, dá tempo de resolver antes de pedir o financiamento.
>
> Toque em "Saiba mais" e faça a sua simulação.
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### N6 — Erros que fazem continuar no aluguel (carrossel de mesmo nome)
- Foto: `https://raw.githubusercontent.com/mhmporttes-stack/imoveis-mvp/1362e949596bf745ca01154d4fb286120b09bae7/docs/posicionamento/gmn/n6-erros-aluguel.jpg`
- Link: `https://www.matheusmachadoimoveis.com.br/simulacao?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=n6-erros-aluguel`
> Tem muita gente pagando aluguel sem precisar. E quase nunca é só falta de dinheiro.
>
> O primeiro erro é esperar o momento perfeito: a renda, a entrada e o emprego perfeitos. Enquanto isso, o aluguel continua saindo do bolso.
>
> O segundo é procurar imóvel antes de entender o financiamento. E tem um que quase ninguém percebe: achar que comprar é só para quem ganha muito. Programas como o Minha Casa Minha Vida existem justamente para o primeiro imóvel, com condições conforme a renda.
>
> Quem compra faz o contrário: entende a renda, descobre quanto o banco libera e só então procura o imóvel. A simulação não é aprovação: a aprovação depende da análise de crédito. Toque em "Saiba mais" e comece por ela.
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### N7 — Coisas que ninguém te conta sobre o 1º imóvel (carrossel de mesmo nome)
- Foto: `https://raw.githubusercontent.com/mhmporttes-stack/imoveis-mvp/1362e949596bf745ca01154d4fb286120b09bae7/docs/posicionamento/gmn/n7-coisas-ninguem-conta.jpg`
- Link: `https://www.matheusmachadoimoveis.com.br/simulacao?utm_source=google&utm_medium=organic&utm_campaign=gmn_post&utm_content=n7-coisas-ninguem-conta`
> Coisas que ninguém te conta sobre o seu primeiro imóvel:
>
> 1. O Minha Casa Minha Vida não é só para quem ganha pouco: atende várias faixas de renda, com condições diferentes em cada uma.
> 2. O primeiro imóvel não precisa ser perfeito. Precisa caber no seu bolso.
> 3. A decisão é sua, não de quem não paga as suas contas.
> 4. Ter 3 anos de FGTS pode garantir juros menores, conforme as regras do programa.
> 5. Amortizar tira anos do financiamento.
>
> Toque em "Saiba mais" e veja quanto você pode financiar.
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

## Informativas (foto: sem foto ou imagem da marca já hospedada; nunca imagem de banco)
> N1 e N2 saíram sem foto. A partir do N3, ver a seção "Informativas a partir do dia 3" (com a capa do carrossel).

### N1 — Primeiro imóvel: por onde começar (Post 1, aprovado pelo dono em 02/10; só a assinatura foi atualizada para o nome oficial)
> Primeiro imóvel: por onde começar?
> 1) Descubra quanto você pode financiar (renda, entrada e FGTS).
> 2) Simule antes de visitar qualquer imóvel.
> 3) Separe a documentação.
> 4) Só então escolha o imóvel que cabe na sua realidade.
> A simulação é gratuita e mostra o caminho. A análise de crédito é feita pela Caixa.
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### N2 — Minha Casa Minha Vida (Post 2, aprovado em 02/10)
> Minha Casa Minha Vida em Marília: quem define as condições é a sua renda.
> O programa tem faixas de renda, e as condições mudam conforme a faixa e as regras vigentes. Não existe resposta única: depende do seu caso.
> Faça a simulação e eu explico, passo a passo, onde você se encaixa. A aprovação do crédito é decisão da Caixa.
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### (substituído) N3 antigo — Documentação (Post 3, aprovado em 02/10, conferido com as regras documentais do CRM)
> Simulação feita. E agora? O próximo passo do seu primeiro imóvel é a documentação.
>
> É a etapa em que o seu projeto ganha forma: com os documentos em dia, seguimos para a análise da Caixa. Em geral, são necessários RG (com CPF) ou CNH, comprovante de renda (holerites ou extratos, conforme a sua renda), comprovante de residência recente (conta de água, luz, internet ou telefone) e certidão de nascimento ou de casamento, conforme o seu estado civil. A lista exata depende do seu caso (renda CLT ou informal, FGTS…), e eu acompanho você em cada item.
>
> Ainda não simulou? Comece pela simulação gratuita e vamos avançar juntos.
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### (substituído) N4 antigo — FGTS (novo, rascunho)
> Dá para usar o FGTS na compra do primeiro imóvel?
>
> Em muitos casos, sim: o saldo pode ajudar na entrada. As regras do FGTS pedem, entre outras coisas, tempo mínimo de trabalho com carteira assinada (somando os períodos) e que você não tenha outro imóvel na cidade onde mora ou trabalha, nem financiamento ativo pelo Sistema Financeiro da Habitação.
>
> Cada caso tem detalhes. Na simulação eu confiro com você se o seu FGTS pode entrar e quanto ele ajuda.
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### (substituído) N5 antigo — Consultar o próprio nome antes de financiar (novo, rascunho)
> Antes de pensar em financiamento, vale saber como o seu nome aparece para os bancos.
>
> O Registrato, do Banco Central, é gratuito e mostra empréstimos, cartões e contas no seu CPF. Com essa informação em mãos, fica mais fácil organizar as pendências e chegar preparado à análise de crédito, que é feita pelo banco.
>
> Fez a consulta e ficou com dúvida? Na simulação a gente olha o seu cenário com calma.
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### (substituído) N6 antigo — Na planta ou pronto? (novo, rascunho)
> Primeiro imóvel: na planta ou pronto para morar?
>
> Na planta, a entrada costuma ser parcelada durante a obra e você espera a entrega. No pronto, você muda logo, mas precisa ter a entrada organizada. Não existe opção certa para todo mundo: depende do seu prazo, do aluguel que você paga hoje e de quanto consegue juntar por mês.
>
> Em Marília eu trabalho com as duas opções. Simule e eu mostro os caminhos para o seu caso.
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

### (substituído) N7 antigo — Custos além da entrada (novo, rascunho)
> Comprar o primeiro imóvel tem custos além da entrada, e é bom saber disso desde o começo.
>
> Em geral entram o ITBI (imposto da prefeitura) e o registro do imóvel em cartório. Os valores mudam conforme o imóvel e a cidade.
>
> Na simulação eu mostro esses custos junto com a entrada, para você planejar sem surpresa.
>
> Matheus Machado Corretor de Imóveis · CRECI 323106-F · Marília/SP

Conferência de política feita em 2026-10-29 para os 14 textos: marca oficial + CRECI; sem telefone, e-mail ou @ no texto; sem "taxa"/"aprovação garantida"/promessa de crédito; sem preço; dados só do CRM; textos todos diferentes.
