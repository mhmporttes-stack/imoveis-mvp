import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { PROPERTY_MEDIA_BUCKET } from "./media-storage";
import { getTodayInSaoPaulo } from "./daily-report";
import { extractCaptacaoUploadPathsFromValue, selectOrphanCaptacaoUploads } from "./captacao-upload-cleanup-core.mjs";

// Limpeza de fotos do upload PÚBLICO de captação (app/api/uploads/captacoes)
// que nunca foram usadas — decisão do dono, 2026-10-01. Quem abandona o
// formulário depois de enviar fotos deixava arquivos para sempre no bucket
// público de mídia de imóveis (pasta `captacoes/`).
//
// Segurança (nunca apagar foto em uso):
//   - só olha a pasta `captacoes/` do bucket (fotos do painel ficam em outras
//     pastas e nunca entram aqui);
//   - "em uso" = citada em `captacoes.photos_json` OU em
//     `properties.photos_json` (a captação convertida em imóvel reaproveita
//     as mesmas fotos — lib/captacoes.js);
//   - se a leitura das referências falhar, NÃO apaga nada;
//   - só apaga arquivo com mais de ORPHAN_MIN_AGE_HOURS (o formulário pode
//     ficar aberto um tempo entre enviar a foto e concluir);
//   - no máximo MAX_DELETES_PER_RUN por execução.
// Roda no máximo 1 vez por dia (marca em crm_settings), chamada pelo cron
// scheduled-activities — sem cron novo nem mudança de banco.
const SETTINGS_ID = "captacao_upload_cleanup";
const FOLDER = "captacoes";
const ORPHAN_MIN_AGE_HOURS = 72;
const MAX_DELETES_PER_RUN = 300;
const PAGE_SIZE = 1000;

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

async function loadReferencedPaths(supabase) {
  const referenced = new Set();
  for (const table of ["captacoes", "properties"]) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from(table)
        .select("id, photos_json")
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      for (const row of data || []) {
        for (const path of extractCaptacaoUploadPathsFromValue(row.photos_json)) referenced.add(path);
      }
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  return referenced;
}

async function listCaptacaoUploads(supabase) {
  const objects = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.storage
      .from(PROPERTY_MEDIA_BUCKET)
      .list(FOLDER, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    for (const item of data || []) {
      if (!item?.id || !item.name) continue; // subpastas não têm id
      objects.push({ path: `${FOLDER}/${item.name}`, createdAt: item.created_at || "" });
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  return objects;
}

export async function cleanupOrphanCaptacaoUploads({ now = Date.now(), dryRun = false } = {}) {
  const supabase = db();
  const referenced = await loadReferencedPaths(supabase);
  const objects = await listCaptacaoUploads(supabase);
  const orphans = selectOrphanCaptacaoUploads(objects, referenced, {
    now,
    minAgeMs: ORPHAN_MIN_AGE_HOURS * 60 * 60 * 1000,
    limit: MAX_DELETES_PER_RUN
  });
  if (!dryRun) {
    for (let index = 0; index < orphans.length; index += 100) {
      const { error } = await supabase.storage.from(PROPERTY_MEDIA_BUCKET).remove(orphans.slice(index, index + 100));
      if (error) throw error;
    }
  }
  return { checked: objects.length, referenced: referenced.size, deleted: dryRun ? 0 : orphans.length, orphans: orphans.length };
}

// Ponto de entrada do cron: no máximo uma execução por dia (fuso de São
// Paulo). A marca é gravada ANTES de rodar — uma falha não faz o cron de 2
// em 2 minutos tentar de novo o dia todo; tenta no dia seguinte.
export async function runCaptacaoUploadCleanupIfDue() {
  const supabase = db();
  const today = getTodayInSaoPaulo();
  const { data: setting, error } = await supabase.from("crm_settings").select("setting_value").eq("id", SETTINGS_ID).maybeSingle();
  if (error) throw error;
  if (setting?.setting_value?.lastRunDate === today) return { skipped: true };

  const { error: markError } = await supabase
    .from("crm_settings")
    .upsert({ id: SETTINGS_ID, setting_value: { lastRunDate: today }, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (markError) throw markError;

  const result = await cleanupOrphanCaptacaoUploads();
  await supabase
    .from("crm_settings")
    .upsert({ id: SETTINGS_ID, setting_value: { lastRunDate: today, lastResult: result }, updated_at: new Date().toISOString() }, { onConflict: "id" });
  return result;
}
