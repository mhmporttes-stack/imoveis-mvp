-- "Assumir atendimento" também protege o cliente da redistribuição automática.
--
-- Antes: só uma RESPOSTA pelo Chat (last_human_reply_at) impedia a regra "REDISTRIBUIÇÃO DE LEADS" de devolver o
-- cliente à roleta. Quem clicava em "Assumir atendimento" (ou recebia a conversa de um gestor) e ainda não tinha
-- respondido via Chat via o cliente ir embora 5 minutos depois.
--
-- Agora o ato de assumir grava assumed_at/assumed_by na conversa. É um sinal separado de last_whatsapp_contact_at
-- (que alimenta Meta Diária/ranking/desempenho) — assumir NÃO conta ponto nenhum, só tira o cliente da redistribuição
-- automática. Liberar a conversa ("Ninguém") limpa o sinal.
--
-- Aditiva: 2 colunas anuláveis; nada existente muda.

alter table public.whatsapp_conversations
  add column if not exists assumed_at timestamptz,
  add column if not exists assumed_by uuid references public.admin_users(id) on delete set null;

-- Conversas que já estão "Em atendimento" com alguém: contam como assumidas desde a última atividade.
update public.whatsapp_conversations
set assumed_at = coalesce(last_human_reply_at, updated_at, now()),
    assumed_by = assigned_user_id
where status = 'in_service'
  and assigned_user_id is not null
  and assumed_at is null;
