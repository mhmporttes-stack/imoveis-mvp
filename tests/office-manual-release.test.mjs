// Presença na imobiliária (ROL-2f), 2026-10-16: liberação manual também com a chegada de ontem ainda valendo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const board = readFileSync(new URL("../components/OnlinePresenceBoard.jsx", import.meta.url), "utf8");

test("o texto da chegada diz o DIA e os botões manuais aparecem se a chegada que vale não é de hoje", () => {
  assert.ok(board.includes("function officeDayLabel(iso)"));
  assert.ok(board.includes('const arrivedToday = arrivalDay === "hoje";'));
  assert.ok(board.includes("{!arrivedToday && !office.here ? ("), "botões quando a chegada que vale não é de hoje e não está no Wi-Fi");
  assert.ok(board.includes("Hoje ainda não registrou a chegada."));
  assert.ok(board.includes('release("arrived")') && board.includes('release("external")'));
  assert.equal(board.split("{manualButtons}").length - 1, 2, "os mesmos botões nos dois estados (ativo de outro dia e sem chegada)");
});
