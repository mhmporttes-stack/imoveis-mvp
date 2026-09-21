-- Guarda o detalhamento de cache (prompt caching) de cada chamada, pra
-- conseguir verificar/auditar que o cache_control esta funcionando de
-- verdade (cache_creation na primeira chamada, cache_read nas seguintes) e
-- pro extrato de gastos continuar preciso mesmo com cache ativo.
alter table public.ai_usage_log add column if not exists cache_creation_input_tokens integer not null default 0;
alter table public.ai_usage_log add column if not exists cache_read_input_tokens integer not null default 0;
