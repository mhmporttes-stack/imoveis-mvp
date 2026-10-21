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
### 2026-10-21 — Conversa do Marketplace com "Pressione Enter, Mensagem enviada … por …" e foto do cliente como anexo
- **Data:** 2026-10-21
- **Sintoma:** no Chat Marketplace (Rafael/Tânia) cada mensagem aparecia como "Pressione Enter, Mensagem enviada 10:18 por Você: …", mensagens nossas como do cliente, a foto de perfil como anexo, balões vazios "por Rafael", "Rafael está aguardando a sua resposta." como mensagem do cliente e mensagens de 28/09 depois das de hoje. Também: conversas gravadas sem mensagem (upsert batia num índice único parcial, 42P10 — corrigido em 7b4b373).
- **Área:** Chat Marketplace / extensão
- **Impacto:** todas as conversas importadas até 21/10 (Rafael 11, Tânia 9 mensagens).
- **Causa raiz:** o leitor usa o aria-label do balão (texto de acessibilidade do Facebook) como corpo; direção vinha de marcadores visuais; imagem ≥ 80 px de origem do avatar passava como anexo; hora era inventada a partir da última atividade.
- **Correção:** `normalizeFacebookMessage`/`parseFacebookWhen` (`lib/marketplace-chat-core.mjs`) extraem texto, hora e QUEM ("Você"/"You" = nossa) na sincronização; avatar e avisos descartados; ordem pela hora real. Já gravado: `renormalizeMarketplaceMessages` (rota manual `/api/cron/marketplace-messages-renormalize`, `?apply=1`). Extensão 1.8.11 não pega avatar como anexo.
- **Arquivos/commit:** `lib/marketplace-chat-core.mjs`, `lib/marketplace-chat.js`, `app/api/cron/marketplace-messages-renormalize/route.js`, `ferramentas/marketplace-publicador/inbox.js`
- **Prevenção/teste:** `tests/marketplace-chat-core.test.mjs` (strings exatas do caso)
- **Status:** Resolvido no código; dados antigos dependem do acionamento da rota com `apply=1`
### 2026-10-20 — Pedido da lista de documentos respondido com o menu de boas-vindas
- **Data:** 2026-10-20
- **Sintoma:** cliente mandou ao oficial o texto pronto "…Pode me mandar a lista do meu caso? Código do atendimento: MM-…" e o robô respondeu "Boa tarde… Como podemos te ajudar?" com os botões Fazer simulação / Já sou cliente / Tenho uma dúvida.
- **Área:** WhatsApp / Fluxos / Apresentação
- **Impacto:** todo cliente que pede a lista (ou usa outro botão do link) e cuja conversa casa um Fluxo de primeira mensagem/qualquer mensagem; o corretor precisou mandar a lista à mão.
- **Causa raiz:** o filtro pós-formulário (`filterFlowsForPostFormContact`) só conhecia a frase "preenchi meu cadastro" e cadastro por formulário nas últimas 24 h; mensagem com o código do atendimento (PRES-25) de cadastro mais antigo caía nos gatilhos automáticos de boas-vindas.
- **Correção:** mensagem com código = cliente já cadastrado (só Fluxo de palavra-chave, sem resposta antiga por palavra-chave); pedido da lista com código não dispara Fluxo e é respondido pela lista automática (PRES-26).
- **Arquivos/commit:** `lib/whatsapp-form-completion.mjs`, `lib/whatsapp-flows.js`, `lib/whatsapp-master.js`, `lib/documents-list-auto*.{js,mjs}`
- **Prevenção/teste:** `tests/documents-list-auto.test.mjs` (texto exato do caso)
- **Status:** Resolvido (aguarda deploy)
### 2026-10-20 — Cliente "clica em documentos e não prossegue" na apresentação /s/
- **Data:** 2026-10-20
- **Sintoma:** na cena "Documentos" ("…vamos montar a sua pasta…") só aparece "Rever a apresentação"; não há botão "Receber lista de documentos" (nem "Agendar atendimento" no "Próximo passo").
- **Área:** Apresentação da simulação (PRES-17/PRES-22/PRES-25)
- **Impacto:** todos os clientes cujo responsável não tem telefone no cadastro de usuário — hoje só o dono (28 apresentações ativas). Caso relatado: cliente do dono que abriu o link às 12h36 e tocou 3× em "Ver o que preciso para avançar".
- **Causa raiz:** o botão (`podeReceberLista`) ainda exigia o WhatsApp PESSOAL do responsável (`resolveReceiveSimulationContact`, regra do tempo em que o cliente ia ao WhatsApp do corretor). Desde 2026-10-09/18 o contato vai ao número OFICIAL (`buildBrokerWhatsappUrl`), então o telefone pessoal não era usado, mas continuava escondendo o botão.
- **Correção:** `isPresentationContactReady` (`lib/receive-simulation-contact.mjs`): basta responsável ATIVO — usado no DTO (`lib/simulation-presentation.js`), na confirmação (`lib/documents-forecast-store.mjs`, status/agenda) e no agendamento (`lib/client-appointments.js`). Botão volta sozinho no mesmo link (sem reenviar).
- **Arquivos/commit:** ver `git log` de 2026-10-20 ("Apresentação: botão da lista de documentos…").
- **Prevenção/teste:** `tests/documents-forecast.test.mjs` (responsável sem telefone recebe status/agenda), `tests/receive-simulation-contact.test.mjs`. Diagnóstico: `simulation_presentation_events` (toques sem `lista` na cena 8) + `admin_users.phone` do responsável.
- **Status:** Corrigido

