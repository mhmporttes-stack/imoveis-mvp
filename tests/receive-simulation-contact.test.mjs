import test from "node:test";
import assert from "node:assert/strict";
import { resolveReceiveSimulationContact, RECEIVE_CONTACT_STATE } from "../lib/receive-simulation-contact.mjs";

test("sem responsável (fila de espera da roleta) -> aguardando, sem telefone", () => {
  assert.deepEqual(resolveReceiveSimulationContact({ responsibleUserId: null, broker: null }), { state: RECEIVE_CONTACT_STATE.WAITING });
});

test("responsável ativo com WhatsApp válido -> abre o WhatsApp dele", () => {
  assert.deepEqual(
    resolveReceiveSimulationContact({ responsibleUserId: "u1", broker: { status: "active", whatsappDigits: "5514991099548" } }),
    { state: RECEIVE_CONTACT_STATE.READY, phone: "5514991099548" }
  );
});

test("responsável sem telefone, telefone inválido, inativo ou não encontrado -> indisponível (nunca número de reserva)", () => {
  const cases = [
    { status: "active", whatsappDigits: "" },
    { status: "active", whatsappDigits: "123" },
    { status: "inactive", whatsappDigits: "5514991099548" },
    null
  ];
  for (const broker of cases) {
    const result = resolveReceiveSimulationContact({ responsibleUserId: "u1", broker });
    assert.equal(result.state, RECEIVE_CONTACT_STATE.UNAVAILABLE);
    assert.equal(result.phone, undefined);
  }
});

// Incidente 2026-10-20: contato da apresentação vai ao número OFICIAL (PRES-25) — basta responsável ATIVO, sem telefone.
test("isPresentationContactReady: responsável ativo basta (com ou sem telefone); sem responsável, inativo ou inexistente não", async () => {
  const { isPresentationContactReady } = await import("../lib/receive-simulation-contact.mjs");
  assert.equal(isPresentationContactReady({ responsibleUserId: "u1", broker: { status: "active" } }), true);
  assert.equal(isPresentationContactReady({ responsibleUserId: "u1", broker: { status: "active", whatsappDigits: "" } }), true);
  assert.equal(isPresentationContactReady({ responsibleUserId: "", broker: { status: "active" } }), false);
  assert.equal(isPresentationContactReady({ responsibleUserId: "u1", broker: { status: "inactive" } }), false);
  assert.equal(isPresentationContactReady({ responsibleUserId: "u1", broker: null }), false);
});
