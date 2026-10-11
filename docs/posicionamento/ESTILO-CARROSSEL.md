# Estilo dos carrosséis de Matheus (@mhm.machado)

Aprendido dos posts já publicados (enviados pelo dono em 2026-10-11). Usado pelo `/carrossel`.

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
| Gráfico comparativo (SAC x PRICE) | ainda não automatizado — fazer como imagem (`imagem`) ou descrever em lista |

## Linguagem
- Educativo e direto: crédito, SCR/Registrato, financiamento, MCMV, primeiro imóvel.
- Gancho em pergunta; uma ideia por lâmina; termina com CTA de comentário ("Comenta X que eu te mando o link") ou "Salve este post".
- Regra/dado oficial sempre com fonte (ex.: calendário do SCR = Banco Central); sem prometer aprovação.

## Ícones
Lucide (traço fino, na cor da marca). Nomes úteis: `house`, `car`, `hand-coins`, `calendar-clock`, `file-check`, `landmark`, `calculator`, `clipboard-check`, `map-pin`, `briefcase`, `shield-check`, `key-round`, `lightbulb`, `message-circle`, `credit-card`, `wallet`, `trending-up`.