### 2026-10-19 — Corretor manda mensagem pelo WhatsApp Web e o cliente volta para a fila mesmo assim
- **Data:** 2026-10-19
- **Sintoma:** "ele clica no WhatsApp, abre o WhatsApp Web, envia a mensagem, mas ela não aparece no Chat e o cliente vai para outro corretor".
- **Área:** WhatsApp individual / Roleta (FUN-15l)
- **Impacto:** 1 corretor; 5 clientes da fila de reativação com Chat aberto no prazo e devolvidos sem mensagem registrada.
- **Causa raiz:** (1) pela sessão pessoal o Chat só responde (proteção de 2026-10-05): cliente que nunca escreveu → botão de enviar pelo celular/Web; (2) a sessão do CRM não decifrava as cópias das mensagens enviadas pelo celular dele (`diag_decrypt_fail` from_me), então o envio não virava contato humano.
- **Correção:** CRM aceita o evento `undecrypted_message` e o conta como contato; restrição aberta tira da roleta. Pendentes: o microsserviço emitir o evento e a decisão do dono sobre a 1ª mensagem pelo Chat — ver `CHANGELOG_AI.md` (2026-10-19).
- **Arquivos/commit:** `lib/whatsapp-undecrypted-core.mjs`, `lib/whatsapp-individual-inbound.js`, `app/api/webhooks/whatsapp-individual/route.js` — ver `git log` de 2026-10-19
- **Prevenção/teste:** `tests/whatsapp-undecrypted.test.mjs`. Diagnóstico: `admin_presence_activity` (kind `grace`) + `whatsapp_conversations` criadas na sessão × `lead_distribution_history`.
- **Status:** Diagnosticado, correção parcial (serviço pendente)
### 2026-10-19 — Corretor recebe cliente e o WhatsApp diz que ele não tem acesso
- **Data:** 2026-10-19
- **Sintoma:** "o corretor está recebendo clientes e, ao clicar no WhatsApp do card, aparece que ele não tem acesso ao cliente — mesmo dentro do prazo".
- **Área:** Roleta / fila de reativação (FUN-15l), WhatsApp/Chat
- **Impacto:** 1 corretor, 10 clientes em ~2 h; nenhum dado errado.
- **Causa raiz:** não era permissão quebrada. Cada cliente da fila de reativação voltava ao dono 3,5–4,5 min depois da entrega (prazo de 3 min sem mensagem; cron de 2 min). O aviso "Cliente transferido para você" continuava no sino e o corretor o abria depois disso; aí `openChatForClient` recusava com o genérico "Você não tem acesso a este cliente.".
- **Correção:** decisão do dono: prazo de 5 min, contagem regressiva no aviso, "Prazo encerrado — o cliente voltou para a fila" e mensagem específica no clique — ver `CHANGELOG_AI.md` (2026-10-19, FUN-15l).
- **Arquivos/commit:** `lib/cooled-clients-reactivation*.{js,mjs}`, `lib/whatsapp-chat.js`, `components/cooled/ReactivationNoticeStatus.jsx` — ver `git log` de 2026-10-19
- **Prevenção/teste:** `tests/cooled-reactivation-queue.test.mjs` (prazo, estados do aviso, mensagem do clique). Diagnóstico: `lead_distribution_history` (`trigger` da devolução) × `crm_notifications.read_at`.
- **Status:** Resolvido (aguardando deploy)
### 2026-10-19 — Corretora enviou a simulação mas o Chat diz que não enviou e não deixa mandar mensagem
- **Data:** 2026-10-19
- **Sintoma:** "já enviei a simulação (o link está no Chat), mas o sistema diz que ainda não enviei e não consigo mandar mensagens"; também recusa marcar "Simulação enviada".
- **Área:** WhatsApp/Chat, Clientes (ROL-4c, FUN-13)
- **Impacto:** clientes da roleta cuja apresentação saiu pelo número oficial como botão e sem evento `presentation_sent` (1 caso relatado; 20 clientes com esse formato de mensagem, quase todos com o evento).
- **Causa raiz:** pelo oficial a apresentação vai como botão "Visualizar simulação" e o texto gravado não tem o link (fica em `metadata.link.url`); a evidência única (`lib/simulation-sent-evidence.js` + `-lock-core.mjs`) procurava `/s/` só no texto.
- **Correção:** evidência lê também `metadata.link.url` (só link de apresentação, não o do formulário). Sem alteração de dados.
- **Arquivos/commit:** `lib/simulation-sent-lock-core.mjs`, `lib/simulation-sent-evidence.js` — ver `git log` de 2026-10-19
- **Prevenção/teste:** caso novo em `tests/simulation-sent-lock.test.mjs`. Regra: quem mudar o formato gravado de uma mensagem do Chat confere os leitores que procuram texto nela.
- **Status:** Resolvido (aguardando deploy)
### 2026-10-19 — Mensagem automática do corretor chega ao cliente mas não aparece no celular dele (reincidência de 2026-10-16)
- **Data:** 2026-10-19
- **Sintoma:** disparos automáticos (Meta Diária/fila) do WhatsApp do corretor aparecem no Chat do CRM, mas não no celular nem no WhatsApp Web dele.
- **Área:** WhatsApp individual (microsserviço Railway)
- **Impacto:** corretor do relato: 7 de 7 automáticas do dia (todas ENTREGUES ao cliente — `delivered_at` preenchido, mesmo número/sessão, nenhum JID errado); provável em todos os números.
- **Causa raiz:** o celular não decifra a cópia (`deviceSentMessage`) e pede reenvio pelo LID — em todas. (1) O pedido chega enquanto o `sendMessage` do Baileys ainda grava as chaves no banco (commit da transação depois de mandar), antes de a mensagem entrar no cache → `send_retry_missing` (4 de 7); (2) quando estava no cache, o reenvio do próprio Baileys (`sendMessagesAgain` sem participant = "para todos") não força sessão nova com o celular e reusa a que falhou — o celular pediu de novo 2 h depois (3 de 7); (3) cache de 30 min não cobria esse 2º pedido.
- **Correção:** id escolhido antes do envio e marcado "em andamento" — pedido e `getMessage` esperam o fim do envio (até 20 s); pedido do próprio celular sempre reenviado à mão só ao aparelho que pediu, com sessão nova (`resendOwnDeviceRetry`); cache 6 h. Detalhe: `docs/WHATSAPP.md` §1-H.
- **Arquivos/commit:** `whatsapp-individual-service/src/send-retry.js`, `whatsapp-individual-service/src/sessions.js` — commit desta data.
- **Prevenção/teste:** `tests/whatsapp-send-retry.test.mjs`. Verificar após deploy no Railway: `send_retry_rcpt` com `kind = manual_own_device` seguido de `send_retry_resent` e `send_retry_missing own_device` caindo para ~0 (`whatsapp_session_telemetry`).
- **Status:** Diagnosticado, correção pendente de deploy no Railway e de confirmação no celular do corretor.

### 2026-10-19 — "Criar cadastro" na nova simulação não cria o cliente (renomeia outro com o mesmo WhatsApp)
- **Data:** 2026-10-19
- **Sintoma:** em Simulações › Nova, o corretor preenche o cadastro do cliente, clica "Criar cadastro" e o cliente não aparece em Clientes; um cliente antigo com o mesmo WhatsApp aparece com o nome novo.
- **Área:** Clientes / Simulação
- **Impacto:** qualquer perfil, sempre que o WhatsApp digitado já existia num cliente do mesmo responsável (inclusive arquivado ou Particular, que nem aparecem na lista). Dados do cliente antigo (nome, telefone, renda etc.) sobrescritos sem aviso.
- **Causa raiz:** `ensureManualSimulationRegistration` (sem `registrationId`) procura cliente pelo telefone (`findMatchingRegistration`) e, achando, ATUALIZA esse cliente — comportamento pensado para os fluxos automáticos. A tela mostrava "Cadastro do cliente salvo." no fim da página, longe do botão. Salvar a simulação sem cadastro (`lib/simulations.js`) também renomeava o cliente achado pelo telefone. Não tem relação com as mudanças de Entrada/FGTS/"Primeiro imóvel" do mesmo dia; número da equipe não bloqueia cadastro manual (WA-12).
- **Correção:** o "Criar cadastro" manda `onPhoneMatch: "ask"`: achando cliente com o mesmo WhatsApp, nada é gravado e a rota responde 409 "Já existe um cliente com este WhatsApp: C… — Nome (status, Particular). Nada foi alterado."; a tela oferece "Abrir este cadastro" (só carrega) ou "Criar novo atendimento" (`onPhoneMatch: "create"`, regra 5). Sucesso/erro aparecem junto do botão ("Cliente C… criado."). Salvar a simulação só vincula, com `keepExistingIdentity`. Demais chamadores inalterados.
- **Arquivos/commit:** `lib/simulation-registrations.js`, `app/api/simulation-registrations/manual/route.js`, `components/SimulationGenerator.jsx`, `lib/simulations.js` — ver `git log`.
- **Prevenção/teste:** `tests/manual-registration-phone-match.test.mjs`.
- **Status:** Resolvido (dados já sobrescritos não foram desfeitos — decisão do dono).

