-- Advisor function_search_path_mutable (2026-10-10): 33 funções de public sem search_path fixo (Academia, Central, Chat,
-- roleta, contadores). Todas SECURITY INVOKER; "public, extensions" mantém a resolução de nomes que elas já usam (inclusive
-- funções de extensão, ex.: certificado da Academia) e só impede que um schema de quem chama as sombreie. Aditiva: não muda corpo.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
      and p.proname in (
        'set_updated_at','set_empreendimentos_atualizado_em','increment_whatsapp_automation_reply_count','whatsapp_chat_apply_inbound',
        'whatsapp_chat_apply_outbound','increment_whatsapp_flow_count','sync_whatsapp_conversation_assignee','whatsapp_phone_lock_key',
        'whatsapp_phone_key','crm_status_counts','crm_status_counts_by_broker','remove_broker_reassigning_clients','whatsapp_events_append_only',
        'central_tasks_touch_updated_at','central_claim_task','central_complete_task','central_renew_lease','central_requeue_own','central_decide_task',
        'academy_guard_version_update','academy_guard_published_content','academy_guard_question_update','academy_guard_published_exam',
        'academy_guard_attempt_limit','academy_refresh_enrollment','academy_complete_lesson','academy_record_attempt','academy_grant_extra_attempt',
        'academy_create_draft','academy_publish_version','academy_issue_certificate','academy_revoke_certificate','client_returned_from_user','crm_notifications_policy'
      )
  loop
    execute format('alter function %s set search_path = public, extensions', r.fn);
  end loop;
end $$;
