import "server-only";
import { CLIENT_STATUS } from "./client-status";
import { getSupabaseAdminClient } from "./supabase";
import { acquireLock, releaseLock } from "./crm-metrics/cache";
import { recordClientStatusChange } from "./client-status-history";
import { loadRecentAttendanceByClient } from "./client-attendance";
import { loadLatestCalendarActivity, rowToClient } from "./daily-goal-pending";
import { loadRestrictionTagClientIds } from "./cooled-clients-reactivation";
import { loadApprovalHistoryByClient, loadRestrictionClosedAtByClient } from "./cooled-clients";
import { resolveAlertDeliveriesByPrefix } from "./crm-alerts";
import { COOLED_DEDUPE_PREFIX, CASE_STATUS, OPEN_CASE_STATUSES } from "./cooled-clients-core.mjs";
import { viewerSeesCooledArchive } from "./cooled-archive-hidden";
import {
  COOLED_ARCHIVE_BATCH,
  COOLED_ARCHIVE_CANCELED_REASON,
  COOLED_ARCHIVE_REASON,
  COOLED_ARCHIVE_SETTING_ID,
  COOLED_ARCHIVE_SOURCE,
  COOLED_ARCHIVE_TAG,
  cooledTransferArchiveBlockReason,
  latestTransferCase,
  maskPhone
} from "./cooled-transfer-archive-core.mjs";

// Cliente frio transferido e sem retorno -> arquivado sozinho (FUN-15q, REGRA OFICIAL — dono, 2026-11-09). Regras puras em
// lib/cooled-transfer-archive-core.mjs; leitura dos ids escondidos em lib/cooled-archive-hidden.js. Mesmo padrão da Lista
// fria (lib/cold-list.js): trava, lote pequeno por rodada, um UPDATE por cliente (nunca em massa), falha de um cliente
// não derruba os outros. Sem migration.
const PAGE = 1000;
const CHUNK = 150;
const SLICE = 100;
const SAMPLE_SIZE = 20;
const CLIENT_COLUMNS = "id, full_name, phone, phone_normalized, status, responsible_user_id, last_whatsapp_contact_at, last_status_change_at, created_at, scheduled_activity_at, scheduled_activity_completed_at, private_contact_at, responsible_changed_at, approved_at, pending_distribution_at";
const CASE_COLUMNS = "id, client_id, broker_id, status, decision, transferred_to, decided_at, closed_at, opened_at, reactivation_status";

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase não configurado.");
  return client;
}

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function inChunks(ids, run) {
  const list = [...new Set((ids || []).filter(Boolean))];
  const rows = [];
  for (let from = 0; from < list.length; from += CHUNK) rows.push(...(await run(list.slice(from, from + CHUNK))));
  return rows;
}

// ---------------------------------------------------------------------------
// Liga/desliga (nasce DESLIGADO: o dono confere o preview antes de ligar). Sem linha = desligado.
// ---------------------------------------------------------------------------

export async function getCooledTransferArchiveSettings() {
  const { data, error } = await db().from("crm_settings").select("setting_value, updated_at").eq("id", COOLED_ARCHIVE_SETTING_ID).maybeSingle();
  if (error) throw error;
  return { enabled: data?.setting_value?.enabled === true, updatedAt: data?.updated_at || null };
}

export async function setCooledTransferArchiveEnabled(auth, enabled) {
  if (!viewerSeesCooledArchive(auth)) {
    const error = new Error("Apenas o dono liga ou desliga o arquivamento automático.");
    error.status = 403;
    throw error;
  }
  const now = new Date().toISOString();
  const { error } = await db().from("crm_settings").upsert({ id: COOLED_ARCHIVE_SETTING_ID, setting_value: { enabled: Boolean(enabled) }, updated_by: auth.profile?.id || null, updated_at: now }, { onConflict: "id" });
  if (error) throw error;
  return { enabled: Boolean(enabled), updatedAt: now };
}

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

