-- Corrige erro real encontrado em teste ao vivo: o upsert de sincronização
-- (syncTemplatesFromMeta, onConflict: "name,language") precisa de um índice
-- único sobre as COLUNAS literais (name, language) — um índice de expressão
-- sobre lower(name) não é aceito pelo Postgres como alvo de ON CONFLICT
-- nessa forma. Como o nome já é normalizado para minúsculas antes de
-- submeter à Meta (normalizeTemplateName em lib/whatsapp-broadcasts.js) e a
-- própria Meta exige minúsculas/underscore nos nomes de template, um índice
-- simples em (name, language) já garante a mesma unicidade pretendida, sem
-- a expressão.
drop index if exists public.whatsapp_templates_name_language_key;
create unique index if not exists whatsapp_templates_name_language_key on public.whatsapp_templates (name, language);
