// Apresentação de APROVAÇÃO (PRES-21): chave manual no CRM ("Apresentação de aprovação"), o MESMO link troca de roteiro.
// Roteiro: pausa + carimbo CRÉDITO APROVADO · valores do financiamento (parcela e taxa) · imóvel + valores SÓ com imóvel definido.
// Sem "Próximo passo", sem lista de documentos, sem botão de contato. Nada sensível no DTO.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  APPROVAL_DTO_FIELDS,
  APPROVAL_SCENE_FIELDS,
  PUBLIC_BRANCH_FIELDS,
  PUBLIC_VALUES_FIELDS,
  buildApprovalPresentation
} from "../lib/simulation-presentation-core.mjs";
import { shareFirstName } from "../lib/simulation-presentation-share.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const result = {
  empreendimentoId: "emp-1", empreendimentoNome: "INTERNO", valorImovel: 235000, totalDescontos: 33700, descontosAplicados: [],
  subsidioMcmv: 42915, casaPaulista: 0, financiamentoAprovado: 114329.17, entradaTotal: 44055.83,
  detalhePagamento: { ato: 0, blocos: [{ label: "Parcelas da entrada", parcelas: 60, valorParcela: 734.26, valorParcelaComJuros: 980, periodicidadeMeses: 1 }] },
  beneficiosInformativos: [], classificacao: "viavel", clienteSnapshot: { rendaTotal: 7600, financiamentoAprovado: 114329.17 }
};

function simulation(over = {}) {
  return {
    clientName: "Jussara de Oliveira Pereira",
    interestRateAnnual: 4.75,
    simulationModels: { novo: { financingValue: 114329.17, subsidyValue: 42915, firstInstallment: 812.4, lastInstallment: 640.1 } },
    registration: { primaryIncomeType: "self_employed_unregistered", monthlyIncome: 7600, cpf: "000.000.000-00" },
    properties: [{ propertyId: "emp-1", customName: "Residencial Morumbi", imageUrl: "https://cdn.exemplo.com/m.jpg", benefits: [{ text: "2 quartos" }], recommendationReason: "Cabe no orçamento." }],
    ...over
  };
}
const build = (sim, entryResults = { "emp-1": { result, features: [] } }) => buildApprovalPresentation({ simulation: sim, defaultReason: "Padrão.", entryResults });

test("aprovação COM imóvel definido: carimbo → valores do financiamento → imóvel → valores do imóvel; sem próximo passo nem documentos", () => {
  const dto = build(simulation());
  assert.equal(dto.mode, "aprovacao");
  assert.deepEqual(dto.scenes.map((scene) => scene.id), ["aprovado", "aprovValores", "imovel", "valores"]);
  assert.equal(dto.scenes[0].firstName, "Jussara");
  const values = dto.scenes[1];
  assert.equal(values.financing, 114329.17);
  assert.equal(values.subsidy, 42915);
  assert.equal(values.first, 812.4);
  assert.equal(values.last, 640.1);
  assert.ok(values.interestRate, "taxa de juros vai para a cena");
  assert.equal(dto.scenes[3].parcelas[0].quantidade, 60);
  assert.ok(!dto.scenes.some((scene) => ["proximo", "validar", "documentos", "abertura"].includes(scene.id)));
  assert.deepEqual(dto.branch, []);
  assert.ok(dto.scenes.every((scene) => scene.durationMs > 0));
});

test("aprovação SEM imóvel: só a pausa/carimbo e os valores do financiamento", () => {
  assert.deepEqual(build(simulation({ properties: [] })).scenes.map((scene) => scene.id), ["aprovado", "aprovValores"]);
  // imóvel sem resultado do motor: aparece a cena do imóvel, sem cena de valores inventada
  assert.deepEqual(build(simulation(), {}).scenes.map((scene) => scene.id), ["aprovado", "aprovValores", "imovel"]);
  // simulação sem valores: nada a apresentar
  assert.equal(build(simulation({ simulationModels: {} })), null);
});

