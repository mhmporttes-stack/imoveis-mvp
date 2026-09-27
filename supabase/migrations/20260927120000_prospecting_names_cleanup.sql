-- Faxina nos nomes da Prospecção (pedido do dono, 2026-09-27).
--
-- 1) Contato sem nome de verdade — nenhuma letra no campo (símbolo puro, telefone, data) OU o
--    "nome" é na verdade um e-mail (ex.: "Maudeli.Ribeiro@Hotmail.Com") — vira o texto "Sem Nome",
--    o MESMO já usado em ~300 contatos antigos (nenhum valor novo inventado).
-- 2) Símbolo puramente decorativo (* # ^ ° _ ~ ` $ % ") é removido de qualquer nome que ainda tenha
--    letra sobrando (ex.: "***Talita Dna" -> "Talita Dna", "## Cláudio ##" -> "Cláudio",
--    "°#Y_Maiel#°" -> "Y Maiel").
-- 3) Um pequeno dicionário de apelidos muito conhecidos e SEM ambiguidade é corrigido para o nome
--    de batismo (ex.: "Zé" -> "José", "Cadu"/"Kadu" -> "Carlos Eduardo", "Claudinho" -> "Cláudio").
--    Só os mais óbvios: apelido que pudesse apontar para mais de um nome (ex.: "Beto", "Duda", "Gabi")
--    fica como está — o risco de trocar o nome errado de um cliente de verdade é maior que o ganho.
-- 4) Contato "Sem Nome" nunca mais é sorteado numa campanha de Disparo (nem no sorteio manual, nem
--    na rotina diária) — pick_broadcast_base_contacts passa a excluir quem não tem nome de verdade.
--
-- NÃO tocado nesta faxina (risco maior que o benefício — ver docs/CHANGELOG_AI.md):
--  - nome com dígito colado (ex.: "Afonso/Ba0445", 228 contatos) — pode ser um código de importação
--    grudado no nome, não um símbolo decorativo puro;
--  - nomes de DUAS pessoas juntos por "/", "&" ou "|" (ex.: "Marcos Roberto Martins/Rute",
--    "Jessica Domenis | Personal Trainer") — remover o separador colaria os dois nomes num só, sem
--    separação nem como saber qual dos dois é o titular do telefone;
--  - "mojibake" (acentuação corrompida na importação, ex.: "Jos? Carlos", "Andrã?Ia", "Salomã£O") —
--    é um problema de CODIFICAÇÃO de caractere, não de símbolo decorativo; remover o "?" destruiria a
--    letra perdida ("José" viraria "Jos"). Precisa de um conserto próprio, não uma faxina de símbolos.
--
-- Idempotente: rodar de novo não muda nada (as 3 UPDATEs só afetam quem ainda está no formato antigo).

-- ---------------------------------------------------------------------------
-- PARTE 1 — sem nome de verdade -> "Sem Nome"
-- ---------------------------------------------------------------------------
update public.prospecting_contacts
set name = 'Sem Nome', updated_at = now()
where (regexp_replace(name, '[^[:alpha:]]', '', 'g') = '' or name ~ '@')
  and name <> 'Sem Nome';

-- ---------------------------------------------------------------------------
-- PARTE 2 — remove símbolo decorativo de quem ainda tem letra sobrando
-- ---------------------------------------------------------------------------
update public.prospecting_contacts p
set name = x.depois, updated_at = now()
from (
  select id, btrim(regexp_replace(regexp_replace(name, '[*#\^°_~`$%"]+', ' ', 'g'), '\s+', ' ', 'g')) as depois
  from public.prospecting_contacts
  where name ~ '[*#\^°_~`$%"]'
) x
where p.id = x.id
  and x.depois <> p.name
  and x.depois ~ '[[:alpha:]]';

-- quem ficaria sem nenhuma letra depois de remover o símbolo (nenhum caso hoje, mas por segurança
-- se algum apareu no futuro) também vira "Sem Nome", nunca um texto vazio.
update public.prospecting_contacts
set name = 'Sem Nome', updated_at = now()
where name ~ '[*#\^°_~`$%"]'
  and btrim(regexp_replace(regexp_replace(name, '[*#\^°_~`$%"]+', ' ', 'g'), '\s+', ' ', 'g')) !~ '[[:alpha:]]'
  and name <> 'Sem Nome';

