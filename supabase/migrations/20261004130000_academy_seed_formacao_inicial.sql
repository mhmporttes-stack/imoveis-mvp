-- Academia (F2) 4/4: conteúdo inicial "Formação Inicial" (estrutura da F1 como dado real).
-- Títulos neutros; corpo das aulas e questões são TEXTO DE EXEMPLO (body.sample=true) até o conteúdo real
-- (regras aprovadas) entrar pela F3. Idempotente: ids fixos + on conflict do nothing. Não cria matrícula nem progresso.
-- A versão nasce em rascunho, recebe o conteúdo e só então é publicada (a versão publicada é imutável).
-- Regra do dono (2026-10-04): nota mínima 70%; provas (final) com máximo de 3 tentativas; quiz de aula sem limite.

insert into public.academy_tracks (id, slug, title, kind, status, is_mandatory_default)
values ('a0000000-0000-4000-8000-000100000001', 'formacao-inicial', 'Formação Inicial', 'formacao_inicial', 'active', false)
on conflict (id) do nothing;

insert into public.academy_track_versions (id, track_id, version_number, status, change_note, settings)
select 'a0000000-0000-4000-8000-000200000001', 'a0000000-0000-4000-8000-000100000001', 1, 'draft', 'Estrutura inicial (conteúdo de exemplo)', '{"unlock_mode":"sequential","pass_score":70,"max_attempts":3,"quiz_max_attempts":null,"certificate_rule":"all_lessons_and_final_exam"}'::jsonb
where not exists (select 1 from public.academy_track_versions where id = 'a0000000-0000-4000-8000-000200000001');

