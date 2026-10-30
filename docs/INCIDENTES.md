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

### 2026-10-30 — Relatório diário: "Ontem" mostra quase nada, "não é um número real"
- **Data:** 2026-10-30
- **Sintoma:** "o filtro do prazo parece que não funciona: quando coloca 'ontem' não aparece quase nada, volume muito baixo."
- **Área:** Relatório diário / Funil
- **Impacto:** leitura dos cartões por dono e gestora; nenhum dado errado.
- **Causa raiz:** NÃO é a janela de datas (conferida: 29/10 = 03:00Z a 03:00Z, fim exclusivo, mesma janela em cadastros e histórico). Conferido no banco (somente leitura, 29/10 São Paulo): 3 cadastros e 136 mudanças de status (84 "Aguardando contato", 34 "Tentando contato", 11 "Em atendimento"; nenhuma para documentação/aprovação/aprovado/venda) — o relatório devolve exatamente isso (3 / 0 / 0 / 0). O que parece "baixo" é a DEFINIÇÃO: cartões de movimento por período (só contam quem ENTROU na etapa naquele dia) e dois cartões híbridos ("Aguardando documentação" e "Documentação pendente" = cadastros criados no período que HOJE estão nesse status), enquanto a carteira tem 20 e 6 clientes nesses status. Também diferem do painel Desempenho (coorte criados + prospectados + avançaram, `docs/METRICAS_FUNIL.md` MET-4). A linha do tempo mostrava só 90 movimentos sem avisar.
- **Correção:** sem mudança de conta (decisão do dono pendente: fluxo do período x carteira atual x igual ao Desempenho). Feito: janela extraída para `lib/daily-report-range.mjs` com testes (fuso, virada de dia/mês, ontem, 7/30, personalizado); linha do tempo avisa "Mostrando os 90 mais recentes de N"; rótulos dos dois cartões híbridos dizem "Dos cadastros do período, ...".
- **Arquivos/commit:** `lib/daily-report-range.mjs`, `lib/daily-report.js`, `components/DailyReportDashboard.jsx` — branch `fix/relatorio-diario-prazo`
- **Prevenção/teste:** `tests/daily-report-range.test.mjs`.
- **Status:** Resolvido (não publicado) — dono decidiu em 2026-10-30: cartões mostram "no período" e "carteira agora" lado a lado (`docs/CHANGELOG_AI.md`)

### 2026-10-30 — Relatório diário: ao filtrar por corretor, os números do topo não mudam
- **Data:** 2026-10-30
- **Sintoma:** "A Carol (gestora) coloca o prazo e depois seleciona um corretor; os cadastros realizados, aguardando documentação etc. continuam mostrando o total."
- **Área:** Permissões / Relatório diário
- **Impacto:** todo gestor no Relatório diário (admin geral não era afetado). Além do filtro ignorado, o gestor via o histórico de status de TODOS os clientes da empresa (movimentos, documentação, aprovação, aprovados, vendas), não só os da equipe.
- **Causa raiz:** `lib/daily-report.js` só aplicava `brokerIds` para admin geral; para gestor o escopo caía em `applyResponsibleUserScope` (equipe inteira, sem o corretor escolhido) e `loadScopedClientIds` devolvia `null` (histórico sem filtro nenhum). A tabela "Por corretor" também ignorava a seleção do gestor. Agravante: consultas sem paginação (corte silencioso em 1000 linhas) e lista de ids de cliente na URL.
- **Correção:** uma só decisão de escopo (`lib/daily-report-scope.mjs`) para cadastros, funil, conversões, linha do tempo e tabela; histórico filtrado pelo corretor responsável do cliente (junção), consultas paginadas; corretor fora da equipe = 403; tela mostra "…" enquanto carrega e limpa o número se falhar.
- **Arquivos/commit:** `lib/daily-report.js`, `lib/daily-report-scope.mjs`, `app/api/daily-report/route.js`, `components/DailyReportDashboard.jsx` — branch `fix/relatorio-diario-filtro-corretor`
- **Prevenção/teste:** `tests/daily-report-scope.test.mjs`. Risco residual: filtro por junção (`scope.responsible_user_id`) conferido só pelo padrão já usado em `lib/whatsapp-chat.js`; validar com a Carol após publicar.
- **Status:** Resolvido (não publicado)

### 2026-10-30 — Henry "só entende o final da frase" e erra metade das vezes
- **Data:** 2026-10-30
- **Sintoma:** "O Henry trava, em 50% das vezes não entende, e quando entende só entende o final da frase."
- **Área:** Henry (voz) / captura no app de desktop
- **Impacto:** o dono; todo pedido falado depois do nome ("Henry, ...") no app.
- **Causa raiz:** (1) app de desktop: o microfone da página só abria DEPOIS do nome (getUserMedia a frio + MediaRecorder), sem pré-buffer — o começo da frase se perdia; (2) piso de ruído da gravação calculado pela média dos primeiros 350 ms, que já incluíam a voz do dono, subindo o limiar de voz até o teto (0,6). Dados (7 dias): 195 transcrições do Scribe para 228 pedidos ao modelo (23/10: 157 transcrições para 65 pedidos); fim da fala padrão 2,0 s.
- **Correção:** microfone aquecido + clone da trilha na gravação; piso = mínimo lido; medição `[henry] captura`. Pré-buffer real fica como decisão do dono.
- **Arquivos/commit:** `components/henry/HenryVoiceAssistant.jsx`, `lib/henry-voice-conversation.mjs` — branch `fix/henry-captura-voz`
- **Prevenção/teste:** `tests/henry-captura.test.mjs`. Risco residual: não validado com microfone real.
- **Status:** Monitorando


### 2026-10-29 — "Assumiu o 1º lugar" aparece às 12:00 em ponto, sem os minutos de liderança
- **Data:** 2026-10-29
- **Sintoma:** reconhecimento "Liderança do dia" sai no 1º tick das 12:00 (ex.: 10-25, 10-26, 10-29), ignorando "Minutos seguros de liderança" (10).
- **Área:** Reconhecimentos (Incentivo), cron `celebrations-ranking`
- **Impacto:** só o 1º turno do dia, quando o líder era o mesmo do fim do dia anterior; o líder certo recebia, só que antes do tempo mínimo.
- **Causa raiz:** `celebration_ranking_lead_state.leading_since` não zera à meia-noite (antes das 12h o cron sai sem gravar); mesmo líder de ontem → liderança "desde ontem" → tempo mínimo já cumprido.
- **Correção:** `resolveLeadingSince` (`lib/celebrations-ranking-core.mjs`) recomeça a contagem quando a liderança registrada é de outro dia (São Paulo).
- **Arquivos/commit:** `lib/celebrations.js`, `lib/celebrations-ranking-core.mjs` — branch `fix/animacoes-incentivo`
- **Prevenção/teste:** `tests/celebrations-ranking-core.test.mjs` (caso real de 2026-10-29).
- **Status:** Corrigido na branch, não publicado

### 2026-10-29 — Imóvel aprovado não sai no Marketplace
- **Data:** 2026-10-29
- **Sintoma:** anúncio aprovado fica "pending" na fila; extensão ligada e sincronizando o chat normalmente.
- **Área:** Marketplace (extensão)
- **Impacto:** nenhuma publicação automática no Marketplace enquanto o chat está ativo (desde a 1.9.9).
- **Causa raiz:** tique de publicação (15 min) pulado com `chat_em_andamento` porque o chat roda a cada 1 min; nada o tentava de novo ao fim da rodada.
- **Correção:** `publishAfterChat` em `ferramentas/marketplace-publicador/background.js` (1.9.10).
- **Arquivos/commit:** `ferramentas/marketplace-publicador/background.js` — ver `git log`
- **Prevenção/teste:** `tests/estrutura-real.test.js` (1.9.10). Paliativo sem atualizar: "Destravar sincronização" + "Verificar agora" no ícone da extensão.
- **Status:** Monitorando (dono precisa instalar a 1.9.10)

### 2026-10-26 — "Não está indo mais as conversas antigas" do cliente transferido
- **Data:** 2026-10-26
- **Sintoma:** corretor que recebe cliente transferido (fila de clientes frios) não vê o que já foi conversado com o corretor anterior.
- **Área:** WhatsApp / Clientes (FUN-15g/h)
- **Impacto:** todos os corretores que recebem transferência; ~1 em 4 entregas tinha histórico para mostrar.
- **Causa raiz:** não era regressão: o histórico somente leitura existia só na ficha do cliente (recolhido); o Chat, onde o corretor abre o cliente, nunca o mostrava. Nas demais entregas não há conversa anterior gravada no CRM (corretor anterior sem conversa no Chat, ou conversa excluída).
- **Correção:** mesmo bloco no topo da conversa aberta no Chat (FUN-15o). Detalhe no CHANGELOG_AI.
- **Arquivos/commit:** `components/WhatsappChat.jsx`, `components/cooled/CooledChatHistory.jsx`, `lib/whatsapp-chat-scope.mjs` — branch `fix/historico-conversa-transferido`.
- **Prevenção/teste:** `tests/cooled-transfer-chat-history.test.mjs`.
- **Status:** Resolvido na branch (não publicado).

### 2026-10-26 — "Alerta de que já enviei várias mensagens" e o cliente da roleta vai para outro corretor
- **Data:** 2026-10-26
- **Sintoma:** corretor recebe "Muitas mensagens enviadas na última hora. Aguarde um pouco para continuar (proteção do seu número)." ao mandar a 1ª mensagem pelo Chat; manda pelo celular/outro WhatsApp, o CRM não vê e o cliente da fila de reativação/roleta vence o prazo e sai dele.
- **Área:** WhatsApp / Roleta
- **Impacto:** qualquer corretor durante ~1 h depois de o celular sincronizar histórico ao reconectar (7 dias: 1 corretor em 19/10, 1 em 23/10 e 24/10, o dono em 23/10, 1 em 26/10 — ~400 mensagens antigas às 10:41 bloquearam o Chat dele até ~11:45; um cliente da reativação voltou à fila às 11:28 sem nenhuma mensagem).
- **Causa raiz:** o limite de 80 envios/hora da sessão pessoal (`assertIndividualChatReplyOnly`, pedido do dono em 2026-10-05) contava por `created_at`; mensagens de histórico (`metadata.history`, de dias atrás) entram com `created_at` = agora e contavam como "enviadas na última hora".
- **Correção:** conta só envio real: `message_at` na última hora e sem `metadata->history` (mesma exclusão de `lib/whatsapp-false-connection.js`). Limite de 80/h mantido.
- **Arquivos/commit:** `lib/whatsapp-chat.js` — branch `fix/eduardo-alerta-roleta`
- **Prevenção/teste:** `tests/chat-reply-only.test.mjs` (trava contra voltar a contar por `created_at`).
- **Status:** Resolvido no código (aguarda merge/deploy). Mensagem mandada por um WhatsApp NÃO conectado ao CRM continua invisível (decisão do dono pendente).

### 2026-10-26 — Seguidor Instagram: "não foi enviada nenhuma" DM de boas-vindas
- **Data:** 2026-10-26
- **Sintoma:** extensão 1.1.6 segue gente todo dia, mas nenhuma boas-vindas sai e o popup não diz por quê (contador "seguiram de volta" parado).
- **Área:** Ferramenta pessoal fora do CRM (`ferramentas/instagram-seguidor/`)
- **Impacto:** toda DM de boas-vindas de quem seguiu de volta fora da 1ª página dos seguidores (12 mais recentes no momento da checagem de 2 min).
- **Causa raiz:** com `friendships/show_many` (e `friendships/show`) respondendo HTML desde 24/10, a conferência completa de 30 min caía na leitura do botão do perfil, que mostra "Seguindo" e não diz se a pessoa segue de volta (`meSegue` indefinido) — nunca marcava follow-back. Sobrava só a 1ª página dos MEUS seguidores a cada 2 min: quem seguiu de volta à noite (checagem só 05–22h), com o PC desligado ou antes de outras 12 pessoas novas nunca era visto; sem follow-back nenhuma DM é agendada. A lista dos meus seguidores também não tinha o plano B GraphQL que a busca de origem tem. O simulador dos testes devolvia 25 seguidores numa página (o real devolve 12), o que escondia o problema.
- **Correção (1.1.7):** conferência completa lê até 4 páginas dos meus seguidores (v1 → GraphQL se a v1 não der dados); o plano B um a um tenta `friendships/show` antes do botão. Visibilidade: linha "Boas-vindas: X enviadas hoje, Y pendentes, última checagem…, último erro…" e botão "Conferir seguidores agora" no popup/painel.
- **Arquivos/commit:** `ferramentas/instagram-seguidor/{background.js,lib/estado.js,painel-comum.js,popup.*,options.*,manifest.json,README.md}`, `ferramentas/instagram-seguidor.zip` — branch `fix/instagram-boas-vindas`
- **Prevenção/teste:** `ferramentas/instagram-seguidor/tests/boas-vindas.test.mjs` (follow-back enterrado por 15 seguidores novos; v1 em HTML → GraphQL; tudo fora do ar → erro visível; show em JSON; botão manual); simulador pagina os meus seguidores de 12 em 12.
- **Status:** Monitorando — a DM em si ainda pode receber HTML do Instagram (1.1.5); agora aparece na linha de boas-vindas.
### 2026-10-26 — "Prazo encerrado" vermelho mesmo com a mensagem enviada (cliente frio da roleta)
- **Data:** 2026-10-26
- **Sintoma:** "Ela enviou a mensagem em até 5 minutos, só que ainda tem uma tagzinha embaixo de 'prazo encerrado'. O cliente foi devolvido, mas ela enviou e o cliente ainda está com ela."
- **Área:** fila de reativação (FUN-15l) / aviso "Cliente transferido para você" / retorno automático da Prospecção
- **Impacto:** clientes frios entregues pela fila cujo corretor clicava no WhatsApp (CLI-7c → "Tentando contato") e que tinham um contato antigo "claimed" na Prospecção (2 casos em 10 min no dia).
- **Causa raiz:** (1) o retorno automático de 7 dias (`autoReturnStaleProspectingContacts`) pega todo cliente em "Tentando contato" com contato parado e zera o responsável sem conferir quem é — o clique da corretora levou o cliente a "Tentando contato" e o contato antigo (sem dono, de 29/09) derrubou o responsável; (2) a rotina da fila viu o cliente sem a corretora e encerrou o caso ("left") sem marcar a mensagem; a rede de segurança devolveu o cliente a ela 8 s depois; (3) o aviso só saía do vermelho com `reactivation_kept_at`, então ficou "Prazo encerrado — o cliente foi devolvido" para sempre, mesmo com a mensagem pelo Chat.
- **Correção:** aviso usa a mesma régua de contato do prazo (`attachReactivationNoticeStates` → `loadContactedClientIds`); retornos automáticos não derrubam quem recebeu depois do ciclo parado (`clientReceivedAfterStaleCycle`); prazo 5 → 10 min (pedido do dono).
- **Arquivos/commit:** `lib/cooled-clients-reactivation{,-core.mjs}`, `lib/prospecting-auto-return.js`, `lib/client-distribution-core.mjs` — branch `fix/prazo-contato-10min`
- **Prevenção/teste:** `tests/prazo-contato-10min-2026-10-26.test.mjs`.
- **Status:** Resolvido (não publicado). Casos antigos: o aviso some sozinho na próxima leitura (é calculado); nada a corrigir no banco.

