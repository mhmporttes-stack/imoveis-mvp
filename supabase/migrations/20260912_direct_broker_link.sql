-- Marca clientes que entraram pelo link pessoal de simulação de um corretor
-- (/simulacao?ref=<simulationRef>, fora de campanha do Gerador de Links e da
-- roleta "equipe") — usado no Funil Comercial para contar esses clientes
-- diretamente em "Prospecção" e "Atendimentos", já que chegam atribuídos ao
-- corretor sem passar pela fila manual de prospecção.
alter table public.simulation_registrations
  add column if not exists direct_broker_link boolean not null default false;
