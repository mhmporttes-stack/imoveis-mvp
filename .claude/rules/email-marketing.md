---
paths:
  - "docs/email/**"
  - "lib/email-*"
  - "lib/email/**"
  - "lib/marketing-email*"
  - "emails/**"
  - "app/descadastrar/**"
  - "app/api/**/unsubscribe/**"
  - "app/api/**/email-campaign*/**"
---

# E-mail marketing e prospecção por e-mail

Dono da frente: agente `email-specialist` (Diretor de E-mail). Vale também para o `crm-editor` ao implementar. Skills: `/planejar-campanha-email`, `/criar-email`, `/auditar-entregabilidade`, `/analisar-campanha-email`. Esta rule é curta de propósito: referência técnica fica nas `references/` das skills; história em `docs/email/CAMPANHAS.md`.

## Estado do projeto
**[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO — 2026-10-04]** Só existe e-mail **transacional interno** via Resend (`.claude/rules/integracoes-externas.md` §E-mail). Não existem: campanha de e-mail, lista de supressão, descadastro de marketing, domínio/provedor de marketing. Nada disso é criado sem decisão do dono e Especificação do `email-specialist` entregue ao `crm-editor`.

## Segurança e produção (CLAUDE.md regra 9 aplicada a e-mail)
- Nenhum envio real, nem "teste", sem pedido explícito do dono para aquele envio; teste só para endereços próprios do dono.
- `do_not_contact`, descadastrados, bounce duro e reclamação **nunca** recebem e-mail de marketing — checagem no servidor (`lib/`), não só na tela. Descadastro vale para todas as campanhas.
- Segredos de provedor só no servidor, só nome da variável em docs. Sem provedor pago/DNS sem decisão do dono.
- Remetente de marketing **separado** do transacional (reputação) — **[PENDENTE DE VALIDAÇÃO]** a confirmar pelo dono (subdomínio/provedor).

## Conformidade (aplicar em toda peça)
1. Origem do contato rastreável (formulário do site, cadastro do cliente, indicação declarada); sem lista comprada/raspada. Base legal LGPD e texto de consentimento/legítimo interesse: **A CONFIRMAR com advogado** antes do 1º disparo em massa.
2. Todo e-mail: remetente identificado (Matheus Machado Imóveis + CRECI 323106), descadastro visível em 1 clique, motivo pelo qual a pessoa recebe, endereço/contato. Cabeçalho `List-Unsubscribe` + one-click quando houver envio em escala.
3. Texto honesto: sem aprovação garantida, sem valor de subsídio/parcela sem fonte, sem urgência falsa; "sujeito a análise de crédito". Fonte única: `.claude/skills/criar-anuncio/references/conformidade-imobiliaria.md`.
4. Sem técnicas de evasão de filtro (ver `email-specialist`).

## Identidade visual
Âncoras: logo + azul e branco (`.claude/design/DESIGN.md` §1; cores específicas de e-mail em `.claude/skills/criar-email/references/marca-email.md`). Premium, limpo, uma ideia por e-mail, sem "cara de newsletter". Fatos (valores, condições) nunca inventados pelo design.

## Integração com o CRM
- CTA padrão: `/simulacao` do site com `utm_source=email&utm_medium=email&utm_campaign=<slug>&utm_content=<variante>`; links `?c=`/`?ref=` não podem quebrar (`docs/TRAFEGO_META.md`). `utm_medium=email` **não** é mídia paga (`PAID_MEDIUM_PATTERN` em `lib/lead-origin.js` só reconhece cpc/ppc/paid/paid_social/paid_search/anuncio — verificado 2026-10-04); o lead entra como `tracked_link` com os UTMs em `source_metadata`. Nunca use `utm_medium=paid`/`anuncio` em e-mail.
- Cliente que responde/converte segue o funil normal (`lib/client-status.js`); atribuição de métricas segue `docs/METRICAS_FUNIL.md`.

## Não duplicar
Não criar segundo mapa de agentes, segunda fonte de conformidade imobiliária, nem copiar tokens de design: aponte para o arquivo dono. Novo arquivo do módulo que não case com `paths:` acima → ajuste os globs.
