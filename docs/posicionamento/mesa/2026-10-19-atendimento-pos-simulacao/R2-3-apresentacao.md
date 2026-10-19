## Cadeira 3: Apresentação e design (Rodada 2)
Base: `origin/main`, só leitura. Não renderizei nada. Tudo o que falo de celular 360×640 é estimativa e precisa ser conferido na vitrine e passar pelo `design-critic` antes de valer.

### (a) Respostas às objeções contra a minha R1
1. **Cena nova de amortização.** Aceito. Ela entraria antes do ponto onde 29 de 33 param. Vira uma linha dentro do "Próximo passo" (hierarquia em b3).
2. **Pulsar e botão único (PRES-12).** Retiro o pulsar. É movimento e regra a mais para pouco ganho, porque a frase curta e o botão único já mostram onde tocar. Volta só se os toques mostrarem gente parada. O botão único continua precisando do "sim" do dono.
3. **"Quem te responde é {1º nome}".** Aceito sem gênero. Já estava sem "corretor/corretora". Fica assim.
4. **"Toda" na mensagem pronta (PRES-17).** Aceito. A tela, a folha e a mensagem mudam juntas.
5. **Erro meu.** Na R1, o texto da cena de documentos citava documentos ("documento com foto, comprovantes"). Isso é inventar exigência. Tirei.

### (b) O que o Atendimento deixou para eu decidir
1. **Botão de envio no painel** (`components/presentation/SimulationPresentationPanel.jsx`).
   - **O que achei:**
     - Na mesma página já existe o botão verde "Enviar simulação" (`SimulationGenerator.jsx:1386`). Ele já registra o envio: abre o Chat quando a janela de 24 h do Oficial está aberta e, se não estiver, o WhatsApp do próprio corretor só com o link.
     - No painel, o botão cheio é o "Copiar link", e copiar não deixa registro. É o caminho mais provável dos 13 links sem rastro.
   - **Decisão:**
     - O nome "Enviar pelo Chat" está errado: a maioria dos envios sai pelo número pessoal.
     - Botão principal do painel: "Enviar simulação", mesmo nome e mesmo fluxo do verde (`enviar-preparar` e `enviar-registrar`), na cor azul da marca. Um verbo só para o corretor aprender.
     - "Copiar link" e "Visualizar" ficam com contorno, nessa ordem.
     - Quando o cliente não pode receber mensagem, o botão fica desativado com o texto "Este cliente não pode receber mensagens."
     - Aviso depois de copiar: "Link copiado. Fica registrado no histórico como copiado às {hh:mm}."
   - **Conflitos com regras do dono:**
     - O painel enxuto foi decisão do dono em 19/10 ("só Copiar link e Visualizar"). Acrescentar o botão precisa do "sim" dele.
     - O T1 não pode ir junto com o link no WhatsApp pessoal. A regra de 11/10 manda só o link, para a prévia carregar. Então o T1 vai antes, como atalho.
2. **Frase de compromisso, idêntica nos dois lugares:** "Receber a lista e mandar os documentos não te compromete com a compra."
   - Entra na cena de documentos, no T4 e no T10.
   - Na cena, vem seguida de "Quem analisa e aprova é a Caixa."
   - É fato a ser confirmado pelo dono.
3. **Hierarquia do "Próximo passo", de cima para baixo:**
   1. Rótulo "Próximo passo".
   2. Título: "{Nome}, falta pouco para saber o que é possível no seu caso."
   3. Data da simulação (como hoje).
   4. Botão cheio único: "VER O QUE PRECISO PARA AVANÇAR". Pode quebrar em 2 linhas a 360 px.
   5. Logo abaixo, em letra pequena: "Mais 2 telas para pedir a sua lista de documentos."
   6. Linha de amortização, como texto tocável e não como botão. Ícone de seta para baixo e "Quer pagar em menos tempo? Com o seu 13º, a projeção de quitação cai de {N} para {X} anos. Ver estratégia". Quem é informal vê "Um valor extra por mês já encurta o prazo. Ver estratégia". Ela substitui o botão "Estratégia com amortização" e chama a mesma ação, só quando a estratégia existe.
   7. Fileira com contorno: "Agendar atendimento" e "Imóveis sugeridos". A 360 px ficam empilhados; de 390 px em diante, lado a lado.
   8. "Baixar apresentação" como link de texto.
   - **Por que não disputa com o botão:** só existe um elemento cheio, e a linha de amortização vem depois dele, como motivo para seguir, não como alternativa.
   - **O que não muda:** nenhum botão some e Agendar continua na cena (PRES-22).
