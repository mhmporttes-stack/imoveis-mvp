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

1. Acrescente a entrada logo **abaixo do título “## Registro”** (mais recente primeiro) — **nunca no topo do arquivo**, acima destas instruções.
2. Uma entrada por mudança lógica (não uma por arquivo). Escreva em **português do Brasil**, objetivo e sem jargão desnecessário.
3. **Nunca** inclua tokens, segredos, valores de variáveis de ambiente, dados pessoais de clientes ou telefones/e-mails reais.
4. Se a alteração afetou regras/arquitetura, **atualize também** o documento correspondente em `docs/` (e diga qual na entrada).
5. Se algo não pôde ser provado no código, escreva **A CONFIRMAR** — não invente.
6. Não apague entradas antigas. Para corrigir uma, acrescente uma nova referenciando a anterior.
7. **Arquivamento mensal (quando necessário):** se este arquivo passar de ~500 linhas, mova as entradas de meses já encerrados, sem alterar o texto, para `docs/changelog/AAAA-MM.md` (um arquivo por mês, mais recente primeiro) e deixe ao fim da seção “Registro” a linha `Meses anteriores: docs/changelog/`. Agentes leem só as entradas recentes daqui; o arquivo mensal é consultado sob demanda.

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

### 2026-10-01 — Card de cliente mais compacto
- **Data:** 2026-10-01
- **Área:** Clientes / Frontend
- **Alteração:** `ClientCard` com espaçamentos e alturas reduzidos. As mudanças:
  - padding de 14–16px;
  - avatar de 36px;
  - corpo com `space-y-2`;
  - próxima atividade em uma linha (data e nota truncada);
  - poder de compra em 16px;
  - "Adicionar tag" na linha de contato quando o cliente não tem tags.

  WhatsApp e Agendar passam a ter o mesmo tamanho (40px), com o WhatsApp ainda primário; o "⋯" também ficou com 40px (`Menu size="sm"`). "Último contato nunca" virou "Sem contato". Topo, busca, filtros, ficha e barra inferior não mudaram.
- **Motivo:** avaliação do dono em produção, com ~2.159 clientes; meta de 1,5 a 2 cards por tela sem perder informação.
- **Medição (vitrine, mesmos dados):** a altura média do card no celular caiu de 428 para 359px (corretor) e de 393 para 326px (admin), cerca de 16–17%. No celular, ficam ~1,9–2,1 cards visíveis na área da lista.
- **Arquivos afetados:** `components/clients/ClientCard.jsx`, `components/ui/Menu.jsx` (prop `size`), `.claude/skills/design-crm/references/{sistema-visual,padroes-crm}.md`.
- **Risco/observação:**
  - Nenhuma informação ou ação removida.
  - Botões do rodapé com 40px, dentro do mínimo de toque do sistema (44px recomendado e 40px como mínimo absoluto).
  - Validação: build, `node --test` (só as 3 falhas conhecidas) e revisão visual em 360, 390 e 1440px.
- **Autor:** Claude Code (designer-crm)

### 2026-10-01 — Lista de clientes em cards híbridos (etapa e responsável no card)
- **Data:** 2026-10-01
- **Área:** Clientes / Frontend
- **Alteração:**
  - A listagem de `/admin/simulacoes` passa a ser de cards (`components/clients/ClientCard.jsx`), padrão único no celular e no desktop. Topo, busca, filtros, funil, ficha, Fundação, Manrope e barra inferior inalterados.
  - **No card:** nome, telefone, código, etapa, responsável (admin/gestor), urgência, novo formulário, até 2 próximas atividades com concluir/cancelar, poder de compra ou situação da simulação, último contato, cadastro, preferência de contato e tags (até 4). Ações: WhatsApp, Agendar (abre a ficha no formulário), menu ⋯ (Documentação, Empreendimentos, Valores, Ficha completa, Excluir só para o dono) e ações de prospecção quando se aplicam.
  - **Etapa no card:** seletor nativo com aparência de selo; a mudança só é gravada após confirmação ("Mudar a etapa? de X para Y"). Cancelar mantém a etapa atual.
  - **Responsável no card:** só aparece para quem já podia trocar (`canManageResponsibleUsers` = admin geral ou gestor, com a lista de corretores já limitada pela página). Pede confirmação antes de gravar. O guard do servidor é o mesmo.
  - A ficha abre direto em agenda, tags ou documentos a partir do card. Lista de etapas centralizada em `components/clients/StatusOptions.jsx` (card e ficha).
  - Removidos: `components/clients/ClientRow.jsx` (lista em linhas), a cópia da tela antiga e as telas de comparação da vitrine.
- **Motivo:** decisão do dono após comparar antigo × atual × híbrido na vitrine.
- **Auditoria card antigo × híbrido:** presentes no card ou a um toque — responsável (seletor), nome/código, etapa (seletor), urgência, tags (+ editor), data do cadastro, novo formulário, último contato, agendamento principal e atividades (concluir/cancelar; editar/remover e "+N" na ficha), preferência de contato, poder de compra/situação da simulação, prospecção (Prospectar, Em atendimento, Não contactar com motivo, Devolver à fila), WhatsApp, Agendar, Cadastro (ficha), Empreendimentos, Valores, Documentação, Excluir (dono). Na ficha, por decisão anterior do dono: CCA, "Avisar progresso" e histórico.
- **Arquivos afetados:** `components/clients/{ClientCard,ClientWorkspace,ClientSheet,StatusOptions,client-format}.jsx|js`, `components/clients/ClientRow.jsx` (removido), `components/ui/Menu.jsx` (novo), vitrine, `.claude/rules/frontend-pwa.md`, `docs/SYSTEM_ARCHITECTURE.md`, `sistema-visual.md`.
- **Risco/observação:**
  - Confirmação nova antes de mudar etapa e responsável no card. No card antigo a troca era imediata.
  - Validação: `pnpm build` ok; `node --test` com as mesmas 3 falhas conhecidas (`journey-http` ×2, `whatsapp-flow-core`); revisão visual na vitrine em 360/390/768/1280/1440 (admin, gestor, corretor); testados mudar etapa (cancelar e confirmar), trocar responsável e as listas por perfil (corretor sem seletor; gestor só com a equipe), sem erros de console. Não testado com login real em produção.
- **Autor:** Claude Code (designer-crm)

### 2026-10-01 — Configurações → Alexa (painel + serviço central de fala)
- **Data:** 2026-10-01
- **Área:** Integração (Alexa/Voice Monkey) / Banco / Permissões
- **Alteração:**
  - Nova tabela `alexa_settings` (linha única): Alexa ativa, dias da semana, horário inicial/final (Brasília), intervalo mínimo entre falas, `events` (jsonb) com liga/desliga + frase por evento e extras (antecedência da reunião; mínimo de clientes e tempo aguardando da fila) e `last_spoken_at`. Nunca guarda token nem ID do dispositivo.
  - `lib/alexa-service.js` é o ponto ÚNICO de decisão: `announceAlexaEvent(evento, valores)` valida Alexa ativa, evento ativo, dia/horário e intervalo mínimo (reserva atômica em `last_spoken_at`), monta a frase (variáveis `{cliente}`, `{corretor}`, `{quantidade}`, `{minutos}`; só primeiro nome) e chama `speakAlexa` (`lib/alexa-voice.js`). Nunca lança erro; logs só com evento e motivo. Regras puras e testadas em `lib/alexa-config-core.mjs` (inclui bloqueio de CPF, renda, valores e afins na frase e no texto final).
  - Página `/admin/alexa` (menu CONFIGURAÇÕES, só administrador geral) e rotas `GET/PUT /api/admin/alexa` e `POST /api/admin/alexa/test` ("Testar Alexa"), todas com `requireGeneralAdminApi`. A API devolve só booleanos sobre as envs (token/dispositivo/servidor liberado).
  - "Novo cliente" (formulário completo e Atendimento Rápido) agora passa por `announceAlexaEvent("new_client", …)`. Os outros 5 eventos (cliente aprovado, venda, meta diária, reunião próxima, fila) estão só configuráveis e NÃO conectados a fluxos reais.
  - Novo componente `components/ui/Switch.jsx`.
- **Motivo:** pedido do dono: gerenciar as regras da Alexa pelo painel, sem alterar código.
- **Arquivos afetados:** `supabase/migrations/20261001150000_alexa_settings.sql`, `lib/alexa-config-core.mjs`, `lib/alexa-service.js`, `app/api/admin/alexa/route.js`, `app/api/admin/alexa/test/route.js`, `app/admin/alexa/page.jsx`, `components/alexa/AlexaSettings.jsx`, `components/ui/Switch.jsx`, `components/AdminMenu.jsx`, `app/api/simulation-registrations/route.js`, `app/api/simulation-registrations/quick-attendance/route.js`, `tests/alexa-config.test.mjs`.
- **Risco/observação:** se a tabela não existir ou o banco falhar, o serviço cai no padrão (só "Novo cliente" fala, 24h, sem intervalo), preservando o comportamento anterior. A variável `ALEXA_VOICE_ENABLED` da Vercel continua como chave geral de segurança, além do painel. Falas são em série no Echo (sem fila): vários eventos simultâneos podem se sobrepor.
- **Autor:** Claude (agente)

### 2026-10-01 — Nova Lista de clientes (substitui AdminSimulationList)
- **Data:** 2026-10-01
- **Área:** Clientes / Frontend
- **Alteração:**
  - `/admin/simulacoes` passa a usar `components/clients/`: `ClientWorkspace` (cabeçalho com atalhos, "Para agir agora", funil clicável, busca/filtros, lista, paginação), `ClientRow` (colunas no desktop, cartão no celular), `ClientSheet` (ficha em gaveta: ações, etapa, responsável, CCA, aviso de progresso/histórico, prospecção, agenda, simulação, tags, cadastro com e-mail/PIS, exclusão) e `useClientList` (estado e ações, mesmas APIs).
  - Decisões do dono: etapa, "Avisar progresso" e CCA ficam só na ficha; a lista abre com 20 por página (`page.jsx` pede `pageSize: 20` na carga inicial).
  - `alert/confirm` do navegador viraram aviso (`Toast`) e diálogo (`ConfirmDialog`) da página.
  - `components/AdminSimulationList.jsx` removido; referências em `lib/` (comentários), `docs/` e rules atualizadas.
- **Motivo:** redesenho aprovado pelo dono (Designer CRM).
- **Arquivos afetados:** `app/admin/simulacoes/page.jsx`, `components/clients/*` (novos), `components/AdminSimulationList.jsx` (removido), `components/ui/{Button,Sheet,ConfirmDialog,Toast}.jsx`, `app/globals.css`, `tailwind.config.cjs`, comentários em `lib/{client-status,do-not-contact-reasons,simulations,simulation-list-utils}.js`, `docs/{SYSTEM_ARCHITECTURE,BUSINESS_RULES}.md` (só caminhos de arquivo em CLI-5b/CLI-12; texto das regras intacto), `.claude/rules/{frontend-pwa,crm-clientes-funil}.md` (paths agora `components/clients/**`), vitrine.
- **Auditoria antiga × nova (todas preservadas):** busca com debounce; abas de grupo e status; filtros corretor (só admin/gestor), tag, sem contato +3 dias, sem atividade futura, pendentes, novos atendimentos (inclusive vindos por URL) com etiquetas removíveis; copiar link (corretor), Prospecção, Novo cliente; atalhos Meta Diária/Chat/Agenda com contadores (no desktop o menu do topo não mostra esses subitens; no celular estão na barra inferior); WhatsApp com registro de contato; etapa incl. Venda; responsável (só admin/gestor); CCA; aviso de progresso e histórico; urgência; agendamento principal (criar/editar/remover) e atividades extras (criar/concluir/cancelar, "ver todas"); prospecção (Prospectar, Em atendimento, Não contactar com motivo, Devolver à fila — mesmas condições); tags (marcar, criar com cor, excluir do sistema); Documentação, Empreendimentos, Valores; cadastro completo, e-mail/PIS editáveis, preferências do imóvel, preferência de contato, novo formulário, código do cliente; excluir (só dono); paginação com números e 5/10/20; abrir cliente por `?clientId=`; estados vazio/erro/carregando.
- **Risco/observação:**
  - Corrigido de passagem: tags e agendamento editados agora aparecem na hora na lista (antes só depois de recarregar).
  - Tags na lista aparecem a partir de 1024px; no celular ficam na ficha. CCA e "Avisar progresso" não carregam mais por cliente na lista (só ao abrir a ficha) — menos requisições.
  - Validação: `pnpm build` ok (sem rotas `/dev`); `node --test` 261/265 — as 3 falhas são as conhecidas (`journey-http` ×2 exigem servidor local; `whatsapp-flow-core` "Menu principal"); revisão visual na vitrine em 360/390/768/1280/1440 (admin, gestor, corretor); teste de interação e de permissão por perfil na vitrine sem erros de console. Não foi testado com login real em produção.
- **Autor:** Claude Code (designer-crm)

### 2026-10-01 — Manrope como tipografia oficial do painel
- **Data:** 2026-10-01
- **Área:** Frontend
- **Alteração:** `app/admin/layout.jsx` carrega Manrope (`next/font/google`) e redefine `--font-ui` no `:root` só nas rotas `/admin`. Site público inalterado. Vitrine passa a usar Manrope por padrão.
- **Motivo:** escolha do dono após o comparativo visual Manrope × Inter.
- **Arquivos afetados:** `app/admin/layout.jsx`, `app/dev/vitrine/**`, `.claude/skills/design-crm/references/sistema-visual.md`, `.claude/skills/design-crm/scripts/capturar-vitrine.mjs`.
- **Risco/observação:** só tipografia; larguras de texto mudam levemente (Manrope é um pouco mais larga que a fonte do sistema) — conferido na vitrine. Nenhuma regra, API ou permissão alterada.
- **Autor:** Claude Code (designer-crm)

### 2026-10-01 — Fundação do sistema visual + navegação mobile com barra inferior
- **Data:** 2026-10-01
- **Área:** Frontend / Navegação do painel
- **Alteração:**
  - **Tokens** (aditivos) em `tailwind.config.cjs`: rampa de texto (`ink-2`, `faint`), cores semânticas `success|warning|danger|info|neutral` (`DEFAULT/soft/line/strong`), raios `chip|control|card|panel`, `shadow-float`, `ease-out-ui`, `text-2xs`, `min-h-touch`. Fonte da interface virou a variável `--font-ui` (`globals.css`) com **a mesma pilha de antes** — a família definitiva aguarda a escolha do dono (comparativo Manrope × Inter entregue).
  - **Componentes base** `components/ui/`: Button, Badge/CountBadge, StatusBadge (+ `status-tone.js`), Card, Sheet (`<dialog>` nativo), EmptyState, Skeleton, Field, `cx`.
  - **Navegação mobile:** `components/AdminBottomNav.jsx` em `app/admin/layout.jsx` — barra inferior fixa (< 768px) com 4 destinos por perfil (admin geral: Meta, Clientes, Chat, Desempenho; demais: Meta, Clientes, Chat, Agenda) + "Mais" com Pendências e todos os itens do menu (`getAdminMenuGroups`, exportado de `AdminMenu.jsx`, fonte única). `AdminMenu` passa a aparecer só ≥ 768px. Espaço reservado por `--admin-bottom-nav-space`; aviso de instalação do PWA sobe acima da barra; a barra some com o teclado aberto.
  - Vitrine: tela `fundacao`, seletor de fonte, barra inferior simulada; script de captura com `--fonte`, `--clicar "botao:…"`, `--sufixo`.
