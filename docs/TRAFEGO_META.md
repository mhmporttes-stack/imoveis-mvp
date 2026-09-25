# TRAFEGO_META — Meta (Pixel, Conversions API, Meta Ads) e origem de leads

> Fonte: `components/MetaPixel.jsx`, `lib/meta-pixel-*.js`, `lib/meta-conversions-api.js`, `lib/meta-ads-config.js`, `lib/meta-ads-sync.js`, `app/api/cron/meta-ads-*`, `app/api/admin/meta-ads/*`, `lib/lead-origin.js`, `lib/campaigns.js`, `supabase/migrations/20260923120000_meta_ads_read_sync.sql`, `20260923180000_meta_ads_sync_crons.sql` (verificado em 2026-09-24, commit `3c82f72`).
> **Nunca** registrar access tokens, IDs de conta/pixel reais ou valores de variáveis: só nomes. Estado real da integração em produção (variáveis configuradas, backfill feito, crons ativos) **não foi verificado** → **A CONFIRMAR**.
> Relacionados: [`WHATSAPP.md`](WHATSAPP.md) (Click-to-WhatsApp, Disparo) · [`BUSINESS_RULES.md`](BUSINESS_RULES.md) §4 (campanhas/origem) · [`DATABASE.md`](DATABASE.md) (tabelas `meta_ad_*`, `campaigns`, `client_origins`) · Manual: [`../AGENTS.md`](../AGENTS.md).

## 1. Três integrações independentes (tokens e finalidades separados)

| Integração | O que faz | Variáveis (nomes) | Fase/estado no código |
|---|---|---|---|
| **Meta Pixel** (navegador) | `PageView` nas páginas públicas + evento `Lead` no cadastro | `NEXT_PUBLIC_META_PIXEL_ID` | ativo se o ID existir |
| **Conversions API** (servidor) | mesmo evento `Lead` enviado do servidor, deduplicado com o navegador | `NEXT_PUBLIC_META_PIXEL_ID` + `META_CONVERSIONS_API_ACCESS_TOKEN` | ativo se ambos existirem |
| **Marketing API — leitura (Gestão de Tráfego, Fase 1)** | sincroniza campanhas/conjuntos/anúncios e métricas diárias para o banco | `META_ADS_ACCESS_TOKEN` (`ads_read`), `META_ADS_AD_ACCOUNT_ID`, `META_ADS_GRAPH_API_VERSION`, `META_ADS_BACKFILL_START_DATE`, `META_ADS_SYNC_WINDOW_DAYS` | **só leitura**; **sem tela** ainda |

`WHATSAPP_ACCESS_TOKEN`, `META_CONVERSIONS_API_ACCESS_TOKEN` e `META_ADS_ACCESS_TOKEN` têm escopos diferentes — **nunca reaproveitar um pelo outro**. Todas estão em `.env.example` (sem valor).

## 2. Meta Pixel (navegador)

- `components/MetaPixel.jsx` é montado por `components/AppChrome.jsx` em **todas as páginas públicas** (inclui `/simulacao*`), **nunca em `/admin`** e **não** em `/minha-jornada/*` (o `AppChrome` retorna antes). Dispara `fbq('init')` + `PageView`.
- Evento de conversão **`Lead`**: `trackMetaLead` (`lib/meta-pixel-client.js`), chamado por `SimulationForm` (com faixa de renda) e `QuickAttendanceForm` (sem renda) no envio. Usa **Advanced Matching manual**: telefone **hasheado (SHA-256)** no navegador — nunca em texto puro; `eventID` = UUID gerado no cliente.
- Nenhum outro evento (ViewContent, Contact, Schedule…) existe no código. O clique nos botões de WhatsApp do site **não** dispara evento.

## 3. Conversions API (servidor) — `lib/meta-conversions-api.js`

- `sendMetaLeadEvent` roda em `createSimulationRegistration`/`createQuickAttendanceRegistration` **antes** do cadastro concluir, em modo *fire-and-forget* (`.catch(() => {})`): **nunca** bloqueia nem derruba o cadastro.
- Payload: `event_name: Lead`, `action_source: website`, `event_time`, `event_id` (mesmo do navegador → deduplicação), `user_data.ph` (SHA-256 do telefone só com dígitos, com DDI), `client_ip_address` e `client_user_agent` **do request do servidor** (`extractRequestMetadata`, nunca do corpo enviado pelo cliente), `event_source_url` (Referer) e `custom_data.content_category` = **faixa de renda** (`ate_2k`, `2k_a_5k`, `5k_a_10k`, `10k_a_20k`, `acima_20k`; **nunca o valor exato** — decisão do dono, `lib/meta-pixel-shared.js`).
- Graph API **`v21.0` fixa no código** (diferente do resto, que é configurável).
- Não envia `fbc`/`fbp`/`fbclid` (não são capturados em lugar nenhum do código). Eventos posteriores do funil (aprovado, venda) **não** são enviados à Meta.

