-- Canal do atalho do Chat (REGRA OFICIAL — dono, 2026-10-22, MKT-2f): os atalhos de texto também servem ao Chat do
-- Marketplace. channel: 'whatsapp' (padrão: todos os atalhos que já existem continuam só no Chat do WhatsApp),
-- 'marketplace' (só no Chat do Marketplace) ou 'both' (nos dois). Aditiva e idempotente. O código funciona sem ela
-- (trata tudo como 'whatsapp'; marcar outro canal pede esta migration).
alter table public.whatsapp_chat_shortcuts
  add column if not exists channel text not null default 'whatsapp';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_chat_shortcuts_channel_check') then
    alter table public.whatsapp_chat_shortcuts
      add constraint whatsapp_chat_shortcuts_channel_check check (channel in ('whatsapp', 'marketplace', 'both'));
  end if;
end $$;
