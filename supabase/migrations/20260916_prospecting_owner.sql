-- Separa a Prospecção em "Base da Imobiliária" (owner_user_id nulo, todos os
-- contatos já existentes) e "Minha Base" (owner_user_id preenchido = dono
-- individual). Não confundir com assigned_user_id (quem está atendendo).
alter table public.prospecting_contacts
  add column if not exists owner_user_id uuid references public.admin_users(id) on delete set null;

create index if not exists prospecting_contacts_owner_user_id_idx
  on public.prospecting_contacts (owner_user_id);