-- ---------------------------------------------------------------------------
-- PARTE 3 — apelidos muito conhecidos e sem ambiguidade -> nome de batismo
-- (só troca o PRIMEIRO nome; sobrenome/resto do texto continua igual)
-- ---------------------------------------------------------------------------
with dict(apelido, formal) as (
  values
    ('ze', 'José'), ('zezinho', 'José'),
    ('claudinho', 'Cláudio'),
    ('toninho', 'Antônio'),
    ('joaozinho', 'João'),
    ('paulinho', 'Paulo'),
    ('carlinhos', 'Carlos'),
    ('marquinhos', 'Marcos'),
    ('robertinho', 'Roberto'),
    ('dudu', 'Eduardo'),
    ('gui', 'Guilherme'),
    ('vitinho', 'Vitor'), ('vitin', 'Vitor'),
    ('cadu', 'Carlos Eduardo'), ('kadu', 'Carlos Eduardo')
),
alvo as (
  select p.id, p.name,
    split_part(btrim(p.name), ' ', 1) as primeiro,
    btrim(substring(btrim(p.name) from length(split_part(btrim(p.name), ' ', 1)) + 1)) as resto
  from public.prospecting_contacts p
)
update public.prospecting_contacts p
set name = btrim(d.formal || ' ' || a.resto), updated_at = now()
from alvo a
join dict d on lower(translate(
  a.primeiro,
  'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
  'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
)) = d.apelido
where p.id = a.id;

-- ---------------------------------------------------------------------------
-- PARTE 4 — "Sem Nome" nunca mais é sorteado numa campanha de Disparo
-- (mesma função de antes, só com o filtro de nome novo nas duas metades do sorteio)
-- ---------------------------------------------------------------------------
create or replace function public.pick_broadcast_base_contacts(
  p_limit integer,
  p_min_days integer default 60,
  p_free_owner_ids uuid[] default '{}'
)
returns table (contact_id uuid, name text, phone text, tier integer, last_contact_at timestamptz)
language plpgsql
set search_path = public
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 0), 0);
  v_got integer := 0;
begin
  if v_limit = 0 then
    return;
  end if;

  return query
  select p.id, p.name, p.phone_normalized, 1, null::timestamptz
  from prospecting_contacts p
  where p.owner_user_id is null
    and p.status = 'available'
    and p.registration_id is null
    and p.last_attempt_at is null
    and coalesce(p.phone_normalized, '') <> ''
    and coalesce(btrim(p.name), '') <> '' and lower(btrim(p.name)) <> 'sem nome' and p.name ~ '[[:alpha:]]' and p.name !~ '@'
    and not exists (select 1 from whatsapp_broadcast_messages b where b.phone_normalized = p.phone_normalized)
    and not exists (select 1 from simulation_registrations r where r.phone_normalized = p.phone_normalized)
    and not exists (select 1 from whatsapp_conversations c where c.contact_phone = p.phone_normalized and c.deleted_at is null)
  order by random()
  limit v_limit;
  get diagnostics v_got = row_count;

  if v_got >= v_limit then
    return;
  end if;

  return query
  with candidates as (
    select p.id, p.name, p.phone_normalized as phone,
      greatest(
        p.last_attempt_at,
        (select max(coalesce(b.sent_at, b.queued_at)) from whatsapp_broadcast_messages b where b.phone_normalized = p.phone_normalized),
        (select max(c.last_message_at) from whatsapp_conversations c where c.contact_phone = p.phone_normalized and c.deleted_at is null),
        (select max(coalesce(r.last_whatsapp_contact_at, r.updated_at)) from simulation_registrations r where r.phone_normalized = p.phone_normalized)
      ) as last_contact
    from prospecting_contacts p
    where p.owner_user_id is null
      -- "recent_attempt" = cliente que um corretor tentou e ficou em espera (cooldown em available_after): só volta quando vencer.
      and (p.status = 'available' or (p.status = 'recent_attempt' and (p.available_after is null or p.available_after <= now())))
      and coalesce(p.phone_normalized, '') <> ''
      and coalesce(btrim(p.name), '') <> '' and lower(btrim(p.name)) <> 'sem nome' and p.name ~ '[[:alpha:]]' and p.name !~ '@'
      and not (p.registration_id is null and p.last_attempt_at is null
               and not exists (select 1 from whatsapp_broadcast_messages b where b.phone_normalized = p.phone_normalized)
               and not exists (select 1 from simulation_registrations r where r.phone_normalized = p.phone_normalized)
               and not exists (select 1 from whatsapp_conversations c where c.contact_phone = p.phone_normalized and c.deleted_at is null))
      and not exists (
        select 1 from simulation_registrations r
        where r.phone_normalized = p.phone_normalized
          and (r.status in ('do_not_contact', 'sale_completed')
               or (r.responsible_user_id is not null and not (r.responsible_user_id = any (p_free_owner_ids))))
      )
  )
  select c.id, c.name, c.phone, 2, c.last_contact
  from candidates c
  where c.last_contact is null or c.last_contact < now() - make_interval(days => greatest(coalesce(p_min_days, 60), 0))
  order by c.last_contact asc nulls first, random()
  limit (v_limit - v_got);
end;
$$;

revoke all on function public.pick_broadcast_base_contacts(integer, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.pick_broadcast_base_contacts(integer, integer, uuid[]) to service_role;