### 2026-10-26 — Henry quis ler avisos no meio do bom dia (depois do play)
- **Data:** 2026-10-26
- **Sintoma:** "Ele também quis me ler avisos, mesmo eu tendo dado play no bom dia."
- **Área:** Henry / bom dia / avisos falados
- **Impacto:** só a cena do bom dia do dono (avisos de cliente/chegada/Central por voz).
- **Causa raiz:** a fila da fala espontânea (`saySpontaneous`/`canSpeakSpontaneously`) só esperava a janela de 12 s da pergunta aberta; o bom dia não era uma "sessão". Depois da 1ª resposta do bom dia, o efeito `afterAsk` oferecia o aviso guardado ("E aquele aviso, posso falar?") e, passados os 12 s da pergunta da música, a oferta tocava no meio da espera; com o chamado no ar (`stage = waiting`), o "pode" da música era lido por `decideAlertReply` como "pode falar" e `tellAlerts` lia os avisos. Também depois do relatório o chamado vinha ~3 s depois, ainda na tela cheia. O relatório em si (`composeReportAnswer`) não anexa avisos.
- **Correção:** sessão do bom dia (`morningSessionStart/Finishing/End/Holds`, `nextSpontaneousItem`, `lib/henry-voice-conversation.mjs`): do play (ou "bom dia, Henry") até a última resposta do bom dia terminar de tocar, item `aviso` da fila não toca (fica na fila; repetição da pergunta da música e "tá tocando" seguem); com a tela cheia aberta, só depois de fechar ou 60 s após o fim; trava de 6 min. No início da sessão um chamado no ar volta a `idle` (aviso continua pendente).
- **Arquivos/commit:** `lib/henry-voice-conversation.mjs`, `components/henry/HenryVoiceAssistant.jsx` — branch `fix/henry-bomdia-sem-avisos`
- **Prevenção/teste:** `tests/henry-morning-no-alerts.test.mjs`.
- **Status:** Resolvido (não publicado; sem teste de voz real nesta sessão)

### 2026-10-26 — Henry tocou música mexicana no bom dia ("nada a ver")
- **Data:** 2026-10-26
- **Sintoma:** o dono aceitou a música do bom dia ("um som no clima de Suits") e o Henry tocou uma música mexicana.
- **Área:** Henry / bom dia / Spotify
- **Impacto:** só a música de fundo do bom dia do dono.
- **Causa raiz:** o aceite buscava PLAYLIST genérica no Spotify por termos sorteados ("indie rock groove", "soul funk moderno", "modern soul"…), um deles em português, e aceitava o melhor resultado mesmo sem casar bem (`acceptBest`); o filtro só barrava "Suits/Ima Robot/Greenback". Busca genérica de playlist com termo vago (sobretudo em português) devolve playlists de outros gêneros (latinas/regionais) — o resultado não era validado contra o estilo.
- **Correção:** a escolha automática virou ARTISTA de uma lista fechada rock/blues (`MORNING_ROCK_BLUES_ARTISTS`), busca só de artista com nome exato (`strict` em `runSpotifyCommand`; parecido = not_found → outro artista da lista), tocado como `spotify:artist:<id>`; filtro ampliado (`MORNING_MUSIC_EXCLUDED_WORDS`: latin, mexicana, regional, corridos…). Oferta trocada pela frase do dono ("Que tal uma música de fundo? Posso escolher ou você tem alguma de preferência?"). Ver `docs/CHANGELOG_AI.md` 2026-10-26.
- **Arquivos/commit:** `lib/henry-morning-music-core.mjs`, `lib/henry-morning-core.mjs`, `lib/henry-spotify-core.mjs`, `lib/henry-spotify.js`, `lib/henry-voice.js` — branch `fix/henry-bomdia-musica-fundo`
- **Prevenção/teste:** `tests/henry-morning-music.test.mjs` (escolha só da lista, strict, descarte latino/mexicano, frase sem Suits).
- **Status:** Resolvido (não publicado; sem teste com o Spotify real nesta sessão)

### 2026-10-26 — Henry diz que o corretor não tem nenhum cliente em simulação (tela mostra 5)
- **Data:** 2026-10-26
- **Sintoma:** "Quantos clientes o corretor Gabriel tem com status simulação enviada" → "O Gabriel não tem nenhum cliente na etapa de simulação agora"; "Simulação realizada" → "nem realizada nem enviada". Tela Clientes (Corretor: Gabriel Ribeiro): aba Simulação 5, "Simulação realizada" 2.
- **Área:** Henry / Clientes
- **Impacto:** toda pergunta de etapa Simulação (e Aprovação/Atendimento) e de sub-status ao Henry, por corretor ou da equipe, dava número diferente da tela; zero falso por corretor.
- **Causa raiz:** o Henry usava o catálogo da Alexa (`etapaProvider`, `lib/alexa-v2/providers/funil.js`), em que a etapa `simulacao` = só `pending` ("Aguardando simulação", `ETAPA_STATUSES`) — desde 2026-10-24 sem `auto_simulation`, e `completed`/`simulation_sent` nunca contaram — enquanto a aba Simulação da tela soma 4 status. O catálogo não tem sub-status: "simulação enviada/realizada" virava a etapa `simulacao` → "O Gabriel não tem cliente aguardando simulação." (os 5 dele estão em realizada/outros).
- **Correção:** `consultar_crm` etapa (hoje) lê `getSimulationClientCounters` (mesma conta da tela, filtro Corretor) e entende os rótulos dos sub-status da tela; falha = "não consegui ver". Ver `docs/CHANGELOG_AI.md` 2026-10-26.
- **Arquivos/commit:** `lib/henry-stage-counts-core.mjs`, `lib/henry-reports.js`, `lib/henry-voice.js` — branch `fix/henry-etapa-por-corretor`
- **Prevenção/teste:** `tests/henry-etapa-corretor.test.mjs` (falas reais); cenário `etapa_corretor` no Treino. Risco residual: a Alexa segue com a etapa `simulacao` = aguardando simulação.
- **Status:** Resolvido (não publicado; números da produção não conferidos por SQL nesta sessão — sem acesso ao banco)

### 2026-10-26 — app recarrega tudo ao sair e voltar (iPhone e computador)
- **Data:** 2026-10-26
- **Área:** PWA / atualização de versão
- **Sintoma:** "Quando eu saio do app por um tempo e volto, ele tem que carregar tudo de novo."
- **Causa raiz:** cada publicação muda `public/sw.js`; o service worker novo assume (`skipWaiting`) e `components/PwaLifecycle.jsx` recarregava a página quando o app ia para segundo plano ou logo ao voltar (regra de 2026-10-09). Com ~25 publicações/dia, quase toda volta caía numa recarga completa. Parte residual: o iOS descarta o app da memória em segundo plano (abertura do zero, fora do nosso controle).
- **Correção:** sair/voltar nunca recarrega; a versão nova entra na próxima troca de tela (`components/pwa-update-policy.mjs`). Ver `docs/CHANGELOG_AI.md` 2026-10-26.

### 2026-10-26 — Henry não diz a origem de quem não virou simulação e manda abrir a tela
- **Data:** 2026-10-26 (conversa de 2026-10-25)
- **Sintoma:** "dos 107 atendimentos, 63 não viraram simulação" → "Qual origem desses 63?" respondeu a origem de todos os 220 clientes novos ("185 por outras origens"); "Todo cliente tem uma origem" → "o detalhe você só encontra abrindo a lista"; "Quero que vc me diga" → "Vou puxar a origem desses 63 agora mesmo." sem buscar; "Certo" → "Beleza!".
- **Área:** Henry (voz/IA) / Funil
- **Impacto:** só o dono; pergunta sem resposta e promessa não cumprida.
- **Causa raiz:** (1) não havia leitura por cliente do recorte do funil (só contagens) nem origem por grupo — o Henry só tinha anúncio/Marketplace/"outras"; (2) "desses 63" não herdava o recorte; (3) o "63" da promessa fazia `replyAnswersQuestion` achar que havia resposta, então `henryPromisedAction` não pegou; (4) "Certo" virava concordância fixa; (5) "só encontra na tela" não era barrado.
- **Correção:** ferramenta `funil_recorte` (`getFunnelCohortStages` + `henryOriginGroup`), rota direta com o recorte/período da conversa, `henryPendingFollowUp` (insistência e "certo" após promessa), número-eco fora da conferência da promessa, `henryScreenDeflection` + rodada obrigatória, persona e Treino (`recusa_com_dado`, cenário "recorte_origem"). Detalhe: `docs/CHANGELOG_AI.md` 2026-10-26.
- **Arquivos/commit:** branch `fix/henry-origem-sem-simulacao`.
- **Prevenção/teste:** `tests/henry-recorte-origem.test.mjs` (falas reais); números conferidos por SQL só leitura (107/44/63).
- **Status:** Resolvido (aguarda publicação)

### 2026-10-25 — Henry: resumo do mês começa com "Hoje,", "por que não fecha?" repete o gargalo, despedida vira "Beleza!"
- **Data:** 2026-10-25
- **Sintoma:** Treino 13 (22:27Z, automático): "dá pra falar mais curto?" depois do gargalo do mês → "Hoje, claro. Entre aprovado e venda…"; "por que tanto aprovado que não fecha?" (gargalo e lista já ditos) → a mesma frase do gargalo; "já tô saindo por hoje. Boa noite." → "Beleza!".
- **Área:** Henry (voz/IA) / Treino
- **Impacto:** só o dono; resposta errada/repetida.
- **Causa raiz:** trava de período do resumo só com período na resposta resumida; "por quê" do gargalo ia à rota fixa do gargalo sem olhar o já dito; despedida sem "tô saindo/até amanhã".
- **Correção:** `henryShortenedReply`/`henryShortenPeriod`, `henryBottleneckFollowUp` + `consultar_crm` formato "motivo" (`loadHenryStageReasons`, `buildHenryStageReasonsReport`), `henryDropRepeatedBottleneck`, `FAREWELL` ampliado + resposta de boa noite. Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25 (Treino 13).
- **Arquivos/commit:** branch `fix/henry-achados-treino-13`.
- **Prevenção/teste:** `tests/henry-achados-treino-13.test.mjs` (falas reais).
- **Status:** Resolvido (aguarda publicação; rodar o Treino de novo depois)

### 2026-10-25 — Henry: "onde a gente perde o cliente" vira promessa, resumo troca o mês por "hoje", "pode, mas … mais animado" toca a sugestão
- **Data:** 2026-10-25
- **Sintoma:** Treino 12 (21:57Z, automático): "Eu não perguntei isso… Quero saber onde a gente perde o cliente" → "Foi mal… Me deixa conferir isso" sem ferramenta; depois "mesma coisa de novo" → "Você queria o quê…?"; "resume, tá longo" → "Vendas? Hoje tem três…" (eram do mês); bom dia "Pode, mas … um sertanejo mais animado" → tocou "Pense em Mim" e o relatório não disse o que tocou.
- **Área:** Henry (voz/IA) / Treino
- **Impacto:** só o dono; resposta errada/repetida.
- **Causa raiz:** diagnóstico só no gerúndio ("perdendo"); releitura da 2ª reclamação só depois da pergunta genérica; resumo sem trava de período; qualificador e "mas" tratados como enfeite do gênero.
- **Correção:** `DIAGNOSIS` com presente, `henryDiagnosisDeepenRequest`, `henryComplaintFallbackRequest` ampliada, `henryShortenedReply`, `mood`/`change` em `classifyMorningMusicReply` + `morningGenreTarget`, `morningMusicChangeLine`. Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25 (Treino 12).
- **Arquivos/commit:** branch `fix/henry-achados-treino-12`.
- **Prevenção/teste:** `tests/henry-achados-treino-12.test.mjs` (falas reais).
- **Status:** Resolvido (aguarda publicação; rodar o Treino de novo depois)

### 2026-10-25 — Henry: piada vira "Abra a tela correspondente", "Bom descanso" no bom dia, "mesma coisa de novo" vira pergunta genérica
- **Data:** 2026-10-25
- **Sintoma:** Treino 11 (21:36Z, automático): "bora de piada rapidinho?" → "Não posso falar isso por voz. Abra a tela correspondente no CRM."; bom dia com "pode ser sertanejo mesmo" → "TOOOCA, MIROSMAR! … Bom descanso, e amanhã a gente segue"; "você tá falando a mesma coisa de novo" depois do gargalo → "Você queria o quê: vendas, funil ou ranking?"; "me mostra o WhatsApp também" → "Quer que eu abra o Chat agora?"; "como que foi teu dia?" 9,6 s.
- **Área:** Henry (voz/IA) / Treino
- **Impacto:** só o dono; resposta robótica/errada.
- **Causa raiz:** papo barrado caía na frase de "abra a tela" (sem nova tentativa); saudação do repertório do relatório pela hora do relógio; sugestão "Pense em Mim" sem gênero → padrão Zezé; reclamação de repetição não olhava se a resposta anterior já atendia; nenhuma rota para "me mostra o WhatsApp"; papo com o histórico do dia.
- **Correção:** `HENRY_BARRED_CASUAL_RETRY`/`casualFallback`, `saudacao_manha` no relatório + `dropNightClosing`, `genre` nas sugestões, `henryDeepenRequest`, `henryScreenOpenRequest`, `casualModelHistory`. Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25 (Treino 11).
- **Arquivos/commit:** branch `fix/henry-achados-treino-11`.
- **Prevenção/teste:** `tests/henry-achados-treino-11.test.mjs` (falas reais).
- **Status:** Resolvido (aguarda publicação; rodar o Treino de novo depois)

### 2026-10-25 — Henry responde "Você queria o quê?" a uma reclamação com pedido, "Vendas de agora: 3." e "aquela visão" vira câmera
- **Data:** 2026-10-25
- **Sintoma:** Treino 10 (21:17Z, automático): "não era isso… Quero saber o que eu faço pra fechar mais" → "Foi mal. Você queria o quê: vendas, funil ou ranking?" e, na 2ª reclamação, a mesma pergunta; "tá longo demais, resume" → "Vendas de agora: 3."; "me dá aquela visão de novo" → "Visão pela câmera tá desligada"; bom dia "pode ser um sertanejo mesmo, tanto faz o cantor" parecia não tocar.
- **Área:** Henry (voz/IA) / Treino
- **Impacto:** só o dono; resposta genérica/robótica em vez da resposta.
- **Causa raiz:** `isBareHenryComplaint` ignorava o pedido depois da reclamação; nada relia o contexto após a pergunta genérica; rótulo de várias palavras escapava de `stripSpeechLabel`; "visão" sozinha era lida pelo modelo como câmera; "tanto faz" ganhava do gênero e o relatório do Treino descartava o campo `music`.
- **Correção:** `COMPLAINT_REQUEST` + `isHenryPlanRequest` na reclamação, `henryComplaintFallbackRequest`, `PERIOD_LABEL`/`isHenryShortenRequest`, `henryRepeatSummaryReply`, gênero antes do "tanto faz" + `morningSuggestionMatchesGenre`, `music` no `storedExchange`. Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25 (Treino 10).
- **Arquivos/commit:** branch `fix/henry-achados-treino-10`.
- **Prevenção/teste:** `tests/henry-achados-treino-10.test.mjs` (falas reais).
- **Status:** Resolvido (aguarda publicação; rodar o Treino de novo depois)

