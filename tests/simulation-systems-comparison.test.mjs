// SAC x Price (dono, 2026-10-08): cada tipo de imóvel pode ter a simulação em SAC e/ou Price (mesmos 4 campos);
// a apresentação ganha a cena "comparativo" SÓ quando os dois sistemas foram preenchidos. Dados 100% sintéticos.
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
const sac = { financingValue: "190.000,00", subsidyValue: "42.000,00", firstInstallment: "1.085,40", lastInstallment: "812,15" };
const price = { financingValue: "180.000,00", subsidyValue: "42.000,00", firstInstallment: "1.010,10", lastInstallment: "1.010,10" };
const sim = (simulationModels, extra = {}) => ({ clientName: "Mariana Souza Lima", simulationDate: "2026-10-08", simulationModels, ...extra });
const ids = (scenes) => scenes.map((scene) => scene.id);

test("modelo: Price fica em model.price; simulação antiga (só campos do tipo) continua SAC", () => {
  const models = normalizeSimulationModels({ novo: { ...sac, price } });
  assert.equal(models.novo.financingValue, "190.000,00");
  assert.equal(models.novo.price.financingValue, "180.000,00");
  assert.deepEqual(models.usado.price, { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "" });
  const legacy = normalizeSimulationModels(null, { simulationType: "novo", ...sac });
  assert.equal(legacy.novo.financingValue, "190.000,00");
  assert.equal(legacy.novo.price.financingValue, "");
  assert.deepEqual(emptySimulationModel().price, { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "" });
});

test("tipo 'tem valor' com SAC OU Price; Price grava e volta pela observação interna", () => {
  assert.equal(simulationModelHasValues({ ...emptySimulationModel(), price }), true);
  assert.equal(simulationModelHasValues(emptySimulationModel()), false);
  assert.deepEqual(enabledModelsFromModels({ novo: { ...emptySimulationModel(), price } }), { novo: true, usado: false });
  const note = mergeSimulationModelsIntoNote("obs", { novo: { ...sac, price } });
  const back = extractSimulationModelsFromNote(note);
  assert.equal(back.novo.price.firstInstallment, "1.010,10");
  assert.equal(back.novo.firstInstallment, "1.085,40");
  assert.equal(mergeSimulationModelsIntoNote("obs", { novo: { ...emptySimulationModel(), price } }).includes("__SIMULATION_MODELS__"), true);
});

test("desligar o tipo apaga SAC e Price dele", () => {
  const result = toggleSimulationModel({ novo: { ...sac, price }, usado: { ...sac, price } }, { novo: true, usado: true }, "usado", false);
  assert.equal(simulationModelHasValues(result.models.usado), false);
  assert.equal(simulationModelHasValues(result.models.novo), true);
});

test("entradas por tipo × sistema; sem Price nada muda (sem rótulo de sistema)", () => {
  const withPrice = getRenderableSimulationModels(sim({ novo: { ...sac, price }, usado: sac }));
  assert.deepEqual(withPrice.map((item) => `${item.type}:${item.system}:${item.systemLabel}`), ["novo:sac:SAC", "novo:price:Price", "usado:sac:SAC"]);
  assert.equal(withPrice[1].values.financingValue, "180.000,00");
  assert.equal(withPrice[1].totals.total, 222000);
  const noPrice = getRenderableSimulationModels(sim({ novo: sac, usado: sac }));
  assert.deepEqual(noPrice.map((item) => `${item.type}:${item.system}:${item.systemLabel}`), ["novo:sac:", "usado:sac:"]);
});

test("apresentação: comparativo SAC x Price SÓ com os dois sistemas; entra depois das parcelas", () => {
  const both = buildPresentationScenes({ simulation: sim({ novo: { ...sac, price } }) });
  assert.deepEqual(ids(both), ["abertura", "poder", "formacao", "parcelas", "comparativo", "proximo", "validar", "documentos"]);
  const scene = both.find((item) => item.id === "comparativo");
  assert.deepEqual(scene.sac, { financing: 190000, subsidy: 42000, total: 232000, first: 1085.4, last: 812.15 });
  assert.deepEqual(scene.price, { financing: 180000, subsidy: 42000, total: 222000, first: 1010.1, last: 1010.1 });
  // as cenas de poder/formação/parcelas continuam sendo as do SAC (modelo principal)
  assert.equal(both.find((item) => item.id === "poder").value, 232000);
  assert.equal(both.find((item) => item.id === "parcelas").first, 1085.4);
});

