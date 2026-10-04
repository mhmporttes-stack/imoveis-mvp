---
name: criar-email
description: "Cria o e-mail: assunto, preheader, copy pt-BR, especificação visual, HTML/MJML e checklist de compatibilidade. Use para \"cria o e-mail\". Não envia."
---

# Criar e-mail (copy + design + HTML)

Agente: `email-specialist`. Antes: `.claude/rules/email-marketing.md`, `docs/email/PERFIL.md`; conformidade de texto: `.claude/skills/criar-anuncio/references/conformidade-imobiliaria.md`. Leia só o que a etapa pede:
- copy → `references/copy-ptbr.md` · visual → `references/marca-email.md` · HTML/MJML → `references/html-email.md`.

## Passo a passo
1. **Brief de 5 linhas**: público/segmento, objetivo único, oferta, CTA, canal de continuação (`/simulacao`). Sem brief de `/planejar-campanha-email`, monte um mínimo e registre as suposições.
2. **Copy** (ordem de decisão): assunto (2–3 variações, 30–50 caracteres, sem caixa alta/exclamação em excesso), preheader (complementa, não repete), headline, 2–4 linhas de corpo, CTA verbal específico, linha de confiança (CRECI, "sujeito a análise de crédito"), rodapé legal com descadastro. Personalização só com dado seguro (primeiro nome, se existir e for confiável) e **com fallback**.
3. **Hierarquia e especificação visual** (1º onde olhar · 2º o que entender · 3º o que fazer): bloco de marca → headline → apoio → botão → confiança → rodapé. Anti-cardificação: espaço e tipografia antes de caixas. Uma ideia por e-mail.
4. **Implementação**: HTML de e-mail à mão (tabelas, CSS inline, 600 px) ou MJML (compilar é decisão do `crm-editor`/dono; sem instalar nada aqui). Entregue `docs/email/templates/<slug>.html` (e `.mjml` se for fonte). Placeholders de merge em `{{chave}}` neutros ao provedor (`{{primeiro_nome|fallback}}`, `{{unsubscribe_url}}`, `{{utm}}`) — provedor ainda não escolhido.
5. **Validar**: `node .claude/skills/criar-email/tools/lint-email.mjs docs/email/templates/<slug>.html` (tamanho < 102 KB, `alt`, largura, links com UTM, descadastro, sem script/form/flex/grid, texto do preheader, contraste do botão). Corrija até zero erros. Nunca envie para testar.
6. **Prova visual**: gere o preview local (HTML aberto no navegador/Playwright disponível no ambiente) em 600 px e 375 px; para peça relevante peça crítica independente ao `design-critic` via Central, com o brief de `.claude/design/REVIEW.md` §6. Teste real em clientes (Gmail/Outlook/Apple) só com envio de teste aprovado pelo dono — até lá marque **[A CONFIRMAR em cliente real]**.

## Entrega
Pacote curto: assuntos + preheader, copy final, especificação visual (1 parágrafo), caminho do template, resultado do lint, riscos de compatibilidade (Outlook, modo escuro), versão texto puro (`.txt`) obrigatória. Registre em `docs/email/CAMPANHAS.md` (status **peça pronta, aguardando aprovação**). Aprovação do dono antes de qualquer uso.
