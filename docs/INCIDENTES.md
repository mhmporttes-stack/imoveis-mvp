# INCIDENTES — histórico de bugs do CRM (causa raiz + correção)

> Este arquivo registra **bugs reais** (comportamento errado, em produção ou não) já diagnosticados e corrigidos neste projeto, para consulta **por sintoma** antes de investigar algo do zero. Não confundir com [`CHANGELOG_AI.md`](CHANGELOG_AI.md): o changelog registra **toda** alteração relevante (inclusive sem bug — regra nova, rota nova, mudança de arquitetura); este arquivo é só para bugs, pensado pra ser buscado por palavra-chave do sintoma. Uma entrada aqui normalmente tem uma irmã no changelog (ligadas pelo commit) — aqui o texto fica mais curto, focado em "o que a pessoa via" e "por que acontecia".
> Manual dos agentes: [`../AGENTS.md`](../AGENTS.md) · Metodologia de diagnóstico: `.claude/agents/crm-editor.md` §"Diagnóstico sistemático de bugs" · Skills: `/diagnosticar-bug`, `/diagnosticar-producao`, `/verificar-correcao`, `/consultar-incidentes`.

## Quando registrar

Registre uma entrada sempre que você:

- confirmar a **causa raiz** de um bug real (não um ajuste cosmético ou preferência de design) e aplicar (ou propor) uma correção;
- encontrar um bug real que decidiu **não corrigir agora** — registre o diagnóstico e o motivo de não corrigir, para não reinvestigar do zero depois.

Não registre: dúvidas sem causa raiz confirmada, tarefas só de auditoria/leitura sem bug encontrado, ajuste de preferência/estilo sem comportamento errado (isso vai só no `CHANGELOG_AI.md`, se for o caso).

## Como registrar

1. Acrescente a entrada logo **abaixo do título "## Registro"** (mais recente primeiro) — nunca no topo do arquivo, acima destas instruções.
2. Escreva o **Sintoma** do jeito que a pessoa relatou ou observou (palavras do dia a dia) — é a frase que alguém vai procurar aqui no futuro.
3. **Nunca** inclua tokens, segredos, dados pessoais de clientes ou telefones/e-mails reais — generalize ("um cliente", "um corretor") quando precisar de um exemplo.
4. Se a correção também mudou regra de negócio/arquitetura/rota/permissão, a entrada completa fica no `CHANGELOG_AI.md` — aqui só um resumo + link para o commit.
5. Não apague incidentes antigos. Para corrigir um registro, acrescente uma nota referenciando o anterior.
6. **Arquivamento (quando necessário):** se este arquivo passar de ~500 linhas, mova os incidentes de meses já encerrados, sem alterar o texto, para `docs/incidentes/AAAA-MM.md` (um arquivo por mês, mais recente primeiro) e deixe ao fim da seção "Registro" a linha `Meses anteriores: docs/incidentes/`.

## Formato

Copie o modelo abaixo (uma entrada por bloco):

```markdown
### AAAA-MM-DD — <sintoma curto, em palavras de usuário>
- **Data:** AAAA-MM-DD
- **Sintoma:** <como foi relatado/observado — a frase de busca futura>
- **Área:** <Clientes | Roleta | Funil | Agenda | Meta Diária | Ranking | WhatsApp | Meta/Tráfego | Documentação/CCA | Financeiro | Permissões | Banco | Infra | Frontend | …>
- **Impacto:** <quem/quantos afetados, gravidade>
- **Causa raiz:** <o porquê técnico, não só o sintoma>
- **Correção:** <o que mudou, resumido — detalhe completo no changelog, se houver>
- **Arquivos/commit:** `caminho/arquivo` — commit `sha`
- **Prevenção/teste:** <teste criado, trava adicionada, ou "nenhum — risco residual: ...">
- **Status:** Resolvido | Monitorando | Diagnosticado, correção pendente
```

## Registro

### 2026-10-01 — "Não encontro todas as opções no card do cliente" (etapas de venda)
- **Data:** 2026-10-01
- **Sintoma:** usuário não conseguia mover um cliente entre as etapas de pós-venda (ex.: de "Cartório" para "Pagamento") pelo seletor de status do card — só "Venda realizada" aparecia no grupo "Venda", mesmo a barra de abas de Clientes mostrando contagem própria para Formulários/Reserva/Contrato/Assinatura Caixa/ITBI/Cartório/Pagamento.
- **Área:** Clientes / Funil
- **Impacto:** qualquer corretor/gestor tentando progredir um cliente pelo pipeline de pós-venda — só dava pra fazer por edição direta no banco.
- **Causa raiz:** `components/clients/StatusOptions.jsx` só incluía `CLIENT_STATUS.SALE_COMPLETED` no grupo "Venda" do seletor; as outras 7 etapas do pipeline (`CLIENT_FUNNEL_SALE_STATUS_VALUES`) nunca foram adicionadas à lista de opções selecionáveis, embora já existissem no funil/filtro e o backend já tratasse todas igualmente. Confirmado não ser regressão da reescrita da lista de Clientes (mesma restrição já existia no componente anterior).
- **Correção:** o seletor passou a listar as 8 etapas, na mesma ordem da barra de abas.
- **Arquivos/commit:** `components/clients/StatusOptions.jsx` — commit `836937a`, ver `docs/CHANGELOG_AI.md` 2026-10-01.
- **Prevenção/teste:** nenhum teste automatizado (lista de opções de UI). Nenhum risco de backend — `updateSimulationRegistration` já suportava qualquer uma das 8 etapas.
- **Status:** Resolvido

