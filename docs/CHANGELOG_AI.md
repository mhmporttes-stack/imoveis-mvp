# CHANGELOG_AI — registro de alterações importantes feitas por agentes

> Este arquivo registra **alterações importantes futuras** feitas por agentes de IA (e por pessoas que usem agentes) neste projeto. **Não contém histórico anterior**: o histórico de código está no Git e o das regras de negócio em `.claude/rules/*.md` e `docs/`.
> Manual dos agentes: [`../AGENTS.md`](../AGENTS.md) · Contexto: [`CRM_CONTEXT.md`](CRM_CONTEXT.md) · Regras: [`BUSINESS_RULES.md`](BUSINESS_RULES.md) · Arquitetura: [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md).

## Quando registrar

Registre uma entrada **sempre que a sua alteração**:

- muda uma **regra de negócio** ou o comportamento visível de um módulo;
- cria/altera **tabela, coluna, função, trigger, migration, cron** ou política de acesso;
- cria/altera **rota de API**, guard/permissão ou contrato de payload;
- mexe em **integração** (WhatsApp, Meta, Anthropic, Resend, push) ou em variável de ambiente;
- altera uma **área compartilhada** (ver lista em `SYSTEM_ARCHITECTURE.md` §10);
- **corrige uma divergência** entre a documentação e o código (atualize também o documento afetado);
- ou quando você **encontra um problema fora do escopo e não o corrigiu** (registre em “Risco/observação” e avise o dono).

Não registre: ajuste de texto/estilo trivial, refatoração sem efeito visível, tarefas só de leitura/auditoria sem alteração.

## Como registrar

1. Acrescente a entrada **no topo** da seção “Registro” (mais recente primeiro).
2. Uma entrada por mudança lógica (não uma por arquivo). Escreva em **português do Brasil**, objetivo e sem jargão desnecessário.
3. **Nunca** inclua tokens, segredos, valores de variáveis de ambiente, dados pessoais de clientes ou telefones/e-mails reais.
4. Se a alteração afetou regras/arquitetura, **atualize também** o documento correspondente em `docs/` (e diga qual na entrada).
5. Se algo não pôde ser provado no código, escreva **A CONFIRMAR** — não invente.
6. Não apague entradas antigas. Para corrigir uma, acrescente uma nova referenciando a anterior.

## Formato

Copie o modelo abaixo (uma entrada por bloco):

```markdown
### AAAA-MM-DD — <título curto>
- **Data:** AAAA-MM-DD
- **Área:** <Clientes | Roleta | Funil | Agenda | Meta Diária | Ranking | WhatsApp | Meta/Tráfego | Documentação/CCA | Financeiro | Permissões | Banco | Infra | Docs | …>
- **Alteração:** <o que mudou, em 1–3 linhas>
- **Motivo:** <por que; pedido do dono, bug, incidente…>
- **Arquivos afetados:** `caminho/arquivo1`, `caminho/arquivo2` (e migrations, se houver)
- **Risco/observação:** <impacto possível em outros módulos, o que foi validado e como, o que ficou A CONFIRMAR, problemas encontrados e não corrigidos>
- **Autor:** <agente/ferramenta ou pessoa>
```

## Registro

### 2026-09-25 — Aviso ao corretor que recebe os clientes de um usuário excluído
- **Data:** 2026-09-25
- **Área:** Clientes / Notificações
- **Alteração:** ao excluir um usuário com clientes, o corretor de destino recebe **um único** aviso resumido (`crm_notifications`, tipo `clients_transferred`, + push) — não um por cliente; não avisa se o próprio autor da exclusão é o destino. A tag do corretor anterior passou a ser obrigatória e gravada **antes** de mover cada lote (falha na tag aborta a transferência do lote).
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `lib/admin-profiles.js` (`transferClientsBeforeDelete`); `docs/CHANGELOG_AI.md`.
- **Risco/observação:** aviso é best-effort (falha não desfaz a transferência). Continua sem exercício real em produção.
- **Autor:** Claude Code

### 2026-09-25 — Excluir corretor pergunta para quem transferir os clientes
- **Data:** 2026-09-25
- **Área:** Clientes / Permissões (Usuários)
- **Alteração:** ao excluir um usuário (já desativado), abre-se um painel pedindo o corretor que receberá os clientes dele. Os clientes transferidos ganham uma tag com o nome do corretor anterior e um evento na linha do tempo. Antes, os clientes iam automaticamente ao administrador principal. Novo `GET /api/admin-users/[id]` devolve a contagem de clientes; `DELETE` aceita `transferToUserId` (obrigatório se houver clientes).
- **Motivo:** pedido do dono (escolher o destino e identificar a origem dos clientes).
- **Arquivos afetados:** `lib/admin-profiles.js` (`deleteAdminProfile`, `countClientsOfProfile`), `app/api/admin-users/[id]/route.js`, `components/AdminUsersManager.jsx`; `docs/BUSINESS_RULES.md` (CLI-6).
- **Risco/observação:** não altera `previous_responsible_user_id`/`responsible_changed_at` (evita disparar a automação "client_transferred" em massa e o campo seria zerado pela exclusão). A conversa do WhatsApp acompanha o novo responsável pelo trigger existente. Associados vinculados ao corretor excluído, contatos da Prospecção e carteira da Meta Diária continuam com o comportamento anterior do banco (ficam sem vínculo/dono). Compilação validada (`next build`); a exclusão real não foi exercitada em produção.
- **Autor:** Claude Code
