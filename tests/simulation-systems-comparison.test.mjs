// Price x SAC (dono, 2026-10-08): cada tipo de imóvel pode ter a simulação em Price (o que sempre existiu, ~90% dos casos)
// e/ou em SAC (raro, bloco extra `model.sac`, mesmos 4 campos); a apresentação ganha a cena "comparativo" SÓ quando os
// dois sistemas foram preenchidos (poder de compra, formação e parcelas mostram SAC e Price). Dados 100% sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  emptySimulationModel,
  cleanTermMonths,
  enabledModelsFromModels,
  getRenderableSimulationModels,
  mergeSimulationModelsIntoNote,
  extractSimulationModelsFromNote,
  normalizeSimulationModels,
  simulationModelHasValues,
  toggleSimulationModel
} from "../lib/simulation-models.js";
import { PUBLIC_SCENE_FIELDS, buildPublicPresentation, buildPresentationScenes, systemComparison } from "../lib/simulation-presentation-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
// Os campos de sempre do modelo são o PRICE; o SAC é o bloco extra `sac`.
const price = { financingValue: "180.000,00", subsidyValue: "42.000,00", firstInstallment: "1.010,10", lastInstallment: "1.010,10" };
const sac = { financingValue: "190.000,00", subsidyValue: "42.000,00", firstInstallment: "1.085,40", lastInstallment: "812,15" };
const empty = { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "", termMonths: "" };
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

test("apresentação: com os dois sistemas as cenas de poder e parcelas mostram SAC e Price; cenas normais = Price", () => {
  const both = buildPresentationScenes({ simulation: sim({ novo: { ...price, sac } }) });
  assert.deepEqual(ids(both), ["abertura", "poder", "formacao", "parcelas", "proximo", "validar", "documentos"], "sem cena \"comparativo\" separada");
  assert.deepEqual(both.find((item) => item.id === "parcelas").comparison, { sac: { first: 1085.4, last: 812.15, term: 0 }, price: { first: 1010.1, last: 1010.1, term: 0 } });
  // o valor principal das cenas continua o do Price (modelo principal, o que sempre existiu)
  assert.equal(both.find((item) => item.id === "poder").value, 222000);
  assert.equal(both.find((item) => item.id === "parcelas").first, 1010.1);
  assert.ok(both.find((item) => item.id === "parcelas").durationMs > 7000);
});

test("apresentação: só Price, ou só SAC → nada de comparação (só a apresentação); só SAC usa os números do SAC", () => {
  const withNone = (scenes) => scenes.every((item) => item.comparison === undefined);
  assert.ok(withNone(buildPresentationScenes({ simulation: sim({ novo: price }) })));
  const onlySac = buildPresentationScenes({ simulation: sim({ novo: { ...emptySimulationModel(), sac } }) });
  assert.ok(withNone(onlySac));
  assert.equal(onlySac.find((item) => item.id === "poder").value, 232000);
  assert.equal(onlySac.find((item) => item.id === "parcelas").last, 812.15);
});

test("apresentação: parcelas iguais nos dois sistemas → cena de parcelas normal", () => {
  const equal = buildPresentationScenes({ simulation: sim({ novo: { ...price, sac: { ...sac, firstInstallment: price.firstInstallment, lastInstallment: price.lastInstallment } } }) });
  assert.equal(equal.find((item) => item.id === "parcelas").comparison, undefined);
  assert.ok(equal.find((item) => item.id === "poder").comparison, "o poder de compra continua diferente");
});

test("apresentação: Price num tipo e SAC em OUTRO tipo não é comparação; vale o primeiro tipo com os dois", () => {
  const cross = buildPresentationScenes({ simulation: sim({ novo: price, usado: { ...emptySimulationModel(), sac } }) });
  assert.ok(cross.every((item) => item.comparison === undefined));
  const second = buildPresentationScenes({ simulation: sim({ novo: price, usado: { ...price, sac } }) });
  assert.ok(second.find((item) => item.id === "parcelas").comparison);
  assert.equal(systemComparison(getRenderableSimulationModels(sim({ novo: price, usado: { ...price, sac } }))).sac.first, 1085.4);
});

test("a cena de diferença de subsídio novo x usado continua usando o Price e continua neutra", () => {
  const usado = { ...price, subsidyValue: "30.000,00", sac };
  const scenes = buildPresentationScenes({ simulation: sim({ novo: { ...price, sac }, usado }) });
  const difference = scenes.find((item) => item.id === "diferenca");
  assert.equal(difference.novo, 42000);
  assert.equal(difference.usado, 30000);
});

