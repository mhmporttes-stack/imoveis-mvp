# Estilo dos carrosséis de Matheus (@mhm.machado)

Aprendido dos posts já publicados (enviados pelo dono em 2026-10-11). Usado pelo `/carrossel`.

## Direção de design (pedido do dono, 2026-10-11: "mais leve, menos carregado, elegante e moderno")
Preferir o layout **editorial** (`tipo: "mito"` / `"editorial"`) a copiar a referência ao pé da letra:
- alinhado à esquerda, muito respiro, **um destaque por lâmina** (o número grande, ou a frase);
- frase/objeção em **serifa itálica** (Playfair), títulos em Inter 800, rótulo pequeno espaçado no topo ("MITO 01");
- `*palavra*` = serifa itálica azul (contraste elegante); `**palavra**` = destaque; nada de caixa alta gritando em bloco;
- texto de apoio cinza, curto (1–2 frases); CTA final como botão (`botao`).
Versão aprovada como referência: `carrosseis/2026-10-11-mitos-mcmv-v2/`.

## Cor
- **Destaque hoje = azul da marca** (`#3B8BFF` no fundo preto). Os posts antigos usavam **amarelo** — ao recriar um deles, trocar amarelo por azul. Nunca voltar ao amarelo.
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
| Capa com a pessoa grande ao centro e título embaixo | `capa` + `fotoCentral` + `centro` + `tituloCondensado` |
| Gráfico comparativo (SAC x PRICE) | ainda não automatizado — fazer como imagem (`imagem`) ou descrever em lista |

## Linguagem
- Educativo e direto: crédito, SCR/Registrato, financiamento, MCMV, primeiro imóvel.
- Gancho em pergunta; uma ideia por lâmina; termina com CTA de comentário ("Comenta X que eu te mando o link") ou "Salve este post".
- Regra/dado oficial sempre com fonte (ex.: calendário do SCR = Banco Central); sem prometer aprovação.

## Ícones
Lucide (traço fino, na cor da marca). Nomes úteis: `house`, `car`, `hand-coins`, `calendar-clock`, `file-check`, `landmark`, `calculator`, `clipboard-check`, `map-pin`, `briefcase`, `shield-check`, `key-round`, `lightbulb`, `message-circle`, `credit-card`, `wallet`, `trending-up`.
