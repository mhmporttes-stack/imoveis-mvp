-- Números de WhatsApp que JÁ estiveram conectados por cada usuário do painel
-- (regra do dono, 2026-10-02: conversa entre integrantes da equipe nunca
-- vira cliente). phone_number é zerado quando a sessão cai/desconecta; sem
-- este histórico, um corretor desconectado (ou o dono) voltaria a ser
-- tratado como cliente quando mandasse mensagem a um colega.
-- Lido por lib/internal-phones.js. Só acrescenta (nunca apaga números).

alter table public.whatsapp_individual_sessions
  add column if not exists known_phone_numbers text[] not null default '{}'::text[];

create or replace function public.whatsapp_session_remember_phone()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.phone_number is not null and new.phone_number <> ''
     and not (new.phone_number = any(coalesce(new.known_phone_numbers, '{}'::text[]))) then
    new.known_phone_numbers := array_append(coalesce(new.known_phone_numbers, '{}'::text[]), new.phone_number);
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_session_remember_phone on public.whatsapp_individual_sessions;
create trigger whatsapp_session_remember_phone
  before insert or update of phone_number on public.whatsapp_individual_sessions
  for each row execute function public.whatsapp_session_remember_phone();

-- Números conectados agora entram já no histórico.
update public.whatsapp_individual_sessions
   set known_phone_numbers = array[phone_number]
 where phone_number is not null and phone_number <> '' and known_phone_numbers = '{}'::text[];

revoke all on function public.whatsapp_session_remember_phone() from public, anon, authenticated;
