import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  caixaIncomeFromTypeReviews,
  finalReviewStatus,
  markedTypes,
  modelsWithCorrection,
  parseTypeCorrection,
  pendingTypes,
  typeReviewsFromRow,
  withTypeMark
} from "../lib/simulation-auto-review-types-core.mjs";

// Conferência por tipo (REGRA OFICIAL — dono, 2026-10-19): 👍/👎 sob o novo e o usado; link só com todos conferidos.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const both = { novo: { financingValue: "R$ 188.000,00", firstInstallment: "R$ 1.000,00" }, usado: { financingValue: "R$ 188.000,00", sac: {} } };

test("tipos marcados = com valores; pendentes até 👍 ou correção de cada um", () => {
  assert.deepEqual(markedTypes(both), ["novo", "usado"]);
  assert.deepEqual(markedTypes({ novo: { financingValue: "R$ 1,00" }, usado: {} }), ["novo"]);
  let reviews = {};
  assert.deepEqual(pendingTypes(both, reviews), ["novo", "usado"]);
  reviews = withTypeMark(reviews, "novo", { status: "ok" });
  assert.deepEqual(pendingTypes(both, reviews), ["usado"]);
  assert.equal(finalReviewStatus(reviews), "ok");
  reviews = withTypeMark(reviews, "usado", { status: "corrected", caixaIncome: 2400 });
  assert.deepEqual(pendingTypes(both, reviews), []);
  assert.equal(finalReviewStatus(reviews), "corrected");
  assert.equal(caixaIncomeFromTypeReviews(reviews), 2400);
});

test("marcas guardadas em corrected_snapshot.typeReviews (sem coluna nova)", () => {
  assert.deepEqual(typeReviewsFromRow({ corrected_snapshot: { typeReviews: { novo: { status: "ok" }, x: { status: "ok" } } } }), { novo: { status: "ok" } });
  assert.deepEqual(typeReviewsFromRow(null), {});
});

test("correção de um tipo: renda, financiado, 1ª parcela e prazo obrigatórios; só aquele tipo muda", () => {
  assert.match(parseTypeCorrection({ financingValue: "1" }).error, /renda/);
  assert.match(parseTypeCorrection({ caixaIncome: "2.400,00", firstInstallment: "700" }).error, /financiado/);
  assert.match(parseTypeCorrection({ caixaIncome: "2.400,00", financingValue: "150.000,00", firstInstallment: "700,00" }).error, /prazo/);
  const ok = parseTypeCorrection({ caixaIncome: "2.400,00", financingValue: "150.000,00", subsidyValue: "10.000,00", firstInstallment: "700,50", lastInstallment: "650,00", termMonths: "420" });
  assert.equal(ok.caixaIncome, 2400);
  assert.equal(ok.values.financingValue, "R$ 150.000,00");
  assert.equal(ok.values.firstInstallment, "R$ 700,50");
  const models = modelsWithCorrection({ novo: { financingValue: "x", propertyValue: "R$ 235.000,00", sac: { financingValue: "s" } }, usado: { financingValue: "u" } }, "novo", ok.values);
  assert.equal(models.novo.financingValue, "R$ 150.000,00");
  assert.equal(models.novo.propertyValue, "R$ 235.000,00");
  assert.equal(models.novo.sac.financingValue, "s");
  assert.equal(models.usado.financingValue, "u");
});

test("rota: guard, voto nunca se perde (cria a conferência ou recusa com mensagem), fecha só com todos os tipos", () => {
  const route = read("app/api/simulations/[id]/conferencia/route.js");
  assert.match(route, /requireAdminApi/);
  assert.match(route, /assertCanAccessResponsibleUser/);
  assert.match(route, /const open = await ensureOpenAutoReview\(simulation\);/);
  assert.match(route, /if \(!open\.row\) return NextResponse\.json\(\{ error: CLOSED_MESSAGE \}, \{ status: 409 \}\);/);
  assert.match(route, /if \(!saved\) return NextResponse\.json\(\{ error: CLOSED_MESSAGE \}/);
  assert.match(route, /if \(!closed\) return NextResponse\.json\(\{ error: CLOSED_MESSAGE \}/);
  // a simulação só vira do corretor (link, "Simulação realizada", ponto) depois de fechar a conferência com todos os tipos
  const finalSave = route.indexOf("const saved = await updateSimulation(id, finalPayload");
  assert.ok(route.indexOf("if (pending.length)") < finalSave && route.indexOf("closeAutoReview({") < finalSave);
  assert.match(route, /autosave: true \}/, "correção de um tipo grava como rascunho da automática");
});
