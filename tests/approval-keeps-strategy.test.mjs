// Apresentação de aprovação (PRES-21) mantém a "Estratégia de pagamento" (PRES-24) — pedido do dono, 2026-10-19.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APPROVAL_DTO_FIELDS } from "../lib/simulation-presentation-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("o DTO de aprovação aceita o campo opcional 'estrategia' (allowlist) e o servidor o acrescenta", () => {
  assert.ok(APPROVAL_DTO_FIELDS.includes("estrategia"));
  const code = read("lib/simulation-presentation.js");
  assert.ok(code.includes("if (approval) return withPaymentStrategy(buildApprovalPresentation(sceneInput(simulation, entryResults, propertyPhotos)), simulation);"));
});

test("player: botão ESTRATÉGIA DE PAGAMENTO na cena 'Valores aprovados' e a folha abre nela", () => {
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.ok(player.includes("hasStrategy={Boolean(ctx.strategy)} onOpenStrategy={ctx.openStrategy}"));
  assert.ok(player.includes("function SceneAprovValores({ scene, reduced, hasStrategy = false, onOpenStrategy })"));
  const scene = player.slice(player.indexOf("function SceneAprovValores"), player.indexOf("/** Botão de download de imagem"));
  assert.ok(scene.includes("data-open-strategy") && scene.includes("{STRATEGY_NAME_CAPS}"));
  assert.ok(player.includes('strategyOpen && (current.id === "proximo" || current.id === "aprovValores") && strategy'));
  // a folha de aprovação não oferece contato (PRES-21: sem botão de contato): o canContact segue vindo do DTO (sem podeReceberLista)
  assert.ok(!read("lib/simulation-presentation.js").includes("withReceiveListFlag(buildApprovalPresentation"));
});
