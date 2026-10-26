import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REACTIVATION_DEADLINE_MS,
  REACTIVATION_SPACING_MS,
  backfillCaseDecision,
  hasHumanMessageSince,
  offeredCaseOutcome,
  planReactivationDeliveries,
  queuedCaseStillWaiting,
  REACTIVATION_DEADLINE_MINUTES,
  REACTIVATION_REQUEUE_TRIGGER,
  reactivationNoticeState,
  reactivationRequeuedMessage,
  requeueTriggerMinutes,
  requeuedFromScopeMinutes
} from "../lib/cooled-clients-reactivation-core.mjs";
import { lastResponsibleTransferCut } from "../lib/whatsapp-chat-scope.mjs";

// [REGRA OFICIAL — dono, 2026-10-17, FUN-15l] Transferidos do FUN-15 seguem a roleta por uma fila de reativação: quem fica
// on-line recebe 1, depois de 3 min recebe outro; sem mensagem em 3 min, o cliente volta ao FIM da fila. Nunca volta ao
// corretor que o perdeu no FUN-15; quem o perdeu nesta fila pode recebê-lo de novo (correção do dono no mesmo dia).
// [REGRA OFICIAL — dono, 2026-10-19, ROL-2h] O intervalo entre dois recebimentos do mesmo corretor passou a 10 min (por
// qualquer caminho da distribuição). [REGRA OFICIAL — dono, 2026-10-19] O prazo para mandar a mensagem passou de 3 para
// 5 min; aviso com contagem regressiva e "voltou para a fila" no clique do WhatsApp.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const T0 = Date.parse("2026-10-17T13:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const OWNER = "owner";

test("prazo para mandar mensagem passa a 10 min (dono 2026-10-26); intervalo entre entregas 10 min (dono 2026-10-19)", () => {
  assert.equal(REACTIVATION_DEADLINE_MS, 10 * 60 * 1000);
  assert.equal(REACTIVATION_DEADLINE_MINUTES, 10);
  assert.equal(REACTIVATION_SPACING_MS, 10 * 60 * 1000);
});

test("espaçamento: o mesmo corretor só recebe outro 10 min depois do anterior", () => {
  const queue = [{ caseId: "c1", previousBrokerId: "jen" }, { caseId: "c2", previousBrokerId: "jen" }];
  // Recebeu há 3 min ou 9 min: fica de fora nesta rodada.
  assert.deepEqual(planReactivationDeliveries({ queue, onlineBrokerIds: ["gab"], lastOfferAtByBroker: new Map([["gab", iso(T0 - 3 * 60 * 1000)]]), now: T0 }), []);
  assert.deepEqual(planReactivationDeliveries({ queue, onlineBrokerIds: ["gab"], lastOfferAtByBroker: new Map([["gab", iso(T0 - 9 * 60 * 1000)]]), now: T0 }), []);
  // Recebeu há 10 min: recebe 1 (só 1 por rodada, mesmo com a fila cheia).
  assert.deepEqual(planReactivationDeliveries({ queue, onlineBrokerIds: ["gab"], lastOfferAtByBroker: new Map([["gab", iso(T0 - 10 * 60 * 1000)]]), now: T0 }), [{ caseId: "c1", brokerId: "gab" }]);
});

test("ROL-2h: a pausa de 10 min conta também o lead novo da roleta (fonte única no banco, reserva no lock)", () => {
  const runner = read("lib/cooled-clients-reactivation.js");
  assert.match(runner, /filterRouletteCooldownFreeIds\(await listOnlineRouletteBrokerIds\(\)\)/);
  assert.match(runner, /if \(!\(await claimRouletteReceipt\(brokerId\)\)\) return false;/);
  assert.match(runner, /releaseRouletteReceipt\(brokerId, claimedSince\)/);
  const sql = read("supabase/migrations/20261019235500_roleta_intervalo_10min_por_corretor.sql");
  assert.match(sql, /select interval '10 minutes'/);
  // pick_round_robin_broker e a reserva assign_round_robin_lead: filtram a pausa e gravam o recebimento no lock.
  assert.equal((sql.match(/last_roulette_received_at, '-infinity'::timestamptz\) <= now\(\) - public\.roulette_receive_interval\(\)/g) || []).length >= 3, true);
  assert.equal((sql.match(/last_roulette_received_at = now\(\)/g) || []).length, 3);
  assert.match(sql, /function public\.claim_roulette_receipt[\s\S]*pg_advisory_xact_lock\(hashtext\('lead_distribution_round_robin'\)\)/);
  // Formulário reenviado por cliente que já existe não deixa o corretor sorteado em pausa sem cliente.
  const reg = read("lib/simulation-registrations.js");
  assert.equal((reg.match(/else await releaseUnusedRoulettePick\(assignment, roulettePickedSince\);/g) || []).length, 2);
});

