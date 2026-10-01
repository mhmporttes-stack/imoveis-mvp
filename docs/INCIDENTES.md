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

### 2026-10-01 — Mesmo cliente aparece em várias rodadas/tentativas da Meta Diária no mesmo dia
- **Data:** 2026-10-01
- **Sintoma:** na validação do ranking, um cliente aparecia em 5 a 20 rodadas da Meta Diária no mesmo dia (ex.: 20 "1ª tentativas" no mesmo cliente em 9 minutos); 2ª/3ª tentativas iam várias vezes para a mesma pessoa.
- **Área:** Meta Diária / Prospecção
- **Impacto:** 15 clientes compartilhados por 144 rodadas (129 contatos de outras pessoas), 217 tentativas, de 14/09 a 29/09. 1ª tentativa foi para a pessoa certa; 2ª/3ª manuais foram para o telefone do último contato do grupo. 129 pessoas sem card próprio. Pontuação do Modelo B (desde 28/09): sem impacto (dias já no teto).
- **Causa raiz:** `findMatchingRegistration` casava cadastro também por NOME (removido em `83bdf1a`, 29/09 04:41). Na materialização da Meta Diária, o 2º contato homônimo (telefone diferente) caía no cliente do 1º, sobrescrevia o telefone dele e gravava `prospecting_contacts.registration_id` apontando para ele. Esses vínculos ficaram gravados, e `materializeClientOnFirstAttempt`, `claimProspectingContact` e `assignProspectingContacts` reaproveitavam `registration_id` sem conferir; a tela da Meta Diária usava o telefone do cliente antes do do contato.
- **Correção (etapa 1, preventiva):** o `registration_id` do contato só é reaproveitado se o telefone do cliente bater com o do contato (`clientMatchesContactPhone`); senão procura/cria pelo telefone do contato sem alterar nome/telefone de cliente existente (`keepExistingIdentity`); 1ª/2ª/3ª tentativa sempre usam o telefone do contato da rodada (`roundContactPhone`). Etapa 2 (os 15 clientes/129 contatos existentes) aguardando aprovação do dono.
- **Arquivos/commit:** `lib/contact-client-link.mjs`, `lib/registration-match.mjs`, `lib/daily-goal.js`, `lib/prospecting.js`, `lib/simulation-registrations.js`
- **Prevenção/teste:** `tests/contact-client-link.test.mjs` (reproduz o bug antigo: mesmo nome + telefones diferentes = clientes independentes; vínculo errado ignorado) e `tests/registration-match.test.mjs`.
- **Etapa 2 (dados, 2026-10-01, aprovada pelo dono):** backup em `p01_backup_20261001_{clients,contacts,conversations,rounds}` (RLS, sem acesso público). Em uma transação: os 15 cards mantidos com o contato do telefone atual; 120 contatos desvinculados; cards próprios #C4480 (…4107, de #C2188), #C4481 (…0313, de #C3276), #C4482 (…3612, de #C2681), responsável igual ao card de origem (Matheus, fora do ranking); 5 contatos bloqueados só pelo vínculo (#C2679: 1, #C3860: 4) liberados, respeitando a trava de 30 dias; 128 eventos de auditoria em `prospecting_history` (`details.fix = p01-20261001`). Preservados de propósito: os 4 contatos do #C3919 (aguardam confirmação da Jennyfer) e …2973/…3947 do #C3846 (card próprio daria pontos de "Novo cliente" à gestora — aguarda decisão do dono). Rodadas, tentativas, histórico e pontuação intactos (impressão digital das fontes do ranking idêntica antes/depois).
- **Status:** Resolvido em parte — pendentes #C3919 (4 contatos) e #C3846 (…2973 com conversa, …3947)

### 2026-10-01 — Corretor recebeu só 14 contatos na cota diária em vez de 20
- **Data:** 2026-10-01
- **Sintoma:** "verifique pq só foram adicionados 14 clientes para o Luan no lugar de 20" — gestor vê a meta de um corretor presa em menos que a cota cheia.
- **Área:** Meta Diária / Ranking
- **Impacto:** qualquer corretor cujo congelamento da carteira (`daily_goal_wallet_freeze`, criado neste mesmo dia — ver entrada anterior) rodasse DEPOIS que alguns dos contatos de hoje já tivessem convertido/encerrado. Confirmados 7 corretores afetados no próprio dia do lançamento da funcionalidade.
- **Causa raiz:** regressão da correção anterior deste mesmo dia (congelamento da meta à meia-noite). `freezeDailyGoalWalletIfMissing` só capturava rodadas `status='active'` no instante do congelamento — rodada já convertida/encerrada ANTES desse instante nunca entrava no conjunto congelado. No caso do Luan Vitor: cota cheia de 20 gerada às 08:57, 6 já tinham saído quando o congelamento lazy rodou às 14:44 (outra pessoa abriu o painel do gestor antes dele), restando só 14 no congelamento.
- **Correção:** a captura do congelamento passou a incluir também quem já saiu hoje antes do instante do congelamento (`ended_at`/`converted_at` de hoje), igual a consulta ao vivo já fazia antes do congelamento existir.
- **Arquivos/commit:** `lib/daily-goal-wallet.js` — commit `65fbbb8`, ver `docs/CHANGELOG_AI.md` 2026-10-01.
- **Prevenção/teste:** nenhum teste automatizado novo (depende de estado vivo do banco). As linhas já congeladas erradas hoje (7 corretores) foram recalculadas via SQL direto em produção.
- **Status:** Resolvido

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