- **Motivo:** pedido do dono — Fundação antes do redesenho das telas; nova navegação mobile autorizada.
- **Arquivos afetados:** `tailwind.config.cjs`, `app/globals.css`, `components/ui/*` (novos), `components/AdminBottomNav.jsx` (novo), `components/AdminMenu.jsx`, `app/admin/layout.jsx`, `components/AdminPwaInstallHint.jsx`, `app/dev/vitrine/**`, `.claude/skills/design-crm/**`, `.claude/rules/frontend-pwa.md`, `docs/pwa-admin.md`.
- **Risco/observação:**
  - Nenhuma regra de negócio, API ou permissão alterada; nenhum item de menu removido (todos acessíveis pelo "Mais"); telas existentes não usam ainda os componentes novos.
  - Revisão visual na vitrine em 360/390/768/1440 (perfis admin, gestor, corretor). Conversa aberta no Chat (altura `100dvh-150px`) fica acima da barra por causa do espaço reservado no fim da página; o encaixe definitivo vem no redesenho do Chat.
  - Pré-existente, não corrigido (fica para o redesenho de Clientes): em 360px os botões de ação do card de cliente transbordam ("Agenda" cortado).
- **Autor:** Claude Code (designer-crm)

### 2026-10-01 — Designer CRM: agente, skill de design e vitrine de componentes (somente desenvolvimento)
- **Data:** 2026-10-01
- **Área:** Infra / Frontend / Estrutura do Claude
- **Alteração:**
  - Novo agente `designer-crm` (Product Design/UI-UX): critica antes de executar, propõe além do pedido, implementa só interface; delega dado/API/regra ao `crm-editor`.
  - Nova skill `/design-crm` (modos criticar, redesenhar, limpar) com referências sob demanda: `sistema-visual.md` (memória do design: identidade obrigatória, diagnóstico atual, tokens propostos, tabela de decisões), `padroes-crm.md`, `revisao-visual.md`, e o script `scripts/capturar-vitrine.mjs` (screenshots em 360/390/768/1280/1440).
  - **Vitrine** `app/dev/vitrine`: componentes reais (Clientes, Chat, Meta Diária corretor/dono, Desempenho) com dados 100% fictícios e mock de `fetch` — sem login, sem API, sem banco. Só existe no `next dev`: `next.config.mjs` registra a extensão `dev.jsx` apenas em `PHASE_DEVELOPMENT_SERVER`; `notFound()` em produção como segunda trava. `AppChrome` renderiza `/dev/*` sem cabeçalho/rodapé público (rota inexistente em produção).
  - Ponteiros: `.claude/rules/frontend-pwa.md` (decisão visual → `/design-crm`), `crm-editor`, `CLAUDE.md`, `AGENTS.md`.
- **Motivo:** pedido do dono — Designer especialista com liberdade de redesenho, preservando azul/branco, logo, funcionalidades e regras; revisão visual sem login.
- **Arquivos afetados:** `.claude/agents/designer-crm.md`, `.claude/skills/design-crm/**`, `app/dev/vitrine/**`, `next.config.mjs`, `components/AppChrome.jsx`, `.claude/rules/frontend-pwa.md`, `.claude/agents/crm-editor.md`, `CLAUDE.md`, `AGENTS.md`.
- **Risco/observação:**
  - `pnpm build` ok sem nenhuma rota `/dev` na saída; nenhum comportamento de produção muda.
  - Custo fixo medido em sessão nova: +~90 tokens no início; a skill só carrega quando há tarefa de design (verificado: crítica de design invocou `/design-crm` e leu só `sistema-visual.md`).
  - Encontrado e não corrigido (fora do escopo): `text-slate`/`bg-slate` (216 usos) não geram CSS; possível bug — após marcar/desmarcar tag na Lista de clientes, as pílulas do card só atualizam no próximo carregamento da lista (A CONFIRMAR em produção).
- **Autor:** Claude Code

### 2026-10-01 — Guia de lead por evidência de mídia paga + ID do anúncio no link do Fluxo "formulário direto" (encerra a estruturação do Gestor de Tráfego)
- **Data:** 2026-10-01
- **Área:** WhatsApp (Fluxos) / Guia de Atendimento / Meta/Tráfego
- **Alteração:**
  - **Guia de Atendimento:** `classifyGuideKind` ganhou `paidMediaEvidence`, calculado por `hasPaidMediaEvidence` (`lib/lead-origin.js`). Cliente com evidência confiável de mídia paga (ID do anúncio, `paid_link`, `paid_media` ou UTM paga reconhecida) recebe o guia de **lead**, mesmo vindo pelo link de corretor. Texto livre não conta.
  - **Fluxos:** nova variável `{{anuncio_id}}`, com o ID real do anúncio vindo do `referral` do clique (`adIdFromReferral`). O Fluxo ativo "Anúncio WhatsApp — formulário direto" teve o link alterado de `…utm_campaign=ctwa_formulario` para `…utm_campaign=ctwa_formulario&utm_content={{anuncio_id}}` (rascunho e versão publicada). Sem ID, o link continua igual ao anterior na prática, porque a UTM vazia é descartada.
  - **Gestor de Tráfego:** Q6 reconhece o ID do anúncio que vem no link.
- **Motivo:** decisão do dono, para atribuir exatamente anúncio → cadastro e tratar cliente de mídia paga como lead.
- **Arquivos afetados:** `lib/lead-origin.js`, `lib/attendance-guide-core.mjs`, `lib/attendance-guides.js`, `lib/whatsapp-flows.js`, `lib/whatsapp-referral.mjs`, testes (`attendance-guide-core`, `lead-origin`, `whatsapp-chat-media-referral`, novo `ctwa-form-link-attribution`), `.claude/skills/auditar-trafego/references/consultas-funil.md`, `docs/TRAFEGO_META.md` §4.
- **Dado alterado em produção (autorizado):** `whatsapp_flows` id `5fa75655-b82e-4020-8bdc-67e50f2932fc`, nó `form`, campo `linkUrl` (em `graph` e `published_graph`). Para reverter, remover `&utm_content={{anuncio_id}}`.
- **Risco/observação:**
  - Nenhum histórico reescrito; nada alterado na Meta.
  - **Validação:** suíte com 261 aprovados e 1 falha conhecida (`whatsapp-flow-core`, "Menu principal"); `pnpm build` ok.
  - Clientes antigos com evidência paga passam a abrir o guia de lead dali em diante, porque a classificação é calculada na leitura.
- **Autor:** Claude Code

### 2026-10-01 — Reconhecimento de UTMs pagas fora do padrão + diagnóstico de atribuição do Gestor de Tráfego
- **Data:** 2026-10-01
- **Área:** Meta/Tráfego / Clientes (origem)
- **Alteração:**
  - **Código (`crm-editor`):** `lib/lead-origin.js` ganhou `classifyPaidMedia`, uma função pura. Ela reconhece como mídia paga também `utm_medium=anuncio`/`anúncio`, formato do Fluxo ativo "Anúncio WhatsApp — formulário direto", que só dispara para quem chegou clicando em anúncio. Novos cadastros pagos passam a gravar `paid_media: true` e, quando há evidência, `paid_channel` (`whatsapp_ad` para `ctwa_formulario`; `meta_site` para fb/ig). Essas chaves são aditivas em `client_origins.source_metadata`. O padrão atual e a prioridade de `kind`/`label` ficaram iguais; link pessoal continua `broker_link`.
  - **Gestor de Tráfego:**
    - Q2 passou a reconhecer `anuncio` e `paid_media`.
    - No caso `ctwa_formulario`, busca o anúncio no `referral` da conversa pelo telefone, sem contar duas vezes quem já tem card de anúncio de WhatsApp.
    - Nova consulta canônica **Q6** (diagnóstico de atribuição) em `consultas-funil.md`.
- **Motivo:** pedido do dono, após a primeira auditoria de tráfego.
- **Arquivos afetados:** `lib/lead-origin.js`, `tests/lead-origin.test.mjs` (novo, 11 testes), `.claude/skills/auditar-trafego/references/consultas-funil.md`, `docs/TRAFEGO_META.md` §4, `docs/BUSINESS_RULES.md` CAM-3.
- **Risco/observação:**
  - **Histórico:** nenhum cadastro antigo foi alterado (origem imutável; sem evidência, nada muda). Os 2 cadastros "PATROCINADO" sem nenhuma UTM continuam sem atribuição.
  - **Validação em produção (set/2026, Q6):** 38 por anúncio de WhatsApp, 21 com UTM padrão e 2 do formulário do anúncio de WhatsApp (1 com o anúncio identificado pela conversa e já contado, 1 sem conversa). A Q2 atribui 60 cadastros: os 59 de antes mais 1 de mídia paga sem anúncio identificado.
  - **Testes e build:** suíte igual à anterior (1 falha conhecida em `whatsapp-flow-core`); `pnpm build` ok.
  - **Pendente de decisão:** o Guia de Atendimento (`lib/attendance-guide-core.mjs`) trata `tracked_link` como lead, mas não `paid_link`. Cadastro patrocinado sem link pessoal recebe o guia orgânico, e isso já acontecia antes desta mudança.
- **Autor:** Claude Code (correção de código pelo `crm-editor`)

### 2026-10-01 — Gestor de Tráfego: análises só dos últimos 30 dias, sem backfill
- **Data:** 2026-10-01
- **Área:** Meta/Tráfego / Docs
- **Alteração:** decisão do dono — não carregar o histórico antigo da Meta. Anúncios de 2023 (impulsionamentos e publicações patrocinadas) não são relevantes para a estratégia atual. Baseline e análises do Gestor de Tráfego usam os últimos 30 dias.
- **Arquivos afetados:** `.claude/skills/auditar-trafego/references/regras-decisao.md` §1, `docs/TRAFEGO_META.md` §6-A.
- **Risco/observação:** nenhuma chamada de backfill foi feita. A sincronização diária e a intradiária continuam iguais.
- **Autor:** Claude Code

### 2026-10-01 — Gestor de Tráfego: agente + 3 skills somente leitura (Meta × funil do CRM)
- **Data:** 2026-10-01
- **Área:** Docs / Infra (estrutura do Claude Code) / Meta/Tráfego
- **Alteração:** novo agente `gestor-trafego` e skills `/auditar-trafego` (auditoria + monitoramento + funil anúncio → cliente → simulação → documentação → aprovação → reunião → venda; referências `consultas-funil.md` com Q0–Q5 validadas em produção e `regras-decisao.md` com baseline do histórico, critérios para baixo volume, interpretação de atribuição e checklist de configuração), `/criar-anuncio` (copy + briefing + `conformidade-imobiliaria.md`) e `/planejar-campanha` (especificação PAUSADA + checklist). Conceitos do projeto público Meta Ads Stack (ad-audit, ad-watchdog, ad-creative-engine, campaign-builder, princípios do ad-optimizer) usados só como referência; nenhum MCP, token ou integração instalado. `docs/TRAFEGO_META.md` §6-A, `CLAUDE.md` e `AGENTS.md` atualizados.
- **Motivo:** pedido do dono — especializar o Gestor de Tráfego (Marília/SP, primeiro imóvel, MCMV, financiamento) e cruzar investimento com a evolução real do lead no CRM.
- **Arquivos afetados:** `.claude/agents/gestor-trafego.md`, `.claude/skills/{auditar-trafego,criar-anuncio,planejar-campanha}/**`, `docs/TRAFEGO_META.md`, `CLAUDE.md`, `AGENTS.md`.
- **Risco/observação:**
  - **Segurança:** somente leitura (`SELECT` no Supabase; integração Meta é `ads_read`); toda ação vira recomendação para aprovação; sem metas inventadas (baseline do histórico até o dono definir).
  - **Achados de dados (verificados):**
    - links pagos usam UTM com IDs da Meta (campanha/conjunto/anúncio), casando 1:1 com `meta_ad_entities`;
    - leads da Meta ≠ clientes do CRM por desenho (o Pixel conta todo formulário; a Meta atribui com 7d clique/1d visualização);
    - campanha de WhatsApp tem `leads = 0` na Meta (o resultado é "conversa iniciada");
    - `special_ad_categories` não é sincronizado → categoria especial **A CONFIRMAR**.
  - **Contexto medido em sessão nova:** +570 tokens fixos (descrições); auditoria completa carrega ~7 mil tokens só quando usada.
  - **Teste de roteamento:** pergunta de tráfego foi delegada ao `gestor-trafego`; sem acesso ao banco, o agente recusou estimar.
  - **Histórico (backfill):** autorizado pelo dono, mas só pode ser disparado com sessão de administrador (rota existente `POST /api/admin/meta-ads/backfill`). Dados atuais: 13/09–30/09/2026.
- **Autor:** Claude Code

### 2026-10-01 — Atribuição em massa da Prospecção registra o admin real em "Alterar conta"
- **Data:** 2026-10-01
- **Área:** Permissões / Prospecção
- **Alteração:** `assignProspectingContacts` (`lib/prospecting.js`), única ação exclusivamente administrativa entre os 8 pontos do P-17, passa a registrar quem **realmente** executou, mesmo durante "Alterar conta". Usa `getActingAdminEmail` no `adminEmail` (`changed_by` do status inicial e `last_admin_email`) e no `actor` da origem do cadastro. As demais ações operacionais continuam atribuídas ao corretor emulado.
- **Motivo:** decisão do dono (2026-10-01).
- **Arquivos afetados:** `lib/prospecting.js`, `.claude/rules/auth-permissoes.md`, `docs/SYSTEM_ARCHITECTURE.md` (P-17).
- **Risco/observação:**
  - Fora de "Alterar conta" o comportamento é idêntico, porque `getActingAdminEmail` devolve o próprio usuário.
  - O status inicial `pending` não pontua, então não há efeito em ranking.
  - Só afeta clientes **criados** pela atribuição; cliente já existente não tem a origem regravada.
  - **Validação:** checagem isolada de `getActingAdminEmail` ("Alterar conta" → admin real; sessão normal → o próprio usuário); `pnpm build` ok; suíte igual à anterior (245 ok, 1 falha conhecida em `whatsapp-flow-core`).
- **Autor:** Claude Code

### 2026-10-01 — WA-10, ROL-2b e proteção do upload público de captação (implementação)
- **Data:** 2026-10-01
- **Área:** WhatsApp / Roleta / Presença / Site público / Infra
- **Alteração:**
  - **WA-10:** o botão "Receber minha simulação" abre o WhatsApp do corretor **responsável** pelo cadastro, usando o token do próprio cadastro. Na fila de espera mostra aviso e consulta de novo; com responsável sem telefone válido mostra aviso. Nunca abre número de reserva.
  - **ROL-2b:** a roleta considera on-line só até 5 min da atividade **real**. Clique no WhatsApp do CRM e envio pelo Chat contam como atividade; acabou a gravação de hora no futuro. A tolerância visual do painel Online, do seletor 🟢 do Chat e do painel da roleta passou a ser calculada na leitura (`loadVisualPresence`). O clique de WhatsApp da Prospecção agora registra atividade como os demais.
  - **Upload de captação:**
    - tipo validado pelos bytes reais do arquivo;
    - rate limit que bloqueia se a checagem falhar (só nesta rota);
    - limpeza diária de fotos órfãs (com mais de 72 h, nunca referenciadas em captação ou imóvel), no cron `scheduled-activities`.
  - **P-17:** decisão do dono registrada: ações operacionais em "Alterar conta" continuam atribuídas ao corretor emulado; os 8 pontos não foram alterados.