test("1 por corretor por rodada, na ordem da fila; quem recebeu da fila há mais tempo vem primeiro", () => {
  const queue = [{ caseId: "c1" }, { caseId: "c2" }, { caseId: "c3" }];
  const plan = planReactivationDeliveries({
    queue,
    onlineBrokerIds: ["a", "b"],
    lastOfferAtByBroker: new Map([["a", iso(T0 - 10 * 60 * 1000)], ["b", iso(T0 - 60 * 60 * 1000)]]),
    now: T0
  });
  assert.deepEqual(plan, [{ caseId: "c1", brokerId: "b" }, { caseId: "c2", brokerId: "a" }]);
});

test("nunca entrega ao corretor que perdeu o cliente no FUN-15, nem ao dono", () => {
  const queue = [{ caseId: "c1", previousBrokerId: "jen" }];
  assert.deepEqual(planReactivationDeliveries({ queue, onlineBrokerIds: ["jen", OWNER], ownerId: OWNER, now: T0 }), []);
  assert.deepEqual(planReactivationDeliveries({ queue, onlineBrokerIds: ["jen", "edu"], ownerId: OWNER, now: T0 }), [{ caseId: "c1", brokerId: "edu" }]);
  // O corretor do FUN-15 continua recebendo OUTROS clientes da fila.
  const two = [{ caseId: "c1", previousBrokerId: "jen" }, { caseId: "c2", previousBrokerId: "gab" }];
  assert.deepEqual(planReactivationDeliveries({ queue: two, onlineBrokerIds: ["jen"], now: T0 }), [{ caseId: "c2", brokerId: "jen" }]);
});

test("quem perdeu o cliente nesta fila (3 min sem mensagem) PODE recebê-lo de novo", () => {
  // Gabriel recebeu e perdeu; é o único on-line: recebe de novo (correção do dono, 2026-10-17) — depois da pausa de 10 min
  // entre recebimentos (ROL-2h, dono 2026-10-19).
  const plan = planReactivationDeliveries({ queue: [{ caseId: "c1", previousBrokerId: "jen" }], onlineBrokerIds: ["gab"], lastOfferAtByBroker: new Map([["gab", iso(T0 - 10 * 60 * 1000)]]), now: T0 });
  assert.deepEqual(plan, [{ caseId: "c1", brokerId: "gab" }]);
  assert.doesNotMatch(read("lib/cooled-clients-reactivation-core.mjs"), /excluded_ids|losers/);
});

test("prazo: sem mensagem em 10 min a volta acaba e o cliente vai ao dono (uma volta só, dono 2026-10-24); com mensagem fica", () => {
  const base = { offeredTo: "gab", offeredAt: iso(T0), clientResponsibleId: "gab", rounds: 1 };
  assert.equal(offeredCaseOutcome({ ...base, now: T0 + 2 * 60 * 1000 }), "wait");
  assert.equal(offeredCaseOutcome({ ...base, now: T0 + 9 * 60 * 1000 + 59 * 1000 }), "wait");
  assert.equal(offeredCaseOutcome({ ...base, now: T0 + 10 * 60 * 1000 }), "return_to_owner");
  assert.equal(offeredCaseOutcome({ ...base, rounds: 3, now: T0 + 10 * 60 * 1000 }), "return_to_owner");
  assert.equal(offeredCaseOutcome({ ...base, now: T0 + 9 * 60 * 1000, contacted: true }), "kept");
  assert.equal(offeredCaseOutcome({ ...base, now: T0 + 60 * 1000, contacted: true }), "kept");
  // Transferido à mão ou status fora da roleta: sai da fila, nunca é tomado de volta.
  assert.equal(offeredCaseOutcome({ ...base, clientResponsibleId: "carol", now: T0 + 9 * 60 * 1000 }), "left");
  assert.equal(offeredCaseOutcome({ ...base, clientEligible: false, now: T0 + 9 * 60 * 1000 }), "left");
});