### 2026-10-25 — Henry repete "3 vendas" depois de "não foi isso", oferece o gargalo em vez de falar e explica que não tem agenda na despedida
- **Data:** 2026-10-25
- **Sintoma:** Treino 9 (20:30Z, automático): "Entendi, mas não foi isso que eu perguntei." → repetiu "3 vendas" (com "20 aprovação" a mais); "me fala do funil" → "Quer que eu veja em qual etapa a gente mais perde gente?"; "por hoje é isso, pode fechar a agenda" → "Não tenho agenda pra fechar…"; "a Jennyfer 23 e Ketlin 17"; "é só chamar"/"Quer que eu dê mais uma?" no papo; "agora sim, o número de vendas já resolve" → repetiu "3 vendas".
- **Área:** Henry (voz/IA) / Treino
- **Impacto:** só o dono; respostas repetidas/ofertas em vez de resposta.
- **Causa raiz:** comparação da reclamação só pelo conjunto de números; reclamação sem pista ia ao modelo com ferramentas; funil do período ia ao modelo e como "resumo positivo" sem o gargalo; despedida e concordância dependiam do modelo (que repetia a memória do dia); artigo decidido por nome; bordão só cortado quando repetido.
- **Correção:** `henryMainMetric`, `isBareHenryComplaint`/`henryBareComplaintReply`, `bottleneckLine` + `speak: true`, `trimTrailingOffer`/`trimCasualOffer`, `henryFarewellReply`, `henryAgreementReply`, artigo tudo-ou-nada. Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25 (Treino 9).
- **Arquivos/commit:** branch `fix/henry-achados-treino-9`.
- **Prevenção/teste:** `tests/henry-achados-treino-9.test.mjs` (falas reais).
- **Status:** Resolvido (aguarda publicação; rodar o Treino de novo depois)

### 2026-10-25 — Henry diz que procurou sem procurar, fala "a ferramenta não entendeu" e não sabe quem ficou em segundo
- **Data:** 2026-10-25
- **Sintoma:** Treino 8 (19:10Z, automático): "e a dona Joana, ela já respondeu?" → "Não achei nenhum cliente chamado Joana" sem ferramenta; "o cliente da Vila Carvalho…" → "a consulta não voltou" sem ferramenta; meta da equipe "bateu ou tá faltando" → "A ferramenta não entendeu essa consulta"; "Quem ficou em segundo?" → "Ainda não tenho o segundo colocado"; "quem tá há mais tempo sem retorno" 11,8 s com 2 ferramentas; "por que a gente não está fechando" após reclamação → "O que você quer saber?"; "cadê o plano" → recusa; "Matheus com 24" na lista; "voltando pro assunto do cliente" → funil; "me lembra do WhatsApp" → ofereceu lembrete.
- **Área:** Henry (voz/IA) / Treino
- **Impacto:** só o dono; resposta falsa (dizer que buscou), fala interna e respostas erradas.
- **Causa raiz:** sem rota direta para cliente com nome nem barreira para "não achei" sem ferramenta; "Não entendi." cru do catálogo ia ao modelo; comparação só com "quem mais/menos"; parados sem rota; diagnóstico só no fim da fala e dependente do modelo após reclamação; sem plano; montagem das conversas com o nome do dono; retomada pegava a última fala de cliente (com lugar) e não a com nome; "me lembra do" fora do resumo do WhatsApp. Lentidão do corretor: rodada provavelmente antes do deploy do Treino 7.
- **Correção:** `henryClientNameRequest`/`henryPlaceClientReply`/`henryClaimedLookupWithoutTool`; instrução do catálogo + `stripInternalTalk`; rota meta "bateu/faltando"; `comparisonFollowUp` (`posicao`/`seguintes`); rota `sem_contato` + `buildHenryStaleClientsSpeech`; `WHY_NOT_CLOSING` + `speak: "fixed"`; `isHenryPlanRequest` + `henryBottleneckPlan`; `buildHenryAwaitingReport` com `ownerId`; `henryResumeTopic` com `name`; `WHATSAPP_REMIND`; `rollingOverviewIdFor`. Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25 (Treino 8).
- **Arquivos/commit:** branch `fix/henry-achados-treino-8`.
- **Prevenção/teste:** `tests/henry-achados-treino-8.test.mjs` (falas reais); achados do Treino `busca_sem_ferramenta` e `vazamento_interno`.
- **Status:** Resolvido (aguarda publicação; rodar o Treino de novo depois e medir `[henry] tempos consultar_corretor`)

### 2026-10-25 — Henry demora 9 s num corretor, muda o gargalo a cada resposta, fala números no "boa tarde", não toca o "pagode antes" e diz que não trocou a música de aparelho
- **Data:** 2026-10-25
- **Sintoma:** Treino 7 (18:49Z, automático): "quantas simulações o Eduardo rodou nos últimos trinta dias?" 11,9 s (9,3 s de ferramenta); gargalo "entre aprovação e venda" → "entre enviados e aprovados" → "na documentação"; bom dia "Pode ser sim, mas coloca um pagode antes" → relatório sem música; "E aí, Henry, boa tarde!" → "…a equipe já fez 4 atendimentos"; "voltando pro assunto do cliente" → "989 clientes novos"; "troca essa música aí e coloca na Alexa" → "Não consegui trocar"; "Beleza, pode abrir." → "Pode ficar tranquilo."; "conversas no WhatsApp esperando resposta?" 3 rodadas.
- **Área:** Henry (voz/IA) / Treino
- **Impacto:** só o dono; resposta lenta, incoerente ou errada.
- **Causa raiz:** `consultar_corretor` esperava a meta de 30 dias calculada na hora (não usada na pergunta de métrica) e "últimos 30 dias" não tinha pré-cálculo; gargalo escolhido pelo modelo; "mas … antes" fora dos enfeites → virava busca de cantor; memória do dia com números e só a dica contra; `henryResumeTopic` casava qualquer fala com "clien"; simulação do Treino da troca de aparelho devolvia texto e evento de falha; "pode abrir" tratado como concordância; sem rota direta para "esperando resposta".
- **Correção:** meta só quando usada + pré-cálculo `overview:ultimos_30_dias`; `henryFunnelBottleneck` (fato `gargalo`); enfeites "mas/antes/primeiro"; `henryGreetingReply`; `needsName` no `henryResumeTopic`; `simulatedSpotifyDeviceTool` + rota `proxima` + aparelho em sequência; `henryAlreadyOpenReply`; `WHATSAPP_AWAIT`. Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25 (Treino 7).
- **Arquivos/commit:** branch `fix/henry-achados-treino-7`.
- **Prevenção/teste:** `tests/henry-achados-treino-7.test.mjs` (falas reais).
- **Status:** Resolvido (aguarda publicação; rodar o Treino de novo depois)

### 2026-10-25 — Henry não diz qual corretor mais fez simulações
- **Data:** 2026-10-25
- **Sintoma:** "quantas simulações o Eduardo fez nos últimos 30 dias?" → respondeu; "qual corretor mais realizou simulações?" e "olha as simulações dos corretores um por um e me diz quem mais realizou" → não conseguiu.
- **Área:** Henry (voz/IA)
- **Impacto:** só o dono; pergunta de comparação sem resposta.
- **Causa raiz:** não existia ferramenta de comparação por métrica: `consultar_corretor` lê UM corretor e `ranking_periodo` só ordena pontos; o modelo não tinha como montar "quem mais" de outra métrica.
- **Correção:** ferramenta só de leitura `comparar_corretores` sobre o mesmo overview do Desempenho por corretor (números iguais aos do `consultar_corretor`) + rota direta "quem/qual corretor mais|menos <métrica> <período>" herdando métrica e período da conversa. Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25.
- **Arquivos/commit:** `lib/henry-reports-core.mjs`, `lib/henry-voice.js`, `lib/henry-voice-turn.mjs`, `lib/henry-training-core.mjs` — branch `fix/henry-comparar-corretores`.
- **Prevenção/teste:** `tests/henry-comparar-corretores.test.mjs` (falas do dono, números batem com o individual); achado do Treino `comparacao_sem_resposta` + cenário "comparacao".
- **Status:** Resolvido (aguarda publicação)

### 2026-10-25 — Henry diz que "parados" não está disponível, "Já abaixei o volume" sem abaixar, perde a música do pedido composto, diz que errou os aprovados
- **Data:** 2026-10-25
- **Sintoma:** Treino 6 (18:26Z, automático): "quem tá parado há mais tempo no CRM?" → "o assunto de clientes parados não tá disponível por essa via" (antes funcionava); "Baixa um pouco aí, tá muito alto" → "Já abaixei o volume." sem ferramenta; "põe uma coisa mais de boa aí e depois me diz quantos clientes novos" → só os clientes novos; funil do mês "20 aprovados" e etapa "9 aprovados" → "eu tinha errado o número"; "começa pela Jeniffer" → "Achei duas Jenifferes (uma arquivada)"; bom dia "Hoje tá de pagode mesmo" → não tocou; "dá uma olhada no WhatsApp" → perguntou o quê; "Tens razão".
- **Área:** Henry (voz/IA) / Treino
- **Impacto:** só o dono; resposta errada, ação não feita dita como feita.
- **Causa raiz:** regressão do Treino 5 — a recusa de período do catálogo virou instrução das ferramentas de período, mas `sem_contato` (só hoje) com período longo caía nela e nenhuma ferramenta de período tem "parados"; rota de volume exigia "som/volume"; nada conferia ação afirmada x ferramenta; "Cara," no começo e "de boa" fora de `MUSIC_MOOD` → pedido de música não reconhecido e a rota direta pegava só a parte do CRM; nada dizia que funil do período ≠ etapa agora; `pickClientMatches` sem contexto da conversa; `classifyMorningMusicReply` sem "tá/mesmo/nessa" nos enfeites; "Beleza, …" virava concordância (sem ferramentas).
- **Correção:** `NOW_CATALOG_TOPICS` (período longo → hoje), volume curto + `henryClaimedActionWithoutTool` (rodada obrigatória e troca), vocativo/clima na música e guarda do pedido composto, `HENRY_STAGE_NOW_NOTE`/`HENRY_FUNNEL_PERIOD_NOTE` + fala "continuam na etapa", `clientFromConversation`, enfeites do bom dia, rota `conversas_aguardando`, "Tem razão". Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25 (Treino 6).
- **Arquivos/commit:** branch `fix/henry-achados-treino-6`.
- **Prevenção/teste:** `tests/henry-achados-treino-6.test.mjs` (falas reais); achados `acao_sem_ferramenta` e `tom_portugal` no Treino.
- **Status:** Monitorando (rodar o Treino de novo depois da publicação)

### 2026-10-25 — Henry diz "só consigo ver de hoje e de ontem", não sabe o tamanho da meta, "aquele cliente" vira clientes novos
- **Data:** 2026-10-25
- **Sintoma:** Treino 5 (18:02Z, automático): "quanto a equipe precisa fechar por dia pra bater a meta?" → "Não tenho esse número fixo aqui… Quer que eu abra a tela?"; "quanto falta pra fechar essas vendas" e "e os vinte esperando?" → "só consigo ver de hoje e de ontem"; "aquele cliente, como é que tá?" → `relatorio_do_dia` (4,8 s) e clientes novos; volume com 2 rodadas; "Feito: são 3 vendas…"; "é só pedir" repetido; bom dia no Treino sem sinal da música e com "Boa tarde" de novo.
- **Área:** Henry (voz/IA) / Treino
- **Impacto:** só o dono; resposta sem número ou limitação falsa.
- **Causa raiz:** o catálogo da Alexa recusa período ≠ hoje/ontem com "Isso eu só sei para hoje e ontem." e essa frase ia ao modelo, que a repetia — inclusive para etapa (fotografia de agora) chamada com `periodo: este_mes`; nenhuma ferramenta lia o TAMANHO da Meta Diária (`atividadesTotal`), só o percentual; não há meta de vendas no CRM e nada dizia isso ao modelo; "aquele cliente" ligava `isCrmQuestion`; `VOLUME_DOWN` não tinha o infinitivo; nenhuma trava de rótulo nem de bordão em variante. Bom dia: não era bug do servidor — o Treino repassa o passo pendente igual ao app; só não registrava a música tocada.
- **Correção:** instrução das ferramentas de período no lugar da recusa, etapa = agora, `detalhe: "tamanho"` + `buildHenryTeamGoalSizeSpeech`, rota de falta de vendas com `HENRY_NO_SALES_GOAL`, lista da etapa (`loadHenryStageClients`), `isVagueClientReference`, volume no infinitivo, `stripSpeechLabel`, `isOfferClosing`, `dropReportGreeting`, `music` na troca do Treino, achado `limitacao_periodo`. Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25 (Treino 5).
- **Arquivos/commit:** branch `fix/henry-achados-treino-5`.
- **Prevenção/teste:** `tests/henry-achados-treino-5.test.mjs` (falas reais).
- **Status:** Monitorando (rodar o Treino de novo depois da publicação)

### 2026-10-25 — Henry fala "Última atualização há 28 minutos" duas vezes, ranking no período errado, piada vira CRM, "aquela parada" vira clientes novos, repete após reclamação, não fala os nomes
- **Data:** 2026-10-25
- **Sintoma:** Treino 4 (17:27Z, já com `1e18d9c`): meta da equipe = "Última atualização há 28 minutos. A meta da equipe está em 0 por cento. Última atualização há 28 minutos. Ninguém bateu a meta ainda."; "me fala do ranking primeiro" (depois de "ranking dessa semana") → "Ranking hoje: 1º Gabriel e 2º Bruna."; piada → `relatorio_do_dia` 11,3 s; "aquela parada que você tava falando" → "Hoje entraram 2 clientes novos."; "não era isso" → "São 3 vendas…" de novo; "atendimentos de hoje" → oferta; "o nome deles" → "estão na tela"; volume com 2 rodadas e frase longa; ranking_periodo/relatorio_do_dia 6,4–7,5 s.
- **Área:** Henry (voz/IA) / cache de métricas
- **Impacto:** só o dono; fala robótica, errada ou lenta.
- **Causa raiz:** a rota direta falava a frase do catálogo da Alexa, que traz o prefixo de dado velho (`answerQuery`) em CADA frase — a meta junta duas; o período herdado era procurado só na janela de turnos do modelo (o "ranking dessa semana" já tinha saído); "cliente"/"parada"/"vendas" ligavam `isCrmQuestion` → rodada extra com ferramenta obrigatória em piada, referência e concordância; a reclamação comparava só dígitos ("Três" × "3"); clientes novos com nomes ficava fora da rota direta; volume/aparelho só pelo modelo. Lentidão: o Henry recalculava qualquer cache fora da validade (15/45 min) e o job `?mode=heavy` **não existe em produção** (migration `20261023210000` não aplicada) — pesados só na reserva do `refresh` (30 em 30 min no domingo).
- **Correção:** `deps.staleText` no roteador (Henry sem a frase crua; menção só > 1 h), falas próprias de meta/ranking, período pela conversa do dia inteira, `isCasualRequest`/`isHenryAgreement`/`isPreviousReference`, `numbersOf`, rotas diretas de atendimentos/nomes/volume/aparelho/música + pergunta, cache do Henry até 1 h, Meta do dia do relatório pelo pré-cálculo, achados `cache_cru`/`texto_duplicado`. Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25 (Treino 4). **Pendente:** aplicar a migration do job pesado.
- **Arquivos/commit:** branch `fix/henry-achados-treino-4`.
- **Prevenção/teste:** `tests/henry-achados-treino-4.test.mjs` (falas reais).
- **Status:** Monitorando (rodar o Treino de novo depois da publicação)