### 2026-10-19 — Link de apresentação /s/ dá 404 depois de "Refazer simulação automática"
- **Data:** 2026-10-19
- **Sintoma:** o link `/s/<token>` de um cliente cuja simulação já tinha sido conferida ("Simulação OK") passou a mostrar "This page could not be found" logo depois de o corretor clicar "Refazer simulação automática".
- **Área:** Simulação / Apresentação (SIM-AUTO)
- **Impacto:** todo cliente com conferência já fechada (OK/corrigida) em que se clicasse "Refazer" (ou "Usar este cenário" não conferido): link em 404 e nenhuma conferência pendente gravada (os 👍/👎 da tela, guiados por `createdBy`, ainda liberavam; o OK/correção não era registrado).
- **Causa raiz:** o 404 em si é o portão SIM-AUTO (`resolvePublicPresentation`, simulação voltou a ser automática). O defeito: `saveAutoSnapshot(newRound)` tenta inserir uma conferência nova, mas a migration 20261019200000 nunca foi aplicada — o índice único antigo por `simulation_id` devolvia 23505 e a função só registrava aviso e devolvia `false`, deixando a simulação automática sem conferência pendente.
- **Correção:** sem a migration, o "Refazer" reabre a linha existente como `pending` (limpa revisor/correção) e guarda a rodada anterior em `auto_snapshot.previousRounds` (`snapshotWithPreviousRound`). Link bloqueado agora mostra "Esta apresentação está sendo atualizada pelo seu corretor" em vez do 404 cru (demais motivos seguem 404).
- **Arquivos/commit:** `lib/simulation-auto-reviews.js`, `lib/simulation-auto-review-core.mjs`, `lib/simulation-presentation.js`, `app/apresentacao/[token]/page.jsx` — ver `git log`
- **Prevenção/teste:** `tests/simulation-auto-status.test.mjs` (reabertura + página amigável). Cliente do caso continua com a conferência 'ok' antiga: basta clicar 👍 (ou "Refazer" de novo, já corrigido) para liberar.
- **Status:** Resolvido
### 2026-10-18 — iPhone ainda dá zoom ao tocar no "Valor" da Estratégia (depois de cbef8ae)
- **Data:** 2026-10-18
- **Sintoma:** em `/s/<token>`, ao tocar/digitar no campo "Valor" da folha "ESTRATÉGIA COM AMORTIZAÇÃO", a página amplia ~1,3x (texto todo maior e deslocado) e não volta.
- **Área:** Apresentação da simulação (PRES-24) / Frontend
- **Impacto:** cliente no link `/s/`, só iPhone (Safari e Chrome iOS = WebKit). Prévia do corretor não (já tinha `maximumScale: 1` pelo layout raiz).
- **Causa raiz:** zoom automático de foco do WebKit iOS liberado pelo viewport da página pública (`maximumScale: 5`), somado ao `touch-action: pan-y` da `.root`, que impede desfazer com pinça. A fonte do campo já era 17px e nenhum ancestral da folha aplica `transform`/`zoom` (hipótese de escala descartada no código), mas o iOS ainda pode ampliar o campo focado quando o viewport permite.
- **Correção:** `maximumScale: 1` só na apresentação pública (`lib/presentation-viewport.mjs`), `userScalable` mantido `true` — no iOS 10+ a pinça manual continua liberada.
- **Arquivos/commit:** `lib/presentation-viewport.mjs`, `app/apresentacao/[token]/page.jsx` — commit desta data.
- **Prevenção/teste:** `tests/presentation-viewport.test.mjs`. O Playwright WebKit (Linux) não reproduz o zoom de foco do iOS — confirmar no iPhone.
- **Status:** Monitorando — confirmar no iPhone do dono.
### 2026-10-18 — iPhone: tela da Estratégia fica "mais larga" que a tela depois de digitar (cortada à direita, não volta)
- **Data:** 2026-10-18
- **Sintoma:** na folha "ESTRATÉGIA COM AMORTIZAÇÃO" do `/s/<token>`, depois de digitar um valor os cards e textos saem pela borda e a tela fica "com zoom" sem voltar.
- **Área:** Apresentação da simulação (PRES-24) / Frontend
- **Impacto:** cliente no link `/s/` e corretor na prévia, celulares estreitos (reproduzido a 320 e 375 px; iPhone com fonte do sistema mais larga tende a pegar 390 px).
- **Causa raiz:** botões da cena "Próximo passo" com `white-space: nowrap`; o rótulo novo "ESTRATÉGIA COM AMORTIZAÇÃO" deixava a cena mais larga que a tela. A raiz da apresentação (`position: fixed; overflow: hidden`) virava área rolável por programa e, ao focar/digitar no campo da folha, o navegador a rolava para o lado (scrollLeft 8–33 px) — sem gesto para desfazer. Não era (só) o zoom de foco do incidente anterior.
- **Correção:** raiz com `overflow: clip`; botões do "Próximo passo" com `max-width: 100%`/`min-width: 0` e quebra quando não cabem; folha com rede de segurança de largura (textos quebram, colunas empilham, número com `clamp`). Achado junto: cursor da máscara dentro do ",00" ("99999" → R$ 90.000,00), corrigido.
- **Arquivos/commit:** `components/presentation/presentation.module.css`, `components/presentation/StrategySheet.jsx` — commit desta data.
- **Prevenção/teste:** `tests/strategy-sheet-layout.test.mjs`; Playwright Chromium+WebKit 320/375/390/430 px (raiz sem rolagem lateral antes/depois de digitar). Regra geral: nada de `nowrap` sem `max-width` dentro da `.root`.
- **Status:** Monitorando — confirmar no iPhone do dono.

