---
name: direcao-criativa
description: "Direção criativa para peças fora da tela do CRM: PDF/proposta, apresentação, material comercial, imagem/banner/foto de imóvel, design editorial. Define a história, a hierarquia e a composição a partir do zero (layout atual é só contexto), explora direções, escreve a especificação e prepara a revisão independente. Use para \"crie a direção do PDF\", \"como contar essa proposta\", \"preciso de uma imagem para…\"."
---

# Direção criativa

Para telas e componentes do CRM use `/design-crm`. Esta skill é para **peças**: PDF, proposta, apresentação, material de venda, imagem. Não implementa nada sozinha: produz a **direção** (e a especificação para quem implementa) e conduz a verificação visual.

## 0. Carregue só o necessário

`.claude/design/CORE.md` sempre. Depois, conforme a peça (`.claude/design/README.md`): PDF/relatório → `EDITORIAL.md`; ao cliente → `COMMERCIAL.md`; imagem → `IMAGING.md` (+ `PHOTOGRAPHY.md` se imóvel); identidade → `DESIGN.md` §1–3; ao fechar → `REVIEW.md`. Nada além.

## 1. Material existente = fonte de dados, regras e restrições (não referência visual)

Se há uma peça atual (ex.: PDF "Proposta de Valores"): extraia **o que ela precisa dizer** (campos, cálculos, condições, textos legais, perfis, formatos de saída) lendo o modelo de dados (ex.: `lib/simulacao-entrada/presentation-model.mjs`, não o desenho) e, se útil, uma amostra renderizada com dados fictícios. Registre em duas listas:
- **FATOS (intocáveis):** valores, condições, regras, benefícios, textos obrigatórios, ordem legal se houver.
- **REQUISITOS FUNCIONAIS:** o que a peça precisa permitir (ex.: caber em N páginas, ser lida no celular, ser enviada por WhatsApp, variar por empreendimento/nº de parcelas).
Marque como **HERANÇA (sem obrigação):** layout, grid, cards, tipografia, tamanho, densidade, estrutura de páginas.

## 2. Perguntas de intenção (responda curto)

Quem recebe e em que momento? O que precisa **entender, sentir e fazer** depois? Qual a mensagem principal? Que objeção ou medo precisa ser desarmado? Que prova sustenta? Qual o próximo passo e o canal? Restrições (marca, legal, canal, prazo, peso do arquivo).

## 3. Exploração obrigatória (peça relevante ou para cliente)

Pergunte **"se estivéssemos criando do zero uma peça premium para esse público, como contaríamos essa história?"** Antes de olhar o desenho atual. Explore, no papel (sem implementar as três):
- **Segura** — clara e profissional, estrutura convencional bem executada.
- **Moderna** — composição editorial, tipografia e espaço fazendo o trabalho dos containers.
- **Ousada** — um conceito com ponto de vista (ex.: um único número protagonista, narrativa em atos, página de abertura em imagem + frase).
Para cada uma: ordem da história, o que lidera, estrutura de páginas, tom visual, risco. Escolha por objetivo, público, marca, clareza, diferenciação e viabilidade técnica; escreva a razão. Reabra se a escolhida parece o desenho antigo reorganizado ou um template.

## 4. Entrega: DIREÇÃO CRIATIVA (use este roteiro)

1. **Briefing** — público, momento, objetivo, mensagem principal, objeções, tom.
2. **Fatos e requisitos** — as duas listas do §1.
3. **Conceito** — a ideia em 2–3 linhas e por que serve a este comprador.
4. **História por atos/páginas** — sequência (o que cada página diz e qual dado lidera), desktop/celular conforme o canal.
5. **Hierarquia por página** — 1º, 2º, 3º olhar; o que é secundário; o que sai.
6. **Sistema visual da peça** — âncoras de marca (logo, paleta de `DESIGN.md`), tipografia (par e escala), grid/margens, tratamento de números e tabelas, uso de imagem e de cor; o que **não** repete do CRM e por quê.
7. **Direção de arte/imagem** (se houver) — briefing de imagem (`IMAGING.md` §2); fotos reais necessárias.
8. **Critérios de aceite visual** — 4–6 itens observáveis.
9. **Implementação** — o que é só forma (quem implementa, via `IMPLEMENTATION.md` §3: Especificação de Design; gerador em `lib/` → `crm-editor`), dependências a aprovar (ex.: fonte embutida → `fontkit`), riscos.
10. **Perguntas ao dono** — só decisões dele (marca, custo, dependência, conteúdo comercial).

## 5. Verificação

Depois de implementado: gerar o arquivo **real** com dados fictícios, renderizar **todas as páginas** (`node .claude/design/tools/renderizar-pdf.mjs <pdf>`), olhar página a página e em sequência, aplicar `REVIEW.md` (inclui perguntas de originalidade e comercial) e chamar o `design-critic` com o brief do `REVIEW.md` §6 (sem a ferramenta `Agent`, via `PEDIDO À CENTRAL`). Corrija, **re-renderize** e só então diga que está pronto. Sem renderizar não há aprovação.

## 6. Não faça

Não invente valor, benefício, condição ou dado; não copie a aparência de um concorrente ou marca; não redesenhe a peça sem pedido (esta skill produz direção, a implementação é outro passo); não use dado de cliente real em teste; não publique.