### 2026-10-25 — Henry não busca a meta da equipe (3ª vez), promete "vou puxar" e não puxa, responde 8–11 s, diz 12 e 2 clientes novos no mesmo dia, ranking no período errado, puxa CRM em "como foi teu dia?"
- **Data:** 2026-10-25
- **Sintoma:** Treino 3 (16:42Z, já com `206958b`): "como tá a meta do dia pra equipe?" → "Ainda não tenho o número… Pergunta de novo que eu busco agora."; "quero saber onde a gente tá errando" → "Se quiser, eu puxo o funil…" e depois "Vou puxar o funil deste mês agora…" sem número; clientes novos/movimento/funil 8,5–11 s; "12 clientes novos" (16:11Z) × "2" (15:22Z/16:42Z); "me fala do ranking primeiro" (depois de "ranking dessa semana") → o mês; "como foi teu dia?" → "Entraram 2 clientes novos"; "Põe um rock aí" → "Me diz o artista…".
- **Área:** Henry (voz/IA)
- **Impacto:** só o dono; resposta sem número/errada ou lenta.
- **Causa raiz:** a escolha da ferramenta era 100% do modelo — ele respondeu sem ferramenta (meta, música, promessa) e a rodada extra só pedia de novo (o modelo recusou outra vez); "clientes novos" tinha caminhos diferentes (o modelo escolhia o assunto; o Início = 2); período do ranking escolhido pelo modelo pelo último período qualquer; prompt mandava "como tá o dia" para `relatorio_do_dia` sem separar "o TEU dia". Lentidão: `relatorio_do_dia` espera o resumo do dono (Meta do dia = 9,0 s medidos em `crm_metric_cache.compute_ms` de `meta:hoje`) e o funil do mês recalcula o Desempenho (7,0 s, `overview:este_mes`) quando o pré-cálculo passa de 45 min, + 2 rodadas do modelo.
- **Correção:** rota direta antes do modelo, rodada com `tool_choice: any` para promessa/pergunta ignorada, clientes novos sempre pela contagem do Início, período do mesmo assunto, pergunta pessoal sem ferramentas, achados `promessa_sem_acao`/`resposta_lenta` no Treino. Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25 (Treino 3).
- **Arquivos/commit:** branch `fix/henry-achados-treino-3`.
- **Prevenção/teste:** `tests/henry-achados-treino-3.test.mjs` (falas reais).
- **Status:** Monitorando (rodar o Treino de novo depois da publicação; ver tempos por troca no relatório)

### 2026-10-25 — Henry ignora a pergunta (música composta, "e aí, beleza? como tá o movimento?"), diz "não tenho acesso aos imóveis", repete a resposta depois de "não foi isso" e recusa o funil do mês
- **Data:** 2026-10-25
- **Sintoma:** Treino 2: "Coloca um rock aí" → "Prontinho, já começou! rock."; "bota alguma coisa mais tranquila aí e depois me diz quantos cliente novo entrou hoje" → só a música; "E aí, Henry, beleza? Como é que tá o movimento hoje?" → "Fala, chefe! Tô bem, e você?"; imóvel → "Não tenho acesso aos imóveis pela voz"; meta da equipe → "Quer que eu traga o número exato?"; "não foi isso que eu perguntei" → "Foram 3 vendas" de novo; "funil desse mês" → "só hoje ou ontem"; "Bora voltar pro funil" → falou da tela de Clientes.
- **Área:** Henry (voz/IA)
- **Impacto:** só o dono; respostas incompletas/erradas, números da tela certos.
- **Causa raiz:** (1) sem nome de faixa, `musicPlayingLine` colava o termo de busca depois da exclamação; (2) `isMusicRequest` recusava o pedido por causa do "cliente" da 2ª parte e nada conferia se a parte-pergunta foi respondida (a fala fixa da música apagava o resto); (3) prompt só tinha regra de cumprimento puro, com o exemplo "Fala, chefe! Tô bem, e você?"; (4) nenhuma ferramenta lia imóveis; (5) `meta_equipe` só com percentual e prompt sem proibir oferecer o número; (6) nada tratava a reclamação; (7) funil do catálogo da Alexa é a fotografia de agora e "desse mês" não era reconhecido; (8) "voltar pro" não tinha leitura de assunto.
- **Correção:** `lib/henry-voice-turn.mjs` (parte-pergunta, rodada extra, reclamação, retomada), ferramentas `buscar_imoveis` e `funil_periodo`, meta com "quantos bateram", frases de música com o pedido dentro, regras no prompt, achados novos no Treino. Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25 (Treino 2).
- **Arquivos/commit:** branch `fix/henry-achados-treino-2`.
- **Prevenção/teste:** `tests/henry-achados-treino-2.test.mjs` (falas reais).
- **Status:** Monitorando (rodar o Treino de novo depois da publicação)

### 2026-10-25 — Henry responde "Nenhuma delas", começa com "Suspense:", fala "a Sem" e recusa o ranking da semana
- **Data:** 2026-10-25
- **Sintoma:** no Treino do Henry: "e a meta do dia da equipe?" → "Nenhuma delas"; "tem conversa no WhatsApp esperando?" → "Suspense: são 116…"; "quem tá parado há mais tempo?" → "a Noemi, a Sem, a Leticia…"; "ranking da semana?" → "Então não dá pra trazer a semana por voz agora"; "é só chamar" em todo agradecimento; promessa de "deixar a agenda pronta".
- **Área:** Henry (voz/IA), voz da Alexa (nome de cliente)
- **Impacto:** só o dono; respostas erradas/estranhas, números da tela certos.
- **Causa raiz:** (1) stream da IA aceito sem fim de mensagem (pedaço virava resposta) e nenhuma checagem de resposta cortada; (2) ranking do catálogo da Alexa só tem hoje/ontem e o Henry não tinha leitura de ranking por período; (3) o guia de estilo listava "Suspense curto + número." e o modelo copiou o rótulo; (4) `firstNameOf("Sem nome")` = "Sem" nos provedores da voz (`|| "Cliente"` nas pendências); (5) prompt sem proibição de oferecer ação; (6) closing só como pedido no prompt e "é só chamar" nos bancos de exemplo.
- **Correção:** stream incompleto = erro com nova tentativa sem stream; rodada extra para resposta cortada; ferramenta `ranking_periodo`; guia sem rótulos; `clientFirstNameOf`; regra de oferta no prompt; `trimRepeatedClosing`; achados novos no relatório do Treino. Detalhe: `docs/CHANGELOG_AI.md` 2026-10-25.
- **Arquivos/commit:** branch `fix/henry-achados-treino`.
- **Prevenção/teste:** `tests/henry-achados-treino.test.mjs` (falas reais da rodada no relatório do Treino).
- **Status:** Monitorando (rodar o Treino de novo depois da publicação)

### 2026-10-25 — Henry: "leads" e "clientes novos" como duas coisas, "201" falado estranho e aberturas repetidas ("Ok, vou dar uma olhada nos números")
- **Data:** 2026-10-25
- **Sintoma:** "Leads e clientes novos são a mesma coisa"; "o 201, quando ele fala, não fica natural"; "o início dele é muito repetitivo [...] muda uma palavra e fala a mesma frase".
- **Área:** Henry (voz/fala)
- **Impacto:** só o dono; fala confusa e repetitiva, números da tela certos.
- **Causa raiz:** (1) resumo com duas contagens do mesmo cadastro (leads de hoje do Início + clientes novos do funil/desde ontem); (2) número masculino composto ia em dígitos para a ElevenLabs flash v2.5, que lê dígitos compostos mal; (3) não repetir = id/texto exato; o banco de vocabulário e os exemplos do prompt empurravam "vou olhar/deixa eu ver" como abertura.
- **Correção:** um item "N clientes novos" (definição do Início); compostos por extenso no gênero certo em `concordarNumeros`; semelhança (`lib/henry-repetition-core.mjs`) em espera, confirmação, repertório, abertura do modelo e Treino; bancos ampliados; prompt "comece direto".
- **Arquivos/commit:** ver `docs/CHANGELOG_AI.md` 2026-10-25 — branch `fix/henry-numeros-aberturas`
- **Prevenção/teste:** `tests/henry-repetition.test.mjs`, tabela de números em `tests/pt-br-concordancia.test.mjs`, bancos por semelhança em `tests/henry-wait-phrases.test.mjs`.
- **Status:** Monitorando (ouvir o "201" e o começo das respostas no PC do dono)

### 2026-10-25 — Extensão do Marketplace em "silêncio total" e respostas presas com a janela de trabalho atrás de outra em tela cheia
- **Data:** 2026-10-25 (sintoma desde 2026-10-24 12:44 UTC)
- **Sintoma:** "a aba do Marketplace e a do Instagram ficam abertas, porém eu abro outra janela para utilizar, em tela cheia; as duas abas ficam atrás dessa." Último sinal da extensão (MKT-2g) em 24/10 12:44 UTC e nunca mais; antes, diagnóstico `aba_oculta` (`visibility hidden`, `hasFocus false`); 4 respostas de corretores presas (queued/sending). Publicação de anúncio funcionou.
- **Área:** `ferramentas/marketplace-publicador` (1.9.7), `ferramentas/instagram-seguidor` (1.1.5), sinal MKT-2g
- **Impacto:** Chat do Marketplace parado (nada lido, nenhuma resposta enviada) sem motivo visível no CRM.
- **Causa raiz:** (1) coberta, a janela de trabalho fica oculta para o Chrome (para de desenhar; Facebook não abre a conversa); (2) o único sinal ao CRM era a sincronização feita DEPOIS de ler a caixa — leitura com erro/prazo estourado ia para o `catch` do `chatTick` sem chamar o CRM, e o laço de envio também ficava depois da leitura. O alarme e o service worker funcionavam; a rodada é que terminava muda.
- **Correção:** 1.9.8 — emulação de foco pelo depurador só durante cada ação (`lib/page-awake.js`: página visível e com foco atrás de outra janela, sem trazer à frente); falha na caixa não encerra a rodada (CRM + envios seguem); toda rodada/pausa chama o CRM com `round {ok, stage, error}`; CRM guarda o motivo, mostra no Chat e o aviso "sem sinal" conta da última leitura ok. Instagram 1.1.6: mesma emulação na leitura do botão e cliques do perfil.
- **Arquivos/commit:** ver `docs/CHANGELOG_AI.md` 2026-10-25 — branch `fix/extensoes-aba-atras`
- **Prevenção/teste:** `ferramentas/marketplace-publicador/tests/page-awake.test.js`, `ferramentas/instagram-seguidor/tests/pagina-acordada.test.mjs`, `tests/marketplace-extension-signal.test.mjs`; teste manual em Chrome for Testing com página que só reage visível + com foco.
- **Status:** Monitorando (instalar 1.9.8/1.1.6 no PC do dono e conferir o Chat com a janela atrás da tela cheia)

### 2026-10-24 — Henry: "aumenta o volume" → diz que aumentou e não aumenta; a cada play a música cai para quase mudo
- **Data:** 2026-10-24
- **Sintoma:** "Estou pedindo para ele aumentar o volume, ele fala que aumentou, mas na verdade não está aumentando. Toda vez que eu coloco uma música […] ele vai para o volume mínimo, quase mudo, acho que 10%."
- **Área:** Henry + Spotify (volume)
- **Impacto:** só o dono, com música tocando.
- **Causa raiz:** (1) o "aumenta" somava o passo ao volume ABAIXADO (15% enquanto ele escuta), não ao do dono — 60% virava 30% e ele dizia "aumentei"; e o `keep` impedia a volta, então ficava sempre em ~30%; a resposta nunca conferia o player. (2) o play do bom dia fixava 28% e a fala abaixava para 25% disso (~7%). (3) a subida de volta parava no meio: o Spotify demora a refletir cada passo, o `expect` estrito via "mexeu manual" e desistia; qualquer falha também desistia e esquecia o volume do dono; o próximo abaixar partia do volume já baixo (25% de 25%).
- **Correção:** play nunca define volume (`MORNING_VOLUME` removido); "aumenta/abaixa" parte do volume do dono (`baseVolume`) e confere no player (1 nova tentativa; não aplicou → "não mudou"; `spotifyVolumeOutcome`); pedido aplicado vira o volume do dono e cancela a volta (`spotifyVolumeSet`); abaixar parte do volume do dono lembrado pela tela (`resolveDuckPrevious`, `spotifyUserMemoryFor`); subida aceita o atraso (`expectFrom`), tenta de novo uma vez e não esquece (`spotifyRestoreStep`); falha ao ler o player não é "manual".
- **Arquivos/commit:** `lib/henry-spotify-core.mjs`, `lib/henry-spotify.js`, `lib/henry-voice.js`, `lib/henry-morning-core.mjs`, rotas `app/api/admin/henry/{route.js,spotify/player,spotify/play}`, `components/henry/HenryVoiceAssistant.jsx` — branch `fix/henry-spotify-volume`.
- **Prevenção/teste:** `tests/henry-spotify-volume.test.mjs` (play sem volume, abaixar não encadeia, manual vence a volta, só confirma se aplicou).

### 2026-10-24 — Henry: segurando Enter, ao soltar ele "pega só a última coisa que eu falei"
- **Data:** 2026-10-24
- **Sintoma:** aperta Enter, fala uma frase longa, solta — o Henry responde só ao último pedaço e "não entende".
- **Área:** Henry (aperte-para-falar, Chrome)
- **Impacto:** só o dono; computador com o reconhecimento do Chrome.
- **Causa raiz:** (1) o final do último trecho chegava DEPOIS do envio (~0,5 s após soltar) com palavras diferentes do parcial já usado; a checagem de "trecho já usado" (`remainderAfter`) não reconhecia e ele virava um 2º pedido (janela de conversa aberta) que substituía o 1º; (2) reinício do reconhecimento no meio do aperto descartava o parcial em aberto; (3) reapertar logo depois de soltar zerava o que ainda não tinha sido enviado.
- **Correção:** acumulador por (sessão do reconhecedor, índice) enquanto aperta + resultados atrasados desses trechos ignorados depois de soltar + reaperto em ~0,5 s continua o mesmo pedido (`trackPttResult`/`pttLateResultIgnored`, `lib/henry-voice-conversation.mjs`).
- **Arquivos/commit:** `lib/henry-voice-conversation.mjs`, `components/henry/HenryVoiceAssistant.jsx` — branch `feat/henry-ptt-ao-vivo`.
- **Prevenção/teste:** `tests/henry-push-to-talk.test.mjs` (junção de vários trechos, reinício, final atrasado).

### 2026-10-24 — Henry fala "tô consultando os dados", "analisando o CRM", "dando uma olhadinha" quando o dono pede música
- **Data:** 2026-10-24
- **Sintoma:** "Toda vez que eu peço uma música, ele fala algo relacionado ao CRM… 'estou consultando os dados', 'estou analisando o CRM', 'estou dando uma olhadinha'."
- **Área:** Henry (confirmação de escuta e frases de espera)
- **Impacto:** só o dono; pedidos de música por voz (falado, aperte-para-falar, app de desktop, iPhone).
- **Causa raiz:** três pontos na mesma lib (`lib/henry-voice-narration.mjs`): (1) `henryAckContext` tratava "toca/tocar/playlist/música" como pedido de DADOS → sempre frase de verificação ("Peraí que eu confiro.", "Tô olhando aqui.", "Beleza, já tô vendo."); (2) na gravação (aperte-para-falar, desktop, iPhone) a confirmação sai antes da transcrição, sem texto → 25% de chance de uma dessas mesmas frases; (3) `isMusicRequest` não reconhecia "quero ouvir/escutar X", "manda um pagode", "vamos de sertanejo", "dá um play", "volta a tocar", cortesia antes do verbo ("por favor toca", "você pode tocar", "pode colocar") nem o nome transcrito como "Henrique"/"Enri" → tópico padrão "geral" → frases de espera "Só um instante, tô analisando seus dados." / "Bora ver o que o CRM diz." (e "quantas músicas…" virava música por engano).
- **Correção:** música é lida pelo texto antes de escolher a confirmação (contexto `music` → só som ou interjeição); sem texto, a frase sorteada é só uma das neutras (`neutral: true`: "Já te falo.", "Deixa comigo.", "Um segundinho."); `isMusicRequest` ampliado (positivos e negativos), mesma função no servidor (`henryInitialProgress`) e na tela (`henryMusicIntent`) → tópico `music` e frases do Spotify desde o 1º evento.
- **Arquivos/commit:** `lib/henry-voice-narration.mjs` — branch `fix/henry-musica-frase-espera`.
- **Prevenção/teste:** `tests/henry-music.test.mjs`, `tests/henry-listen-ack.test.mjs`.
- **Status:** Corrigido (não publicado — aguarda merge)

