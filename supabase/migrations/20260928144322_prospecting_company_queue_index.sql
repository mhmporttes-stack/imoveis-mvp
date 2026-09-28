-- Fila de prospecção "Base da Imobiliária" (owner_user_id nulo, lib/prospecting.js
-- listProspectingContacts scope "company") faz um full-ish scan hoje: filtra por
-- owner_user_id IS NULL (~21 mil das ~33 mil linhas da tabela), aplica o filtro de
-- status/available_after em memória e só depois ordena por created_at para pegar a
-- página — ~110-120ms por chamada, uma das consultas mais chamadas do CRM (tela vista
-- por todos os corretores). Índice parcial cobre exatamente essa forma da consulta:
-- Postgres já lê os dados na ordem certa (created_at desc) sem precisar ordenar depois.
create index if not exists prospecting_contacts_company_queue_idx
  on public.prospecting_contacts (created_at desc)
  where owner_user_id is null and status in ('available', 'recent_attempt');
