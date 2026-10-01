# Windsor.ai (MCP) — dados reais do posicionamento

Servidor oficial: `https://mcp.windsor.ai/` (MCP remoto, OAuth). Fontes alvo: **Google Business Profile, Google Search Console, GA4, Instagram (orgânico), Facebook (orgânico)**. Estado de cada fonte (conectada ou não) fica em `docs/posicionamento/FONTES.md` — leia antes de qualquer análise.

## Segurança (inegociável)
Use só o **conector da conta Claude** (`mcp__4b75594d-…__`); o servidor `mcp__windsor__` do projeto não é usado. Leitura é automática: `get_connectors` (já lista as contas; `get_accounts` não existe), `get_options`, `get_fields`, `get_data`, `list_actions` (só lista). **Escrita (`execute_action`) só em `google_my_business`, só com pedido/aprovação do dono por ação**, seguindo o protocolo do agente ("Alterações externas"). O conector `facebook` é Meta Ads (mídia paga): nunca executar ações nele. **Nunca** chamar ferramentas de login/autorização/assinatura/contato (`get_connector_authorization_url`, `get_windsor_login_url`, `get_subscription_url`, `contact_windsor`) nem `create_*`/`upload_files` — quem conecta contas é o dono, no navegador.

## Protocolo de leitura
1. `get_connectors` → quais fontes estão **realmente** conectadas e quais contas. Compare com `FONTES.md`; atualize-o se mudou (data + resultado).
2. Por fonte, `get_options`/`get_fields` para descobrir **campos e filtros reais** — não decore nomes de campo (variam por conector e versão). Valide os campos antes de `get_data`.
3. `get_data` com período explícito (padrão: últimos 90 dias, comparado com os 90 anteriores) e poucos campos por chamada. Registre no snapshot: conector, conta, período, campos, data da consulta (etiqueta **[VERIFICADO-WINDSOR]**).
4. Erro, vazio ou conector ausente → **[A CONFIRMAR]** + o motivo literal. Dado vazio ≠ zero: diga "sem dado retornado". **Nunca preencher com estimativa, amostra de busca ou memória.**
5. Dado pessoal: relatórios só com agregados. Nada de nome/telefone de seguidores, autores de avaliação com dado sensível ou conteúdo de mensagens.

## O que pedir de cada fonte (descobrir os campos pelo `get_fields`)
- **Search Console**: consultas e páginas (cliques, impressões, CTR, posição), por país/dispositivo; filtrar consultas com "marília", "primeiro imóvel", "minha casa minha vida", "caixa", e a marca. Alimenta `/seo-site` e as consultas-alvo.
- **GA4**: sessões, usuários, conversões/eventos de lead por origem/mídia/página de entrada; `organic`, `instagram`, `google / organic`, `gmn`. Cruze com `client_origins` do CRM.
- **Google Business Profile**: pesquisas que levaram ao perfil (diretas/descoberta), visualizações Maps/Search, ações (ligações, rotas, site, mensagens), avaliações (nota, volume, recência) **se o conector expuser**; o que não expuser = pedir print.
- **Instagram/Facebook orgânico**: seguidores (evolução), alcance, impressões, visitas ao perfil, cliques no link, desempenho por publicação (alcance, salvamentos, compartilhamentos, comentários); datas das publicações.

## Prioridade das fontes
Windsor (real) > print/export do dono ([INFORMADO]) > leitura pública (WebFetch/WebSearch/curl, amostra) > nada ([A CONFIRMAR]). Quando duas fontes divergirem, mostre as duas e prefira a de origem primária.
