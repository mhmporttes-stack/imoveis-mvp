# EDITORIAL — páginas, documentos, PDFs, informação financeira

Carregar para: PDF, apresentação, relatório, documento multipágina, tabela financeira, página de abertura. **PDF não é screenshot do CRM**: é uma peça composta para leitura (e para ser lida de relance, no celular, enviada por WhatsApp).

## 1. Pensar como editor

- **Narrativa antes de layout:** o que o leitor precisa entender primeiro, depois, por fim? Cada página tem **uma ideia**. Ordem = história, não ordem das colunas do banco.
- **Abertura (capa/1ª página):** identifica, personaliza e entrega a **mensagem principal** — o leitor decide em segundos se continua. Não é "logo + título + data" por obrigação.
- **Sequenciamento:** mensagem principal → prova/explicação → composição/detalhe → próximo passo (CTA) → informações legais/notas. Detalhe técnico vai depois da conclusão, nunca antes.
- **Ritmo:** alterne páginas densas e páginas de respiro; repita estrutura onde há comparação; um momento de impacto por documento.

## 2. Grid e composição de página

- **Formato:** A4 retrato (595×842 pt) por padrão para envio/impressão; paisagem/16:9 só para apresentação projetada. Margens ≥ 36–48 pt (impressão doméstica); rodapé reservado.
- **Grid:** 12 colunas (ou 6) com gutters constantes e **linhas-base** de 4–8 pt; módulos repetidos entre páginas. Alinhe a eixos, não a caixas. Largura de texto ≈ 55–75 caracteres.
- **Espaço:** o respiro é parte da composição; margem interna constante; o maior espaço marca a maior quebra de assunto. Proximidade agrupa sem precisar de moldura.
- **Quebras de página:** nunca separar título do conteúdo, linha de tabela do cabeçalho, número da legenda; sem viúvas/órfãs; previsão de conteúdo longo (nome extenso, 8 parcelas) sem estourar.

## 3. Tipografia editorial

- Hierarquia de **3–4 níveis** bem separados: título de página · subtítulo/lead · corpo · legenda/nota. Escala mais dramática que a do app (ex.: 40/22/11/8,5 pt).
- **Números são protagonistas:** valores-chave em tamanho grande, peso forte, `R$` e `x` menores e alinhados à linha de base, unidade/legenda pequena em cinza; milhar com ponto, vírgula decimal (padrão BR), sem casas desnecessárias (`R$ 250.000`, não `R$ 250.000,00`, salvo exigência).
- Pares tipográficos: sans para dados; serifa/display só se acrescentar autoridade ou calor; no máximo 2 famílias; entrelinha 1,3–1,45 no corpo.
- Caixa alta só para rótulos curtos com tracking; negrito com economia.

## 4. Tabelas e informação financeira

- Tabela é para **comparar**; se ninguém compara, não é tabela. Poucas colunas; números alinhados à direita com `tabular-nums` (em PDF: fonte com algarismos tabulares ou alinhamento manual); linha-base e divisores finos em vez de grade completa; zebra só se ajudar a leitura.
- **Totais e conclusões em destaque**, itens de composição em segundo plano. Mostre **de onde vem** o número em uma linha, mas depois da conclusão.
- Gráficos só quando mostram relação que a frase não mostra; rótulo direto, sem legenda distante; cor semântica coerente com a marca.
- Notas legais/condições: pequenas porém legíveis (≥ 7,5–8 pt), agrupadas, no fim da página/documento, com a validade e a fonte do cálculo. **Nunca** esconder condição que altera a decisão.
- Consistência de dados: o mesmo valor aparece igual em todas as páginas (um só cálculo no modelo).

## 5. Restrições técnicas do gerador atual (saber antes de projetar)

- A proposta é gerada por `lib/simulacao-entrada/proposta-pdf.mjs` com **pdf-lib**, desenhando em coordenadas; o **modelo de dados** vem de `presentation-model.mjs` + `calculator`. **Forma pode mudar; dados não.** Layout/estilo = pedido ao `crm-editor` por especificação (`IMPLEMENTATION.md`), com Designer fazendo a revisão visual.
- Fontes: hoje `StandardFonts.Helvetica` (sem fonte própria; conjunto de caracteres limitado). Embutir fonte de marca exige `@pdf-lib/fontkit` (**dependência nova → aprovação do dono**) e licença livre.
- Imagens: `embedPng/embedJpg`; otimize o peso (celular/WhatsApp: alvo ≲ 1–2 MB); logo em PNG transparente.
- Sem dado de cliente real em testes de design: use fixtures fictícias.

## 6. Documentos multipágina

Cabeçalho/rodapé discretos e constantes (marca, página, validade); numeração coerente; sumário só se > 6 páginas; capa e fechamento com a mesma voz. Marca em escala pequena nas páginas internas; use a logo **sem alteração**.

## 7. Checklist editorial

[ ] Mensagem principal identificável em 5 s · [ ] 1 ideia por página · [ ] números protagonistas e consistentes · [ ] tabela só se compara · [ ] quebras de página limpas · [ ] margens e rodapé · [ ] notas legíveis · [ ] funciona no celular (zoom) · [ ] imagens leves · [ ] **todas as páginas renderizadas e vistas** (`REVIEW.md` §2).
