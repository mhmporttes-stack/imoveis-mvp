-- Publicador do Facebook Marketplace (MKT-1, 2026-10-20): campos opcionais do formulário real de imóvel do Facebook
-- ("Detalhes específicos"): IPTU, condomínio e vagas de estacionamento. Idempotente; depende de
-- 20261020120000_marketplace_listings.sql. O código trata as colunas como opcionais (nulas = não preenche).

alter table public.marketplace_listings add column if not exists iptu numeric(12, 2);
alter table public.marketplace_listings add column if not exists condo_fee numeric(12, 2);
alter table public.marketplace_listings add column if not exists parking_spaces integer;

alter table public.marketplace_listings drop constraint if exists marketplace_listings_iptu_check;
alter table public.marketplace_listings add constraint marketplace_listings_iptu_check check (iptu is null or iptu >= 0);
alter table public.marketplace_listings drop constraint if exists marketplace_listings_condo_fee_check;
alter table public.marketplace_listings add constraint marketplace_listings_condo_fee_check check (condo_fee is null or condo_fee >= 0);
alter table public.marketplace_listings drop constraint if exists marketplace_listings_parking_spaces_check;
alter table public.marketplace_listings add constraint marketplace_listings_parking_spaces_check check (parking_spaces is null or parking_spaces between 0 and 20);
