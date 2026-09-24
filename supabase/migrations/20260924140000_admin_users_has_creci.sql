-- "Possui CRECI": quem tem é tratado como corretor(a) nas mensagens automáticas
-- do WhatsApp; quem não tem é sempre "associado(a) do corretor Matheus
-- Machado". Padrão falso (cada usuário é marcado pela tela de Usuários); o
-- administrador principal (o próprio corretor Matheus Machado) já entra marcado.
alter table public.admin_users
  add column if not exists has_creci boolean not null default false;

update public.admin_users set has_creci = true where role = 'admin';