test("DTO público: as cenas com dois sistemas só levam os campos permitidos e só números", () => {
  const dto = buildPublicPresentation({ simulation: sim({ novo: { ...price, sac } }) });
  for (const scene of dto.scenes) for (const key of Object.keys(scene)) assert.ok(PUBLIC_SCENE_FIELDS[scene.id].includes(key), `${scene.id}.${key}`);
  const parcelas = dto.scenes.find((item) => item.id === "parcelas");
  for (const system of [parcelas.comparison.sac, parcelas.comparison.price]) assert.deepEqual(Object.keys(system).sort(), ["first", "last", "term"]);
  assert.equal(PUBLIC_SCENE_FIELDS.comparativo, undefined, "a cena comparativo separada não existe mais");
  const text = JSON.stringify(dto).toLowerCase();
  assert.ok(!text.includes("novo") && !text.includes("usado"), "a apresentação não diz novo/usado");
});

test("lista de clientes: simulação só com SAC já conta como realizada (soma Price e SAC de cada tipo)", () => {
  const utils = read("lib/simulation-list-utils.js");
  assert.ok(utils.includes("flatMap(({ key }) => [models[key] || {}, models[key]?.sac || {}])"));
});

test("gerador e player: blocos Price/SAC e PDF/imagem só Price; player com as cenas duplas", () => {
  const generator = read("components/SimulationGenerator.jsx");
  assert.ok(generator.includes('data-system="price"') && generator.includes('data-system="sac"'));
  assert.ok(generator.includes("updateSacModel(key, \"firstInstallment\""));
  assert.ok(!generator.includes("SISTEMA ${escapeXml"), "PDF/imagem não levam rótulo de sistema");
  assert.ok(generator.includes('model.system !== "sac"'), "PDF/imagem só com o Price");
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.ok(player.includes("if (scene.comparison) return <SceneParcelasDuo") && player.includes("SceneParcelasDuo"));
  assert.ok(!player.includes("SceneComparativo"), "a cena comparativo separada saiu");
  assert.ok(player.includes('["sac", "SAC"') && player.includes('["price", "Price"'), "cada cartão leva o nome do sistema");
});

test("poder de compra com dois valores: só quando SAC e Price liberam valores DIFERENTES (em centavos)", () => {
  const diff = buildPresentationScenes({ simulation: sim({ novo: { ...price, sac } }) }).find((item) => item.id === "poder");
  assert.deepEqual(diff.comparison, { sac: 232000, price: 222000 });
  assert.equal(diff.value, 222000, "o valor principal continua o do Price");
  assert.ok(diff.durationMs > 5600, "cena mais longa para os dois valores entrarem um depois do outro");
  const same = buildPresentationScenes({ simulation: sim({ novo: { ...price, sac: { ...sac, financingValue: "180.000,00" } } }) }).find((item) => item.id === "poder");
  assert.equal(same.comparison, undefined, "mesmo poder de compra: cena normal");
  for (const models of [{ novo: price }, { novo: { ...emptySimulationModel(), sac } }]) {
    assert.equal(buildPresentationScenes({ simulation: sim(models) }).find((item) => item.id === "poder").comparison, undefined);
  }
});

test("poder com dois valores: DTO público leva só os dois números; player tem a cena animada", () => {
  const dto = buildPublicPresentation({ simulation: sim({ novo: { ...price, sac } }) });
  const scene = dto.scenes.find((item) => item.id === "poder");
  assert.deepEqual(Object.keys(scene.comparison).sort(), ["price", "sac"]);
  assert.ok(PUBLIC_SCENE_FIELDS.poder.includes("comparison"));
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.ok(player.includes("ScenePoderDuo") && player.includes("if (scene.comparison) return <ScenePoderDuo"));
  assert.ok(player.includes('const PODER_DUO = [["sac", "SAC"') && player.includes('["price", "Price"'));
});

