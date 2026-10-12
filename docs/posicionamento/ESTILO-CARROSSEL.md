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
| Lâmina com o Matheus em pose/expressão (pensando, surpreso, joinha, celular…) | `"boneco": "<pose>"` — boneco 3D dele em `assets/boneco-3d/` (2026-10-11) |
| Gráfico comparativo (SAC x PRICE) | ainda não automatizado — fazer como imagem (`imagem`) ou descrever em lista |

## Linguagem
- Educativo e direto: crédito, SCR/Registrato, financiamento, MCMV, primeiro imóvel.
- Gancho em pergunta; uma ideia por lâmina; termina com CTA de comentário ("Comenta X que eu te mando o link") ou "Salve este post".
- Regra/dado oficial sempre com fonte (ex.: calendário do SCR = Banco Central); sem prometer aprovação.

## Ícones
Lucide (traço fino, na cor da marca). Nomes úteis: `house`, `car`, `hand-coins`, `calendar-clock`, `file-check`, `landmark`, `calculator`, `clipboard-check`, `map-pin`, `briefcase`, `shield-check`, `key-round`, `lightbulb`, `message-circle`, `credit-card`, `wallet`, `trending-up`.