### 2026-10-24 — Henry: "tenho um aviso, posso falar?" → "sim, qual é esse aviso?" → "não tenho nenhum aviso"
- **Data:** 2026-10-24
- **Sintoma:** o Henry chamou para um aviso; o dono respondeu "sim, pode me falar, qual é esse aviso?" e ele disse que não tinha aviso e foi "procurar no CRM".
- **Área:** Henry (avisos por voz)
- **Impacto:** dono; aviso de cliente/chegada/Central/aniversário não entregue quando a resposta era longa ou vinha depois do chamado.
- **Causa raiz:** `classifyAlertAnswer` só aceitava frases curtas (≤ 4 palavras) ou de uma lista fechada; "sim pode me falar qual esse aviso" (7 palavras) virava "other" e ia ao modelo como pergunta nova — e o modelo não recebia nada sobre o aviso guardado (só o navegador sabia). Depois do chamado (aviso no indicador) "qual é o aviso?" também ia ao modelo.
- **Correção:** decisão única `decideAlertReply` (aceite de qualquer tamanho feito só de palavras de permissão, pergunta pelo aviso, indicador, "Esse aviso já foi resolvido." quando nada sobrou), usada por `handleFinal` e `ask` (todos os caminhos); o pedido ao modelo leva `alertState` → `buildHenryAlertNote`.
- **Arquivos/commit:** `lib/henry-voice-client-alerts-core.mjs`, `components/henry/HenryVoiceAssistant.jsx`, `lib/henry-voice.js`, `lib/henry-voice-persona.mjs`, `app/api/admin/henry/route.js` — branch `fix/henry-aviso-resposta`
- **Prevenção/teste:** `tests/henry-alert-reply.test.mjs`.
- **Status:** Resolvido (aguardando publicação)


### 2026-10-24 — Henry fala no masculino palavra feminina ("entraram dois transferências")
- **Data:** 2026-10-24
- **Sintoma:** "Ele falou 'entraram dois transferências'. Ele devia ter dito 'entraram duas' [...] vários lugares colocando no masculino palavras em feminino."
- **Área:** Henry (voz)
- **Impacto:** só o dono; toda fala com 1/2/x1/x2/centenas antes de substantivo feminino fora da lista antiga.
- **Causa raiz:** os textos vão à voz com número em dígitos ("2 transferências") e o provedor lê sempre no masculino; a correção de 22/10 (`feminineNumbers`) usava lista FECHADA sem "transferência", "tarefa" e outras (e tinha "alerta" e "mil" errados). O modelo às vezes escrevia "dois"/"um" por extenso, que nada corrigia.
- **Correção:** regra única `lib/pt-br-concordancia.mjs` (lista + terminações femininas, "um/dois" por extenso, "mil" pelo que vem depois) usada por `pronounceForSpeech`; montadores com `contagem`; regra no prompt fixo.
- **Arquivos/commit:** `lib/pt-br-concordancia.mjs`, `lib/henry-voice-providers.mjs`, `lib/henry-*-core.mjs`, `lib/alexa-config-core.mjs` — branch `fix/henry-concordancia`.
- **Prevenção/teste:** `tests/pt-br-concordancia.test.mjs` (tabela 1/2/3 × substantivo, snapshots dos avisos, varredura dos bancos de frases e dos montadores).
- **Status:** Corrigido (não publicado — aguarda merge)

### 2026-10-24 — Henry "não consegue visualizar" se a cliente do aviso está no oficial ou no WhatsApp pessoal
- **Data:** 2026-10-24
- **Sintoma:** o Henry avisou "entrou uma cliente nova e está com você"; o dono perguntou se ela estava no número da API oficial ou no pessoal e ele respondeu que não conseguia visualizar.
- **Área:** Henry / WhatsApp (Chat)
- **Impacto:** só o dono (Henry); qualquer pergunta de canal/número da conversa de um cliente.
- **Causa raiz:** (1) nenhuma ferramenta do Henry devolvia o canal da conversa: `buscar_clientes` e a conversa do `conversas_aguardando` liam etapa, datas e resumo, nunca `session_key`/`session_slot` de `whatsapp_conversations`; (2) o aviso falado (`speakHenryClientAlerts`) não entrava na memória do dia, que é o histórico que vai ao modelo quando existe — "ela" não tinha a quem se referir.
- **Correção:** `listClientChatChannels` (`lib/whatsapp-chat.js`, mesmo escopo/canal do Chat) → `describeChatChannels` (`lib/henry-reports-core.mjs`) no campo `whatsapp` de `buscar_clientes` e da conversa do cliente; o aviso grava na memória do dia a linha "[Aviso do Henry] Cliente do aviso: <nome completo> (novo, com você)" + o texto falado (`alertMemoryContext`, `rememberHenryAlert`); prompt explica o marcador e o campo.
- **Arquivos/commit:** `lib/whatsapp-chat.js`, `lib/henry-reports*.{js,mjs}`, `lib/henry-voice-client-alerts*.{js,mjs}`, `lib/henry-voice.js`, `lib/henry-voice-persona.mjs` — branch `fix/henry-canal-whatsapp`.
- **Prevenção/teste:** `tests/henry-client-channel.test.mjs`.
- **Status:** Corrigido (não publicado — aguarda merge)

### 2026-10-24 — "Sim, você tem interesse?" volta a aparecer como mensagem do cliente no Chat Marketplace
- **Data:** 2026-10-24
- **Sintoma:** conversa "Andreza" (origem Roleta) com "Sim, você tem interesse?" como mensagem da cliente às 00:52 — é a sugestão de resposta rápida do Facebook ao vendedor. "Voltou a informar errado" (mesmo sintoma do caso Debora, 22/10).
- **Área:** Chat Marketplace / extensão
- **Impacto:** 18 conversas de 22/10 06:31 a 24/10 03:52 com a mensagem falsa (2 delas como última mensagem na lista).
- **Causa raiz:** não foi regressão de layout: a correção de 22/10 (1.9.1) partia de que a sugestão não tem `data-message-id`, mas o bloco da sugestão TEM id próprio do Facebook (todas as 18 gravadas como `fb:mid…`); o leitor tirava o texto do chip (botão com `aria-label` igual ao texto) e o servidor só descartava o que não tinha id. PC na 1.9.4 (já com a 1.9.1).
- **Correção:** extensão 1.9.7 ignora painel/chips no texto do balão e descarta o texto exato da sugestão; servidor descarta inbound "Sim, você tem interesse?"/"Yes, are you interested?" (`isQuickReplySuggestion`) também na renormalização. Detalhe: `CHANGELOG_AI.md` (2026-10-24).
- **Arquivos/commit:** `ferramentas/marketplace-publicador/selectors.js`, `lib/marketplace-chat-core.mjs` — branch `fix/marketplace-sugestoes-autoresposta`.
- **Prevenção/teste:** `ferramentas/marketplace-publicador/tests/estrutura-real.test.js` (fixture com a sugestão com `data-message-id`, com e sem título), `tests/marketplace-auto-reply.test.mjs`, `tests/marketplace-chat-core.test.mjs`. Diagnóstico: `select body, count(distinct conversation_id) from marketplace_messages where direction='inbound' group by 1 having count(distinct conversation_id) >= 3`.
- **Status:** Diagnosticado, correção pendente de publicação + instalar extensão 1.9.7; limpeza das 18 linhas aguarda o dono (renormalização `apply=1`).

### 2026-10-24 — "Apareceu uma conversa com o meu próprio número nas Particulares, cheia de 'Mensagem enviada pelo celular'"
- **Data:** 2026-10-24
- **Sintoma:** Chat > Particular: conversa com o número do próprio corretor (responsável ele mesmo, "Janela fechada"), só com bolhas "Mensagem enviada pelo celular — o CRM não conseguiu ler o conteúdo."
- **Área:** WhatsApp
- **Impacto:** conversas-lixo com o próprio número em várias sessões (a maior com 563 linhas); essas linhas também contavam como "contato humano" do corretor consigo mesmo. Mensagens para contatos reais não foram desviadas.
- **Causa raiz:** o celular manda à própria conta mensagens de protocolo (nó "peer", ex.: resposta ao pedido de reenvio do conteúdo) com remoteJid = o próprio LID; as que não decifram viravam `undecrypted_message`. Sem o telefone do LID no serviço, o CRM o achava em OUTRA sessão (que conversa com esse corretor) e criava a conversa com o próprio número.
- **Correção:** serviço não entrega mensagem da própria conta nem de nó "peer" e não pede reenvio de nó "peer"; CRM nunca cria/junta conversa com o `phone_number` da própria sessão. Detalhe: `docs/WHATSAPP.md` §1-L, `CHANGELOG_AI.md` (2026-10-24).
- **Arquivos/commit:** `whatsapp-individual-service/src/{message-extract,pipeline-guard,sessions}.js`, `lib/whatsapp-self-chat-core.mjs`, `lib/whatsapp-individual-inbound.js` — branch `fix-self-chat`.
- **Prevenção/teste:** `tests/whatsapp-self-chat.test.mjs`. Diagnóstico: conversa cujo `contact_phone` = `whatsapp_individual_sessions.phone_number` da mesma sessão; `metadata->>remote_jid` igual ao LID com que outras sessões falam com esse número; cruzar `message_at` com `placeholder_req` em `whatsapp_session_telemetry`.
- **Status:** Diagnosticado, correção pendente de publicação (Vercel + Railway); limpeza das conversas antigas aguarda o dono.
### 2026-10-24 — "Contato some da Meta Diária antes de receber mensagem"
- **Data:** 2026-10-24
- **Sintoma:** contato recém-entregue na Meta Diária (2ª passagem pela fila) volta para a Prospecção sem nenhuma tentativa; 11 devoluções `auto_returned` de rodada com `attempt_count = 0` no histórico (2 na mesma hora da entrega).
- **Área:** Meta Diária / Prospecção
- **Impacto:** o corretor perde contato da carteira sem trabalhar; contraria a MD-17 ("se não foi tentado contato ele fica ali ainda").
- **Causa raiz:** `claim_daily_goal_contacts` não zera `prospecting_contacts.last_attempt_at`; o retorno de 7 dias (`autoReturnStaleProspectingContacts`) lia a data do ciclo anterior e devolvia no próximo ciclo do cron.
- **Correção:** o retorno de 7 dias ignora contato com rodada ativa sem tentativa (`listContactIdsWithUntriedActiveRound`).
- **Arquivos/commit:** `lib/prospecting-auto-return.js`, `lib/daily-goal-round-release.mjs` — commit deste registro.
- **Prevenção/teste:** `tests/cold-list.test.mjs`.
- **Status:** Monitorando (aguarda publicação)

### 2026-10-24 — "Um corretor fica com 0 contatos novos na meta do dia e os outros com todos"
- **Data:** 2026-10-24
- **Sintoma:** em `daily_goal_wallet_freeze` de 21-23/10 um corretor não tinha nenhum dos 10 novos do dia no congelamento; os demais tinham todos.
- **Área:** Meta Diária
- **Impacto:** meta de prospecção do dia diferente entre corretores sem motivo de negócio.
- **Causa raiz:** o congelamento da carteira pega as rodadas ativas no instante; se rodava (cron/1º acesso) antes da geração da cota, os novos ficavam de fora — dependia de quem rodava primeiro.
- **Correção:** `includeGeneratedRoundsInWalletFreeze` acrescenta ao congelamento de hoje os novos da cota gerados depois dele (dias passados não foram regravados).
- **Arquivos/commit:** `lib/daily-goal-wallet.js`, `lib/daily-goal-wallet-core.mjs`, `lib/daily-goal.js` — commit deste registro.
- **Prevenção/teste:** `tests/daily-goal-wallet-freeze-order.test.mjs`.
- **Status:** Monitorando (aguarda publicação)

### 2026-10-24 — "Erro ao ler o perfil liberava o painel (até para e-mail inativo)"
- **Data:** 2026-10-24
- **Sintoma:** achado de auditoria (sem relato de uso): falha ao ler `admin_users` fazia o login cair num perfil de reserva ATIVO; um e-mail inativo no banco estava fixo como autorizado.
- **Área:** Permissões
- **Impacto:** risco de acesso indevido durante instabilidade do banco.
- **Causa raiz:** `buildAuthorizedAdminResult` engolia o erro e usava `buildLegacyAdminProfile`; `DEFAULT_ADMIN_EMAILS`/fallback "benck" com e-mail fixo (agravante do P-10).
- **Correção:** erro de leitura = 503 (sem perfil de reserva, nunca guardado no cache); só o dono fica fixo.
- **Arquivos/commit:** `lib/admin-auth.js`, `lib/admin-profiles.js`, `app/api/admin/session/route.js` — commit deste registro.
- **Prevenção/teste:** `tests/server-cache.test.mjs` (3 testes novos).
- **Status:** Monitorando (aguarda publicação)

### 2026-10-23 — "Cliente transferido só aparece na notificação, não no card de aguardando atendimento"
- **Data:** 2026-10-23
- **Sintoma:** corretor que recebe cliente por transferência (principalmente "mais de 3 dias sem contato") só vê o aviso; o cliente não entra em "Novos atendimentos" e se perde.
- **Área:** Clientes / Pendências
- **Impacto:** todos os perfis; 26 transferidos sem atendimento em 23/10; fila de reativação com ~100 clientes/semana para uma corretora.
- **Causa raiz:** `getUnattendedClientIds` só considerava status "Atendimento automático" sem atendimento humano em toda a vida do cliente — transferido vem em outro status ou já atendido pelo corretor anterior.
- **Correção:** soma os transferidos não atendidos desde o recebimento (CLI-7b). Detalhe no CHANGELOG_AI.
- **Arquivos/commit:** `lib/simulation-list-query.js`, `lib/transferred-awaiting-core.mjs` — commit deste registro.
- **Prevenção/teste:** `tests/transferred-awaiting-card.test.mjs`.
- **Status:** Monitorando (aguarda publicação com o ok do dono)