- **Motivo:** regras confirmadas pelo dono em 2026-10-01.
- **Arquivos afetados:**
  - Código: `lib/admin-presence.js`, `lib/admin-presence-core.mjs` (novo), `lib/lead-distribution.js`, `lib/whatsapp-chat.js`, `app/api/prospecting/[id]/route.js`, `lib/simulation-registrations.js`, `lib/receive-simulation-contact.mjs` (novo), `app/api/whatsapp-contact/route.js`, `components/simulation-form/{SimulationForm,SimulationSuccess,ReceiveSimulationWhatsappButton}.jsx`, `lib/rate-limit.js`, `lib/image-signature.mjs` (novo), `app/api/uploads/captacoes/route.js`, `lib/captacao-upload-cleanup.js` e `-core.mjs` (novos), `app/api/cron/scheduled-activities/route.js`.
  - Testes novos: `tests/admin-presence-core`, `receive-simulation-contact`, `image-signature`, `captacao-upload-cleanup-core`.
  - Documentação: rules `auth-permissoes`, `integracoes-externas`, `roleta-prospeccao-campanhas`; `docs/BUSINESS_RULES.md`, `SYSTEM_ARCHITECTURE.md`, `PERMISSIONS.md`, `WHATSAPP.md`.
- **Risco/observação:**
  - **Banco:** nenhuma migration nem mudança de banco. A limpeza grava só a marca `crm_settings.id='captacao_upload_cleanup'`.
  - **Conferido em produção (somente leitura):** todo cadastro por formulário tem token; 0 fotos em `captacoes/` hoje; nenhum `last_activity_at` no futuro.
  - **Validação:** `pnpm build` ok; testes ok, exceto a falha conhecida de `tests/whatsapp-flow-core.test.mjs`. Sem login real neste ambiente: tela de espera do botão e painel Online não foram vistos rodando.
  - **Efeito visível:** depois de uma ação de WhatsApp o status visual on-line pode durar até ~1 min a menos que antes, porque a marca é por minuto.
  - **Pendente de decisão:** `assignProspectingContacts` (única ação administrativa entre os 8 pontos do P-17).
- **Autor:** Claude Code

### 2026-10-01 — Pente-fino documental: P-17, upload de captação, Oportunidades e duas regras do dono
- **Data:** 2026-10-01
- **Área:** Docs / Permissões / Roleta / WhatsApp
- **Alteração:**
  - **Regras do dono (`/registrar-regra`):** WA-10 (botão "Receber minha simulação" abre o WhatsApp do corretor responsável) e ROL-2b (on-line para a roleta = atividade real no CRM nos últimos 5 min, sem tolerância por clique ou envio no WhatsApp). As duas **divergem do código** e foram registradas lado a lado como COMPORTAMENTO ATUAL, aguardando implementação.
  - **P-17 auditado:** 8 pontos que chegam à pontuação, lista em `SYSTEM_ARCHITECTURE.md` §13.
  - **Upload de captação (P-09):** risco documentado.
  - **Central de Oportunidades:** removidas as referências obsoletas em `CRM_CONTEXT.md` (menus refeitos a partir do `AdminMenu.jsx`), `PERMISSIONS.md` e `SYSTEM_ARCHITECTURE.md`. O histórico continua em `BUSINESS_RULES.md` §9.
- **Motivo:** pedido do dono (pente-fino final, sem alterar comportamento).
- **Arquivos afetados:** `.claude/rules/integracoes-externas.md`, `.claude/rules/roleta-prospeccao-campanhas.md`, `docs/BUSINESS_RULES.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/CRM_CONTEXT.md`, `docs/PERMISSIONS.md`.
- **Risco/observação:** nenhum código alterado. Pendências:
  - implementar WA-10 e ROL-2b;
  - corrigir os 8 pontos de P-17;
  - decidir a reserva do botão sem responsável e se o clique no botão WhatsApp conta como atividade.
  - `SYSTEM_ARCHITECTURE.md` l.139 ainda lista `tests/whatsapp-contact-channel.test.mjs`, removido em 29/09 (fora do escopo desta tarefa).
- **Autor:** Claude Code

### 2026-10-01 — Documentação alinhada ao código: roleta on-line, §13, Oportunidades e WhatsApp individual
- **Data:** 2026-10-01
- **Área:** Docs / Roleta / WhatsApp
- **Alteração:**
  - **Roleta:** nova REGRA OFICIAL (definida em 30/09, confirmada pelo dono em 01/10) na rule e em `BUSINESS_RULES.md` (ROL-2a, ROL-5, ROL-7). Distribuição só entre corretores on-line, fila de espera (`pending_distribution_at`) e link geral sem `?ref=` pela roleta. A regra de 2026-09-24 foi mantida como histórico.
  - **Arquitetura:** `SYSTEM_ARCHITECTURE.md` §13 marca P-01, P-04, P-08, P-09 e P-17 como resolvidos, com o que resta de cada um.
  - **Oportunidades:** `BUSINESS_RULES.md` §9 marca a Central de Oportunidades como removida, com OPO-1/OPO-2 só como histórico.
  - **WhatsApp:** `WHATSAPP.md` ganhou a §1-A (arquitetura do WhatsApp individual) e o aviso do banimento do número oficial.
- **Motivo:** pedido do dono, depois do registro retroativo de 28–30/09.
- **Arquivos afetados:** `.claude/rules/roleta-prospeccao-campanhas.md` (regra + `paths:`), `.claude/rules/integracoes-externas.md` (nota de atualização), `docs/BUSINESS_RULES.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/WHATSAPP.md`.
- **Risco/observação:** só documentação, conferida no código atual.
  - **A CONFIRMAR:** a tolerância de presença após clique em WhatsApp não aparece na nova `pick_round_robin_broker`.
  - **A CONFIRMAR:** os ~16 usos de `auth.user.email` fora das 2 rotas corrigidas em P-17.
  - **A CONFIRMAR:** se o upload de captação ainda grava sem login.
  - **Para o dono:** cliente do link geral pode ser distribuído a outro corretor, mas o botão "Receber minha simulação" abre o WhatsApp do Matheus.
  - **Ainda citam Oportunidades:** `CRM_CONTEXT.md`, `PERMISSIONS.md` e `SYSTEM_ARCHITECTURE.md` (§§ de inventário).
- **Autor:** Claude Code