## 4. Origem do lead (UTM, campanhas, links)

- **UTM**: `SimulationForm`/`QuickAttendanceForm` leem `utm_source/medium/campaign/content/term` da URL e enviam em `attribution`; `buildLeadOrigin` (`lib/lead-origin.js`) sanitiza (remove `<>`, ≤ 200 caracteres) e classifica `acquisition_context.kind`: `broker_link` > `campaign` > `roulette_link` > `paid_link` (`utm_medium` ∈ cpc/ppc/paid/paid_social/paid_search) > `tracked_link` (só `utm_source`) > `site`. Vai para `client_origins` (imutável) pelo trigger `capture_client_journey` **no INSERT**. Contexto e origem **não mudam depois** (`guard_client_identity`).
- **Links do Gerador** (`?c=<campaigns.id>`): `campaigns` (kind `official` por corretor/gestor/admin, ou personalizada), destino `roulette`/`broker`, `link_journey` (`choice`/`quick_service`/`simulation`), contagem de aberturas em `campaign_link_views`, envios repetidos em `campaign_link_duplicate_submissions`. O `?c=` persiste 30 dias no `localStorage` (`lib/campaign-link-client.js`). Cadastro por campanha ativa recebe a **tag** com o nome da campanha e origem com snapshot do nome. Especificação original (design): `docs/spec-gerador-de-links.md` — os nomes de tabela/campos ali diferem do schema real.
- **Link pessoal** (`?ref=`) e **equipe** (`/simulacao/equipe`): ver `BUSINESS_RULES.md` §3–4.
- **Disparo do WhatsApp** cria uma campanha “roulette” por lote (o botão do modelo abre `/simulacao?c=<id>`); o cliente que converte herda essa origem.
- **Click-to-WhatsApp (anúncio → conversa → cliente)**: a Meta envia `referral` no webhook; o código guarda `origin = { kind: 'meta_ad', referral }` **na conversa** e permite Fluxos por `ad_referral`/condição “origem anúncio”. **Desde 2026-09-24** (`lib/whatsapp-sponsored-lead.js`, `lib/whatsapp-referral.mjs`), lead de anúncio (`source_type = ad`) com telefone **novo** entra na **roleta** e grava a origem no cliente: `acquisition_context.kind = whatsapp_ad`, rótulo “WhatsApp — Anúncio patrocinado”, `client_origins.source_metadata` com `channel: whatsapp`, `entry: click_to_whatsapp`, o `referral` saneado (`source_id`, `source_type`, `source_url`, `headline`, `body`, `media_type`, `ctwa_clid`; sem mídia) e — **só se** o ID do anúncio já foi sincronizado em `meta_ad_entities` — `ad_name`, `adset_*`, `campaign_*` (a Meta não manda nomes no webhook). É a primeira ligação anúncio → cliente no CRM; a comparação com `meta_ad_insights` continua manual. `post` (CTA de publicação) não entra na roleta automaticamente.
- **Meta Ads ↔ CRM**: não há junção automática. A comparação é manual: `meta_ad_insights.leads` (leads segundo a Meta) × contagem de cadastros por campanha (`campaigns`/`client_origins`; `lib/campaigns.js` documenta que o número é “comparável ao leads da Meta”). Custos de tráfego pago existem só como **categoria de despesa** no Financeiro (`"Tráfego pago"`).

## 5. Sincronização Meta Ads (leitura) — `lib/meta-ads-sync.js`

