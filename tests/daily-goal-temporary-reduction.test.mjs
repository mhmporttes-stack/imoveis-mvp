import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TEMPORARY_DISPATCH_REDUCTIONS,
  decideTemporaryReduction,
  reducedDispatchTarget,
  temporaryDispatchReductionFor,
  isBusinessDay
} from "../lib/daily-goal-auto-core.mjs";
import { TEMPORARY_WINDOW_END_EXTENSIONS, temporaryWindowEndFor } from "../lib/daily-goal-window-core.mjs";

// PRNG determinístico (mulberry32) para simular o dia inteiro sem depender de sorte.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simula a fila de UM corretor em um dia: `pending` itens na ordem de horário, `sent` já enviados antes.
 * Cada item pendente passa por decideTemporaryReduction com os mesmos contadores que o banco devolve
 * (enviados, pendentes incluindo o candidato, descartados). `vanish` = itens que saem da fila por outro
 * motivo (obsoleto/falha) antes de serem decididos.
 */
function simulateDay({ pending, sent = 0, factor = 0.5, random, vanishEvery = 0 }) {
  let queue = pending;
  let totalSent = sent;
  let dropped = 0;
  const keptPositions = [];
  let position = 0;
  while (queue > 0) {
    if (vanishEvery && position > 0 && position % vanishEvery === 0) {
      queue -= 1; // item obsoleto: sai sem ser enviado nem descartado pela redução
      position += 1;
      if (queue === 0) break;
    }
    const decision = decideTemporaryReduction({ factor, sent: totalSent, pending: queue, dropped, random });
    queue -= 1;
    if (decision.keep) {
      totalSent += 1;
      keptPositions.push(position);
    } else {
      dropped += 1;
    }
    position += 1;
  }
  return { totalSent, dropped, keptPositions };
}

test("corte de 50% REVOGADO (2026-10-03): nenhuma data reduz envio; hoje sai 100%", () => {
  assert.equal(TEMPORARY_DISPATCH_REDUCTIONS.length, 0);
  for (const date of ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "", undefined, null]) {
    assert.equal(temporaryDispatchReductionFor(date), null, `não pode reduzir em ${date}`);
  }
  // mecanismo continua inerte/valido se alguem reativar uma entrada: entradas invalidas nunca reduzem
  assert.deepEqual(temporaryDispatchReductionFor("2026-10-03", [{ date: "2026-10-03", factor: 0.5, skipReason: "x" }]), { date: "2026-10-03", factor: 0.5, skipReason: "x" });
  assert.equal(temporaryDispatchReductionFor("2026-10-03", [{ date: "2026-10-03", factor: 1, skipReason: "x" }]), null);
  assert.equal(temporaryDispatchReductionFor("2026-10-03", [{ date: "2026-10-03", factor: 0.5 }]), null);
});

test("janela estendida ate 18:00 vale SOMENTE em 03/10/2026 (domingo e segunda voltam ao configurado)", () => {
  assert.equal(TEMPORARY_WINDOW_END_EXTENSIONS.length, 1);
  assert.equal(temporaryWindowEndFor("2026-10-03"), 1080);
  for (const date of ["2026-10-02", "2026-10-04", "2026-10-05", "2026-10-10", "", undefined, null]) {
    assert.equal(temporaryWindowEndFor(date), null, `não pode estender em ${date}`);
  }
  assert.equal(temporaryWindowEndFor("2026-10-03", [{ date: "2026-10-03", endMinutes: 5000 }]), null);
});

test("domingo segue bloqueado e sabado liberado (isBusinessDay)", () => {
  assert.equal(isBusinessDay(0), false);
  assert.equal(isBusinessDay(6), true);
  assert.equal(isBusinessDay(1), true);
});

test("alvo de envios: 80→40, 50→25, 20→10 (e arredondamento seguro)", () => {
  assert.equal(reducedDispatchTarget(80, 0.5), 40);
  assert.equal(reducedDispatchTarget(50, 0.5), 25);
  assert.equal(reducedDispatchTarget(20, 0.5), 10);
  assert.equal(reducedDispatchTarget(100, 0.5), 50);
  assert.equal(reducedDispatchTarget(21, 0.5), 10, "ímpar arredonda para baixo");
  assert.equal(reducedDispatchTarget(3, 0.5), 1);
  assert.equal(reducedDispatchTarget(1, 0.5), 1, "nunca zera um dia que teria envio");
  assert.equal(reducedDispatchTarget(0, 0.5), 0);
});

for (const [elegiveis, esperado] of [[80, 40], [50, 25], [20, 10]]) {
  test(`dia completo: ${elegiveis} elegíveis → exatamente ${esperado} enviados (várias sementes)`, () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const result = simulateDay({ pending: elegiveis, random: prng(seed) });
      assert.equal(result.totalSent, esperado, `semente ${seed}`);
      assert.equal(result.dropped, elegiveis - esperado);
    }
  });
}

