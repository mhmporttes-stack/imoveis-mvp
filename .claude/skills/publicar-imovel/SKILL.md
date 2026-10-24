---
name: publicar-imovel
description: "Quando o dono manda fotos + dados de um imóvel: monta o carrossel no modelo padrão e JÁ PUBLICA em Instagram, site/CRM e Marketplace (autorização permanente do dono, 2026-10-22). Use sempre que chegarem fotos de imóvel para vender."
---

# Publicar imóvel (fotos do dono → Instagram + site/CRM + Marketplace)

**Autorização permanente do dono (2026-10-22):** "sempre que eu mandar a foto, você já vai postar nesses lugares". Não perguntar "Vai postar agora?" para imóvel: publicar e avisar. Continua valendo: nada de inventar dado (quartos, área); valor nunca aparece no post (só no CRM, com `hide_price=true`); endereço completo só no CRM.

## 1. Carrossel (modelo em `docs/posicionamento/ESTILO-CARROSSEL.md`)
- Pasta `docs/posicionamento/carrosseis/AAAA-MM-DD-<bairro>/`. Copiar `laminas.html` e `img/` do último imóvel e trocar textos (código só no selo de cima).
- Fotos: LaMa se houver marca de terceiros; ESRGAN 2x (`2xNomosUni`, ONNX do HuggingFace `nesaorg/2xNomosUni_esrgan_multijpg_fp32_opset17`, em blocos de 256 px, dimensões pares). Máx. 10 lâminas (capa + 8 + final).
- Render: `node .claude/design/tools/renderizar-laminas-html.mjs <laminas.html>` (com `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt NODE_USE_ENV_PROXY=1`).
- **Capa do Marketplace** = capa sem `<img src="img/apontando.png">` → `capa-marketplace.jpg`.
- JPEGs para o Instagram em `ig/lamina-NN.jpg`; `legenda.md` com dados do dono e a legenda. Commit + push em `main` (só docs: não faz deploy).

## 2. Fotos no armazenamento do site
Segredo de rede `claude-fotos` (`/storage/v1/`): enviar `ig/lamina-01..10.jpg` e `capa-marketplace.jpg` para `property-media/cod<code>-<bairro>/` (POST `https://tshhasbbchjcvhoyizoo.supabase.co/storage/v1/object/property-media/<caminho>`). URL pública: `.../storage/v1/object/public/property-media/<caminho>`.
Se o segredo não funcionar na sessão (só vale em sessão nova): site usa as URLs `raw.githubusercontent.com/mhmporttes-stack/imoveis-mvp/<commit>/...` como provisórias, e o **Marketplace usa as mesmas URLs do GitHub** (raw.githubusercontent.com responde com CORS `*`, a extensão consegue baixar — testado em 2026-10-23 com COD4358/4359).

## 3. Site/CRM (MCP Supabase)
- `properties`: `code` = próximo de 4 dígitos (ver lista em ESTILO-CARROSSEL "Imóvel no CRM"), `is_published=true`, `hide_price=true`, `price` do dono, `photos_json` = lâminas na ordem (`{data,name,storagePath}`), `sales_text` = legenda sem hashtags, `internal_notes` com endereço/permuta/contato.
- `property_contacts`: nome, `contact_type` `proprietario`|`corretor` (reaproveitar o contato se o nome já existir).
- Conferir a página `https://www.matheusmachadoimoveis.com.br/empreendimentos/<id>` (200).

## 4. Marketplace (extensão "Publicador Marketplace" no Chrome do escritório)
Inserir em `marketplace_listings`: `property_id`, `title`, `price` (número), `description` (texto do site + "Matheus Machado Corretor de Imóveis · CRECI 323106-F"), `offer_type='sale'`, `property_type` (`house`/`apartment`), `bedrooms`, `bathrooms`, `area_m2`, `neighborhood` (só o bairro), `photo_urls` = **[capa-marketplace, lâminas 02–09]** em URLs do Supabase, `status='pending'`, **`approved_at=now()`** (aprovação permanente do dono). A extensão publica sozinha (até 3/dia, 08–20h, PC ligado).

## 5. Instagram (Windsor `instagram` → `create_carousel_post`, conta 17841410653785252)
URLs públicas JPEG (Supabase ou raw do GitHub) + legenda.

**Tempo esgotado ou erro → confirmar antes de tentar de novo (regra do dono, 2026-10-23; já duplicou o COD4358):**
⚠️ Verificado em 2026-10-24: o plano Basic do Windsor guarda os dados em cache (sem atualização por hora) — post recém-publicado **pode não aparecer por horas** no `get_data`. Se as conferências não acharem o post, **não reenviar**: pedir ao dono para olhar o perfil (ou conferir de novo horas depois). Reenviar só com o "não saiu" do dono.
1. Tempo esgotado quase sempre PUBLICA. Antes de qualquer reenvio, conferir: Windsor `get_data` conector `instagram`, campos `media_id, media_caption, timestamp`, `date_preset: last_1dT`, **sem filtro** (filtro com acento não casa) e comparar localmente a 1ª linha da legenda.
2. Achou → publicado; registrar o `media_id` e parar.
3. Não achou → esperar ~2 min (Monitor/until, nunca sleep solto) e conferir de novo; até **3 conferências** (~6 min).
4. Só depois de 3 conferências sem o post: reenviar **uma vez** e repetir a conferência. Se ainda falhar, avisar o dono (não insistir).
5. Erro com mensagem clara de recusa (permissão, URL inválida) = não publicou: corrigir a causa e reenviar direto.

## 6. Registrar e avisar
`legenda.md` (ids, links), `FILA-POSTAGEM.md` → Publicados, código usado em ESTILO-CARROSSEL. Resposta ao dono: curta, com o link do site, a legenda em caixa de texto e o que ficou pendente.
