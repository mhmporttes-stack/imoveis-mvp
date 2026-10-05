// Máquina de estados do player da apresentação (lógica pura, sem DOM).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  advanceClock,
  countValue,
  createPlayerState,
  isAutoAdvancing,
  isLastScene,
  isPaused,
  keyAction,
  playerReducer,
  sceneMetricEvents,
  swipeAction,
  tapAction,
  transitionPlan
} from "../components/presentation/player-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
const run = (state, ...actions) => actions.reduce((current, action) => playerReducer(current, typeof action === "string" ? { type: action } : action), state);

test("avançar, voltar e ir para uma cena respeitam os limites", () => {
  let s = createPlayerState(4);
  assert.equal(s.index, 0);
  assert.equal(run(s, "prev").index, 0, "não volta antes da primeira");
  assert.equal(run(s, "next", "next").index, 2);
  assert.equal(run(s, "next", "next", "prev").index, 1);
  s = run(s, "next", "next", "next");
  assert.equal(s.index, 3);
  assert.equal(isLastScene(s), true);
  assert.equal(run(s, "next").index, 3, "não passa da última");
  assert.equal(run(s, "next").ended, true);
  assert.equal(run(s, "next", "prev").ended, false, "voltar sai do estado de fim");
  assert.equal(run(createPlayerState(4), { type: "goto", index: 99 }).index, 3);
  assert.equal(run(createPlayerState(4), { type: "goto", index: -5 }).index, 0);
});

test("pausar e continuar; auto-avanço só corre sem pausa", () => {
  let s = createPlayerState(3);
  assert.equal(isAutoAdvancing(s), true);
  s = run(s, "pause");
  assert.equal(s.paused, true);
  assert.equal(isAutoAdvancing(s), false);
  assert.equal(run(s, "auto").index, 0, "relógio vencido com pausa não avança");
  s = run(s, "resume");
  assert.equal(isAutoAdvancing(s), true);
  assert.equal(run(s, "auto").index, 1);
  assert.equal(run(s, "toggle").paused, true);
  assert.equal(run(s, "toggle", "toggle").paused, false);
});

test("aba oculta pausa o auto-avanço e voltar à aba retoma (sem mexer na pausa do usuário)", () => {
  let s = run(createPlayerState(3), "hidden");
  assert.equal(isPaused(s), true);
  assert.equal(isAutoAdvancing(s), false);
  assert.equal(run(s, "auto").index, 0);
  s = run(s, "visible");
  assert.equal(isAutoAdvancing(s), true);
  const userPaused = run(createPlayerState(3), "pause", "hidden", "visible");
  assert.equal(userPaused.paused, true, "continua pausado pelo usuário");
  assert.equal(isAutoAdvancing(userPaused), false);
});

test("última cena: auto-avanço para e marca fim; uma cena só não avança sozinha", () => {
  let s = createPlayerState(2);
  s = run(s, "auto");
  assert.equal(s.index, 1);
  assert.equal(isAutoAdvancing(s), false);
  s = run(s, "auto");
  assert.equal(s.index, 1);
  assert.equal(s.ended, true);
  assert.equal(isAutoAdvancing(createPlayerState(1)), false);
  assert.equal(isAutoAdvancing(createPlayerState(0)), false);
});

test("relógio da cena: acumula só tempo ativo e vence na duração", () => {
  let clock = { elapsed: 0 };
  clock = advanceClock({ ...clock, delta: 1000, duration: 5000 });
  assert.deepEqual(clock, { elapsed: 1000, done: false });
  clock = advanceClock({ ...clock, delta: 0, duration: 5000 });
  assert.equal(clock.elapsed, 1000, "pausa (delta 0) não consome tempo");
  clock = advanceClock({ ...clock, delta: 4500, duration: 5000 });
  assert.deepEqual(clock, { elapsed: 5000, done: true });
  assert.equal(advanceClock({ elapsed: 0, delta: -50, duration: 100 }).elapsed, 0);
});