- `fetch` direto à Graph API (sem SDK), **somente `GET`** — nenhuma função cria/edita/pausa nada na Meta. Retry com backoff (4 tentativas), limite de 50 páginas por chamada. Token nunca é logado (`redactedPath`).
- **Entidades** (`meta_ad_entities`): campanha, conjunto (com `targeting`, onde a Meta expõe `geo_locations`) e anúncio; filtro de `effective_status` inclui pausadas/arquivadas; **não** incluir `DELETED` (a Graph API rejeita — erro real 1815001). `CAMPAIGN_PAUSED`/`ADSET_PAUSED` são obrigatórios para listar filhos de campanha pausada. A “regra Marília/SP” (auditoria de localização das campanhas) motivou guardar `targeting`; **não há validação automática dessa regra no código** (**A CONFIRMAR** se é rotina manual/futura).
- **Métricas** (`meta_ad_insights`): uma linha por entidade × dia, sempre consultada **no próprio nível** (`campaign`/`adset`/`ad`, `time_increment=1`); `spend`, `impressions`, `clicks`, `landing_page_views`, `leads` (aditivas) e `reach`, `frequency`, `cpm`, `ctr`, `cpc`, `cpl` (**não aditivas**: nunca somar de níveis filhos). `LEAD_ACTION_TYPES = lead, onsite_conversion.lead_grouped, leadgen_grouped`; `actions_raw` preserva tudo. **UPSERT** por `(conta, tipo, entidade, dia)` — a Meta ajusta atribuição depois.
- **Fusos**: a conta de anúncios está em `America/Los_Angeles` (segundo o comentário da migration) — o “dia” dos insights segue esse fuso (lido de `meta_ad_accounts.timezone_name`); o cron usa horário de São Paulo (UTC−3 fixo).
- `attribution_window` gravado = constante `7d_click_1d_view` (`META_ADS_ATTRIBUTION_WINDOW`); **o parâmetro de janela não é enviado à API** — o rótulo documenta uma expectativa e pode não refletir o padrão real da conta (**A CONFIRMAR**, P-13).
- **Orquestração**:
  - `runIntradaySync` (cron `0 1,11,13,15,17,19,21,23 * * *` UTC = 08–22 h de 2 em 2 h + 22 h SP): conta + insights do **dia corrente** só no nível `ad`.
  - `runDailyConsolidation` (cron `0 9 * * *` UTC = 06:00 SP): conta + entidades + insights dos 3 níveis na **janela móvel** `META_ADS_SYNC_WINDOW_DAYS` (padrão 10), para incorporar ajustes retroativos.
  - `runBackfill` (`POST /api/admin/meta-ads/backfill`, **administrador geral**, sob demanda; retomável por `meta_ad_sync_state.backfill_completed_through`, blocos de 31 dias, para no primeiro bloco com erro).
  - `GET /api/admin/meta-ads/sync-status` (administrador geral): diagnóstico sem expor o token (`configured`, `missing`, estado por conta, contagens).
- Resultado dos passos: `success` / `partial` / `failed`; sem configuração devolve `missing_config` com **os nomes** das variáveis que faltam.
- **Sem UI**: “Gestão de Tráfego” é citada como tela futura nos comentários; hoje só existem as rotas de diagnóstico/backfill. Fase futura prevista (não implementada): `traffic_action_proposals`/`traffic_action_log` com aprovação explícita por proposta.

## 6. Como agir neste tema

1. Não misture os três tokens; não coloque nenhum em código, logs, docs ou `.env.example` com valor.
2. Alterar o evento `Lead` exige manter **a mesma** `event_id` no navegador e no servidor (deduplicação) e nunca enviar renda exata nem telefone em texto puro.
3. Nova métrica/nível de insights: respeitar aditiva × não aditiva e o upsert; conferir os `action_type` reais em `actions_raw`.
4. Qualquer escrita na Meta (criar/pausar campanha) é **fora do escopo atual** — exige fase nova, aprovação explícita e revisão de segurança.
5. Testes só de leitura: `GET /api/admin/meta-ads/sync-status` autenticado como administrador geral; **não** rode `backfill` em produção sem pedido.

## 7. Riscos e pontos a confirmar

- **P-13** rótulo de janela de atribuição não enviado à API; com token/conta ausentes os crons respondem `502` com `missing_config` (aparece como falha do job no `pg_cron`, sem alerta ao usuário).
- Lead de anúncio via WhatsApp só carrega campanha/anúncio para o cliente quando o anúncio já foi sincronizado da Meta (senão fica só o ID do anúncio e o `referral`); cliente que **já existia** apenas tem a conversa vinculada (origem original preservada).
- Conversions API só cobre `Lead`; eventos de qualidade (aprovação/venda) não retornam à Meta.
- `v21.0` fixa na CAPI; `META_ADS_GRAPH_API_VERSION`/`WHATSAPP_GRAPH_API_VERSION` têm padrão `v23.0` — revisar quando a Meta descontinuar versões.
- Cron aponta para o host técnico `imoveis-mvp.vercel.app` (fixo nas migrations).
