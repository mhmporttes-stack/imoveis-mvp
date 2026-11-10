// Oferta ao próximo da roleta (dono, 2026-11-10): sim/ok, prazo, próximo candidato e FILA DE ACEITE TARDIO.
import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFER_STATES, addLateAccept, buildOfferText, decideOfferExpiry, decideOfferReply, isAffirmativeReply, lateLosers, nextOfferCandidate, offerExpiresAt, offerPosition, pickLateAccept
} from "../lib/roulette-offer-core.mjs";

const T0 = new Date("2026-11-10T23:00:00Z");
const after = (sec) => new Date(T0.getTime() + sec * 1000);
// Ordem da roleta: a(0) b(1) c(2) d(3). A oferta está com `current`.
const offer = (extra = {}) => ({ id: "o1", state: OFFER_STATES.pending, current_user_id: "a", asked_user_ids: [], candidate_order: ["a", "b", "c", "d"], late_accepts: [], expires_at: offerExpiresAt(T0, 60), ...extra });

test("variações aceitas: sim, ok, pode, 👍 (case, acento e pontuação)", () => {
  for (const text of ["sim", "SIM", "Sim!", "ok", "OK.", "Ok, obrigado", "pode", "Pode sim", "👍", "👍🏽", "👍 👍", "  ok  ", "claro", "Beleza", "Pode transferir"]) {
    assert.equal(isAffirmativeReply(text), true, text);
  }
  for (const text of ["não", "nao", "agora não", "sim, mas só amanhã", "depois", "quem é?", "", "👎", "okay mas não posso", null]) {
    assert.equal(isAffirmativeReply(text), false, String(text));
  }
});

test("resposta na vez, dentro do prazo, aceita; não afirmativa ou sem oferta ignora", () => {
  assert.deepEqual(decideOfferReply({ offer: offer(), userId: "a", text: "sim", now: after(59) }), { action: "accept" });
  assert.deepEqual(decideOfferReply({ offer: offer(), userId: "a", text: "não posso", now: after(10) }), { action: "ignore" });
  assert.deepEqual(decideOfferReply({ offer: null, userId: "a", text: "sim" }), { action: "ignore" });
  assert.deepEqual(decideOfferReply({ offer: offer(), userId: "d", text: "sim", now: after(10) }), { action: "ignore" }); // ainda nem foi consultado
});

test("sem resposta no prazo: oferece ao próximo, depois ao seguinte; ninguém = esgotada", () => {
  assert.deepEqual(decideOfferExpiry({ offer: offer(), now: after(30) }), { action: "none" });
  assert.deepEqual(decideOfferExpiry({ offer: offer(), now: after(61) }), { action: "next", userId: "b", asked: ["a"] });
  assert.deepEqual(decideOfferExpiry({ offer: offer({ current_user_id: "c", asked_user_ids: ["a", "b"] }), now: after(61) }), { action: "next", userId: "d", asked: ["a", "b", "c"] });
  assert.deepEqual(decideOfferExpiry({ offer: offer({ current_user_id: "d", asked_user_ids: ["a", "b", "c"] }), now: after(61) }), { action: "exhausted", asked: ["a", "b", "c", "d"] });
  assert.deepEqual(decideOfferExpiry({ offer: offer({ state: OFFER_STATES.accepted }), now: after(61) }), { action: "none" }); // idempotente
});

test("próximo candidato respeita a ordem e quem já foi consultado", () => {
  assert.equal(nextOfferCandidate({ order: ["a", "b", "c"], asked: [] }), "a");
  assert.equal(nextOfferCandidate({ order: ["a", "b", "c"], asked: ["a", "b"] }), "c");
  assert.equal(nextOfferCandidate({ order: ["a"], asked: ["a"] }), null);
  assert.equal(nextOfferCandidate({}), null);
});

test("TARDIO: A passou da vez, responde enquanto a oferta está com C → fila 'deixa eu verificar'; C aceita → C leva e A ouve 'indisponível'", () => {
  const withC = offer({ current_user_id: "c", asked_user_ids: ["a", "b"] });
  const reply = decideOfferReply({ offer: withC, userId: "a", text: "ok", now: after(20) });
  assert.deepEqual(reply, { action: "queue", position: 0 });
  const queued = { ...withC, late_accepts: addLateAccept([], { userId: "a", phone: "5514999990001", at: after(20), position: reply.position }) };
  // C responde sim dentro do prazo → aceita
  assert.deepEqual(decideOfferReply({ offer: queued, userId: "c", text: "sim", now: after(40) }), { action: "accept" });
  // quem ouve "não está mais disponível": todos os tardios (o vencedor C não está na fila)
  assert.deepEqual(lateLosers(queued, "c").map((item) => item.userId), ["a"]);
  // não abre exceção por tempo: vale qualquer resposta posterior à vez de A
  assert.deepEqual(decideOfferReply({ offer: withC, userId: "a", text: "ok", now: after(1) }), { action: "queue", position: 0 });
});

