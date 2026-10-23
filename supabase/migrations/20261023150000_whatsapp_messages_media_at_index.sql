-- Aba "Mídias" de Particular (WA-35, dono 2026-10-23): listPrivateMediaGallery (lib/whatsapp-chat.js) lê as fotos,
-- vídeos, áudios e documentos mais recentes (sem figurinha) de todas as conversas Particulares, por página
-- (message_at desc, id desc). Índice parcial só nas mensagens de mídia; aditivo, não muda dado nenhum.
--
-- APLICAÇÃO: CREATE INDEX CONCURRENTLY não pode rodar dentro de transação. Aplique este arquivo SOZINHO, como um único
-- comando (client `pg`, sem BEGIN; nada de apply_migration do MCP, que embrulha em transação). Se precisar aplicar
-- dentro de transação, remova CONCURRENTLY (trava escrita na tabela durante a criação).
-- Se a criação concorrente falhar no meio, o índice fica INVALID: `drop index concurrently whatsapp_messages_media_at_idx;` e rode de novo.
-- Sem o índice a aba funciona igual, só mais lenta.
create index concurrently if not exists whatsapp_messages_media_at_idx
  on public.whatsapp_messages (message_at desc, id desc)
  where message_type in ('image', 'video', 'audio', 'document');
