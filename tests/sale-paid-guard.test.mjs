// FIN-7 (regra do dono, 2026-10-24): só a conta REAL do dono coloca o cliente em "Pago"; data futura recusada.
import test from "node:test";
import assert from "node:assert/strict";
import { assertSalePaidAllowed, canMarkSalePaid } from "../lib/sale-paid-guard-core.mjs";

const OWNER = "dono@example.com";
const isOwner = (email) => email === OWNER;
const auth = (email, extra = {}) => ({ ok: true, user: { email }, profile: { role: "admin" }, ...extra });

test("só o dono, fora de Alterar conta, pode marcar Pago", () => {
  assert.equal(canMarkSalePaid(auth(OWNER), isOwner), true);
  assert.equal(canMarkSalePaid(auth("outro-admin@example.com"), isOwner), false);
  assert.equal(canMarkSalePaid(auth("corretor@example.com", { profile: { role: "broker" } }), isOwner), false);
  // dono em "Alterar conta": o e-mail efetivo é o do emulado e accountSwitchMode = true
  assert.equal(canMarkSalePaid(auth("corretor@example.com", { accountSwitchMode: true, realUser: { email: OWNER } }), isOwner), false);
  assert.equal(canMarkSalePaid(auth(OWNER, { accountSwitchMode: true }), isOwner), false);
  // automação sem usuário
  assert.equal(canMarkSalePaid(null, isOwner), false);
});

test("barreira: erro 403 claro para quem não é o dono", () => {
  assert.throws(() => assertSalePaidAllowed({ auth: auth("gestor@example.com"), isOwnerEmail: isOwner, today: "2026-10-24" }),
    (error) => error.status === 403 && error.code === "SALE_PAID_OWNER_ONLY" && /Somente o dono/.test(error.message));
  assert.doesNotThrow(() => assertSalePaidAllowed({ auth: auth(OWNER), isOwnerEmail: isOwner, today: "2026-10-24" }));
});

test("data do recebimento: hoje e passado aceitos, futuro recusado", () => {
  const base = { auth: auth(OWNER), isOwnerEmail: isOwner, today: "2026-10-24" };
  assert.doesNotThrow(() => assertSalePaidAllowed({ ...base, receivedDate: "2026-10-24" }));
  assert.doesNotThrow(() => assertSalePaidAllowed({ ...base, receivedDate: "2026-09-30" }));
  assert.doesNotThrow(() => assertSalePaidAllowed({ ...base, receivedDate: "" }));
  assert.throws(() => assertSalePaidAllowed({ ...base, receivedDate: "2026-10-25" }), (error) => error.code === "SALE_PAID_FUTURE_DATE");
});
