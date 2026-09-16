-- Gerador de Links vira também um painel de aquisição: (1) corrige a causa
-- raiz do "cadastro histórico encolhendo" quando um cliente é excluído; (2)
-- incorpora os links oficiais dos corretores/gestores/admin ao mesmo modelo
-- de campanhas já existente, para reaproveitar 100% da infraestrutura de
-- clique (campaign_link_views) e origem permanente (client_origins) que já
-- existe para links personalizados — sem criar uma segunda arquitetura.

-- 1) CAUSA RAIZ: client_origins.client_id tinha "on delete cascade" —
-- excluir um cliente apagava junto o registro permanente de origem daquele
-- link, reduzindo silenciosamente a contagem histórica. Troca para "on
-- delete set null" (exatamente o mesmo padrão já usado para campaign_id:
-- a campanha pode sumir, mas o snapshot/registro do evento de conversão
-- nunca some). client_id precisa virar nullable para isso ser possível.
alter table public.client_origins drop constraint if exists client_origins_client_id_fkey;
alter table public.client_origins alter column client_id drop not null;
alter table public.client_origins
  add constraint client_origins_client_id_fkey
  foreign key (client_id) references public.simulation_registrations(id) on delete set null;

-- O trigger de imutabilidade (guard_original_source) até então bloqueava
-- QUALQUER mudança em client_origins, exceto campaign_id virando nulo — o
-- que faria o próprio "on delete set null" de client_id falhar (a operação
-- de cascade é, por baixo dos panos, um UPDATE, e dispara o trigger BEFORE
-- UPDATE). Ajustado para permitir exatamente a mesma coisa em client_id:
-- só pode ir de um valor para nulo, nunca para um cliente diferente, e
-- nenhum outro campo pode mudar.
create or replace function public.guard_original_source() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if (to_jsonb(new)-'campaign_id'-'client_id') is distinct from (to_jsonb(old)-'campaign_id'-'client_id')
  or (new.campaign_id is distinct from old.campaign_id and new.campaign_id is not null)
  or (new.client_id is distinct from old.client_id and new.client_id is not null) then
    raise exception 'Original source is immutable';
  end if;
  return new;
end $$;

-- 2) Distingue "Link Oficial" (identidade do corretor/gestor/admin,
-- criado/gerenciado automaticamente pelo ciclo de vida do usuário) de
-- "Link Personalizado" (campanha criada manualmente no Gerador de Links).
-- Reaproveita a MESMA tabela campaigns — um link oficial é uma campanha
-- como outra qualquer para fins de clique/cadastro/conversão/funil, só não
-- pode ser editado/excluído pela tela (aplicado em lib/campaigns.js).
alter table public.campaigns add column if not exists kind text not null default 'custom'
  check (kind in ('official', 'custom'));
create unique index if not exists campaigns_official_broker_unique
  on public.campaigns (broker_id) where kind = 'official';
create index if not exists campaigns_kind_idx on public.campaigns (kind);

-- Backfill: um link oficial por usuário administrativo elegível (admin,
-- corretor, gestor — associado não tem carteira própria de clientes) que
-- ainda não tenha um. Status espelha o status atual da conta (ativo/
-- inativo) — mantido sincronizado dali em diante por lib/admin-profiles.js.
insert into public.campaigns (name, destination_type, broker_id, status, kind)
select u.name, 'broker', u.id, case when u.status = 'inactive' then 'inactive' else 'active' end, 'official'
from public.admin_users u
where u.role in ('admin', 'broker', 'manager')
  and not exists (select 1 from public.campaigns c where c.broker_id = u.id and c.kind = 'official');
