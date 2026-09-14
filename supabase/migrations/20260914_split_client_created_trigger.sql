-- Compatibiliza regras existentes com a divisão do gatilho "Novo cliente
-- cadastrado" em dois gatilhos distintos por origem: "Cliente se cadastrou
-- pelo formulário" (client_form_submitted) e "Corretor adicionou cliente"
-- (client_added_by_broker). A configuração anterior (crm_settings
-- new_client_notification_origins) só notificava origem "form" por padrão,
-- então as regras antigas equivalem semanticamente ao novo gatilho de
-- formulário.
update public.crm_automation_rules
set trigger_type = 'client_form_submitted'
where trigger_type = 'client_created';

delete from public.crm_settings
where id = 'new_client_notification_origins';
