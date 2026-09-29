-- Painel "Incentivo" (Automações > Incentivo): amplia o esquema de
-- reconhecimentos para suportar animação por gatilho, disparo manual e
-- "restaurar padrão" dos textos.

-- 'random' sorteia entre as 4 animações-base a cada disparo; um valor fixo
-- ('confete'|'fogos'|'moedas'|'coroa') sempre usa a mesma. O combo dos 200%
-- nunca é escolhível aqui — é tratado à parte no motor (sempre 'combo_200').
alter table public.celebration_triggers
  add column if not exists animation_mode text not null default 'random'
    check (animation_mode in ('random', 'confete', 'fogos', 'moedas', 'coroa'));

-- is_default marca os textos originais (seed) — "Restaurar padrão" reativa
-- só estes e desativa qualquer texto que o admin tenha criado/editado,
-- preservando o original mesmo depois de customizado.
alter table public.celebration_message_templates
  add column if not exists is_default boolean not null default false;

update public.celebration_message_templates set is_default = true where is_default = false;

alter table public.celebration_message_templates
  add constraint celebration_message_templates_length_check check (char_length(template) <= 140);

-- Disparo manual (admin escolhe um corretor e manda uma mensagem agora,
-- mesma fila/regra de "visto" dos automáticos) vs. automático — só para
-- exibir no histórico e no formulário de disparo manual.
alter table public.broker_celebration_events
  add column if not exists source text not null default 'auto' check (source in ('auto', 'manual')),
  add column if not exists created_by uuid references public.admin_users(id) on delete set null;

create index if not exists broker_celebration_events_history_idx
  on public.broker_celebration_events (created_at desc);

-- Pseudo-gatilho só para satisfazer a referência de broker_celebration_events
-- quando o disparo é manual com texto livre (sem gatilho real por trás).
-- Nunca aparece na lista de liga/desliga do admin (o código filtra por key).
insert into public.celebration_triggers (key, enabled, config)
values ('manual', true, '{}')
on conflict (key) do nothing;
