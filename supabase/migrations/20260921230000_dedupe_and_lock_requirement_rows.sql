-- Causa raiz de itens de checklist duplicados: duas chamadas concorrentes de
-- recalculo do motor de requisitos (ex.: duas abas, duplo clique em
-- "Reanalisar") faziam SELECT -> DELETE -> INSERT sem se enxergarem, e cada
-- uma inseria seu proprio conjunto de linhas "ausente"/"pendencia" (mesmo
-- client_id/person_role/document_type). Um indice unico parcial faz o banco
-- garantir isso sozinho, atomicamente, independente de quantas chamadas
-- concorrentes existirem — dai lib/client-documents.js troca o insert por um
-- upsert com esse indice como alvo do ON CONFLICT.
--
-- Antes de criar o indice, remove duplicatas ja existentes (mantem a mais
-- recente de cada grupo) para o create index nao falhar.
delete from public.client_document_checklist_items a
using public.client_document_checklist_items b
where a.document_id is null
  and b.document_id is null
  and a.client_id = b.client_id
  and a.person_role = b.person_role
  and a.document_type = b.document_type
  and a.corrected_by is null
  and (b.corrected_by is not null or a.created_at < b.created_at or (a.created_at = b.created_at and a.id < b.id));

create unique index if not exists client_document_checklist_items_requirement_key
  on public.client_document_checklist_items (client_id, person_role, document_type)
  where document_id is null;
