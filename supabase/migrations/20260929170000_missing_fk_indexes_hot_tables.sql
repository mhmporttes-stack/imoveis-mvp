-- Índices que faltavam em chaves estrangeiras de tabelas bem usadas
-- (identificado pelo advisor de performance do Supabase, 2026-09-29).
-- Sem índice, toda consulta que filtra/junta por essas colunas faz uma
-- varredura completa da tabela — piora conforme a tabela cresce. Não
-- inclui as ~55 outras chaves sem índice em tabelas de baixo tráfego
-- (deixadas de fora deste lote por não terem impacto real hoje) nem a
-- limpeza de índices nunca usados (96 encontrados — lote separado,
-- requer revisão mais cuidadosa antes de remover).

create index if not exists simulation_registrations_previous_responsible_user_id_idx on public.simulation_registrations (previous_responsible_user_id);
create index if not exists simulation_registrations_scheduled_activity_completed_by_idx on public.simulation_registrations (scheduled_activity_completed_by);

create index if not exists prospecting_contacts_do_not_contact_by_idx on public.prospecting_contacts (do_not_contact_by);
create index if not exists prospecting_contacts_last_broker_id_idx on public.prospecting_contacts (last_broker_id);
create index if not exists prospecting_contacts_registration_id_idx on public.prospecting_contacts (registration_id);

create index if not exists prospecting_history_registration_id_idx on public.prospecting_history (registration_id);
create index if not exists prospecting_history_user_id_idx on public.prospecting_history (user_id);

create index if not exists calendar_activities_created_by_idx on public.calendar_activities (created_by);
create index if not exists calendar_activities_rescheduled_from_id_idx on public.calendar_activities (rescheduled_from_id);
create index if not exists calendar_activities_rescheduled_to_id_idx on public.calendar_activities (rescheduled_to_id);

create index if not exists daily_goal_attempts_client_id_idx on public.daily_goal_attempts (client_id);

create index if not exists client_document_batches_uploaded_by_idx on public.client_document_batches (uploaded_by);
create index if not exists client_documents_uploaded_by_idx on public.client_documents (uploaded_by);
create index if not exists client_document_checklist_items_corrected_by_idx on public.client_document_checklist_items (corrected_by);
create index if not exists client_document_checklist_items_document_id_idx on public.client_document_checklist_items (document_id);
create index if not exists client_document_submissions_batch_id_idx on public.client_document_submissions (batch_id);
create index if not exists client_document_submissions_created_by_idx on public.client_document_submissions (created_by);
create index if not exists client_cca_status_history_created_by_idx on public.client_cca_status_history (created_by);

create index if not exists whatsapp_conversations_account_user_id_idx on public.whatsapp_conversations (account_user_id);
create index if not exists whatsapp_conversations_assigned_user_id_idx on public.whatsapp_conversations (assigned_user_id);
create index if not exists whatsapp_conversations_assumed_by_idx on public.whatsapp_conversations (assumed_by);
create index if not exists whatsapp_conversations_deleted_by_idx on public.whatsapp_conversations (deleted_by);
create index if not exists whatsapp_conversations_last_read_by_idx on public.whatsapp_conversations (last_read_by);
create index if not exists whatsapp_messages_session_user_id_idx on public.whatsapp_messages (session_user_id);
