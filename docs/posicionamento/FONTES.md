# FONTES — estado das fontes de dados reais (Windsor.ai)

> Memória do agente `marketing-posicionamento`. Atualize a cada verificação (`get_connectors`). Protocolo: `.claude/skills/auditar-posicionamento/references/windsor.md`. Sem tokens ou senhas.

Windsor MCP: **funcionando** (verificado 2026-10-01 pelo conector da conta Claude; plano Basic, pago). Ferramentas de leitura testadas: `get_current_user`, `get_connectors`, `get_options`, `get_fields`, `get_data`. Não existe `get_accounts`: as contas vêm dentro de `get_connectors`. Escrita (`list_actions`/`execute_action`/`upload_files`/`create_*`) **não foi usada**.

Atenção: o servidor `windsor` declarado em `.mcp.json` (login próprio) continua `needs_auth`; a leitura funcionou pelo conector Windsor.ai da conta Claude.

| Fonte | Conectada ao Windsor? | Leitura testada? | Última verificação | Observação |
|---|---|---|---|---|
| Google Business Profile (`google_my_business`) | SIM — conta `locations/11870750752232851669` ("Matheus Machado") | SIM, 2026-10-01 | 2026-10-01 | Diário: impressões (Maps/Search, desktop/mobile), cliques em ligação/site, pedidos de rota. Avaliações: nota média total 5 e 6 avaliações no total (campos `review_average_rating_total`, `review_total_count`). Também expõe posts, mídia, palavras-chave de busca (`search_keyword*`) e atributos do local. Volume baixo nos últimos 30 dias (1–7 impressões/dia, 0 cliques em ligação/site). |
| Meta Ads (`facebook`) — **mídia paga** | SIM — conta `139348312829192` | SIM, 2026-10-01 | 2026-10-01 | É anúncio pago: domínio do `gestor-trafego`, não do posicionamento orgânico. 5 campanhas com gasto nos últimos 30 dias. Inclui conversão personalizada "cadastro_simulação". |
| Google Search Console | NÃO CONECTADO | não | 2026-10-01 | Não aparece em `get_connectors`. Conectar no Windsor (dono, no navegador). |
| Google Analytics 4 | NÃO CONECTADO | não | 2026-10-01 | Idem. |
| Instagram Insights (`instagram`) | SIM — conta `17841410653785252` ("Matheus Machado \| Corretor de imóveis", @mhm.machado), conectada em 2026-10-01 por login Meta do dono; identidade confirmada pelo @ | SIM, 2026-10-01 | 2026-10-01 | Perfil (bio, link, seguidores, nº de posts), diário da conta (alcance, visualizações, contas engajadas, interações, novos seguidores, toques nos links do perfil), por publicação (alcance, visualizações, salvamentos, compartilhamentos, curtidas, comentários, tipo, data, link), stories (só 24h), público (idade, gênero, cidade, país). `profile_views` volta **vazio** (campo descontinuado pela Meta). |
| Facebook (orgânico, `facebook_organic`) | NÃO CONECTADO | não | 2026-10-01 | Sem vaga no plano Basic (3/3). Páginas vistas na tela de conexão: "Matheus Machado Corretor de Imóveis", "Matheus Machado Corretor", "Matheus Henrique Porttes" — qual é a oficial: A CONFIRMAR. |
| Google Search Console / GA4 | NÃO CONECTADO | não | 2026-10-01 | Fica para a próxima etapa (decisão do dono: prioridade GMN, Instagram, Meta Ads). Plano Basic = **3 fontes, 3 em uso** (Meta Ads, GMN, Instagram): conectar outra exige upgrade ou trocar uma fonte. |

Nota de segurança: o conector Instagram expõe ações de escrita (`create_*_post`, `create_story`, `reply_to_comment`, `delete_comment` etc.). O agente **não usa nenhuma** — Instagram é só leitura; qualquer escrita exige pedido explícito do dono por ação. O interruptor "escrita de ações" do Windsor ficou **desligado** na conexão. As permissões da Meta concedidas ao Windsor incluem `ads_management`, `business_management` e `catalog_management` (pedido padrão do Windsor, autorizado pelo dono em 2026-10-01).

**Escrita no Windsor (02/10):** estava desligada ("Write actions are disabled for the Windsor user"); o dono ligou em Windsor → Settings → API Access → "Enable write actions for Claude, ChatGPT & API" e as 7 ações aprovadas do Google foram aplicadas. A chave vale para todos os conectores (inclui Meta Ads e Instagram): o agente só escreve no Google, com "sim" do dono por ação. Sugestão ao dono: desligar de novo após cada lote.

Pendência para o dono: decidir upgrade do Windsor (ou trocar uma fonte) para Search Console/GA4/Facebook orgânico.
