-- MKT-2e (REGRA OFICIAL — dono, 2026-10-22): "O cliente novo do Marketplace deve seguir as mesmas regras da roleta: ser
-- distribuído para corretor on-line com WhatsApp conectado. Se ele não responder a tempo, o cliente é transferido
-- novamente."
-- Origem da atribuição da conversa: só a entregue pela roleta tem prazo de resposta. 1ª carga (escolha do dono),
-- transferência manual e "quem respondeu assumiu" nunca são redistribuídas. Linhas existentes ficam com NULL = tratadas
-- como 1ª carga (fora do prazo). lost_by_user_id = quem perdeu pelo prazo e foi para a fila de espera (não recebe de volta).
-- Aditiva e idempotente; sem DROP. Código: lib/marketplace-chat.js (+ -core.mjs).

alter table public.marketplace_conversations add column if not exists assignment_source text;
alter table public.marketplace_conversations add column if not exists lost_by_user_id uuid references public.admin_users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'marketplace_conversations_assignment_source_check') then
    alter table public.marketplace_conversations add constraint marketplace_conversations_assignment_source_check
      check (assignment_source is null or assignment_source in ('roulette', 'roulette_stalled', 'first_load', 'manual', 'reply'));
  end if;
end $$;

create index if not exists marketplace_conversations_roulette_deadline_idx
  on public.marketplace_conversations (assigned_at)
  where assignment_source = 'roulette' and assigned_user_id is not null;

comment on column public.marketplace_conversations.assignment_source is 'Origem da atribuição (MKT-2e): roulette (tem prazo de resposta), roulette_stalled, first_load, manual, reply. NULL = antes da coluna (tratada como 1ª carga).';
comment on column public.marketplace_conversations.lost_by_user_id is 'Quem perdeu a conversa pelo prazo e a mandou para a fila de espera (ROL-4a): a fila entrega a outro corretor.';