### 2026-10-01 — Corretora via a meta em 100% e o painel mostrava menos horas depois
- **Data:** 2026-10-01
- **Sintoma:** "ela me disse que já está em 100 por cento" — gestor abre "Desempenho de hoje" de um corretor e vê um percentual menor (ex.: 98%) do que o corretor relatou ter visto mais cedo.
- **Área:** Meta Diária / Ranking
- **Impacto:** qualquer corretor cuja carteira ativa cresça ao longo do dia (novo contato entrando via claim automático ou manual) depois de já ter completado tudo que existia pela manhã — o percentual parece "regredir" sem motivo visível.
- **Causa raiz:** não era inconsistência de cálculo — confirmado com dado real direto do banco que o painel batia exatamente com a fórmula documentada (`wallet.dayTarget`). O denominador da meta (`loadWalletDayNumbers`, `lib/daily-goal-wallet.js`) era "carteira ativa **agora**", recalculada a cada carregamento — contato novo entrando na carteira durante o dia aumentava o total depois que o corretor já tinha batido 100% do que existia antes, derrubando o percentual sem nenhum trabalho novo do corretor.
- **Correção:** o dono decidiu travar o denominador à meia-noite (regra nova, `.claude/rules/meta-diaria-ranking.md`). Nova tabela de congelamento `daily_goal_wallet_freeze` (mesmo padrão de `daily_goal_pending_freeze`); contato novo do dia só conta na meta de amanhã.
- **Arquivos/commit:** `lib/daily-goal-wallet.js`, `supabase/migrations/20261001180000_daily_goal_wallet_freeze.sql` — ver `docs/CHANGELOG_AI.md` 2026-10-01.
- **Prevenção/teste:** nenhum teste automatizado novo (depende de estado vivo do banco); verificado manualmente contra produção (congelamento estável em duas chamadas seguidas). Risco residual: o chip "Carteira ativa X/100" passou a refletir o conjunto congelado também — avaliar se isso precisa de ajuste separado se algum corretor estranhar esse chip específico.
- **Status:** Resolvido

### 2026-10-01 — Modal de Documentação ficava atrás da ficha do cliente e travava o anexo de arquivo
- **Data:** 2026-10-01
- **Sintoma:** "uma aba está sobrepondo a outra e não conseguimos anexar os documentos" — com a ficha do cliente (painel lateral) aberta, abrir "Documentação" mostrava os dois sobrepostos e o clique na área de anexar arquivo não registrava.
- **Área:** Clientes / Frontend
- **Impacto:** qualquer corretor/gestor que abrisse Documentação com a ficha do cliente já aberta — bloqueava o anexo de documento nesse fluxo.
- **Causa raiz:** a ficha do cliente (`components/ui/Sheet.jsx`) usa `<dialog>` nativo com `showModal()`, que entra na camada de topo do navegador (*top layer*) — nenhum `z-index` comum fica acima disso. `ClientDocumentsModal.jsx` era uma `<div>` fixa comum, então sempre ficava visualmente (e funcionalmente) atrás da ficha quando as duas estavam abertas ao mesmo tempo.
- **Correção:** `ClientDocumentsModal.jsx` passou a usar `<dialog>`/`showModal()` também, entrando na mesma camada de topo e empilhando corretamente por cima.
- **Arquivos/commit:** `components/ClientDocumentsModal.jsx` — commit `5536c5a`
- **Prevenção/teste:** nenhum teste automatizado (é comportamento de navegador, não lógica pura). Risco residual: qualquer modal novo criado como `<div>` fixa comum (em vez de `<dialog>`) terá o mesmo problema se puder abrir sobre a ficha do cliente ou outro `<dialog>` já existente (`Sheet`/`ConfirmDialog`). Ao criar um modal novo neste projeto, siga o padrão `<dialog>` + `showModal()` de `components/ui/Sheet.jsx`/`ConfirmDialog.jsx`.
- **Status:** Resolvido
