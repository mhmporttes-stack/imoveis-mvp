-- Acumulado do Marketplace aguardando aprovação do dono (MKT-2m, REGRA OFICIAL — dono, 2026-10-26): "Isso é válido apenas
-- para as mensagens 'esse item ainda está disponível'. Se o cliente enviar alguma coisa diferente não recebe mensagem
-- automática, e o Henry depois na cena de bom dia me diz: '... 2 clientes eu estou aguardando sua aprovação para atender.'"
-- Conversa nova lida pela 1ª vez com a extensão fora (última mensagem do cliente entre 30 min e 7 dias) e com texto
-- diferente da pergunta padrão fica sem atendente, fora da roleta, até o dono aprovar (botão "Aprovar atendimento" no Chat
-- Marketplace ou por voz no Henry). Aprovar = entrega pelo caminho de sempre (roleta, lib/marketplace-chat.js `distribute`).
-- Só ACRESCENTA colunas e um índice parcial; nenhuma linha existente muda. Idempotente. Código: lib/marketplace-chat.js
-- (+ -core.mjs `planBacklogConversation`).
--   awaiting_owner_approval_at — desde quando aguarda a aprovação do dono; null = não aguarda.
--   owner_approved_at / owner_approved_by — quando e quem (e-mail do admin REAL) aprovou.

alter table public.marketplace_conversations add column if not exists awaiting_owner_approval_at timestamptz;
alter table public.marketplace_conversations add column if not exists owner_approved_at timestamptz;
alter table public.marketplace_conversations add column if not exists owner_approved_by text;

create index if not exists marketplace_conversations_awaiting_owner_idx
  on public.marketplace_conversations (awaiting_owner_approval_at)
  where awaiting_owner_approval_at is not null;

comment on column public.marketplace_conversations.awaiting_owner_approval_at is 'MKT-2m: conversa do acumulado (extensão fora) com texto diferente da pergunta padrão, fora da roleta até o dono aprovar. null = não aguarda.';
comment on column public.marketplace_conversations.owner_approved_at is 'MKT-2m: quando o dono aprovou o atendimento (botão ou Henry).';
comment on column public.marketplace_conversations.owner_approved_by is 'MKT-2m: e-mail do admin real que aprovou.';
