-- Cadastro do corretor (pedido do dono, 2026-10-07): endereço, contato de emergência e CRECI digitável.
-- ADITIVA e idempotente: só colunas anuláveis em admin_users. has_creci continua existindo (o WhatsApp usa para
-- "corretor" x "associado"), agora derivado do texto do CRECI no código (preenchido = possui CRECI).
alter table public.admin_users
  add column if not exists creci text,
  add column if not exists address_street text,
  add column if not exists address_number text,
  add column if not exists address_neighborhood text,
  add column if not exists address_city text,
  add column if not exists address_state text,
  add column if not exists residence_type text,
  add column if not exists apartment_number text,
  add column if not exists address_complement text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_relationship text,
  add column if not exists emergency_contact_phone text;

-- Único usuário com "Possui CRECI" marcado (o dono): recebe o número do CRECI já usado no material da marca,
-- para o campo novo não aparecer vazio e não mudar o tratamento dele no WhatsApp ao editar.
update public.admin_users set creci = '323106-F' where has_creci = true and coalesce(creci, '') = '' and lower(email) = 'mhmporttes@gmail.com';
