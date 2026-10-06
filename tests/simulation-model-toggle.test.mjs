// Caixas "Imóvel novo" / "Imóvel usado" do Gerador (pedido do dono 2026-10-06): tipo desmarcado tem os valores apagados, não
// recebe a cópia automática e some do PDF/imagem/apresentação (sem comparação novo × usado). Nunca os dois desmarcados.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { enabledModelsFromModels, getRenderableSimulationModels, toggleSimulationModel } from "../lib/simulation-models.js";
import { buildPresentationScenes } from "../lib/simulation-presentation-core.mjs";

const novo = { financingValue: "190.000,00", subsidyValue: "42.000,00", firstInstallment: "1.085,40", lastInstallment: "812,15" };
const usado = { financingValue: "190.000,00", subsidyValue: "", firstInstallment: "1.085,40", lastInstallment: "812,15" };

test("estado inicial: ativo = tem valor; simulação vazia = os dois ativos", () => {
  assert.deepEqual(enabledModelsFromModels({ novo, usado }), { novo: true, usado: true });
  assert.deepEqual(enabledModelsFromModels({ novo }), { novo: true, usado: false });
  assert.deepEqual(enabledModelsFromModels({}), { novo: true, usado: true });
});

test("desmarcar apaga o tipo e a simulação passa a ter um modelo só (sem cena de diferença)", () => {
  const result = toggleSimulationModel({ novo, usado: { ...usado, subsidyValue: "30.000,00" } }, { novo: true, usado: true }, "usado", false);
  assert.deepEqual(result.enabled, { novo: true, usado: false });
  assert.equal(result.models.usado.financingValue, "");
  const sim = { clientName: "Ana", simulationModels: result.models };
  assert.deepEqual(getRenderableSimulationModels(sim).map((model) => model.type), ["novo"]);
  assert.ok(!buildPresentationScenes({ simulation: sim }).some((scene) => scene.id === "diferenca"));
});

test("nunca os dois desmarcados; religar copia financiamento e parcelas do outro, subsídio em branco", () => {
  assert.equal(toggleSimulationModel({ novo }, { novo: true, usado: false }, "novo", false), null);
  const back = toggleSimulationModel({ novo }, { novo: true, usado: false }, "usado", true);
  assert.deepEqual(back.enabled, { novo: true, usado: true });
  assert.equal(back.models.usado.financingValue, "190.000,00");
  assert.equal(back.models.usado.firstInstallment, "1.085,40");
  assert.equal(back.models.usado.subsidyValue, "");
  assert.equal(toggleSimulationModel({ novo }, { novo: true }, "outro", true), null);
});

test("Gerador: caixas por tipo, tipo desligado não recebe a cópia automática nem aparece", () => {
  const gen = fs.readFileSync(path.resolve(import.meta.dirname, "../components/SimulationGenerator.jsx"), "utf8");
  assert.match(gen, /data-model-toggle=\{key\}/);
  assert.match(gen, /enabledModelsRef\.current\[MODEL_PEER\[type\]\] === false \? null : MODEL_PEER\[type\]/);
  assert.match(gen, /SIMULATION_MODEL_TYPES\.filter\(\(\{ key \}\) => enabledModels\[key\]\)\.map/);
});
