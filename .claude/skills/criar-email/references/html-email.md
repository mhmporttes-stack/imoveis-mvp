# HTML de e-mail — regras de compatibilidade

Fatos por cliente mudam: antes de usar propriedade nova, confirme em **caniemail.com** (fonte pública; licença dos dados A CONFIRMAR — consultar, não copiar). Docs do MJML: https://documentation.mjml.io/ (MIT).

## Estrutura base
- `<!DOCTYPE html>`, `<html lang="pt-BR">`, `<meta charset>`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `<title>`.
- **Layout em tabelas** (`role="presentation"`, `cellpadding/cellspacing="0"`, `border="0"`), largura de conteúdo **600 px** (tabela externa 100%, interna `max-width:600px`; no Outlook usar a tabela fantasma condicional `<!--[if mso]>…<![endif]-->` quando precisar fixar largura).
- **CSS inline** em cada elemento; `<style>` no `<head>` só para media queries/reset (Gmail suporta `<style>`, mas nem todo contexto; nunca depender dele para o essencial).
- Preheader: `<div style="display:none;max-height:0;overflow:hidden;opacity:0">…</div>` logo após `<body>`, preenchido com espaços invisíveis só para isolar o texto (técnica de formatação, não de evasão); usar o texto real do preheader.
- Peso do HTML **< 102 KB** (Gmail corta acima; o corte esconde o descadastro e prejudica o rastreio).

## Evitar / sem suporte confiável
`<script>`, `<form>`, `<iframe>`, vídeo/áudio embutido, `position`, `flex`/`grid` (Outlook desktop usa o motor do Word), `background-image` sem fallback, `margin` negativa, fontes web como requisito, `calc()`, variáveis CSS, SVG inline, GIF crítico, imagem única sem texto, anexos. Links: https absolutos, sem encurtador de terceiros, texto do link = destino real (anti-phishing).

## Botão "à prova de falha" (Outlook)
Link `<a>` com `display:inline-block`, padding e `background-color` inline; para cantos arredondados no Outlook, bloco VML `<v:roundrect>` dentro de `<!--[if mso]>`. Sempre `bgcolor` na `<td>` como fallback. Altura ≥ 48 px.

## Responsividade
Mobile first: tabela fluida; breakpoint `@media (max-width:620px)` para empilhar colunas e aumentar fonte; fonte base ≥ 16 px (evita zoom/ajuste automático); `-webkit-text-size-adjust:100%`. Imagens `width` em atributo + `style="max-width:100%;height:auto"` e `display:block`.

## Imagens
URL absoluta https no domínio do site, 2x para telas retina, `alt` sempre, `width/height` declarados, peso < 100 KB cada, e-mail legível com imagens bloqueadas (cor de fundo + alt estilizado).

## Modo escuro
Ver `marca-email.md`; teste de logo em fundo claro e escuro.

## Rodapé obrigatório
Identificação (Matheus Machado Imóveis · CRECI 323106 · Marília/SP), motivo do recebimento, link `{{unsubscribe_url}}` visível, link para política de privacidade (`/politica-de-privacidade`), contato.

## Versão texto
`.txt` multipart com o mesmo conteúdo essencial, links por extenso e descadastro.

## MJML (quando vale)
Vale quando houver vários templates/variações (componentes `mj-section/column/button` geram tabelas e VML corretos, colunas empilham no mobile). Para 1–2 peças, HTML à mão é mais simples e auditável. Compilar exige dependência npm (`mjml`, MIT): **não instalar** sem decisão do dono; o `crm-editor` adiciona ao projeto se aprovado. O arquivo `.mjml` é a fonte; o `.html` compilado é o artefato revisado.

## Merge tags
Neutras ao provedor: `{{primeiro_nome|amigo}}`, `{{unsubscribe_url}}`, `{{view_in_browser_url}}`. Mapear para a sintaxe do provedor na integração. Fallback obrigatório em todo campo opcional.