test("DTO de aprovação: allowlist estrita (sem renda, CPF, ids internos, nome do empreendimento do motor)", () => {
  const dto = build(simulation());
  assert.deepEqual(Object.keys(dto).sort(), [...APPROVAL_DTO_FIELDS].sort());
  for (const scene of dto.scenes) {
    const allowed = APPROVAL_SCENE_FIELDS[scene.id]
      || (scene.id === "imovel" ? [...PUBLIC_BRANCH_FIELDS, "durationMs"] : null)
      || (scene.id === "valores" ? [...PUBLIC_VALUES_FIELDS, "id", "name", "position", "count", "durationMs"] : null);
    assert.ok(allowed, `cena inesperada ${scene.id}`);
    for (const key of Object.keys(scene)) assert.ok(allowed.includes(key), `${scene.id} expôs ${key}`);
  }
  const text = JSON.stringify(dto);
  for (const secret of ["000.000.000-00", "7600", "INTERNO", "Oliveira", "emp-1", "clienteSnapshot"]) assert.ok(!text.includes(secret), `vazou ${secret}`);
  assert.equal(shareFirstName(dto), "Jussara", "prévia do WhatsApp continua só com o primeiro nome");
});

test("servidor: chave lida à parte (link funciona sem a coluna), imagens sempre da simulação, nunca muda a etapa do cliente", () => {
  const lib = read("lib/simulation-presentation.js");
  assert.match(lib, /function isApprovalColumnMissing/);
  assert.match(lib, /const approval = simulationOnly \? false : await readPublicApproval\(token\);/);
  assert.match(lib, /if \(approval\) return buildApprovalPresentation\(/);
  const setter = /export async function setPresentationApproval[\s\S]*?\n}\n/.exec(lib)?.[0] || "";
  assert.ok(setter.includes("approval_enabled_at"));
  assert.ok(!/CLIENT_STATUS|simulation_registrations|updateSimulationRegistration|registration/.test(setter), "a chave não toca na etapa do funil");
  for (const file of ["app/apresentacao/[token]/documentos/route.js", "app/apresentacao/[token]/imagem/route.js"]) {
    assert.match(read(file), /getPublicPresentation\(token, \{ simulationOnly: true \}\)/, file);
  }
  const route = read("app/api/admin/simulacoes/[id]/apresentacao/route.js");
  assert.match(route, /requireAdminApi/);
  assert.match(route, /action === "aprovacao"/);
  assert.match(route, /presentation_approval_on/);
  const migration = read("supabase/migrations/20261006180000_simulation_presentation_approval.sql");
  assert.match(migration, /add column if not exists approval_enabled_at timestamptz/);
  assert.ok(!/\b(drop|delete|update|truncate)\b/i.test(migration.replace(/--.*$/gm, "")), "migration só aditiva");
});

test("painel e player: chave com confirmação ao ligar; cenas de aprovação sem botão de contato; última cena sem botão", () => {
  const panel = read("components/presentation/SimulationPresentationPanel.jsx");
  assert.match(panel, /<Switch checked=\{Boolean\(state\.approvalEnabled\)\} onChange=\{setApproval\}/);
  assert.match(panel, /Ligar a apresentação de aprovação\?/);
  assert.match(panel, /\?modo=aprovacao/);
  const player = read("components/presentation/PresentationPlayer.jsx");
  const body = (name) => (new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`).exec(player)?.[0] || "").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
  const scenes = body("SceneAprovado") + body("SceneAprovValores");
  assert.ok(scenes.includes("Crédito") && scenes.includes("Aprovado"));
  assert.ok(!/wa\.me|whatsapp|corretor|<button/i.test(scenes), "sem contato nem botão nas cenas de aprovação");
  assert.match(player, /final=\{ctx\.mainLast\}/);
});
