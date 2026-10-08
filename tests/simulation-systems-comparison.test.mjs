// Price x SAC (dono, 2026-10-08): cada tipo de imóvel pode ter a simulação em Price (o que sempre existiu, ~90% dos casos)
// e/ou em SAC (raro, bloco extra `model.sac`, mesmos 4 campos); a apresentação ganha a cena "comparativo" SÓ quando os
// dois sistemas foram preenchidos. Dados 100% sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  emptySimulationModel,
  enabledModelsFromModels,
  getRenderableSimulationModels,
  mergeSimulationModelsIntoNote,
  extractSimulationModelsFromNote,
  normalizeSimulationModels,
  simulationModelHasValues,
  toggleSimulationModel
} from "../lib/simulation-models.js";
import { PUBLIC_COMPARATIVO_FIELDS, PUBLIC_SCENE_FIELDS, buildPublicPresentation, buildPresentationScenes, systemComparison } from "../lib/simulation-presentation-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
// Os campos de sempre do modelo são o PRICE; o SAC é o bloco extra `sac`.
const price = { financingValue: "180.000,00", subsidyValue: "42.000,00", firstInstallment: "1.010,10", lastInstallment: "1.010,10" };
const sac = { financingValue: "190.000,00", subsidyValue: "42.000,00", firstInstallment: "1.085,40", lastInstallment: "812,15" };
const empty = { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "" };
const sim = (simulationModels, extra = {}) => ({ clientName: "Mariana Souza Lima", simulationDate: "2026-10-08", simulationModels, ...extra });
const ids = (scenes) => scenes.map((scene) => scene.id);

test("modelo: SAC fica em model.sac; simulação antiga (só campos do tipo) continua sendo Price", () => {
  const models = normalizeSimulationModels({ novo: { ...price, sac } });
  assert.equal(models.novo.financingValue, "180.000,00");
  assert.equal(models.novo.sac.financingValue, "190.000,00");
  assert.deepEqual(models.usado.sac, empty);
  const legacy = normalizeSimulationModels(null, { simulationType: "novo", ...price });
  assert.equal(legacy.novo.financingValue, "180.000,00");
  assert.equal(legacy.novo.sac.financingValue, "");
  assert.deepEqual(emptySimulationModel().sac, empty);
});

test("tipo 'tem valor' com Price OU SAC; SAC grava e volta pela observação interna", () => {
  assert.equal(simulationModelHasValues({ ...emptySimulationModel(), sac }), true);
  assert.equal(simulationModelHasValues(emptySimulationModel()), false);
  assert.deepEqual(enabledModelsFromModels({ novo: { ...emptySimulationModel(), sac } }), { novo: true, usado: false });
  const note = mergeSimulationModelsIntoNote("obs", { novo: { ...price, sac } });
  const back = extractSimulationModelsFromNote(note);
  assert.equal(back.novo.sac.firstInstallment, "1.085,40");
  assert.equal(back.novo.firstInstallment, "1.010,10");
  assert.equal(mergeSimulationModelsIntoNote("obs", { novo: { ...emptySimulationModel(), sac } }).includes("__SIMULATION_MODELS__"), true);
});

test("desligar o tipo apaga Price e SAC dele", () => {
  const result = toggleSimulationModel({ novo: { ...price, sac }, usado: { ...price, sac } }, { novo: true, usado: true }, "usado", false);
  assert.equal(simulationModelHasValues(result.models.usado), false);
  assert.equal(simulationModelHasValues(result.models.novo), true);
});

test("entradas por tipo × sistema (Price primeiro); sem SAC nada muda (sem rótulo de sistema)", () => {
  const withSac = getRenderableSimulationModels(sim({ novo: { ...price, sac }, usado: price }));
  assert.deepEqual(withSac.map((item) => `${item.type}:${item.system}:${item.systemLabel}`), ["novo:price:Price", "novo:sac:SAC", "usado:price:Price"]);
  assert.equal(withSac[1].values.financingValue, "190.000,00");
  assert.equal(withSac[1].totals.total, 232000);
  const noSac = getRenderableSimulationModels(sim({ novo: price, usado: price }));
  assert.deepEqual(noSac.map((item) => `${item.type}:${item.system}:${item.systemLabel}`), ["novo:price:", "usado:price:"]);
});

