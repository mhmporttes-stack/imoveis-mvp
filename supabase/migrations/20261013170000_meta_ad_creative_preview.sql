-- Área Anúncios (dono, 2026-10-13): miniatura do criativo e destino do conjunto.
-- Somente LEITURA da Meta (GET); preenchidas por syncMetaAdCreatives
-- (lib/meta-ads-sync.js). Colunas próprias para que o upsert das entidades
-- (que reescreve "raw") não apague a miniatura entre uma sincronização e outra.
-- thumbnail_url/image_url são URLs assinadas da Meta (expiram em alguns dias):
-- são renovadas a cada sincronização diária e ao abrir a tela (cache > 20 h).
alter table public.meta_ad_entities add column if not exists thumbnail_url text;
alter table public.meta_ad_entities add column if not exists image_url text;
alter table public.meta_ad_entities add column if not exists destination_type text;
alter table public.meta_ad_entities add column if not exists creative_synced_at timestamptz;
