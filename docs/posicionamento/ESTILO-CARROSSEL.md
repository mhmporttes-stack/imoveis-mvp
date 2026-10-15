# Estilo dos carrosséis de Matheus (@mhm.machado)

Aprendido dos posts já publicados (enviados pelo dono em 2026-10-11). Usado pelo `/carrossel`.

## Direção de design (pedido do dono, 2026-10-11: "mais leve, menos carregado, elegante e moderno")
Preferir o layout **editorial** (`tipo: "mito"` / `"editorial"`) a copiar a referência ao pé da letra:
- alinhado à esquerda, muito respiro, **um destaque por lâmina** (o número grande, ou a frase);
- frase/objeção em **serifa itálica** (Playfair), títulos em Inter 800, rótulo pequeno espaçado no topo ("MITO 01");
- `*palavra*` = serifa itálica azul (contraste elegante); `**palavra**` = destaque; nada de caixa alta gritando em bloco;
- texto de apoio cinza, curto (1–2 frases); CTA final como botão (`botao`).
- **Setinha "Arrasta ⟩"** no canto inferior direito de todas as lâminas menos a última (pedido do dono, 2026-10-12): `"seta": true` no topo do roteiro — usar sempre.
Versão aprovada como referência: `carrosseis/2026-10-11-mitos-mcmv-v2/`.

## Pessoa na referência → boneco (regra do dono, 2026-10-12)
Toda pessoa que aparecer numa lâmina da referência vira o **boneco 3D do Matheus** (`assets/boneco-3d/`), na pose/expressão mais parecida. Pose que ainda não existe → criar, salvar no acervo e usar, sem precisar pedir.

## Referência que é uma foto única com texto dentro (2026-10-12)
Quando o dono pedir "igual à original": editar a própria referência no Canva (`generate-image` com ela como referência), trocando só cor (laranja/amarelo → azul) e o que ele pedir (ex.: mão feminina → masculina), conferindo o texto palavra por palavra; no roteiro, `tipo: "foto"` (só põe o rodapé). Recriar em layout próprio com boneco foi reprovado ("ficou horrível").

## Rodapé (@mhm.machado)
Padrão: **sem rodapé** (dono, 2026-10-12). Ele avisa quando quiser; aí `"rodape": true` no roteiro.

## Imagem de empreendimento (regra do dono, 2026-10-12)
Fachada, torres, lazer e plantas de um empreendimento são o produto que será entregue: usar **somente a imagem original do book**, sem gerar nem editar com IA (nada de redesenhar torres). Texto sobre a foto no PDF → extrair a imagem limpa embutida (`pdfimages`). Montagem com pessoa: só recortar o fundo e compor; o olhar da pessoa vai para o prédio.

## Cor
- **Destaque hoje = azul da marca** (`#3B8BFF` no fundo preto). Os posts antigos usavam **amarelo** — ao recriar um deles, trocar amarelo por azul. Nunca voltar ao amarelo.
- **Vermelho só para palavra negativa** (regra do dono, 2026-10-12): ex. "reprovado", "recusou", "restrição" — `!!palavra!!` no roteiro. Destaque positivo/neutro continua azul.
- Fundo preto (referência de cor única) ou foto escurecida (referência com foto).

## Tipos de lâmina que ele usa (e como pedir ao gerador)
| Modelo antigo | Como recriar |
|---|---|
| Capa "Vai comprar seu primeiro imóvel?" com ele apontando à direita | `capa` + `comFoto` + `chamada` ("Guia rápido") |
| "Dica importante" com ícone de lâmpada | qualquer tipo + `icone: "lightbulb"` |
| Passo numerado "1. Organize sua vida financeira" + itens com ícones + frase final | `lista` + `numero` + `sublinhado` + itens `{icone, texto}` + `nota` |
| "POR QUE ISSO É IMPORTANTE?" (título fino em caixa alta) + subtítulo + lista | `lista` + `tituloLeve` + `subtitulo` |
| Frase com aspas grandes ("As maiores oportunidades…") com ele no canto | `citacao` + `tituloLeve` (+ `comFoto`) |
| Calendário mês → mês | `lista` com itens `**Janeiro** → Início de março` |
| "Comenta SCR que te envio o link" | `cta` + `icone: "message-circle"`; palavra-chave em `**…**` |
| Mitos (referência de outro perfil, 2026-10-11): objeção entre aspas + "Mito" grande | `texto` + `centro` + `frase` (condensada) + `selo` ("Mito", serifa itálica) + `texto`/`texto2` + `fonte`; intro com `selo: "Será mesmo?"` + `seloBranco`; fecho condensado em `fecho` |
| Capa com título grande no topo + etiqueta ("eu faria isso") + pessoa grande embaixo, centralizado | `capa` + `bonecoCentral: "<pose>"` + `chamada` + `tituloCondensado` + `etiqueta` (aprovado pelo dono em 2026-10-12: manter o layout da referência na capa) |
| Capa com a pessoa grande ao centro e título embaixo | `capa` + `fotoCentral` + `centro` + `tituloCondensado` |
| Lâmina com o Matheus em pose/expressão (pensando, pensativo, joinha, celular… — nunca surpreso) | `"boneco": "<pose>"` — boneco 3D dele em `assets/boneco-3d/` (2026-10-11) |
| Gráfico comparativo (SAC x PRICE) | ainda não automatizado — fazer como imagem (`imagem`) ou descrever em lista |