### 2026-10-18 — iPhone dá zoom ao tocar em "Valor extra por mês" e não volta
- **Data:** 2026-10-18
- **Sintoma:** no Safari do iPhone, ao tocar no campo de valor da folha "ESTRATÉGIA COM AMORTIZAÇÃO" a tela ampliou e não voltou ao normal.
- **Área:** Apresentação da simulação (PRES-24) / Frontend
- **Impacto:** cliente no link `/s/` e corretor na prévia, só no iPhone.
- **Causa raiz:** iOS amplia campos com fonte < 16px ao receber foco. A fonte dos campos era `max(16px, calc(var(--u) * 17))` — 16px na emulação Chromium, mas dependente de `--u` (svh/var). **Não reproduzido em WebKit real** neste ambiente (sem iPhone). O "não volta" é explicado por `touch-action: pan-y` em `html`/`body`/`.root` da apresentação, que bloqueia o gesto de pinça para desfazer o zoom.
- **Correção:** fonte FIXA de 17px nos campos de valor e no seletor de mês no celular (sem depender de `--u`); tela larga continua escalando. Zoom de acessibilidade não bloqueado (sem `maximum-scale=1`). `touch-action` não alterado.
- **Arquivos/commit:** `components/presentation/presentation.module.css` — commit desta data.
- **Prevenção/teste:** emulação iPhone 390px confere 17px nos três campos. Risco residual: se ainda ampliar no iPhone, investigar o deslocamento do teclado com a raiz `position: fixed` e o `touch-action: pan-y`.
- **Status:** Monitorando — confirmar no iPhone do dono.

### 2026-10-18 — Botão "ESTRATÉGIA COM AMORTIZAÇÃO" não aparece no "Próximo passo" do link /s/
- **Data:** 2026-10-18
- **Sintoma:** cliente abre o link da apresentação e não há o botão da estratégia na cena "Próximo passo".
- **Área:** Apresentação da simulação (PRES-24)
- **Impacto:** 188 de 211 simulações dos últimos 30 dias sem o botão.
- **Causa raiz:** a base da estratégia exige financiamento, taxa e prazo no modelo destacado. A taxa é opcional (só 41 gravadas) — corrigido deduzindo da parcela. Mas a causa principal é o PRAZO em branco (127 simulações; campo existe desde 2026-10-08) — não corrigido, depende do dono.
- **Correção:** `deduceAnnualRate` em `buildPaymentStrategyBase` (taxa deduzida, `taxaEstimada`, sem exibir como taxa do contrato). Botão 23 → 26 das 211.
- **Arquivos/commit:** `lib/payment-strategy-core.mjs`, `lib/simulation-presentation-core.mjs` — commit desta data.
- **Prevenção/teste:** `tests/payment-strategy.test.mjs` (casos reais anônimos com taxa conhecida). Para checar um link sem botão: o modelo destacado tem prazo (meses) e parcela?
- **Status:** Resolvido — decisão do dono no mesmo dia: prazo padrão 420 na estratégia + prazo/taxa obrigatórios no Gerador; botão em 152 das 211 (58 sem valores, 1 prazo inválido).
### 2026-10-17 — Mensagem disparada pela automação não aparece no Chat (corretor só vê a resposta do cliente)
- **Data:** 2026-10-17
- **Sintoma:** "a mensagem no WhatsApp não carrega a mensagem que foi disparada ... o povo não sabe o que foi mandado" — o cliente responde e a conversa no Chat mostra só a resposta.
- **Área:** WhatsApp / Meta Diária
- **Impacto:** todos os corretores com a automação da Meta Diária ou o "Disparar" (fila extra) ligados — toda mensagem automática desde o início da automação (29/09); também a confirmação de descadastro ("SAIR").
- **Causa raiz:** o envio automático (`processClaimedItem`, `lib/daily-goal-auto.js`) gravava a mensagem só em `daily_goal_auto_queue`, nunca em `whatsapp_messages`. O serviço do WhatsApp descarta o eco do próprio envio nos primeiros 60 s (`APPEND_OWN_SEND_GRACE_MS`) e o eco que chegava depois era descartado de propósito como `eco_automacao` (`recordBrokerAppMessage`). Não era dedupe nem número/conversa errados: a linha simplesmente nunca era criada.
- **Correção:** depois do envio, linha de **Automação** no Chat na conversa (telefone, dono, número que enviou), criada se não existe (`recordIndividualAutomationMessage`); o eco grava a mesma linha como Automação se faltar; o recibo de entrega continua marcando a fila (senão o monitor/pausa por entrega baixa da MD-15 pararia de ver as entregas). Não é contato humano. Mensagens antigas: backfill proposto em `docs/sql-manual/chat-mensagens-automaticas-backfill.sql` (não aplicado).
- **Arquivos/commit:** `lib/whatsapp-automation-chat-core.mjs`, `lib/whatsapp-individual-inbound.js`, `lib/daily-goal-auto.js`, `lib/prospecting-reply.js` — commit desta data.
- **Prevenção/teste:** `tests/whatsapp-automation-chat.test.mjs`. Depois do deploy: `select count(*) from whatsapp_messages where sender_type='automation' and metadata->>'kind'='daily_goal_auto'` deve crescer junto com os envios da fila. Risco residual: Disparo em massa (número Oficial) também não aparece no Chat — fora deste escopo.
- **Status:** Resolvido (verificação em produção A CONFIRMAR após o deploy)

### 2026-10-17 — Chat com clientes duplicados (mesmo cliente duas vezes na lista)
- **Data:** 2026-10-17
- **Sintoma:** "Observando o chat da corretora, tem muitos clientes duplicados."
- **Área:** WhatsApp / Chat
- **Impacto:** corretores com 2 números conectados; na corretora do relato, 5 clientes repetidos na lista e contadores contados em dobro.
- **Causa raiz:** não era cadastro duplicado. Conversa = telefone + dono + número (WA-15): o cliente que falou com o Número 1 e com o Número 2 (ex.: disparo dividido entre os dois) tem duas conversas, e a lista/contadores mostravam uma linha por conversa.
- **Correção:** agrupamento só na leitura (WA-34, `lib/whatsapp-chat-siblings.mjs`): uma linha por cliente, abertura com as mensagens dos dois números, contadores contam uma vez. Detalhe no `CHANGELOG_AI.md` (2026-10-17).
- **Arquivos/commit:** `lib/whatsapp-chat-siblings.mjs`, `lib/whatsapp-chat.js`, `components/WhatsappChat.jsx`
- **Prevenção/teste:** `tests/whatsapp-chat-siblings.test.mjs`.
- **Status:** Resolvido (verificação em produção com a lista da corretora A CONFIRMAR após o deploy)

