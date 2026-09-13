-- Journey state is private; only server-side DTOs are public.
-- Filename version matches the applied Supabase migration.
create sequence if not exists public.client_code_seq start 1001;
alter table public.simulation_registrations add column if not exists client_code text;
alter table public.simulation_registrations add column if not exists acquisition_context jsonb;
alter table public.simulation_registrations disable trigger simulation_registrations_set_updated_at;
update public.simulation_registrations set client_code = '#C' || nextval('public.client_code_seq') where client_code is null;
alter table public.simulation_registrations enable trigger simulation_registrations_set_updated_at;
alter table public.simulation_registrations alter column client_code set default ('#C' || nextval('public.client_code_seq'));
alter table public.simulation_registrations alter column client_code set not null;
create unique index if not exists simulation_registrations_client_code_key on public.simulation_registrations(client_code);

insert into public.crm_settings(id,setting_value) values
('client_journey_statuses','{"in_service":{"public_name":"Sua jornada começou","progress":15,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Seu atendimento começou. Vamos orientar os próximos passos para a conquista do seu primeiro imóvel e a construção do seu patrimônio.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"pending":{"public_name":"Preparando sua simulação","progress":25,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Estamos preparando a simulação do seu primeiro imóvel. Esse passo organiza as condições para dar continuidade à sua jornada.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"completed":{"public_name":"Simulação realizada","progress":40,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Sua simulação foi realizada: um passo concreto na direção do seu primeiro imóvel. Vamos conversar sobre as condições e dar continuidade ao seu atendimento.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"simulation_sent":{"public_name":"Simulação realizada","progress":40,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Sua simulação foi realizada: um passo concreto na direção do seu primeiro imóvel. Vamos conversar sobre as condições e dar continuidade ao seu atendimento.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"documentation_pending":{"public_name":"Organizando sua documentação","progress":50,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Chegou o momento de reunir a documentação para avançarmos com o seu processo. Nossa equipe orientará os documentos necessários para esta etapa.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"documents_pending":{"public_name":"Complementando sua documentação","progress":null,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"{primeiro_nome}, seguimos avançando na sua jornada. 🔑\nIdentificamos alguns documentos que precisam ser complementados para continuarmos avançando com o seu processo.\nNossa equipe vai orientar exatamente o que precisamos nesta etapa para que possamos dar continuidade.\nCada etapa concluída deixa você mais perto da conquista do seu primeiro imóvel. 🏠","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"approval_pending":{"public_name":"Análise em andamento","progress":65,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Seu processo avançou para a análise de crédito. Acompanhamos essa etapa e orientaremos você sobre as atualizações e os próximos passos.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"restriction":{"public_name":"Continuidade do seu processo","progress":null,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Sua análise identificou um ponto que precisamos ajustar para continuarmos avançando na conquista do seu primeiro imóvel.\nAgora vamos entender essa restrição e definir o caminho para solucioná-la. Você não precisa descobrir o que fazer sozinho: vamos analisar a situação e orientar cada passo necessário para dar continuidade ao seu processo.\nEssa é mais uma etapa da sua jornada — e vamos passar por ela juntos.\nSeu primeiro imóvel continua cada vez mais perto. 🏠","cta":"whatsapp","cta_label":"Entenda melhor pelo WhatsApp","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"shielding":{"public_name":"Estratégia de continuidade","progress":null,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Definimos uma estratégia para dar continuidade ao seu processo. Vamos explicar os próximos passos e as condições dessa etapa pelo WhatsApp, com atenção à sua realidade.\nSeu caminho já percorrido permanece parte da sua conquista.","cta":"whatsapp","cta_label":"Entenda melhor pelo WhatsApp","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"rejected":{"public_name":"Próximos passos do seu processo","progress":null,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"A análise identificou pontos que precisam de atenção antes de continuarmos. Vamos conversar sobre as orientações e as possibilidades adequadas ao seu caso.\nSeguimos ao seu lado na construção desse caminho, sem apagar os passos já realizados.","cta":"whatsapp","cta_label":"Entenda melhor pelo WhatsApp","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"approved":{"public_name":"Crédito aprovado","progress":85,"title":"Parabéns, {primeiro_nome}! 🎉","subtitle":"Seu crédito foi aprovado!","body":"Você acaba de conquistar uma das etapas mais importantes do caminho até o seu primeiro imóvel. 🔑\nCom a aprovação concluída, podemos avançar para transformar o seu crédito aprovado na conquista do seu imóvel.\nAgora é hora de avançarmos para a escolha do seu primeiro imóvel e dar mais um grande passo na construção do seu patrimônio.\nSeu primeiro imóvel está cada vez mais perto. 🏠","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"meeting_pending":{"public_name":"Escolha do seu primeiro imóvel","progress":90,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Avançamos para a etapa de escolha do seu primeiro imóvel. Vamos conversar sobre o empreendimento e os detalhes dessa conquista.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"meeting_done":{"public_name":"Escolha do seu primeiro imóvel","progress":90,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Avançamos para a etapa de escolha do seu primeiro imóvel. Vamos conversar sobre o empreendimento e os detalhes dessa conquista.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"sale_completed":{"public_name":"Formalizando sua conquista","progress":94,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Seu processo avançou para a formalização da compra. Acompanhamos os detalhes com você para dar continuidade à conquista do seu primeiro imóvel.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"sale_contract":{"public_name":"Formalizando sua conquista","progress":94,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Seu processo avançou para a formalização da compra. Acompanhamos os detalhes com você para dar continuidade à conquista do seu primeiro imóvel.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"sale_forms":{"public_name":"Seu processo segue em andamento","progress":null,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Nossa equipe está acompanhando a organização do seu processo. Conte com seu corretor para as orientações desta etapa.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"sale_reservation":{"public_name":"Preparando a assinatura","progress":97,"title":"{primeiro_nome}, seguimos avançando! 🔑","subtitle":"","body":"Seu processo está na etapa de reserva com a Caixa. Acompanhamos os próximos passos para a assinatura do seu financiamento.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"sale_caixa_signature":{"public_name":"Sua conquista","progress":100,"title":"{primeiro_nome}, você chegou lá! 🏠🔑","subtitle":"","body":"A assinatura com a Caixa marca a conquista do seu primeiro imóvel e um novo capítulo na construção do seu patrimônio.\nFoi uma alegria acompanhar sua jornada. Nossa equipe continua ao seu lado para orientar os detalhes do seu atendimento.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"sale_itbi":{"public_name":"Sua conquista","progress":100,"title":"{primeiro_nome}, você chegou lá! 🏠🔑","subtitle":"","body":"A assinatura com a Caixa marca a conquista do seu primeiro imóvel e um novo capítulo na construção do seu patrimônio.\nFoi uma alegria acompanhar sua jornada. Nossa equipe continua ao seu lado para orientar os detalhes do seu atendimento.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"sale_registry":{"public_name":"Sua conquista","progress":100,"title":"{primeiro_nome}, você chegou lá! 🏠🔑","subtitle":"","body":"A assinatura com a Caixa marca a conquista do seu primeiro imóvel e um novo capítulo na construção do seu patrimônio.\nFoi uma alegria acompanhar sua jornada. Nossa equipe continua ao seu lado para orientar os detalhes do seu atendimento.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"sale_payment":{"public_name":"Sua conquista","progress":100,"title":"{primeiro_nome}, você chegou lá! 🏠🔑","subtitle":"","body":"A assinatura com a Caixa marca a conquista do seu primeiro imóvel e um novo capítulo na construção do seu patrimônio.\nFoi uma alegria acompanhar sua jornada. Nossa equipe continua ao seu lado para orientar os detalhes do seu atendimento.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"awaiting_return":{"public_name":"Sua jornada","progress":null,"title":"Olá, {primeiro_nome}!","subtitle":"","body":"Seu atendimento está registrado. O caminho já percorrido continua aqui, e nossa equipe está disponível para conversar sobre o seu processo.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"archived":{"public_name":"Sua jornada","progress":null,"title":"Olá, {primeiro_nome}!","subtitle":"","body":"Seu atendimento está registrado. O caminho já percorrido continua aqui, e nossa equipe está disponível para conversar sobre o seu processo.","cta":"whatsapp","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."},"do_not_contact":{"public_name":"Sua jornada","progress":null,"title":"Olá, {primeiro_nome}!","subtitle":"","body":"Seu atendimento está registrado. O caminho já percorrido continua aqui, e nossa equipe está disponível para conversar sobre o seu processo.","cta":"none","cta_label":"Falar com meu corretor","notification":"Olá, {primeiro_nome}! 🔑\nSua jornada para a conquista do seu primeiro imóvel teve um novo avanço. 🏠\nClique abaixo e acompanhe a atualização do seu processo:\n{link_minha_jornada}\nSeu primeiro imóvel está cada vez mais perto."}}'::jsonb),
('client_journey_copy','{"brand":"Minha Jornada","celebration_title":"{primeiro_nome}, sua jornada teve um novo avanço!","celebration_subtitle":"Você está cada vez mais perto da conquista do seu primeiro imóvel.","greeting":"Olá, {primeiro_nome}! 👋","greeting_subtitle":"Este é o seu progresso atual.","progress_label":"Sua jornada","contact":"Olá! Vi a atualização da minha jornada e gostaria de entender melhor essa nova etapa. 🔑\nCódigo do meu atendimento: {codigo_cliente}"}'::jsonb)
on conflict(id) do nothing;

