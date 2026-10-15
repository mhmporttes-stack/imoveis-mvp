-- Publicar imóvel "sem valores" (dono, 2026-10-15): ao aprovar e publicar, o dono escolhe se o site mostra o preço.
-- hide_price = true -> o site público (lib/public-properties.js) não recebe price nem installment_entry.
alter table public.properties add column if not exists hide_price boolean not null default false;