### 2026-10-23 — "Toda hora aparece que o WhatsApp está conectado sem receber, com a opção de desconectar"
- **Data:** 2026-10-23
- **Sintoma:** corretores recebiam várias vezes por dia o aviso Importante "WhatsApp conectado, mas sem receber" (push + bloqueio da tela) mandando desconectar e ler o QR de novo; o número estava funcionando.
- **Área:** WhatsApp individual (CRM, `lib/whatsapp-false-connection*`)
- **Impacto:** 23/10 até 15h30: 12 avisos a 5 números (+20 à equipe) e 2 desconexões automáticas do Eduardo. Em 8 dos 12 as mensagens entravam e saíam (envios "entregues", recebidas logo depois, sem atraso); 4 da ketlin, sem tráfego algum desde 20/10 (reiniciar e reler o QR não mudou nada). O vigia do serviço não achou nenhuma fila travada no dia. Depois dos avisos: 4 "desconectar" manuais, 5 reconexões manuais e 2 desvinculações pelo celular — pareamento repetido é agravante de banimento (Caroline banida no mesmo dia).
- **Causa raiz:** o alarme era por SILÊNCIO (X h úteis sem receber; desde 23/10, 30 min para número de alto volume) e por quedas repetidas — falta de mensagem não prova falha, e as quedas 500 de ~50 min acontecem em todos os números. O silêncio + 3 quedas em 6 h ainda disparava a desconexão automática (logout → QR). O aviso repetia a cada 2 h e mandava direto ao QR.
- **Correção:** só com evidência (≥ 3 envios para ≥ 3 conversas sem nada voltar do WhatsApp em ≥ 20 min, ou fila travada 2× em 1 h pelo vigia do serviço); primeiro reinício sem QR no serviço; só se persistir marca e avisa (1 por episódio, máx. 1 a cada 12 h por número), texto sem mandar desconectar. Marcas antigas saem sozinhas. Detalhe: `CHANGELOG_AI.md` (2026-10-23, "só com evidência").
- **Arquivos/commit:** `lib/whatsapp-false-connection-core.mjs`, `lib/whatsapp-false-connection.js`, `components/WhatsappIndividualStatus.jsx` — commit deste registro.
- **Prevenção/teste:** `tests/whatsapp-false-connection.test.mjs` (silêncio nunca é evidência; ordem reinício → aviso; teto de 12 h; textos). Conferir: `crm_alert_deliveries` com `dedupe_key like 'wa_false_b:%'` por dia e telemetria `pipeline_restart` kind `crm`.
- **Status:** Monitorando

### 2026-10-23 — App desktop lento e travando (Henry em tela cheia / app minimizado)
- **Data:** 2026-10-23
- **Sintoma:** "o app desktop está lento e travando"; CPU alta mesmo com o app minimizado ou na bandeja.
- **Área:** App de desktop / Henry / Frontend
- **Impacto:** só o PC do dono (app de desktop); a tela cheia do Henry pesava um núcleo inteiro também no navegador.
- **Causa raiz:** (1) a view do CRM roda com `backgroundThrottling: false` (necessário para a voz minimizada), o que mantém `document.hidden` sempre falso: nenhuma pausa do CRM (anel, cenas, pollings) disparava com o app minimizado; (2) na tela cheia, cada fio do anel era desenhado de novo 5× mais largo para o brilho — ~12–15 ms por quadro sem GPU — a 60 fps, sem nunca descansar ocioso.
- **Correção:** app 1.3.1 avisa a página ao minimizar/esconder (`onWindowVisibility` → `components/page-visibility.js`); brilho por camada reduzida/ampliada, 30 fps, 15 fps ocioso, qualidade adaptativa no `HenryOrb`. Números e detalhes no `CHANGELOG_AI.md` (2026-10-23, "App de desktop 1.3.1").
- **Arquivos/commit:** `desktop-app/src/main.js`, `desktop-app/src/preload.js`, `components/page-visibility.js`, `components/henry/HenryOrb.jsx` — commit da versão 1.3.1 do app.
- **Prevenção/teste:** `tests/page-visibility.test.mjs`, `desktop-app/tests/core.test.js` (`isWindowHidden`, lista da ponte), `tests/henry-voice-conversation.test.mjs` (30/15 fps e camada do brilho). Risco residual: outros ~30 pontos com `document.hidden` direto não pausam no app minimizado.
- **Status:** Monitorando (medir CPU no PC do dono com GPU)

### 2026-10-24 — Seguidor Instagram: DM de boas-vindas some em silêncio quando a API responde HTML
- **Data:** 2026-10-24
- **Sintoma:** pessoa seguiu de volta, mas a boas-vindas nunca chega e o popup não avisa nada (histórico: "resultado incerto, não será repetida").
- **Área:** Ferramenta pessoal fora do CRM (`ferramentas/instagram-seguidor/`)
- **Impacto:** toda DM de boas-vindas perdida enquanto a API privada de mensagens devolver a página HTML (mesma causa do show_many/seguir).
- **Causa raiz:** HTML 200 em `direct_v2/threads/broadcast/text/` virava `mudanca_api` com status 200; em `processarDm` isso não é bloqueante nem 4xx, então caía no ramo "incerto" (`dmIncerta`, nunca reenviada). Mas HTML significa que o Instagram devolveu a página e não processou o envio.
- **Correção (1.1.5):** `enviarDm` converte HTML (inclusive na alternativa por conversa) em `nao_enviada`; `processarDm` reagenda (+30 min, +2 h) e na 3ª falha desiste com alerta no popup "DM de boas-vindas não pôde ser enviada para @x" + notificação. A DM já usa os cabeçalhos da página (1.1.4). Sem envio por digitação na tela da DM.
- **Arquivos/commit:** `ferramentas/instagram-seguidor/{instagram-api.js,background.js}` — branch `fix/instagram-seguidor-1.1.1`
- **Prevenção/teste:** `ferramentas/instagram-seguidor/tests/dm-html.test.mjs` (fixture HTML na DM, 3 tentativas espaçadas + alerta, volta ao normal envia uma única vez).
- **Status:** Monitorando

### 2026-10-24 — Seguidor Instagram: "O endpoint friendships/show_many respondeu de forma inesperada (HTTP 200) … Resposta: HTML (título: Instagram)"
- **Data:** 2026-10-24
- **Sintoma:** popup da extensão Seguidor Instagram 1.1.3 mostrando o alerta de mudança de API no show_many (POST `/api/v1/friendships/show_many/` → HTTP 200 `text/html`).
- **Área:** Ferramenta pessoal fora do CRM (`ferramentas/instagram-seguidor/`)
- **Impacto:** checagem de follow-back em lote parada (aceite de solicitação de perfil privado e follow-back não detectados pela varredura); alerta assustador no popup. Mesmo padrão do seguir na 1.1.3.
- **Causa raiz:** a API privada do Instagram responde a página HTML do site (HTTP 200) quando a chamada não parece vir do próprio app web; a extensão mandava cabeçalhos fixos (app-id/asbd embutidos no código) e nenhum da versão atual da página (`x-instagram-ajax`), e tratava HTML como "mudança de API" sem plano B na checagem. Não foi possível confirmar contra o Instagram real qual cabeçalho falta (sem ação real a partir do ambiente).
- **Correção (1.1.4):** (a) as chamadas levam os cabeçalhos tirados da página aberta (app-id, asbd, `x-instagram-ajax`, csrf, claim — o diagnóstico mostra só os nomes); (b) HTML na API vira `indisponivel` (nunca sessão, pausa, alerta, perfil gasto ou limite do dia) e a checagem passa a ler o botão do perfil (Seguir / Seguir de volta / Seguindo / Solicitado) sem clicar, até 5 perfis por varredura de 30 min com intervalo humano; o friendships/show com HTML também cai na leitura do botão; (c) sem como saber se quem está "Seguindo" segue de volta, o deixar de seguir fica adiado.
- **Arquivos/commit:** `ferramentas/instagram-seguidor/{instagram-api.js,background.js}` — branch `fix/instagram-seguidor-1.1.1`
- **Prevenção/teste:** `ferramentas/instagram-seguidor/tests/checagem-html.test.mjs` (fixtures HTML/JSON do show_many e show, cabeçalhos da página, simulação com HTML e sem leitura). Risco residual: se o Instagram mudar o texto/estrutura do botão do perfil, a checagem fica "indisponível" (sem dano à conta).
- **Status:** Monitorando (confirmar no Chrome do dono se o show_many volta a responder JSON com os cabeçalhos da página)

### 2026-10-23 — Henry repete muito a mesma frase de espera ("Tô passando os olhos nos números")
- **Data:** 2026-10-23
- **Sintoma:** "o Henry repete muito 'Tô passando os olhos nos números'" (frase `w18`), mesmo depois da confirmação de escuta.
- **Área:** Henry / Frontend
- **Impacto:** só o dono; sem perda de dado.
- **Causa raiz:** (a) o pacote de frases era sintetizado inteiro numa só chamada (~80 frases, 2 por vez, função de 60 s): voltando pela metade (tempo, crédito ou limite da ElevenLabs), o navegador guardava a lista parcial no `sessionStorage` e nunca completava — poucas frases com áudio; (b) `pickWaitPhrase` só escolhia entre as com áudio e, esgotadas as do dia, voltava a sortear entre elas evitando só a anterior; `w18` cobre 5 assuntos (inclusive geral/relatório) e ficava em quase todo sorteio; (c) na gravação a confirmação toca ANTES da transcrição, e o "2,5 s depois da confirmação" contava do fim dela — a 1ª frase de espera entrava ~0,8 s depois de o pedido sair.
- **Correção:** cache por frase + pacote com teto de tempo + pré-aquecimento em lotes só do que falta; sem repetir no dia (ainda não usada sem áudio → silêncio e síntese dela; esgotado → nunca uma das últimas 10); 1ª frase ~2,5 s depois da confirmação e do pedido; +8 frases de números.
- **Arquivos/commit:** `lib/henry-voice-narration.mjs`, `lib/henry-voice.js`, `app/api/admin/henry/route.js`, `components/henry/HenryVoiceAssistant.jsx` — commit deste registro
- **Prevenção/teste:** `tests/henry-wait-phrases.test.mjs` (sem repetir no dia, silêncio + síntese, últimas 10, lotes, atraso com confirmação), `tests/henry-lexicon.test.mjs` (frases de espera seguras).
- **Status:** Monitorando (teste do dono)

### 2026-10-23 — Henry corta a fala no meio e responde "Não entendi" (app de desktop 1.3.0)
- **Data:** 2026-10-23
- **Sintoma:** "eu estou falando e ele corta minha fala no meio e já sai respondendo que não entendeu. Uma simples pausa de 1 segundo e ele já começa a pensar."
- **Área:** Henry / Frontend
- **Impacto:** só o dono; app de desktop (gravação + Scribe), iPhone (gravação) e parcial do Web Speech. Sem perda de dado.
- **Causa raiz:** a gravação fechava com 1,2 s abaixo de um único nível do medidor (0,1): respirar, "é…" ou trecho mais baixo contavam como silêncio; o pedaço cortado ia para o Scribe e voltava vazio/curto → "Não entendi" ou resposta a meia frase. O parcial do Web Speech também virava final com 1,2 s fixo.
- **Correção:** fim da fala com silêncio contínuo configurável (padrão 2,0 s; 1,2 s só para resposta curta com pergunta pendente), histerese (VAD Silero no app; nível menor depois de ouvir voz), máximo 25 s, continuação única depois de corte com transcrição vazia/cortada, "Ouvindo… pode continuar" — HENRY-1 "Fim da fala".
- **Arquivos/commit:** `lib/henry-voice-conversation.mjs`, `lib/henry-voice-style.mjs`, `components/henry/HenryVoiceAssistant.jsx`, `components/henry/henry-vad.js`, `components/henry/HenrySettingsCard.jsx`, `app/api/admin/henry/route.js` — commit deste registro
- **Prevenção/teste:** `tests/henry-voice-conversation.test.mjs` (pausa de 1 s não corta, histerese do VAD, pergunta pendente, continuação uma vez), `tests/henry-voice-style.test.mjs` (curto/normal/longo).
- **Status:** Monitorando (teste do dono no app de desktop e no iPhone)

### 2026-10-23 — Henry: "Não entendi" quando o dono responde "pode" à pergunta da música (com o Spotify tocando)
- **Data:** 2026-10-23
- **Sintoma:** com o Spotify tocando, "Bom dia, Henry" → ele pergunta "Posso dar play numa playlist…?" → o dono responde "pode" → aparece "Não entendi. Toque no Henry e fale de novo."
- **Área:** Henry / Frontend
- **Impacto:** só o dono; bom dia, "Qual vibe?", aviso com vocativo e qualquer pergunta dele com música tocando. Sem perda de dado.
- **Causa raiz:** (1) a guarda da música (commit e6b55ac) só aceitava frase sem o nome logo depois de um chamado explícito — a resposta curta a uma pergunta DELE era descartada na escuta contínua; (2) ao terminar de falar a pergunta ele devolvia o volume do Spotify na hora, então a resposta era gravada com a música alta e a transcrição voltava vazia → "Não entendi"; (3) o bom dia oferecia playlist mesmo com música já tocando.
- **Correção:** pergunta aberta (`openPendingReply`/`isAwaitingReply`, janela de 12 s depois que ele termina) libera resposta curta sem o nome na guarda (`musicListenGate` `awaitingReply`); música segue baixa durante a espera (`holdSpotifyDuck`); vazio/descartado com pergunta aberta → repete curta uma vez (`repeatQuestionFor`), depois fica no aguardo; no app de desktop o microfone abre sozinho depois da pergunta; bom dia com música tocando pula a oferta ("Já tá rolando um som, então bora pro dia:").
- **Arquivos/commit:** `lib/henry-voice-conversation.mjs`, `components/henry/HenryVoiceAssistant.jsx`, `lib/henry-voice.js`, `lib/henry-morning-core.mjs` — commit deste registro
- **Prevenção/teste:** `tests/henry-music.test.mjs` ("pode" aceito com pergunta pendente, ignorado sem ela, letra longa sempre ignorada, repetição curta só uma vez, aviso não repete).
- **Status:** Monitorando (teste do dono com o Spotify real)

### 2026-10-23 — Henry responde à letra da música que está tocando / fala de "analisar o CRM" ao pedir playlist
- **Data:** 2026-10-23
- **Sintoma:** (1) com o Spotify tocando, o Henry acorda e responde trechos da música; (2) ao pedir uma playlist ele diz que está "analisando o CRM/os números" e mostra cartões de ranking/gráficos.
- **Área:** Henry / Frontend
- **Impacto:** só o dono; sem perda de dado.
- **Causa raiz:** (1) o Spotify toca fora da página (app do PC/celular), então o cancelamento de eco do navegador não tem a referência desse som: a letra entrava como fala do dono na janela de conversa de 40 s (sem o nome), na tela cheia "já chamando", no barge-in por 3+ palavras ou com algo parecido com "Henry"/"para" no meio. (2) O pedido começava com o tópico `geral` (frases "conferir no CRM", "passando os olhos nos números") e, na resposta à música do bom dia (modo `report`), a tela ligava a cena de dados do relatório; a ferramenta `spotify` não tinha tópico próprio.
- **Correção:** guarda da escuta com música tocando (`musicListenGate`, `detectMusicBargeIn`, `isMusicGuardActive`) + volume do Spotify baixo enquanto ele escuta/responde; tópico `music` desde o 1º evento, frases e cena próprias (HENRY-1 "Música").
- **Arquivos/commit:** `lib/henry-voice-conversation.mjs`, `lib/henry-voice-narration.mjs`, `components/henry/HenryVoiceAssistant.jsx` — commit deste registro
- **Prevenção/teste:** `tests/henry-music.test.mjs` (frase sem nome ignorada, nome no começo aceito, letra longa ignorada, barge-in só forte, narração sem "CRM", topic music cedo).
- **Status:** Monitorando (teste do dono com o Spotify real; Vosk do app de desktop com outro agente)