## Linguagem
- Educativo e direto: crédito, SCR/Registrato, financiamento, MCMV, primeiro imóvel.
- Gancho em pergunta; uma ideia por lâmina; termina com CTA de comentário ("Comenta X que eu te mando o link") ou "Salve este post".
- Regra/dado oficial sempre com fonte (ex.: calendário do SCR = Banco Central); sem prometer aprovação.

## Ícones
Lucide (traço fino, na cor da marca). Nomes úteis: `house`, `car`, `hand-coins`, `calendar-clock`, `file-check`, `landmark`, `calculator`, `clipboard-check`, `map-pin`, `briefcase`, `shield-check`, `key-round`, `lightbulb`, `message-circle`, `credit-card`, `wallet`, `trending-up`.

## Fidelidade e sobriedade (dono, 2026-10-13)
- **Foto nova do Matheus gerada por IA:** usar como referência principal as fotos REAIS em `assets/fotos-reais/` (ref1 = de pé na Caixa, ref2 = evento de terno azul, ref3 = close do rosto/cabelo, rosto-serio = expressão séria; o cabelo dessa última está bagunçado, usar só o rosto). Dados dele: 29 anos, magro (58 kg, 1,71 m), rosto fino e alongado, nariz reto marcado, barba curta, cabelo ondulado para trás, sorriso largo. Nunca deixar mais velho, mais largo ou mais forte. Conferir o rosto em tamanho grande antes de usar; se parecer outra pessoa, regerar.
- **Paleta sem exagero:** fundos preto/azul-marinho; azul só no destaque; evitar fundos chapados em azul ou vermelho saturado.
- **Texto curto:** uma ideia por lâmina, frases resumidas (a referência é só a ideia, não precisa copiar o texto inteiro).
- **Tipografia:** quando a referência tiver fontes marcantes, manter as fontes dela (ex.: Anton + Montserrat + Playfair itálico) e mudar só a cor (dono, 2026-10-13: "preferi as fontes da publicação original, mude apenas a cor"). Sem referência: Inter + Playfair itálico.

- **Gerador para foto do Matheus:** Runway `nano-banana-pro` 2K (3:4, recortar para 4:5) com referências marcadas (@rosto, @cabelo, @corpo, @cena) — muito mais realista que o gerador do Canva (dono reprovou a qualidade, 2026-10-13). Cabelo: ondas suaves penteadas para trás, nunca enrolado.
- **Texto atrás da pessoa** (como na referência): camadas foto → título → recorte da pessoa (`rembg`, modelo isnet-general-use).

- **Método que dá rosto fiel (aprovado pelo dono, 2026-10-13):** usar como base de identidade as fotos do acervo `assets/boneco-3d/realista/` (que o dono aprovou como fiéis) — @matheus = joinha, @matheus2 = bracos-cruzados — e pedir "o mesmo homem, mesma sessão de fotos" só trocando pose/cena (@cena = referência). Gerar a partir das selfies/fotos casuais produziu rostos diferentes; não repetir. Runway nano-banana-pro 2K, 3:4 recortado para 4:5. Comparar o rosto lado a lado com o acervo antes de entregar.
- **Fundo padrão das lâminas de texto (dono, 2026-10-13):** degradê azul com sombra, como o fundo do "ME CHAMA" — `radial-gradient(900px 760px at 50% 34%, #1F4CB3 0%, #173A8E 30%, #0E2257 62%, #08112E 100%)`; nada de fundo chapado (preto ou azul liso). Títulos em azul da marca ou branco. **Manter sempre exatamente esse degradê** (claro no meio, escurecendo para as bordas): não mudar onde fica mais claro ou mais escuro nem trocar por outro degradê (dono, 2026-10-13, comparando com a capa publicada de "Coisas que ninguém te conta").
- **Acabamento antes de entregar (dono, 2026-10-13, carrossel "aluguel ou 1º apê"):** (1) objetos que a pessoa segura (chaves, dinheiro, celular) ficam na camada da FRENTE, junto com o recorte, nunca atrás do texto nem transparentes; (2) conferir de perto os detalhes pequenos (mãos, objetos, tela do celular) em zoom; (3) objeto de baixa qualidade é substituído por outro melhor, não entregue assim. Celular nunca com tela apagada: usar `pessoa-celular-insta.png` (Instagram do dono na tela).
- **Espaço entre linhas dos títulos (dono, 2026-10-13):** acento (Ó, É, Ã) nunca pode encostar na linha de cima — títulos em Anton com `line-height` de pelo menos 1.22; conferir em zoom.
- **Logo do Minha Casa Minha Vida (dono, 2026-10-13):** sempre que a lâmina citar o programa, colocar a logo atual (sem fundo, letras brancas) pequena num canto, sem chamar atenção. Arquivo: `assets/mcmv-logo-branco.png`.