// Última mensagem RECEBIDA do cliente em qualquer conversa (do cliente ou do mesmo telefone), de qualquer número.
async function loadClientRepliedAt(clients) {
  const byClient = new Map();
  const latest = (clientId, at) => {
    if (!clientId || !at) return;
    if (!byClient.has(clientId) || Date.parse(at) > Date.parse(byClient.get(clientId))) byClient.set(clientId, at);
  };
  const [byId, byPhone] = await Promise.all([
    inChunks(clients.map((client) => client.id), async (ids) => {
      const { data, error } = await db().from("whatsapp_conversations").select("client_id, last_inbound_at").in("client_id", ids).not("last_inbound_at", "is", null);
      if (error) throw error;
      return data || [];
    }),
    inChunks(clients.map((client) => client.phone_normalized), async (phones) => {
      const { data, error } = await db().from("whatsapp_conversations").select("contact_phone, last_inbound_at").in("contact_phone", phones).not("last_inbound_at", "is", null);
      if (error) throw error;
      return data || [];
    })
  ]);
  for (const row of byId) latest(row.client_id, row.last_inbound_at);
  const idsByPhone = new Map();
  for (const client of clients) {
    if (!client.phone_normalized) continue;
    if (!idsByPhone.has(client.phone_normalized)) idsByPhone.set(client.phone_normalized, []);
    idsByPhone.get(client.phone_normalized).push(client.id);
  }
  for (const row of byPhone) for (const id of idsByPhone.get(row.contact_phone) || []) latest(id, row.last_inbound_at);
  return byClient;
}

function clientInput(row, extra = {}) {
  return {
    status: row.status,
    privateContactAt: row.private_contact_at || null,
    responsibleUserId: row.responsible_user_id || "",
    responsibleChangedAt: row.responsible_changed_at || null,
    pendingDistributionAt: row.pending_distribution_at || null,
    lastWhatsappContactAt: row.last_whatsapp_contact_at || null,
    lastStatusChangeAt: row.last_status_change_at || null,
    createdAt: row.created_at || null,
    approvedAt: row.approved_at || null,
    ...extra
  };
}

// Candidatos (mais antigos primeiro). `limit`: para de procurar ao juntar essa quantidade (a rotina); sem limite, olha
// todos (a conferência do dono). Pré-filtro barato primeiro; as leituras pesadas só rodam nos que sobraram, em fatias.
async function findCandidates({ limit = Infinity, now = Date.now() } = {}) {
  const caseRows = await fetchAll(() => db().from("cooled_client_cases").select(CASE_COLUMNS).or("decision.eq.transferred,transferred_to.not.is.null").order("id", { ascending: true }));
  const casesByClient = new Map();
  for (const row of caseRows) {
    if (!casesByClient.has(row.client_id)) casesByClient.set(row.client_id, []);
    casesByClient.get(row.client_id).push(row);
  }
  const clientRows = await inChunks([...casesByClient.keys()], async (ids) => {
    const { data, error } = await db().from("simulation_registrations").select(CLIENT_COLUMNS).in("id", ids);
    if (error) throw error;
    return data || [];
  });

  const skipped = {};
  const survivors = [];
  for (const row of clientRows) {
    const cases = casesByClient.get(row.id) || [];
    const reason = cooledTransferArchiveBlockReason({ client: clientInput(row), cases, now });
    // Só "ainda não dá para saber" segue para as leituras pesadas: os motivos baratos já decidem.
    if (reason) { skipped[reason] = (skipped[reason] || 0) + 1; continue; }
    survivors.push({ row, cases, transferAt: Date.parse(latestTransferCase(cases)?.decided_at || "") || 0 });
  }
  survivors.sort((a, b) => a.transferAt - b.transferAt || String(a.row.id).localeCompare(String(b.row.id)));

  const candidates = [];
  for (let from = 0; from < survivors.length && candidates.length < limit; from += SLICE) {
    const slice = survivors.slice(from, from + SLICE);
    const ids = slice.map((item) => item.row.id);
    const earliest = slice.map((item) => item.transferAt).filter(Boolean).sort((a, b) => a - b)[0] || now - 90 * 24 * 60 * 60 * 1000;
    const [history, restrictionTagged, restrictionClosedAt, calendarLatest, attendance, replied] = await Promise.all([
      loadApprovalHistoryByClient(ids),
      loadRestrictionTagClientIds(ids),
      loadRestrictionClosedAtByClient(ids),
      loadLatestCalendarActivity(ids),
      loadRecentAttendanceByClient(db(), { sinceIso: new Date(earliest).toISOString(), clientIds: ids }),
      loadClientRepliedAt(slice.map((item) => item.row))
    ]);
    for (const item of slice) {
      if (candidates.length >= limit) break;
      const { row, cases } = item;
      const reason = cooledTransferArchiveBlockReason({
        client: clientInput(row, { hasRestrictionTag: restrictionTagged.has(row.id), restrictionClosedAt: restrictionClosedAt.get(row.id) || null }),
        cases,
        historyRows: history.get(row.id) || [],
        lastAttendanceAt: attendance.get(row.id) || null,
        clientRepliedAt: replied.get(row.id) || null,
        latestActivityAt: rowToClient(row, calendarLatest).latestActivityAt,
        now
      });
      if (reason) { skipped[reason] = (skipped[reason] || 0) + 1; continue; }
      candidates.push(item);
    }
  }
  return { candidates, skipped, checked: clientRows.length };
}

