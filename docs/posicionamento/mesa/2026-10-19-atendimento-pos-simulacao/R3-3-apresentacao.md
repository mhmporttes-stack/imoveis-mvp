## Cadeira 3: Apresentação e design, Rodada 3 (final)
Conferi o código em origin/main (4ec48bf1) só lendo; não editei, não renderizei e não publiquei nada. Achado que muda o "antes": hoje o "Próximo passo" tem **dois botões cheios** (VALIDAR SIMULAÇÃO e AGENDAR ATENDIMENTO) e três com contorno (Imóveis, que é o 1º da pilha, Estratégia e Baixar). Ou seja, já existem dois botões disputando a atenção onde a pessoa decide.

### (a) Respostas às objeções contra a minha R2
1. **"Mais 2 telas" tem que ser calculado pelo `buildScenes`** (Viabilidade). Aceito. Com 1 cena fica "Mais 1 tela".
2. **Trocar o texto "VALIDAR SIMULAÇÃO" muda a PRES-12.** Aceito: o novo nome entra no pedido de "sim" ao dono. Se o dono quiser manter o texto atual, a hierarquia continua valendo. O que pesa é ter só um botão cheio, não o nome dele.
3. **A linha do 13º tem que abrir a folha com o 13º já ligado** (`initialChoices`). Aceito. Sem isso o número muda entre a linha e a folha, e a pessoa perde a confiança.
4. **Item 1 e linha do 13º na mesma cena geram 2 rodadas de vitrine.** Aceito o custo. A linha fica para o lote B, para medir o botão sozinho. No lote A, "Estratégia" continua como botão com contorno.
5. **"Copiado" não é envio** (FUN-13/15f). Aceito, e a interface também mostra isso: o texto nunca diz "enviado".

### (b) Duas decisões da VERSÃO 10 que questiono
1. **O "motivo sugerido" mostra o código "T3".** "T3" é jargão interno; o corretor com pressa não sabe o que é. O motivo deve dizer o fato e a ação: "Parou no Próximo passo há 2 dias", com o botão "Ver mensagem sugerida", que abre o texto para revisar e copiar (FUN-15b).
2. **O "Recebi documentos por fora" está solto no card, para qualquer cliente.** Ele só aparece em "Aguardando documentação" sem nenhum lote salvo, como ação discreta. Pede uma confirmação curta e oferece desfazer. A marca que fica deve dizer "1º documento", nunca "documentos recebidos", porque a segunda forma sugere pasta completa e isso seria um fato falso.
3. **A meta "link aberto sem prova de envio" exposta por pessoa.** Concordo com o Atendimento: ela não deve aparecer em tela nem em ranking. A linha no painel é só um lembrete por cliente.

### (c) Especificação FINAL para o crm-editor
**1. "Próximo passo" (lote A; PRES-12)**
- **Antes:** título de 3 a 4 linhas; Imóveis (contorno), VALIDAR (cheio), AGENDAR (cheio), Estratégia (contorno) e Baixar (contorno).
- **Depois, de cima para baixo:**
  1. Rótulo "Próximo passo".
  2. Título: "{Nome}, falta pouco para saber o que é possível no seu caso." Sem nome: "Falta pouco para saber o que é possível no seu caso."
  3. Data da simulação (como hoje).
  4. **Único botão cheio:** "VER O QUE PRECISO PARA AVANÇAR". Mesma ação de hoje.
  5. Logo abaixo, nota pequena: "Mais {n} telas para pedir a sua lista de documentos."
  6. Botões com contorno, nesta ordem: Agendar atendimento, Estratégia com amortização e {Imóveis}.
  7. "Baixar apresentação" como link de texto.
- **Em 360×640:** os botões com contorno ficam empilhados, com altura mínima de 44 px, e o botão cheio pode quebrar em 2 linhas. **Critério:** a cena não pode encolher abaixo de 90% (`fitScene`). Se encolher, Imóveis vira link de texto.
- **O que NÃO muda:** as condições de exibição (`canSchedule`, `hasStrategy`, `propertiesLabel`), a ação de cada botão, nenhum botão some, e não entra animação nova.

**2. Cena de documentos (lote A; PRES-17)**
- **Antes:** "Para validarmos esses valores junto à Caixa, vamos precisar montar a sua pasta. Para isso, preciso de alguns documentos."
- **Depois:**
  - Título: "Para a Caixa analisar esses valores, vamos montar a sua pasta. A lista é curta e feita para o seu caso."
  - Nota: "Receber a lista e mandar os documentos não te compromete com a compra. Quem analisa e aprova é a Caixa."
- **O que NÃO muda:** o botão "Receber lista de documentos", a condição `canReceiveList` e "Rever a apresentação". A frase de compromisso precisa do "sim" do dono.

**3. Folha da lista (lote A)**
- **Antes:** "Quando você acredita que conseguirá enviar toda a documentação para validarmos a sua aprovação?"
- **Depois:** "Quando você acha que consegue juntar os documentos?" com a ajuda "Se precisar, dá para mudar a data depois."
- Acima de "Confirmar": "Vamos abrir o WhatsApp oficial da Matheus Machado Corretor de Imóveis. A mensagem já vai pronta, com o código do seu atendimento, e quem te responde é {1º nome}."
- **O que NÃO muda:** o calendário de 10 dias, o período e a obrigatoriedade.

**4. Mensagem pronta (lote A)**
"Olá! Aqui é {nome}. Vi minha simulação e acho que consigo enviar os documentos até {quando}. Pode me mandar a lista do meu caso?" O código do atendimento continua como hoje. A tela, a folha e a mensagem mudam no mesmo deploy, junto com os testes `documents-forecast` e `round2`.

