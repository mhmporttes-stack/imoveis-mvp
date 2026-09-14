-- Foto de perfil do corretor/administrador (avatar). Guardamos apenas a URL
-- pública do Supabase Storage — nunca base64 no banco.
alter table public.admin_users
  add column if not exists photo_url text;