4. **Bloco de identificação.**
   - Sai do "Próximo passo", para não pesar na cena que mais vaza.
   - Fica na cena de documentos e na folha da lista: "Seu atendimento: {1º nome}, equipe Matheus Machado Corretor de Imóveis · CRECI 323106-F · Av. Ipiranga, 147, Marília/SP".

### (c) Decisões das cadeiras que questiono
1. **Lançamento escalonado 1 → 4 → 8.**
   - Os itens 1 e 4 já têm medidas diferentes: concluiu ÷ abriu e pediu lista ÷ concluiu. Podem sair juntos.
   - Os itens 4 e 8 dividem a medida, mas com cerca de 16 conclusões por semana, 2 semanas dão margem de cerca de ±17 pontos. Separar não deixa nada legível e custa 3 semanas de vazamento.
   - **Proposta:** lote A = itens 1, 2, 3 e 4. Lote B = itens 8 e 9, 2 a 3 semanas depois. A linha de amortização se mede pelo próprio toque, sem depender de comparar antes e depois.
2. **"Faltam 2 telas".** Conta as cenas, mas não os toques.
   - Depois do botão vêm: a cena validar (que não tem botão), a cena de documentos, "Receber lista", a folha (dia e período), "Confirmar" e o envio no WhatsApp.
   - Prometer "2" e entregar 5 toques gasta a confiança.
   - Por isso troquei para "Mais 2 telas para pedir a sua lista de documentos", que é verdade.
   - A cena validar só repete o "próximo passo". Juntá-la à de documentos fica para depois dos dados: só 2 de 33 param nela.
3. **"Mandou por fora?" no card do cliente.**
   - O card é a tela de trabalho do corretor. Uma pergunta de sim ou não por link vira ruído e tende a ser respondida no automático.
   - Com o painel enviando pelo CRM e o "copiar" registrado, o resto deve ser pequeno.
   - Troco por uma linha discreta, sem botões, no próprio painel: "Aberto pelo cliente em {data} · envio não registrado".
   - A pergunta volta só se a consulta semanal mostrar que o problema continua.

### (d) Antes → depois em 360×640 (o `fitScene` reduz até 72%)
- **"Próximo passo".** Antes: título de 3 a 4 linhas e até 5 botões empilhados (cerca de 300 px). Isso força a redução, e o texto fica pequeno onde a pessoa decide. Depois: título de 2 a 3 linhas, 1 botão cheio, a linha de amortização e 2 botões com contorno (cerca de 250 px). A cena deve reduzir menos ou nada. Conferir também com fonte aumentada.
- **Cena de documentos.**
  - Texto antes: "Para validarmos esses valores junto à Caixa, vamos precisar montar a sua pasta. Para isso, preciso de alguns documentos."
  - Texto depois: "Para a Caixa analisar esses valores, vamos montar a sua pasta. A lista é curta e feita para o seu caso."
  - Logo abaixo, a frase de compromisso do b2, depois "Quem analisa e aprova é a Caixa." e o bloco de identificação.
  - O botão continua "Receber lista de documentos".
- **Pergunta da folha.** Antes: "Quando você acredita que conseguirá enviar toda a documentação para validarmos a sua aprovação?" Depois: "Quando você acha que consegue juntar os documentos? Se precisar, dá para mudar a data depois."
- **Mensagem pronta.** Antes: "...acredito que consigo enviar toda a documentação até {quando}. Pode me mandar a lista de documentos?" Depois: "Olá! Aqui é {nome}. Vi minha simulação e acho que consigo enviar os documentos até {quando}. Pode me mandar a lista do meu caso?"
- **Acima de "Confirmar".** "Vamos abrir o WhatsApp oficial da Matheus Machado Corretor de Imóveis. A mensagem já vai pronta, com o código do seu atendimento, e quem te responde é {1º nome}."