test("toque: terço esquerdo volta, resto avança; swipe horizontal claro troca; vertical não", () => {
  assert.equal(tapAction(10, 390), "prev");
  assert.equal(tapAction(116, 390), "prev");
  assert.equal(tapAction(200, 390), "next");
  assert.equal(tapAction(10, 0), "next");
  assert.equal(swipeAction(-80, 5), "next");
  assert.equal(swipeAction(80, 5), "prev");
  assert.equal(swipeAction(-30, 0), null, "curto demais");
  assert.equal(swipeAction(-60, 90), null, "rolagem vertical");
});

test("teclado: setas navegam, espaço pausa", () => {
  assert.equal(keyAction("ArrowRight"), "next");
  assert.equal(keyAction("ArrowLeft"), "prev");
  assert.equal(keyAction(" "), "toggle");
  assert.equal(keyAction("a"), null);
});

test("movimento reduzido: sem cena em saída e contador mostra o valor final direto", () => {
  const reduced = { ...createPlayerState(5), index: 2, reducedMotion: true };
  assert.deepEqual(transitionPlan(reduced, 1), { leaving: null, direction: "none" });
  const normal = { ...createPlayerState(5), index: 2 };
  assert.deepEqual(transitionPlan(normal, 1), { leaving: 1, direction: "forward" });
  assert.deepEqual(transitionPlan(normal, 3), { leaving: 3, direction: "back" });
  assert.deepEqual(transitionPlan(normal, null), { leaving: null, direction: "none" });
  assert.equal(countValue(232000, 0.1, true), 232000);
  assert.equal(countValue(232000, 0, false), 0);
  assert.equal(countValue(232000, 1, false), 232000);
  const mid = countValue(232000, 0.4, false);
  assert.ok(mid > 0 && mid < 232000);
  assert.ok(countValue(232000, 0.5, false) > mid, "sobe de forma monótona");
});

test("métricas: cena nova gera evento uma vez; chegar na última conclui; voltar não repete", () => {
  let r = sceneMetricEvents({ index: 0, total: 3, maxReached: 0 });
  assert.deepEqual(r.events, [{ tipo: "cena", cena: 1 }]);
  r = sceneMetricEvents({ index: 1, total: 3, maxReached: r.maxReached });
  assert.deepEqual(r.events, [{ tipo: "cena", cena: 2 }]);
  r = sceneMetricEvents({ index: 0, total: 3, maxReached: r.maxReached });
  assert.deepEqual(r.events, [], "voltar não reenvia");
  r = sceneMetricEvents({ index: 2, total: 3, maxReached: 2 });
  assert.deepEqual(r.events, [{ tipo: "cena", cena: 3 }, { tipo: "concluiu", cena: 3 }]);
});

test("player: previa e token vazio não enviam métrica; sem áudio, sem CDN, texto de zero nunca aparece", () => {
  const source = fs.readFileSync(path.join(root, "components/presentation/PresentationPlayer.jsx"), "utf8");
  assert.match(source, /const tracking = Boolean\(token\) && !preview/);
  assert.match(source, /if \(!tracking\) return/);
  assert.ok(!/<audio|new Audio|AudioContext/.test(source));
  assert.ok(!/https?:\/\/(cdn|unpkg|fonts)/i.test(source));
  assert.match(source, /visibilitychange/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="region"/);
  assert.match(source, /Pausar apresentação/);
  assert.match(source, /sessionStorage/);
  assert.ok(!/R\$ 0,00|formatBRL\(0\)|"R\$ 0"/.test(source), "nunca destaca R$ 0");
  assert.match(source, /Seu poder de compra vem do financiamento\./);
  const css = fs.readFileSync(path.join(root, "components/presentation/presentation.module.css"), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /100dvh/);
  assert.match(css, /safe-area-inset/);
  assert.ok(!/transition:\s*all/.test(css));
});