### 2026-10-23 — Henry não para de falar quando o dono interrompe ("para", "Henry" ou falando por cima)
- **Data:** 2026-10-23
- **Sintoma:** com o Henry falando no computador, o dono diz "para" ou fala por cima e ele continua; às vezes o microfone "ouve" o próprio Henry.
- **Área:** Henry / Frontend
- **Impacto:** só o dono (único usuário do Henry); computador e app de desktop. Sem perda de dado.
- **Causa raiz:** (1) a voz passava pelo WebAudio para o anel (`createMediaElementSource` → destino), o que provavelmente desliga o cancelamento de eco do Chrome — o reconhecedor ouvia a voz dele misturada com a do dono; (2) "para" era anulado sempre que a resposta inteira tinha "para"; (3) o filtro de eco comparava com a resposta INTEIRA, inclusive palavras comuns, e descartava a fala do dono; (4) medidor com limiar alto (0,12/300 ms) e supressão de ruído; (5) no app de desktop ninguém escutava enquanto ele falava.
- **Correção:** voz direto do `<audio>` (anel por `captureStream`), regras novas de parada/eco, medidor 0,055/150 ms sem supressão de ruído, VAD local em duas etapas (volume baixo → confirmação → para) — ver CHANGELOG_AI 2026-10-23 e HENRY-1.
- **Arquivos/commit:** `components/henry/HenryVoiceAssistant.jsx`, `lib/henry-voice-conversation.mjs`, `components/henry/henry-vad.js` — commit deste registro
- **Prevenção/teste:** `tests/henry-voice-conversation.test.mjs` (parada isolada, palavras comuns, eco puro da frase atual, cauda com "Henry", sem `createMediaElementSource`, VAD sem CDN).
- **Status:** Monitorando (teste do dono no PC; iPhone sem mudança)

### 2026-10-23 — Cliente agradeceu "fotos e vídeos" que não aparecem no Chat (visualização única)
- **Data:** 2026-10-23
- **Sintoma:** foto/vídeo/áudio que o contato mandou não aparece na conversa do WhatsApp pessoal, embora as mídias comuns do mesmo número cheguem normalmente.
- **Área:** WhatsApp
- **Impacto:** toda mensagem de visualização única recebida pelos números dos corretores sumia sem rastro (as enviadas pelo celular apareciam como "não decifrada").
- **Causa raiz:** o WhatsApp não entrega visualização única a aparelho conectado; o Baileys 6.7.24 gera um stub sem conteúdo com `key.isViewOnce`; `extractChatEvent` (serviço) devolvia null para o stub do contato. Hipótese do caso real (não comprovável retroativamente).
- **Correção:** marcador `view_once` nos dois sentidos, sem baixar mídia (WA-35).
- **Arquivos/commit:** `whatsapp-individual-service/src/message-extract.js`, `lib/whatsapp-individual-inbound.js` — commit deste registro
- **Prevenção/teste:** `tests/whatsapp-view-once.test.mjs`.

### 2026-10-23 — WhatsApp "conectado, mas sem receber": Gabriel parou às 12:07 e ketlin não recebe nada desde 20/10
- **Data:** 2026-10-23
- **Sintoma:** número aparece conectado, o CRM envia, mas nenhuma mensagem chega ao Chat (nem a do próprio celular), os envios ficam sem "entregue"; o alarme demorou 6 h; reconectar pelo QR não resolveu para a ketlin.
- **Área:** WhatsApp individual (microsserviço Railway)
- **Impacto:** Gabriel Nº1 (~150 recebidas/h) de 12:07 a 18:46 de 22/10 (e 21/10 das ~12h às 17:22); ketlin Nº1 desde 20/10 12:37; Bruna em 13/10.
- **Causa raiz:** no Baileys 6.7.24 toda mensagem/recibo/notificação passa, uma por vez, pelo `processingMutex` do socket e os eventos só saem quando a tarefa termina. Uma tarefa que não termina trava tudo: telemetria mostra, a partir do momento, zero `messages.upsert`/`messages.update` (resumos `dec0`) com recibos brutos ainda chegando e o envio funcionando; 50 min depois o WhatsApp derruba com `stream:error ack` da mensagem nunca confirmada e a reentrega na reconexão (6 sockets seguidos travados no mesmo processo; só um pareamento novo destravou o Gabriel em 21/10). Espera sem prazo achada no código: downloads do Baileys (histórico e "app state") por axios sem timeout, dentro da fila. Também: mensagem que não decifra nunca é confirmada no 6.7.24 (o hash do `stream:error ack` bate com `diag_decrypt_fail` de 09:37/10:27/11:17 — é a causa das quedas de ~50 min de todos os números, §1-G). Alarme lento: piso fixo de 6 h úteis.
- **Correção:** prazo nos downloads e nas chamadas ao CRM; NACK das não decifradas; vigia da fila (5 min) que registra o nó, confirma e reinicia a sessão sem QR; alarme proporcional (≥ 550/semana → 30 min úteis) e reinício pedido pelo CRM antes de desconectar. Detalhe: `docs/WHATSAPP.md` §1-J, `CHANGELOG_AI.md` (2026-10-23).
- **Arquivos/commit:** `whatsapp-individual-service/src/{pipeline-guard,sessions,server,db,message-diagnostics}.js`, `lib/whatsapp-false-connection{,-core.mjs}.js` — commit desta data.
- **Prevenção/teste:** `tests/whatsapp-pipeline-guard.test.mjs`, `tests/whatsapp-false-connection.test.mjs` (volume alto). Depois do deploy no Railway: `whatsapp_session_telemetry` com `reason in ('pipeline_stuck','diag_decrypt_nack','placeholder_req','placeholder_recovered')`; quedas `stream:error.ack` devem cair.
- **Status:** Monitorando (depende do deploy no Railway; causa exata da tarefa presa a confirmar pelo `detail` do `pipeline_stuck`).

### 2026-10-22 — Henry minimizado "escuta, mas não responde"
- **Data:** 2026-10-22
- **Sintoma:** com o Henry minimizado e o microfone ligado, o anel reagia à voz mas a pergunta não era respondida.
- **Área:** Frontend / Henry
- **Impacto:** só o dono; perguntas por voz perdidas com o ícone minimizado.
- **Causa raiz:** minimizado exige o nome, e o Chrome corta a 1ª palavra ("Henry") da frase FINAL (sobretudo logo depois de reiniciar o reconhecimento) — o parcial tinha o nome, a final não. Somado: o reconhecimento era recriado quando a identidade de um handler mudava (deps do efeito), o que aborta a sessão e perde palavras; e a janela de conversa (20 s) só abria por chamada falada.
- **Correção:** o parcial "arma" o trecho (`named` em `trackInterim`/`takeFinalResult`/`forceInterimFinal`; `classifyArmedUtterance`); handlers por ref e deps estáveis (`active, supported, muted, recordMode, listenMode`); janela de conversa de ~40 s depois de qualquer pergunta/resposta; minimizado mostra "Ouvi: … (diga 'Henry' antes)" no balão e na dica.
- **Arquivos/commit:** `lib/henry-voice-conversation.mjs`, `components/henry/HenryVoiceAssistant.jsx`, `components/henry/HenryVoiceView.jsx` — commit "Henry minimizado: o nome no parcial vale…"
- **Prevenção/teste:** `tests/henry-voice-conversation.test.mjs` (armar pelo parcial, janela de 40 s, deps estáveis).
- **Status:** Monitorando

### 2026-10-22 — Henry no iPhone: "Áudio inválido ou longo demais." e toque no Henry abre "Copiar / Pesquisar / Traduzir"
- **Data:** 2026-10-22
- **Sintoma:** no app do iPhone, tocar para falar devolvia "Áudio inválido ou longo demais."; tocar no anel selecionava a animação (realce azul com alças) e abria o menu do sistema.
- **Área:** Frontend / Henry
- **Impacto:** só o dono; voz no celular inutilizável.
- **Causa raiz:** (1) a validação só aceitava `data:audio/<tipo>;base64,` sem espaço/aspas e no máximo 800 mil caracteres; o Safari rotula a gravação como `audio/mp4; codecs="mp4a.40.2"` (ou sem tipo / `video/mp4`) e ignora o `audioBitsPerSecond`, podendo passar de 800 mil caracteres em 20 s; a mesma frase servia para os dois casos. (2) Faltavam `user-select`/`-webkit-touch-callout` no ícone, na cena e na animação.
- **Correção:** `checkHenryAudio` (`lib/henry-voice-providers.mjs`) aceita tipo com parâmetros, sem tipo e `video/mp4` (como `audio/mp4`), teto de 2 milhões de caracteres (corpo da rota 2,2 milhões) e devolve o motivo certo ("longa demais" só quando é longa); o navegador manda só o tipo base. Ícone/cena/canvas sem seleção nem menu do toque longo (`HENRY_NO_SELECT`, `preventTouchSelection` no pointerdown); campo de digitação continua selecionável. Texto "anel" → "Henry".
- **Arquivos/commit:** `lib/henry-voice-providers.mjs`, `app/api/admin/henry/route.js`, `components/henry/HenryVoiceView.jsx`, `components/henry/HenryOrb.jsx`, `components/henry/HenryVoiceAssistant.jsx`, `components/henry/HenrySettingsCard.jsx` — commit "Henry no iPhone: gravação aceita…"
- **Prevenção/teste:** `tests/henry-voice-providers.test.mjs` (Blob audio/mp4 de 300–640 KB, tipo com aspas, sem tipo, motivo da recusa, estilos anti-seleção, texto sem "anel").
- **Status:** Monitorando (confirmar no iPhone do dono)

### 2026-10-22 — Henry no celular "só responde se eu escrever" / "trava quando paro de falar"
- **Data:** 2026-10-22
- **Sintoma:** no app instalado no iPhone o Henry não respondia à voz (só ao texto); em outros momentos mostrava "ouvindo" e travava quando o dono parava de falar.
- **Área:** Frontend / Henry
- **Impacto:** só o dono; voz no celular inutilizável.
- **Causa raiz:** o `webkitSpeechRecognition` não existe ou falha no modo standalone do iPhone; quando existe, às vezes entrega só resultados parciais e o `isFinal` nunca chega — a frase nunca era tratada.
- **Correção:** gravação + ElevenLabs Speech to Text no celular (`henryCaptureMode`); parcial parado por 1,2 s vira final (`forceInterimFinal`).
- **Arquivos/commit:** `components/henry/HenryVoiceAssistant.jsx`, `lib/henry-voice-conversation.mjs`, `lib/henry-voice-providers.mjs`, `app/api/admin/henry/route.js` — commit (ver `git log` 2026-10-22 "Henry: tocar para falar")
- **Prevenção/teste:** `tests/henry-voice-conversation.test.mjs`, `tests/henry-voice-providers.test.mjs`. Risco residual: chave da ElevenLabs sem "Fala para Texto" → aviso na tela.
- **Status:** Monitorando

### 2026-10-22 — Henry ignorou pergunta com a tela cheia aberta ("Ouvi: … — diga 'Henry'")
- **Data:** 2026-10-22
- **Sintoma:** "Henry, quantos por cento falta para bater a meta de hoje" — status "Ouvi: 'Quantos por cento…' — diga 'Henry'" e nenhuma resposta.
- **Área:** Frontend / Henry
- **Impacto:** só o dono; perguntas perdidas no computador.
- **Causa raiz:** o Chrome corta a primeira palavra depois de uma pausa; a palavra de chamada só valia no começo da frase e a tela cheia não contava como chamada.
- **Correção:** tela cheia aberta = já chamando (`classifyOpenSceneUtterance`); nome forte em qualquer posição (`detectWakeWord`, `anywhere`); status diz quando a frase foi ignorada.
- **Arquivos/commit:** `lib/henry-voice-core.mjs`, `lib/henry-voice-conversation.mjs`, `components/henry/HenryVoiceAssistant.jsx`
- **Prevenção/teste:** `tests/henry-voice.test.mjs`, `tests/henry-voice-conversation.test.mjs`.
- **Status:** Resolvido

### 2026-10-22 — Henry "não tenho acesso à câmera" com a visão ligada
- **Data:** 2026-10-22
- **Sintoma:** "eu estou com ou sem boné?" → "essa eu não sei responder"; "vc tem acesso à câmera?" → "não tenho".
- **Área:** Henry / Visão (HENRY-2)
- **Impacto:** só o dono.
- **Causa raiz:** `isVisualQuestion` não reconhecia perguntas sobre o próprio dono (sem captura de imagem) e o prompt não dizia ao modelo que a visão estava ligada.
- **Correção:** `isVisualQuestion` ampliada; `buildHenryVisionNote` manda o estado da visão a cada pedido.
- **Arquivos/commit:** `lib/henry-voice-core.mjs`, `lib/henry-voice.js`, `app/api/admin/henry/route.js`
- **Prevenção/teste:** `tests/henry-voice.test.mjs`.
- **Status:** Resolvido

### 2026-10-22 — Simulação automática do site não preencheu; precisou clicar em "Refazer simulação automática"
- **Data:** 2026-10-22
- **Sintoma:** cliente preencheu o formulário do site e a ficha ficou sem valores; só apareceram depois de "Refazer simulação automática".
- **Área:** Clientes / SIM-AUTO
- **Impacto:** 1 cliente desde o início da SIM-AUTO (19/10), já resolvido pelo Refazer. Não foi publicação do dia (nenhum commit do período toca o caminho).
- **Causa raiz:** corrida. O cliente entrou pelo "Atendimento Rápido" (só nome e WhatsApp); o dono abriu "Simulação"/"Valores" na lista, o que cria um rascunho vazio em `simulations` com o e-mail dele (`ensureSimulationId`, `components/clients/useClientList.js`). 0,3 s depois chegou o formulário completo; `saveSiteSimulationFromRegistration` só substituía linha automática ou a vazia "Cadastro do site" — o rascunho vazio de pessoa contou como "simulação do corretor" e a automática foi pulada **sem log**. O "Refazer" já tratava rascunho vazio como substituível (por isso funcionou).
- **Correção:** régua única `automaticSimulationCanReplace` (`lib/simulation-status-lock-core.mjs`) = não é simulação real (`hasRealSimulationValues`), usada pelo site e pelo "Refazer"; pulo agora registra `Site automatic simulation skipped: manual_simulation <id>` no log.
- **Arquivos/commit:** `lib/simulations.js`, `lib/simulation-status-lock-core.mjs`, `app/api/simulation-registrations/route.js` — commit (ver `git log` 2026-10-22 "SIM-AUTO: rascunho vazio")
- **Prevenção/teste:** `tests/simulation-auto-status.test.mjs` (rascunho vazio de pessoa é substituído; simulação com valor nunca). Risco residual: se a tela do Gerador desse rascunho continuar aberta e for editada, o autosave dela pode gravar por cima da automática (mesmo risco que o "Refazer" já tinha).
- **Status:** Resolvido

### 2026-10-22 — Extensão do Marketplace "fica a todo momento abrindo novas guias"
- **Data:** 2026-10-22
- **Sintoma:** "ela fica a todo momento abrindo novas guias; às vezes estou numa página e ela abre outra".
- **Área:** extensão do Chrome (Marketplace)
- **Causa raiz:** a extensão criava abas na janela em que o dono estava: o "Manter acordado" (1.9.0) abria e fechava uma aba a cada 1 min; cada rodada do chat (a cada 2 min) criava e fechava sua aba; a publicação abria uma aba ATIVA; e, para abrir uma conversa, a aba do Facebook virava a ativa por alguns segundos (o Facebook não abre conversa em aba oculta).
- **Correção:** extensão 1.9.4 — janela de trabalho própria, pequena, criada sem foco, com uma aba reutilizada; tudo acontece dentro dela; foco só pelo botão do popup. Para trabalhar atrás de outras janelas: atalho do Chrome com `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows` (README). Minimizada não trabalha.
- **Arquivos/commit:** `ferramentas/marketplace-publicador/{background,popup}.js`, `lib/work-window.js` — ver `git log` (2026-10-22, "1.9.4").
- **Prevenção/teste:** `ferramentas/marketplace-publicador/tests/work-window.test.js` (todo `tabs.create` com `windowId` da janela de trabalho; um único `focused: true`).
- **Status:** Corrigido no código; falta o dono instalar a 1.9.4 e criar o atalho.