### (e) VERSÃO 7
| # | O que muda | Impacto × esforço | Como medir | Dono? |
|---|---|---|---|---|
| 1 | "Próximo passo" com 1 botão principal e a frase "Mais 2 telas…" (lote A) | Alto × P | Concluiu ÷ abriu, hoje 49% (n = 65), base 08–18/10 | Sim (PRES-12) |
| 2 | No mesmo deploy: toques nos botões e na linha de amortização, abertura com cookie de admin, id da cena | Alto (habilita) × M | Toque ÷ abertura por botão; % de aberturas de admin | Não |
| 3 | Textos sem "toda" na cena, na folha e na mensagem, mais a frase de compromisso única; T6 na atividade (lote A) | Alto × P | Pediu lista ÷ concluiu, hoje 14/32 | Sim (PRES-17, frase) |
| 4 | Painel com "Enviar simulação" (mesmo fluxo do verde), "Copiar link" com contorno e registrado, linha "envio não registrado"; alerta de simulação sem link | Médio/alto × P/M | Links sem evidência, hoje 13/74; p75 de simulação → link, hoje 21 h | Sim (painel enxuto de 19/10) |
| 5 | Sugestão "salvar e marcar 1º documento" quando chega mídia, mais "recebi por fora" | Alto × M | Doc com 1º documento, hoje 2/33 | Não |
| 6 | Tarefas na agenda, na ordem T6, T4, T3, e T7 depois; com teto diário e sem duplicar com a Meta Diária | Alto × M | Resposta em 48 h, só descritivo | Sim |
| 7 | Atalhos T1–T11 e T13 (T1 antes do link) | Médio × P | Uso dos atalhos; resposta em 24 h | Sim (textos) |
| 8 | Identificação com 1º nome e CRECI da empresa na cena de documentos e na folha (lote B) | Médio × P | "Golpe" no Chat; pediu lista ÷ concluiu | Sim |
| 9 | Linha de amortização no "Próximo passo", no lugar do botão de estratégia (lote B) | Médio × M | Toque na linha ÷ chegou na cena; abriu a folha → pediu lista | Sim (PRES-4/12) |
| 10 | Quem sumiu: sequência humana D+1, D+3 e D+7 úteis, fechando com o T13 | Médio × M | Retomada; pedidos de "pare" e bloqueios | Sim (prazos) |

**O que mudei**
1. Tirei o pulsar.
2. A amortização virou uma linha, sem cena nova e sem botão a mais.
3. A identificação saiu do "Próximo passo" e ficou só em documentos e na folha.
4. "Enviar pelo Chat" virou "Enviar simulação", com o mesmo fluxo do botão verde. Vi que o painel enxuto foi decisão do dono em 19/10.
5. A frase de compromisso ficou única, nos 3 lugares.
6. "Faltam 2 telas" virou "Mais 2 telas para pedir a sua lista de documentos".
7. O escalonamento em 3 passos virou 2 lotes.
8. A pergunta no card virou uma linha discreta no painel, e saiu o texto que citava documentos.

**Para a Viabilidade decidir**
- Extrair o fluxo de envio do `SimulationGenerator` para o painel reaproveitar. Registrar o "copiado" pede uma ação nova na rota `apresentacao`.
- Calcular "{N} → {X} anos" pelo motor no navegador com as opções padrão do 13º, dando o mesmo número da folha.
- Confirmar quantos dos 13 links sem rastro passaram pelo painel.
- Medir a altura real das cenas na vitrine, em 360×640 e em 390×844, depois `design-critic`.
- Dono: PRES-12, PRES-17, a frase de compromisso, o painel e a frase anti-golpe (sobre cobrança antes da análise).