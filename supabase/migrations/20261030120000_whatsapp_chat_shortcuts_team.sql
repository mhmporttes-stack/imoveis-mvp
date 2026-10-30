-- "Pacote da equipe" dos atalhos do Chat (WA-37, dono, 2026-10-30): atalho criado por gestor marcado "só da minha equipe"
-- fica visível só para ele, os corretores dele, os associados desses corretores e o administrador geral.
-- NULL = atalho geral (todos), como sempre foi. Sem perda de dado.
alter table public.whatsapp_chat_shortcuts
  add column if not exists team_manager_id uuid references public.admin_users(id) on delete set null;
