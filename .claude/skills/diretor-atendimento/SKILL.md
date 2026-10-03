---
name: diretor-atendimento
description: Fale com o Diretor de Atendimento: Guia, WhatsApp Oficial, automações, follow-up, vácuo/reativação, qualidade e jornada. Interno; não atende clientes.
---

# /diretor-atendimento

Pedido do dono: `$ARGUMENTS`.

- **Em qualquer chat:** delegue ao subagente `diretor-atendimento` (ferramenta Agent), passando o pedido, o contexto que você já tem e o modo (LEITURA; escrita só em `docs/atendimento/`). Não monte a equipe você mesmo: ele escolhe os especialistas.
- **Se você já É o `diretor-atendimento`** (`claude --agent diretor-atendimento`): siga o protocolo do seu prompt direto.
- **Conversa direta com ele:** `claude --agent diretor-atendimento` no terminal (o mesmo agente que a Central aciona; nunca existem dois).
- Se a resposta vier em MODO PLANO (equipe mínima + cabeçalhos de delegação), execute os cabeçalhos com os executores `especialista-atendimento`/`-web` e devolva ao dono só o formato fixo dele.

Devolva ao dono: especialistas consultados, conclusão e decisões que são dele. Implementar/publicar é do `crm-editor`, com aprovação.
