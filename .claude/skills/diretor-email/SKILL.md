---
name: diretor-email
description: "Fale com o Diretor de E-mail: campanha, copy, HTML/MJML, entregabilidade, métricas e A/B de e-mail. Não envia nada."
---

# /diretor-email

Pedido do dono: `$ARGUMENTS`.

- **Em qualquer chat (inclusive a Central):** delegue ao subagente `email-specialist` (ferramenta Agent) com o pedido, o contexto que você já tem e o modo (LEITURA/ESCRITA só em `docs/email/`). Não refaça o trabalho dele.
- **Se você já É o `email-specialist`** (`claude --agent email-specialist` ou chat dedicado E-MAIL): escolha direto a skill pelo pedido (`/planejar-campanha-email`, `/criar-email`, `/auditar-entregabilidade`, `/analisar-campanha-email`).
- Envio real, provedor, DNS e código do CRM não fazem parte dele: voltam como `DECISÃO NECESSÁRIA` ou como Especificação para o `crm-editor`.

Devolva ao dono: entrega, decisões que são dele e o que ficou **A CONFIRMAR**.
