-- Adiciona os dois novos campos globais e genéricos de encerramento da
-- página pública "Minha Jornada" (frase/versículo + referência/autor).
-- Puramente aditivo: só preenche quando as chaves ainda não existem, sem
-- tocar em nenhum outro campo já configurado (title/body/etc. por status).
update public.crm_settings
set setting_value = setting_value || jsonb_build_object(
  'closing_quote', 'Tudo é possível ao que crê.',
  'closing_author', 'Marcos 9:23'
)
where id = 'client_journey_copy'
  and not (setting_value ? 'closing_quote');