test("formação do valor: só com subsídio; SAC x Price diferentes com subsídio → os dois, um depois do outro", () => {
  const noSubsidy = { ...price, subsidyValue: "" };
  assert.ok(!ids(buildPresentationScenes({ simulation: sim({ novo: noSubsidy }) })).includes("formacao"));
  assert.ok(!ids(buildPresentationScenes({ simulation: sim({ novo: { ...noSubsidy, sac: { ...sac, subsidyValue: "" } } }) })).includes("formacao"), "sem subsídio em nenhum dos dois: sem cena");
  const normal = buildPresentationScenes({ simulation: sim({ novo: price }) }).find((item) => item.id === "formacao");
  assert.equal(normal.mode, "soma");
  assert.equal(normal.comparison, undefined);
  const duo = buildPresentationScenes({ simulation: sim({ novo: { ...price, sac } }) }).find((item) => item.id === "formacao");
  assert.deepEqual(duo.comparison, { sac: { financing: 190000, subsidy: 42000, total: 232000 }, price: { financing: 180000, subsidy: 42000, total: 222000 } });
  assert.ok(duo.durationMs > 7000);
  // subsídio só no SAC: o Price aparece sem a linha de subsídio, mas a cena existe
  const onlySacSubsidy = buildPresentationScenes({ simulation: sim({ novo: { ...noSubsidy, sac } }) }).find((item) => item.id === "formacao");
  assert.equal(onlySacSubsidy.comparison.price.subsidy, 0);
  // partes iguais nos dois sistemas: cena normal (nada para comparar)
  const same = buildPresentationScenes({ simulation: sim({ novo: { ...price, sac: { ...price } } }) }).find((item) => item.id === "formacao");
  assert.equal(same.comparison, undefined);
  const dto = buildPublicPresentation({ simulation: sim({ novo: { ...price, sac } }) });
  assert.ok(PUBLIC_SCENE_FIELDS.formacao.includes("comparison"));
  assert.deepEqual(Object.keys(dto.scenes.find((item) => item.id === "formacao").comparison.sac).sort(), ["financing", "subsidy", "total"]);
  assert.ok(read("components/presentation/PresentationPlayer.jsx").includes("if (scene.comparison) return <SceneFormacaoDuo"));
});

test("prazo em meses: cada sistema tem o seu; só dígitos; aparece nas parcelas (normal e dupla) e não conta como valor", () => {
  assert.equal(cleanTermMonths("4a2 0"), "420");
  assert.equal(cleanTermMonths("0035"), "35");
  assert.equal(cleanTermMonths("12345"), "123");
  const models = normalizeSimulationModels({ novo: { ...price, termMonths: "420", sac: { ...sac, termMonths: "350" } } });
  assert.equal(models.novo.termMonths, "420");
  assert.equal(models.novo.sac.termMonths, "350");
  assert.equal(simulationModelHasValues({ ...emptySimulationModel(), termMonths: "420" }), false, "prazo sozinho não é simulação");
  const back = extractSimulationModelsFromNote(mergeSimulationModelsIntoNote("obs", { novo: { ...price, termMonths: "420", sac: { ...sac, termMonths: "350" } } }));
  assert.equal(back.novo.termMonths, "420");
  assert.equal(back.novo.sac.termMonths, "350");
  const normal = buildPresentationScenes({ simulation: sim({ novo: { ...price, termMonths: "420" } }), }).find((item) => item.id === "parcelas");
  assert.equal(normal.term, 420);
  assert.equal(normal.comparison, undefined);
  const duo = buildPresentationScenes({ simulation: sim({ novo: { ...price, termMonths: "420", sac: { ...sac, termMonths: "350" } } }, { interestRateAnnual: 10 }) }).find((item) => item.id === "parcelas");
  assert.equal(duo.comparison.price.term, 420);
  assert.equal(duo.comparison.sac.term, 350);
  assert.equal(duo.interestRate, 10);
  // mesmas parcelas mas prazos diferentes: ainda é cena dupla (o prazo é diferente)
  const termOnly = buildPresentationScenes({ simulation: sim({ novo: { ...price, termMonths: "420", sac: { ...price, termMonths: "350" } } }) }).find((item) => item.id === "parcelas");
  assert.ok(termOnly.comparison);
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.ok(player.includes("{scene.comparison[key].term} meses") && player.includes("{scene.term} meses"));
  assert.ok(player.includes('<span className={styles.cmpLabel}>Taxa de juros</span>'), "a taxa de juros aparece em cada cartão");
  const generator = read("components/SimulationGenerator.jsx");
  assert.ok(generator.includes('label="Prazo (meses)"') && generator.includes('label="Prazo em meses (SAC)"'));
});

test("compartilhar a apresentação: 'Enviar' abre o Chat do CRM com o link pronto (2026-10-09; substituiu o copiar+wa.me)", () => {
  const generator = read("components/SimulationGenerator.jsx");
  assert.ok(generator.includes("router.push(`/admin/chat?client=${encodeURIComponent(registrationId)}&text=${encodeURIComponent(data.message)}`)"));
  assert.ok(!generator.includes("const onDesktop ="), "a lógica antiga de copiar o link no computador saiu");
});
