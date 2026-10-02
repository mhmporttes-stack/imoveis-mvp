import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { whatsappCardIconTone } from "../lib/whatsapp-restriction-core.mjs";

test("icone do WhatsApp: verde so para conectado", () => {
  assert.equal(whatsappCardIconTone({ sessionStatus: "connected" }), "connected");
});

test("icone do WhatsApp: cinza para todos os demais estados", () => {
  for (const sessionStatus of ["connecting", "reconnecting", "qr_required", "pairing_code_required", "disconnected", "error", "expired", "nunca_conectou", null, undefined, "xyz"]) {
    assert.equal(whatsappCardIconTone({ sessionStatus }), "off", String(sessionStatus));
  }
  for (const validation_status of ["informed", "validated"]) {
    assert.equal(whatsappCardIconTone({ sessionStatus: "disconnected", openRestriction: { validation_status } }), "off");
  }
  assert.equal(whatsappCardIconTone(), "off");
});

test("cards da Meta Diaria nao usam whatsappTone (laranja) no icone do WhatsApp", () => {
  for (const f of ["components/TeamDailyPerformance.jsx", "components/DailyGoalAdmin.jsx", "components/DailyGoalDashboard.jsx"]) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /whatsappTone\(/, f);
    for (const line of src.split("\n").filter((l) => /kind="whatsapp"/.test(l))) {
      assert.doesNotMatch(line, /orange|amber|partial/, f);
      assert.match(line, /whatsappCardIconTone/, f);
    }
  }
});
