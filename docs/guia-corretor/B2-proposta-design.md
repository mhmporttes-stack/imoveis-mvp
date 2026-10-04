# Guia do Corretor: proposta de design (B2)

Status: proposta (2026-10-03). Somente documento + mockups estáticos. Nada foi alterado no app. Nada publicado.
Mockups (abrir no navegador, autocontidos): `mockups/guia-mobile.html` (8 telas, 390 px) e `mockups/guia-desktop.html` (5 telas, 1280 px). Imagens renderizadas: `mockups/render-mobile.png`, `mockups/render-desktop.png`.
Todo texto dos mockups é **placeholder neutro**. Nomes de capítulos são ilustrativos; a estrutura real vem das auditorias de conteúdo. Fonte renderizada: Segoe UI no lugar de Manrope (só o ambiente de teste).

Legenda: **[DEPENDE: page flip]** = depende da recomendação do outro agente sobre a técnica de virada. **[DEPENDE: conteúdo]** = depende das auditorias de conteúdo. **[DEPENDE: dono]** = decisão de produto.

---

## 0. Resumo executivo (o que decidi e por quê)

1. **O livro é a embalagem; o caminho rápido é o índice.** Virar página é ótimo para ler em sequência e péssimo para achar. Toda consulta acontece em 3 toques: Guia, livro, capítulo (índice). A virada fica **dentro** do capítulo e entre páginas vizinhas. Nunca se "folheia" para achar algo.
2. **A capa é o cartão da Home.** Tocar no livro abre direto no **Índice**. A capa existe como página 0 (deslizar para trás), mas nunca é uma porta que atrasa.
3. **7 itens na Home, não 11:** 6 livros + 1 "estante viva" de Empreendimentos (Seção 3).
4. **Uma página = uma tela, resposta primeiro.** Resumo grande no topo (o que dizer ao cliente), depois passos, atenção, exemplo. Nada de texto corrido.
5. **Animação é camada de experiência com saída de emergência:** efeito "Realista / Simples / Nenhum" (precedente: Apple Books e Kindle), 280 ms no máximo, interrompível, `prefers-reduced-motion` = troca simples.
6. **Recentes sim; "continuar de onde parou" não; Fixados depois, com dado** (Seção 11).
7. **Honestidade de conteúdo:** só publicado aparece; pendente aparece como aviso, nunca como rascunho. Admin vê estado, fonte e última revisão em cada página.

---

## 1. Entendimento (intenção antes de pixels)

- **Quem e quando:** corretor no celular, em pé ou no WhatsApp, com o cliente esperando. Segundo uso: estudo calmo no desktop (gestor, corretor novo). O cliente final **não** usa o Guia.
- **Decisão que o Guia provoca:** "o que eu respondo agora, com segurança?". Sucesso = achar e entender em poucos segundos, sem prometer o que não vale.
- **Prioridade:** 1º achar (busca/índice) · 2º entender (resumo da página) · 3º agir (ir ao CRM, copiar, voltar ao chat).
- **Percepção:** confiança e calma ("está aqui, está validado"), não pressão. Premium e editorial, não "manual técnico".
- **Problema real:** é de **informação e velocidade de achado**, não de aparência. Por isso a hierarquia e a busca vêm antes da animação.
- **Sucesso medido depois de publicar** (pedir ao `analista-dados`): tempo da Home até a página lida; % de aberturas pelo índice × busca × recentes; buscas sem resultado (lista de conteúdo faltante).

## 2. Referências pesquisadas (princípio extraído, nada copiado)

