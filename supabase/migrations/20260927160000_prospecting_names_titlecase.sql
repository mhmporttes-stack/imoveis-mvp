-- Faxina nos nomes da Prospecção, parte 5 (pedido do dono, 2026-09-27).
--
-- Padroniza a capitalização de TODOS os nomes: só a primeira letra de cada palavra
-- maiúscula (ex.: "GENI CARDOSO" -> "Geni Cardoso", "joão" -> "João"). Diferente do
-- `initcap()` pronto do Postgres, preposições comuns de nome brasileiro (de, da, do,
-- das, dos) e o "e" de ligação ficam minúsculas quando não são a primeira palavra
-- (ex.: "SONIA MARIA ROSA DA SILVA" -> "Sonia Maria Rosa da Silva", não "Da Silva").
-- Só as letras são tocadas — número, símbolo, espaço e barra continuam exatamente
-- onde estavam (ex.: "Fran Oliver/eloisa" -> "Fran Oliver/Eloisa").
--
-- Função criada e removida dentro desta própria migration (uso único). Só atualiza
-- quem realmente muda (`name <> tmp_titlecase_pt(name)`) — rodar de novo não faz nada.

create or replace function public.tmp_titlecase_pt(input text) returns text
language plpgsql as $$
declare
  connectors text[] := array['de', 'da', 'do', 'das', 'dos', 'e'];
  m text[];
  out_text text := '';
  first_word boolean := true;
  w text;
  lw text;
begin
  if input is null then
    return null;
  end if;
  for m in select regexp_matches(input, '([[:alpha:]]+)|([^[:alpha:]]+)', 'g') loop
    if m[1] is not null then
      w := m[1];
      lw := lower(w);
      if not first_word and lw = any(connectors) then
        out_text := out_text || lw;
      else
        out_text := out_text || upper(substring(w from 1 for 1)) || lower(substring(w from 2));
      end if;
      first_word := false;
    else
      out_text := out_text || m[2];
    end if;
  end loop;
  return out_text;
end;
$$;

update public.prospecting_contacts
set name = public.tmp_titlecase_pt(name), updated_at = now()
where name <> public.tmp_titlecase_pt(name);

drop function public.tmp_titlecase_pt(text);
