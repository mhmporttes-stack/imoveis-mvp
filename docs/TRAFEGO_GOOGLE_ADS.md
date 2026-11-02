# TRAFEGO_GOOGLE_ADS — rastreamento da campanha Google Ads (anúncios em aplicativos, Marília/SP)

> Só o SITE: não mexe em campanha, orçamento nem conta do Google Ads. Padrão irmão do Meta: [`TRAFEGO_META.md`](TRAFEGO_META.md). Regra: `docs/BUSINESS_RULES.md` CAM-6. Pedido do dono: 2026-11-02.

## 1. URL final padrão do anúncio (colar em "URL final")

```
https://www.matheusmachadoimoveis.com.br/simulacao?utm_source=google&utm_medium=cpc&utm_campaign=apps-marilia&utm_content={creative}&utm_term={placement}
```

- O **`gclid`** (e `gbraid`/`wbraid` em iPhone) o Google anexa sozinho **se a "Marcação automática" estiver ligada** (Google Ads › Administrador › Configurações da conta › Marcação automática). Não digite.
- `{creative}` = ID do anúncio e `{placement}` = onde apareceu (app/site) — ValueTrack do Google, preenchidos na hora do clique.
- Nome da campanha (`utm_campaign`): começando com `apps` (ex.: `apps-marilia`) o CRM mostra **"Google Ads — Aplicativos"**; outro nome (ex.: `busca-marilia`) mostra "Google Ads — busca-marilia".
- Sem `?ref=` e sem `?c=`: o cadastro entra pela **roleta** como qualquer lead do site (nada muda na distribuição).

## 2. O que o dono precisa colar na Vercel (não está no código; este trabalho NÃO editou variáveis)

| Variável | Valor | Onde achar no Google Ads |
|---|---|---|
| `NEXT_PUBLIC_GOOGLE_ADS_ID` | `AW-XXXXXXXXX` | Metas › Conversões › (a conversão) › **Tag** › "Usar o Google Tag" → ID `AW-…` |
| `NEXT_PUBLIC_GOOGLE_ADS_LEAD_LABEL` | rótulo (ex.: `AbCdEf_123`) ou o `AW-XXXXXXXXX/AbCdEf_123` inteiro | Mesma tela › "Instalar a tag você mesmo" › "Snippet do evento": o trecho depois da `/` em `'send_to': 'AW-…/RÓTULO'` |

Vercel › projeto `imoveis-mvp` › Settings › Environment Variables (Production) e **novo deploy** (variável `NEXT_PUBLIC_*` só entra no build). Sem as duas, nada carrega e nada quebra. Valores inválidos são ignorados (o ID é validado: `AW-` + dígitos).

## 3. Como funciona

- **gtag.js**: `components/GoogleAds.jsx` (`next/script`, `afterInteractive`), montado por `AppChrome` só nas páginas públicas (nunca `/admin`).
- **Conversão "Lead"**: `trackGoogleAdsLead` (`lib/google-ads-client.mjs`), chamada **uma vez** no último botão (`SimulationForm`; no Atendimento Rápido, `QuickAttendanceForm`) **só depois que o CRM respondeu sucesso e o cadastro é novo** (mesma regra do Pixel da Meta; reenvio de cliente que já existe não conta), **antes** de abrir o WhatsApp. Espera o retorno do Google por no máximo **300 ms** e segue. Em erro: nada dispara.
- **Sem repetir**: `transaction_id` = id do cadastro + marca em `sessionStorage` (`mm_gads_lead:<id>`).
- **Sem dado pessoal**: o evento leva só `send_to` e `transaction_id`. Sem enhanced conversions (precisa de decisão do dono).
- **Captura**: `components/CampaignLinkCapture.jsx` guarda UTM + `gclid`/`gbraid`/`wbraid` em cookie de 1ª parte `mm_ad_attr` por **90 dias** (clique novo substitui); os formulários mandam isso no cadastro (`lib/ad-click-attribution.mjs`).
- **Origem no servidor** (`buildLeadOrigin`, `lib/lead-origin.js`): `utm_source=google` + medium pago (`cpc`…) **ou** qualquer `gclid`/`gbraid`/`wbraid` válido → `kind = paid_link`, rótulo "Google Ads — Aplicativos", `source_metadata` com `google_ads: true`, `paid_media: true`, `paid_channel: google_ads`, UTMs e os IDs de clique. Etiqueta automática **"Google Ads"** no cliente novo (somada à etiqueta de campanha do Gerador de Links, se houver). Sem coluna nova nem migration (`acquisition_context` → `client_origins.source_metadata`). Link pessoal (`?ref=`) ou de campanha (`?c=`) continuam mandando no rótulo; o Google fica só no metadata e na etiqueta.

## 4. Onde aparece no CRM

- **Clientes**: etiqueta "Google Ads"; origem na ficha/linha do tempo ("Google Ads — Aplicativos"); aba **Patrocinado** (origem paga) inclui esses leads.
- `client_origins.source_metadata` (gclid, campanha, criativo, posição) para conferir com o Google Ads.
- Relatórios de campanha do Gerador de Links: só quando a campanha for criada lá (`?c=`); este link não precisa dela.

## 5. Como validar a conversão (Tag Assistant)

1. Abrir [tagassistant.google.com](https://tagassistant.google.com) › Conectar › o endereço do passo 1 (com os UTM de teste) › Conectar.
2. Na aba do site: tag **Google Ads `AW-…`** deve aparecer "Tag disparada" ao carregar a página.
3. **Teste só com decisão do dono** (preencher o formulário cria cliente de verdade e leva ao WhatsApp): ao enviar, deve aparecer o evento **conversion** com `send_to AW-…/RÓTULO` e `transaction_id` (uma vez só).
4. No Google Ads, Metas › Conversões: status "Gravando conversões" pode levar até 24 h para aparecer.

## 6. Pendências / DECISÃO NECESSÁRIA

- **Consentimento (LGPD)**: o site **não tem banner de cookies/consentimento** (nem para o Pixel da Meta). Hoje o Google Ads dispara como o Pixel. Quando houver banner, ligar só em `hasAdsConsent()` (`lib/google-ads-client.mjs`). Nenhum banner foi inventado.
- Enhanced conversions (telefone/e-mail hasheado) e valor da conversão: não ligados; decisão do dono.
- O pop-up de captura geral (`LeadCaptureModal` → `/api/leads`) **não** dispara conversão (não é o último botão da página de captura).