create table if not exists public.client_journeys (
 client_id uuid primary key references public.simulation_registrations(id) on delete cascade,
 token text not null unique default encode(extensions.gen_random_bytes(32),'hex'),
 progress integer not null default 0 check(progress between 0 and 100),
 previous_progress integer not null default 0 check(previous_progress between 0 and 100),
 current_status text not null,
 previous_status text,
 changed_at timestamptz,
 version integer not null default 1,
 notified_at timestamptz,
 notified_by text,
 notified_version integer
);
create table if not exists public.client_journey_events (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.simulation_registrations(id) on delete cascade,
 event_type text not null,
 previous_status text,
 new_status text,
 previous_progress integer,
 progress integer,
 actor text,
 occurred_at timestamptz not null default clock_timestamp()
);
create index if not exists client_journey_events_client_time on public.client_journey_events(client_id,occurred_at desc);
alter table public.client_journeys enable row level security;
alter table public.client_journey_events enable row level security;
revoke all on public.client_journeys, public.client_journey_events from anon, authenticated;
grant all on public.client_journeys, public.client_journey_events to service_role;

-- Preserve historical high water where status history is available, without
-- pretending that migration time is the time of an actual status change.
insert into public.client_journeys(client_id,current_status,progress,previous_progress)
select r.id,r.status,
 greatest(coalesce((s.setting_value->r.status->>'progress')::integer,0),coalesce(h.progress,0)),
 greatest(coalesce((s.setting_value->r.status->>'progress')::integer,0),coalesce(h.progress,0))
