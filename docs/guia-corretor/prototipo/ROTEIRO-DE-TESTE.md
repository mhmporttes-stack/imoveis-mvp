# Roteiro de teste: virada de página (protótipo isolado)

Conteúdo de teste, nada aqui é regra do Guia. Não toca no CRM nem no banco.

## Como abrir
- `index.html` = solução própria (CSS 3D + toque). `plano-b.html` = comparação com o motor StPageFlip (precisa de internet).
- No computador: dê duplo clique no arquivo. No iPhone/Android: precisa de um endereço. A Central publica uma cópia de teste; ou, na pasta, `python -m http.server 8080` e abra `http://IP-DO-PC:8080/index.html` no mesmo Wi-Fi.
- Medidor de quadros: acrescente `?debug=1` ao endereço. Efeito e colunas: ícone de ajustes no topo (ou na capa).
- Link direto: `#exemplo/2/1` abre no capítulo 2, página 1, sem folhear. Compare os dois arquivos com a mesma sequência.

## Os 12 critérios (marque, anote)
1. **Sensação de folhear** (Realista): a folha acompanha, dobra, sombra e profundidade parecem de papel? Ou parece "painel girando"? [ ] ok [ ] meh [ ] ruim. Nota: ____
2. **Toque** (celular): passar o dedo para o lado vira a página sem precisar de força nem pontaria? Nota: ____
3. **Arraste parcial**: arraste ~metade e solte; arraste pouco e solte (deve voltar); arraste e jogue rápido (deve completar). Nota: ____
4. **Voltar**: arrastar para o outro lado, botão ‹, tecla ←. No computador, arrastar pela margem externa da página da esquerda. Nota: ____
5. **Desempenho**: com `?debug=1`, vire 10 vezes seguidas. Anote FPS e "pior quadro". Fluido = perto de 60 e pior quadro abaixo de ~25 ms. Anote: ____
6. **iPhone / Safari**: tudo acima, mais: a barra do Safari some/aparece e o livro ocupa a tela sem cortar? Nota: ____
7. **Android / Chrome**: mesmos testes. Aparelho: ____
8. **Aparelho intermediário** (o pior que você tiver): o efeito Realista engasga? O protótipo deve avisar e passar para Simples sozinho. Nota: ____
9. **Acessibilidade**: só teclado (Tab, ← →, I, /, Esc), foco sempre visível, botões grandes o bastante, leitor de tela anuncia "Capítulo, Página X de Y". Nota: ____
10. **Movimento reduzido**: ative "reduzir movimento" no aparelho. O Realista deve sumir (vira troca suave) e o botão Realista fica desligado. Nota: ____
11. **Link direto**: abra `#exemplo/3/1`, `#exemplo/2/3` e um inválido (`#exemplo/9/9`, deve avisar e abrir o índice). Nota: ____
12. **Texto selecionável**: na página "Seleção de texto", selecione e copie. No computador, o mouse seleciona no meio da página e vira a página só pela margem externa; no celular, arrastar na horizontal vira a página e segurar o dedo sobre a palavra seleciona. Na página "Rolagem vertical", role para baixo sem virar a página sem querer. Nota: ____

## Perguntas finais para você
- Realista no celular: usaria todo dia, ou prefere Simples como padrão? ____
- Compare `index.html` e `plano-b.html`: qual vira mais natural no seu dedo? ____
- Algo que travou ou irritou em 1 minuto de uso? ____

## O que eu NÃO consegui validar (só aparelho real valida)
- Testei só no Edge/Chromium sem tela física, com eventos de ponteiro simulados (mouse e toque emulado). **Nada foi rodado em Safari/WebKit nem em iPhone ou Android de verdade.**
- FPS medido no PC (60) não representa celular. O protótipo mede e recua sozinho, mas esse recuo só foi exercitado por lógica, não num aparelho lento.
- Efeito realista aqui é folha rígida em 3D com sombra (não é curva de papel). O Plano B tem dobra de canto de verdade; é o ponto de comparação.
- iPhone: arrastar a partir da borda esquerda da tela aciona o "voltar" do Safari e não é do protótipo. Comece o gesto um pouco para dentro.
- Plano B: é um **proxy** (StPageFlip 2.0.7 puro, MIT, via jsDelivr com versão fixa, só neste arquivo). O pacote real pesquisado (@gullabs/react-flipbook, fork com wrapper React) **não foi testado**. Em toque emulado o Plano B virou na direção contrária ao gesto; pode ser limite da simulação, confirme no celular. Seleção de texto e leitura por leitor de tela no Plano B não foram avaliadas.
- Não testei VoiceOver/TalkBack nem contraste medido por ferramenta (usei as cores da marca; contraste calculado a olho e por token).
