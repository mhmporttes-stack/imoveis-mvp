// Arrastar para reordenar (2026-10-09): núcleo da troca de posição.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("moveItem move um item para a posição nova sem perder nenhum", () => {
  const source = readFileSync(new URL("../components/ui/useDragReorder.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export function moveItem"), source.indexOf("export function useDragReorder"));
  const moveItem = new Function(`${body.replace("export ", "")}; return moveItem;`)();
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveItem(["a", "b"], 1, 1), ["a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], 0, 5), ["a", "b"]);
});

test("telas sem setas de subir/descer: usam arrastar", () => {
  const form = readFileSync(new URL("../components/PropertyForm.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(form, />↑<|>\s*↑\s*</);
  assert.match(form, /useDragReorder/);
  const sim = readFileSync(new URL("../components/SimulationGenerator.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(sim, />↑<|Subir|Descer/);
  assert.match(sim, /useDragReorder/);
});
