# Marca no e-mail — âncoras e especificação

Âncoras (preservar): **logo** e **paleta azul + branco** (`.claude/design/DESIGN.md` §1, auditado). Aqui: aplicação a e-mail. Proposta técnica — o dono pode ajustar; não altera tokens do CRM.

| Papel | Valor | Uso | Contraste |
|---|---|---|---|
| Marinho (estrutura/título/fundo da faixa de marca) | `#031D3A` | cabeçalho, headline sobre branco, rodapé | branco sobre marinho muito alto |
| Azul de marca (ação/botão/link) | `#3673C2` | botão primário, links | texto branco sobre azul = 4,79:1 (AA) |
| Branco | `#FFFFFF` | fundo do corpo | — |
| Cinza-claro (canvas/divisor) | `#EFEFEF` / `#F5F7FA` | fundo externo, divisores | — |
| Texto | `#1F2937` / secundário `#475467` | corpo | ≥ AA sobre branco |

Divergência conhecida: tokens do CRM (`#1769D1`, `#0D3B66`) são interpretação da paleta; para e-mail use as âncoras medidas na logo. Reaudite se o dono decidir a paleta definitiva.

## Ativos
Logo/símbolo: `public/assets/matheus-machado-symbol.png` (símbolo; tem parte branca/cinza → usar sobre faixa marinho) e `public/assets/og-matheus-machado-v2.png` (marca completa com texto, já sobre azul-marinho). Não existe outra logo: as antigas foram removidas. Imagens em e-mail precisam de **URL https absoluta pública** (site) e `alt`; dimensione em 2x (ex.: logo 160×40 exibido, arquivo 320×80). Foto de imóvel só real (nunca banco de imagem que pareça outro lugar); sem imagem como único portador da mensagem (bloqueio de imagem é padrão em vários clientes).

## Composição (600 px, mobile first)
Faixa marinho com logo (altura enxuta) → headline grande (26–30 px, 700) → 1–2 linhas de apoio (16 px, linha 1,5) → botão (altura ≥ 48 px, canto 6–8 px, texto 16 px branco) → linha de confiança (13–14 px, `#475467`) → rodapé 12 px com identificação, CRECI, motivo do recebimento e descadastro. Margens laterais 24 px; espaço em branco generoso; no máximo uma ilustração/foto. Sem gradiente decorativo, sombras, carrosséis ou "cara de newsletter". Tipografia: pilha de sistema (`Arial, Helvetica, sans-serif`); webfont só como melhoria progressiva com fallback — não depender dela.

## Modo escuro
Não forçar inversão. Garantir: logo legível sobre fundo escuro (usar a versão para fundo escuro dentro da faixa marinho); texto com cor explícita; imagens com fundo próprio ou PNG transparente testado em ambos. `color-scheme` e `@media (prefers-color-scheme)` são melhoria opcional (suporte parcial — conferir em caniemail.com).

## Acessibilidade
Contraste AA; `alt` descritivo (vazio só em decorativa); `lang="pt-BR"`; ordem de leitura lógica; `role="presentation"` nas tabelas de layout; link com texto compreensível; alvo de toque ≥ 44 px; botão como link estilizado real (não só imagem).
