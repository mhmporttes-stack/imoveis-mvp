import assert from "node:assert/strict";
import test from "node:test";
import { calculateCommissionDistribution } from "./financial-calculations.js";

test("Matheus e corretor sem gestor dividem 50/50", () => {
  const result = calculateCommissionDistribution({ freeCommission: 10000, brokerPercentage: 50, agencyPercentage: 50 });
  assert.equal(result.brokerCommission, 5000);
  assert.equal(result.agencyCommission, 5000);
  assert.equal(result.managerCommission, 0);
});

test("gestor recebe 10% antes da divisão 50/50", () => {
  const result = calculateCommissionDistribution({ freeCommission: 10000, hasManagerCommission: true, managerPercentage: 10, brokerPercentage: 50, agencyPercentage: 50 });
  assert.deepEqual([result.managerCommission, result.distributionBase, result.brokerCommission, result.agencyCommission], [1000, 9000, 4500, 4500]);
});

test("aceita divisão 60/40 e alteração específica da venda", () => {
  const standard = calculateCommissionDistribution({ freeCommission: 10000, brokerPercentage: 60, agencyPercentage: 40 });
  const manual = calculateCommissionDistribution({ freeCommission: 10000, brokerPercentage: 70, agencyPercentage: 30 });
  assert.deepEqual([standard.brokerCommission, standard.agencyCommission], [6000, 4000]);
  assert.deepEqual([manual.brokerCommission, manual.agencyCommission], [7000, 3000]);
});

test("snapshot mantém percentuais usados mesmo após mudança do padrão", () => {
  const snapshot = { freeCommission: 10000, brokerPercentage: 60, agencyPercentage: 40 };
  const saved = calculateCommissionDistribution(snapshot);
  const changedDefault = { brokerPercentage: 50, agencyPercentage: 50 };
  assert.equal(saved.brokerPercentage, 60);
  assert.equal(snapshot.brokerPercentage, 60);
  assert.equal(changedDefault.brokerPercentage, 50);
});

test("arredondamento sempre fecha no centavo", () => {
  const result = calculateCommissionDistribution({ freeCommission: 9999.99, hasManagerCommission: true, managerPercentage: 10, brokerPercentage: 60, agencyPercentage: 40 });
  assert.equal(result.managerCommission + result.brokerCommission + result.agencyCommission, result.freeCommission);
});

test("rejeita divisão diferente de 100%", () => {
  assert.throws(() => calculateCommissionDistribution({ freeCommission: 1000, brokerPercentage: 60, agencyPercentage: 50 }), /100%/);
});
