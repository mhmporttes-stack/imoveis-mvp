-- Foto do cliente no Chat (2026-10-09): quando a foto de perfil foi consultada pela última vez (refresca a cada 7 dias).
alter table public.whatsapp_conversations add column if not exists profile_photo_checked_at timestamptz;
