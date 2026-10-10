-- Chat (pedido do dono, 2026-10-10):
-- resolved_at/resolved_by: "Marcar como resolvida" — a conversa sai dos filtros de espera ("Sem resposta",
--   "Aguardando nós", "Sem retorno") sem ir para Arquivadas. Vale enquanto resolved_at >= last_message_at
--   (mensagem nova, de qualquer lado, desfaz sozinha).
-- ai_summary: resumo da conversa gerado por IA sob demanda ({ text, generated_at, message_count, model }).
alter table public.whatsapp_conversations
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.admin_users(id) on delete set null,
  add column if not exists ai_summary jsonb;