### 2026-10-17 — Ícone do Chat sumiu e não volta mesmo com o WhatsApp conectado
- **Data:** 2026-10-17
- **Sintoma:** corretora relata que "o ícone de chat sumiu"; no banco os dois números dela estavam conectados.
- **Área:** WhatsApp / Frontend (modo lista impressa, PRO-15)
- **Impacto:** corretor/associado que passou pelo modo lista impressa e reconectou: o Chat seguia fora da barra/menu até fechar e reabrir o app.
- **Causa raiz:** `chatHidden` era calculado só no layout do painel (Server Component), que não é renderizado de novo na navegação dentro do app instalado; nada relia o estado depois de reconectar. Hipótese de que quedas automáticas (428/500/503/515) contavam como desconexão manual foi **refutada**: o serviço grava `reconnecting`/`connecting` nessas quedas (`session-lifecycle.js`), lido como TRANSIENT; com 2 números, um no ar já basta. Nos últimos 4 dias a corretora só teve quedas `reconnecting` (nenhum momento com os dois números fora do ar), então **a causa exata do relato dela não foi confirmada** — falta saber qual ícone/aparelho/horário.
- **Correção:** `WhatsappAccessProvider` passa a manter o valor vivo: relê `printedListMode` de `/api/admin/whatsapp-individual/card-state` ao voltar o app ao primeiro plano e, enquanto o Chat estiver escondido, a cada 20 s (só corretor/associado); barra inferior e menu do topo leem esse valor (`useLiveChatHidden`). Só apresentação; APIs do Chat continuam barradas no servidor.
- **Arquivos/commit:** `components/WhatsappAccessProvider.jsx`, `app/admin/layout.jsx`, `components/AdminBottomNav.jsx`, `components/AdminMenu.jsx`.
- **Prevenção/teste:** `tests/whatsapp-manual-disconnect.test.mjs` (status real gravado pelo serviço em 428/500/503/408/515 → TRANSIENT; 401 continua modo lista impressa; barra dentro do provider).
- **Status:** Monitorando (causa do caso concreto a confirmar com print/aparelho).

### 2026-10-16 — Janela "cliente esfriou" troca de cliente sozinha antes de o corretor escrever o motivo
- **Data:** 2026-10-16
- **Sintoma:** a corretora sai para pesquisar a conversa do cliente e, quando volta, a janela do motivo já mostra outro cliente.
- **Área:** Clientes que esfriaram (FUN-15) / Central de Alertas
- **Impacto:** corretores com backlog grande de clientes esfriados (mais de ~50 pendências na Central); janela trocava a cada releitura (tempo real, intervalo de 60 s, recarregar).
- **Causa raiz:** `listMyPendingAlerts` (`lib/crm-alerts.js`) lia no máximo 50 pendências ordenadas só por `created_at`; as entregas do backlog nascem na mesma rodada do cron com o MESMO `created_at`, então cada leitura trazia um recorte diferente dos empatados e `keepFirstPendingCooledAlert` escolhia a "mais antiga" dentro de recortes diferentes.
- **Correção:** frente da fila lida por consulta própria (`loadFirstPendingCooledAlert`, ordem `created_at` + `id`, limite 1) e garantida na lista por `pinCooledHead` (Central e sino); listas com desempate pelo `id`. Detalhe no `CHANGELOG_AI.md` (2026-10-16).
- **Arquivos/commit:** `lib/cooled-clients-core.mjs`, `lib/crm-alerts.js`, `lib/cooled-clients.js` — branch `fun15-card-fixo`.
- **Prevenção/teste:** `tests/cooled-clients-core.test.mjs` (60 entregas empatadas, recortes diferentes → sempre o mesmo cliente). Risco residual: mandar mensagem ao cliente com a janela aberta encerra o caso pela FUN-15 (b) — pendente de decisão do dono.
- **Status:** Resolvido (aguardando publicação).

### 2026-10-16 — Mensagem enviada pelo Chat/automação não aparece no celular do corretor
- **Data:** 2026-10-16
- **Sintoma:** mensagem do CRM chega ao cliente, mas não aparece no WhatsApp do celular do corretor.
- **Área:** WhatsApp
- **Impacto:** corretores com número pessoal conectado; casos reais não medidos (a telemetria `send_retry_*` passa a medir).
- **Causa raiz:** o celular pede reenvio (retry) da cópia `deviceSentMessage` que não decifrou e o Baileys 6.7.24 não reenviava: sem `getMessage` no `makeWASocket`; pedido pelo LID com `me.lid` vazio nem é reconhecido como do próprio número.
- **Correção:** cache em memória + `getMessage`; reenvio à mão no caso do LID. Detalhe em `docs/WHATSAPP.md` §1-H e `CHANGELOG_AI.md` (2026-10-16).
- **Arquivos/commit:** `whatsapp-individual-service/src/send-retry.js`, `whatsapp-individual-service/src/sessions.js` — commit desta data.
- **Prevenção/teste:** `tests/whatsapp-send-retry.test.mjs`.
- **Status:** Diagnosticado, correção pendente de publicação (depois das 18h) e de confirmação pela telemetria.

### 2026-10-16 — Disparo Oficial por planilha (CSV) mandava para cliente "Não contactar"
- **Data:** 2026-10-16
- **Sintoma:** cliente marcado "Não contactar" no CRM recebia a campanha do Disparo Oficial quando vinha numa planilha CSV.
- **Área:** WhatsApp (Disparo)
- **Impacto:** qualquer cliente "Não contactar" sem linha bloqueada na fila da prospecção; risco de denúncia/bloqueio do número oficial. Casos reais não medidos.
- **Causa raiz:** `resolveCsvRecipients` (`lib/whatsapp-broadcasts.js`) só consultava `prospecting_contacts.status = 'do_not_contact'`, não o cadastro do cliente (`simulation_registrations`).
- **Correção:** consulta as duas tabelas pelos mesmos formatos de telefone; erro de leitura lança. Detalhe no `CHANGELOG_AI.md` (2026-10-16).
- **Arquivos/commit:** `lib/whatsapp-broadcasts.js` — commit desta data.
- **Prevenção/teste:** `tests/whatsapp-broadcast-csv-do-not-contact.test.mjs`.
- **Status:** Resolvido (aguardando publicação).

### 2026-10-16 — Mensagem automática sem "tique" mesmo entregue (recibo perdido)
- **Sintoma:** ~48 % das mensagens automáticas de 02–16/10 sem recibo; em 26–28 casos o recibo aparecia "antes do envio" (`delivered_at` < `sent_at`).
- **Área:** Meta Diária / WhatsApp
- **Impacto:** taxa de entrega subestimada (monitor de 60 %, pausa por entrega muito baixa e análises).
- **Causa raiz:** corrida de gravação — o `wa_message_id` do item da fila só era gravado depois de registrar a tentativa (vários acessos ao banco); o 1º recibo (~0,1 s após o envio) chegava antes, não achava o item e era descartado (`item_nao_encontrado`). O `sent_at` também é gravado só no fim, por isso recibos casados pareciam "antes do envio".
- **Correção:** grava o `wa_message_id` logo após o envio; o webhook espera um envio automático em andamento iniciado antes do recibo (`send_started_at`) e tenta de novo pelo id. Para análise, comparar recibo com `send_started_at`.
- **Arquivos/commit:** `lib/daily-goal-auto.js`, `lib/daily-goal-auto-core.mjs`, `lib/whatsapp-individual-inbound.js` — commit desta data.
- **Prevenção/teste:** `tests/daily-goal-recibo-corrida.test.mjs`, `tests/daily-goal-auto-window.test.mjs` (`sent_unregistered`).
- **Status:** Monitorando (medir a fatia sem recibo depois da publicação).

