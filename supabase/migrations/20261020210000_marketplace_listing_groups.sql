-- Grupos do Facebook marcados na publicação do Marketplace (dono, 2026-10-20: "Anunciar nos seus grupos", até 20).
-- A lista de grupos fica em crm_settings ('marketplace_groups'); aqui só o resultado por anúncio: quais grupos a extensão
-- marcou e quais não encontrou. Idempotente. O código funciona sem esta coluna (o resultado só não é guardado).
alter table public.marketplace_listings add column if not exists groups_result jsonb;
