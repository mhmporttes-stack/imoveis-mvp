-- Gerador de Links: "Excluir" passa a só REMOVER O LINK DA GESTÃO (lista do CRM), sem apagar a linha (pedido do dono,
-- 2026-10-07). Motivo: apagar falhava para links usados pelo Disparo (FK whatsapp_broadcasts.link_campaign_id sem
-- "on delete") e, quando apagava, levava junto cliques/envios duplicados (cascade) e quebrava a URL já enviada.
-- ADITIVA e idempotente: só uma coluna anulável; nulo = link normal (comportamento de hoje). Nada é lido, movido ou apagado.

alter table public.campaigns add column if not exists deleted_at timestamptz;

comment on column public.campaigns.deleted_at is
  'Quando o link foi excluído da gestão no CRM (some da lista). A URL já enviada continua resolvendo como antes.';