test("TARDIO: A na fila e C silencia → no vencimento de C, A leva", () => {
  const queued = offer({ current_user_id: "c", asked_user_ids: ["a", "b"], late_accepts: addLateAccept([], { userId: "a", phone: "p", at: after(20), position: 0 }) });
  assert.equal(decideOfferExpiry({ offer: queued, now: after(30) }).action, "none"); // ainda dentro do prazo de C
  const decision = decideOfferExpiry({ offer: queued, now: after(61) });
  assert.equal(decision.action, "late_winner");
  assert.equal(decision.winner.userId, "a");
  assert.deepEqual(decision.losers, []);
});

test("TARDIO: dois tardios — leva o de menor posição; o outro ouve 'indisponível'; empate pela hora", () => {
  let lates = addLateAccept([], { userId: "b", phone: "pb", at: after(10), position: offerPosition(offer(), "b") }); // b respondeu primeiro
  lates = addLateAccept(lates, { userId: "a", phone: "pa", at: after(25), position: offerPosition(offer(), "a") });
  const withD = offer({ current_user_id: "d", asked_user_ids: ["a", "b", "c"], late_accepts: lates });
  const decision = decideOfferExpiry({ offer: withD, now: after(61) });
  assert.equal(decision.winner.userId, "a"); // posição 0 < 1, mesmo tendo respondido depois
  assert.deepEqual(decision.losers.map((item) => item.userId), ["b"]);
  // empate de posição → quem respondeu antes
  assert.equal(pickLateAccept([{ userId: "x", position: 1, at: after(30).toISOString() }, { userId: "y", position: 1, at: after(5).toISOString() }]).userId, "y");
  assert.equal(pickLateAccept([]), null);
});

test("TARDIO após esgotar: cliente sem responsável → transfere a quem respondeu; já transferido → 'indisponível'", () => {
  const exhausted = offer({ state: OFFER_STATES.exhausted, current_user_id: "d", asked_user_ids: ["a", "b", "c", "d"] });
  assert.deepEqual(decideOfferReply({ offer: exhausted, userId: "b", text: "sim", now: after(300), clientAvailable: true }), { action: "claim_after_end" });
  assert.deepEqual(decideOfferReply({ offer: exhausted, userId: "b", text: "sim", now: after(300), clientAvailable: false }), { action: "unavailable" });
});

test("TARDIO após transferido a outro: 'indisponível'; duplicidade de resposta não repete nada", () => {
  const accepted = offer({ state: OFFER_STATES.accepted, accepted_by: "c", asked_user_ids: ["a", "b", "c"], current_user_id: "c" });
  assert.deepEqual(decideOfferReply({ offer: accepted, userId: "a", text: "ok", now: after(100) }), { action: "unavailable" });
  assert.deepEqual(decideOfferReply({ offer: accepted, userId: "c", text: "ok", now: after(100) }), { action: "duplicate" }); // o vencedor repetindo
  // tardio que repete a resposta: já está na fila → duplicado, sem 2º "deixa eu verificar"
  const queued = offer({ current_user_id: "c", asked_user_ids: ["a", "b"], late_accepts: addLateAccept([], { userId: "a", phone: "p", at: after(20), position: 0 }) });
  assert.deepEqual(decideOfferReply({ offer: queued, userId: "a", text: "sim", now: after(30) }), { action: "duplicate" });
  assert.equal(addLateAccept(queued.late_accepts, { userId: "a", phone: "p", at: after(40), position: 0 }), queued.late_accepts); // idempotente
  // esgotada: quem já estava na fila de tardios e repete → duplicado
  const exhaustedWithLate = offer({ state: OFFER_STATES.exhausted, late_accepts: queued.late_accepts });
  assert.deepEqual(decideOfferReply({ offer: exhaustedWithLate, userId: "a", text: "ok", clientAvailable: true }), { action: "duplicate" });
});

test("a própria vez já venceu e o cron ainda não passou a vez: a resposta entra como tardia, não se perde", () => {
  assert.deepEqual(decideOfferReply({ offer: offer(), userId: "a", text: "sim", now: after(65) }), { action: "queue", position: 0 });
});

test("texto da oferta", () => {
  assert.match(buildOfferText({ clientName: "Ana" }), /Tem um cliente \(Ana\) esperando e você é o próximo da roleta\./);
  assert.match(buildOfferText({}), /sim\* ou \*ok\* em até 1 minuto/);
});