### 2026-10-22 — Extensão do Marketplace: "A conversa não abriu em 25 s depois do clique", "passou de 210 s e foi abandonada"
- **Data:** 2026-10-22
- **Sintoma:** o dono recebeu avisos de erro da extensão; `marketplace_diagnostics` (kind `thread`, `open_conversation`) com uma falha a cada ~30 min desde 20/10: "A conversa não abriu em 20–26 s depois do clique (confiável) na linha nome" (`nao_abriu`/`sem_painel`), "Etapa 'página do Facebook (mp-inbox-read)' passou de 210 s e foi abandonada" e, até 21/10 à tarde, "Etapa 'mp-inbox-open-read' passou de 240 s". Respostas do Chat Marketplace "não enviadas" (aviso Importante, 1 por mensagem) com "A conversa não abriu…" e "Conversa não encontrada na caixa do Marketplace".
- **Área:** Chat Marketplace / extensão do Chrome
- **Impacto:** leitura e envio intermitentes (funcionam em parte do dia); conversa que falhava era tentada a cada 2 min.
- **Causa raiz:** (1) o PC rodava a **1.9.0**: o zip `ferramentas/marketplace-publicador.zip` não foi regerado na 1.9.1 nem na 1.9.2, então essas correções nunca chegaram ao PC (todos os diagnósticos de 22/10 dizem `version: 1.9.0`). (2) O Facebook **não mudou o layout**: quando a conversa abre, os retratos têm `role=log`, `role=article`, `data-message-id` e o campo de texto, como os seletores esperam. As falhas são intermitentes e batem com a página oculta para o Chrome (tela desligada/bloqueada — "Manter acordado" segura só o sistema, não a tela —, janela minimizada ou coberta): o clique não abre a conversa e os timers da página ficam segurados (até 1 min por espera), então a leitura passava do prazo de 210 s e era abandonada sem nada. Ainda falta prova direta: os diagnósticos antigos não registravam a visibilidade. (3) O erro de 240 s (`mp-inbox-open-read`) era do fluxo antigo, trocado na 1.8.10. (4) A conversa abre como janela flutuante na própria `/marketplace/inbox/`, sem link `/messages/t/<id>`: o "endereço direto" da 1.9.2 não tem de onde ler e `thread_url` segue vazio em todas as conversas.
- **Correção:** extensão 1.9.3: não clica com a página oculta (deixa para a próxima rodada, sem contar falha); as esperas da página usam o relógio do service worker; a leitura para 30 s antes do prazo e devolve o que leu; conversa que falhou espera 4 → 8 → 15 → 30 min; diagnóstico 1 a cada 30 min por tipo de falha, com visibilidade e foco da página; erro de envio com a página oculta diz o motivo. CRM grava e mostra a versão da extensão ("Extensão 1.9.3: última leitura…"). Zip regerado.
- **Arquivos/commit:** `ferramentas/marketplace-publicador/{background,inbox}.js`, `lib/{chat-agenda,crm-api}.js` da extensão, `ferramentas/marketplace-publicador.zip`, `app/api/marketplace/chat/sync/route.js`, `lib/marketplace-chat.js`, `components/marketplace/MarketplaceChat.jsx`. Ver `git log` (2026-10-22, "extensão 1.9.3").
- **Prevenção/teste:** `ferramentas/marketplace-publicador/tests/{chat,crm-api}.test.js`, `tests/marketplace-extension-signal.test.mjs`. **Toda versão nova da extensão precisa regerar o zip** (ver CHANGELOG 1.9.3). Conferir a versão no Chat Marketplace.
- **Status:** Corrigido no código; falta o dono instalar a 1.9.3. Confirmar a causa da página oculta pelo campo `view.visibility` dos próximos diagnósticos (`aba_oculta`/`nao_abriu`).

### 2026-10-22 — Fila de espera da roleta parada: clientes elegíveis não eram entregues
- **Data:** 2026-10-22
- **Sintoma:** clientes "na roleta" (fila de espera, guardados com o dono) não saíam para nenhum corretor; última entrega da fila comum em 17/10 11:52.
- **Área:** Roleta (ROL-2b)
- **Impacto:** 7 clientes elegíveis (inclusive em atendimento/documentação) parados de 17/10 a 22/10; a fila de reativação (FUN-15l) não foi afetada.
- **Causa raiz:** `reassignPendingRouletteLeads` pegava só os 25 mais antigos (filtrando status no SQL) e SÓ DEPOIS descartava os em bloqueio de 30 dias da Prospecção (`available_after`). Os 30 primeiros da fila estavam bloqueados até 06–18/11: ocupavam o lote inteiro em toda rodada e ninguém atrás deles era alcançado.
- **Correção:** decisão do dono ("bloqueados de 30 dias não seguram a fila"): o entregador lê a fila inteira e `planWaitingQueue` monta o lote de 25 sem os bloqueados; eles continuam com o dono e voltam à fila sozinhos quando o bloqueio vence. Lista de Clientes usa a mesma função (posição "Roleta · Nº na fila").
- **Arquivos/commit:** `lib/pending-roulette-core.mjs`, `lib/lead-distribution.js` — ver `git log` (2026-10-22, "bloqueados de 30 dias")
- **Prevenção/teste:** `tests/roulette-queue-position.test.mjs` (30 bloqueados na frente + 7 elegíveis atrás → os 7 entregues). Risco residual: link pessoal/canal direto ainda ocupam o lote (hoje 0 na fila).
- **Status:** Resolvido (conferir saída dos 7 nas rodadas seguintes)

### 2026-10-22 — Cliente do Marketplace transferido mesmo com o corretor tendo respondido
- **Data:** 2026-10-22
- **Sintoma:** conversa do Marketplace recebida pela roleta foi redistribuída para outra corretora, embora o corretor tivesse respondido pelo Chat do Marketplace dentro do prazo.
- **Área:** Roleta / Marketplace (MKT-2e)
- **Impacto:** corretor perde o cliente que já atendeu sempre que o envio pela extensão falha; caso real: corretor respondeu às 08:38, envio falhou, a redistribuição rodou às 11:08 e a mensagem só saiu às 11:12 após reprocessar.
- **Causa raiz:** o prazo só era segurado por `last_human_reply_at` (resposta já enviada) ou por mensagem na fila (`queued`/`sending`); `pendingRepliesByConversation` ignorava status `failed`, então a resposta escrita com envio falho não contava.
- **Correção:** qualquer resposta humana escrita pelo CRM depois da entrega (outbound com `sender_user_id`, qualquer status) segura o cliente (`humanRepliesByConversation` + `shouldRedistribute({ humanReplySince })`); mensagem interna continua não contando. Decisão do dono 2026-10-22. Nenhum dado alterado (devolver o cliente ao corretor é decisão do dono).
- **Arquivos/commit:** `lib/marketplace-chat.js`, `lib/marketplace-chat-core.mjs` — ver `git log` (2026-10-22, "fidelizado")
- **Prevenção/teste:** `tests/marketplace-chat-core.test.mjs` (envio falho segura; interna não segura; resposta anterior à entrega não segura).
- **Status:** Resolvido
### 2026-10-22 — Resposta do corretor no Chat Marketplace "Falhou — A conversa não abriu em 20 s depois do clique"
- **Data:** 2026-10-22
- **Sintoma:** resposta do Gabriel Ribeiro ficou "Falhou — A conversa não abriu em 20 s depois do clique (aba em /marketplace/inbox/)"; outras com "Não confirmei a mensagem na conversa" e "No tab with id". Corretores não têm acesso ao Facebook.
- **Área:** Chat Marketplace / extensão
- **Impacto:** 5 respostas não enviadas (de 50); corretor sem saída a não ser o dono.
- **Causa raiz:** envio abria a conversa clicando na lista (20 s, aba oculta), a confirmação dependia da direção das 3 últimas mensagens (às vezes errada) e a aba da rodada podia sumir; o servidor só tentava 2 vezes e mostrava o erro técnico.
- **Correção:** endereço direto da conversa, espera de 45 s com a aba visível, aba recriada, confirmação pelo texto "por Você", 3 tentativas com intervalo, confirmação pelo eco, "Tentar de novo" do corretor, alerta ao admin; reprocessamento manual das falhas.
- **Arquivos/commit:** `ferramentas/marketplace-publicador/{background,inbox}.js`, `lib/marketplace-chat{,-core}.{js,mjs}`, rotas de retry e reprocessamento
- **Prevenção/teste:** `tests/marketplace-chat-core.test.mjs`, `ferramentas/marketplace-publicador/tests/estrutura-real.test.js`
- **Status:** Resolvido no código; falhas atuais dependem do acionamento do reprocessamento
### 2026-10-22 — "Debora iniciou esta conversa." e sugestão de resposta rápida aparecem como mensagem da cliente
- **Data:** 2026-10-22
- **Sintoma:** no Chat Marketplace a conversa da Debora mostrava como da cliente o aviso "Debora iniciou esta conversa." e "Sim, você tem interesse?" (22/10 06:33), que ninguém enviou — era uma sugestão do painel "Envie uma resposta rápida". Também: o dono abriu a conversa e o contador de não lidas sumiu.
- **Área:** Chat Marketplace / extensão
- **Impacto:** conversas importadas com aviso/painel; contador zerado por quem só olhava.
- **Causa raiz:** o leitor aceitava `role=article` sem `data-message-id` e, sem linhas no log, caía na leitura por geometria, que pega qualquer texto (painel, chips); `getMarketplaceConversation` zerava `unread_count` para qualquer pessoa que abrisse.
- **Correção:** só balão com `data-message-id`; painel e avisos ignorados (extensão 1.9.1 e servidor); renormalização apaga o que não tem id do Facebook numa conversa que tem; abrir marca lida só para o corretor atribuído/associado (`marksReadOnOpen`).
- **Arquivos/commit:** `ferramentas/marketplace-publicador/{selectors,inbox}.js`, `lib/marketplace-chat-core.mjs`, `lib/marketplace-chat.js`, `lib/whatsapp-chat-scope.mjs`
- **Prevenção/teste:** `tests/marketplace-chat-core.test.mjs`, `ferramentas/marketplace-publicador/tests/estrutura-real.test.js` (strings do caso)
- **Status:** Resolvido no código; dados antigos dependem do acionamento da rota com `apply=1`
### 2026-10-22 — Cliente do Marketplace não troca de corretor quando fica sem resposta
- **Data:** 2026-10-22
- **Sintoma:** a redistribuição automática do Chat Marketplace (troca de corretor depois do prazo sem resposta) estava parada sem ninguém saber; a conversa ficava com quem recebeu.
- **Área:** Chat Marketplace / Roleta
- **Impacto:** toda conversa do Marketplace entregue pela roleta desde 20/10 (nenhuma redistribuída).
- **Causa raiz:** (1) a busca das conversas vencidas filtrava `client_id is null` (`processMarketplaceDistribution`, desde c803db8), mas desde 36e145c toda conversa distribuída vira cliente na hora — a condição nunca era verdadeira; (2) a checagem só rodava dentro da sincronização da extensão (sem cron), então com a extensão fechada nada rodava; (3) erros de gravação da conversa eram ignorados (`update` sem checar `error`). Nenhum log/alerta acusava. Confirmação por consulta em produção não feita nesta sessão (sem acesso ao banco daqui) — diagnóstico pelo código.
- **Correção:** MKT-2e: filtro por origem da atribuição (`assignment_source = roulette`), prazo da regra "REDISTRIBUIÇÃO DE LEADS", job no cron `scheduled-activities`, sinal do job + alerta Importante aos admins quando fica > 10 min sem sucesso, gravações que lançam erro.
- **Arquivos/commit:** `lib/marketplace-chat.js`, `lib/marketplace-chat-core.mjs`, `lib/crm-automations.js`, `app/api/cron/scheduled-activities/route.js`, `app/api/cron/whatsapp-flows/route.js`, `supabase/migrations/20261022150000_marketplace_assignment_source.sql`
- **Prevenção/teste:** `tests/marketplace-chat-core.test.mjs` (prazo vencido, sem elegível → fila, 1ª carga fora, trava contra o filtro `client_id`); monitoramento `checkMarketplaceRedistributionStalled`.
- **Status:** Resolvido no código; depende de aplicar a migration 20261022150000 (até lá o job acusa erro e o alerta aparece).
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

## 2026-10-23 — Henry "ouve e não responde" / "pergunta, eu respondo e ele cala" (app de desktop)

- **Sintoma:** anel em "ouvindo", o dono para de falar e nada acontece; resposta ao "Ô, patrão?" ignorada (chama de novo). `ai_usage_log`: 73 `henry_voice_stt` × 34 `henry_voice_assistant` em 6 h.
- **Causa raiz:** (1) a gravação abria logo depois da fala dele e o fim da voz dele no alto-falante contava como "o dono falando" → fechava em 1,2 s com transcrição vazia → microfone fechado durante a transcrição e continuação de só 3,5 s → a resposta real caía no vão; (2) com música tocando, VAD/medidor nunca viam silêncio → gravação até o limite de 25 s → a guarda da música descartava a transcrição como "letra".
- **Correção:** `triggeredTranscriptIntent` (texto não vazio de gravação do Henry sempre vira pedido; só eco evidente sai), 350 ms de ruído de fundo + voz confirmada em 2 leituras, VAD ignorado com música, continuação de vazio com 7 s; motivos no console (`window.__henryDebug`).

## 2026-10-23 — Henry pede música e responde só "tá tocando" (outra música; parte do pedido some)

- **Sintoma:** "coloca o quinto vigia e depois me fala do Gabriel" → "Pronto, tá tocando! Vida Loka, Pt. 1" e nada do Gabriel.
- **Causa raiz:** busca do Spotify com `limit=1` só em faixa (pega o 1º resultado sem conferir) e a fala fixa da música substituía a resposta inteira do modelo, mesmo em pedido composto.
- **Correção:** `pickSpotifySearchResult` (4 tipos, 10 de cada, escolha por correspondência; nada parecido = "É essa?"), `confirmPlaying` (confere o que tocou, 1 nova tentativa), fala fixa só em pedido só de música.



## 2026-10-26 — Extensão do Marketplace sem sincronizar: "Failed to fetch" / "CRM indisponível"
**Sintoma:** popup da extensão com "Chat — erro: Failed to fetch" e "CRM indisponível"; CRM com "última leitura há 47 h"; o endereço da API abria normal no mesmo Chrome. **Causa raiz:** o Chrome aplicou CORS aos pedidos da extensão (permissão de site não aplicada naquele PC) e o servidor não respondia o preflight com Access-Control-Allow-Origin. **Correção:** CORS só para `chrome-extension://` em `/api/marketplace/*` (`proxy.js` + `lib/extension-cors-core.mjs`). **Como diagnosticar de novo:** `chrome://extensions` › Erros da extensão / console do service worker.