test("os envios que sobram ficam espalhados pelo dia inteiro (não ficam todos na manhã)", () => {
  const { keptPositions } = simulateDay({ pending: 80, random: prng(7) });
  const primeiraMetade = keptPositions.filter((p) => p < 40).length;
  assert.ok(primeiraMetade >= 12 && primeiraMetade <= 28, `primeira metade do dia com ${primeiraMetade} de 40`);
  assert.ok(keptPositions.some((p) => p >= 70), "ainda há envio no fim da fila");
});

test("fila que já tinha envios antes da publicação: o total do dia fecha na metade do total", () => {
  // 15 já enviados + 65 pendentes = 80 → alvo 40 → só 25 dos pendentes seguem
  for (let seed = 1; seed <= 200; seed += 1) {
    const result = simulateDay({ pending: 65, sent: 15, random: prng(seed) });
    assert.equal(result.totalSent, 40, `semente ${seed}`);
  }
  // já passou da metade (50 enviados + 30 pendentes = 80): nenhum pendente é enviado
  assert.equal(simulateDay({ pending: 30, sent: 50, random: prng(3) }).totalSent, 50);
  assert.equal(simulateDay({ pending: 30, sent: 50, random: prng(3) }).dropped, 30);
});

test("itens que saem da fila por outro motivo reduzem o total do dia junto (continua ≈ metade do que seria enviado)", () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const result = simulateDay({ pending: 80, random: prng(seed), vanishEvery: 8 });
    // saíram ~10 itens; o que seria enviado sem a exceção ≈ 70 → alvo ≈ 35 (tolerância de ±2)
    assert.ok(result.totalSent >= 33 && result.totalSent <= 40, `semente ${seed}: ${result.totalSent}`);
  }
});

test("fora da data: nenhuma decisão é aplicada (a fila segue integral)", () => {
  // o código só chama decideTemporaryReduction quando temporaryDispatchReductionFor(data) existe
  const reduction = temporaryDispatchReductionFor("2026-10-04");
  assert.equal(reduction, null);
  let enviados = 0;
  for (let i = 0; i < 80; i += 1) if (!reduction) enviados += 1;
  assert.equal(enviados, 80);
});

test("decisão é estável: o total do dia não muda quando um item é enviado ou descartado", () => {
  const a = decideTemporaryReduction({ factor: 0.5, sent: 0, pending: 80, dropped: 0, random: () => 0 });
  const b = decideTemporaryReduction({ factor: 0.5, sent: 1, pending: 79, dropped: 0, random: () => 0 });
  const c = decideTemporaryReduction({ factor: 0.5, sent: 0, pending: 79, dropped: 1, random: () => 0 });
  assert.equal(a.total, 80);
  assert.equal(b.total, 80);
  assert.equal(c.total, 80);
  assert.equal(a.target, 40);
  // meta atingida: descarta sempre; vagas ≥ pendentes: segue sempre
  assert.equal(decideTemporaryReduction({ factor: 0.5, sent: 40, pending: 40, dropped: 0, random: () => 0 }).keep, false);
  assert.equal(decideTemporaryReduction({ factor: 0.5, sent: 0, pending: 1, dropped: 1, random: () => 0.999 }).keep, true);
});

test("integração (leitura do código): descarta antes de enviar, não refaz a fila de hoje e tem rótulo na tela", () => {
  const src = fs.readFileSync(new URL("../lib/daily-goal-auto.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  // descarte acontece depois do claim e ANTES de processClaimedItem
  const iClaim = src.indexOf('rpc("claim_next_daily_goal_auto_item"');
  const iDrop = src.indexOf("await dropItemByTemporaryReduction({ item, brokerId })");
  const iProcess = src.indexOf('processClaimedItem({ item, brokerId, brokerName, staleSkips, source: "meta" })');
  assert.ok(iClaim > 0 && iDrop > iClaim && iProcess > iDrop, "ordem: claim → redução → envio");
  // falha ao decidir NUNCA envia: devolve à fila
  assert.ok(/erro_reducao_temporaria/.test(src));
  // a fila de hoje não é refeita com quem foi descartado
  assert.ok(/eq\("skip_reason", reduction\.skipReason\)/.test(src));
  // só a fila da Meta Diária (a fila extra do Disparar não é tocada)
  assert.ok(/eq\("source", "meta"\)\s*\n\s*\.gte\("scheduled_for"/.test(src));
  const admin = fs.readFileSync(new URL("../components/DailyGoalAdmin.jsx", import.meta.url), "utf8");
  assert.ok(admin.includes("reducao_temporaria_2026_10_03"));
});
