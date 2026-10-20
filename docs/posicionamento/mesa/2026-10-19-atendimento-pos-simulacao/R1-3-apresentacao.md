## Cadeira 3: Apresentação e design (Rodada 1)
Base: código em `origin/main`. O clone local está atrasado e ainda não tem a PRES-24 nem a PRES-25. Não renderizei nada: o que digo sobre o celular pequeno vem da leitura do `fitScene`, que reduz a cena até 72%. Antes de aprovar, precisa ser conferido na vitrine em 360×640.

**Diagnóstico da cena "Próximo passo"** (`PresentationPlayer.jsx`, função SceneProximo). O avanço automático para sem nenhum aviso. Aparecem até 5 botões empilhados, e 2 deles são cheios e disputam a atenção: VALIDAR SIMULAÇÃO e AGENDAR ATENDIMENTO. "Validar simulação junto à Caixa" soa como um ato formal no banco, e isso assusta quem compra o 1º imóvel. A Estratégia com amortização é o 4º botão, só com contorno, e foi usada por 2 de 72 clientes. Em celular baixo, os 5 botões fazem a cena encolher, e o texto fica pequeno justamente onde a pessoa tem que decidir.
Além disso, a folha da lista pergunta "...enviar toda a documentação para validarmos a sua aprovação?". "Toda" pesa, e "sua aprovação" sugere uma promessa.