test("só mensagem humana real conta como contato", () => {
  const since = iso(T0);
  const msg = (extra) => ({ direction: "outbound", sender_type: "user", status: "sent", message_type: "text", metadata: {}, message_at: iso(T0 + 60 * 1000), ...extra });
  assert.equal(hasHumanMessageSince([msg()], since), true);
  assert.equal(hasHumanMessageSince([msg({ message_at: iso(T0 - 60 * 1000) })], since), false);
  assert.equal(hasHumanMessageSince([msg({ sender_type: "automation" })], since), false);
  assert.equal(hasHumanMessageSince([msg({ status: "failed" })], since), false);
  assert.equal(hasHumanMessageSince([msg({ direction: "internal" })], since), false);
  assert.equal(hasHumanMessageSince([msg({ message_type: "reaction" })], since), false);
  assert.equal(hasHumanMessageSince([msg({ metadata: { history: true } })], since), false);
});

test("fim da fila: devolvido entra com a hora da devolução e vai depois dos que já esperavam", () => {
  const src = read("lib/cooled-clients-reactivation.js");
  assert.match(src, /reactivation_queued_at: queuedAt/);
  assert.match(src, /queue\.sort\(\(a, b\) => compareReactivationQueue\(\{ queuedAt: a\.queuedAt/);
  // Enquanto espera, fica com o dono e marcado na fila de espera (FUN-11).
  assert.equal(queuedCaseStillWaiting({ clientResponsibleId: OWNER, ownerId: OWNER, pendingDistributionAt: iso(T0) }), true);
  assert.equal(queuedCaseStillWaiting({ clientResponsibleId: "carol", ownerId: OWNER, pendingDistributionAt: iso(T0) }), false);
  assert.equal(queuedCaseStillWaiting({ clientResponsibleId: OWNER, ownerId: OWNER, pendingDistributionAt: null }), false);
});

test("fila de espera comum não entrega cliente da fila de reativação", () => {
  const src = read("lib/lead-distribution.js");
  assert.match(src, /listCooledReactivationQueuedClientIds\(\)/);
  assert.match(src, /not\("id", "in"/);
});

test("transferência do FUN-15 vai para a fila (não entrega direto) e liga junto do switch", () => {
  const cooled = read("lib/cooled-clients.js");
  assert.match(cooled, /returnClientToRoulette\(row\.client_id, auth, \{ cooledReactivation:/);
  assert.match(cooled, /cooledReactivation: reactivation \}/);
  const runner = read("lib/cooled-clients-reactivation.js");
  assert.match(runner, /if \(!\(await flowEnabled\(\)\)\) return \{ enabled: false \}/);
  assert.match(read("app/api/cron/scheduled-activities/route.js"), /runCooledReactivationQueue/);
});

test("backfill: só transferidos sem contato, com quem recebeu ou com o dono", () => {
  const caseRow = { decision: "transferred", broker_id: "jen", transferred_to: "gab", reactivation_status: null };
  assert.equal(backfillCaseDecision({ caseRow, client: { responsible_user_id: "gab" }, ownerId: OWNER, contacted: false }), "queue");
  assert.equal(backfillCaseDecision({ caseRow, client: { responsible_user_id: OWNER }, ownerId: OWNER, contacted: false }), "queue");
  assert.equal(backfillCaseDecision({ caseRow, client: { responsible_user_id: "gab" }, ownerId: OWNER, contacted: true }), "skip_contacted");
  assert.equal(backfillCaseDecision({ caseRow, client: { responsible_user_id: "carol" }, ownerId: OWNER, contacted: false }), "skip_moved_by_hand");
  assert.equal(backfillCaseDecision({ caseRow, client: { responsible_user_id: "gab", eligible: false }, ownerId: OWNER, contacted: false }), "skip_ineligible");
  assert.equal(backfillCaseDecision({ caseRow: { ...caseRow, reactivation_status: "queued" }, client: { responsible_user_id: "gab" }, ownerId: OWNER, contacted: false }), "skip_already_in_queue");
});

test("conversa anterior (FUN-15g/h) do novo corretor é a do corretor do FUN-15, não a do dono", () => {
  const cut = lastResponsibleTransferCut({
    cooled: [{ broker_id: "jen", decided_at: "2026-10-16T12:00:00Z" }],
    journey: [{ occurred_at: "2026-10-16T12:00:01Z", details: { transferType: "roulette", fromId: "jen", toId: OWNER, waitingQueue: true } }],
    distribution: [{ event_type: "assigned", from_user_id: OWNER, to_user_id: "gab", created_at: "2026-10-17T13:00:00Z", details: { fromWaitingQueue: true, cooledReactivation: "delivered", historyPreviousUserId: "jen" } }]
  });
  assert.equal(cut.previousUserId, "jen");
  assert.equal(cut.at, "2026-10-17T13:00:00Z");
});

test("volte TODOS (dono, 2026-10-17): bloqueio de 30 dias da Prospecção não tira da fila; 'left' pode voltar no backfill", () => {
  const src = read("lib/cooled-clients-reactivation.js");
  assert.match(src, /isRouletteEligibleClient\(\{ \.\.\.row, available_after: null \}\)/);
  assert.doesNotMatch(src, /from\("prospecting_contacts"\)/);
  assert.match(src, /BACKFILL_SETTING_ID = "cooled_reactivation_backfill_2"/);
  const caseRow = { decision: "transferred", broker_id: "jen", transferred_to: "gab" };
  assert.equal(backfillCaseDecision({ caseRow: { ...caseRow, reactivation_status: "left" }, client: { responsible_user_id: "gab" }, ownerId: OWNER, contacted: false }), "queue");
  for (const status of ["queued", "offered", "kept"]) {
    assert.equal(backfillCaseDecision({ caseRow: { ...caseRow, reactivation_status: status }, client: { responsible_user_id: "gab" }, ownerId: OWNER, contacted: false }), "skip_already_in_queue");
  }
});

test("prazo em fonte única: servidor grava a marca nova e o aviso usa os minutos do core", () => {
  const server = read("lib/cooled-clients-reactivation.js");
  assert.match(server, /trigger: REACTIVATION_REQUEUE_TRIGGER/);
  assert.match(server, /deadlineMinutes = REACTIVATION_DEADLINE_MINUTES/);
  assert.doesNotMatch(server, /no_message_3min|em 3 minutos/);
  assert.equal(requeueTriggerMinutes(REACTIVATION_REQUEUE_TRIGGER), 10);
  assert.equal(requeueTriggerMinutes("no_message_3min"), 3); // devoluções antigas
  assert.equal(requeueTriggerMinutes("backfill"), null);
  assert.equal(reactivationRequeuedMessage(), "Este cliente voltou para a fila porque nenhuma mensagem foi enviada em 10 minutos.");
});

test("aviso: contagem regressiva, prazo encerrado, devolvido e mantido", () => {
  const noticeAt = iso(T0);
  const base = { noticeAt, stillResponsible: true };
  assert.deepEqual(reactivationNoticeState({ ...base, now: T0 + 60 * 1000 }), { state: "pending", deadlineAt: iso(T0 + 10 * 60 * 1000) });
  assert.equal(reactivationNoticeState({ ...base, now: T0 + 11 * 60 * 1000 }).state, "expired");
  const requeued = reactivationNoticeState({ ...base, stillResponsible: false, requeues: [{ at: iso(T0 + 11 * 60 * 1000), trigger: REACTIVATION_REQUEUE_TRIGGER }], now: T0 + 12 * 60 * 1000 });
  assert.equal(requeued.state, "requeued");
  assert.equal(requeued.minutes, 10);
  // Mandou mensagem: a rodada confirmou (kept) -> sem contagem nem "prazo encerrado".
  assert.equal(reactivationNoticeState({ ...base, now: T0 + 11 * 60 * 1000, keptAt: iso(T0 + 11 * 60 * 1000) }).state, "kept");
  assert.equal(reactivationNoticeState({ ...base, stillResponsible: false, now: T0 + 60 * 1000 }).state, "kept");
  // Aviso antigo de uma entrega anterior: a devolução DEPOIS de uma nova entrega não é dele.
  const older = reactivationNoticeState({ noticeAt, laterNoticeAt: iso(T0 + 20 * 60 * 1000), stillResponsible: true, requeues: [{ at: iso(T0 + 26 * 60 * 1000), trigger: REACTIVATION_REQUEUE_TRIGGER }], now: T0 + 30 * 60 * 1000 });
  assert.equal(older.state, "kept");
});

test("clique no WhatsApp: mensagem de 'voltou para a fila' só quando a última movimentação foi a devolução por prazo de quem clicou", () => {
  const row = { event_type: "auto_transferred", from_user_id: "gab", details: { trigger: REACTIVATION_REQUEUE_TRIGGER } };
  assert.equal(requeuedFromScopeMinutes(row, ["gab"]), 10);
  assert.equal(requeuedFromScopeMinutes(row, ["carol"]), null);
  assert.equal(requeuedFromScopeMinutes({ ...row, details: { trigger: "backfill" } }, ["gab"]), null);
  assert.equal(requeuedFromScopeMinutes({ ...row, event_type: "assigned" }, ["gab"]), null);
  assert.equal(requeuedFromScopeMinutes(null, ["gab"]), null);
  const chat = read("lib/whatsapp-chat.js");
  assert.equal((chat.match(/throw await clientOutOfScopeError\(client, scope\)/g) || []).length, 3);
  assert.match(chat, /code: "REACTIVATION_REQUEUED"/);
});