### 2026-10-01 — Reorganização da estrutura do Claude Code (rules, agente, skills)
- **Data:** 2026-10-01
- **Área:** Docs / Infra (estrutura do Claude Code)
- **Alteração:** rules de `.claude/rules/` com `paths:` (carregamento sob demanda; `workflow-dev` e `auth-permissoes` continuam globais); divergências D-1 a D-7 corrigidas nas próprias rules; lacunas cobertas (WhatsApp individual, automação da Meta Diária, Google Contacts, Reconhecimentos); `CLAUDE.md` com "onde cada informação mora"; `crm-editor` e skills de auditoria atualizados; novas skills `registrar-regra` e `diagnosticar-producao`; trechos históricos movidos sem alteração para `docs/HISTORICO_REGRAS.md`; entradas deste changelog que estavam acima do cabeçalho movidas para "Registro" (texto intacto) e regra de arquivamento mensal criada.
- **Motivo:** pedido do dono (auditoria de governança do Claude Code): as 11 rules carregavam em toda sessão (~20 mil tokens) e várias continham fatos já desmentidos pelo código.
- **Arquivos afetados:** `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `.claude/rules/*.md`, `.claude/agents/crm-editor.md`, `.claude/skills/*/SKILL.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/PERMISSIONS.md`, `docs/HISTORICO_REGRAS.md`, `docs/CHANGELOG_AI.md`.
- **Risco/observação:** nenhum código do CRM, banco, migration ou integração foi tocado; nenhuma etiqueta REGRA OFICIAL alterada (conferido por script). Rule com `paths:` só carrega quando um arquivo do módulo é lido pela ferramenta Read — perguntas diretas sem leitura de arquivo dependem de ler a rule manualmente (instrução no `CLAUDE.md`). Os ~50 commits de 2026-09-30 (automação da Meta Diária, WhatsApp individual, Google Contacts) não têm entrada neste changelog — A CONFIRMAR se o dono quer registro retroativo.
- **Autor:** Claude Code

> **Registro retroativo (feito em 2026-10-01).** As 8 entradas abaixo consolidam, por tema, os ~125 commits de 28/09 (tarde) a 30/09/2026 que ficaram sem registro aqui. Não é um registro commit a commit: o detalhe de cada mudança está no `git log` do período. Autor das mudanças: Claude Code (sessões do dono); autor deste resumo: Claude Code.

### 2026-09-28 a 2026-09-30 — WhatsApp individual (Baileys) substitui o número oficial banido
- **Área:** WhatsApp / Infra / Banco
- **Alteração:** cada corretor conecta o próprio WhatsApp por QR Code ou código numérico de pareamento. O microsserviço `whatsapp-individual-service/` roda no Railway (não na Vercel) e não guarda a service role: lê e grava estado e credenciais cifradas via `app/api/webhooks/whatsapp-individual/state`, autenticado por `X-Service-Secret`. O Chat do CRM envia e recebe pela sessão do responsável. `pickSendChannel` bloqueia o envio quando a sessão existe mas está caída, sem cair em silêncio no número banido. Também:
  - contato novo no número pessoal vai direto para o dono da sessão, sem roleta;
  - grupos e listas de transmissão são ignorados;
  - foto, documento e áudio são enviados;
  - confirmação de entrega e leitura funciona;
  - troca de número depois de banimento destrava.
- **Decisões do dono:** importar o histórico do celular ao conectar, ciente de que traz conversas pessoais. A sincronização ficou **desligada** (`WHATSAPP_HISTORY_SYNC_ENABLED`) porque gerava 504 no webhook. Removida a trava de janela de 24 h no Chat (regra exclusiva do número oficial).
- **Motivo:** o número oficial (Meta Cloud API) foi banido em 28/09/2026.
- **Arquivos afetados:** `whatsapp-individual-service/**`, `lib/whatsapp-individual*.js`/`.mjs`, `lib/whatsapp-chat.js`, `app/api/webhooks/whatsapp-individual/**`, `app/api/admin/whatsapp-individual/**`, `components/WhatsappIndividualStatus.jsx`. Migrations `20260928130000_whatsapp_individual_sessions`, `20260928180000_whatsapp_individual_direct_broker`, `20260928190000_whatsapp_conversation_account_badge`, `20260930160000_whatsapp_individual_pairing_code`.
- **Risco/observação:** a sessão Baileys depende do celular do corretor e pode cair. Corretor sem sessão configurada continua no caminho antigo (Cloud API, banida). Doc: `.claude/rules/integracoes-externas.md`. `docs/WHATSAPP.md` ainda não descreve o canal individual por completo (A CONFIRMAR atualização).

### 2026-09-29 a 2026-09-30 — Automação da Meta Diária pelo WhatsApp individual
- **Área:** Meta Diária / WhatsApp / Banco
- **Alteração:** o cron `whatsapp-meta-diaria-dispatch` (a cada 5 min, depois a cada 2 min) envia 1ª, 2ª e 3ª tentativa pela sessão pessoal do corretor, **nunca** pelo número oficial. Funcionamento:
  - janela padrão 06h30–19h;
  - 4 variações de mensagem por tentativa, em rotação sequencial persistente;
  - ordem das atividades embaralhada;
  - intervalo com oscilação em torno da média;
  - teto diário = todas as atividades do dia (máx. 100), sem rampa de aquecimento;
  - "enviada" só conta com confirmação do WhatsApp;
  - erro de contato separado de erro de infraestrutura: retry técnico em 30 min sem gastar tentativa; após 3 falhas do contato, categoria nova **"Erro"** (`auto_error`);
  - a cota de 20 novos do dia é gerada pelo cron, sem o corretor abrir a tela;
  - painel de configuração em Gestão › Meta Diária › Automação, com histórico por corretor e card resumido.
- **Decisões do dono:**
  - a automação liga sozinha quando a sessão conecta;
  - o corretor **não** pausa nem ativa a própria automação (só admin/gestor, também bloqueado na API);
  - o envio manual continua liberado mesmo com a automação ligada (uma trava que impedia isso foi revertida no mesmo dia).
- **Motivo:** pedido do dono, para cumprir a meta de contatos sem envio manual um a um.
- **Arquivos afetados:** `lib/daily-goal-auto.js`, `lib/daily-goal-auto-core.mjs` (+ `tests/daily-goal-auto-core.test.mjs`), `lib/daily-goal.js`, `app/api/cron/whatsapp-meta-diaria-dispatch/**`, `app/api/admin/daily-goal-auto/**`, `app/api/daily-goal/auto/**`, `components/DailyGoalAutoPanel.jsx`, `components/TeamDailyPerformance.jsx`. Migrations `20260929190000_daily_goal_auto_dispatch`, `20260929200000_daily_goal_auto_window`, `20260930113000_fix_daily_goal_auto_queue_unique_constraint`, `20260930140000_daily_goal_auto_oscillate`, `20260930150000_daily_goal_auto_delivery_tracking`, `20260930150500_meta_diaria_dispatch_every_2min`, `20260930200000_meta_diaria_auto_robustez`.
- **Risco/observação:** bugs reais corrigidos no caminho:
  - UNIQUE da fila travava a re-fila para sempre, com erro engolido;
  - um conflito isolado descartava o lote inteiro;
  - timestamp inválido no agendamento;
  - falso positivo de pausa automática;
  - contagem de enviadas que não batia com o WhatsApp.
  Risco permanente: banimento de números pessoais por volume. Doc: `.claude/rules/meta-diaria-ranking.md` §Automação.

### 2026-09-30 — Integração Google Contacts por corretor (pedido de 01/10)
- **Área:** Integrações / Meta Diária / Banco
- **Alteração:** cada corretor conecta a própria conta Google por OAuth. Antes de cada envio automático da Meta Diária, `ensureClientInBrokerContacts` salva o cliente na agenda do corretor, de forma idempotente (mapa local broker+telefone). Tokens cifrados com `lib/secrets-crypto.js` (`CRM_SECRETS_ENCRYPTION_KEY`), nunca expostos ao front. Badge de conexão no cabeçalho do painel.
- **Motivo:** pedido do dono. Contato salvo na agenda tende a reduzir bloqueio e denúncia de mensagens no WhatsApp pessoal (A CONFIRMAR como motivação exata).
- **Arquivos afetados:** `lib/google-contacts*.js`/`.mjs`, `lib/secrets-crypto.js`, `lib/daily-goal-auto.js`, `app/api/google-contacts/**`, `components/GoogleContactsStatus.jsx`, `tests/google-contacts-config.test.mjs`. Migration `20261001120000_google_contacts_integration`.
- **Risco/observação:** opt-in. Na publicação nenhum corretor estava conectado, então o fluxo de envio seguiu idêntico. Falha no Google é best-effort: nunca derruba o envio nem conta como erro do contato. Variáveis novas: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `CRM_SECRETS_ENCRYPTION_KEY` (configuração em produção A CONFIRMAR).

### 2026-09-30 — Roleta só entre corretores on-line, com fila de espera; link geral pela roleta
- **Área:** Roleta / Clientes / Banco
- **Alteração:**
  - `pick_round_robin_broker` perdeu os níveis 3 e 4 ("ausente" e "qualquer elegível") e só considera quem está on-line.
  - Sem ninguém on-line, o cadastro é criado sem responsável, com `pending_distribution_at`, e o card mostra "Aguardando". O cron `scheduled-activities` (`reassignPendingRouletteLeads`) atribui o mais antigo assim que alguém fica on-line.
  - `reassignOrphanedClientsToOwner`, a regra REDISTRIBUIÇÃO DE LEADS e o escopo do gestor foram ajustados para essa fila.
  - O **link geral do site (sem `?ref=`) passou a ir pela roleta**, em vez de cair no Matheus. O botão "Receber minha simulação" continua usando o default `matheus`.
- **Motivo:** regra do dono (2026-09-30).
- **Arquivos afetados:** `lib/lead-distribution.js`, `lib/simulation-registrations.js`, `lib/crm-automations.js`. Migration `20260930130000_roleta_online_only_waiting_queue`.
- **Risco/observação:** **diverge do texto atual das rules.** `.claude/rules/roleta-prospeccao-campanhas.md` ("Roleta por presença", REGRA OFICIAL de 2026-09-24) ainda descreve os níveis 3 e 4. `.claude/rules/integracoes-externas.md` diz que o link sem `?ref=` grava o Matheus como responsável. Registrar a regra nova pela skill `/registrar-regra` (A CONFIRMAR com o dono).

### 2026-09-30 — Meta Diária/Prospecção: cliente não é mais liberado cedo demais; incidente do cadastro
- **Área:** Meta Diária / Prospecção / Clientes
- **Alteração:**
  - A 3ª tentativa encerra a rodada mas **mantém** o responsável. Depois de 24 h sem mudança de status, o contato "hiberna" (trava de 30 dias) e só então volta à base.
  - O retorno automático da Prospecção passou de 2 para 7 dias.
  - Contato ligado a cliente "não contactar"/vendido por **outra** linha (telefone irmão) não recebe mais envio automático (`isContactBlockedFromOutreach`) nem aparece na fila.
  - Overloads inseguros das RPCs de claim foram removidos.
  - Rodada já contatada hoje não é reenfileirada.
- **Incidente (30/09, tarde):** a hibernação, na primeira versão, montava uma lista com ~1.600 ids e estourou o tamanho de URL do PostgREST. O "Bad Request" quebrou **todo** cadastro do formulário público até a correção (consulta invertida, filtro por join). Foram publicados 3 commits de diagnóstico temporário, removidos na correção. Motivou a skill `/diagnosticar-producao`.
- **Arquivos afetados:** `lib/prospecting-auto-return.js`, `lib/daily-goal.js`, `lib/prospecting.js`, `lib/simulation-registrations.js`. Migrations `20260928200000_daily_goal_claim_guards`, `20260930180000_drop_unsafe_claim_overloads`.
- **Risco/observação:** consulta que filtra por lista de ids crescente deve partir da tabela pequena ou usar join. Nunca montar `.in()` com histórico inteiro.

### 2026-09-29 — Acompanhamento de aprovação na CCA e novos status de aprovação
- **Área:** Documentação/CCA / Funil
- **Alteração:**
  - Histórico de sub-status por cliente (`client_cca_status_history`, uma linha aberta por vez), aberto automaticamente no envio à CCA.
  - Selo no card do cliente com contador "há X dias" (verde até 2, amarelo até 5, vermelho acima).
  - Vínculo manual de cliente já aguardando documentação.
  - Foto da CCA.
  - Três status novos em Aprovação (Comprometimento de renda, Carta de cancelamento, M.O de pesquisa), na mesma macroetapa de Restrição/Reprovado.
  - A aba de cadastro de sub-status (Status CCA) foi removida em seguida, ficando só a leitura dos valores semeados.
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `lib/client-cca-status.js`, `lib/cca-status-stages.js`, `lib/cca-status-presentation.mjs` (+ teste), `lib/client-status.js`, `components/CcaStatusCard.jsx`, `app/api/admin/client-cca-status/**`. Migrations `20260929150000_cca_status_stages`, `20260929150100_client_cca_status_history`, `20260929160000_client_status_approval_reasons`.
- **Risco/observação:** status novos entram no enum único `lib/client-status.js` e não criam aba própria no funil.

### 2026-09-29 a 2026-09-30 — Pente-fino: problemas conhecidos corrigidos e performance
- **Área:** Clientes / Permissões / Notificações / Infra
- **Alteração:** corrigidos problemas listados em `docs/SYSTEM_ARCHITECTURE.md` §13:
  - **P-01:** fim do casamento de cadastro por nome igual, e fim do corte em 1.000 linhas na detecção de duplicidade;
  - **P-04:** lembrete de atividade não trava mais push/e-mail quando o WhatsApp falha;
  - **P-08:** lead da home e captação passam a avisar por e-mail;
  - **P-09:** rate limit dos formulários públicos no banco (`check_public_rate_limit`) em vez de memória;
  - **P-17:** ação feita em "Alterar conta" pontua para o admin real;
  - **P-11 (parcial):** o Chat passa a gravar `last_whatsapp_contact_at` ao enviar, com backfill.
  Performance: índices em 24 chaves estrangeiras de tabelas quentes (advisor do Supabase), consultas em paralelo e menos idas ao banco na Meta Diária. Novo gráfico de ranking histórico (dia/semana/mês) em Desempenho, usando o mesmo motor de pontuação.
- **Decisão revertida:** mover as funções da Vercel para São Paulo (`gru1`) deixou o CRM inacessível, porque o banco fica em `us-west-2`. Revertido no mesmo dia; a região padrão continua.
- **Arquivos afetados:** `lib/simulation-registrations.js`, `lib/scheduled-activity-notifications.js`, `lib/admin-auth.js`, `lib/lead-notifications.js`, `lib/rate-limit.js`, rotas públicas de cadastro/captação/leads, `lib/whatsapp-client-status.js`, `lib/performance-overview.js`, `lib/performance-trend.mjs`. Migrations `20260929120000_public_form_rate_limits`, `20260929170000_missing_fk_indexes_hot_tables`, `20260928210000_backfill_last_whatsapp_contact_from_chat`.
- **Risco/observação:** a tabela §13 de `docs/SYSTEM_ARCHITECTURE.md` ainda lista P-01, P-04, P-08, P-09 e P-17 como abertos (atualização pendente). Mudança de região da Vercel só com o banco na mesma região.

### 2026-09-28 a 2026-09-29 — Site e painel após o banimento do número oficial
- **Área:** WhatsApp / Site público / Painel / Cron
- **Alteração:**
  - Botão flutuante de WhatsApp do site desativado temporariamente.
  - "Receber minha simulação" abre o WhatsApp **pessoal** do corretor do link.
  - O botão WhatsApp dos cards (Clientes, Meta Diária, Prospecção) passou pelo Chat do CRM e **voltou a abrir o WhatsApp Web/app (`wa.me`)** em 29/09, até o Chat individual ficar estável; o código de decisão Chat-ou-externo foi removido.
  - Os crons `scheduled-activities`, `whatsapp-broadcast-dispatch` e `whatsapp-flows` passaram de 1 para 2 min (~30% do tempo do banco; via `cron.alter_job`, fora do repo).
  - Menu do corretor/gestor: Prospecção e Novo cliente unificados, atalho da Meta Diária, Central de Oportunidades **removida** por completo.
- **Motivo:** número oficial banido e pedidos do dono.
- **Arquivos afetados:** `components/WhatsAppFloatingButton.jsx`, `components/simulation-form/**`, `app/api/whatsapp-contact/**`, `components/AdminMenu.jsx`, `components/AdminSimulationList.jsx`.
- **Risco/observação:** regras correspondentes já estão em `.claude/rules/integracoes-externas.md` (botão e crons). A remoção de Oportunidades apagou `lib/opportunities.js`/`lib/opportunity-scoring.js`; `docs/BUSINESS_RULES.md` §9 ainda descreve a Central (A CONFIRMAR atualização).

### 2026-09-29 — Reconhecimentos: 1ª cena cinematográfica (100% da meta) + arquitetura por gatilho
- **Área:** overlay de reconhecimentos (Incentivo).
- **Alteração:** o overlay virou uma casca fina (`CelebrationOverlay.jsx`) que escolhe, por `trigger_key`, um componente de "cena" isolado e carregado sob demanda (`next/dynamic`, sem SSR) — `scenes/Scene100.jsx` é a primeira cena cinematográfica (anel dourado que se desenha até 100% reaproveitando `components/motion/AnimatedRing`/`AnimatedNumber`, pulso de luz + explosão de confete no fechamento via novo `burstConfettiExplosion`, texto em cascata palavra por palavra via `StaggerContainer`/`StaggerItem` já existentes); as demais 15 continuam em `scenes/GenericScene.jsx` (o visual anterior, card + emoji) até serem migradas no mesmo padrão. Corrigido também: a prévia/"Testar" não mostra mais "Você" como nome quando não há corretor real — usa o nome de quem está testando (admin/gestor logado, ou o corretor selecionado no disparo manual) ou remove o placeholder da frase.
- **Arquivos:** `components/celebrations/CelebrationOverlay.jsx`, `components/celebrations/scenes/Scene100.jsx`, `components/celebrations/scenes/GenericScene.jsx`, `components/celebrations/celebrationEffects.js` (nova `burstConfettiExplosion`/`getParticleQuality`), `components/celebrations/BrokerCelebrationGate.jsx` e `CelebrationsManager.jsx` (passam `triggerKey`/nome para a prévia), `app/admin/automacoes/page.jsx`.
- **Risco/observação:** só a cena dos 100% foi refeita (pedido do dono: aprovar o padrão antes de replicar nas outras 15); nenhuma tabela ou regra de negócio mudou. Verificação por leitura cuidadosa — sem ambiente de preview disponível para ver a animação rodando de verdade.

### 2026-09-29 — Reconhecimentos com animação (Automações › Incentivo)
- **Área:** ranking/gamificação, painel administrativo, novo motor de eventos.
- **Alteração:** popup central privado (nunca visível para o time) exibido ao corretor quando ele bate 100/150/200% da Meta Diária, assume o 1º lugar do ranking (após as 12h, segurando a liderança por um tempo mínimo), emenda uma sequência de dias na meta, bate recorde pessoal, faz a primeira ação do dia, atinge marcos de vendas no mês, bate meta semanal/mensal, tem cliente aprovado/com contrato assinado/chaves entregues, supera a média do time (após as 12h) ou faz aniversário/completa tempo de casa — 4 animações em canvas (confete, fogos, moedas, coroa) mais um combo exclusivo para os 200%, respeitando `prefers-reduced-motion`. Novo botão "Incentivo" em Automações (aba própria, só admin/gestor): liga/desliga cada gatilho, edita textos (com "restaurar padrão"), escolhe a animação por gatilho, ajusta os parâmetros (horário do ranking, minutos de segurança, resultado mínimo, marcos), faz disparo manual para um corretor específico e mostra o histórico com filtro por corretor/data. "Testar" nunca grava evento real.
- **Tabelas novas:** `celebration_triggers`, `celebration_message_templates`, `broker_celebration_events`, `celebration_ranking_lead_state`; colunas novas `admin_users.birth_date`/`hired_at` e `simulation_registrations.keys_delivered_at` (ainda sem tela dedicada para preencher — hoje só via Supabase).
- **Arquivos:** `lib/celebrations.js`, `app/api/celebrations/**`, `app/api/cron/celebrations-ranking`, `components/celebrations/**`, `app/admin/layout.jsx`, `app/admin/automacoes/page.jsx`, `lib/performance-overview.js` (exporta `getCachedTodayOverviewForRanking` para reaproveitar o cache de 90s do ranking em vez de recalcular a cada poll).
- **Risco/observação:** detecção roda a cada poll do próprio corretor (30s, sem novo custo de realtime — segue o padrão de polling já usado pela Mensagem do Dia/alertas de cliente novo); o 1º lugar do ranking depende de um cron novo de 2 em 2 minutos. "Meta semanal/mensal" é uma aproximação (soma das metas diárias fechadas do período, sem alvo formal próprio). Verificação por leitura cuidadosa de cada arquivo — sem login real disponível neste ambiente para testar os gatilhos na prática; recomenda-se testar cada um pelo botão "Testar" e por um disparo manual antes de confiar 100%.

### 2026-09-29 — Remove cabeçalho "Área restrita" das páginas do painel; "Sair" vai para o rodapé
- **Área:** layout do painel administrativo (`app/admin/**`).
- **Alteração:** removido o rótulo "Área restrita", o título e a descrição do topo de todas as páginas internas (Corretores, Financeiro, Desempenho, Pontuação, Meta Diária, Clientes, Chat, etc.); o botão "Sair" saiu do topo de cada página e passou a aparecer uma única vez, no rodapé, renderizado centralmente por `app/admin/layout.jsx`. Links de ação que dividiam o cabeçalho (ex.: "Novo cliente", "Novo depoimento", "Ver formulário público", "Cadastrar empreendimento") e links de navegação "Voltar…" foram preservados.
- **Arquivos:** `app/admin/layout.jsx` e todas as páginas sob `app/admin/**` (exceto `login` e `reset-password`, que ficam fora da área autenticada).
- **Risco/observação:** mudança só de UI, sem efeito em regra de negócio ou dado; verificação por leitura de cada diff (sem login real disponível neste ambiente para rodar o preview).

### 2026-09-28 — Conter consultas sobrepostas durante lentidão do CRM
- **Área:** avisos globais de Chat e novos clientes.
- **Alteração:** uma atualização pendente é compartilhada pelo resumo do Chat; o aviso sonoro não inicia outra consulta enquanto a anterior não terminou. Intervalos, notificações e escopo permanecem iguais.
- **Risco/observação:** logs de produção registraram ondas de 30–60 s no Supabase e `PGRST003` (pool do PostgREST esgotado), além de timeouts nos cron/webhooks. Esta mudança reduz a amplificação durante a falha, mas a causa da saturação da infraestrutura ainda requer análise de capacidade/recursos no Supabase.

### 2026-09-28 — Relatórios no Chat e ficha cadastral do PDF
- **Área:** Documentação / Chat / PDF.
- **Alteração:** relatório já analisado acessível pelo Chat sem nova seleção; capa do PDF e da Pasta com campos maiores, linhas e seções compactas.
- **Arquivos:** `components/WhatsappChat.jsx`, `components/ClientDocumentsModal.jsx`, `lib/client-document-pdf.js`, `docs/WHATSAPP.md`.
- **Risco:** conteúdo e permissões dos relatórios não foram alterados; verificação visual da capa com dados de exemplo, sem acesso a documentos reais.

### 2026-09-28 — Prévia e processamento documental no Chat
- **Causa:** dois lotes reais importaram 10 arquivos e 2 mensagens, mas falharam no recálculo: o `upsert` do checklist apontava para um índice único parcial que PostgREST não consegue inferir sem o predicado. A requisição longa também expunha “Load failed” no iPhone.
- **Correção:** atualização/inserção por chave com recuperação de colisão concorrente; importação independente por arquivo, início rápido e acompanhamento do status do lote; repetição reutiliza o lote. Miniaturas locais de imagem/PDF, prévia ampliada, progresso visual limitado a 94% até conclusão real e erros legíveis por arquivo.
- **Verificação:** testes e build desta alteração; sem mudança nas regras da IA, cálculos ou Base Mestra.

### 2026-09-28 — Chat e Base Mestra na análise documental
- **Área:** Documentação, Chat, CCA e PDF.
- **Alteração:** seleção explícita de mensagens e arquivos no Chat para a análise documental existente; regras ativas incorporadas em cada parecer; residência sem boletos; rastreio de pendências; cálculo auditável de renda por três extratos; mensagem de pendências editável no Chat; opções PDF ou pasta ZIP para a CCA, com confirmação de pendências.
- **Permissões:** somente administrador geral edita regras; corretor só acessa o próprio cliente e pode preparar envio para CCA; gestão do cadastro de CCA permanece restrita.
- **Verificação:** 18 testes de regras e build Next.js concluídos. Fluxos externos dependem das credenciais de produção.

### 2026-09-28 — Regras editáveis para análise documental
- **Área:** Documentação/CCA / Banco.
- **Alteração:** Gestão > Documentação > Regras da IA administra regras ativas por categoria. A análise lê a versão atual antes de cada lote, registra a regra e a justificativa da pendência e inclui a justificativa no PDF. Correção humana pode abrir uma nova regra para revisão, sem publicação automática.
- **Motivo:** evitar exigências presumidas e permitir corrigir a interpretação sem editar prompts.
- **Arquivos afetados:** `lib/document-analysis.js`, `lib/client-documents.js`, `lib/client-document-pdf.js`, `components/DocumentAiRulesManager.jsx`, `supabase/migrations/20260928092500_document_ai_rules.sql`.
- **Risco/observação:** a análise continua usando o provedor Anthropic existente; reanálises após mudança de regra chamam a IA novamente. Testes da regra de residência e build passaram.
- **Autor:** Codex

### 2026-09-28 — Impedir recriação de cliente excluído
- **Área:** Clientes / WhatsApp.
- **Alteração:** a exclusão pelo dono marca as conversas vinculadas para não gerarem outro cadastro automático. Webhook e cron respeitam a marca em leads orgânicos e patrocinados; Chat e cadastro manual permanecem disponíveis.
- **Motivo:** a FK soltava a conversa após excluir o cliente e o cron a transformava novamente em card com base em mensagem antiga.
- **Risco/observação:** confirmado por leitura que o novo card veio da reconciliação de uma conversa antiga, sem nova mensagem. Nenhum cliente foi apagado como teste.
- **Autor:** Codex

### 2026-09-28 — Menu CRM do corretor legível no mobile
- **Área:** Menu CRM.
- **Alteração:** o menu secundário do corretor abre para dentro da tela, sem cortar os rótulos na lateral esquerda.
- **Autor:** Codex

### 2026-09-28 — Abrir detalhamento no segundo toque
- **Área:** Menu CRM / Clientes.
- **Alteração:** o primeiro toque no botão principal abre a lista padrão; quando já se está nela, outro toque alterna o detalhamento das pendências, em todos os perfis com CRM. Badge e contagens permanecem iguais.
- **Autor:** Codex

### 2026-09-28 — Exclusão de cliente pelo administrador principal
- **Área:** Clientes.
- **Alteração:** a exclusão remove primeiro o atendimento da camada de compatibilidade vinculado ao cadastro, evitando o bloqueio por chave estrangeira; o cliente canônico compartilhado permanece. A permissão exclusiva do dono não mudou.
- **Risco/observação:** se a exclusão do cadastro falhar depois, o atendimento de compatibilidade poderá ser reconstruído na próxima atualização do cadastro; nenhuma exclusão real foi feita como teste.
- **Autor:** Codex

### 2026-09-28 — Novos atendimentos apenas no atendimento automático
- **Área:** Badge CRM / Clientes.
- **Alteração:** clientes em "Em atendimento" deixam de contar em Novos atendimentos; a categoria mostra só Atendimento automático sem resposta ou assunção humana no Chat.
- **Autor:** Codex

### 2026-09-28 — Acesso a novos atendimentos
- **Área:** Badge CRM / Clientes.
- **Alteração:** o atalho de novos atendimentos abre a lista filtrada mesmo quando já se está em Clientes; a contagem/lista usa clientes em atendimento automático ou em atendimento sem resposta/assunção humana registrada no Chat. Aguardando simulação permanece categoria separada para não duplicar.
- **Risco/observação:** abrir o WhatsApp não é prova de atendimento humano. A consulta respeita o escopo de responsável atual, sem mudar pontuação ou distribuição.
- **Autor:** Codex

### 2026-09-28 — Detalhamento do badge CRM
- **Área:** Menu CRM / Clientes / Agenda.
- **Alteração:** o badge principal abre um resumo clicável de Chat, Agenda vencida, novos atendimentos e aguardando simulação. O total usa as mesmas quatro parcelas; cada acesso abre a lista já filtrada conforme o escopo do perfil.
- **Risco/observação:** nenhuma atribuição, status ou permissão foi alterada; o filtro de primeiro contato usa o status Em atendimento sem contato WhatsApp registrado, igual à contagem.
- **Autor:** Codex

### 2026-09-28 — Contadores de pendências no CRM
- **Área:** Clientes / Agenda / Chat.
- **Alteração:** o atalho Agenda exibe atividades vencidas; o botão CRM (Clientes para administrador geral) soma Chat não lido, atividades vencidas e clientes aguardando atendimento ou simulação. Os contadores ficam no canto superior direito e compartilham uma consulta por tela.
- **Risco/observação:** o calendário permanece escopado ao perfil atual e o cliente é contado uma vez por status. Sem migração ou mudança de pontuação.
- **Autor:** Codex

### 2026-09-28 — Atalhos de Clientes na barra de ações
- **Data:** 2026-09-28 · **Área:** Clientes / navegação · **Motivo:** compactar o acesso a Prospecção, Chat e Agenda.
- **Alteração:** atalhos existentes viram ícones após Filtros e Pendências, com badge atual do Chat; a faixa do submenu Clientes do administrador é ocultada, sem alterar as demais categorias, rotas ou permissões.
- **Arquivos:** `components/AdminSimulationList.jsx`, `components/AdminMenu.jsx`.
- **Autor:** Codex

### 2026-09-28 — Abertura compacta da lista de clientes
- **Data:** 2026-09-28 · **Área:** Clientes / interface · **Motivo:** reduzir o espaço antes da navegação.
- **Alteração:** remove título e descrição introdutórios; o menu vem logo após o ranking, a ação Novo cliente vira ícone ao lado de Clientes pendentes e Sair fica ao final da página. A rota e as permissões permanecem iguais.
- **Arquivos:** `app/admin/simulacoes/page.jsx`, `components/AdminSimulationList.jsx`.
- **Autor:** Codex

### 2026-09-28 — Ocultar Melhor do Dia sem pontos
- **Data:** 2026-09-28 · **Área:** Ranking · **Motivo:** destaque diário exibia um corretor com 0 pontos.
- **Alteração:** líder diário só é exibido se tiver pontuação positiva; sem líder válido, o card e a posição diária ficam ocultos, mantendo o campeão semanal.
- **Arquivos:** `lib/performance-overview.js`, `lib/ranking-display.mjs`, `components/TopRankingBadge.jsx`, `tests/ranking-display.test.mjs`, `docs/BUSINESS_RULES.md`.
- **Autor:** Codex

### 2026-09-28 — Meta de domingo antes do campeão semanal
- **Data:** 2026-09-28 · **Área:** Meta Diária / Ranking · **Motivo:** incluir a penalidade de domingo na consolidação das 00:01.
- **Alteração:** cron diário passa de 00:10 para 00:01; o cálculo semanal espera o fechamento antes de apurar os pontos, mesmo com crons simultâneos. O campeão já congelado desta semana permanece intacto; a regra vale para os próximos fechamentos.
- **Arquivos:** `lib/weekly-ranking.js`, `supabase/migrations/20260928043000_daily_goal_close_0001.sql`, `docs/BUSINESS_RULES.md`, `docs/DATABASE.md`.
- **Autor:** Codex

### 2026-09-28 — Ranking por ação real, presença e meta não cumprida
- **Data:** 2026-09-28 · **Área:** Ranking / Meta Diária · **Motivo:** pedido do dono após cliente da roleta gerar pontos sem atendimento.
- **Alteração:** recebimento automático pela roleta deixa de pontuar “Novo cliente”; presença ativa rende pontos por intervalo e bônus ao líder diário; meta fechada sem conclusão desconta pontos, inclusive abaixo de zero. Pesos e intervalo editáveis em Pontuação, com extrato coerente.
- **Arquivos:** `lib/performance-overview.js`, `lib/admin-presence.js`, `lib/scoring-rules.js`, `components/ScoringRulesManager.jsx`, `supabase/migrations/20260928040000_scoring_presence_config.sql`, `docs/BUSINESS_RULES.md`, `docs/DATABASE.md`.
- **Risco/observação:** a migration inicial das três regras foi aplicada no banco pelo Claude, mas seu arquivo não estava neste checkout; a migration incluída completa a configuração de intervalo e é idempotente para as três sementes existentes. Penalidade só após fechamento da meta.
- **Autor:** Codex

### 2026-09-28 — Entrada do conteúdo mais perceptível
- **Data:** 2026-09-28 · **Área:** Interface administrativa · **Motivo:** no iPhone, com movimento reduzido desligado, o dono não percebeu a animação anterior.
- **Alteração:** entrada e troca de conteúdo em 320 ms com deslocamento curto de 20 px; a opção ativa do menu ganha entrada discreta, sem mover ranking, cabeçalho ou estrutura do menu. Nenhuma mudança em regras ou layout.
- **Arquivos:** `app/globals.css`, `components/AdminMenu.jsx`.
- **Autor:** Codex

### 2026-09-28 — Transição acionada na troca real de páginas
- **Data:** 2026-09-28 · **Área:** Interface administrativa · **Motivo:** o dono continuou sem perceber transições depois da correção anterior.
- **Alteração:** o menu agora inicia a entrada do conteúdo a cada troca de seção, inclusive quando o navegador reutiliza o mesmo nó; cabeçalho, menu e ranking não são animados. A preferência por movimento reduzido continua respeitada.
- **Arquivos:** `components/AdminMenu.jsx`, `app/globals.css`.
- **Autor:** Codex

### 2026-09-28 — Navegação mais perceptível no painel
- **Data:** 2026-09-28 · **Área:** Interface administrativa · **Motivo:** o dono não percebeu as transições após a primeira publicação.
- **Alteração:** deslocamento curto e duração de 210 ms no conteúdo trocado, feedback de toque também nos links e entrada ao alternar submenus, Prospecção e abas de empreendimento. Ranking e cabeçalhos continuam fora das animações.
- **Arquivos:** `app/globals.css`, `components/AdminMenu.jsx`, `components/ProspectingTabs.jsx`, `components/EmpreendimentoAdminTabs.jsx`.
- **Autor:** Codex

### 2026-09-28 — Transições discretas na navegação administrativa
- **Data:** 2026-09-28 · **Área:** Interface administrativa · **Motivo:** pedido do dono para navegação mais fluida.
- **Alteração:** entrada curta de conteúdo e cards, transição lateral no Chat ao abrir/voltar, feedback ao pressionar botões e respeito a movimento reduzido. Ranking e menus principais permanecem estáveis.
- **Arquivos:** `app/globals.css`, `components/AdminMenu.jsx`, `components/AdminSimulationList.jsx`, `components/WhatsappChat.jsx`.
- **Autor:** Codex

### 2026-09-28 — Ranking acompanha a rolagem da página
- **Data:** 2026-09-28 · **Área:** Ranking / interface · **Motivo:** correção do dono após verificar no celular.
- **Alteração:** removido `position: sticky` da faixa do ranking; permanece no início do painel, no fluxo da página, e sai de vista ao rolar. Visual e regras preservados.
- **Arquivos:** `app/admin/layout.jsx`.
- **Autor:** Codex

### 2026-09-28 — Layout premium do ranking fixo
- **Data:** 2026-09-28 · **Área:** Ranking / interface · **Motivo:** pedido do dono com mockup de referência.
- **Alteração:** card semanal creme/dourado com coroa e louros, card diário branco/azul, faixa da posição; largura útil inteira no celular e três colunas compactas no desktop. Cabeçalho continua sticky e opaco; removido o segundo espaçamento de área segura antes de “Área restrita”.
- **Arquivos:** `components/TopRankingBadge.jsx`, `app/admin/layout.jsx`, `app/globals.css`.
- **Risco/observação:** somente layout; regras, pontuação, permissões e dados mantidos.
- **Autor:** Codex

### 2026-09-28 — Campeão ou campeã da semana; gerente fora do ranking
- **Data:** 2026-09-28 · **Área:** Ranking / Perfil · **Motivo:** pedido do dono após ver o destaque no celular.
- **Alteração:** cards semanais/diários mais legíveis; título semanal conforme gênero cadastrado; gerentes excluídos da classificação e dos destaques sem perder os dados de desempenho da equipe. Chave semanal versionada para recalcular vencedor salvo sob a regra anterior. Cadastro de gênero de Jennyfer corrigido conforme confirmação do dono.
- **Arquivos:** `lib/ranking-display.mjs`, `lib/performance-overview.js`, `lib/weekly-ranking.js`, `components/TopRankingBadge.jsx`, `app/admin/layout.jsx`, `tests/ranking-display.test.mjs`, `docs/BUSINESS_RULES.md`.
- **Risco/observação:** pontuação e eventos não alterados; resultado semanal já gravado na chave anterior fica sem uso. Validar build e visualização após deploy.

### 2026-09-28 — Aba "Corretores" na Supervisão do WhatsApp
- **Data:** 2026-09-28 · **Área:** WhatsApp · **Motivo:** pedido do dono (visualização poluída depois de imaginar vários WhatsApps de corretores conectados).
- **Alteração:** confirmei com o dono que **não existe** conexão própria de WhatsApp por corretor neste sistema (só o número oficial único da imobiliária) — ele decidiu seguir com a opção simples: nova aba "Corretores" ao lado de Conversas/Visão geral/Campanhas, com um card por corretor (presença real via `admin_presence`, não lidas/sem resposta/ativas) e "Abrir" reaproveitando o MESMO Chat, filtrado por corretor (responsável do cliente OU conversa atribuída a ele — mesma junção do escopo normal, `scopedMerge`/`runScopedQuery` com `brokerId`).
- **Arquivos:** `lib/whatsapp-chat.js` (`getChatBrokerCards`, `runScopedQuery`/`scopedMerge` com `brokerId`, `listChatConversations`), `app/api/admin/whatsapp-chat/broker-cards/route.js`, `app/api/admin/whatsapp-chat/conversations/route.js`, `components/WhatsappChat.jsx`, `components/WhatsappChatBrokers.jsx`, `docs/WHATSAPP.md`.
- **Risco/observação:** feature 100% de organização/filtro — nenhuma regra de atendimento, envio, campanha ou automação foi alterada. O filtro `brokerId` só tem efeito para quem já enxerga tudo (admin/gestor); nunca amplia o que um corretor/associado vê da própria carteira. Não testado com dado real em produção (sem sessão de navegador autenticada disponível) — só build local. Se no futuro surgir de verdade uma conexão de WhatsApp própria por corretor (ex.: o serviço no Railway mencionado pelo dono passar a integrar com este CRM), esta implementação precisa ser revisitada — hoje ela só filtra o número oficial único.
- **Autor:** Codex

### 2026-09-28 — Auditoria de Atendimento (Gestão > Desempenho > Auditoria)
- **Data:** 2026-09-28 · **Área:** Desempenho / WhatsApp / Banco · **Motivo:** pedido do dono.
- **Alteração:** nova tela `Gestão > Desempenho > Auditoria` (corretor + período + "Gerar auditoria"). Métricas objetivas (VOLUME/PROSPECÇÃO/CONVERSÃO/VELOCIDADE/FOLLOW-UP) calculadas 100% pelo sistema — CONVERSÃO/FOLLOW-UP reaproveitam `getBrokerPerformanceOverview` (mesma fonte do funil/ranking); VOLUME/PROSPECÇÃO/VELOCIDADE vêm direto de `whatsapp_conversations`/`whatsapp_messages` do próprio corretor no período. Seção QUALIDADE usa a integração OpenAI já existente (mesmo padrão de `app/api/analyze`: `/v1/responses` + `json_schema`), analisando uma amostra das conversas reais do período (capada em caracteres/conversas) e citando o `conversationId` de cada erro/oportunidade perdida ("Ver conversa" abre `/admin/chat?client=`). Cada auditoria é salva permanentemente (`attendance_audits`, nunca recalculada); a próxima sugere automaticamente um período sem sobreposição com a última e compara métrica a métrica (melhorou/piorou/manteve, considerando "menor é melhor" para tempo de resposta) e qualitativamente via IA.
- **Arquivos:** `lib/attendance-audit.js`, `app/api/admin/desempenho/auditoria/route.js`, `app/admin/desempenho/auditoria/page.jsx`, `components/AttendanceAuditDashboard.jsx`, `components/AdminSectionNav.jsx`, `components/AdminMenu.jsx`, migrations `20260928150000_attendance_audits.sql` e `20260928150500_attendance_audits_evidence_index.sql` (aplicadas em produção).
- **Risco/observação:** **PENDENTE DE VALIDAÇÃO pelo dono** — três definições que inventei por não haver regra existente para elas, marcadas como tal na tela/código, não confirmadas: (1) "prospecções respondidas/taxa de resposta" = conversas cuja primeira mensagem do período foi do corretor e que depois receberam qualquer resposta do cliente (proxy — não cruza com `prospecting_history`/Meta Diária); (2) "conversas sem continuidade" = conversas do corretor com `last_message_direction='inbound'` e status ≠ finalizado (reaproveita a mesma coluna do filtro "Sem resposta" do Chat, mas o recorte para "sem continuidade" é meu); (3) preço de US$0,40/US$1,60 por milhão de tokens (gpt-4.1-mini) usado só para registrar em `ai_usage_log` é estimado, não confirmado como tarifa atual da OpenAI. Sem `OPENAI_API_KEY` configurada, a auditoria ainda salva as métricas objetivas, com a seção de IA vazia e um aviso. Não testado com dado real em produção (sem sessão de navegador autenticada disponível nesta tarefa) — só build local.
- **Autor:** Codex

### 2026-09-27 — Card do cliente reflete atendimento real do Chat no "Último contato"
- **Data:** 2026-09-27 · **Área:** Clientes · **Motivo:** pedido do dono (card mostrava "Nenhum contato realizado" para cliente com conversa ativa no Chat, com respostas reais do corretor).
- **Alteração:** a lista de clientes (`listSimulationClientsPage`) agora usa, para o RÓTULO exibido no card, o mais recente entre `simulation_registrations.last_whatsapp_contact_at` (clique de "abrir WhatsApp") e `whatsapp_conversations.last_human_reply_at` (resposta humana real registrada no Chat, ver P-11 em `SYSTEM_ARCHITECTURE.md`). Só ajusta a exibição — nenhuma escrita na coluna original.
- **Arquivos afetados:** `lib/simulation-list-query.js`.
- **Risco/observação:** deliberadamente **não** alterei `last_whatsapp_contact_at` em si nem as regras que dependem do valor bruto dessa coluna (gatilho `no_first_contact`, redistribuição round-robin ROL-4, Meta Diária/ranking) — continuam vendo o cliente como "sem contato" para fins de automação/pontuação mesmo quando o card já mostra a data real. Isso é intencional (evita inflar pontuação por uma resposta no Chat) mas é um gap conhecido: o cliente pode aparecer com data recente no card e ainda assim ser redistribuído/alertado como "sem 1º contato". Não corrigido agora por estar fora do pedido; candidato a tarefa futura se o dono confirmar que quer unificar os dois sinais. P-11 em `SYSTEM_ARCHITECTURE.md` deveria ser atualizado para citar esta correção parcial.
- **Autor:** Codex

### 2026-09-28 — Destaques do ranking semanal e diário
- **Data:** 2026-09-28 · **Área:** Ranking / Banco · **Motivo:** pedido do dono.
- **Alteração:** congela o Melhor da Semana anterior às 00:01 de segunda-feira em `crm_settings` e exibe semanal, diário e posição/pontos próprios nessa ordem; esconde a posição quando o usuário é líder do dia. Usa cálculo, desempate e permissões já existentes.
- **Arquivos:** `lib/weekly-ranking.js`, `lib/weekly-ranking-period.mjs`, `lib/performance-overview.js`, `components/TopRankingBadge.jsx`, rotas de top-ranking e cron, migration `20260928001400_weekly_ranking_cron.sql`, `docs/BUSINESS_RULES.md`, `docs/DATABASE.md`.
- **Risco/observação:** cron depende da migration aplicada; sem ela, o primeiro acesso após 00:01 consolida o mesmo resultado. Sem mutação em pontuação/histórico. Ainda não aplicado em produção.
- **Autor:** Codex

### 2026-09-27 — Novo formulário leva o card ao topo sem perder histórico
- **Data:** 2026-09-27 · **Área:** Clientes / Banco · **Motivo:** pedido do dono.
- **Alteração:** reenvio da simulação ou Atendimento Rápido marca a data do novo formulário, ordena o mesmo card no topo da aba/filtro e registra o evento na timeline. A data original, responsável, origem e histórico são preservados; edição interna não altera a ordem.
- **Arquivos:** `lib/simulation-registrations.js`, `lib/simulation-list-query.js`, `components/AdminSimulationList.jsx`, `components/ClientJourneyActions.jsx`, migration `20260927235741_client_last_form_submission.sql`, `docs/BUSINESS_RULES.md`, `docs/DATABASE.md`.
- **Risco/observação:** a migration precisa ser aplicada antes do deploy do código; na aba "Todos", "Tentando contato" permanece por último salvo quando houve novo formulário. Sem teste real de formulário em produção.
- **Autor:** Codex

### 2026-09-27 — Reações e respostas específicas no Chat
- **Data:** 2026-09-27 · **Área:** WhatsApp (Chat) · **Motivo:** pedido do dono.
- **Alteração:** mostra reações na mensagem original, permite reagir/remover reação e responder citando mensagens do cliente no CRM. Reação não aumenta não lidas nem muda o atendimento.
- **Arquivos:** `lib/whatsapp-chat.js`, `lib/whatsapp-master.js`, `lib/whatsapp-reactions.mjs`, `components/WhatsappChat.jsx`, rotas `app/api/admin/whatsapp-chat/conversations/[id]/messages` e `reactions`, `tests/whatsapp-reactions.test.mjs`, `docs/WHATSAPP.md`.
- **Risco/observação:** sem alteração no banco; o envio real depende das regras da Meta (incluindo validade da mensagem alvo). Sem envio de teste para cliente real.
- **Autor:** Codex

### 2026-09-27 — Chat: mudar status do cliente direto no painel do contato
- **Data:** 2026-09-27 · **Área:** WhatsApp (Chat) · **Motivo:** pedido do dono.
- **Alteração:** admin/gestor mudam o status do cliente num seletor no painel "Informações do contato", chamando o mesmo `PATCH /api/simulation-registrations/[id]` do card em Clientes — reflete nos dois lugares, sem endpoint novo.
- **Arquivos:** `components/WhatsappChat.jsx`, `docs/WHATSAPP.md`.
- **Autor:** Claude (agente)

### 2026-09-27 — Ícone do app: confirmado que é limitação do iOS, não do código (diagnóstico removido)
- **Data:** 2026-09-27
- **Área:** WhatsApp (Chat) / PWA
- **Alteração:** diagnóstico ao vivo (rota `admin/tmp-badge-debug` + tabela `tmp_badge_debug`, temporários) confirmou no aparelho real do dono que `navigator.setAppBadge`/`self.navigator.setAppBadge` sempre resolvem com sucesso — nas duas camadas (app aberto e push com o app fechado), contagem certa a cada mudança (0→1→2→3→4→0 acompanhando mensagens novas e leitura) — mas o iOS 18.7 nem sempre pinta o número no ícone da tela de início. Removido o diagnóstico (rota, tabela, trechos extras); mantido só o `setAppBadge`/`clearAppBadge` de sempre.
- **Motivo:** o dono testou no iPhone duas vezes e o ícone não mudou; era preciso saber se era bug nosso ou do aparelho.
- **Arquivos afetados:** `app/api/admin/tmp-badge-debug/route.js` (removido), `components/useWhatsappChatSummary.js`, `public/sw.js`, `docs/WHATSAPP.md`.
- **Risco/observação:** nenhuma mudança de comportamento — só limpeza do diagnóstico. Conclusão: limitação confirmada do WebKit/iOS para a Badging API em apps instalados via "Adicionar à Tela de Início", fora do controle do código desta aplicação; documentado para não reabrir a investigação à toa numa próxima vez. Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-27 — Chat: liberar conversa devolve o cliente à roleta; seletor mostra quem está online
- **Data:** 2026-09-27
- **Área:** WhatsApp (Chat) / Roleta
- **Alteração:** escolher "Ninguém (liberar)" no Chat agora também devolve o cliente vinculado à roleta por presença (exclui o corretor atual da escolha; sem ninguém elegível, só libera). O seletor "Atribuir conversa a" mostra 🟢 antes do nome de quem está online agora.
- **Motivo:** pedido do dono (2026-09-27).
- **Arquivos afetados:** `lib/whatsapp-chat.js` (`assignChatConversation`, `listChatBrokers`), `components/WhatsappChat.jsx`, `docs/BUSINESS_RULES.md` (ROL-8).
- **Risco/observação:** reaproveita `assignRoundRobinLead`/`recordLeadDistributionHistory` (`lib/lead-distribution.js`), já usados pela roleta de lead novo — nenhuma lógica de escolha nova. Reatribuição roda com `auth=null` (ação do sistema, mesmo padrão de `reassignOrphanedClientsToOwner`), então não fica marcada como transferência manual de ninguém. Melhor esforço: erro na roleta nunca impede de liberar a conversa. Sem migration. Não validado com `next build` local.
- **Autor:** Claude (agente)
- **Data:** 2026-09-27
- **Área:** WhatsApp (Fluxos) — motor central e editor visual
- **Alteração:** o dono apontou (com razão) que o bloco reaproveitado como "confirmação" ainda aparecia no mapa como uma SEGUNDA pergunta idêntica logo após o Gatilho, dando a entender que o cliente responderia duas vezes — mesmo já não sendo reenviada de fato (entrada anterior, `initialText`). Criado o bloco **"mensagem externa"** (`data.external = true`, continua `type: "message"`): representa no mapa a mensagem que JÁ foi enviada por fora (o modelo do Disparo, com os mesmos botões e o texto real) — o fluxo nunca a envia; só direciona pelo clique (`initialText`) ou, sem correspondência, segue pela porta "Outra resposta" até uma pergunta de verdade. `validateGraph` agora **exige** essa ligação quando `external = true`. Aparência distinta no editor (ícone de cadeado, cor cinza, "🔒 Modelo já enviado pelo Disparo:" no resumo) e um alternador no painel do bloco (visível em botões/lista) para qualquer fluxo futuro usar. O Fluxo "Disparo diário — resposta ao contato" foi reconstruído: a mensagem externa (com o texto real do modelo, colado igual ao que o dono está enviando à Meta) fica logo após o Gatilho; a pergunta de verdade ("ask") só é enviada se o clique não bater com nenhum botão.
- **Motivo:** pedido do dono — o mapa precisava mostrar a mensagem real do disparo (com 3 botões) como a primeira caixa, não uma pergunta repetida.
- **Arquivos afetados:** `lib/whatsapp-flow-core.mjs` (`defaultNodeData`, `validateGraph`, `runFlow`/`isExternalChoice`), `components/flows/flow-ui.js` (`NODE_META.external`, `nodeSummary`), `components/flows/FlowCanvas.jsx` (`NodeCard`, `headerLabel`), `components/flows/FlowNodePanel.jsx` (alternador em `MessageForm`), `tests/whatsapp-flow-core.test.mjs` (5 testes novos); linha em `whatsapp_flows` (graph reconstruído direto via SQL, id `346c9033-a2db-4d36-aefd-0d66b35095eb`); `docs/WHATSAPP.md`.
- **Risco/observação:** mudança no motor CENTRAL — afeta a validação/execução de QUALQUER fluxo, mas só quando `data.external` é usado (novo, opt-in; nenhum fluxo existente tinha esse campo, comportamento deles é idêntico a antes). Suíte completa de testes puros roda 31/32 (a 1 falha é a P-15 já conhecida, sem relação). Continua sem ativar — falta o modelo ser aprovado e o dono escolher a Rotina no gatilho.
- **Autor:** Claude Code

### 2026-09-27 — Ícone do app mostra o número de mensagens não lidas do Chat
- **Data:** 2026-09-27
- **Área:** WhatsApp (Chat) / PWA
- **Alteração:** o ícone do app na tela inicial do celular passa a mostrar o número de não lidas do Chat (Badging API), o mesmo já exibido no menu. Com o app aberto, o hook do resumo do Chat atualiza o ícone a cada mudança. Com o app fechado, cada mensagem nova de cliente numa conversa **já atribuída** a alguém dispara um push com o total atual de não lidas, e o service worker atualiza o ícone a partir dele.
- **Motivo:** pedido do dono, a partir do exemplo do "Gerenciador de Anúncios" (ícone com bolinha vermelha "2").
- **Arquivos afetados:** `components/useWhatsappChatSummary.js`, `public/sw.js`, `lib/whatsapp-chat.js` (`getUnreadMessageCountForBroker`, `projectChatFromEvents`), `docs/WHATSAPP.md`.
- **Risco/observação:** conversa sem atendente ainda (recém-criada pela roleta) não dispara push nesta primeira versão — só quem já está atribuído (`assigned_user_id`) é avisado; a contagem mostrada, porém, já soma também conversas de clientes por quem o corretor responde (mesma regra do menu). Suporte do navegador: iOS 16.4+ só com o app adicionado à Tela de Início (não numa aba comum), Android/desktop com Chrome instalado; sem suporte, não faz nada (sem erro). Sem migration. Não testado num aparelho real (sem ambiente de push aqui); não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-27 — Motor de Fluxos: clique no botão do modelo de Disparo pula a pergunta (initialText)
- **Data:** 2026-09-27
- **Área:** WhatsApp (Fluxos) — motor central
- **Alteração:** o dono apontou corretamente que o Fluxo "Disparo diário — resposta ao contato" (entrada anterior abaixo) reperguntava as 3 opções mesmo quando o cliente já tinha clicado um botão do modelo. Causa: `campaign_reply` só sabe SE o telefone recebeu a campanha, não IMPORTA qual botão foi tocado — o texto do clique nunca chegava ao motor. Correção: `startSession`/`executeSession` (`lib/whatsapp-flows.js`) passam o texto que casou o gatilho para `runFlow({..., initialText})` (`lib/whatsapp-flow-core.mjs`); se o primeiro bloco de escolha do caminho, numa sessão que está começando, tiver uma opção com esse MESMO texto, a conversa já entra direto por ali — sem reenviar a mensagem. Só vale no arranque (uma tentativa, nunca numa resposta em andamento). Também corrigidos os textos dos 3 botões do Fluxo (id `346c9033-a2db-4d36-aefd-0d66b35095eb`) para baterem exatamente com os que o dono está enviando à Meta ("Quero atualizar" / "Tenho restrição" / "Não tenho interesse", sem emoji — antes estavam com emoji e "Sem interesse").
- **Motivo:** pedido do dono — o disparo já tem os 3 botões, não faz sentido perguntar de novo.
- **Arquivos afetados:** `lib/whatsapp-flow-core.mjs` (`runFlow`, novo `findOptionPortByText`/log `auto_route`), `lib/whatsapp-flows.js` (`startSession`, `executeSession`, `processFlowInbound`), `tests/whatsapp-flow-core.test.mjs` (3 testes novos); linha em `whatsapp_flows` (graph atualizado direto via SQL); `docs/WHATSAPP.md`.
- **Risco/observação:** mudança no motor CENTRAL de Fluxos — afeta toda sessão nova de qualquer fluxo, não só este. Comportamento antigo preservado por design: só age quando o texto bate EXATAMENTE com uma opção do primeiro bloco de escolha alcançado; sem correspondência, envia a mensagem normalmente (nada muda para "Menu principal", "Anúncio", "Formulário concluído" — confirmado rodando a suíte completa de testes puros, 56/57 passam, a 1 falha é a P-15 já conhecida, sem relação). Continua sem ativar o Fluxo do disparo — falta o modelo ser aprovado e o dono escolher a Rotina no gatilho.
- **Autor:** Claude Code

### 2026-09-27 — Fluxo "Disparo diário — resposta ao contato" (rascunho)
- **Data:** 2026-09-27
- **Área:** WhatsApp (Fluxos) / Banco
- **Alteração:** criado o Fluxo **"Disparo diário — resposta ao contato"** (gatilho `campaign_reply`, `campaignSource` vazio de propósito), em **rascunho**, para quem responde ao disparo diário com 3 botões (Quero atualizar / Tenho restrição / Sem interesse): confirma a escolha (o clique no botão do TEMPLATE só abre a sessão — o texto daquele clique não chega ao fluxo, então ele reapresenta as mesmas 3 opções, já dentro da conversa), com um lembrete em 1h se não responder. "Quero atualizar" → `base_roulette` + link de simulação direto + handoff. "Tenho restrição" → `base_roulette` + explica a Blindagem Financeira (mesmo tom do Guia de Atendimento: nunca promete prazo/resultado) + pergunta se quer falar com corretor. "Sem interesse" → encerra educadamente, **sem** criar cliente nem sortear corretor. Resposta fora das 3 opções: repete 2x, depois passa para um humano (mecanismo já nativo do motor de Fluxos).
- **Motivo:** pedido do dono, a partir do texto final do modelo que ele vai enviar para aprovação da Meta.
- **Arquivos afetados:** linha nova em `whatsapp_flows` (inserida direto via SQL, id `346c9033-a2db-4d36-aefd-0d66b35095eb`, status `draft`); nenhum arquivo de código (reaproveita 100% o motor de Fluxos já existente — nenhuma mudança no `lib/whatsapp-flow-core.mjs`/`lib/whatsapp-flows.js`).
- **Risco/observação:** **não ativado.** Falta, para ativar: (1) o modelo ser aprovado pela Meta; (2) o dono escolher a Rotina (ou campanha) no gatilho do Fluxo (`campaignSource`, hoje vazio de propósito); (3) publicar/ativar pelo editor visual. Testado só com o validador puro do motor (`validateGraph`/`validateTrigger`, zero erros) — **não testado num disparo real ainda**.
- **Autor:** Claude Code

### 2026-09-27 — Modelo do Disparo aceita até 3 botões de resposta rápida
- **Data:** 2026-09-27
- **Área:** WhatsApp (Disparo/Templates)
- **Alteração:** `createWhatsappMessageTemplate`/`createAndSubmitTemplate` passam a aceitar `quickReplyButtons` (até 3 textos, ≤ 20 caracteres cada) — alternativa ao botão de link único que já existia; os dois são mutuamente exclusivos (a Meta não mistura tipos no mesmo componente `BUTTONS`). O formulário "Novo template" do Disparo ganhou o campo correspondente.
- **Motivo:** pedido do dono — construir um modelo de disparo com 3 caminhos (interesse / restrição / sem interesse) para alimentar um Fluxo de resposta.
- **Arquivos afetados:** `lib/whatsapp-master.js`, `lib/whatsapp-broadcasts.js`, `components/WhatsappDisparoManager.jsx`; `docs/WHATSAPP.md`.
- **Risco/observação:** nenhuma regra de envio existente mudou; templates já criados com botão de link continuam funcionando igual.
- **Autor:** Claude Code

### 2026-09-27 — Faxina de nomes, parte 5: capitalização padronizada (só a 1ª letra de cada palavra)
- **Data:** 2026-09-27
- **Área:** Prospecção / Banco
- **Alteração:** `name` de `prospecting_contacts` padronizado para só a primeira letra de cada palavra maiúscula (ex.: `"GENI CARDOSO"` → `"Geni Cardoso"`, `"joão"` → `"João"`). Diferente do `initcap()` pronto do Postgres, preposição de nome brasileiro (`de`, `da`, `do`, `das`, `dos`) e o `e` de ligação ficam minúsculos quando não são a primeira palavra (`"SONIA MARIA ROSA DA SILVA"` → `"Sonia Maria Rosa da Silva"`, não `"Da Silva"`). Só letra é tocada — número, símbolo, espaço e barra ficam onde estavam.
- **Motivo:** pedido do dono (2026-09-27): "todos devem ser padrão, só a primeira letra maiúscula".
- **Arquivos afetados:** `supabase/migrations/20260927160000_prospecting_names_titlecase.sql` (novo, função criada e removida dentro da própria migration).
- **Risco/observação:** 3.640 linhas alteradas (revisão por amostragem de 60+ casos antes de aplicar, nenhum problema encontrado); também unificou variantes antigas de "Sem Nome" (`"Sem nome"`, `"SEM NOME"`) para o texto canônico. Sobraram 14 nomes de uma letra só (`"A"`, `"S"`, `"F3R"`...) sem diferença possível de capitalização — fora do escopo deste pedido, não mexidos. Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-27 — Faxina de nomes, parte 3: acentuação corrompida corrigida à mão (mojibake)
- **Data:** 2026-09-27
- **Área:** Prospecção / Banco
- **Alteração:** ~65 nomes com acentuação corrompida na importação (ex.: `"Tã¢Nia Fetchir"` → `"Tânia Fetchir"`, `"Jos? Carlos Lima Pinto"` → `"José Carlos Lima Pinto"`) e "?" puramente decorativo (ex.: `"Carol ?"` → `"Carol"`) corrigidos **um a um, lidos manualmente** (não por fórmula — testei a reversão matemática Latin1↔UTF8 e ela falha por byte inválido numa parte dos casos, avisei o dono antes de aplicar). 6 nomes que não eram nome nenhum (link do Facebook, texto só de símbolo, letra solta) viraram `"Sem Nome"`.
- **Motivo:** continuação da faxina de nomes, pedido do dono (2026-09-27), com confirmação explícita da lista antes de gravar.
- **Arquivos afetados:** `supabase/migrations/20260927140000_prospecting_names_mojibake.sql` (novo, 31 correções + 2 "Sem Nome"), `supabase/migrations/20260927150000_prospecting_names_mojibake_2.sql` (novo, 27 correções + 4 "Sem Nome" — inclui 1 nome que tinha ficado de fora da primeira lista por engano, achado ao conferir o resultado).
- **Risco/observação:** cada migration só atualiza por igualdade EXATA do texto corrompido lido — rodar de novo não faz nada. Ficaram de fora, de propósito: `"Gabriel??Mobilemaker|Gerenc. Ads??"` (nome + tag de negócio colados) e `"Morena Flor R.B.N.L.C?X"` (sigla ilegível). Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-27 — Faxina de nomes, parte 2: código de imóvel/importação grudado no nome
- **Data:** 2026-09-27
- **Área:** Prospecção / Banco
- **Alteração:** removido sufixo de código grudado ao nome (1-3 letras + 3-7 dígitos, ex.: `"Suellen/Ca6908"` → `"Suellen"`, `"Rafael Ba0069"` → `"Rafael"`) e número solto no final (ex.: `"Dirce Batista 998767789"` → `"Dirce Batista"`, `"Milena Pereira 500 Reais"` → `"Milena Pereira"`).
- **Motivo:** continuação da faxina de nomes (pedido do dono, 2026-09-27); na entrada anterior este caso tinha ficado fora do escopo por precaução, mas ao olhar os dados reais o padrão se mostrou bem definido e seguro de corrigir.
- **Arquivos afetados:** `supabase/migrations/20260927130000_prospecting_names_code_suffix.sql` (novo), `docs/BUSINESS_RULES.md` (PRO-4c).
- **Risco/observação:** 273 linhas alteradas (261 do padrão letra+dígitos, 12 de número solto), conferidas uma a uma antes de aplicar. Ainda fora do escopo: duas pessoas juntas por `/`/`&`/`|` e "mojibake" (acentuação corrompida) — essa última se mostrou mais difícil do que o esperado: a reversão matemática simples (Latin1↔UTF8) falha por byte inválido em parte dos casos; a correção precisaria ser lida caso a caso (~30 nomes), não aplicada por fórmula. Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-27 — Faxina de nomes na base de Prospecção; sem nome nunca sorteado em campanha
- **Data:** 2026-09-27
- **Área:** Prospecção / Disparo / Banco
- **Alteração:** contato sem nome de verdade (nenhuma letra, ou "nome" é um e-mail) → `"Sem Nome"`; símbolo puramente decorativo removido de quem sobra letra (ex.: `"***Talita Dna"` → `"Talita Dna"`, `"## Cláudio ##"` → `"Cláudio"`); pequeno dicionário de apelidos sem ambiguidade corrigido (ex.: `"Zé"` → `"José"`, `"Cadu"` → `"Carlos Eduardo"`). `pick_broadcast_base_contacts` (usada pelo sorteio manual e pela rotina diária de Disparo) passa a excluir quem não tem nome de verdade.
- **Motivo:** pedido do dono (2026-09-27), a partir de exemplos reais na Base da Imobiliária (`"***Talita Dna"`, `"## Cláudio ##"`, `"°#Y_Maiel#°"`, contatos com nome só de símbolo).
- **Arquivos afetados:** `supabase/migrations/20260927120000_prospecting_names_cleanup.sql` (novo), `docs/BUSINESS_RULES.md` (PRO-4c).
- **Risco/observação:** 2907 linhas de `prospecting_contacts` alteradas (2841 → `"Sem Nome"`; 59 com símbolo removido; 19 apelidos corrigidos), conferidas uma a uma antes de aplicar. **Fora do escopo, por risco de dano maior que o ganho** (não corrigido, fica para decisão futura do dono): 228 contatos com dígito colado ao nome (ex. `"Afonso/Ba0445"`), nomes de duas pessoas juntos por `/`/`&`/`|` (ex. `"Marcos Roberto Martins/Rute"`), e "mojibake" — acentuação corrompida na importação (ex. `"Jos? Carlos"`, `"Andrã?Ia"`) — problema de codificação de caractere, não de símbolo decorativo; remover o "?" destruiria a letra perdida. Não altera `queue_sort_at` (ordem de reserva da Meta Diária) nem nenhuma outra coluna. Não validado com `next build` local (sem `node_modules` na máquina).
- **Autor:** Claude (agente)

### 2026-09-27 — Disparos vira aba própria; WhatsApp Manual removido
- **Data:** 2026-09-27
- **Área:** WhatsApp (Automações) / Banco
- **Alteração:** o Disparo (`WhatsappDisparoManager`, com suas 5 abas: Nova campanha, Templates, Histórico, Gastos, Desempenho) saiu de dentro de "WhatsApp Master" e virou aba própria "Disparos" em Automações (`?tab=disparos`, antes `whatsapp-manual`). "WhatsApp Master" ficou só com conexão, foto/perfil, respostas por palavra-chave e o inbox de eventos. O módulo **WhatsApp Manual foi removido por completo** (pedido do dono, não usava mais): tela, as 3 rotas (`manual-log`, `manual-templates`, `manual-summary`), `lib/whatsapp-manual-summary.js` e a tabela `whatsapp_manual_log` (com o histórico de cliques) e a configuração `crm_settings.whatsapp_manual_templates`.
- **Motivo:** pedido do dono — a aba WhatsApp Master estava "muito bagunçada e poluída" com o Disparo empilhado dentro dela, e o WhatsApp Manual não era mais usado.
- **Arquivos afetados:** `app/admin/automacoes/page.jsx`; removidos `components/WhatsappManualSender.jsx`, `lib/whatsapp-manual-summary.js`, `app/api/admin/whatsapp-master/manual-{log,templates,summary}/route.js`; `supabase/migrations/20260927120000_drop_whatsapp_manual.sql` (**aplicada em produção**: apagou a tabela e a configuração); `docs/BUSINESS_RULES.md` (AUT-7), `docs/WHATSAPP.md`, `docs/CRM_CONTEXT.md`, `docs/DATABASE.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/PERMISSIONS.md`.
- **Risco/observação:** o histórico de "quem clicou em abrir o WhatsApp manualmente" foi apagado de vez (o dono pediu explicitamente, não só ocultar). Nenhuma regra de negócio do Disparo, Fluxos ou Chat mudou — só reorganização de tela.
- **Autor:** Claude Code

### 2026-09-26 — Chat baixa imagens, documentos e vídeos recebidos (antes só áudio)
- **Data:** 2026-09-26
- **Área:** WhatsApp (Chat)
- **Alteração:** imagem, documento, vídeo e figurinha recebidos passam a ser baixados da Meta e guardados no bucket privado `whatsapp-inbound-media` (como o áudio). No Chat: imagem com "Baixar", documento com nome/tamanho + "Abrir"/"Baixar" (nome original), vídeo com player. A rota `GET /api/admin/whatsapp-chat/media/[messageId]` (mesma permissão da conversa) entrega áudio em bytes e as demais mídias por redirecionamento a um link temporário (5 min); `?download=1` salva com o nome original; `?retry=1` tenta de novo. `POST .../media/recover` (admin/gestor) recupera as mídias dos últimos 14 dias.
- **Motivo:** urgente — cliente enviou a documentação pelo Chat e só aparecia "[Documento] — abra no WhatsApp".
- **Arquivos afetados:** `lib/whatsapp-media.js`, `lib/whatsapp-media-utils.mjs`, `lib/whatsapp-chat.js`, `lib/whatsapp-master.js`, `app/api/admin/whatsapp-chat/media/**`, `components/WhatsappChat.jsx`, `tests/whatsapp-media-utils.test.mjs`.
- **Risco/observação:** "Mensagem não suportada" (tipo `unsupported`, erro 131051 da Meta) não traz arquivo: não há o que baixar; a tela agora explica. Limite de 16 MB por arquivo. Docs (`WHATSAPP.md` §6 ainda diz que só áudio é baixado) **A SINCRONIZAR**.
- **Autor:** Claude Code

### 2026-09-26 — Disparo: Gastos, Desempenho e Chat > Campanhas
- **Data:** 2026-09-26
- **Área:** WhatsApp (Disparo / Chat) / Banco
- **Alteração:** novas abas **Gastos** (campanha, tipo, enviadas, custo por envio e total; tabela de preços editável) e **Desempenho** (funil enviadas→entregues→lidas→responderam→cadastros, custo por conversa e por cadastro, por campanha e por modelo) no Disparo; aba **Campanhas** no Chat (admin/gestor). O webhook passou a gravar `billable`/`pricing_category` dos eventos de status do Disparo.
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `supabase/migrations/20260926120000_whatsapp_broadcast_costs.sql` (**aplicada em produção em 2026-09-26**: 2 colunas, 1 linha em `crm_settings`, 3 funções), `lib/whatsapp-broadcast-finance.js` (novo), `lib/whatsapp-broadcasts.js` (`getBroadcastDetail` + respostas), `lib/whatsapp-master.js` (`syncBroadcastMessageStatuses`), `app/api/admin/whatsapp-broadcasts/finance/route.js` (novo), `components/WhatsappDisparoInsights.jsx`/`WhatsappChatCampaigns.jsx` (novos), `WhatsappDisparoManager.jsx`, `WhatsappChat.jsx`; `docs/WHATSAPP.md`, `docs/DATABASE.md`.
- **Risco/observação:** valores em R$ por categoria são **estimados** (A CONFIRMAR com a fatura Meta); a Meta não informa o valor em reais por evento. Resposta = 1ª mensagem recebida em até 7 dias (um contato que recebe dois disparos no período conta nos dois). Nenhuma regra de envio foi alterada.
- **Autor:** Claude Code

### 2026-09-26 — Formulário completa o card do WhatsApp em vez de duplicar
- **Data:** 2026-09-26
- **Área:** Clientes / WhatsApp
- **Alteração:** `findMatchingRegistration` passou a considerar TODOS os cadastros do mesmo telefone (não só o mais recente). Formulário de link (completo e Atendimento Rápido): (1) completa o card criado pelo WhatsApp que ainda não tem simulação, mesmo que o link seja de outro corretor (mantém o responsável); (2) com link pessoal, prefere o cadastro do mesmo corretor do link. Novo campo `acquisitionKind` no cadastro (só o tipo da origem).
- **Motivo:** bug reportado pelo dono — cliente veio do anúncio (card C3494), preencheu o formulário e gerou outros cards (C3495 e C3501, mesmo telefone). Causa: o card do Chat já tinha sido transferido a outro corretor, e a regra "link de outro corretor = atendimento novo" combinada com a busca só pelo cadastro mais recente criou duplicatas.
- **Arquivos afetados:** `lib/simulation-registrations.js`; `docs/BUSINESS_RULES.md` (CLI-4).
- **Risco/observação:** só previne novas duplicidades; os 3 cards já existentes daquele telefone **não foram mesclados** (mesclar exige decidir o que manter). Exceção "link de outro corretor abre atendimento novo" continua valendo quando o outro cadastro já tem simulação preenchida.
- **Autor:** Claude Code

### 2026-09-26 — Novo cabeçalho da conversa no Chat
- **Data:** 2026-09-26
- **Área:** WhatsApp (Chat) — visual
- **Alteração:** cabeçalho reorganizado em camadas (nome sem telefone + janela de 24 h + status do card; corretor e sinais numa linha; "Assumir atendimento" em faixa larga no celular). "Finalizar/Reabrir" e "Excluir conversa" passaram para o menu "⋯". O selo "Cliente sem responder há X" agora diz "Cliente em silêncio há X".
- **Motivo:** pedido do dono — nome e selos ficavam cortados no celular.
- **Arquivos afetados:** `components/WhatsappChat.jsx`, `components/WhatsappChatBadges.jsx`; `docs/WHATSAPP.md`.
- **Risco/observação:** só visual; rotas, permissões e regras inalteradas. Finalizar ficou 1 toque mais longe (decisão do dono pode reverter).
- **Autor:** Claude Code

### 2026-09-26 — Prospecção: contatos sem nome vão para o final da fila
- **Data:** 2026-09-26
- **Área:** Prospecção
- **Alteração:** na lista da aba Prospecção (Base da Imobiliária, Minha Base e visão do dono), contatos sem nome (“Sem nome”, telefone no lugar do nome, “.”, letra solta…) aparecem depois dos que têm nome, mantida a ordem dentro de cada grupo.
- **Motivo:** pedido do dono (2026-09-26).
- **Arquivos afetados:** `lib/prospecting-queue-order.mjs` (novo), `lib/prospecting.js`, `tests/prospecting-queue-order.test.mjs` (novo), `docs/BUSINESS_RULES.md` (PRO-4b).
- **Risco/observação:** só a ordem da lista na tela; a fila FIFO que a Meta Diária usa para reservar contatos (`queue_sort_at`) não mudou. Nenhum dado nem migration. Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-26 — Novo status “Atendimento automático” para cliente do WhatsApp sem formulário
- **Data:** 2026-09-26
- **Área:** WhatsApp / Funil / Banco
- **Alteração:** novo status `automated_service` (“Atendimento automático”): o cliente criado pelo WhatsApp (roleta) sem formulário preenchido nasce nele, não em “Aguardando simulação”; corretor responde no Chat → “Em atendimento”; preenche o formulário → “Aguardando simulação” (já existia). Chat: contato de conversa já assumida e conversa adicionada ao CRM sem formulário já ficam “Em atendimento”. Aparece na aba Atendimento; é status ativo.
- **Motivo:** pedido do dono (2026-09-26): sem formulário preenchido o status não pode ser “Aguardando simulação”.
- **Arquivos afetados:** `supabase/migrations/20260926140000_client_status_automated_service.sql` (novo), `lib/client-status.js`, `lib/client-status-history.js`, `lib/whatsapp-client-status-core.mjs`, `lib/whatsapp-client-status.js`, `lib/whatsapp-chat.js`, `lib/simulation-registrations.js`, `components/AdminSimulationList.jsx`, `tests/whatsapp-client-status.test.mjs`, `docs/BUSINESS_RULES.md` (WA-9), `docs/WHATSAPP.md`, `docs/CRM_CONTEXT.md`, `docs/DATABASE.md`.
- **Risco/observação:** migration em 3 partes (restrições → deploy → função da roleta + correção de 8 clientes reais). Sem tela pública própria: a Minha Jornada cai no texto padrão. Ranking: “Em atendimento” automático credita o ponto de atendimento ao corretor responsável (uma vez por cliente) — **confirmar com o dono**. O teste do Fluxo “Menu principal” continua falhando (P-15, anterior a esta mudança). Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-25 — Chat muda o status do cliente sozinho (Tentando contato / Em atendimento)
- **Data:** 2026-09-25
- **Área:** WhatsApp / Funil
- **Alteração:** mensagem enviada por uma pessoa no Chat move o cliente de “Aguardando simulação” para “Tentando contato”; resposta do cliente move de “Tentando contato” para “Em atendimento” (só se tem corretor responsável). Só para frente; grava histórico de status (`source = whatsapp_chat`).
- **Motivo:** pedido do dono (2026-09-25).
- **Arquivos afetados:** `lib/whatsapp-client-status-core.mjs` (novo), `lib/whatsapp-client-status.js` (novo), `lib/whatsapp-chat.js`, `tests/whatsapp-client-status.test.mjs` (novo), `docs/WHATSAPP.md` (§6), `docs/BUSINESS_RULES.md` (WA-9).
- **Risco/observação:** afeta funil/pontuação: “Em atendimento” automático credita o ponto de atendimento ao corretor responsável (uma vez por cliente) e converte a rodada da Meta Diária desse cliente — **confirmar com o dono** se quer o crédito assim ou como “sistema” (0 ponto). Não retroage (só mensagens novas). Sem migration. Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-25 — Detalhe do corretor (dono): quanto falta em cada tentativa e nos pendentes
- **Data:** 2026-09-25
- **Área:** Meta Diária (visão do dono)
- **Alteração:** ao abrir “Desempenho de hoje” de um corretor: bloco “O que falta para bater a meta” (prospecção e pendentes, com onde falta), cada tentativa mostra “X de Y contatos” + quanto falta, e lista dos clientes pendentes ainda não resolvidos (nome, código, dias sem contato, até 30). Só para o dia de hoje; outros períodos ficam como antes.
- **Motivo:** pedido do dono (mais texto no detalhe e saber o que falta para concluir a meta).
- **Arquivos afetados:** `components/TeamDailyPerformance.jsx`, `lib/daily-goal.js` (`getOwnerBrokerDailyDetail`), `lib/daily-goal-wallet.js` (`stages`), `lib/daily-goal-pending.js` (`withClients`), `lib/daily-goal-progress.mjs` (`dayStageBreakdown`), `tests/daily-goal-progress.test.mjs`, `docs/BUSINESS_RULES.md` (MD-8).
- **Risco/observação:** só leitura, sem migration; a lista de pendentes é buscada só ao abrir o detalhe de UM corretor. Com prospecção manual (reivindicações) o “falta” por etapa pode ficar 1 acima do “falta” da prospecção total (cada reivindicação cria uma rodada que ainda não teve a 1ª tentativa). Não validado com `next build` local.
- **Autor:** Claude (agente)

### 2026-09-25 — Correção: meta em 106% no painel, mas Prospecção Extra bloqueada (“51 de 60”)
- **Data:** 2026-09-25
- **Área:** Meta Diária / Prospecção
- **Alteração:** o painel, o fechamento do dia e a liberação da Prospecção Extra passam a usar o mesmo total de prospecção do dia (`loadWalletDayNumbers`: carteira ativa + trabalhados hoje que saíram dela, **encerrados ou convertidos**). O bloqueio da Prospecção Extra libera quando a meta do dia (prospecção + pendentes) chega a 100%. Mensagem do bloqueio atualizada. `getDailyGoalWalletStatus` deixou de devolver `completedToday`/`requiredToday`/`extraUnlocked` (sem nenhum consumidor).
- **Motivo:** bug reportado pelo dono: Jennyfer com 51 tentativas aparecia com 106% (meta 45) e ao tentar prospectar via “51 de 60”. Causa: o total do painel ignorava rodadas convertidas hoje e o bloqueio usava outra conta (cota nominal + rodadas carregadas, incluindo contatos fechados por outro caminho sem tentativa dela).
- **Arquivos afetados:** `lib/daily-goal-wallet.js`, `lib/daily-goal-progress.mjs` (`walletDayTarget`), `lib/daily-goal.js` (comentário), `lib/prospecting.js` (mensagem), `tests/daily-goal-progress.test.mjs`, `docs/BUSINESS_RULES.md` (MD-5, PRO-2), `.claude/rules/meta-diaria-ranking.md`.
- **Risco/observação:** percentual de quem teve conversões hoje muda (Jennyfer 106% → 100%; Caroline meta 70 → 74). Sem migration. Dias já fechados não foram reprocessados. `getDailyGoalPerformance` (previstas de hoje) passa a usar o mesmo total via `getDailyGoalTarget`. Não validado com `next build` local (sem `node_modules`).
- **Autor:** Claude (agente)

### 2026-09-25 — Meta Diária passa a somar prospecção + clientes pendentes
- **Data:** 2026-09-25
- **Área:** Meta Diária
- **Alteração:** os 100% da meta passam a ser prospecção + pendentes (clientes ativos com +3 dias sem contato e sem atividade futura, congelados no início do dia); depois dos 100% só prospecção excedente soma +1%. Card ganhou `Prospecção x/y` e `Pendentes x/y` (✓ quando concluídos). Vale também no fechamento (`percent`/`goal_met`) e na visão do dono (só hoje). Nova tabela `daily_goal_pending_freeze` e congelamento às 00:10 no cron `daily-goal-close`.
- **Motivo:** pedido do dono (2026-09-25) para a meta incluir os clientes que estão parados.
- **Arquivos afetados:** `lib/daily-goal-progress.mjs`, `lib/daily-goal-pending.js` (novo), `lib/daily-goal.js`, `app/api/cron/daily-goal-close/route.js`, `components/DailyGoalDashboard.jsx`, `tests/daily-goal-progress.test.mjs`, `supabase/migrations/20260925140000_daily_goal_pending_freeze.sql` (novo), `docs/BUSINESS_RULES.md` (MD-8), `docs/DATABASE.md`, `.claude/rules/meta-diaria-ranking.md`.
- **Risco/observação:** a migration `20260925140000` foi aplicada em produção em 2026-09-25 (tabela criada, RLS ligado, sem acesso para anon/authenticated); sem ela o código funcionaria como antes, sem pendentes. Regra confirmada pelo dono em 2026-09-25: prospecção excedente só conta depois de a meta atingir 100% (não “paga” pendente não trabalhado). Não validado com `next build` local (sem `node_modules` na máquina); testes puros passam. Ranking/bônus e `getDailyGoalCompletionStatus` (liberação de prospecção extra) **não** foram alterados.
- **Autor:** Claude (agente)

### 2026-09-26 — Status do card no Chat e cadastro sem dados padrão
- **Data:** 2026-09-26
- **Área:** WhatsApp (Chat) / Clientes
- **Alteração:** (1) o Chat mostra o status do card do cliente na lista, no cabeçalho da conversa e, no painel, se a simulação foi preenchida. (2) Cliente que não preencheu a simulação deixa de exibir dados padrão (nascimento 01/01/1900, "Autônomo sem registro", "Solteiro", "Não", R$ 0) no card expandido, no detalhe do cadastro e na lista de cadastros; aparece o aviso "O cliente ainda não preencheu os dados da simulação".
- **Motivo:** pedido do dono.
- **Arquivos afetados:** `lib/simulation-registration-schema.js` (`hasSimulationData`, `realBirthDate`), `lib/whatsapp-chat.js`, `components/WhatsappChatBadges.jsx`, `components/WhatsappChat.jsx`, `components/AdminSimulationList.jsx`, `components/RegistrationDetails.jsx`, `components/AdminRegistrationList.jsx`; `docs/BUSINESS_RULES.md` (CLI-5b), `docs/WHATSAPP.md`.
- **Risco/observação:** só exibição — banco e regras inalterados (os valores padrão continuam gravados; o critério é nascimento ≠ 1900-01-01 ou renda/recurso > 0). Telas de edição (`SimulationGenerator`, formulários) e o PDF/CCA não foram alteradas.
- **Autor:** Claude Code

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
