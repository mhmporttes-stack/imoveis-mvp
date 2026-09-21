-- E-mail do cliente: nao existia nenhum campo pra isso no cadastro (so
-- telefone). Necessario pro cabecalho do PDF consolidado enviado pra CCA
-- (item 2 do pedido) e pro pacote de dados que ja acompanha o envio.
alter table public.simulation_registrations add column if not exists email text;

-- Guarda a URL assinada do PDF consolidado gerado no envio pra CCA, pra nao
-- precisar gerar de novo so pra reexibir o link.
alter table public.client_document_submissions add column if not exists merged_pdf_path text;
