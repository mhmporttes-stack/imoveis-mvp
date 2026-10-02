import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cycleStateFromHistory, pickAntiRepeatVariant, wasVariantActuallySent } from "../lib/daily-goal-auto-core.mjs";

// Escolha dos modelos com aleatoriedade + anti-repetição (regra do dono,
// 2026-10-02). Sem envio real: só a regra pura e a ordem no código.

// Gerador determinístico (mulberry32) para os testes serem reproduzíveis.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(count, sends, random) {
  const history = [];
  for (let i = 0; i < sends; i += 1) history.push(pickAntiRepeatVariant({ count, history, random }));
  return history;
}

const cycles = (sequence, size) => Array.from({ length: Math.floor(sequence.length / size) }, (_, i) => sequence.slice(i * size, (i + 1) * size));

test("4 modelos: os 4 primeiros envios usam os 4, sem repetir", () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const first = run(4, 4, seeded(seed));
    assert.equal(new Set(first).size, 4, `seed ${seed}: ${first}`);
  }
});

test("4 modelos: a ordem não é fixa (sementes diferentes geram ordens diferentes)", () => {
  const orders = new Set();
  for (let seed = 1; seed <= 50; seed += 1) orders.add(run(4, 4, seeded(seed)).join(""));
  assert.ok(orders.size >= 10, `só ${orders.size} ordens distintas`);
  assert.ok(!(orders.size === 1 && orders.has("0123")), "nunca a sequência 1→2→3→4 fixa");
});

test("4 modelos: cada ciclo é completo, novo ciclo embaralhado de novo e nunca começa pelo último enviado", () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    const sequence = run(4, 40, seeded(seed));
    const list = cycles(sequence, 4);
    for (const cycle of list) assert.equal(new Set(cycle).size, 4, `seed ${seed}: ${cycle}`);
    for (let i = 1; i < list.length; i += 1) assert.notEqual(list[i][0], list[i - 1][3], `seed ${seed}: fronteira ${list[i - 1]} | ${list[i]}`);
    assert.ok(new Set(list.map((cycle) => cycle.join(""))).size > 1, `seed ${seed}: todos os ciclos iguais`);
  }
});

test("10 modelos: os 10 primeiros usam todos; o 11º abre novo ciclo; o novo ciclo é embaralhado de novo", () => {
  let differentCycles = 0;
  for (let seed = 1; seed <= 30; seed += 1) {
    const sequence = run(10, 20, seeded(seed));
    const [first, second] = cycles(sequence, 10);
    assert.equal(new Set(first).size, 10);
    assert.equal(new Set(second).size, 10);
    assert.notEqual(second[0], first[9], "11º não repete o 10º");
    if (first.join(",") !== second.join(",")) differentCycles += 1;
  }
  assert.equal(differentCycles, 30, "ciclo seguinte nunca repete a mesma ordem automaticamente");
});

test("separação: Eduardo não interfere em Bruna; 1ª, 2ª e 3ª tentativa têm ciclos próprios", () => {
  const histories = new Map();
  const key = (broker, attempt) => `${broker}:${attempt}`;
  const send = (broker, attempt, count, random) => {
    const history = histories.get(key(broker, attempt)) || [];
    const index = pickAntiRepeatVariant({ count, history, random });
    histories.set(key(broker, attempt), [...history, index]);
    return index;
  };
  const random = seeded(7);
  // Eduardo envia 3 de 1ª tentativa; Bruna continua com o ciclo dela inteiro.
  for (let i = 0; i < 3; i += 1) send("eduardo", 1, 4, random);
  const bruna = [send("bruna", 1, 4, random), send("bruna", 1, 4, random), send("bruna", 1, 4, random), send("bruna", 1, 4, random)];
  assert.equal(new Set(bruna).size, 4, "Bruna usa os 4 dela, sem herdar o ciclo do Eduardo");
  // O ciclo da 1ª tentativa não muda a escolha da 2ª/3ª.
  assert.equal(cycleStateFromHistory(histories.get("eduardo:2"), 4).used.size, 0);
  const second = [send("eduardo", 2, 4, random), send("eduardo", 2, 4, random), send("eduardo", 2, 4, random), send("eduardo", 2, 4, random)];
  assert.equal(new Set(second).size, 4);
  const third = Array.from({ length: 10 }, () => send("eduardo", 3, 10, random));
  assert.equal(new Set(third).size, 10);
  assert.equal(new Set(histories.get("eduardo:1")).size, 3, "ciclo da 1ª do Eduardo continua com 3 usados");
});