// Conferência do dono ANTES de ligar: SOMENTE LEITURA. Quantos seriam arquivados agora e os 20 primeiros (telefone mascarado).
export async function previewCooledTransferArchive({ now = Date.now() } = {}) {
  const { candidates, skipped, checked } = await findCandidates({ now });
  return {
    total: candidates.length,
    checked,
    skipped,
    sample: candidates.slice(0, SAMPLE_SIZE).map(({ row, cases }) => ({
      clientId: row.id,
      name: row.full_name || "Cliente sem nome",
      phone: maskPhone(row.phone_normalized || row.phone),
      status: row.status,
      transferredAt: latestTransferCase(cases)?.decided_at || null
    }))
  };
}

// ---------------------------------------------------------------------------
// Arquivamento (como SISTEMA, mesmo caminho da Lista fria; arquivar por sistema não pede motivo — FUN-14 é só de pessoa)
// ---------------------------------------------------------------------------

async function archiveClient({ row }, now) {
  const nowIso = now.toISOString();
  const { addSystemTagToClient } = await import("./client-tags");
  // A marca vai ANTES do status: se algo falhar no meio, o cliente nunca fica arquivado e visível ao corretor.
  const tagged = await addSystemTagToClient(row.id, COOLED_ARCHIVE_TAG.name, COOLED_ARCHIVE_TAG.color);
  const { data: updated, error } = await db().from("simulation_registrations")
    .update({ status: CLIENT_STATUS.ARCHIVED, last_status_change_at: nowIso })
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("responsible_user_id", row.responsible_user_id)
    .is("private_contact_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!updated) {
    // Mudou no meio do caminho (outra pessoa mexeu): desfaz a marca, o cliente não foi arquivado por esta regra.
    if (tagged?.added) await db().from("client_tags").delete().eq("client_id", row.id).eq("tag_id", tagged.tag.id);
    return false;
  }

  await recordClientStatusChange({ supabase: db(), clientId: row.id, previousStatus: row.status, newStatus: CLIENT_STATUS.ARCHIVED, changedAt: nowIso, changedBy: "sistema", source: COOLED_ARCHIVE_SOURCE });
  const { logClientJourneyEvent } = await import("./client-journey");
  await logClientJourneyEvent({ clientId: row.id, eventType: "status_reason", details: { newStatus: CLIENT_STATUS.ARCHIVED, previousStatus: row.status, reason: COOLED_ARCHIVE_REASON, source: COOLED_ARCHIVE_SOURCE } });

  // Caso do FUN-15 ainda aberto (aguardando motivo/decisão) é encerrado: o cliente saiu do fluxo.
  const { data: closed, error: closeError } = await db().from("cooled_client_cases")
    .update({ status: CASE_STATUS.CANCELED, canceled_reason: COOLED_ARCHIVE_CANCELED_REASON, closed_at: nowIso, updated_at: nowIso })
    .eq("client_id", row.id)
    .in("status", OPEN_CASE_STATUSES)
    .select("id");
  if (closeError) throw closeError;
  for (const item of closed || []) await resolveAlertDeliveriesByPrefix(`${COOLED_DEDUPE_PREFIX}${item.id}:`);
  return true;
}

// Rotina do cron scheduled-activities (a cada 2 min): até COOLED_ARCHIVE_BATCH clientes por rodada, então o retroativo
// sai 30 por vez. A trava (lib/crm-metrics/cache.js) impede rodadas concorrentes e espaça a rotina (100 s); falha libera.
export const COOLED_ARCHIVE_LOCK_NAME = "cooled_transfer_archive";
const COOLED_ARCHIVE_LOCK_SECONDS = 100;

export async function runCooledTransferArchiveJob(now = new Date()) {
  if (!(await getCooledTransferArchiveSettings()).enabled) return { enabled: false };
  if (!(await acquireLock(COOLED_ARCHIVE_LOCK_NAME, COOLED_ARCHIVE_LOCK_SECONDS))) return { skipped: "aguardando_intervalo" };
  try {
    const { candidates, skipped } = await findCandidates({ limit: COOLED_ARCHIVE_BATCH, now: now.getTime() });
    let archived = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        if (await archiveClient(candidate, now)) archived += 1;
      } catch (error) {
        failed += 1;
        console.error("[cliente frio arquivado] falha ao arquivar:", candidate.row.id, error?.message || error);
      }
    }
    return { enabled: true, archived, failed, candidates: candidates.length, skipped };
  } catch (error) {
    await releaseLock(COOLED_ARCHIVE_LOCK_NAME);
    throw error;
  }
}