insert into public.academy_modules (id, track_version_id, stable_key, position, title, summary, unlock_rule, is_final, requires_exam)
select * from (values
  ('a0000000-0000-4000-8000-000300000001'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000300000101'::uuid, 1, 'Integração e mercado', null::text, null::jsonb, false, false),
  ('a0000000-0000-4000-8000-000300000002'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000300000102'::uuid, 2, 'Financiamento e poder de compra', null::text, null::jsonb, false, false),
  ('a0000000-0000-4000-8000-000300000003'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000300000103'::uuid, 3, 'Renda, documentos e benefícios', null::text, null::jsonb, false, false),
  ('a0000000-0000-4000-8000-000300000004'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000300000104'::uuid, 4, 'Jornada e CRM', null::text, null::jsonb, false, false),
  ('a0000000-0000-4000-8000-000300000005'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000300000105'::uuid, 5, 'Atendimento e venda', null::text, null::jsonb, false, false),
  ('a0000000-0000-4000-8000-000300000006'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000300000106'::uuid, 6, 'Prova final', null::text, null::jsonb, true, false)
) as v(id, track_version_id, stable_key, position, title, summary, unlock_rule, is_final, requires_exam)
where exists (select 1 from public.academy_track_versions where id = 'a0000000-0000-4000-8000-000200000001' and status = 'draft')
on conflict (id) do nothing;

insert into public.academy_lessons (id, module_id, stable_key, position, title, est_minutes, kind, body)
select * from (values
  ('a0000000-0000-4000-8000-000400000001'::uuid, 'a0000000-0000-4000-8000-000300000001'::uuid, 'a0000000-0000-4000-8000-000400000101'::uuid, 1, 'Integração à operação', 9, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000002'::uuid, 'a0000000-0000-4000-8000-000300000001'::uuid, 'a0000000-0000-4000-8000-000400000102'::uuid, 2, 'Mercado imobiliário e papel do corretor', 12, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000003'::uuid, 'a0000000-0000-4000-8000-000300000002'::uuid, 'a0000000-0000-4000-8000-000400000103'::uuid, 1, 'Fundamentos do financiamento habitacional', 14, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000004'::uuid, 'a0000000-0000-4000-8000-000300000002'::uuid, 'a0000000-0000-4000-8000-000400000104'::uuid, 2, 'Minha Casa Minha Vida', 11, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000005'::uuid, 'a0000000-0000-4000-8000-000300000002'::uuid, 'a0000000-0000-4000-8000-000400000105'::uuid, 3, 'Simulação e poder de compra', 15, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000006'::uuid, 'a0000000-0000-4000-8000-000300000003'::uuid, 'a0000000-0000-4000-8000-000400000106'::uuid, 1, 'Tipos de renda', 10, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000007'::uuid, 'a0000000-0000-4000-8000-000300000003'::uuid, 'a0000000-0000-4000-8000-000400000107'::uuid, 2, 'Comprovação de renda', 13, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000008'::uuid, 'a0000000-0000-4000-8000-000300000003'::uuid, 'a0000000-0000-4000-8000-000400000108'::uuid, 3, 'Documentação', 12, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000009'::uuid, 'a0000000-0000-4000-8000-000300000003'::uuid, 'a0000000-0000-4000-8000-000400000109'::uuid, 4, 'FGTS', 8, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000010'::uuid, 'a0000000-0000-4000-8000-000300000003'::uuid, 'a0000000-0000-4000-8000-000400000110'::uuid, 5, 'Subsídios e benefícios', 12, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000011'::uuid, 'a0000000-0000-4000-8000-000300000004'::uuid, 'a0000000-0000-4000-8000-000400000111'::uuid, 1, 'Jornada do cliente', 11, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000012'::uuid, 'a0000000-0000-4000-8000-000300000004'::uuid, 'a0000000-0000-4000-8000-000400000112'::uuid, 2, 'Etapas do CRM', 10, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000013'::uuid, 'a0000000-0000-4000-8000-000300000005'::uuid, 'a0000000-0000-4000-8000-000400000113'::uuid, 1, 'Atendimento', 9, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000014'::uuid, 'a0000000-0000-4000-8000-000300000005'::uuid, 'a0000000-0000-4000-8000-000400000114'::uuid, 2, 'Guia de Atendimento', 12, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000015'::uuid, 'a0000000-0000-4000-8000-000300000005'::uuid, 'a0000000-0000-4000-8000-000400000115'::uuid, 3, 'Prospecção', 14, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000016'::uuid, 'a0000000-0000-4000-8000-000300000005'::uuid, 'a0000000-0000-4000-8000-000400000116'::uuid, 4, 'Reunião', 10, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000017'::uuid, 'a0000000-0000-4000-8000-000300000005'::uuid, 'a0000000-0000-4000-8000-000400000117'::uuid, 5, 'Venda', 13, 'lesson', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb),
  ('a0000000-0000-4000-8000-000400000018'::uuid, 'a0000000-0000-4000-8000-000300000006'::uuid, 'a0000000-0000-4000-8000-000400000118'::uuid, 1, 'Prova final', 30, 'final_exam', '{"sample":true,"blocks":[{"type":"paragraph","text":"Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas."}]}'::jsonb)
) as v(id, module_id, stable_key, position, title, est_minutes, kind, body)
where exists (select 1 from public.academy_track_versions where id = 'a0000000-0000-4000-8000-000200000001' and status = 'draft')
on conflict (id) do nothing;

insert into public.academy_questions (id, stable_key, qversion, type, statement, options, correct, explanation, topic, status)
select * from (values
  ('a0000000-0000-4000-8000-000900000001'::uuid, 'a0000000-0000-4000-8000-000900000101'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Integração à operação".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Integração à operação', 'active'),
  ('a0000000-0000-4000-8000-000900000002'::uuid, 'a0000000-0000-4000-8000-000900000102'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Mercado imobiliário e papel do corretor".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Mercado imobiliário e papel do corretor', 'active'),
  ('a0000000-0000-4000-8000-000900000003'::uuid, 'a0000000-0000-4000-8000-000900000103'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Fundamentos do financiamento habitacional".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Fundamentos do financiamento habitacional', 'active'),
  ('a0000000-0000-4000-8000-000900000004'::uuid, 'a0000000-0000-4000-8000-000900000104'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Minha Casa Minha Vida".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Minha Casa Minha Vida', 'active'),
  ('a0000000-0000-4000-8000-000900000005'::uuid, 'a0000000-0000-4000-8000-000900000105'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Simulação e poder de compra".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Simulação e poder de compra', 'active'),
  ('a0000000-0000-4000-8000-000900000006'::uuid, 'a0000000-0000-4000-8000-000900000106'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Tipos de renda".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Tipos de renda', 'active'),
  ('a0000000-0000-4000-8000-000900000007'::uuid, 'a0000000-0000-4000-8000-000900000107'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Comprovação de renda".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Comprovação de renda', 'active'),
  ('a0000000-0000-4000-8000-000900000008'::uuid, 'a0000000-0000-4000-8000-000900000108'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Documentação".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Documentação', 'active'),
  ('a0000000-0000-4000-8000-000900000009'::uuid, 'a0000000-0000-4000-8000-000900000109'::uuid, 1, 'single', 'Pergunta de exemplo sobre "FGTS".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'FGTS', 'active'),
  ('a0000000-0000-4000-8000-000900000010'::uuid, 'a0000000-0000-4000-8000-000900000110'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Subsídios e benefícios".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Subsídios e benefícios', 'active'),
  ('a0000000-0000-4000-8000-000900000011'::uuid, 'a0000000-0000-4000-8000-000900000111'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Jornada do cliente".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Jornada do cliente', 'active'),
  ('a0000000-0000-4000-8000-000900000012'::uuid, 'a0000000-0000-4000-8000-000900000112'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Etapas do CRM".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Etapas do CRM', 'active'),
  ('a0000000-0000-4000-8000-000900000013'::uuid, 'a0000000-0000-4000-8000-000900000113'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Atendimento".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Atendimento', 'active'),
  ('a0000000-0000-4000-8000-000900000014'::uuid, 'a0000000-0000-4000-8000-000900000114'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Guia de Atendimento".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Guia de Atendimento', 'active'),
  ('a0000000-0000-4000-8000-000900000015'::uuid, 'a0000000-0000-4000-8000-000900000115'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Prospecção".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Prospecção', 'active'),
  ('a0000000-0000-4000-8000-000900000016'::uuid, 'a0000000-0000-4000-8000-000900000116'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Reunião".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Reunião', 'active'),
  ('a0000000-0000-4000-8000-000900000017'::uuid, 'a0000000-0000-4000-8000-000900000117'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Venda".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Venda', 'active'),
  ('a0000000-0000-4000-8000-000900000018'::uuid, 'a0000000-0000-4000-8000-000900000118'::uuid, 1, 'single', 'Pergunta de exemplo sobre "Prova final".', '[{"id":"a","text":"Alternativa A de exemplo"},{"id":"b","text":"Alternativa B de exemplo (correta)"},{"id":"c","text":"Alternativa C de exemplo"}]'::jsonb, '["b"]'::jsonb, 'Resposta correta (exemplo).', 'Prova final', 'active')
) as v(id, stable_key, qversion, type, statement, options, correct, explanation, topic, status)
on conflict (id) do nothing;

insert into public.academy_exams (id, track_version_id, lesson_id, kind, pass_score, max_attempts)
select * from (values
  ('a0000000-0000-4000-8000-000a00000001'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000001'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000002'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000002'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000003'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000003'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000004'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000004'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000005'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000005'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000006'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000006'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000007'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000007'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000008'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000008'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000009'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000009'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000010'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000010'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000011'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000011'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000012'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000012'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000013'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000013'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000014'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000014'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000015'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000015'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000016'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000016'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000017'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000017'::uuid, 'quiz', null::int, null::int),
  ('a0000000-0000-4000-8000-000a00000018'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid, 'a0000000-0000-4000-8000-000400000018'::uuid, 'final', null::int, 3)
) as v(id, track_version_id, lesson_id, kind, pass_score, max_attempts)
where exists (select 1 from public.academy_track_versions where id = 'a0000000-0000-4000-8000-000200000001' and status = 'draft')
on conflict (id) do nothing;

insert into public.academy_exam_questions (exam_id, question_id, position, weight)
select * from (values
  ('a0000000-0000-4000-8000-000a00000001'::uuid, 'a0000000-0000-4000-8000-000900000001'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000002'::uuid, 'a0000000-0000-4000-8000-000900000002'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000003'::uuid, 'a0000000-0000-4000-8000-000900000003'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000004'::uuid, 'a0000000-0000-4000-8000-000900000004'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000005'::uuid, 'a0000000-0000-4000-8000-000900000005'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000006'::uuid, 'a0000000-0000-4000-8000-000900000006'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000007'::uuid, 'a0000000-0000-4000-8000-000900000007'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000008'::uuid, 'a0000000-0000-4000-8000-000900000008'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000009'::uuid, 'a0000000-0000-4000-8000-000900000009'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000010'::uuid, 'a0000000-0000-4000-8000-000900000010'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000011'::uuid, 'a0000000-0000-4000-8000-000900000011'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000012'::uuid, 'a0000000-0000-4000-8000-000900000012'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000013'::uuid, 'a0000000-0000-4000-8000-000900000013'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000014'::uuid, 'a0000000-0000-4000-8000-000900000014'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000015'::uuid, 'a0000000-0000-4000-8000-000900000015'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000016'::uuid, 'a0000000-0000-4000-8000-000900000016'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000017'::uuid, 'a0000000-0000-4000-8000-000900000017'::uuid, 1, 1::numeric),
  ('a0000000-0000-4000-8000-000a00000018'::uuid, 'a0000000-0000-4000-8000-000900000018'::uuid, 1, 1::numeric)
) as v(exam_id, question_id, position, weight)
where exists (select 1 from public.academy_track_versions where id = 'a0000000-0000-4000-8000-000200000001' and status = 'draft')
on conflict (exam_id, question_id) do nothing;

update public.academy_track_versions set status = 'published', published_at = now()
where id = 'a0000000-0000-4000-8000-000200000001' and status = 'draft';
