-- Faxina nos nomes da Prospecção, parte 2 (pedido do dono, 2026-09-27).
--
-- Remove um código de imóvel/importação que ficou grudado no final do nome, sempre no mesmo
-- formato: 1 a 3 letras seguidas de 3 a 7 dígitos (ex.: "Suellen/Ca6908" -> "Suellen",
-- "Rafael Ba0069" -> "Rafael", "Lyandra Sl0031" -> "Lyandra") — ou um número solto no final,
-- às vezes com "Reais" (ex.: "Milena Pereira 500 Reais" -> "Milena Pereira",
-- "Dirce Batista 998767789" -> "Dirce Batista", claramente um valor ou telefone, não nome).
--
-- Conferido antes de aplicar: 261 casos do formato "letra+número" e 12 do "número solto",
-- todos revisados um a um.
--
-- Idempotente: rodar de novo não muda nada (só afeta quem ainda tem o sufixo).

update public.prospecting_contacts
set name = btrim(regexp_replace(name, '[[:space:]/]+[A-Za-z]{1,3}[0-9]{3,7}$', '')), updated_at = now()
where name ~ '[[:space:]/][A-Za-z]{1,3}[0-9]{3,7}$';

update public.prospecting_contacts
set name = btrim(regexp_replace(name, '[[:space:]]+[0-9]{3,}( [A-Za-z]+)?$', '')), updated_at = now()
where name ~ '[[:space:]][0-9]{3,}( [A-Za-z]+)?$'
  and name !~ '[[:space:]/][A-Za-z]{1,3}[0-9]{3,7}$';
