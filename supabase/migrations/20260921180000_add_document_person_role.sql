-- Motor de regras documentais determinístico: a IA passa a classificar CADA
-- documento (tipo, titular do documento, dados extraídos) e a atribuir de
-- qual PAPEL (titular/cônjuge/dependente/outro) ele é — o código (não mais a
-- IA) decide o que está "ausente" cruzando esses papéis com o cadastro real
-- do cliente (estado civil, tipo de renda). person_role é o que faltava para
-- o motor conseguir filtrar por papel sem depender de correspondência de
-- texto livre em person_label.
alter table public.client_document_checklist_items add column if not exists person_role text;