### 2026-10-16 — Prospecção automática da Meta Diária quase parou (números conectados, mas nada sai)
- **Data:** 2026-10-16
- **Sintoma:** "a automação parou": 14/10 = 7 envios, 15/10 = 2 (antes 45–52/dia); cartão mostra "aguardando 2 h após reconectar" o dia todo.
- **Área:** Meta Diária / WhatsApp
- **Impacto:** todos os corretores com automação v2 cujos números caem e voltam sozinhos (~a cada 50 min na janela).
- **Causa raiz:** a espera de 2 h (regra de 13/10) contava de `last_connected_at`, regravado em TODA volta a "connected" (`applyIndividualSessionStatus`, `lib/whatsapp-individual.js`), inclusive reconexão automática por 428/500/503; com reconexão a cada ~50 min a espera recomeçava antes de terminar.
- **Correção:** início da espera derivado da telemetria (`settle_anchor_at`, `lib/daily-goal-reconnect-settle*.js`): só QR/código/Conectar, 401/403, queda ≥ 30 min, retomada de pausa ou dúvida recomeçam. Detalhe no `CHANGELOG_AI.md` (2026-10-16).
- **Arquivos/commit:** `lib/daily-goal-reconnect-settle-core.mjs`, `lib/daily-goal-reconnect-settle.js`, `lib/daily-goal-policy-core.mjs`, `lib/daily-goal-auto.js` — commit desta data.
- **Prevenção/teste:** `tests/daily-goal-reconnect-settle.test.mjs` (caso 50 min reproduzido: regra antiga segura, nova libera 2 h após o pareamento).
- **Status:** Monitorando (conferir envios do dia seguinte à publicação).
### 2026-10-13 — Muitas tentativas seguidas de conectar um número que o WhatsApp recusa (403) e chaves de criptografia nos registros
- **Data:** 2026-10-13
- **Sintoma:** número do corretor com erro 403 ("forbidden") e 8 tentativas de conectar em 8 minutos, todas 403 (09/10, telemetria `connect_attempt`/`cycle_start`/`intervention_required`); e, nos registros da Railway, despejos com `privKey`, `rootKey`, `chainKey`, `baseKey` ("Closing session", "Bad MAC"...).
- **Área:** WhatsApp
- **Impacto:** cada insistência num número já recusado parece robô para o antiabuso do WhatsApp (risco de banimento do número); quem lê o log da Railway lia material de criptografia das conversas.
- **Causa raiz:** (1) 403 já NÃO reconectava sozinho (2026-10-04), mas nada limitava as tentativas MANUAIS — o botão Conectar e a abertura da tela (que tenta conectar sozinha com o número em erro) abriam um ciclo novo a cada vez. (2) O libsignal (dentro do Baileys) imprime o objeto `SessionEntry` inteiro com `console.info/warn/error`; o serviço não filtrava o console.
- **Correção:** (1) máximo 3 tentativas por hora depois de um 403, contadas pela telemetria gravada (não pela memória), a 4ª recusada com mensagem clara sem tocar no WhatsApp. (2) filtro do console que troca esses despejos por uma linha curta. Ver CHANGELOG_AI.md (2026-10-13), BUSINESS_RULES WA-32/WA-33.
- **Arquivos/commit:** `whatsapp-individual-service/src/{reconnect-policy,connect-limit,sessions,log-sanitizer,console-guard}.js`, `lib/whatsapp-session-telemetry.js` — commit na branch da worktree (hash no histórico do repositório).
- **Prevenção/teste:** `tests/whatsapp-forbidden-limit.test.mjs` (linha do tempo real de 8 tentativas, janela deslizante, fiação antes de apagar credenciais) e `tests/whatsapp-log-sanitizer.test.mjs` (SessionEntry com formato do libsignal, console real do Node); simulação com o `session_record.js` real do libsignal: 1178 linhas/57 KB -> 56 linhas, 0 chaves.
- **Status:** Resolvido no código; vale em produção quando o CRM e o serviço (Railway) forem publicados.

### 2026-10-12 — Cliente "Não contactar" recebia robô do WhatsApp (Fluxo/palavra-chave)
- **Data:** 2026-10-12
- **Sintoma:** cliente marcado "Não contactar" que escreve para o número oficial recebe saudação/menu do Fluxo ou resposta automática por palavra-chave (achado da Mesa de Criação, por leitura de código).
- **Área:** WhatsApp
- **Impacto:** risco de contato automático com quem pediu para parar (regra inviolável 9; risco de denúncia/banimento do número). Nenhum caso real medido.
- **Causa raiz:** `processFlowInbound`/`processDueFlowSessions` (`lib/whatsapp-flows.js`) e `processAutomationReply` (`lib/whatsapp-master.js`) só pulavam conversa Particular, equipe, humano atendendo e pós-formulário — nunca consultavam `do_not_contact` (o lembrete do formulário já consultava).
- **Correção:** checagem `findDoNotContactInboundBlock` antes de iniciar/continuar/retomar fluxo e antes da palavra-chave; log `skipped` na Atividade. Ver CHANGELOG_AI.md (2026-10-12).
- **Prevenção/teste:** `tests/do-not-contact-core.test.mjs` (regra pura + trava de ordem nas três portas).
- **Status:** Resolvido (aguarda publicação)

### 2026-10-12 — Horas no CRM: "Esta semana" zerada na segunda e domingo fora de qualquer semana
- **Data:** 2026-10-12
- **Sintoma:** "A 'Esta semana' está com erro" — segunda de manhã todos com 0 min; trabalho de domingo não aparecia na semana.
- **Área:** Desempenho › Online (Horas no CRM)
- **Impacto:** só a leitura do relatório (admin/gestora); nenhum dado gravado errado.
- **Causa raiz:** o período "week" ia de segunda a SÁBADO da semana corrente (`resolvePresenceRange`); sem regra do dono por trás. Agravantes: tela sem o intervalo exibido; "Personalizado" incompleto mantinha o resultado anterior.
- **Correção:** regra do dono RAN-6a — "Semana passada" (última semana fechada, seg–dom); intervalo exibido; Personalizado limpa. Ver CHANGELOG_AI.md (2026-10-12).
- **Prevenção/teste:** `tests/admin-presence-report.test.mjs` (limites, domingo 23:59 × segunda 00:00, online/ausente, ordenação).

