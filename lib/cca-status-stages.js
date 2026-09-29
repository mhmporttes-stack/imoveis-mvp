import "server-only";
import { getSupabaseAdminClient } from "./supabase";

// Leitura do status semeado (tabela `cca_status_stages`) usado por
// lib/client-cca-status.js (openInitialCcaStatusOnSend) ao abrir o
// acompanhamento pós-envio à CCA. A tela de gestão que permitia
// criar/editar/desativar sub-status (aba "Status CCA" em /admin/corretores)
// e o seletor de sub-status no card do cliente foram removidos a pedido do
// dono — só sobrou a leitura do status fixo "awaiting_cca_return".
//
// `key` nunca muda depois de criado — é o que lib/cca-status-presentation.mjs
// usa pra reconhecer esse status especial (rótulo "Aguardando retorno de
// {CCA}" em vez de "{label} — {CCA}").

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

export async function getCcaStatusStage(id) {
  if (!id) return null;
  const { data, error } = await db().from("cca_status_stages").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToCcaStatusStage(data) : null;
}

// Usado por openInitialCcaStatusOnSend pra achar o status semeado
// "Aguardando retorno da CCA" sem depender do id (que varia por ambiente).
export async function getCcaStatusStageByKey(key) {
  if (!key) return null;
  const { data, error } = await db().from("cca_status_stages").select("*").eq("key", key).maybeSingle();
  if (error) throw error;
  return data ? rowToCcaStatusStage(data) : null;
}

function rowToCcaStatusStage(row) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    sortOrder: row.sort_order,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
