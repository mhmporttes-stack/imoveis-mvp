# VISUAL — hierarquia, tipografia, grid, cor, composição

Carregar para: qualquer decisão visual (tela, peça, imagem). A hierarquia deve deixar evidente **1º onde olhar · 2º o que entender · 3º o que fazer**. Teste: aperte os olhos (ou reduza a 25%) — o ponto focal sobrevive?

## 1. Hierarquia visual

- **Um ponto focal por zona/tela.** Se tudo compete, nada lidera. Dê ao focal tamanho, peso, contraste **e isolamento** (espaço ao redor); rebaixe o resto.
- **Ferramentas de ênfase (use várias, com moderação):** tamanho · peso · cor/contraste · posição (topo-esquerda lê primeiro em LTR; centro óptico fica um pouco acima do centro geométrico) · espaço ao redor · alinhamento quebrado de propósito · movimento (último recurso).
- **Níveis de leitura:** primário (decide), secundário (explica), terciário/metadado (apoia). Distinguíveis sem ler.
- **Hierarquia de números (financeiro/comercial):** o número que muda a decisão ganha escala; o rótulo é pequeno e silencioso; a unidade (R$, x, meses) é menor que o valor; comparação ao lado, não dentro do número. Veja `COMMERCIAL.md` para a escolha do que lidera.
- **Pesos de largura/coluna são intenção** (NN/g e Carbon: grade e proporções guiam o olhar): não equalize tudo com `flex-1`; a coluna principal é mais larga que a de apoio.

## 2. Tipografia

- Poucos níveis, bem separados (razão ≈ 1,2–1,333): 12·13·14·16·18·22·28·36 no painel; peças editoriais podem usar escala mais dramática (razão 1,5+) para títulos e números-herói.
- **Hierarquia por tamanho + peso + cor**, não só caixa alta nem só `font-black`. Caixa alta + tracking só para micro-rótulo.
- Corpo: 14–16px app, 16–18px leitura; entrelinha 1,4–1,6 no corpo, 1,1–1,25 em título grande; medida de 45–75 caracteres (`max-w-[65ch]`).
- Números comparáveis: `tabular-nums`, alinhados à direita em colunas. Títulos: tracking levemente negativo, `text-wrap: balance`.
- Par tipográfico: uma sans de interface; para peça comercial/editorial, serifa ou display de apoio só com função (autoridade, calor) e licença livre (Google Fonts). Nunca mais de 2 famílias.
- Mínimos: nada abaixo de 11px; texto lido ≥ 12px; input ≥ 16px no celular.

## 3. Grid, espaço, ritmo

- **Grid:** 12 colunas (desktop), 4/8 (mobile/tablet); gutters múltiplos de 8; conteúdo de leitura ≤ ~72ch. Fundamento: grid de 8px/escala de 4 (Carbon, Material).
- **Espaço é conteúdo.** Proximidade agrupa (Gestalt): o espaço **entre** grupos > espaço **dentro** de grupos, sempre. Prefira `gap` do pai a margens soltas.
- **Ritmo:** alterne densidade (blocos compactos × respiro no focal); repita o mesmo espaçamento entre irmãos; um rompimento intencional por tela.
- **Alinhamento:** alinhe repetições para comparar; quebre só para focal, e mantenha ao menos uma linha-base. Em estreito, prefira alinhado.
- **Equilíbrio:** peso visual compensado (simétrico estático ou assimétrico dinâmico), sem canto "morto" nem vazio sem função.

## 4. Gestalt na prática

Proximidade (agrupar sem caixa) · semelhança (mesmo estilo = mesma função) · continuidade (linhas e alinhamentos guiam) · fechamento (o olho completa; dispensa borda) · figura-fundo (contraste claro entre o que é conteúdo e o que é pano de fundo) · região comum (use caixa só quando precisa delimitar mesmo).

## 5. Cor

- **Papéis:** estrutura (marinho), ação/seleção/foco (azul de marca), superfície (branco/`mist`), status (semânticas). Âncoras e valores: `DESIGN.md`.
- Cor contida e com significado: um acento (~10%), status só em semânticas, nunca cor como única pista (ícone+texto).
- Contraste AA: 4,5:1 texto normal, 3:1 texto grande (≥18px ou ≥14px bold), ícones e bordas de controle. Meça (`ACCESSIBILITY.md`).
- Fundo escuro de marca (marinho profundo) é palco para imagem e destaque; texto branco nele passa folgado, azul-logo sobre ele só para grande/gráfico (3,54:1).
- Gradiente, vidro, sombra colorida: só com razão de composição, nunca por estilo.

## 6. Superfícies e anti-cardificação

- Estrutura primeiro por **espaço, escala, alinhamento e divisores**; container só quando há **agrupamento semântico** ou objeto manipulável (item clicável, comparação lado a lado, janela flutuante).
- Evite aninhar containers. Uma estratégia de profundidade: borda fina + tom; sombra só no que flutua.
- Alternativas ao card: seção com título e régua; tabela leve; lista com divisores; "faixa" de número com legenda; bloco tipográfico grande; grade sem moldura; coluna lateral de apoio.
- Teste do container: remova a borda — a informação continua agrupada? então a borda era decorativa.

## 7. Ícones e imagem

Ícone ajuda a escanear, não decora (família única `lucide-react`, tamanhos de escala, alinhado ao texto). Imagem tem ponto focal, espaço negativo para texto e enquadramento que resiste a cortes responsivos (`object-position`, `aspect-ratio`).

## 8. Perguntas de composição (antes de fechar)

Onde olho primeiro? Segundo? Terceiro? · O que posso remover sem perder a decisão? · A densidade varia ou é monótona? · Se eu tirasse a logo, pareceria template genérico? · Estou usando este componente porque serve ou porque sempre usamos?