from public.simulation_registrations r
cross join public.crm_settings s
left join lateral (
 select max((s.setting_value->h.new_status->>'progress')::integer) progress
 from public.client_status_history h where h.client_id=r.id
) h on true
where s.id='client_journey_statuses'
on conflict(client_id) do nothing;

alter table public.client_origins add column if not exists source_kind text not null default 'unknown';
alter table public.client_origins add column if not exists source_label text not null default 'Origem não identificada';
alter table public.client_origins add column if not exists created_by text;
alter table public.client_origins add column if not exists initial_destination text;
alter table public.client_origins add column if not exists initial_responsible_id uuid;
alter table public.client_origins add column if not exists initial_responsible_name text;
alter table public.client_origins add column if not exists source_metadata jsonb not null default '{}';
create unique index if not exists client_origins_client_unique on public.client_origins(client_id);
update public.client_origins set source_kind='campaign', source_label=campaign_name_snapshot
where source_kind='unknown' and nullif(campaign_name_snapshot,'') is not null;
insert into public.client_origins(client_id,campaign_name_snapshot,source_kind,source_label,created_at)
select r.id,'','unknown','Origem não identificada',r.created_at from public.simulation_registrations r
where not exists(select 1 from public.client_origins o where o.client_id=r.id);
-- Initial destination is reconstructed only from the first assignment event.
update public.client_origins o set initial_destination='roulette',
initial_responsible_id=h.to_user_id, initial_responsible_name=u.name
from (select distinct on(registration_id) registration_id,to_user_id from public.lead_distribution_history where event_type='assigned' order by registration_id,created_at) h
left join public.admin_users u on u.id=h.to_user_id
where o.client_id=h.registration_id and o.initial_destination is null;

create or replace function public.guard_client_identity() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.client_code is distinct from old.client_code or new.acquisition_context is distinct from old.acquisition_context then
  raise exception 'Client code and original acquisition context are immutable';
 end if;
 return new;