| Fonte | O que ensina | Como uso |
|---|---|---|
| [Publitas: Flipbook design best practices](https://www.publitas.com/blog/flipbook-design-best-practices/) (resumo da busca; a página bloqueou leitura direta, 403) | Flipbook bom assume varrer e tocar, não folhear; efeito decorativo de virada e layout "de impressão" geram atrito; navegação óbvia sem instrução | Índice sempre a um toque; página desenhada para tela, não para impressão |
| [Apple Books: animação de página de volta no iOS 16.4](https://www.macrumors.com/2023/02/28/ios-16-4-apple-books-page-turning-animation/) · [Good e-Reader](https://goodereader.com/blog/e-book-news/apple-books-is-bringing-back-page-turn-animation-on-ios-16-4) | A Apple tirou o curl no iOS 16, usuários reclamaram, voltou como **escolha** (Curl, Slide, Nenhum) | Efeito escolhível por usuário, com padrão sensato |
| [Kindle: Page Turn Animation](https://www.makeuseof.com/kindle-page-turn-animation-setting/) | Animação é opcional e dá a sensação de livro real | Mesmo princípio: opcional |
| [Flipsnack: acessibilidade](https://www.flipsnack.com/accessibility) · [FlipHTML5](https://help.fliphtml5.com/docs/accessibility/) | Flipbook acessível = HTML real, teclado completo, rótulos legíveis por leitor de tela | Páginas em DOM real (texto selecionável), setas e teclas, `aria-live` na troca |
| [Readymag: princípios editoriais](https://medium.com/theymakedesign/unearthing-the-principles-behind-readymags-editorial-design-501f7b4b3877) | Tipografia expressiva guia o olhar; escala e posição criam impacto | Título grande, numeral editorial, pouca decoração |
| [Issuu: spreads](https://blog.issuu.com/better-magazine-spread-design/) · [Presspad: regras de revista digital](https://www.presspadapp.com/blog/successful-digital-magazine-design-rules/) | Spread impresso não vira celular; coluna única, espaço em branco; sem-serifa no corpo; linha 120–145% | Celular = folha única; desktop = 2 páginas; Manrope 16–19 px, linha ≈1,4 |

Limite honesto: fontes web (pesquisa de 2026-10-03) são fundamento, não evidência do **nosso** corretor. A validação é o piloto com 3 a 5 corretores (Seção 17).

## 3. Direção: exploração e escolha

Três caminhos considerados para a **estrutura de consulta** (a forma "livro" foi pedida e é mantida):

- **Segura:** lista de tópicos com acordeões (é o Manual de hoje). Rápida, mas é "documentação técnica" e não tem a experiência pedida.
- **Moderna (escolhida):** livros como **capas tipográficas** (azul e branco, marinho como palco), índice como porta principal, páginas curtas de uma tela, virada como camada opcional. Premium sem ser decorativo.
- **Ousada:** livro 100% de folhear (sem índice dominante, estilo revista de bolso). Bonito, lento para achar. **Descartada** por contrariar "consulta ultrarrápida".

**Divergências do pedido (com motivo, uma frase cada):**
1. Pedido sugeria "capa" como primeira página; proponho a **capa viver na Home** e o livro abrir no índice, porque uma capa em cada consulta custa 1 toque e 1 segundo, centenas de vezes por mês.
2. Pedido sugeria até 11 cards; proponho **7**, porque cada item a mais na Home é uma decisão a mais com o cliente esperando.
3. "Livro aberto 2 páginas" no desktop só funciona se a esquerda tiver função; proponho **abertura do capítulo montada dos metadados** (sem texto extra para escrever).

### 3.1 Auditoria do agrupamento (11 sugeridas para 7)

Critério: livro tem de 3 a 9 capítulos; o corretor procura pela palavra que o cliente disse (por isso a busca e os subtítulos nas capas mostram FGTS, Subsídios etc.).

| Sugerida | Destino | Razão |
|---|---|---|
| MCMV | **01 MCMV** | O programa em si |
| Rendas | **02 Rendas** | Assunto frequente e profundo |
| Documentação | **03 Documentação** | Já tem tópico no Manual |
| FGTS · Benefícios e Subsídios · Simulação | **04 Dinheiro da compra** (capítulos FGTS, Subsídios, Entrada, Simulação) | Três pequenos que o corretor consulta juntos ("com o que o cliente compra"); isolados dariam livros de 1 a 3 capítulos |
| Aprovação e Financiamento · Jornada do Cliente | **05 Aprovação e jornada** | Aprovação é uma etapa da jornada; mesma linha do tempo |
| Atendimento · WhatsApp e Comunicação | **06 Atendimento** | Mesma situação de uso (a conversa) |
| Empreendimentos | **07 Empreendimentos (estante viva)** | Tipo diferente: dado do cadastro + foto |

**[DEPENDE: conteúdo]** Regra de ajuste: se a auditoria mostrar que FGTS (ou Simulação) tem 4+ capítulos próprios, ele vira livro 04b; Home passaria a 8 itens (ainda aceitável). Se um livro tiver menos de 3 capítulos, funde com o vizinho.
**[DEPENDE: dono]** O dono confirma o agrupamento depois das auditorias.

### 3.2 Relação com o que já existe (evitar duplicar)

- **Manual do CRM** (`app/admin/manual`, `lib/manual-*.mjs`) = "como o CRM funciona hoje" (onde clicar). **Guia** = "o que dizer e o que vale" (conhecimento do negócio, MCMV, rendas). Sobrepõem-se em Simulação, Documentação e Jornada. Recomendo **uma casa por informação**: o Guia explica o assunto; o Manual explica a tela; cada página tem o link "Ver no Manual" (e o inverso). Não copiar texto.
- **Guia de Atendimento** (`app/admin/guia-atendimento`, árvore de decisão ao lado do Chat) já existe e usa o nome "Guia". **[DEPENDE: dono]** Risco de confusão de nome. Opções: manter "Guia do Corretor" e renomear a árvore na interface para "Roteiro de atendimento"; ou nomear o novo "Guia de Consulta". O livro 06 Atendimento **aponta** para a árvore, não a duplica.
- Regras do Manual valem aqui: nasce vazio para a equipe, Rascunho → Aguardando → Publicado, **só o dono aprova/publica**, audiência filtrada **no servidor**, e a guarda de confidencialidade (`lib/manual-guard.mjs`) continua barrando conteúdo sobre capacidades administrativas.

## 4. Home (cartões por assunto)

**Quantos:** 7 (6 capas + 1 faixa larga de Empreendimentos). Ver mockups M1 e D1.

Zonas, de cima para baixo (celular):
1. Cabeçalho: voltar ao Manual; selo "Guia do Corretor"; pergunta "O que você precisa saber agora?".
2. **Busca** grande (campo de 52 px). É a ação principal.
3. **Recentes** (até 3, lista simples com "Livro › Capítulo" e página). Some se o usuário nunca abriu nada.
4. **Livros:** grade de 2 colunas; capa de 118 px de altura. Última linha: faixa larga de Empreendimentos com foto.

Por que não é "kit de card SaaS": a capa é um objeto com identidade (lombada, número editorial, título grande, uma só cor de marca: marinho) e **sem ícone, borda e sombra decorativas repetidas**. Uma família de cor evita que a cor pareça significar algo (testei um ritmo de 4 tons de azul; a crítica leu como painel colorido e descartei). Os 6 livros ficam acima da dobra (a faixa de Empreendimentos aparece cortada e funciona como pista de rolagem).
Ordem: da conversa (MCMV, Rendas, Documentação, Dinheiro, Aprovação, Atendimento). **[DEPENDE: dono/dados]** Reordenar por uso real depois do piloto.
Desktop: pergunta + busca + recentes à esquerda; estante 3 × 2 + faixa larga à direita.

## 5. Capa

- Marinho `#031D3A` com o **símbolo/logo oficial** (branco do M exige fundo escuro: ok), título do livro grande, número editorial, subtítulo (ex.: "FGTS · Subsídios · Entrada"), data da última revisão do livro. Padrão geométrico de linhas diagonais é geometria própria (não deriva da logo).
- Na Home a capa é só o cartão. A capa "cheia" (com logo) aparece ao deslizar para trás a partir do índice, no desktop (livro fechado) e em impressão/compartilhamento. **Nunca bloqueia.**
- Logo: usar os arquivos de `public/assets/matheus-machado-*` sem recolorir; margem livre ≥ largura de um traço do M.

## 6. Índice (a um toque, de qualquer página)

- **Celular:** tela de índice ao abrir o livro (M2). Dentro do livro, o botão **Índice** na barra inferior abre uma folha de baixo com os capítulos do livro, o atual marcado "Você está aqui" (M4) e o atalho "Todos os livros". Pular de capítulo **não** anima virada.
- **Desktop:** abas à direita do livro (capítulos, a atual destacada) + botão Índice + tecla `I` (D2).
- Estrutura da linha: número editorial, título, 1 linha de apoio, número da página (tabular). Capítulos em validação ficam num grupo recolhido "Em validação (n)" ao final, sem link para rascunho (Seção 12).
- Hierarquia: Livro, Capítulo, Página. O índice lista capítulos (não páginas) para ficar curto; as páginas aparecem na abertura do capítulo.

## 7. Capítulo

- **Celular:** sem página de abertura separada (seria um toque e uma virada sem informação). O capítulo começa direto na página 1, que mostra "Livro · Capítulo" no cabeçalho corrente.
- **Desktop (2 páginas):** a esquerda do primeiro spread é a **abertura do capítulo**: numeral grande (2.2), título, "para que serve" (1 linha) e lista das páginas com número (D2). É **montada dos metadados** do capítulo (título, resumo, títulos das páginas), sem texto novo a escrever.

## 8. Página de conteúdo

Blocos curtos, nesta ordem (M3). O autor escolhe quais usar; resumo é obrigatório.

| Bloco | Função | Forma |
|---|---|---|
| Cabeçalho corrente | Onde estou | "LIVRO · CAPÍTULO" + "1 / 3" |
| Título | Assunto da página | 28 px, 800 |
| **Resumo** | A resposta (o que dizer) | 18,5 px, sem caixa, 1 a 2 frases |
| Passo a passo | O que fazer | Lista numerada, até 5 itens |
| **Atenção** | Erro comum / não prometer | Faixa âmbar com **ícone + rótulo** (não só cor), 1 a 2 frases |
| Exemplo | Situação concreta | Bloco azul-claro, rótulo "Exemplo" |
| Rodapé | Confiança | "Fonte · Revisado em · Ver no Manual" |

**Limites editoriais (para o validador no editor):** ~120 palavras, no máximo 4 blocos, resumo ≤ 2 frases, passos ≤ 5. Passou disso, quebrar em outra página. Tabelas não são bloco da página (dado tabular vira lista curta ou página própria "Comparativo", sem dominar).
**Página que não cabe:** com texto ampliado (200%) a folha rola por dentro com esmaecimento no rodapé; a regra de limites evita isso no tamanho normal.
Folha com camadas atrás (borda de páginas empilhadas) dá a ideia de livro sem custo de leitura.

## 9. Virada de página (especificação de movimento)

**[DEPENDE: page flip]** A técnica (biblioteca, canvas, CSS 3D) é decisão do outro agente e do dono (dependência nova exige aprovação). Esta seção fixa **o comportamento** que qualquer técnica deve entregar.

- **Propósito (por que animar):** orientar (de onde veio e para onde vai) e dar sensação de qualidade na leitura sequencial. Não animar navegação "por salto".
- **Quando anima:** só páginas vizinhas (anterior/próxima), por arraste, toque nos botões, teclas, clique nas laterais (desktop). **Não anima:** índice, busca, recentes, link do Manual, abrir livro. Esses fazem troca direta ou fade de 120 ms.
- **Arraste (celular):** a folha acompanha o dedo (rotação em torno da lombada, perspectiva suave), levanta, dobra e projeta sombra; a próxima já está montada embaixo (M6). Passou de ~30% do arraste ou velocidade suficiente: completa; senão volta. Direção travada: movimento horizontal domina o vertical (a rolagem interna não conflita).
- **Toque:** botões "Anterior/Próxima" completam em **≤ 280 ms**. Interrompível em qualquer ponto.
- **Desktop:** livro aberto 2 páginas; canto dobrado convida a arrastar; clique nas laterais; setas; teclado.
- **Custo:** só `transform` e `opacity`; `will-change` apenas durante o gesto; renderizar a página atual ± 1; imagens `lazy`; meta: 60 fps em Android intermediário. Sem handler de scroll pesado.
- **Efeito escolhível:** "Realista / Simples (deslizar) / Nenhum", salvo por usuário. Padrão: Realista, **exceto** se `prefers-reduced-motion` (então Simples) ou se o aparelho perder quadros (fallback automático para Simples). O Apple Books foi obrigado a reintroduzir essa escolha.
- **Prioridade:** a animação nunca pode atrasar a consulta. Se o teste de desempenho no celular fraco falhar, o padrão vira Simples em mobile e Realista só no desktop.

## 10. Busca global

- **Resultado:** `Livro › Capítulo › Página` + título da página + trecho com termo marcado (M5, D3). Toque/Enter abre **direto na página**, termo destacado e chip "Voltar aos resultados".
- Disponível na Home (campo grande), em qualquer página (ícone no topo; tecla `/` ou `Ctrl K` no desktop). Mínimo 2 caracteres; tolerante a acento e maiúscula; ordena título antes de corpo.
- **Sem resultado:** "Nada encontrado para '…'. Tente uma palavra mais curta." + "Todos os livros". Opcional: "Avisar a gestão que preciso disso" (**[DEPENDE: dono]** exige endpoint; mede lacuna de conteúdo, ver Seção 15).
- Servidor: busca e audiência por perfil **no backend** (mesmo padrão `/api/admin/manual/search`); pendente/rascunho nunca entra no índice de busca do corretor.
- Back do navegador: virar página **não** cria entrada de histórico (`replaceState`); abrir livro e abrir resultado criam. Link profundo: `#livro/capitulo/pagina` (mesmo padrão do Manual), compartilhável.

## 11. Recentes, Fixados, "Continuar de onde parou" (avaliação)

| Recurso | Ajuda de verdade? | Recomendação |
|---|---|---|
| **Recentes** | Sim: o corretor repete as mesmas consultas; 1 toque na Home | **Fazer (v1).** Últimas 3 a 5 páginas, automático |
| **Continuar de onde parou** | Pouco: a consulta é pontual, não leitura de livro. O que ajuda ("voltar ao que eu lia") é o Recentes e restaurar a página ao voltar do Chat | **Descartar como recurso separado.** O 1º item de Recentes já cumpre; manter só restauração de estado ao voltar |
| **Fixados (favoritos)** | Provável para as 5 consultas do dia, mas custa decisão e manutenção | **v1.1, só se o dado mostrar repetição** (Recentes cheio dos mesmos itens). Máx. 8, ícone de fixar na página |

Armazenamento v1: **no aparelho** (localStorage), sem banco e sem dado pessoal no servidor; não sincroniza entre aparelhos (aceitável no piloto). **[DEPENDE: dono]** Sincronizar entre aparelhos exige tabela por usuário (`crm-editor`).

## 12. Empreendimentos: livro vivo

**Princípio:** páginas **automáticas** do cadastro (dado) + páginas **editoriais** (como apresentar), com origem visível. Nunca inventar dado: campo vazio **some** (não mostra "sem dado" ao corretor).

- **Estante (livro 07):** lista de empreendimentos publicados no cadastro, com foto, região, nº de páginas (M8). É o único lugar onde foto + cartão se justificam (o item **é** visual). Filtro por nome/região.
- **Livro do empreendimento (M9, D4):** capa com foto + nome + região (cadastro). Páginas: Visão geral · Tipologias · Diferenciais · Região · Fotos (automáticas) · "Como apresentar" (editorial, passa pelo fluxo de validação).
- **Origem visível:** rodapé "Dados do cadastro · atualizado em dd/mm · Abrir ficha completa". Selo "Editorial" nas páginas escritas pela equipe. Nos mockups, chips tracejados marcam o campo de origem (só para o dev; não vão para produção).
- **Preço, subsídio e condição comercial:** só exibir se vierem do cadastro com data; senão remeter à ficha. Nunca em texto editorial solto, porque envelhece.
- **Tipologias:** lista curta (ex.: dormitórios · área), não tabela.
- **Dados do cadastro hoje (leitura de `lib/properties.js`):** `name, builder, location, region, status, type, price, delivery, area, bedrooms, features_json, photos_json, sales_text, is_published`. **Não há campo estruturado "tipologias"** (só `bedrooms`/`area` em texto): **[DEPENDE: conteúdo/crm-editor]** decidir se basta ou se vira campo. `internal_notes` **nunca** entra no Guia sem decisão (campo interno).

## 13. Estados vazios e "Conteúdo pendente de validação"

| Situação | O corretor vê |
|---|---|
| Guia inteiro sem publicado (nasce vazio) | Home com mensagem "O Guia ainda está sendo preparado" + atalho ao Manual; **sem** capas vazias |
| Livro sem nenhum capítulo publicado | Capa em cinza com chip "Em validação"; abre página explicativa |
| Capítulo/página sem publicado | Grupo recolhido "Em validação (n)" no índice; a página mostra M7: ícone de relógio, chip "Em validação", **"Conteúdo pendente de validação"**, 2 frases de explicação, "Voltar ao índice", "Enviar aviso ao meu gestor" (com confirmação) |
| Busca sem resultado | Seção 10 |
| Empreendimento sem página editorial | Páginas automáticas normais; "Como apresentar" não aparece |
| Erro de rede | "Não deu para abrir agora. Tentar de novo" + último conteúdo em cache, se houver |
| Offline | Mostrar o que está em cache com aviso "Sem conexão" (**[DEPENDE: dono/dev]** cache no service worker; recomendo pela realidade de sinal em visita) |
| Sem permissão (audiência) | Capítulo simplesmente não existe para esse perfil (filtro no servidor); sem "bloqueado" |

Regra: **nunca** mostrar texto de rascunho/aguardando ao corretor, nem como "prévia".

## 14. Mobile (prioridade) e desktop

| | Celular (360–430) | Desktop (≥1024) |
|---|---|---|
| Unidade | Folha única, ocupa a tela | Livro aberto, 2 páginas (1040 de largura no máx.) |
| Navegação | Barra inferior: Índice · ‹ · n/total · › · Buscar (alvos ≥ 44; botão próxima 56) | Setas laterais, abas de capítulo, teclado, canto dobrado |
| Ação principal | Próxima página (polegar direito) | Clique lateral / seta |
| Índice | Folha de baixo | Abas à direita + botão |
| Busca | Tela cheia | Paleta `Ctrl K` |
| Densidade | Resumo 18,5 px, corpo 16 px | Resumo 19 px, corpo 16 px |

Larguras a validar na implementação: 360, 390, 768, 1280, 1440. Entre 768 e 1023: folha única centralizada (2 páginas só a partir de 1024). Sem rolagem horizontal da página. Áreas seguras (`safe-area-inset`) na barra inferior. Dentro do PWA a barra do livro **substitui** a barra inferior do CRM enquanto o livro está aberto (evita duas barras); o botão voltar leva à Home do Guia.

## 15. Acessibilidade e reduced-motion

- **Semântica:** cada página é uma região com `h1` (título do capítulo) e `h2` (página); apenas a(s) página(s) visível(is) ficam na árvore de acessibilidade (`inert`/`aria-hidden` nas demais). Texto real, selecionável (copiável para o Chat), nunca imagem de texto.
- **Teclado:** `←/→` e `PageUp/PageDown` viram; `Home/End` primeira/última do capítulo; `I` índice; `/` ou `Ctrl K` busca; `Esc` fecha folha/paleta e devolve o foco ao disparador. Foco visível ≥ 3:1, nunca coberto pela barra.
- **Leitura de tela:** após virar, `aria-live="polite"` anuncia "Página 2 de 3, Renda informal" e o foco vai ao título da página (sem rolar). Botões com nome ("Próxima página").
- **Alternativa ao gesto:** todo arraste tem botão de toque equivalente.
- **Alvo ≥ 44 px; texto ≥ 12 px; zoom 200%** sem perder função (a folha rola por dentro). Estado nunca só por cor (Atenção = ícone + rótulo; status = texto).
- **Contraste medido** (razão): texto `#0B1B2E`/branco 17,4 · secundário `#475569`/branco 7,6 · rótulo azul `#2D62AE`/branco 6,05 · branco/marinho 16,9 · branco/azul-profundo `#0B3A73` 11,3 · branco/azul da logo `#3673C2` 4,79 (só texto grande/negrito, ok nos títulos das capas) · `#8DB4EA`/marinho 7,9 · `#6B4A00`/âmbar-claro 7,4 · `#475569`/fundo cinza `#E9EEF5` 6,5. A linha âmbar da faixa Atenção (1,8:1) é só decoração: a informação está no texto e no ícone.
- **Reduced-motion** (`prefers-reduced-motion: reduce`): efeito = **Simples**: troca instantânea ou fade ≤ 120 ms, **sem** deslocamento, sem paralaxe/dobra, a folha não acompanha o dedo (o gesto continua mudando de página pelo limiar). Sem animação de abertura de livro. Usuário pode escolher Nenhum.
- **Idioma:** `pt-BR`; siglas (MCMV, CCA, FGTS) explicadas na primeira vez no livro **[DEPENDE: conteúdo]**.

## 16. O que o administrador vê (D5)

Mesmo livro, com camada de gestão (rota de gestão do Manual, perfil admin/gestor; só o dono publica):
- **Faixa de saúde** em uma linha: publicadas · aguardando · rascunhos · revisão vencida (não é dashboard: 1 linha, serve para decidir o que fazer).
- **Árvore Livro › Capítulo** com chip de estado: **Rascunho / Aguardando aprovação / Publicado / Revisão vencida** (texto + cor).
- **Página real em pré-visualização** ("como o corretor vê"), com faixa âmbar quando não for publicada.
- **Painel da página:** estado em 3 passos (Rascunho, Aguardando, Publicado), **Fonte** (auditoria de conteúdo + nome do relatório, ou "Cadastro" nas automáticas), escrito por/aprovado por + datas, **Última revisão** e **revisar até** (conteúdo de regra de programa envelhece), visível para (perfis), versão (histórico só admin).
- **Ações:** Editar (vira rascunho; o publicado continua no ar até nova aprovação, como no Manual), Enviar para aprovação; **"Aprovar e publicar · só o dono"** desabilitado com motivo para os demais.
- **Além do pedido:** lista "Buscas sem resultado" (termos mais procurados e não encontrados): é a fila de conteúdo a escrever **[DEPENDE: dono/crm-editor]** (registro de buscas).
- Páginas automáticas de empreendimento não têm rascunho: seguem o cadastro e mostram "Fonte: cadastro".
- Perfis: admin e gestor veem a camada de gestão (gestor só do que o dono liberar **[DEPENDE: dono]**); corretor e associado só leem o publicado do seu público.

## 17. Além do pedido (recomendações)

1. **Ajuda contextual:** da ficha do cliente, "Entender isto" abre a página certa (ex.: documento pendente abre Documentação › Pendências). Há `ManualHelpLink`; reaproveitar. É o maior ganho de uso, sem esforço de design.
2. **Abrir como gaveta sobre o Chat** (como o painel do Guia de Atendimento) para o corretor não sair da conversa. Fase 2.
3. **"Copiar resumo"** na página: útil, mas o texto é escrito para o corretor, não para o cliente. Só liberar para páginas que tragam um bloco "Mensagem sugerida" validado.
4. **Cache offline** do Guia publicado para visita em lugar sem sinal.
5. **Piloto antes de publicar:** 3 a 5 corretores, 5 tarefas cronometradas ("achar Renda informal", "achar documento X"), no celular. Critério: mediana ≤ 10 s da Home à página.

## 18. Especificação para implementação (handoff, sem tocar em `lib/` aqui)

Para `crm-editor` (depois da aprovação do dono):
- Modelo: `guide_books` (slug, título, ordem, tom de capa), `guide_chapters`, `guide_pages` (blocos estruturados: resumo, passos[], atenção, exemplo, `source`, `reviewed_at`, `review_due`, `audience`, `status`, `version`). Estados e aprovação iguais ao Manual (reuso do núcleo `lib/manual-*.mjs` onde couber).
- Busca: endpoint análogo ao do Manual, devolvendo `{livro, capitulo, pagina, trecho}` já filtrado por perfil/estado.
- Empreendimentos: leitura de `properties` publicados; mapeamento campo→bloco (Seção 12); definir o campo de tipologias.
- Registro de busca sem resultado (opcional) e "Avisar a gestão" (opcional).
- Front (design review depois): componente de livro com 3 modos de efeito, `usePrefersReducedMotion` existente, sem biblioteca nova sem aprovação do dono.

## 19. Revisão visual feita

Renderizado em Chrome headless (sem login, dados fictícios; HTML estático em `mockups/`): mobile 390 px, 8 telas; desktop 1280 px, 5 telas; 3 rodadas de olhar e corrigir. Corrigi: fontes que não aplicavam (peso/escala), capas altas demais (Home mostrava 4 livros; agora 6), título cortando na capa, abas do livro cortadas no desktop, páginas cortadas no rodapé do livro, tela de virada com topo cortado. Larguras 360/768/1440 e estados de foco/hover **não** foram renderizados (proposta); entram na validação da implementação. Limite: **o movimento não é verificável em imagem estática**; a tela M6 só mostra um quadro do arraste. A sensação de virada só se valida em protótipo funcional no celular **[DEPENDE: page flip]**.

### 19.1 Crítica independente (design-critic)

Crítica independente rodada sobre a 1ª versão renderizada. Veredito: **aprovado com ajustes**. O que foi acatado e corrigido (e renderizado de novo):
- **Home colorida demais** (lia como painel; capa clara parecia desabilitada): agora **uma só família** (marinho), livros diferenciados por número e título; capa mais alta para o título longo caber; faixa de Empreendimentos aparece cortada como pista de rolagem.
- **Cabeçalho repetido na página** (barra do topo + rótulo dentro da folha): removido o rótulo interno no celular; **resumo ganhou barra lateral azul** para se destacar do corpo.
- **Folha do índice** ocupava demais: reduzida a ~54% da tela.
- **Botão desabilitado** (anterior/próxima nas pontas e em 1/1): agora apagado e sem preenchimento, claramente diferente do ativo.
- **Pendente:** ícone e selo duplicados: ficou só o selo; botão "Enviar aviso ao meu gestor" (diz a consequência; exige confirmação ao enviar).
- **Empreendimentos (lista):** deixou de ser card por item; linhas com foto e divisor.
- **Desktop:** abas sem corte, texto da página direita maior, abertura do capítulo mais legível; D5 (admin) com tipografia maior.
Não acatado (com motivo): trocar o desktop por coluna única de leitura. Mantive o livro de 2 páginas porque foi pedido e porque a esquerda traz o capítulo; **fica como alternativa a testar no piloto** (o crítico observa que o desktop é onde o efeito mais arrisca virar enfeite).
Não verificado pelo crítico: contraste em pixel (eu medi os pares na Seção 15), animação, texto real longo, modo escuro.

## 20. Decisões e dependências

**DECISÃO NECESSÁRIA (dono):**
1. Agrupamento em 7 itens (vs. 8 ou 11) depois das auditorias de conteúdo.
2. Nome: "Guia do Corretor" convive com o "Guia de Atendimento" (árvore do Chat). Manter, renomear um deles ou outro nome.
3. Efeito de virada **Realista como padrão**, com Simples/Nenhum à escolha e fallback automático. Alternativa: padrão Simples no celular.
4. Fixados e sincronização entre aparelhos (precisa de tabela): agora ou depois do piloto.
5. Quem vê a camada de gestão além do admin (gestor?).

**Dependências:** técnica de virada (outro agente; biblioteca nova = aprovação do dono) · conteúdo e nomes de capítulos (auditorias) · campo de tipologias e lista de campos do cadastro permitidos · modelo de dados e busca (`crm-editor`).

**Riscos:** (1) animação cara em celular fraco: mitigado com 3 modos e fallback. (2) conteúdo de regra do programa desatualiza: mitigado por "revisar até" e faixa de revisão vencida. (3) duplicar o Manual: mitigado por link, sem cópia. (4) preço/condição de empreendimento envelhecer: só do cadastro, com data.
