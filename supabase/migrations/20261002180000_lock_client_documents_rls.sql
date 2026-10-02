-- Fecha o acesso público às tabelas da Documentação/CCA e ao log de uso de IA.
--
-- Problema (achado em 2026-10-02): client_documents, client_document_batches,
-- client_document_checklist_items, client_document_submissions e ai_usage_log
-- foram criadas sem RLS e com os grants padrão do Supabase para anon e
-- authenticated (SELECT, INSERT, UPDATE, DELETE, TRUNCATE...). Resultado:
-- qualquer pessoa com a anon key pública (embutida no site) lia via PostgREST
-- CPF/PIS extraídos, nomes de arquivo, mensagens de envio à CCA com URLs
-- assinadas e o log de IA, e podia alterar/apagar essas linhas. A cca já
-- tinha RLS (0 linhas visíveis), mas ainda tinha os grants.
--
-- Nenhum fluxo legítimo usa anon/authenticated nessas tabelas: todo acesso
-- é pelo servidor com a service role (lib/client-documents.js,
-- lib/client-document-pdf.js, lib/cca.js, lib/ai-usage.js,
-- lib/broker-alert.js, lib/attendance-audit.js -> getSupabaseAdminClient),
-- que ignora RLS e mantém seus próprios grants. O navegador só sobe arquivos
-- no Storage por URL assinada (storage.objects, não afetado). Não há views,
-- funções, triggers, policies ou publicação Realtime sobre essas tabelas.
--
-- Padrão do projeto (.claude/rules/database-supabase.md): RLS habilitado e
-- nenhuma policy pública. Idempotente; não altera dados.

alter table public.client_documents enable row level security;
alter table public.client_document_batches enable row level security;
alter table public.client_document_checklist_items enable row level security;
alter table public.client_document_submissions enable row level security;
alter table public.ai_usage_log enable row level security;
alter table public.cca enable row level security;

revoke all on table
  public.client_documents,
  public.client_document_batches,
  public.client_document_checklist_items,
  public.client_document_submissions,
  public.ai_usage_log,
  public.cca
from anon, authenticated;
