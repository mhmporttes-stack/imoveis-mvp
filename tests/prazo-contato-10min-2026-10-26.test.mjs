import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REACTIVATION_DEADLINE_MS,
  REACTIVATION_DEADLINE_MINUTES,
  REACTIVATION_RETURN_TRIGGER,
  offeredCaseOutcome,
  reactivationNoticeState
} from "../lib/cooled-clients-reactivation-core.mjs";
import { clientReceivedAfterStaleCycle } from "../lib/client-distribution-core.mjs";

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-26] "O corretor agora tem 10 minutos para entrar em contato com cada
// cliente." + incidente Wilson Guedes (2026-10-26): mandou mensagem pelo Chat e o aviso continuou "Prazo encerrado".

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const T0 = Date.parse("2026-10-26T12:37:51.577Z");
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60 * 1000;

test("prazo da fila de reativação: 10 min (fonte única)", () => {
  assert.equal(REACTIVATION_DEADLINE_MS, 10 * MIN);
  assert.equal(REACTIVATION_DEADLINE_MINUTES, 10);
  const base = { offeredTo: "jen", offeredAt: iso(T0), clientResponsibleId: "jen", rounds: 3 };
  assert.equal(offeredCaseOutcome({ ...base, now: T0 + 9 * MIN + 59 * 1000 }), "wait");
  assert.equal(offeredCaseOutcome({ ...base, now: T0 + 10 * MIN }), "return_to_owner");
  assert.equal(offeredCaseOutcome({ ...base, contacted: true, now: T0 + 10 * MIN }), "kept");
});

test("aviso: mensagem humana depois do aviso tira o 'Prazo encerrado' (mesma régua do prazo)", () => {
  const noticeAt = iso(T0 + 6 * 1000);
  // Caso real: o caso saiu da fila sem reactivation_kept_at; ela continua responsável e mandou mensagem.
  assert.equal(reactivationNoticeState({ noticeAt, stillResponsible: true, contacted: true, now: T0 + 15 * MIN }).state, "kept");
  assert.equal(reactivationNoticeState({ noticeAt, stillResponsible: true, contacted: true, now: T0 + MIN }).state, "kept");
  // Sem mensagem: contagem e, depois do prazo, "Prazo encerrado" (como antes).
  assert.deepEqual(reactivationNoticeState({ noticeAt, stillResponsible: true, now: T0 + MIN }), { state: "pending", deadlineAt: iso(T0 + 6 * 1000 + 10 * MIN) });
  assert.equal(reactivationNoticeState({ noticeAt, stillResponsible: true, now: T0 + 11 * MIN }).state, "expired");
  // Devolvido de verdade pela rotina: continua "devolvido", mesmo que alguém tenha escrito depois.
  const returned = reactivationNoticeState({ noticeAt, stillResponsible: false, contacted: true, requeues: [{ at: iso(T0 + 11 * MIN), trigger: REACTIVATION_RETURN_TRIGGER }], now: T0 + 12 * MIN });
  assert.equal(returned.state, "requeued");
  assert.equal(returned.returned, true);
});

test("servidor: o aviso lê o contato pela mesma função da rotina (loadContactedClientIds)", () => {
  const server = read("lib/cooled-clients-reactivation.js");
  assert.match(server, /const contactedClients = latestNoticeByClient\.size \? await loadContactedClientIds\(latestNoticeByClient\)/);
  assert.match(server, /contacted: !laterNoticeAt && contactedClients\.has\(row\.client_id\)/);
});

test("retorno automático da Prospecção não derruba quem recebeu o cliente depois do ciclo parado", () => {
  const lastAttemptAt = "2026-09-29T20:39:09.570Z";
  const wilson = { responsible_user_id: "jen", responsible_changed_at: iso(T0) };
  // Contato antigo sem dono (ou de outro corretor) e cliente entregue depois: fica com quem recebeu.
  assert.equal(clientReceivedAfterStaleCycle({ client: wilson, contactAssignedUserId: null, referenceAt: lastAttemptAt }), true);
  assert.equal(clientReceivedAfterStaleCycle({ client: wilson, contactAssignedUserId: "carol", referenceAt: lastAttemptAt }), true);
  // Mesmo corretor do ciclo parado: regra de sempre (devolve).
  assert.equal(clientReceivedAfterStaleCycle({ client: wilson, contactAssignedUserId: "jen", referenceAt: lastAttemptAt }), false);
  // Recebeu ANTES do ciclo parado, sem data ou sem responsável: regra de sempre.
  assert.equal(clientReceivedAfterStaleCycle({ client: { ...wilson, responsible_changed_at: "2026-09-01T00:00:00Z" }, contactAssignedUserId: null, referenceAt: lastAttemptAt }), false);
  assert.equal(clientReceivedAfterStaleCycle({ client: { ...wilson, responsible_changed_at: null }, contactAssignedUserId: null, referenceAt: lastAttemptAt }), false);
  assert.equal(clientReceivedAfterStaleCycle({ client: { responsible_user_id: null, responsible_changed_at: iso(T0) }, contactAssignedUserId: null, referenceAt: lastAttemptAt }), false);
  // Os dois retornos automáticos usam a trava.
  const source = read("lib/prospecting-auto-return.js");
  assert.equal((source.match(/clientReceivedAfterStaleCycle\(\{/g) || []).length, 2);
  assert.equal((source.match(/select\("id, status, responsible_user_id, responsible_changed_at"\)/g) || []).length, 2);
});
