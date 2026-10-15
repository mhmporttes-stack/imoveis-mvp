-- Código do imóvel (pedido do dono, 2026-10-15): exibido como chip "COD{code}"
-- na lista de imóveis do painel admin (components/AdminPropertyList.jsx).
-- Guarda só o código (ex.: '4352'), sem o prefixo "COD". Nullable; único
-- quando preenchido. Não é exibido no site público.
alter table public.properties add column if not exists code text;

create unique index if not exists properties_code_unique
  on public.properties (code)
  where code is not null;

-- Imóveis já cadastrados em 2026-10-15.
update public.properties set code = '4352'
  where id = 'd0fbfae5-646c-47ec-b29f-e5b42474e099' and code is null;
update public.properties set code = '4353'
  where id = '32b89055-e5d2-4257-bc94-0fabfb34b4b8' and code is null;
