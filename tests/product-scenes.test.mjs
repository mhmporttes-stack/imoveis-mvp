// Cenas de produto (2026-10-25): regras puras de quando tocar e de "já animei" (components/motion/product-scenes-core.mjs).
// Só apresentação — nenhuma delas decide dado, permissão ou regra de negócio.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DAILY_STAGGER_MAX,
  DAILY_STAGGER_STEP_MS,
  claimDailyIntro,
  createSceneMemory,
  dailyStaggerDelay,
  firstNameOf,
  saoPauloDay,
  shouldPlayPaidScene,
  shouldPlayStatusScene,
  statusSceneKeys
} from "../components/motion/product-scenes-core.mjs";

const memoryOf = () => {
  const data = new Map();
  return createSceneMemory(() => ({ getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) }));
};

test("storage quebrado nunca derruba a cena: cai na memória do processo", () => {
  const broken = createSceneMemory(() => { throw new Error("storage bloqueado"); });
  assert.equal(broken.read("x"), null);
  broken.write("x", "1");
  assert.equal(broken.read("x"), "1");
  const nulo = createSceneMemory(() => null);
  nulo.write("y", "2");
  assert.equal(nulo.read("y"), "2");
});

test("primeiro nome para o selo de transferência", () => {
  assert.equal(firstNameOf("Carla Demonstração Silva"), "Carla");
  assert.equal(firstNameOf("  Ana  "), "Ana");
  assert.equal(firstNameOf(""), "");
  assert.equal(firstNameOf(null), "");
});

test("aprovado: só quando a tela VIU a mudança, uma vez por mudança", () => {
  const target = "approved";
  assert.equal(shouldPlayStatusScene({ previous: "documentation_pending", current: "approved", target }), true);
  // 1ª vez que a aba vê o cliente (sem registro anterior) não encena a lista inteira
  assert.equal(shouldPlayStatusScene({ previous: null, current: "approved", target }), false);
  // já era aprovado
  assert.equal(shouldPlayStatusScene({ previous: "approved", current: "approved", target }), false);
  // mudou para outra coisa
  assert.equal(shouldPlayStatusScene({ previous: "approved", current: "meeting_pending", target }), false);
  // já animou esta mudança
  assert.equal(shouldPlayStatusScene({ previous: "in_service", current: "approved", target, alreadyAnimated: true }), false);
  const keys = statusSceneKeys("abc", "approved");
  assert.notEqual(keys.seen, keys.animated);
  assert.match(keys.animated, /abc:approved$/);
});

test("pago: só na resposta que devolve a venda recebida, uma vez por venda", () => {
  assert.equal(shouldPlayPaidScene({ previousStatus: "pending", nextStatus: "received" }), true);
  assert.equal(shouldPlayPaidScene({ previousStatus: "partial", nextStatus: "received" }), true);
  assert.equal(shouldPlayPaidScene({ previousStatus: "received", nextStatus: "received" }), false);
  assert.equal(shouldPlayPaidScene({ previousStatus: "pending", nextStatus: "partial" }), false);
  assert.equal(shouldPlayPaidScene({ previousStatus: "pending", nextStatus: "received", alreadyPlayed: true }), false);
});

test("Meta Diária: uma vez por conta e dia; sem conta não toca", () => {
  const memory = memoryOf();
  assert.equal(claimDailyIntro({ memory, viewerKey: "u1", day: "2026-10-25" }), true);
  assert.equal(claimDailyIntro({ memory, viewerKey: "u1", day: "2026-10-25" }), false);
  assert.equal(claimDailyIntro({ memory, viewerKey: "u2", day: "2026-10-25" }), true);
  assert.equal(claimDailyIntro({ memory, viewerKey: "u1", day: "2026-10-26" }), true);
  assert.equal(claimDailyIntro({ memory, viewerKey: "", day: "2026-10-25" }), false);
});

test("Meta Diária: no máximo 6 cartões, ≤ 40 ms entre eles", () => {
  assert.equal(DAILY_STAGGER_MAX, 6);
  assert.ok(DAILY_STAGGER_STEP_MS <= 40);
  assert.equal(dailyStaggerDelay(0), 0);
  assert.equal(dailyStaggerDelay(5), 5 * DAILY_STAGGER_STEP_MS);
  assert.equal(dailyStaggerDelay(6), null);
  assert.equal(dailyStaggerDelay(-1), null);
});

test("dia de São Paulo, não o do servidor/UTC", () => {
  // 01:30 UTC de 26/10 ainda é 22:30 de 25/10 em São Paulo (UTC-3)
  assert.equal(saoPauloDay(new Date("2026-10-26T01:30:00Z")), "2026-10-25");
  assert.equal(saoPauloDay(new Date("2026-10-25T15:00:00Z")), "2026-10-25");
});

test("as cenas só animam transform/opacity/stroke-dashoffset e respeitam movimento reduzido", () => {
  const css = readFileSync(new URL("../components/motion/ProductScenes.module.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /transition:\s*all/);
  assert.doesNotMatch(css, /will-change/);
  // nenhum keyframe mexe em largura/altura/posição
  const keyframes = [];
  for (let at = css.indexOf("@keyframes"); at !== -1; at = css.indexOf("@keyframes", at + 1)) {
    let depth = 0;
    let end = css.indexOf("{", at);
    for (let i = end; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
      if (depth === 0) { end = i; break; }
    }
    keyframes.push(css.slice(at, end + 1));
  }
  assert.ok(keyframes.length >= 8);
  for (const block of keyframes) assert.doesNotMatch(block, /\b(width|height|top|left|right|bottom|margin)\s*:/, block.slice(0, 60));
  // as camadas nunca seguram o clique
  for (const selector of [".paidLayer", ".approvedLayer", ".transferSeal", ".transferOut"]) {
    const rule = css.match(new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{[^}]*\\}`, "m"))?.[0] || "";
    assert.match(rule, /pointer-events:\s*none/, selector);
  }
  const form = readFileSync(new URL("../components/simulation-form/SimulationForm.module.css", import.meta.url), "utf8");
  assert.match(form, /\.sentRing,\s*\n\s*\.sentTick,[\s\S]*?animation: none !important/);
});

test("cadastro recebido: a animação do botão não toca no redirecionamento", () => {
  const source = readFileSync(new URL("../components/simulation-form/SimulationForm.jsx", import.meta.url), "utf8");
  // a saída continua o mesmo comando, sem atraso nem espera por animação
  assert.match(source, /window\.location\.href = url;/);
  assert.doesNotMatch(source, /setTimeout\([^)]*location\.href/);
  assert.match(source, /data-scene="sent"/);
});
