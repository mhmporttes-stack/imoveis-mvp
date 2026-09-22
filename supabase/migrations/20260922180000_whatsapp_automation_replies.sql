-- Regras de resposta automática por palavra-chave para o WhatsApp Master.
-- Usadas quando um Disparo oferece algo (ex.: "descubra seu poder de compra
-- em menos de 2 minutos") e o cliente responde de volta: se o texto recebido
-- contiver a palavra-chave de alguma regra ativa, o sistema manda a resposta
-- configurada e, opcionalmente, encaminha o contato pra roleta (round robin)
-- pra um corretor assumir. Palavras-chave e textos são 100% editáveis pela
-- tela — "sim"/"não" abaixo são só o ponto de partida, não estão fixos no
-- código.
create table if not exists public.whatsapp_automation_replies (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  response_message text not null,
  forward_to_roleta boolean not null default false,
  active boolean not null default true,
  display_order integer not null default 0,
  triggered_count integer not null default 0,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_automation_replies_active_idx
  on public.whatsapp_automation_replies (active, display_order);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists whatsapp_automation_replies_set_updated_at on public.whatsapp_automation_replies;
create trigger whatsapp_automation_replies_set_updated_at
before update on public.whatsapp_automation_replies
for each row
execute function public.set_updated_at();

alter table public.whatsapp_automation_replies enable row level security;
-- Sem policy pública de propósito — mesmo padrão do resto do projeto (acesso
-- só via service role no servidor, nunca anon/authenticated direto).

-- Incremento atômico de triggered_count (evita race condition entre duas
-- respostas quase simultâneas batendo na mesma regra).
create or replace function public.increment_whatsapp_automation_reply_count(p_id uuid)
returns void
language sql
as $$
  update public.whatsapp_automation_replies
  set triggered_count = triggered_count + 1
  where id = p_id;
$$;

revoke all on function public.increment_whatsapp_automation_reply_count(uuid) from public, anon, authenticated;
grant execute on function public.increment_whatsapp_automation_reply_count(uuid) to service_role;

-- Semente inicial (editável/removível pela tela) — só insere se a tabela
-- ainda estiver vazia, para não duplicar linhas caso esta migration seja
-- reaplicada.
insert into public.whatsapp_automation_replies (keyword, response_message, forward_to_roleta, active, display_order)
select * from (values
  (
    'sim',
    'Perfeito! Segue o link pra descobrir seu poder de compra em menos de 2 minutos: {{link_simulacao}}',
    true,
    true,
    1
  ),
  (
    'não',
    'Sem problema! Se mudar de ideia, é só chamar por aqui. 😊',
    false,
    true,
    2
  )
) as seed(keyword, response_message, forward_to_roleta, active, display_order)
where not exists (select 1 from public.whatsapp_automation_replies);
