// Lista fria da Prospecção e sobra da Meta Diária (REGRA OFICIAL — dono, 2026-10-24). Dados 100% sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLIENT_STATUS } from "../lib/client-status.js";
import {
  COLD_LIST_ARCHIVE_REASON,
  COLD_LIST_LOCK_UNTIL,
  COLD_LIST_TAG,
  applyColdListExclusion,
  coldListArchiveBlockReason,
  countColdListPassages,
  countDistinctAttemptBrokers,
  isColdListHidden,
  isColdListLock,
  isManualAttemptHistory
} from "../lib/cold-list-core.mjs";
import { listContactIdsWithUntriedActiveRound } from "../lib/daily-goal-round-release.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const at = (day) => `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`;

function fakeQuery() {
  const calls = [];
  const query = { calls, not(column, op, value) { calls.push(["not", column, op, value]); return query; } };
  return query;
}

test("esconder: Tentando contato com tentativa de 3 corretores diferentes", () => {
  const attempts = [{ brokerId: "a" }, { brokerId: "a" }, { brokerId: "b" }, { brokerId: "c" }, { brokerId: null }];
  assert.equal(countDistinctAttemptBrokers(attempts), 3);
  assert.equal(isColdListHidden({ status: CLIENT_STATUS.AWAITING_RETURN, distinctBrokers: 3 }), true);
  assert.equal(isColdListHidden({ status: CLIENT_STATUS.AWAITING_RETURN, distinctBrokers: 2 }), false);
  assert.equal(isColdListHidden({ status: CLIENT_STATUS.IN_SERVICE, distinctBrokers: 5 }), false);
  assert.equal(isColdListHidden({ status: CLIENT_STATUS.AWAITING_RETURN, distinctBrokers: 3, privateContactAt: at(1) }), false);
});

test("tentativa manual = reivindicação real; reserva da Meta Diária/Disparar não conta", () => {
  assert.equal(isManualAttemptHistory({ event_type: "claimed", details: {} }), true);
  assert.equal(isManualAttemptHistory({ event_type: "prospecting_started", details: null }), true);
  assert.equal(isManualAttemptHistory({ event_type: "claimed", details: { source: "daily_goal" } }), false);
  assert.equal(isManualAttemptHistory({ event_type: "claimed", details: { source: "extra_dispatch" } }), false);
  assert.equal(isManualAttemptHistory({ event_type: "auto_returned", details: {} }), false);
});

test("passagem = devolução à fila com tentativa desde a devolução anterior", () => {
  const attempts = [{ at: at(1) }, { at: at(2) }, { at: at(10) }, { at: at(20) }];
  assert.equal(countColdListPassages(attempts, [{ at: at(3) }]), 1);
  assert.equal(countColdListPassages(attempts, [{ at: at(3) }, { at: at(12) }, { at: at(22) }]), 3);
  // devolução sem tentativa no ciclo não conta
  assert.equal(countColdListPassages(attempts, [{ at: at(3) }, { at: at(5) }, { at: at(12) }]), 2);
  assert.equal(countColdListPassages([], [{ at: at(3) }, { at: at(4) }, { at: at(5) }]), 0);
  // ciclo em andamento (tentativa depois da última devolução) ainda não é passagem
  assert.equal(countColdListPassages(attempts, [{ at: at(3) }, { at: at(12) }]), 2);
});

test("arquivar só na 3ª passagem e nunca quem respondeu, tem simulação ou saiu de Tentando contato", () => {
  const base = { status: CLIENT_STATUS.AWAITING_RETURN, passages: 3 };
  assert.equal(coldListArchiveBlockReason(base), null);
  assert.equal(coldListArchiveBlockReason({ ...base, passages: 2 }), "menos_de_3_passagens");
  assert.equal(coldListArchiveBlockReason({ ...base, responded: true }), "cliente_respondeu");
  assert.equal(coldListArchiveBlockReason({ ...base, hasSimulation: true }), "tem_simulacao");
  assert.equal(coldListArchiveBlockReason({ ...base, status: CLIENT_STATUS.IN_SERVICE }), "fora_de_tentando_contato");
  assert.equal(coldListArchiveBlockReason({ ...base, status: CLIENT_STATUS.ARCHIVED }), "fora_de_tentando_contato");
  assert.equal(coldListArchiveBlockReason({ ...base, privateContactAt: at(1) }), "particular");
  assert.equal(coldListArchiveBlockReason({ ...base, contactInWallet: true }), "contato_com_corretor");
  assert.equal(COLD_LIST_ARCHIVE_REASON, "lista fria — 3 passagens sem resposta");
});