end $$;
drop trigger if exists guard_client_identity on public.simulation_registrations;
create trigger guard_client_identity before update on public.simulation_registrations for each row execute function public.guard_client_identity();

create or replace function public.capture_client_journey() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 config jsonb;
 current_journey public.client_journeys%rowtype;
 next_progress integer;
 context jsonb;
begin
 select setting_value->new.status into config from public.crm_settings where id='client_journey_statuses';
 if tg_op='INSERT' then
  next_progress := coalesce((config->>'progress')::integer,0);
  insert into public.client_journeys(client_id,current_status,progress,previous_progress,changed_at)
  values(new.id,new.status,next_progress,0,clock_timestamp());
  context := coalesce(new.acquisition_context,'{}'::jsonb);
  insert into public.client_origins(client_id,campaign_id,campaign_name_snapshot,source_kind,source_label,created_by,initial_destination,initial_responsible_id,initial_responsible_name,source_metadata)
  values(new.id,nullif(context->>'campaign_id','')::uuid,coalesce(context->>'campaign_name',''),
    coalesce(context->>'kind','unknown'),coalesce(context->>'label','Origem não identificada'),context->>'actor',
    coalesce(context->>'destination',case when new.distribution_type='round_robin' then 'roulette' else 'broker' end),
    new.responsible_user_id,(select name from public.admin_users where id=new.responsible_user_id),
    coalesce(context->'metadata','{}'::jsonb))
  on conflict(client_id) do nothing;
  insert into public.client_journey_events(client_id,event_type,new_status,previous_progress,progress,actor)
  values(new.id,'created',new.status,0,next_progress,context->>'actor');
 elsif new.status is distinct from old.status then
  select * into current_journey from public.client_journeys where client_id=new.id for update;
  next_progress := greatest(current_journey.progress,coalesce((config->>'progress')::integer,0));
  update public.client_journeys set previous_progress=progress,previous_status=current_status,
    progress=next_progress,current_status=new.status,changed_at=clock_timestamp(),version=version+1
    where client_id=new.id;
  insert into public.client_journey_events(client_id,event_type,previous_status,new_status,previous_progress,progress,actor)
  values(new.id,'status',old.status,new.status,current_journey.progress,next_progress,
    case when new.last_admin_activity_at is distinct from old.last_admin_activity_at then new.last_admin_email else 'Sistema' end);
 end if;
 return new;
end $$;
revoke all on function public.capture_client_journey() from public,anon,authenticated;
drop trigger if exists capture_client_journey on public.simulation_registrations;
create trigger capture_client_journey after insert or update of status on public.simulation_registrations for each row execute function public.capture_client_journey();

create or replace function public.guard_original_source() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 -- Campaign deletion may clear the foreign key, but never its historical label.
 if (to_jsonb(new)-'campaign_id') is distinct from (to_jsonb(old)-'campaign_id')
 or (new.campaign_id is distinct from old.campaign_id and new.campaign_id is not null) then
  raise exception 'Original source is immutable';
 end if;
 return new;
end $$;
drop trigger if exists guard_original_source on public.client_origins;
create trigger guard_original_source before update on public.client_origins for each row execute function public.guard_original_source();

-- Atomic notice/regeneration and audit, callable only by the trusted server.
create or replace function public.client_journey_action(p_client uuid,p_action text,p_actor text,p_version integer default null)
returns public.client_journeys language plpgsql set search_path=public,pg_temp as $$
declare j public.client_journeys%rowtype;
begin
 select * into strict j from public.client_journeys where client_id=p_client for update;
 if p_action='notify' then
  if j.version <> p_version then raise exception 'O status mudou. Atualize o aviso antes de enviar.'; end if;
  update public.client_journeys set notified_at=clock_timestamp(),notified_by=p_actor,notified_version=version where client_id=p_client returning * into j;
 elsif p_action='regenerate' then
  update public.client_journeys set token=encode(extensions.gen_random_bytes(32),'hex') where client_id=p_client returning * into j;
 else raise exception 'Invalid action';
 end if;
 insert into public.client_journey_events(client_id,event_type,new_status,progress,actor) values(p_client,p_action,j.current_status,j.progress,p_actor);
 return j;
end $$;
revoke all on function public.client_journey_action(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.client_journey_action(uuid,text,text,integer) to service_role;
