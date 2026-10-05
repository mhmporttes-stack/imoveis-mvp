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

### 2026-10-05 — Cliente em "Simulação realizada" sem nenhuma simulação
- **Data:** 2026-10-05
- **Sintoma:** card em "Simulação realizada" mas com "Simulação ainda não realizada" (só renda/recurso do cadastro).
- **Área:** Clientes / Funil
- **Impacto:** 1 cliente em produção; risco de distorcer funil e previsões.
- **Causa raiz:** o seletor de etapa liberava "Simulação realizada" para qualquer cliente e o servidor não validava se havia simulação com valor (a regra só existia na pontuação e na marcação automática).
- **Correção:** trava no servidor + opção bloqueada na tela; cliente afetado voltou para "Aguardando simulação".
- **Arquivos/commit:** ver CHANGELOG_AI.md (2026-10-05)
- **Prevenção/teste:** `tests/simulation-status-lock.test.mjs`
- **Status:** Resolvido

### 2026-10-04 — WhatsApp individual: erro 440 a cada deploy e laços de reconexão (403/408/440/500/515)

- **Sintoma:** sessões do WhatsApp caindo com "conexão substituída" (440) bem na hora de um `git push`; contas em laço de reconexão por horas; sessão presa em "reconectando"; QR de conta já pareada reconectando de 2 em 2 s.
- **Causa raiz (confirmada no código e no Baileys 6.7.24):** (1) cada push em `main` republica o serviço no Railway; o novo sobe e o antigo só recebe SIGTERM 2–8 s depois — duas instâncias com a mesma sessão = 440; (2) antes de 04/10 qualquer código ≠401 reconectava a cada ~4 s para sempre (403 em laço de ~16–23 h); (3) `creds.registered` do Baileys só vira `true` no pareamento por código, então toda sessão pareada por QR era tratada como "não pareada" (retentativa de 2 s, 5 vezes, e gerando QR novo sozinha); (4) 515 consumia tentativa de reconexão e gravava `reconnecting`; (5) `reconnecting` podia ficar gravado sem nenhuma tentativa real.
- **Correção:** lease de dono único (`whatsapp_service_lease`), encerramento gracioso sem logout, mutex por sessão, retomada escalonada, reconciliação de estado preso, QR expirado sem retentativa automática, prova de pareamento por `creds.me`, 515 como reinício normal (laço >3/min para), 500 com janela (3 em 10 min), `watchPatterns`/`drainingSeconds` no `railway.json`. Detalhe: `docs/WHATSAPP.md` e `docs/CHANGELOG_AI.md` (2026-10-04, estabilização).
- **Não depende de nós:** 401/403 vêm do WhatsApp (desvinculou/recusou); `Stream Errored (ack)` é erro de stream enviado pelo servidor do WhatsApp (issue pública Baileys #1910: só rescanear o QR resolveu naquele caso).
### 2026-10-04 — Corretor com mais de 30 clientes na "Carteira ativa" (83/50, 60/50...)
- **Data:** 2026-10-04
- **Sintoma:** "alguns corretores continuam com mais de 30 clientes ativos na carteira"; card "Carteira ativa 83/50".
- **Área:** Meta Diária
- **Impacto:** 6 corretores acima do novo teto de 30 (Bruna 83, Eduardo 70, Caroline 60, Paulo 57, ketlin 55, Jennyfer 52...); 94 das rodadas contadas já não eram do corretor.
- **Causa raiz:** (1) o teto só impedia a ENTRADA, nunca removia o excedente de antes. (2) retorno automático de 7 dias, "Devolver" e reatribuição devolviam o contato à fila mas deixavam `daily_goal_rounds` ativa: rodada "zumbi" contada na carteira (e no card) de quem já não tinha o contato.
- **Correção:** teto 30 numa constante; `releaseActiveRoundsForContacts` nos 4 caminhos; migration `20261004200000` + `daily_goal_wallet_trim` (rebalanceamento manual com backup, auditoria e reversão).
- **Arquivos/commit:** `lib/daily-goal-round-release.mjs`, `lib/prospecting.js`, `lib/prospecting-auto-return.js`, `lib/daily-goal-wallet-core.mjs`, `supabase/migrations/20261004200000_meta_diaria_carteira_30.sql` — commit no `CHANGELOG_AI.md` de 2026-10-04.
- **Prevenção/teste:** `tests/daily-goal-carteira-30*.test.mjs`. Risco residual: o interruptor de bloqueio da carteira (Configurações) desliga o teto.
- **Status:** Resolvido (dados corrigidos pela Central; ver CHANGELOG_AI)

### 2026-10-04 — Corretor/associado via observações internas de empreendimento e podia apagar etiqueta de todos
- **Data:** 2026-10-04
- **Sintoma:** (achado de auditoria, sem relato de uso indevido) "Informações internas" do empreendimento visíveis a todo perfil; corretor/associado podia excluir ou recolorir etiqueta global pela ficha do cliente.
- **Área:** Permissões
- **Impacto:** vazamento de observações da gestão para corretor/associado (e para o código enviado ao navegador); exclusão de etiqueta apaga o vínculo de todos os clientes (23 etiquetas, 146 vínculos em produção) e o histórico de campanha.
- **Causa raiz:** páginas com `requireAdminPage` repassavam o objeto inteiro de `properties` (select *) sem filtro por perfil; rotas `client-tags` usavam só `requireAdminApi` (qualquer perfil) e o `POST` fazia upsert por nome (recolore); a lixeira aparecia para os 4 perfis.
- **Correção:** filtro no servidor por perfil efetivo (`lib/property-visibility*`); `DELETE` com `requireBrokerManagementApi`; `POST` não recolore para corretor/associado; lixeira só para admin/gestor.
- **Arquivos/commit:** `lib/property-visibility.js`, `lib/client-tags.js`, `app/api/client-tags/**`, `components/clients/ClientSheet.jsx` — commit no `CHANGELOG_AI.md` de 2026-10-04.
- **Prevenção/teste:** `tests/permissoes-tags-notas-internas.test.mjs`. Risco residual: `addTagToClient` (campanha/fluxo) ainda recolore por upsert.
- **Status:** Resolvido
### 2026-10-04 — WhatsApp individual: contas presas em laço de reconexão (403) por horas
- **Data:** 2026-10-04
- **Sintoma:** sessões em "reconectando" por ~22 h, ~15 h e 26 min com código 403, sem nunca voltar; telemetria só mostrava o último erro.
- **Área:** WhatsApp individual (serviço Railway)
- **Impacto:** 3 contas em laço de conexões repetidas contra o WhatsApp (risco de agravar restrição/bloqueio); impossível reconstruir quantas tentativas houve.
- **Causa raiz:** `onConnectionUpdate` só tratava 401 como fim; qualquer outro código (403, 440, 428...) reconectava em 4 s fixos, sem contador, teto nem backoff; o socket fechado não era encerrado com `end`/`removeAllListeners`; `resumeSessions()` reabria TODAS as sessões com credenciais a cada deploy; telemetria deduplicava em 10 min e só guardava erros; Baileys `^6.7.9` sem lockfile.
- **Correção:** política de reconexão pura (`reconnect-policy.js`): 403/440/411/códigos desconhecidos não reconectam (`status='error'`, `needs_attention:`), quedas recuperáveis com backoff+jitter e limite de 6 por ciclo, contador só zera após 3 min estável; retomada no boot só de sessões `connected`; telemetria append-only `whatsapp_session_telemetry`; Baileys fixado em 6.7.24 com `npm ci`. Detalhes: `docs/WHATSAPP.md`.
- **Arquivos/commit:** `whatsapp-individual-service/src/{reconnect-policy,session-lifecycle,telemetry,sessions,server,webhook}.js`, `app/api/webhooks/whatsapp-individual/telemetry/route.js`, `lib/whatsapp-session-telemetry*.{js,mjs}`, migration `20261004100000_whatsapp_session_telemetry.sql`
- **Prevenção/teste:** `tests/whatsapp-reconnect-policy.test.mjs`. Depois do deploy: `select event_type, count(*) from whatsapp_session_telemetry group by 1`. Risco residual: conta de 403 só volta por ação consciente (Conectar); `needs_attention` ainda não alerta a gestora.
- **Status:** Corrigido no código, aguardando aplicar a migration e publicar

### 2026-10-03 — Cliente devolvido à fila voltava para o dono; resposta pelo celular não contava como contato
- **Sintoma:** "o dono acumula clientes que a Prospecção devolveu" (~2 mil, 1.049 em "Tentando contato"); corretor que respondia pelo celular continuava aparecendo como "sem contato" (cobrança à toa / lead redistribuído pela roleta).
- **Causa raiz:** (1) a rede de segurança `reassignOrphanedClientsToOwner` (cron de 2 em 2 min) devolvia ao dono todo cliente sem responsável, sem distinguir quem a Prospecção zerou de propósito; (2) `recordBrokerAppMessage` (mensagem pelo celular) gravava só a conversa, nunca o cliente, e a conversa nascia sem `client_id`, fora da proteção da roleta.
- **Correção:** cron ignora cliente devolvido à fila (P-05); função única de contato humano para Chat e celular (P-11); trava na cadência da Meta Diária. Detalhes e arquivos: `docs/CHANGELOG_AI.md` (2026-10-03). Dado antigo (~1.049 com o dono) não alterado.

### 2026-10-02 — Entrada simulada diferente entre o Gerador de Simulações e a Apresentação (Casa Paulista)
- **Sintoma:** "O PDF/simulação não desconta o Casa Paulista" — o mesmo cliente e imóvel mostravam entradas diferentes conforme a tela.
- **Causa raiz:** o valor do Casa Paulista era uma constante escrita em dois componentes com valores diferentes: `EmpreendimentoPresentation.jsx` enviava 10000 e `SimulationGenerator.jsx` enviava 0 ao `/api/simular-entrada` (o motor só aplica se o empreendimento aceita). Nenhum campo de cadastro definia o valor.
- **Correção:** valor fixo único em `lib/simulacao-entrada/casa-paulista.mjs`, aplicado só no motor; clientes deixam de enviar o campo. Detalhes e arquivos: `docs/CHANGELOG_AI.md` (2026-10-02, T-48). Snapshots antigos não reescritos.

### 2026-10-02 — Alerta/mensagem enviado só para uma corretora apareceu para outras pessoas
- **Data:** 2026-10-02
- **Sintoma:** aviso direcionado a uma corretora apareceu também para outra corretora e para a gestora.
- **Área:** Automações/Notificações
- **Impacto:** nenhuma entrega indevida comprovada no banco (`crm_alert_deliveries` vazia; as mensagens de supervisão têm um único destinatário cada). Não há como provar o vazamento de push, que não fica gravado.
- **Causa raiz:** (1) PUSH: `push_subscriptions` é amarrada ao navegador (endpoint). `AdminPushSubscription` só assinava quando NÃO existia assinatura e nem rodava se o aviso tivesse sido dispensado; o logout não removia a assinatura. Em navegador/aparelho compartilhado, o push privado de quem usou antes continuava aparecendo para o próximo usuário. (2) `lib/crm.js` mostrava as notificações de TODOS ao admin geral (lista, contagem e marcar como lida). Alertas e Supervisão já filtravam por destinatário no backend (confirmado) e o realtime é só um "ping" sem conteúdo em tópico secreto por usuário.
- **Correção:** reassociação do push a cada carga + desassociação no logout; notificações só do próprio usuário; filtro extra por destinatário nas consultas de alerta/supervisão; modelo de audiência explícito.
- **Arquivos/commit:** ver CHANGELOG_AI.md (2026-10-02, alertas privados).
- **Prevenção/teste:** `tests/private-alerts.test.mjs`. Risco residual: Alexa falada é compartilhada por natureza.
- **Status:** Resolvido (causa de push inferida, não reproduzida)

### 2026-10-02 — Conversas/mensagens cruzando entre corretores no Chat
- **Data:** 2026-10-02
- **Sintoma:** mesmo depois do isolamento de visibilidade por hierarquia, dados de conversas ainda apareciam cruzados entre corretores (prévia/não lidas de outro número, resposta saindo pelo WhatsApp errado, mensagem entre colegas faltando numa das pontas).
- **Área:** WhatsApp
- **Impacto:** todo cliente que falou com o WhatsApp de mais de um corretor (e conversas entre integrantes da equipe); 16 conversas históricas misturavam mensagens de números diferentes.
- **Causa raiz:** UNIQUE(`contact_phone`) em `whatsapp_conversations` — uma conversa por telefone compartilhada por TODAS as sessões. Preview, não lidas, atribuição, status, `client_id` e o canal de envio (`assigned_user_id`) eram da conversa, não da sessão; a visibilidade filtrava só as mensagens depois. E o índice `(channel, wa_message_id)` era global: a mesma mensagem entre dois colegas (mesmo id nas duas pontas) era descartada na segunda sessão (`23505` tratado como duplicata).
- **Correção:** conversa = (`contact_phone`, `session_key`); dedupe por sessão; envio, visibilidade, não lidas e card usam a sessão. Histórico: ver CHANGELOG_AI de 2026-10-02.
- **Arquivos/commit:** ver CHANGELOG_AI.md (2026-10-02, "Chat: conversa passa a ser telefone + sessão")
- **Prevenção/teste:** `tests/whatsapp-conversation-per-session.test.mjs` roda o código real contra um banco falso com as mesmas travas (inclui a prova da causa raiz com o UNIQUE antigo).
- **Status:** Resolvido

### 2026-10-02 — Recebido em dobro no "Pago" e "1.500" lido como R$ 1,50 (Financeiro)
- **Data:** 2026-10-02
- **Sintoma:** (a) com nota fiscal/despesa na venda, confirmar a previsão de recebimento e depois mover o cliente para "Pago" podia lançar um 2º recebimento automático; (b) valor digitado "1.500" virava R$ 1,50 (campos da Saúde, do modal de recebimento e da Edição Financeira).
- **Área:** Financeiro
- **Impacto:** ainda nenhum dado errado em produção (auditoria dos dados: 7 vendas, 1 recebimento de R$ 9.000,00 = comissão bruta, nenhum recebido acima da bruta, nenhum valor de despesa/recebimento com cara de milhar mal lido). Risco real a partir da 1ª venda com nota/despesa recebida pelo fluxo da previsão; o lembrete da Agenda de 1 venda (bruta 30.000, despesa 10.000) mostrava R$ 20.000 e passa a mostrar R$ 30.000.
- **Causa raiz:** (a) duas definições de "recebido": `deriveFinancialStatus` e o reparo do "Pago" usavam a comissão BRUTA; Previsão/Confirmar recebimento/"A receber" usavam a LIVRE (bruta − nota − despesas). Confirmar o saldo livre marcava "Recebido"; o "Pago" então lançava a diferença até a bruta — dinheiro que ninguém confirmou. A Saúde (regra oficial do dono) já trata recebido como bruta. (b) `normalizeMoneyValue` (servidor, tela e modal tinham cópias) entregava texto sem vírgula direto a `Number()`, que lê o ponto como decimal; no padrão brasileiro é milhar.
- **Correção:** base única `lib/financial-receipt-basis.mjs` (alvo = bruta; recebido = pagamentos `received`; recebida ⇔ recebido ≥ bruta; saldo = max(0, bruta − recebido)) usada por status, reparo, previsão, confirmação, cura de status, "A receber" e Saúde; regra única de dinheiro brasileiro `lib/money-br.mjs` (1.500 = 1500; 1.500,50 = 1500,5; percentuais ficam de fora) substituindo as 3 cópias.
- **Arquivos/commit:** `lib/financial-receipt-basis.mjs`, `lib/money-br.mjs`, `lib/financial.js`, `lib/financial-expected-receipt-core.mjs`, `-db.mjs`, `lib/financial-receipt-repair-core.mjs`, `lib/financial-health-core.mjs`, `components/AdminFinancialDashboard.jsx`, `components/ReceiptActionModals.jsx` — commit no `git log` ("Financeiro: base única de recebimento e valor brasileiro").
- **Prevenção/teste:** `tests/money-br.test.mjs` e 3 testes novos em `tests/financial-expected-receipt.test.mjs` (venda com nota: previsão bruta e sem sobra para o "Pago"; parcial na livre completa só a diferença; invariante aleatória: confirmações + reparo nunca passam da bruta).
- **Status:** Resolvido

### 2026-10-02 — Segundo proponente recebia pendência de comprovante de residência
- **Data:** 2026-10-02
- **Sintoma:** análise documental exigia comprovante de residência do SEGUNDO PROPONENTE ("Renda informal exige comprovante em nome do próprio cliente.").
- **Área:** Documentação/CCA
- **Impacto:** qualquer lote com comprovante do segundo proponente/cônjuge (renda informal ou CLT) — pendência indevida na devolutiva e no PDF.
- **Causa raiz:** `residenceDecision` e a validação de fonte (`lib/document-analysis.js`) rodavam para todo item `comprovante_residencia` sem olhar `personRole`, comparando o documento com o nome/renda do titular. A regra "só do principal" não existia em lugar nenhum.
- **Correção:** regra única em `lib/document-policy.mjs`, aplicada na análise, em `residenceDecision` e em todo recálculo (limpa também análises já gravadas).
- **Arquivos/commit:** ver `docs/CHANGELOG_AI.md` 2026-10-02.
- **Prevenção/teste:** `tests/document-second-proponent-residence.test.mjs` (principal informal mantém regra; 2º informal e 2º CLT sem pendência; reanálise idempotente).
- **Status:** Resolvido

### 2026-10-02 — Automação da Meta Diária do número do dono religou sozinha depois de um deploy (20 envios agendados)
- **Data:** 2026-10-02
- **Sintoma:** número do dono, que não deve fazer disparo automático, voltou a ficar com a automação ligada e 20 envios na fila para as 07:00.
- **Área:** Meta Diária / Infra
- **Impacto:** nenhum envio feito (cancelado às 04:17, antes da janela); só o número do dono.
- **Causa raiz:** o deploy na Vercel do commit que exclui o dono de `ensureDailyGoalAutoEnabledOnConnect` (1ddebba) **falhou**; a trava só entrou com o deploy seguinte (d92e9f7, pronto às 07:08:07Z). Todo push na `main` também reinicia o microsserviço no Railway, que reconecta as sessões e chama o webhook `connected`; a reconexão do dono chegou às 07:08:08Z e ainda foi atendida pela versão antiga (sem a consulta do e-mail em `admin_users` nos logs do Supabase), que religou a automação; o cron das 07:10 montou a fila.
- **Correção:** automação do dono desligada e 20 itens `pending` cancelados (`automacao_desligada`). Código já correto em produção desde d92e9f7.
- **Arquivos/commit:** `lib/daily-goal-auto.js` — commit `1ddebba` (falhou na Vercel), no ar via `d92e9f7`
- **Prevenção/teste:** depois de um push que muda comportamento de produção, confirmar o status do deploy da Vercel no commit (não só o do Railway) antes de dar por publicado. Risco residual: todo push reinicia o WhatsApp e a reconexão pode cair na versão anterior da Vercel por alguns segundos.
- **Status:** Resolvido

### 2026-10-02 — "Conectar com código" do WhatsApp não funciona no celular (código não aparece / some / dá erro ao conectar)
- **Data:** 2026-10-02
- **Sintoma:** no celular (sem como escanear o QR), "Pedir código" não mostrava código; depois mostrava por ~1 s; depois o WhatsApp dizia "Não foi possível conectar o dispositivo".
- **Área:** WhatsApp individual (serviço Railway)
- **Impacto:** nenhum corretor conseguia conectar pelo celular só com o código.
- **Causa raiz:** cinco falhas em cadeia em `whatsapp-individual-service/src/sessions.js`/`webhook.js`: (1) número enviado sem o 55 → WhatsApp recusava (logged_out); (2) código pedido antes de a conexão abrir e com nome de navegador personalizado → "Connection Closed"; (3) `notifyStatus` descartava o `pairingCode` → o CRM não gravava e a tela apagava o código; (4) código antigo sobrevivia no banco ao reinício do serviço; (5) após o celular aceitar o código, o "restart required" do WhatsApp era tratado como "começar do zero" e apagava as credenciais recém-registradas.
- **Correção:** `normalizePairingNumber` (55), espera do 1º QR + `Browsers.macOS("Chrome")` no modo código, `pairingCode` repassado ao CRM e preservado na tela, código expira em 3 min/limpo em qualquer outro status, sockets aposentados ignorados, reconexão pós-pareamento sai do modo código e espera a gravação das credenciais.
- **Arquivos/commit:** `whatsapp-individual-service/src/{sessions,webhook,pairing-number}.js`, `lib/whatsapp-individual.js`, `app/api/admin/whatsapp-individual/status/route.js`, `components/WhatsappIndividualStatus.jsx` — commits `ac8d29d`, `2cdd56f`, `002897b`, `965d024`, `36e697d`, `d0b07b9`
- **Prevenção/teste:** `tests/whatsapp-individual-extract.test.mjs` (normalização do número). Validado pelo dono: conectou pelo celular com código em 02/10 03:42. Atenção: todo push reinicia o serviço no Railway — não pedir código durante um deploy.
- **Status:** Resolvido

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
- **Etapa 2b (dados, 2026-10-02, confirmada pela Caroline):** …3947 respondeu em 28/09 à tarde; …2973 é o Alex que ela já atendia desde fevereiro. Backup em `p01s3_backup_20261002_*` (8 tabelas). Em uma transação: cards próprios #C4523 (Alex, …2973) e #C4524 (…3947, nome "Sem Nome"), responsável Caroline, `awaiting_return`, `acquisition_context.fix = p01-stage2b-20261002`; contatos, a rodada/tentativa/histórico de cada telefone (…3947 incl. `in_service`/`converted`) e a conversa do Chat do Alex re-apontados para o card próprio; …0409 permanece em #C3846 (que mantém as 17 rodadas de outros contatos e todo o histórico de status/jornada). Sem recálculo nem pontos novos (impressão digital das fontes do ranking idêntica; cards criados por SQL não geram `client_status_history`). Os cards criados hoje contam "Novo cliente" só na linha da gestora (fora do ranking).
- **Status:** Resolvido em parte — pendente só #C3919 (4 contatos, aguardam confirmação da Jennyfer)

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
