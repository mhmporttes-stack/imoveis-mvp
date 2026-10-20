// "Próximo passo" da apresentação (PRES-12, revisto pelo dono em 2026-10-19 — Mesa "Atendimento depois da simulação", lote A):
// um único botão cheio, nota "Mais {n} telas…" com n calculado pelo roteiro, demais caminhos com contorno e o download como link.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PUBLIC_SCENE_FIELDS, buildPublicPresentation, screensToDocumentsList } from "../lib/simulation-presentation-core.mjs";
import { nextStepListNote, nextStepTitle } from "../components/presentation/player-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const stripComments = (code) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SIMULATION = {
  clientName: "Maria da Silva", simulationDate: "2026-10-01",
  simulationModels: { novo: { financingValue: 200000, subsidyValue: 20000, firstInstallment: 1000, lastInstallment: 900 } },
  registration: {}, properties: []
};

test("n é calculado pelo roteiro: telas do 'Próximo passo' até a cena de documentos (inclusive)", () => {
  const dto = buildPublicPresentation({ simulation: SIMULATION, defaultReason: "x" });
  const proximo = dto.scenes.find((scene) => scene.id === "proximo");
  const expected = dto.scenes.findIndex((scene) => scene.id === "documentos") - dto.scenes.findIndex((scene) => scene.id === "proximo");
  assert.equal(proximo.telasAteLista, expected);
  assert.equal(proximo.telasAteLista, 2); // roteiro de hoje: validar + documentos
  assert.ok(PUBLIC_SCENE_FIELDS.proximo.includes("telasAteLista"));
  assert.equal(screensToDocumentsList([{ id: "proximo" }, { id: "documentos" }]), 1);
  assert.equal(screensToDocumentsList([{ id: "proximo" }]), 0);
  assert.equal(screensToDocumentsList([]), 0);
});

test("nota e título: singular com 1 tela, sem número não há nota; sem nome, sem o prefixo", () => {
  assert.equal(nextStepListNote(2), "Mais 2 telas para pedir a sua lista de documentos.");
  assert.equal(nextStepListNote(1), "Mais 1 tela para pedir a sua lista de documentos.");
  assert.equal(nextStepListNote(0), null);
  assert.equal(nextStepListNote(undefined), null);
  assert.equal(nextStepTitle("Maria"), "Maria, falta pouco para saber o que é possível no seu caso.");
  assert.equal(nextStepTitle(""), "Falta pouco para saber o que é possível no seu caso.");
});

test("cena: um único botão cheio, depois a nota, contornos na ordem Agendar · Estratégia · Imóveis e Baixar como link", () => {
  const player = stripComments(read("components/presentation/PresentationPlayer.jsx"));
  const scene = /function SceneProximo[\s\S]*?\n}\n/.exec(player)?.[0] || "";
  assert.ok(scene, "SceneProximo");
  assert.equal((scene.match(/styles\.cta\}/g) || []).length, 1, "um único botão cheio");
  const order = ["VER O QUE PRECISO PARA AVANÇAR", "{listNote ?", "AGENDAR ATENDIMENTO", "STRATEGY_NAME_CAPS", "propertiesLabel}"].map((mark) => scene.indexOf(mark));
  for (const position of order) assert.ok(position > 0);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(scene, /label="Baixar apresentação" className=\{styles\.textBtn\}/);
  // nota só quando a lista pode ser pedida; condições de exibição mantidas
  assert.match(scene, /canReceiveList \? nextStepListNote\(scene\.telasAteLista\) : null/);
  assert.match(scene, /\{canSchedule \? \(/);
  assert.match(scene, /\{hasStrategy \? \(/);
  assert.match(scene, /\{propertiesLabel \? \(/);
  assert.match(scene, /onClick=\{onValidate\}/);
});