### 2026-10-12 — "Carregar mensagens anteriores do celular" nunca funciona
- **Data:** 2026-10-12
- **Sintoma:** toca no botão do Chat e nenhuma mensagem antiga chega; telemetria sem nenhum `sync_6`.
- **Área:** WhatsApp
- **Impacto:** todos os corretores com WhatsApp pessoal; só a importação de mensagens antigas (nada enviado a contatos).
- **Causa raiz (provável, A CONFIRMAR no 1º teste):** pedido ON_DEMAND do Baileys 6.7.24 (`fetchMessageHistory`) recebia o horário da referência em ms; o celular espera segundos. Faltavam também `privacy_sensitive`/`meta appdata` que o WhatsApp usa nesse pedido.
- **Correção:** pedido próprio via `relayMessage` (segundos + atributos), ON_DEMAND sempre processado, telemetria por etapa (`req_sent` → `req_ack_*` → `notif_6`/`pdo_resp` → `sync_6`, ligadas por `cycle_id`), rodadas até 15 dias com estado real na tela, vídeo no ON_DEMAND.
- **Arquivos/commit:** `whatsapp-individual-service/src/history-on-demand.js`, `src/sessions.js`, `lib/whatsapp-older-history-core.mjs`, `components/WhatsappChat.jsx` — ver CHANGELOG_AI.md (2026-10-12)
- **Prevenção/teste:** `tests/whatsapp-older-history.test.mjs` trava segundos/atributos.
- **Status:** Monitorando
- **Nota 2026-10-12 (1º teste):** só `req_sent`. O recibo do celular nunca seria registrado (o Baileys não emite evento para `peer_msg`) — instrumentado no nó bruto. Pedido passou a sair sem `deviceSentMessage` (como o whatsmeow) e, em conversa LID, também com o chat em telefone. Botão escondido em conversas com mais de 100 mensagens (`detail.hasMore`) — agora sempre visível, com "Ver mensagens anteriores".
- **Nota 2026-10-12 (2º teste):** um celular recebeu e não respondeu (madrugada, app provavelmente fechado); outro pediu reenvio (`retry`) que não era atendido — reenvio implementado; a tela pede para abrir o WhatsApp no celular do dono do número. Próximo passo: teste com o app aberto; se ainda não responder, trocar o botão por explicação.
### 2026-10-06 — CRM lento / Meta Diária demora para carregar (administrador)
- **Data:** 2026-10-06
- **Sintoma:** "CRM está lento e demorando muito para carregar a Meta Diária no meu acesso".
- **Área:** Meta Diária / Banco
- **Impacto:** administrador e gestoras (visão da equipe); banco no plano gratuito sofre com a soma de consultas.
- **Causa raiz:** (a) a visão da equipe fazia ~214 consultas por abertura — carteira de TODOS os perfis (inclusive os que a tela não mostra) e os mesmos números de cada corretor calculados duas vezes, em etapas sequenciais; (b) o cron do retorno automático varria `daily_goal_rounds` inteira para cada contato (sem índice) a cada 2 min, ocupando o banco.
- **Correção:** índices + só quem aparece + memória por requisição + etapas em paralelo (214 → 155 consultas; hibernação 227 → 2 ms).
- **Arquivos/commit:** ver CHANGELOG_AI.md (2026-10-06)
- **Prevenção/teste:** `tests/request-memo.test.mjs`
- **Status:** Monitorando (resta agrupar os pendentes por corretor para reduzir mais)
### 2026-10-06 — Histórico do cliente fica atrás do card
- **Data:** 2026-10-06
- **Sintoma:** ao clicar no ícone de histórico (relógio) no card/ficha do cliente, o painel "Minha Jornada" abre atrás do card, no app e no computador.
- **Área:** Frontend
- **Impacto:** histórico inacessível na ficha aberta (mesma classe do incidente de Documentação de 2026-10-01).
- **Causa raiz:** a ficha é um `<dialog>` com `showModal()` (camada de topo); o modal do histórico era um `div fixed z-[100]`, que nunca fica acima da camada de topo.
- **Correção:** o histórico virou `<dialog>` com `showModal()`.
- **Arquivos/commit:** ver CHANGELOG_AI.md (2026-10-06)
- **Prevenção/teste:** `tests/client-journey-modal-layer.test.mjs`
- **Status:** Resolvido
### 2026-10-06 — Cliente transferido de volta pela roleta depois que o dono já tinha transferido
- **Data:** 2026-10-06
- **Sintoma:** "eu transfiro para um corretor e depois ele transfere de novo, algum sistema de roleta".
- **Área:** Roleta
- **Impacto:** transferência manual desfeita em minutos (1 caso confirmado; Link Geral sem corretor on-line).
- **Causa raiz:** o lead da roleta sem corretor on-line fica na fila de espera (`pending_distribution_at`); a transferência manual mudava o responsável mas não limpava a marca, e a roleta entrega qualquer cliente marcado, sem olhar o responsável.
- **Correção:** transferência explícita limpa a marca e a roleta ignora quem já tem corretor que não seja o dono.
- **Arquivos/commit:** ver CHANGELOG_AI.md (2026-10-06)
- **Prevenção/teste:** `tests/pending-roulette.test.mjs`
- **Status:** Resolvido

### 2026-10-05 — Corretora não acha, pelo telefone, o cliente que ela disparou
- **Data:** 2026-10-05
- **Sintoma:** "pesquisei o telefone em todos os clientes e não aparece nenhum cliente" — cliente disparado pelo WhatsApp da corretora (número errado) que ela precisava marcar como Não contactar. Já havia sido relatado antes.
- **Área:** Clientes / Prospecção
- **Impacto:** 159 clientes em "Tentando contato" sem responsável desde 29/09 (Jennyfer, Eduardo, Bruna, Caroline, Izabela, ketlin, Bencke); resposta negativa de disparo sem como tratar.
- **Causa raiz:** o cliente é devolvido à fila (retorno automático, hibernação, "Devolver", rebalanceamento da carteira 30) com `responsible_user_id = null` (regra P-05) e o corretor só enxerga clientes em que `responsible_user_id` é ele. No caso reportado o rebalanceamento rodou 6 min depois do disparo.
- **Correção:** `returned_from_user_id` (gatilho + retroativo) dá acesso por busca/ficha ao corretor que disparou enquanto o cliente está sem responsável.
- **Arquivos/commit:** ver CHANGELOG_AI.md (2026-10-05)
- **Prevenção/teste:** `tests/client-returned-scope.test.mjs`
- **Status:** Resolvido

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