test("apresentação: só SAC, ou só Price → sem comparativo (só a apresentação); só Price usa os números do Price", () => {
  assert.ok(!ids(buildPresentationScenes({ simulation: sim({ novo: sac }) })).includes("comparativo"));
  const onlyPrice = buildPresentationScenes({ simulation: sim({ novo: { ...emptySimulationModel(), price } }) });
  assert.ok(!ids(onlyPrice).includes("comparativo"));
  assert.equal(onlyPrice.find((item) => item.id === "poder").value, 222000);
  assert.equal(onlyPrice.find((item) => item.id === "parcelas").last, 1010.1);
});

test("apresentação: SAC num tipo e Price em OUTRO tipo não é comparativo; vale o primeiro tipo com os dois", () => {
  assert.ok(!ids(buildPresentationScenes({ simulation: sim({ novo: sac, usado: { ...emptySimulationModel(), price } }) })).includes("comparativo"));
  const second = buildPresentationScenes({ simulation: sim({ novo: sac, usado: { ...sac, price } }) });
  assert.ok(ids(second).includes("comparativo"));
  assert.equal(systemComparison(getRenderableSimulationModels(sim({ novo: sac, usado: { ...sac, price } }))).price.first, 1010.1);
});

test("a cena de diferença de subsídio novo x usado continua usando o SAC e continua neutra", () => {
  const usado = { ...sac, subsidyValue: "30.000,00", price };
  const scenes = buildPresentationScenes({ simulation: sim({ novo: { ...sac, price }, usado }) });
  const difference = scenes.find((item) => item.id === "diferenca");
  assert.equal(difference.novo, 42000);
  assert.equal(difference.usado, 30000);
  assert.ok(ids(scenes).indexOf("comparativo") < ids(scenes).indexOf("diferenca"));
});

test("DTO público: a cena comparativo só leva os campos permitidos e os números dos dois sistemas", () => {
  const dto = buildPublicPresentation({ simulation: sim({ novo: { ...sac, price } }) });
  const scene = dto.scenes.find((item) => item.id === "comparativo");
  assert.deepEqual(Object.keys(scene).sort(), [...PUBLIC_SCENE_FIELDS.comparativo].sort());
  for (const system of [scene.sac, scene.price]) assert.deepEqual(Object.keys(system).sort(), [...PUBLIC_COMPARATIVO_FIELDS].sort());
  const text = JSON.stringify(dto).toLowerCase();
  assert.ok(!text.includes("novo") && !text.includes("usado"), "a apresentação não diz novo/usado");
});

test("lista de clientes: simulação só com Price já conta como realizada (soma SAC e Price de cada tipo)", () => {
  const utils = read("lib/simulation-list-utils.js");
  assert.ok(utils.includes("flatMap(({ key }) => [models[key] || {}, models[key]?.price || {}])"));
});

test("gerador e player: blocos SAC/Price, PDF/imagem só SAC e a cena comparativo", () => {
  const generator = read("components/SimulationGenerator.jsx");
  assert.ok(generator.includes('data-system="sac"') && generator.includes('data-system="price"'));
  assert.ok(generator.includes("updatePriceModel(key, \"firstInstallment\""));
  assert.ok(!generator.includes("SISTEMA ${escapeXml"), "PDF/imagem não levam rótulo de sistema (sem Price no PDF)");
  assert.ok(generator.includes('model.system !== "price"'), "PDF/imagem só com o SAC");
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.ok(player.includes('case "comparativo": return <SceneComparativo scene={scene} />;'));
  assert.ok(player.includes("Comparativo entre SAC e Price"));
});
