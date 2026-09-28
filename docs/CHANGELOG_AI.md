# CHANGELOG_AI — registro de alterações importantes feitas por agentes

### 2026-09-28 — Chat e Base Mestra na análise documental
- **Área:** Documentação, Chat, CCA e PDF.
- **Alteração:** seleção explícita de mensagens e arquivos no Chat para a análise documental existente; regras ativas incorporadas em cada parecer; residência sem boletos; rastreio de pendências; cálculo auditável de renda por três extratos; mensagem de pendências editável no Chat; opções PDF ou pasta ZIP para a CCA, com confirmação de pendências.
- **Permissões:** somente administrador geral edita regras; corretor só acessa o próprio cliente e pode preparar envio para CCA; gestão do cadastro de CCA permanece restrita.
- **Verificação:** 18 testes de regras e build Next.js concluídos. Fluxos externos dependem das credenciais de produção.

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
