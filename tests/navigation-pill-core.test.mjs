import test from "node:test";
import assert from "node:assert/strict";
import {
  NAVIGATION_PILL_CAP_MS,
  NAVIGATION_PILL_DELAY_MS,
  createNavigationPill,
  isPlainNavigationClick,
  isSameLocation
} from "../components/navigation-pill-core.mjs";

// Relógio falso: avança o tempo disparando os timers vencidos.
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      timers.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    }
  };
}

function setup() {
  const clock = fakeClock();
  const pill = createNavigationPill({ setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  let changes = 0;
  pill.subscribe(() => { changes += 1; });
  return { clock, pill, changes: () => changes };
}

test("não aparece antes do atraso mínimo e aparece depois", () => {
  const { clock, pill } = setup();
  pill.start();
  assert.equal(pill.isVisible(), false);
  clock.advance(NAVIGATION_PILL_DELAY_MS - 1);
  assert.equal(pill.isVisible(), false);
  clock.advance(1);
  assert.equal(pill.isVisible(), true);
});

test("navegação instantânea (termina antes do atraso) nunca pisca", () => {
  const { clock, pill, changes } = setup();
  pill.start();
  clock.advance(50);
  pill.finish();
  clock.advance(NAVIGATION_PILL_CAP_MS);
  assert.equal(pill.isVisible(), false);
  assert.equal(changes(), 0);
});

test("some ao concluir a navegação", () => {
  const { clock, pill } = setup();
  pill.start();
  clock.advance(500);
  assert.equal(pill.isVisible(), true);
  pill.finish();
  assert.equal(pill.isVisible(), false);
  assert.equal(pill.isPending(), false);
});

test("teto de segurança: some sozinha em 15 s se a navegação falhar", () => {
  const { clock, pill } = setup();
  pill.start();
  clock.advance(NAVIGATION_PILL_CAP_MS - 1);
  assert.equal(pill.isVisible(), true);
  clock.advance(1);
  assert.equal(pill.isVisible(), false);
  assert.equal(pill.isPending(), false);
});

test("novo toque reinicia o atraso e o teto", () => {
  const { clock, pill } = setup();
  pill.start();
  clock.advance(10000);
  pill.start();
  clock.advance(NAVIGATION_PILL_CAP_MS - 1);
  assert.equal(pill.isVisible(), true);
  clock.advance(1);
  assert.equal(pill.isVisible(), false);
});

test("finish sem navegação pendente não faz nada", () => {
  const { pill, changes } = setup();
  pill.finish();
  assert.equal(changes(), 0);
});

test("isSameLocation: mesma tela não mostra; outra tela ou outro filtro mostra", () => {
  assert.equal(isSameLocation("/admin/simulacoes", "/admin/simulacoes", ""), true);
  assert.equal(isSameLocation("/admin/simulacoes", "/admin/simulacoes", "?status=pending"), true);
  assert.equal(isSameLocation("/admin/simulacoes?status=pending", "/admin/simulacoes", "?status=pending"), true);
  assert.equal(isSameLocation("/admin/simulacoes?status=pending", "/admin/simulacoes", ""), false);
  assert.equal(isSameLocation("/admin/chat", "/admin/simulacoes", ""), false);
  assert.equal(isSameLocation("/admin/chat/marketplace", "/admin/chat", ""), false);
  assert.equal(isSameLocation("/admin/chat/", "/admin/chat", ""), true);
  assert.equal(isSameLocation("https://outro.site/admin/chat", "/admin/chat", ""), false);
});

test("isPlainNavigationClick ignora Ctrl/Cmd/Shift/Alt, botão do meio e clique já tratado", () => {
  assert.equal(isPlainNavigationClick({ button: 0 }), true);
  assert.equal(isPlainNavigationClick({ button: 1 }), false);
  assert.equal(isPlainNavigationClick({ button: 0, ctrlKey: true }), false);
  assert.equal(isPlainNavigationClick({ button: 0, metaKey: true }), false);
  assert.equal(isPlainNavigationClick({ button: 0, defaultPrevented: true }), false);
});