test("apresentação: comparativo SAC x Price SÓ com os dois sistemas; entra depois das parcelas; cenas normais = Price", () => {
  const both = buildPresentationScenes({ simulation: sim({ novo: { ...price, sac } }) });
  assert.deepEqual(ids(both), ["abertura", "poder", "formacao", "parcelas", "comparativo", "proximo", "validar", "documentos"]);
  const scene = both.find((item) => item.id === "comparativo");
  assert.deepEqual(scene.sac, { financing: 190000, subsidy: 42000, total: 232000, first: 1085.4, last: 812.15 });
  assert.deepEqual(scene.price, { financing: 180000, subsidy: 42000, total: 222000, first: 1010.1, last: 1010.1 });
  // as cenas de poder/formação/parcelas continuam sendo as do Price (modelo principal, o que sempre existiu)
  assert.equal(both.find((item) => item.id === "poder").value, 222000);
  assert.equal(both.find((item) => item.id === "parcelas").first, 1010.1);
});

test("apresentação: só Price, ou só SAC → sem comparativo (só a apresentação); só SAC usa os números do SAC", () => {
  assert.ok(!ids(buildPresentationScenes({ simulation: sim({ novo: price }) })).includes("comparativo"));
  const onlySac = buildPresentationScenes({ simulation: sim({ novo: { ...emptySimulationModel(), sac } }) });
  assert.ok(!ids(onlySac).includes("comparativo"));
  assert.equal(onlySac.find((item) => item.id === "poder").value, 232000);
  assert.equal(onlySac.find((item) => item.id === "parcelas").last, 812.15);
});

test("apresentação: Price num tipo e SAC em OUTRO tipo não é comparativo; vale o primeiro tipo com os dois", () => {
  assert.ok(!ids(buildPresentationScenes({ simulation: sim({ novo: price, usado: { ...emptySimulationModel(), sac } }) })).includes("comparativo"));
  const second = buildPresentationScenes({ simulation: sim({ novo: price, usado: { ...price, sac } }) });
  assert.ok(ids(second).includes("comparativo"));
  assert.equal(systemComparison(getRenderableSimulationModels(sim({ novo: price, usado: { ...price, sac } }))).sac.first, 1085.4);
});

test("a cena de diferença de subsídio novo x usado continua usando o Price e continua neutra", () => {
  const usado = { ...price, subsidyValue: "30.000,00", sac };
  const scenes = buildPresentationScenes({ simulation: sim({ novo: { ...price, sac }, usado }) });
  const difference = scenes.find((item) => item.id === "diferenca");
  assert.equal(difference.novo, 42000);
  assert.equal(difference.usado, 30000);
  assert.ok(ids(scenes).indexOf("comparativo") < ids(scenes).indexOf("diferenca"));
});

test("DTO público: a cena comparativo só leva os campos permitidos e os números dos dois sistemas", () => {
  const dto = buildPublicPresentation({ simulation: sim({ novo: { ...price, sac } }) });
  const scene = dto.scenes.find((item) => item.id === "comparativo");
  assert.deepEqual(Object.keys(scene).sort(), [...PUBLIC_SCENE_FIELDS.comparativo].sort());
  for (const system of [scene.sac, scene.price]) assert.deepEqual(Object.keys(system).sort(), [...PUBLIC_COMPARATIVO_FIELDS].sort());
  const text = JSON.stringify(dto).toLowerCase();
  assert.ok(!text.includes("novo") && !text.includes("usado"), "a apresentação não diz novo/usado");
});

test("lista de clientes: simulação só com SAC já conta como realizada (soma Price e SAC de cada tipo)", () => {
  const utils = read("lib/simulation-list-utils.js");
  assert.ok(utils.includes("flatMap(({ key }) => [models[key] || {}, models[key]?.sac || {}])"));
});

test("gerador e player: blocos Price/SAC, PDF/imagem só Price e a cena comparativo", () => {
  const generator = read("components/SimulationGenerator.jsx");
  assert.ok(generator.includes('data-system="price"') && generator.includes('data-system="sac"'));
  assert.ok(generator.includes("updateSacModel(key, \"firstInstallment\""));
  assert.ok(!generator.includes("SISTEMA ${escapeXml"), "PDF/imagem não levam rótulo de sistema");
  assert.ok(generator.includes('model.system !== "sac"'), "PDF/imagem só com o Price");
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.ok(player.includes('case "comparativo": return <SceneComparativo scene={scene} />;'));
  assert.ok(player.includes("Comparativo entre SAC e Price"));
});