## Legenda (dono, 2026-10-13)
- **No máximo 5 hashtags** — o Instagram só permite 5; nunca entregar 6 ou mais.
- Legenda **mais longa**, que aproveite o espaço e deixe claro de que é o conteúdo (resumo dos pontos do carrossel + CTA).
- **Pular pelo menos uma linha entre os parágrafos**, para o texto ficar organizado.

## Passo a passo com prints (dono, 2026-10-14)
- **Prints reais** de cada tela (nunca tela desenhada); dados pessoais e valores sempre borrados — nunca salvar o print original com dados.
- Marcar onde clicar com contorno azul + **mão branca cheia** (Font Awesome `hand-point-right`, branca com contorno azul-marinho), **afastada** do botão (não encostar).
- Dois cliques na mesma tela: **número em quadrado azul** (degradê #4C8DF6→#1F4CB3) sobre cada mão, **uma mão de cada lado**.
- Juntar passos curtos na mesma lâmina quando a mesma tela mostra os dois cliques. Exemplo: `carrosseis/2026-10-14-registrato/`.

## Versão clara (dono, 2026-10-14)
- **Segunda paleta oficial:** fundo claro com o mesmo desenho do degradê — `radial-gradient(900px 760px at 50% 34%, #FFFFFF 0%, #F7F9FD 35%, #EAF0FA 70%, #DCE5F4 100%)`. Texto em azul-marinho `#0B1A3A`, texto secundário `#3A4A66` e destaque em azul `#1F5FD6`.
- No perfil, organizar a grade em **blocos de 3 claros e 3 escuros (azuis)**, uma linha inteira de cada (dono, 2026-10-15). Em 15/10 o bloco claro tinha só 1 post ("Termos que parecem complicados"); faltavam 2 claros.
- **Não repetir a mesma foto do dono** na capa de posts seguidos; quando o acervo se repetir, criar uma pose nova e chamativa que combine com o tema (exemplo: malabarismo com contratos). Para recortar foto com objetos soltos (papéis, chaves), usar o modelo `birefnet-general` do rembg.

## Post de imóvel: modelo padrão (dono, 2026-10-15)
Quando o dono mandar fotos de um imóvel, usar sempre este modelo. Exemplo: `carrosseis/2026-10-15-terra-nova-casa/`.
- **Fotos:** remover marca d'água de terceiros com LaMa (ONNX) e aumentar a resolução 2x com ESRGAN (`2xNomosUni`), com ajuste de cor leve e natural (sem HDR nem cantos escuros). Nunca usar borrão ou inpaint simples, porque deixa rastro.
- **Capa:**
  - O dono aparece à esquerda, apontando (`apontando.png` espelhado).
  - Ao fundo, **duas fotos mescladas sem borda**: em cima, o ambiente de destaque; embaixo, o segundo destaque, com degradê entre elas.
  - Sombra só na faixa do título.
  - Texto em cima: "Olha o que eu encontrei pra você…" em Playfair itálico; título em Anton **numa linha só**, com o destaque em azul; e 📍 localização com o **pino vermelho** (#FF3B30).
  - Embaixo, à direita: selo azul "À venda" e o botão branco "ARRASTE PARA VER MAIS →".
- **Lâminas internas:** uma foto inteira por lâmina, com o selo "📍 Condomínio/Bairro" no topo (pino vermelho) e uma etiqueta branca numerada (01, 02…) com o nome do ambiente e um detalhe.
- **Final:** versão clara, o dono com a chave, "Gostou? Vem conhecer de perto. Me chama no Direct ou no WhatsApp" e o CRECI.
- **Valor:** só entra se o dono pedir. Nunca inventar número de quartos ou área; perguntar.

## Imóvel no CRM (dono, 2026-10-15)
- Fluxo: tratar as fotos, montar o carrossel, o dono manda o valor e as condições (só para o CRM) e dá **ok**; aí cadastrar em `properties` com `is_published=false`.
- **Fotos do CRM = lâminas do carrossel, na mesma ordem** (capa primeiro), em JPEG 1080×1350 com menos de 1,5 MB cada (limite do bucket `property-media`). Upload pelo segredo de rede `claude-fotos` (só `/storage/v1/`); o cadastro em si é feito via MCP Supabase.
- **Código:** todo imóvel novo ganha um código de 4 dígitos na coluna `properties.code`, que aparece como chip "COD…" no painel; **nunca no título**. Daqui para frente, o código aparece pequeno no carrossel (selo de localização e ao lado do @). Códigos usados: 4352 (Cavalari), 4353 (Terra Nova).
- Postar no Instagram: a integração Windsor publica carrossel (máx. 10 imagens), foto, story e Reels, **só com "sim" do dono por post**; agendamento via lembrete da sessão.

## Rosto e texto (dono, 2026-10-15)
- **Nunca colocar texto em cima do rosto do dono.** Na capa, o título fica **atrás** dele (a cabeça passa levemente por trás da faixa do título, como na referência).
- Logo do MCMV para fundo claro: `assets/mcmv-logo-cor.png`.
