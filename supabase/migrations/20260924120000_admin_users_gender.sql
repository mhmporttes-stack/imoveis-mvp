-- Sexo do usuário (masculino/feminino) para as mensagens automáticas do
-- WhatsApp concordarem com o gênero de quem atende (corretor/corretora,
-- nosso/nossa, o/a). Nulo = não informado (as mensagens usam "(a)").
alter table public.admin_users
  add column if not exists gender text;

alter table public.admin_users
  drop constraint if exists admin_users_gender_check;

alter table public.admin_users
  add constraint admin_users_gender_check check (gender is null or gender in ('male', 'female'));
