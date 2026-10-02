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

### 2026-10-02 — Meta Diária: fila com horários fora da janela depois de mudar a configuração ("reagendou para 02:10")
- **Data:** 2026-10-02
- **Sintoma:** com janela 07:00–14:00 salva, as atividades já agendadas não mudaram; ao clicar em "Reagendar" a tela mostrou várias atividades às 02:10 ("Fila reorganizada manualmente pelo admin").
- **Área:** Meta Diária
- **Impacto:** 139 pendências fora da nova janela (06:30–18:53) e pendências de dias anteriores; nenhum envio fora da janela confirmado (o executor já checava a hora atual).
- **Causa raiz:** (1) salvar a configuração só atualizava `daily_goal_auto_settings`, nunca a fila já gerada; (2) o executor checava só a hora atual, não o horário/dia do item (itens de 06:30 ou de dias anteriores sairiam em sequência às 07:00); (3) o "02:10" era `updated_at` dos itens CANCELADOS pelo reagendar, exibido no histórico como se fosse horário — o reagendar gerou itens corretos (07:00–13:50, `cursor = max(início, agora)`); (4) a oscilação podia deixar mensagens de fora do fim da janela.
- **Correção:** trava final no envio com configuração relida, recálculo da fila inválida antes de enviar, recálculo automático ao salvar configuração/teto, oscilação que sempre cabe na janela, histórico mostrando o horário agendado.
- **Arquivos/commit:** `lib/daily-goal-auto.js`, `lib/daily-goal-auto-core.mjs`, `components/DailyGoalAdmin.jsx`
- **Prevenção/teste:** `tests/daily-goal-auto-window.test.mjs` (02:10, 14:00, 100 mensagens, oscilação, teto, travas de código).
- **Status:** Resolvido

### 2026-10-02 — Respostas de clientes no WhatsApp não aparecem no Chat nem param a prospecção
- **Data:** 2026-10-02
- **Sintoma:** desde 29/09 nenhuma mensagem recebida pelo WhatsApp conectado por QR entrava no Chat do CRM; resposta de cliente não cancelava os envios automáticos da Meta Diária nem o opt-out ("PARAR").
- **Área:** WhatsApp / Meta Diária / Prospecção
- **Impacto:** 0 mensagens recebidas no Chat de 29/09 a 02/10 com 372 envios da automação em 3 dias; nenhum cancelamento "lead_respondeu".
- **Causa raiz:** (provável, confirmada no código do Baileys 6.7.24 que o Railway instala) o WhatsApp passou a endereçar conversas 1:1 por LID (`<id>@lid`); o serviço descartava todo JID que não fosse `@s.whatsapp.net`. O telefone real vem em `key.senderPn`. Agravante: a parte da prospecção (cancelar fila/opt-out) só rodava depois de gravar no Chat — qualquer falha ali também a impedia.
- **Correção:** `whatsapp-individual-service/src/message-extract.js` resolve o telefone de conversas `@lid` (`senderPn` nas recebidas; mapa LID→telefone aprendido dos eventos nas enviadas pelo app); webhook passou a chamar Prospecção e Chat como consumidores independentes.
- **Arquivos/commit:** `whatsapp-individual-service/src/message-extract.js`, `whatsapp-individual-service/src/sessions.js`, `app/api/webhooks/whatsapp-individual/route.js`, `lib/prospecting-reply.js`
- **Prevenção/teste:** `tests/whatsapp-individual-extract.test.mjs`, `tests/prospecting-reply-core.test.mjs`. Conferir após o deploy do serviço no Railway se `whatsapp_messages` volta a receber `direction = inbound`.
- **Status:** Monitorando (depende do deploy do microsserviço no Railway)

### 2026-10-02 — Venda marcada como "Pago" não aparece em Financeiro > Recebimentos (R$ 0,00 em tudo)
- **Data:** 2026-10-02
- **Sintoma:** Financeiro > Recebimentos com "Todo período": "A receber neste mês", "Recebido neste mês" e "A receber 30/60/90" em R$ 0,00 e agenda vazia, embora uma venda já recebida (cliente em "Pago") existisse.
- **Área:** Financeiro
- **Impacto:** 1 venda (comissão bruta R$ 9.000,00) com `financial_status = received` mas sem nenhuma linha em `financial_payments`; R$ 9.000,00 fora de todos os totais. As outras 6 vendas estavam consistentes (pendentes, sem pagamentos). Nenhum outro recebimento ignorado (a tabela estava vazia).
- **Causa raiz:** o Financeiro soma `financial_payments`, nunca o status da venda. A 1ª versão de `markFinancialSaleReceivedForRegistration` (commit `f1084fa`, 01/10 16:17 -03) só gravava `financial_status = received` + `manual_status = true`, sem lançar o recebimento. O lançamento automático só entrou em `fca4c81` (16:26). O cliente foi marcado "Pago" às 16:21, entre os dois commits, e a função só roda na transição para `sale_paid` — não houve retroativo. O filtro "Todo período" não influenciava: ele só filtra a lista de vendas.
- **Correção:** (1) dado: 1 recebimento de R$ 9.000,00, `received`, data 01/10/2026, inserido com trava `NOT EXISTS`; (2) código: reparo idempotente `computeReceiptRepair` (`lib/financial-receipt-repair-core.mjs`) usado por `markFinancialSaleReceivedForRegistration` e pela rede de segurança `repairReceivedSaleMissingPayments` em `listFinancialSales` (só venda `received` + `manual_status` + cliente em `sale_paid`; lança só a diferença, nunca passa da comissão, não duplica).
- **Arquivos/commit:** `lib/financial.js`, `lib/financial-receipt-repair-core.mjs`, `tests/financial-receipt-repair.test.mjs` — ver commit com a mensagem "Financeiro: repara venda recebida sem recebimento lançado" (`git log`)
- **Prevenção/teste:** `node --test tests/financial-receipt-repair.test.mjs` (caso sem pagamento, parcial preservado, idempotência, teto, status não-recebidos, centavos). Consulta de auditoria: vendas `received` cuja soma de `financial_payments` (`received`) < `gross_commission`.
- **Status:** Resolvido

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
