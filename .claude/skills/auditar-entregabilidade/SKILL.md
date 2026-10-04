---
name: auditar-entregabilidade
description: "Audita aptidão para enviar e-mail: SPF/DKIM/DMARC, descadastro, supressão, lista, LGPD. Use para \"posso disparar?\", \"cai no spam\". Não envia."
---

# Auditar entregabilidade e conformidade

Agente: `email-specialist`. Antes: `.claude/rules/email-marketing.md`; fatos em `references/entregabilidade-conformidade.md` (**releia a fonte oficial antes de afirmar** exigência de provedor). Legítimo apenas: autenticação + lista boa + conteúdo honesto + volume gradual. Nenhuma técnica de evasão.

## Modos
- **Pré-envio (go/no-go):** percorre o checklist da referência e devolve **NO-GO / GO com condições / GO**, item a item com evidência.
- **Diagnóstico (já envia e cai em spam/bounce):** reúne sintomas (provedor, taxa de bounce/reclamação, painel Postmaster/Yahoo, cabeçalho bruto de um e-mail recebido) e aponta causa provável, em ordem: autenticação → lista → conteúdo → volume/frequência → reputação.

## Evidência (nunca presumir)
- DNS público do domínio remetente: consulte por `dig`/`nslookup` **somente leitura** quando houver domínio definido (SPF/DKIM/DMARC/MX/PTR); sem domínio decidido = **NO-GO por pré-requisito**, não inventar registros.
- Código do CRM: grep por supressão/descadastro/webhooks (hoje **não existem** para marketing — `.claude/rules/email-marketing.md`).
- Painéis (Google Postmaster Tools, provedor): peça print/export ao dono; não acesse contas.
- Lista: contagem e origem pedidas à Central (`analista-dados`); nunca exponha endereços ou nomes.

## Entrega
Tabela do checklist (item · status OK/FALTA/A CONFIRMAR · evidência · quem resolve: dono / `crm-editor` / DNS) + decisão GO/NO-GO + **próximos 3 passos**. Especificações de código (tabela de supressão, rota de descadastro one-click, webhook de bounce/reclamação) vão como Especificação ao `crm-editor`. Registro em `docs/email/CAMPANHAS.md`.