test("concorrência: escolha só acontece com o item reivindicado e um envio por vez por número", () => {
  const auto = readFileSync(new URL("../lib/daily-goal-auto.js", import.meta.url), "utf8");
  const process = auto.slice(auto.indexOf("async function processClaimedItem"));
  const selectAt = process.indexOf("await selectVariantForSend(");
  const markerAt = process.indexOf("send_started_at: new Date().toISOString(), message_text: selected.text");
  const sendAt = process.indexOf("sendIndividualMessage(brokerId");
  assert.ok(selectAt > 0 && selectAt < markerAt && markerAt < sendAt, "escolhe → grava junto com a marca de envio → envia");
  // Meta Diária e Disparar passam pelo MESMO processClaimedItem; nenhuma outra escolha no código.
  assert.ok(!/nextSequentialVariantIndex|pickMessageVariant|variant_cursor_attempt/.test(auto), "rotação antiga removida do motor");
  assert.ok(!/nextSequentialVariantIndex|variant_cursor_attempt/.test(readFileSync(new URL("../lib/prospecting-extra-dispatch.js", import.meta.url), "utf8")), "Disparar não escolhe modelo no clique");
  // No banco, claim_next_* não entrega item enquanto outro do mesmo número está "enviando".
  const sql = readFileSync(new URL("../supabase/migrations/20261002240000_prospecting_extra_dispatch_queue.sql", import.meta.url), "utf8");
  assert.equal((sql.match(/pg_advisory_xact_lock\(hashtext\('dispatch_send:'/g) || []).length, 2);
  // Dois "workers" do mesmo número em série (o que o banco garante) nunca repetem dentro do ciclo.
  const history = [];
  const random = seeded(11);
  for (let i = 0; i < 4; i += 1) history.push(pickAntiRepeatVariant({ count: 4, history, random }));
  assert.equal(new Set(history).size, 4);
});

test("cancelamento: só mensagem que saiu entra no histórico", () => {
  assert.equal(wasVariantActuallySent({ variant_index: 2, status: "sent" }), true);
  assert.equal(wasVariantActuallySent({ variant_index: 2, status: "error", wa_message_id: "WA1" }), true, "enviado mas falhou ao registrar");
  assert.equal(wasVariantActuallySent({ variant_index: 2, status: "error", skip_reason: "enviando_sem_confirmacao" }), true, "envio incerto conta (conservador)");
  for (const status of ["canceled", "skipped", "pending", "sending", "error"]) {
    assert.equal(wasVariantActuallySent({ variant_index: 2, status }), false, status);
  }
  assert.equal(wasVariantActuallySent({ variant_index: null, status: "sent" }), false, "itens antigos sem modelo");
  // Modelo cancelado antes do envio continua disponível no ciclo.
  const sentOnly = [{ variant_index: 0, status: "sent" }, { variant_index: 1, status: "canceled" }].filter(wasVariantActuallySent).map((row) => row.variant_index);
  assert.deepEqual([...cycleStateFromHistory(sentOnly, 4).used], [0]);
});

test("histórico com modelo apagado ou repetição antiga não quebra a escolha", () => {
  assert.ok([0, 1, 2].includes(pickAntiRepeatVariant({ count: 3, history: [7, 9, 1, 1] })));
  assert.notEqual(pickAntiRepeatVariant({ count: 2, history: [0, 1], random: () => 0.99 }), 1, "novo ciclo nunca repete o último");
  assert.equal(pickAntiRepeatVariant({ count: 1, history: [0, 0] }), 0);
  assert.equal(pickAntiRepeatVariant({ count: 0, history: [] }), -1);
});

// Simulação pedida pelo dono: 100+ seleções por etapa, com o sorteio real.
test("simulação 100 envios por etapa: uso equilibrado, nunca 2 iguais seguidos, sem sequência fixa", () => {
  for (const [label, count] of [["1ª", 4], ["2ª", 4], ["3ª", 10]]) {
    const sequence = run(count, 100, Math.random);
    const usage = Array.from({ length: count }, (_, index) => sequence.filter((value) => value === index).length);
    let maxRun = 1;
    let current = 1;
    for (let i = 1; i < sequence.length; i += 1) {
      current = sequence[i] === sequence[i - 1] ? current + 1 : 1;
      maxRun = Math.max(maxRun, current);
    }
    const cycleOrders = new Set(cycles(sequence, count).map((cycle) => cycle.join(",")));
    assert.equal(maxRun, 1, `${label}: repetição consecutiva`);
    assert.ok(Math.max(...usage) - Math.min(...usage) <= 1, `${label}: uso desequilibrado ${usage}`);
    assert.ok(cycleOrders.size > 1, `${label}: ciclos sempre na mesma ordem`);
  }
});