## 2026-10-11 — Código de pareamento (conectar só pelo celular) nunca funcionava — caso Jennyfer (Número 2)
- **Sintoma:** a corretora pediu o código várias vezes, digitou no WhatsApp e não conectava; depois de ~2 min aparecia "desconectado (logged_out)".
- **Telemetria:** 6 pedidos em 8 min (cada novo pedido invalida o anterior — "superseded"); nenhum código aceito; cada código vencia (408) e virava reconexão automática seguida de 401.
- **Causas:** (1) `isPairedCreds` tratava como PAREADA a sessão com código pedido e ainda não digitado (o pedido do código já grava `creds.me`) → código vencido virava "reconectar" → 401 `logged_out` (mensagem enganosa e código velho na tela); (2) o código era pedido para o número digitado, mas conta brasileira antiga pode estar registrada SEM o 9 extra → código nunca aceito; (3) a tela não dizia o prazo (~2 min), nem que pedir outro invalida o anterior, nem para qual número era.
- **Correção:** `isPairedCreds` = `registered === true` ou (`me` sem `pairingCode`); `resolvePairingNumber` (sessions.js) consulta por uma sessão conectada qual é o número exato da conta (com/sem 9) e avisa "Esse número não tem WhatsApp"; tela com número, "Copiar código", passo a passo, prazo e aviso de código expirado.

## 2026-10-11 tarde — Histórico do WhatsApp "picado" (só mensagens recentes) depois de parear
- **Sintoma:** depois de conectar pelo QR, as conversas do corretor apareciam com poucas mensagens ou só as de hoje.
- **Causas:** (1) o WhatsApp manda o histórico em vários pacotes, os ANTIGOS primeiro e o da última semana por último (~2-3 min após conectar); deploys do serviço nesse intervalo (14h49, 15h50, 16h34) reiniciaram o processo antes do último pacote, e pacote já confirmado (`hist_sync`) não volta; (2) a janela de 30 min pós-pareamento ficava só em memória — depois do reinício o resto era recusado (corrigido: todo socket processa histórico); (3) reconectar logo em seguida não faz o WhatsApp reenviar.
- **Prova:** pareamento do Bencke às 16h14 sem reinício: 3 pacotes 100% antigos e o 4º com 477 mensagens da semana (147 novas em 44 conversas).
- **Correção/complemento:** botão "Carregar mensagens anteriores do celular" no Chat (ON_DEMAND por conversa, `requestChatOlderHistory`). A troca de leitura de data `{ low, high }` foi inócua (telemetria `nots0`).
- **Lição:** não publicar o serviço do WhatsApp (Railway, `watchPatterns` da pasta do serviço) enquanto alguém pareia; esperar ~5 min após o pareamento. Falha de build da Vercel "next/font/google queries have exactly one entry" (fonte Lora) é passageira — Redeploy sem cache resolve.

## 2026-10-11 13h44 — Histórico ligado derrubou todos os WhatsApps (428 em < 1 s)
- **Sintoma:** após apagar `WHATSAPP_HISTORY_SYNC_ENABLED=false` na Railway, nenhuma sessão ficou conectada (43 quedas 428 "Connection Closed", 0 conexões; nenhuma mensagem dos corretores de 13h40 a 14h19). Com o histórico desligado de novo, o Bencke conectou na hora.
- **Causa raiz (Baileys 6.7.24, `Utils/validate-connection.js`):** com `syncFullHistory: true` e navegador `Browsers.macOS(...)` ("Mac OS"), o LOGIN se apresenta como `webSubPlatform = DARWIN`; todas as sessões tinham sido pareadas como `WEB_BROWSER` (histórico desligado) → o WhatsApp fecha a conexão. O `syncFullHistory` era aplicado a TODO socket (retomadas e código), não só ao pareamento.
- **Correção:** `syncFullHistory` só no pareamento NOVO por QR, com navegador `["CRM Imoveis","Desktop","1.0"]` (mantém WEB_BROWSER, tipo DESKTOP); retomadas/código fazem login como sempre; o histórico que chega depois do pareamento é processado por `shouldSyncHistoryMessage` por 30 min (`HISTORY_AFTER_PAIRING_MS`).
- **Lição:** mudar opção do Baileys que entra no login exige testar com uma sessão real antes de ligar para todos.

## 2026-10-11 noite — Lembrete "você ainda não preencheu o formulário" para quem já preencheu e recebeu a simulação

- **Sintoma:** 1 h depois de receber a apresentação da simulação, a cliente recebeu o lembrete WA-17 do formulário.
- **Causa raiz:** `isFormLinkUrl` aceitava qualquer `/s/<x>`; o link da apresentação (`/s/<token>`) usa o mesmo prefixo do link curto do formulário (`/s/<ref>`). E cadastro criado pelo formulário fica com `last_form_submitted_at` nulo (só reenvio preenche), então o "já preencheu" não o via.
- **Correção:** `lib/whatsapp-form-reminder-core.mjs` exclui token de apresentação (`isPresentationToken`) e trata `journey_type` preenchido como formulário enviado (`lib/whatsapp-form-reminder.js` passa a ler a coluna). Testes em `tests/whatsapp-form-reminder.test.mjs`.

## 2026-10-12 — Barra inferior alta/cortada só no Chat (iPhone, app instalado)

- **Sintoma:** no Chat a barra inferior ficava alta com faixa branca embaixo (ou cortada pela metade); nas outras telas, normal.
- **Causa raiz (medida no aparelho: tela 956, `innerHeight` 894, safe-area do topo 62):** com a página do Chat SEM rolagem (`html` 100% + `overflow: hidden`), o iOS encolhe a janela do app pela altura da barra de status; os 62 pt de baixo ficam fora do app. Telas que rolam não têm o defeito.
- **Correção:** `html.chat-app-mode` com `min-height: calc(100% + env(safe-area-inset-top))` e `overflow-y: auto` (`app/globals.css`). Rede de segurança em `components/AdminBottomNav.jsx` (`--mm-fixed-drop`) mede o fim visível e desce a barra se o iOS voltar a encurtar o fixo.

## 2026-10-21 — Chat do Marketplace: conversas chegam sem nenhuma mensagem

- **Sintoma:** a extensão abria e lia as conversas do Marketplace, mas o popup mostrava "não chegou ao CRM (Não foi possível sincronizar.)"; `marketplace_conversations` com linhas e `marketplace_messages` vazia.
- **Causa raiz:** o upsert de mensagens (`lib/marketplace-chat.js`, `onConflict: "conversation_id,external_id"`) falhava no Postgres com "there is no unique or exclusion constraint matching the ON CONFLICT specification" (PostgREST 400): o único índice único era parcial (`where external_id is not null`), e ON CONFLICT só casa com índice parcial quando recebe o mesmo predicado.
- **Correção:** índice único completo `marketplace_messages_conversation_external_key` (migration `20261021223000_marketplace_messages_external_unique_full.sql`); NULLs seguem distintos. Achado pelos logs do Postgres (`query_logs`), não pela extensão.
