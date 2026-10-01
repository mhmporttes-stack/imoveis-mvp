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
| Instagram (orgânico, `facebook_organic`) | NÃO CONECTADO | não | 2026-10-01 | Idem. |
| Facebook (orgânico, `facebook_organic`) | NÃO CONECTADO | não | 2026-10-01 | Idem. |

Pendência para o dono: conectar Search Console, GA4 e Instagram/Facebook orgânico no painel do Windsor; só então o agente consegue medir SEO, tráfego do site e alcance social com dado real.
