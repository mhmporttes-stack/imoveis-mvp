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
- **Fundo padrão das lâminas de texto (dono, 2026-10-13):** degradê azul com sombra, como o fundo do "ME CHAMA" — `radial-gradient(900px 760px at 50% 34%, #1F4CB3 0%, #173A8E 30%, #0E2257 62%, #08112E 100%)`; nada de fundo chapado (preto ou azul liso). Títulos em azul da marca ou branco.
- **Nunca contorno/borda grossa em volta das letras (efeito adesivo recortado)** — dono reprovou com força em 2026-10-13. Destaque sobre foto só com sombra suave.
- **Adesivo "sonho realizado" (dono, 2026-10-13):** cursiva Mr Dafoe + condensada Oswald 700 minúscula + texto pequeno entre tracinhos (Roboto); tudo no **azul da logo `#3673C2`** (não o azul de referências antigas); limpo — sem brilho branco, sem arco, sem corações 3D, só sombra suave. Modelo: `stories/2026-10-13-sonho-realizado-lais/adesivo.html`.
