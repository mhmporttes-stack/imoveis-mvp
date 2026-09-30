-- Pareamento por código numérico (pedido do dono, 2026-09-30): alternativa
-- ao QR Code — o corretor informa o próprio número, recebe um código de 8
-- caracteres do WhatsApp e digita em Aparelhos conectados > Conectar com
-- número de telefone. Mesmo padrão de persistência já usado pro QR
-- (qr_data/qr_expires_at), pra sobreviver a reload de página/polling.
alter table public.whatsapp_individual_sessions
  add column if not exists pairing_code text;

alter table public.whatsapp_individual_sessions
  drop constraint if exists whatsapp_individual_sessions_status_check;

alter table public.whatsapp_individual_sessions
  add constraint whatsapp_individual_sessions_status_check
  check (status in ('disconnected', 'connecting', 'qr_required', 'pairing_code_required', 'connected', 'reconnecting', 'error'));
