// "Página oculta" para pausar animação/consulta (app lento, 2026-10-23): aba oculta OU janela do app de desktop minimizada.
import test from "node:test";
import assert from "node:assert/strict";

test("isPageHidden: document.hidden ou o aviso do app de desktop (onWindowVisibility)", async () => {
  let desktopCallback = null;
  const doc = new EventTarget();
  doc.hidden = false;
  const win = new EventTarget();
  win.mmDesktop = { isDesktopApp: true, onWindowVisibility: (callback) => (desktopCallback = callback) };
  globalThis.document = doc;
  globalThis.window = win;
  const { isPageHidden, onPageVisibilityChange } = await import("../components/page-visibility.js");

  let changes = 0;
  const stop = onPageVisibilityChange(() => (changes += 1));
  assert.equal(isPageHidden(), false);
  assert.equal(typeof desktopCallback, "function", "assina a ponte uma vez");

  desktopCallback({ hidden: true }); // minimizou
  assert.equal(isPageHidden(), true);
  assert.equal(changes, 1);
  desktopCallback({ hidden: true }); // repetido não avisa de novo
  assert.equal(changes, 1);
  desktopCallback({ hidden: false }); // voltou
  assert.equal(isPageHidden(), false);
  assert.equal(changes, 2);

  doc.hidden = true; // navegador: aba oculta
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(isPageHidden(), true);
  assert.equal(changes, 3);

  stop();
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(changes, 3, "depois de cancelar não avisa");
  delete globalThis.document;
  delete globalThis.window;
});
