-- Nova experiencia "Como podemos te ajudar?" nos links publicos existentes
-- (Gerador de Links / /simulacao) — colunas 100% opcionais, sem default que
-- force um valor: cadastro antigo continua com journey_type/contact_preference
-- nulos, sem quebrar nada e sem precisar de backfill. journey_type registra
-- qual jornada o cliente escolheu (ex.: "quick_service", "simulation");
-- contact_preference so se aplica ao Atendimento Rapido (como o cliente
-- prefere ser contatado).
alter table public.simulation_registrations
  add column if not exists journey_type text,
  add column if not exists contact_preference text;

alter table public.simulation_registrations drop constraint if exists simulation_registrations_contact_preference_check;
alter table public.simulation_registrations
  add constraint simulation_registrations_contact_preference_check
  check (contact_preference is null or contact_preference in ('whatsapp', 'call'));

create index if not exists simulation_registrations_journey_type_idx on public.simulation_registrations (journey_type);
