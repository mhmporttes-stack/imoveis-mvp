// Desempenho (2026-11-03): menos consultas ao Supabase. Testes de estrutura (os arquivos do servidor importam "server-only").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

test("Reconhecimentos: detectores no máximo 1 vez a cada 90 s por corretor; fora do intervalo só lê os pendentes", () => {
  const code = read("lib/celebrations.js");
  assert.ok(code.includes("const DETECTORS_MIN_INTERVAL_MS = 90 * 1000;"));
  assert.ok(code.includes("nowMs - (detectorsLastRunAt.get(brokerId) || 0) >= DETECTORS_MIN_INTERVAL_MS"));
  const main = code.slice(code.indexOf("export async function evaluateAndListPendingCelebrations"), code.indexOf("async function runCelebrationDetectors"));
  assert.ok(main.includes("if (runDetectors) {") && main.includes("await runCelebrationDetectors(supabase, auth);") && main.includes("return listPendingCelebrationEvents(supabase, brokerId);"));
  assert.ok(main.indexOf("detectorsLastRunAt.set(brokerId, nowMs)") < main.indexOf("await runCelebrationDetectors"), "marca antes de rodar: consultas simultâneas não rodam duas vezes");
  const list = code.slice(code.indexOf("async function listPendingCelebrationEvents"));
  assert.ok(list.includes('.from("broker_celebration_events")') && list.includes('.eq("status", "pending")'));
});

test("busca de telefone do LID: 'não achei' lembrado por 5 min, sessões em cache de 1 min, outras sessões em blocos paralelos", () => {
  const code = read("lib/whatsapp-individual-inbound.js");
  assert.ok(code.includes("const LID_LOOKUP_NEGATIVE_TTL_MS = 5 * 60 * 1000;"));
  assert.ok(code.includes("if (lidLookupMissActive(missKey)) return \"\";") && code.includes("if (!phone) rememberLidLookupMiss(missKey);"));
  assert.ok(code.includes("const SESSIONS_CACHE_MS = 60 * 1000;") && code.includes("async function listSessionsCached()"));
  assert.ok(code.includes("const OTHER_SESSIONS_CHUNK = 4;") && code.includes("await Promise.all(chunk.map("));
  // a lista de sessões não é mais lida a cada chamada
  const other = code.slice(code.indexOf("async function findPhoneForLidInOtherSessions"));
  assert.ok(!other.slice(0, 600).includes('from("whatsapp_individual_sessions")'));
});

test("Início do corretor/associado: o funil do mês não pede ajustes manuais de pontos (antes 'Acesso não autorizado' no fim)", () => {
  const code = read("lib/performance-overview.js");
  assert.ok(code.includes('import { isGeneralAdminAuth, isManagerProfile, listVisibleTeamProfiles } from "./admin-profiles";'));
  assert.ok(code.includes("isGeneralAdminAuth(auth) || isManagerProfile(auth?.profile)\n      ? listManualAdjustments("));
});

test("migration do índice de remote_jid: não parcial, aditiva e idempotente", () => {
  const sql = read("supabase/migrations/20261103120000_whatsapp_messages_remote_jid_index.sql");
  assert.ok(/create index if not exists whatsapp_messages_session_remote_jid_all_idx/.test(sql));
  assert.ok(sql.includes("(session_user_id, session_slot, ((metadata ->> 'remote_jid')), message_at desc)"));
  assert.ok(!/where/i.test(sql.replace(/--.*$/gm, "")), "sem cláusula WHERE (índice não parcial)");
});

test("Número não identificado (LID): a marca da varredura é gravada ANTES e a rodada tem teto de conversas e de tempo (sem espiral quando o cron estoura)", () => {
  const code = read("lib/whatsapp-individual-inbound.js");
  const fn = code.slice(code.indexOf("export async function reconcileLidPlaceholders"), code.indexOf("export async function mergeLidConversation"));
  assert.ok(fn.indexOf("planLidReconcile(") < fn.indexOf('.upsert({ id: LID_RECONCILE_SETTINGS_ID'), "usa o plano");
  assert.ok(fn.indexOf('.upsert({ id: LID_RECONCILE_SETTINGS_ID') < fn.indexOf('.from("whatsapp_conversations")'), "marca antes da varredura");
  assert.ok(code.includes("const LID_RECONCILE_MAX_PER_RUN = 80;") && code.includes("const LID_RECONCILE_BUDGET_MS = 25 * 1000;"));
  assert.ok(fn.includes("if (Date.now() > deadline) break;") && fn.includes(".limit(LID_RECONCILE_MAX_PER_RUN)"));
  assert.ok(fn.includes("return { merged, full: plan.full, checked };"));
});

test("modo lista impressa: resultado guardado por poucos segundos (5 s ligado, 15 s desligado), sem guardar erro; controle do Chat com cache de 15 s", () => {
  const code = read("lib/whatsapp-manual-disconnect.js").replace(/\r\n/g, "\n");
  assert.ok(code.includes("const PRINTED_LIST_TTL_OFF_MS = 15 * 1000;") && code.includes("const PRINTED_LIST_TTL_ON_MS = 5 * 1000;"));
  assert.ok(code.includes("hit.value ? PRINTED_LIST_TTL_ON_MS : PRINTED_LIST_TTL_OFF_MS"));
  assert.ok(code.includes("(error) => { printedListCache.set(key, null); throw error; }"), "erro não é guardado");
  assert.ok(code.indexOf("printedListModeAppliesTo({ role, isGeneralAdmin })) return false") < code.indexOf("printedListCache.get(key)"));
  assert.ok(read("lib/chat-control.js").includes("const CACHE_MS = 15000;"));
});
