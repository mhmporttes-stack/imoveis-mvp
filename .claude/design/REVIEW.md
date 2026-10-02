# REVIEW — design review e Visual QA (obrigatório em trabalho visual relevante)

Não aprove interface, PDF ou imagem **lendo código**. Veja o resultado **real renderizado**. Quem criou não é o melhor juiz: para trabalho importante, use crítica independente (`design-critic`).

## 1. Quando fazer o quê

| Tamanho | Revisão |
|---|---|
| Trivial (ajuste local) | Olhe o trecho renderizado em 390 e 1280; checklist §3 só nos itens afetados. |
| Relevante (tela, componente novo, peça) | Revisão completa §3 + render real §4 + autocrítica de originalidade §5. |
| Grande / estrutural / para cliente final | Tudo acima **+ `design-critic`** (§6) e aprovação do dono antes de publicar. |

## 2. Quem renderiza (peça sempre o arquivo real)

- **Interface do painel:** vitrine `app/dev/vitrine` + `node .claude/skills/design-crm/scripts/capturar-vitrine.mjs` (`revisao-visual.md` §1–2). Larguras 360/390/768/1280/1440; estados normal/carregando/erro/vazio; perfis; conteúdo realista (nomes longos, valores grandes, listas vazias); overflow; foco por teclado.
- **Página pública/qualquer URL:** navegador do projeto (`preview_start` + captura), desktop e mobile.
- **PDF:** gere o arquivo **real** com dados fictícios e rode `node .claude/design/tools/renderizar-pdf.mjs <arquivo.pdf> --saida scratch/pdf` (renderiza **todas** as páginas em PNG; precisa de `@napi-rs/canvas` fora do projeto). Avalie composição, margens, quebras de página, tipografia, hierarquia, imagens, densidade e narrativa **por página e em sequência**.
- **Imagem:** veja em tamanho real e reduzida (miniatura/celular); composição, geometria, realismo, artefatos, perspectiva, fidelidade e preservação (`IMAGING.md`/`PHOTOGRAPHY.md`).
- Apague `scratch/` ao terminar. Dado de cliente real nunca entra em captura.

## 3. Design review (responda por escrito, curto)

- **HIERARQUIA** — onde olho 1º? 2º? 3º? Sobrevive ao "apertar os olhos"?
- **COMPREENSÃO** — entendo rápido? Há ambiguidade ou termo que o público não conhece?
- **COMPOSIÇÃO** — equilíbrio, alinhamento, ritmo, espaço; algo "morto" ou apertado?
- **TIPOGRAFIA** — níveis suficientes? demais? legível no menor tamanho real?
- **DENSIDADE** — informação demais? de menos? o que dá para remover sem perder a decisão?
- **CARDS** — cada container tem função semântica? há card em card?
- **INTERAÇÃO** — ação principal evidente? feedback adequado? reversível onde cabe?
- **ACESSIBILIDADE** — contraste calculado, teclado, foco, toque 44px, reduced-motion, não só cor.
- **RESPONSIVO** — adaptado ou espremido? ordem faz sentido no celular?
- **ESTADOS** — vazio/erro/carregando/longo/curto verificados?
- **ORIGINALIDADE** — repetimos o layout antigo sem justificativa? parece template genérico?
- **COMERCIAL (se aplicável)** — benefício principal evidente? transmite valor? parece personalizado? parece material de venda profissional? (`COMMERCIAL.md`)
- **FATOS** — todo valor/regra/benefício/status confere com a fonte (nada inventado)?

## 4. Severidade e filtro

**Bloqueador** (sem ponto focal, hierarquia plana, estado ausente, quebra no celular, controle inacessível, dado errado/inventado, função perdida) · **Deve corrigir** · **Nota**. Corte gosto pessoal: se não dá para dizer *quanto custa ao usuário*, não é achado. Poucos achados de alta convicção > 40 detalhes.

## 5. Perguntas de independência criativa (obrigatórias)

1. *Isso ficou realmente bom ou apenas parecido com o que já tínhamos?*
2. *Se eu removesse a logo, isso pareceria um template genérico?*
3. *Existe personalidade?*
4. *Estamos usando algum componente só porque sempre usamos?*
5. *Qualquer dashboard/template poderia ter produzido isto?*
6. *Há oportunidade de algo mais elegante, simples ou original?*

Resposta que indique repetição ou aparência genérica → **reabra a exploração** (CORE §7: segura/moderna/ousada), não faça só polimento.

## 6. Crítica independente (`design-critic`)

O subagente `design-critic` é chamado pelo Designer (ferramenta `Agent`) ou, se ela não estiver disponível, pela Central/Despachante via `PEDIDO À CENTRAL`. Ele **não** recebe a missão de defender o Designer. Envie um brief autocontido:

```
OBJETIVO: <o que a peça precisa provocar e em quem> · PÚBLICO/CONTEXTO: <...>
RESTRIÇÕES (FATOS): <dados, regras, perfis, marca: logo+paleta, o que não pode mudar>
ARQUIVOS RENDERIZADOS: <caminhos PNG/PDF/páginas; larguras; estados> (nada de código a defender)
CRITÉRIOS DE ACEITE: <os da especificação>
PEDIDO: ache problemas; não elogie por educação; severidade + impacto + correção sugerida
```
Retorno esperado: lista de achados (bloqueador/corrigir/nota) com evidência (arquivo, região), respostas às perguntas do §5 e veredito **aprovado / aprovado com ajustes / reprovado**. O Designer decide o que acatar, justifica o que recusa e **refaz o render** após corrigir.
Não precisa de crítico para mudança trivial.

## 7. Fechamento

Registre em 3–5 linhas: o que mudou, o que foi verificado (larguras/estados/perfis/páginas), o que ficou de fora e as decisões que dependem do dono. Barra final: ponto focal claro e hierarquia que sobrevive · tipografia com tamanho+peso+cor · cor contida · uma estratégia de profundidade · ritmo · estados completos · reuso do sistema (ou desvio justificado) · mobile real · acessível · fatos corretos · **tem personalidade e não parece gerado por template**.
