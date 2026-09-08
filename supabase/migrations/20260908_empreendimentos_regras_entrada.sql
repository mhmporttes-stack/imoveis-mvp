-- Regras de simulação de entrada por empreendimento (motor mcmv-calculator).
-- Tabela separada da `properties`, ligada 1:1 pelo mesmo id (o id de uma
-- linha aqui é sempre o id da property/empreendimento correspondente).
-- As regras completas (descontos, estratégia de parcelamento, limites
-- editáveis, engenharia) ficam na coluna `regras`, no formato do tipo
-- `Empreendimento` (lib/simulacao-entrada/types.ts).

create table if not exists public.empreendimentos (
  id text primary key references public.properties(id) on delete cascade,
  nome text not null,
  ativo boolean not null default true,
  regras jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

create index if not exists empreendimentos_ativo_idx on public.empreendimentos (ativo);

-- Atualiza `atualizado_em` sozinho a cada edição.
create or replace function public.set_empreendimentos_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists empreendimentos_set_atualizado_em on public.empreendimentos;
create trigger empreendimentos_set_atualizado_em
before update on public.empreendimentos
for each row
execute function public.set_empreendimentos_atualizado_em();

-- Dados sensíveis de negociação (limites, tabelas de condições) — acesso
-- somente via service role no servidor (mesmo padrão de `financeiro`),
-- nunca direto do cliente. RLS habilitada sem política pública = bloqueado
-- por padrão para anon/authenticated.
alter table public.empreendimentos enable row level security;