### (a) Pesquisa
1. Um botão principal por tela. Quanto mais opções, mais demora a decisão (Lei de Hick, citada pela NN/g). No celular, cada botão vira uma decisão separada. Fontes: [Mattermost, guia de botões](https://mattermost.atlassian.net/wiki/x/AoDVhQ), [Basis](https://design.basis.com/buttons), [Pravin Kumar sobre hierarquia de botões](https://www.pravinkumar.co/blog/button-hierarchy-when-every-section-has-a-cta-2026).
2. Incerteza com número concreto quase não tira a confiança. Aviso vago ("sujeito a") tira confiança no número e em quem o mostra: [Royal Society Open Science, 2023, n = 10.519](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10663791/). Conclusão para nós: uma condição concreta funciona melhor que um selo genérico repetido.
3. O golpe do MCMV segue um padrão: promessa de "furar fila" e cobrança antecipada por Pix. A orientação é conferir pelos canais oficiais. Fontes: [Gazeta SP / ABBC "Tem Cara de Golpe"](https://www.gazetasp.com.br/economia/golpes-digitais-minha-casa-minha-vida-desenrola/), [CRECI-ES](https://crecies.gov.br/o-creci-es-alerta-os-corretores-capixabas-sobre-se-proteger-de-golpes-virtuais). O CRECI da empresa (323106-F) já é público no rodapé do site, em `lib/public-seo.js`.
4. Mostrar que falta pouco aumenta o esforço para terminar (efeito "goal-gradient", Kivetz, Urminsky e Zheng, JMR 2006). Esta fonte é de memória e não foi conferida.

### (b) Pontos em que discordo
1. **Dados, item 8 ("Próximo passo": impacto médio, esforço médio).** Para mim é impacto alto e esforço baixo. É o maior vazamento dentro da apresentação (36 de 38 param ali), e a mudança é de texto e hierarquia em um só componente.
2. **Selo "simulação" em todas as cenas de valores (pedido no brief).** Discordo. O dono vetou de forma explícita o aviso fixo de "simulação ilustrativa" (PRES-24, item 6). A pesquisa do item (a)2 mostra que aviso vago repetido corrói a confiança. A data da simulação já aparece. Proponho uma única frase concreta no ponto de decisão (item 3).
3. **Atendimento, T5 e item 7 (amortização só na conversa).** O argumento funciona melhor quando o cliente já viu a amortização. Hoje ela está escondida, então o T5 aponta para algo que quase ninguém abriu. Ela precisa aparecer no roteiro (item 5).
4. **T4, "não te compromete com nada".** "Com nada" promete demais. A apresentação e o WhatsApp devem usar a mesma frase, aprovada uma vez: "não te compromete com a compra".

### (c) Lista versão 3
| # | O que muda | Impacto × esforço | Como medir | Decisão do dono? |
|---|---|---|---|---|
| 1 | Separar a abertura do corretor da do cliente e gravar o id da cena (Dados/Atendimento, item 1). É pré-requisito dos itens 2 a 5. | Alto × baixo | Cena real de parada; % de aberturas do próprio corretor | Não |
| 2 | Refazer o "Próximo passo" com um só botão principal (detalhe abaixo) | Alto × baixo | Concluiu ÷ abriu (só cliente), 30 dias antes × depois, com IC | Sim (o texto do VALIDAR é da PRES-12) |
| 3 | Frase de segurança e texto mais leve na cena de documentos e na folha da lista | Alto × baixo | Pediu lista ÷ concluiu (hoje 14/32) | Sim (textos) |
| 4 | Identificação do atendimento, dentro da PRES-9 | Médio × baixo/médio | Pedido de lista; menções a "golpe" no Chat | Sim (1º nome do corretor no DTO) |
| 5 | Cena curta de amortização no roteiro e botão próprio | Médio/alto × médio | Uso da estratégia (hoje 2/72); pedido de lista entre quem usou e quem não usou | Sim (nova cena) |
| 6 | Cobrança gentil na data escolhida e 2ª tarefa depois de 2 dias úteis (Atendimento, item 2) | Alto × baixo | % de previsões vencidas que chegam à aprovação em 7 dias | Não |
| 7 | Marcas "1º documento recebido" e "documentação completa", com sugestão quando chega mídia (Atendimento, item 3) | Alto × baixo/médio | Doc→Aprov; dias entre as duas marcas | Não |
| 8 | Tarefas por comportamento com texto pronto (T1 a T13), atalhos do Chat e objeções | Alto × médio | Resposta e pedido de lista em 7 dias, por grupo | Sim (textos) |
| 9 | Quem não abriu ou sumiu: lembrete único pelo Oficial e sequência humana D+1/3/7 | Médio × médio | Retomada por etapa; bloqueios | Sim (se existe; prazos) |
| 10 | Alerta de simulação sem link (só horário comercial), `presentation_sent` em todos os caminhos e consulta semanal fixa | Médio × baixo | p75 de simulação → link (hoje 21 h) | Não |

**Antes → depois, com o texto exato:**

**Item 2, "Próximo passo".**
- Antes: título longo ("Agora que você conhece seu poder de compra...") e até 5 botões, 2 deles cheios.
- Depois:
  - Título: "{Nome}, falta pouco para saber o que é possível no seu caso."
  - Um único botão cheio: **"VER O QUE PRECISO PARA AVANÇAR"**. Ele leva às mesmas cenas de hoje (validar e documentos).
  - Logo abaixo, em letra pequena: "Faltam 2 telas."
  - Uma fileira só com contorno: "Agendar atendimento", "Imóveis sugeridos" e "Estratégia com amortização".
  - "Baixar apresentação" vira um link de texto.
  - Depois de cerca de 8 s parado, o botão principal pulsa 1 vez, e não pulsa se o celular pede menos movimento.
  - Nenhum botão some. Agendar continua ao lado (PRES-22), só fica menos destacado.

**Item 3, cena de documentos.**
- Antes: "Para validarmos esses valores junto à Caixa, vamos precisar montar a sua pasta..."
- Depois:
  - Texto: "Para a Caixa analisar esses valores, vamos montar a sua pasta. É uma lista curta, feita para o seu caso, com itens como documento com foto e comprovantes de residência e de renda."
  - Frase em destaque calmo: "Mandar os documentos não te compromete com a compra. Quem analisa e aprova é a Caixa."
  - O botão "Receber lista de documentos" continua com o mesmo nome.
- Folha da lista, pergunta. Antes: "...enviar toda a documentação para validarmos a sua aprovação?" Depois: "Quando você acha que consegue juntar os documentos? Se precisar, dá para mudar a data depois."

**Item 4, identificação.**
- Bloco no "Próximo passo" e na cena de documentos: "Seu atendimento: {1º nome do corretor}, equipe Matheus Machado Corretor de Imóveis · CRECI 323106-F · Av. Ipiranga, 147, Marília/SP".
- Acima de "Confirmar", na folha: "Vamos abrir o WhatsApp oficial da Matheus Machado Corretor de Imóveis. A mensagem já vai pronta, com o código do seu atendimento, e quem te responde é {1º nome}."
- O código "MM-…" deixa de parecer estranho. Continua sem telefone e sem `wa.me` no DTO.

**Item 5, amortização** (só quando o botão já existiria; entra depois da cena "Condição de pagamento").
- CLT: "Dá para pagar em menos tempo. Usando o seu 13º para abater, a projeção de quitação cai de {N} para {X} anos." Nota: "Com o 13º líquido estimado, todo dezembro." Botão: "MONTAR MINHA ESTRATÉGIA".
- Informal: "Um valor extra por mês já encurta o prazo do financiamento." Botão igual, sem número inventado.
- Os números saem do motor da PRES-24, que já está aprovado. Nenhum cálculo novo.

### O que mudei e por quê
1. O "Próximo passo" subiu para impacto alto: é o maior vazamento dentro da apresentação, e o esforço é baixo.
2. Um botão principal só, com verbo que diz o que acontece: tira a escolha travada e o medo de "validar".
3. Troquei o selo em todas as cenas por uma frase concreta na decisão: respeita o veto da PRES-24(6) e a pesquisa de (a)2.
4. Saíram "toda" e "sua aprovação" da folha: menos peso e nenhuma promessa.
5. A identificação usa o CRECI da empresa, que já é público, e o 1º nome do corretor, que a PRES-3 já permite. O CRECI de cada corretor não entra porque muitos não têm (`has_creci`).
6. A amortização ganhou uma cena no roteiro: o cliente vê o benefício antes de decidir, e o T5 passa a apontar para algo visto.
7. Juntei itens da V2 (8 com 6, 9 com 10) para caber em 10, sem perder nenhum.
8. Uma frase só sobre compromisso, igual na tela e no WhatsApp.

### O que deixo para a Viabilidade no CRM (cadeira 4)
- Custo de passar o 1º nome do corretor no DTO, mantendo a PRES-9 (sem telefone).
- Onde calcular o "{N} → {X} anos" da cena de amortização: no servidor ou no motor que roda no cliente.
- `DOCUMENTS_SCENE_TEXT` mora em `lib/`, então a troca do texto é com o `crm-editor`.
- Se renomear VALIDAR mexe em métrica ou em teste (o "concluiu" deve continuar sendo a última cena).
- O id da cena (item 1) antes de medir os itens 2 a 5.
- Conferir os itens 2 a 5 na vitrine (`app/dev/vitrine/apresentacao`) em 360×640 e 390×844, e depois passar pelo `design-critic`.