**5. Painel do CRM (lote A; precisa do "sim" do dono sobre o painel enxuto)**
- **Antes:** "Copiar link" é o botão cheio, e "Visualizar" vem em seguida.
- **Depois:**
  - Botão cheio azul da marca: "Enviar simulação". Ele aciona a função do gerador por evento; nenhum fluxo novo é escrito.
  - Botões com contorno: "Copiar link" e "Visualizar".
  - Sem permissão de contato: o botão fica desativado com o texto "Este cliente não pode receber mensagens."
  - Aviso depois de copiar: "Link copiado. Fica no histórico como copiado às {hh:mm}."
  - Linha "envio não registrado": texto pequeno com um ponto de alerta, sem botão: "Aberto pelo cliente em {data} · envio não registrado". Se o link foi copiado: "Aberto pelo cliente em {data} · link copiado, envio não confirmado".

**6. "Recebi documentos por fora" (lote A, depois do diagnóstico dos 0 lotes)**
- Ação com contorno, pequena, no card. Só aparece em Doc sem lote salvo.
- Ao tocar, abre a confirmação: "Marcar que você recebeu o 1º documento fora do CRM? Não conta como atendimento nem como ponto." Botões [Marcar] [Cancelar].
- Depois de marcar, a etiqueta neutra "1º documento recebido por fora · {data}" e a opção "Desfazer" por 10 s.

**7. Linha do 13º (lote B; PRES-24)**
- Ela substitui o botão Estratégia. É texto tocável, com seta, e fica logo abaixo da nota "Mais {n} telas".
- Texto padrão: "Quer pagar em menos tempo? Com o seu 13º, a projeção de quitação cai de {N} para {X} anos. Ver estratégia"
- Se a pessoa já salvou uma estratégia: "Com a estratégia que você montou, a projeção cai de {N} para {X} anos."
- Sem número (informal, sem `estrategia` ou diferença menor que 1 ano): "Um valor extra por mês já encurta o prazo. Ver estratégia"
- Os números usam o mesmo arredondamento do gráfico e a folha abre com o 13º ligado.

**8. Bloco de identificação (lote B)**
- Fica só na cena de documentos e na folha, em letra pequena abaixo do botão: "Seu atendimento: {1º nome}, equipe Matheus Machado Corretor de Imóveis · CRECI 323106-F · Av. Ipiranga, 147, Marília/SP".
- Sem foto e sem gênero. Fora do "Próximo passo".

**9. Motivo sugerido (lote C)**
- Uma linha no card, abaixo do status: "{fato} há {n} dias", com o botão "Ver mensagem sugerida", que abre o texto editável e o "Copiar".
- Não ocupa a vaga de atividade, não tem cor de alerta e some quando um contato real é registrado.

**Como validar:**
- **Na vitrine** (`app/dev/vitrine/apresentacao`), montar os cenários:
  - com e sem estratégia;
  - informal;
  - sem corretor ativo;
  - nome longo;
  - 0 imóveis;
  - n = 1 e n = 2.
- **Fixture do painel:** o crm-editor cria uma fixture nova na vitrine para o painel e o card.
- **Telas:** 360×640 e 390×844, conferir a escala do `fitScene`, fonte a 130% e 200%, e movimento reduzido.
- **Depois:** captura de cada tela, minha revisão de design, em seguida o `design-critic` com o brief do `REVIEW.md` §6 e nova captura.

### (d) VERSÃO 11
| # | O que muda | Lote | Dono? |
|---|---|---|---|
| 0 | Já: conversa com as 3 pessoas e diagnóstico (só leitura) dos 0 lotes desde 06/10 | já | Não |
| 1 | Tabela de eventos (toque, equipe, cena), com a migration antes do deploy | A | Autorizar |
| 2 | "Próximo passo" com um único botão cheio e Agendar com contorno; "Mais {n} telas" calculado | A | PRES-12 |
| 3 | Textos sem "toda" na cena, na folha e na mensagem; frase de compromisso; T6 | A | PRES-17, frase |
| 4 | Painel com "Enviar simulação" (fluxo do gerador), "copiado" registrado e linha "envio não registrado"; lacuna da conversa Particular | A | Painel enxuto |
| 5 | Atalhos T1–T11 e T13 (o T11 sem falar de cobrança) | A | Textos |
| 6 | "Recebi documentos por fora": só em Doc sem lote, com desfazer; não pontua | A, depois do 0 | Sim |
| 7 | Aviso de mídia no Chat (só em Doc e sem lote) | B | Não |
| 8 | Linha 13º "{N}→{X}" no lugar do botão Estratégia, mais a identificação | B | PRES-4/12/24 |
| 9 | Tarefas e "quem sumiu" como motivo sugerido sem código T, fora da vaga; D+1, D+3 e D+7, fechando com T13 | C | As 4 regras e os prazos |

**O que mudei**
1. O "antes" do "Próximo passo" foi corrigido: hoje são dois botões cheios, então a solução é deixar um só.
2. No lote A, "Estratégia" fica com contorno; no B, vira a linha do 13º.
3. Entrou um critério visual que dá para medir: o `fitScene` não pode ficar abaixo de 90% em 360×640.
4. O motivo sugerido mostra o fato e a ação, sem código T.
5. O "Recebi por fora" aparece só em Doc sem lote, com desfazer e com o texto "1º documento".
6. O "copiado" tem texto próprio e nunca diz "enviado".
7. Itens 9 e 10 da V10 viraram um só (os dois são do lote C), o que deixa espaço para o item 0.
8. A linha do 13º fica sem número quando a diferença é menor que 1 ano.

**Decisões do dono que tocam o design:** PRES-12 (o nome do botão é opcional, um só botão cheio é o essencial), PRES-17, a frase de compromisso, o painel enxuto e o "Recebi por fora" não pontuar. Nenhuma dependência nova.