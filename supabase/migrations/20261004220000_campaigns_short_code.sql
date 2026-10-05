-- Links curtos no próprio domínio (2026-10-04): /c/{short_code} → /simulacao?c={id}. Aditiva: o link antigo
-- (?c=<uuid>) continua funcionando. Campanhas existentes ganham o código aqui; as novas pegam do DEFAULT.
alter table public.campaigns add column if not exists short_code text;

update public.campaigns
   set short_code = lower(substr(md5(id::text), 1, 7))
 where short_code is null;

alter table public.campaigns
  alter column short_code set default lower(substr(md5(random()::text || clock_timestamp()::text), 1, 7));

create unique index if not exists campaigns_short_code_key on public.campaigns (short_code);