test("contato do arquivado nunca volta à fila (liberação travada), 30 dias comuns não são lista fria", () => {
  assert.equal(isColdListLock(COLD_LIST_LOCK_UNTIL), true);
  assert.equal(isColdListLock(new Date(Date.now() + 30 * 86400000).toISOString()), false);
  assert.equal(isColdListLock(null), false);
  assert.ok(new Date(COLD_LIST_LOCK_UNTIL).getTime() > Date.now() + 100 * 365 * 86400000);
});

test("exclusão da visão padrão; pesquisa e filtro da etiqueta mostram", () => {
  const ids = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];
  const query = fakeQuery();
  applyColdListExclusion(query, { hiddenIds: ids });
  assert.deepEqual(query.calls, [["not", "id", "in", `(${ids.join(",")})`]]);
  for (const options of [{ hiddenIds: ids, searching: true }, { hiddenIds: ids, filteringColdTag: true }, { hiddenIds: [] }]) {
    const other = fakeQuery();
    applyColdListExclusion(other, options);
    assert.deepEqual(other.calls, [], JSON.stringify(options));
  }
  assert.equal(COLD_LIST_TAG.key, "lista fria");
});

test("lista de Clientes, abas e contadores aplicam a exclusão; cron roda a rotina com trava", () => {
  const listQuery = read("lib/simulation-list-query.js");
  assert.match(listQuery, /applyColdListExclusion\(query, \{ hiddenIds: coldList\?\.hiddenIds \|\| \[\], searching, filteringColdTag/);
  assert.equal((listQuery.match(/attendanceExclusionIds, coldList \}\)/g) || []).length, 4);
  assert.match(listQuery, /applyColdListExclusion\(allTotalQuery/);
  const cron = read("app/api/cron/scheduled-activities/route.js");
  assert.match(cron, /runColdListJob\(\)/);
  const job = read("lib/cold-list.js");
  assert.match(job, /acquireLock\(COLD_LIST_LOCK_NAME/);
  assert.match(job, /changedBy: "sistema"/);
  assert.match(job, /\.eq\("status", CLIENT_STATUS\.AWAITING_RETURN\)/);
});

// Meta Diária: contato sem nenhuma tentativa continua com o corretor.
function fakeRoundsDb(rows) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = {};
      const builder = {
        select() { return builder; },
        in(column, values) { filters[column] = values; return builder; },
        eq(column, value) { filters[column] = value; return builder; },
        then(resolve) {
          calls.push({ table, filters: { ...filters } });
          const data = rows.filter((row) => filters.prospecting_contact_id.includes(row.prospecting_contact_id) && row.status === filters.status && row.attempt_count === filters.attempt_count);
          return Promise.resolve({ data, error: null }).then(resolve);
        }
      };
      return builder;
    }
  };
}

test("sobra da Meta Diária: rodada ativa sem tentativa segura o contato; com tentativa segue o fluxo", async () => {
  const fake = fakeRoundsDb([
    { prospecting_contact_id: "c1", status: "active", attempt_count: 0 },
    { prospecting_contact_id: "c2", status: "active", attempt_count: 1 },
    { prospecting_contact_id: "c3", status: "ended_no_conversion", attempt_count: 0 }
  ]);
  const untried = await listContactIdsWithUntriedActiveRound(fake, ["c1", "c2", "c3", "c1"]);
  assert.deepEqual([...untried], ["c1"]);
  assert.equal(fake.calls[0].table, "daily_goal_rounds");
  assert.deepEqual(await listContactIdsWithUntriedActiveRound(fake, []), new Set());
});

test("retorno automático de 7 dias pula o contato sem tentativa nesta passagem", () => {
  const source = read("lib/prospecting-auto-return.js");
  const filterAt = source.indexOf("listContactIdsWithUntriedActiveRound(db, stale.map");
  assert.ok(filterAt > 0);
  assert.ok(filterAt < source.indexOf('.update({ status: "recent_attempt", assigned_user_id: null, last_broker_id: assignedUserId || null, available_after: availableAfter, updated_at'));
});
