---
name: registrar-regra
description: Registra uma regra de negócio nova (ou alterada) confirmada pelo dono do CRM imoveis-mvp no lugar certo — rule do módulo + docs/BUSINESS_RULES.md — com a etiqueta de proveniência correta, sem duplicar nem sobrescrever regra oficial existente. Use quando o dono definir/confirmar como algo deve funcionar ("a regra é...", "a partir de agora...", "confirmo que..."), mesmo que a tarefa também envolva código.
---

# Registrar uma regra do dono

Objetivo: a regra passa a valer para **todos os chats futuros**, num lugar só, sem perder as anteriores. Esta skill só cuida do registro. Se o pedido também exige implementar, a implementação segue o `crm-editor`.

## 1. Classificar a origem (nunca promova por conta própria)

- **[REGRA OFICIAL DE NEGÓCIO — definida/confirmada pelo dono em AAAA-MM-DD]**: só quando o dono afirmou **nesta conversa** (ou num documento já marcado assim).
- **[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO]**: é o que o código faz hoje, sem confirmação do dono.
- **[PENDENTE DE VALIDAÇÃO]**: comportamento cuja intenção ainda não foi confirmada.

Na dúvida entre OFICIAL e as outras duas, pergunte ao dono.

## 2. Procurar o que já existe antes de escrever

Use `grep -rn "<termo>" .claude/rules docs/BUSINESS_RULES.md`, com 2 ou 3 termos do assunto.

- Já existe regra sobre o mesmo ponto: **refine no mesmo lugar**. Acrescente um bloco novo datado ("refina/substitui a regra de AAAA-MM-DD acima"). **Nunca edite nem apague o texto de uma REGRA OFICIAL anterior.**
- A regra nova **contradiz** uma REGRA OFICIAL existente: pare e pergunte ao dono qual vale. Não resolva sozinho.
- O código diverge da regra: registre os dois lado a lado (OFICIAL + COMPORTAMENTO ATUAL). Não corrija o código fora do escopo pedido.

## 3. Onde escrever (uma casa por tipo — ver `CLAUDE.md`)

| O quê | Onde |
|---|---|
| A regra (etiqueta + data + o que vale + ponteiro para o código) | `.claude/rules/<módulo>.md` (tabela em `CLAUDE.md`). **Não crie rule nova**; se nenhum módulo couber, pergunte ao dono. |
| Detalhe verificável (ID da regra, ex. `MD-8`, casos, pontos A CONFIRMAR) | `docs/BUSINESS_RULES.md`, na seção do módulo |
| Por que mudou (incidente, exemplo real, números do caso) | `docs/CHANGELOG_AI.md`, nunca na rule |

Na rule, escreva a instrução e o link, sem a história. Dados pessoais de clientes (nome completo, telefone, CPF) não entram em rule nem em `docs/`.

Modelo para a rule:

```markdown
**[REGRA OFICIAL DE NEGÓCIO — definida pelo dono em AAAA-MM-DD] <título curto>.** <o que deve acontecer, para quais perfis, em quais condições>. Implementação: `<arquivo>` (`<função>`) — ou "ainda não implementada". Detalhes: `docs/BUSINESS_RULES.md` <ID>.
```

## 4. Conferir

- Os arquivos que implementam a regra casam com o `paths:` da rule onde ela foi escrita? Se não, inclua o glob para a regra carregar quando alguém mexer nesse código.
- A mesma regra não ficou escrita em dois lugares com textos diferentes.
- Faça o commit só dos arquivos de documentação, com mensagem "Regra do dono: <título>".
