// Apresentação interativa — cena de VALORES do imóvel sugerido (PRES-20): só com dado real, ato 0 destacado, ato ausente
// omitido, ordem no ramo, DTO sem vazamento. Fonte dos valores: o MESMO resultado do motor que o card do cliente → Empreendimento mostra (calculado na hora pelo servidor).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PUBLIC_BRANCH_FIELDS,
  PUBLIC_VALUES_FIELDS,
  PUBLIC_VALUES_INSTALLMENT_FIELDS,
  buildPresentationScenes,
  buildPropertyBranch,
  buildPropertyValues,
  buildPublicPresentation as buildPublic
} from "../lib/simulation-presentation-core.mjs";
import { flattenBranch } from "../components/presentation/player-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const DEFAULT_REASON = "Texto-padrão do dono.";
const money = { financingValue: 190000, subsidyValue: 42000, firstInstallment: 1085.4, lastInstallment: 812.15 };

function snapshot(propertyId, over = {}) {
  return {
    empreendimentoId: propertyId,
    empreendimentoNome: "NOME-INTERNO-DO-EMPREENDIMENTO",
    valorImovel: 250000,
    totalDescontos: 8000,
    descontosAplicados: [{ label: "DESCONTO-INTERNO", valor: 8000 }],
    subsidioMcmv: 42000,
    casaPaulista: 0,
    financiamentoAprovado: 190000,
    entradaTotal: 24000,
    detalhePagamento: { ato: 0, blocos: [{ label: "Parcelas da entrada", parcelas: 24, valorParcela: 1000, periodicidadeMeses: 1 }] },
    beneficiosInformativos: [{ label: "BENEFICIO-INTERNO", valor: 1 }],
    avisos: ["AVISO-INTERNO"],
    classificacao: "viavel",
    motivos: [],
    clienteSnapshot: { rendaTotal: 8123.45, financiamentoAprovado: 190000, subsidioMcmv: 42000, fgtsDisponivel: 0 },
    ...over
  };
}

// Entrada do ramo = o que o servidor entrega (lib/simulation-presentation-entry.js): resultado do motor + diferenciais do cadastro.
const entry = (propertyId, over = {}, features = []) => ({ result: snapshot(propertyId, over), features });

function simulation(over = {}) {
  return {
    clientName: "Mariana Souza Lima",
    simulationDate: "2026-10-03",
    simulationModels: { novo: { ...money }, usado: { ...money } },
    downPaymentValue: 0,
    fgtsValue: 0,
    properties: [
      { propertyId: "emp-1", customName: "Residencial Aurora", imageUrl: "https://cdn.exemplo.com/1.jpg", benefits: [{ text: "Varanda" }], recommendationReason: "Cabe no orçamento." },
      { propertyId: "emp-2", customName: "Condomínio Segundo", imageUrl: "https://cdn.exemplo.com/2.jpg", benefits: [], recommendationReason: "" }
    ],
    entryResults: {
      "emp-1": entry("emp-1"),
      "emp-2": entry("emp-2", { valorImovel: 289900, totalDescontos: 0, casaPaulista: 10000, entradaTotal: 31500, detalhePagamento: { ato: 6500, blocos: [{ label: "Obra", parcelas: 18, valorParcela: 900 }, { label: "Pós-obra", parcelas: 12, valorParcela: 775, valorParcelaComJuros: 812.5 }] } })
    },
    ...over
  };
}

const branchOf = (sim) => buildPropertyBranch({ simulation: sim, defaultReason: DEFAULT_REASON, entryResults: sim.entryResults });
const buildPublicPresentation = ({ simulation: sim, defaultReason }) => buildPublic({ simulation: sim, defaultReason, entryResults: sim.entryResults });
const valuesOf = (sim, index = 0) => branchOf(sim)[index];
const withSnapshot = (over, features = []) => simulation({ entryResults: { "emp-1": entry("emp-1", over, features), "emp-2": entry("emp-2") } });

// ---------- a cena só existe com dado real ----------
test("valores: com resultado de entrada do imóvel, o item do ramo ganha `valores` (campos finais, na ordem do cadastro)", () => {
  const branch = branchOf(simulation());
  assert.equal(branch.length, 2);
  assert.deepEqual(branch[0].valores, {
    valorImovel: 250000,
    financiamento: 190000,
    desconto: 8000,
    subsidio: 42000,
    totalDescontos: 50000,
    entradaTotal: 24000,
    ato: 0,
    parcelas: [{ label: "Parcelas da entrada", quantidade: 24, valor: 1000 }]
  });
  // segundo imóvel: Casa Paulista, ato > 0 e dois blocos (com juros quando o bloco tem)
  assert.deepEqual(branch[1].valores, {
    valorImovel: 289900,
    financiamento: 190000,
    casaPaulista: 10000,
    subsidio: 42000,
    totalDescontos: 52000,
    entradaTotal: 31500,
    ato: 6500,
    parcelas: [{ label: "Obra", quantidade: 18, valor: 900 }, { label: "Pós-obra", quantidade: 12, valor: 812.5 }]
  });
});

test("valores: sem dado não há cena (nenhuma cena vazia): sem resultado, sem propertyId, resultado de outro imóvel", () => {
  assert.ok(!("valores" in valuesOf(simulation({ entryResults: {} }))));
  assert.ok(!("valores" in valuesOf(simulation({ entryResults: undefined }))));
  assert.ok(!("valores" in valuesOf(simulation({ entryResults: { "emp-1": { features: [] } } }))), "entrada sem resultado do motor");
  const noId = simulation();
  noId.properties[0].propertyId = "";
  assert.ok(!("valores" in valuesOf(noId)));
  assert.ok(!("valores" in valuesOf(simulation({ entryResults: { "emp-2": entry("emp-2") } }), 0)), "o resultado do imóvel 2 não vale para o 1");
  assert.ok("valores" in valuesOf(simulation({ entryResults: { "emp-2": entry("emp-2") } }), 1));
  // sem valor do imóvel não há o que mostrar
  assert.ok(!("valores" in valuesOf(withSnapshot({ valorImovel: 0 }))));
  assert.ok(!("valores" in valuesOf(withSnapshot({ valorImovel: "250000" }))), "texto não vira número");
  // resultado de entrada INVIÁVEL não vira oferta ao cliente
  assert.ok(!("valores" in valuesOf(withSnapshot({ classificacao: "inviavel" }))));
  assert.ok("valores" in valuesOf(withSnapshot({ classificacao: "ajuste" })));
});

test("valores: campo ausente ou zero não aplicável é omitido (sem desconto, sem Casa Paulista, sem parcelas, sem entrada)", () => {
  const plain = valuesOf(withSnapshot({ totalDescontos: 0, casaPaulista: 0, descontosAplicados: [] })).valores;
  assert.ok(!("desconto" in plain) && !("casaPaulista" in plain));
  const noBlocks = valuesOf(withSnapshot({ detalhePagamento: { ato: 24000, blocos: [] } })).valores;
  assert.ok(!("parcelas" in noBlocks));
  assert.equal(noBlocks.ato, 24000);
  // blocos inválidos (0 parcelas, valor 0, tipos errados) caem; no máximo 3
  const messy = valuesOf(withSnapshot({
    detalhePagamento: {
      ato: 100,
      blocos: [{ label: "A", parcelas: 0, valorParcela: 10 }, { label: "B", parcelas: 3, valorParcela: 0 }, { label: "C", parcelas: "3", valorParcela: 10 }, ...[1, 2, 3, 4].map((n) => ({ label: `Ok ${n}`, parcelas: n, valorParcela: 100 * n }))]
    }
  })).valores;
  assert.deepEqual(messy.parcelas.map((block) => block.label), ["Ok 1", "Ok 2", "Ok 3"]);
  // entrada zero: sem entrada, sem ato e sem parcelas (nada de "sem ato" para quem não paga entrada)
  const free = valuesOf(withSnapshot({ entradaTotal: 0, detalhePagamento: { ato: 0, blocos: [] } })).valores;
  assert.deepEqual(Object.keys(free).sort(), ["desconto", "financiamento", "subsidio", "totalDescontos", "valorImovel"]);
});

// ---------- documentação gratuita e total de descontos (2026-10-05) ----------
const DOC = { tipo: "documentacao_gratuita", label: "Documentação gratuita", valor: 1 };

test("total de descontos: soma exatamente as linhas mostradas (desconto + Casa Paulista + subsídio + documentação gratuita)", () => {
  // tudo junto: documentação = 5% do valor do imóvel (mesma conta do modelo da Proposta de Valores)
  const all = valuesOf(withSnapshot({ casaPaulista: 10000, beneficiosInformativos: [DOC] })).valores;
  assert.equal(all.documentacaoGratuita, 12500);
  assert.equal(all.totalDescontos, 8000 + 10000 + 42000 + 12500);
  const parts = ["desconto", "casaPaulista", "subsidio", "documentacaoGratuita"].reduce((sum, key) => sum + (all[key] || 0), 0);
  assert.equal(all.totalDescontos, parts);
  // sem subsídio informado (em branco/0 no resultado do motor): não entra no total
  const semSubsidio = valuesOf(withSnapshot({ subsidioMcmv: 0, casaPaulista: 10000, beneficiosInformativos: [DOC] })).valores;
  assert.ok(!("subsidio" in semSubsidio));
  assert.equal(semSubsidio.totalDescontos, 8000 + 10000 + 12500);
  // sem documentação gratuita no cadastro: nada de linha nem de soma
  assert.ok(!("documentacaoGratuita" in valuesOf(withSnapshot()).valores));
  assert.equal(valuesOf(withSnapshot()).valores.totalDescontos, 50000);
  // o benefício também pode vir dos diferenciais do CADASTRO do empreendimento (mesma regra `hasFreeDocuments`, como `selected.features` do card)
  assert.equal(valuesOf(withSnapshot({}, ["Documentação gratuita"])).valores.documentacaoGratuita, 12500);
  assert.equal(valuesOf(withSnapshot({}, [{ text: "Documentação gratuita" }])).valores.documentacaoGratuita, 12500);
  // diferencial só escrito à mão na simulação (não está no cadastro) NÃO vale: o card também não o mostra
  const manual = simulation();
  manual.properties[0].benefits = [{ text: "Documentação gratuita" }];
  assert.ok(!("documentacaoGratuita" in valuesOf(manual).valores));
  // nada a somar: sem total
  const none = valuesOf(withSnapshot({ totalDescontos: 0, subsidioMcmv: 0, descontosAplicados: [] }), 0);
  assert.ok(!("valores" in none) || !("totalDescontos" in none.valores));
});

test("documentação gratuita: sem valor do imóvel não há cena (nunca 5% de zero); DTO só leva números finais", () => {
  assert.ok(!("valores" in valuesOf(withSnapshot({ valorImovel: 0, beneficiosInformativos: [DOC] }))));
  const dto = buildPublicPresentation({ simulation: withSnapshot({ beneficiosInformativos: [DOC] }), defaultReason: DEFAULT_REASON });
  const v = dto.branch[0].valores;
  assert.equal(typeof v.documentacaoGratuita, "number");
  assert.equal(typeof v.totalDescontos, "number");
  assert.ok(!JSON.stringify(dto).includes("documentacao_gratuita"));
});

test("player: logo da Caixa ausente na cena de valores, sem título/nome, total ao final e selo 'Sem ato' verde", () => {
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.match(player, /\{current\.id !== "valores" \? \(\s*<div className=\{styles\.caixa\}>/);
  const scene = /function SceneValores[\s\S]*?\n}\r?\n/.exec(player)?.[0] || "";
  assert.ok(!/Valores deste imóvel|scene\.name|valName/.test(scene), "sem título nem nome do empreendimento");
  assert.match(scene, /Total de descontos/);
  // 2026-10-06 (pedido do dono): o total fica ABAIXO dos valores, na mesma cena, e entra como CARIMBO (sem cena nem botão extra)
  assert.match(scene, /styles\.valStampGo/);
  assert.ok(scene.indexOf("valList") < scene.indexOf("valStampWrap") && scene.indexOf("valStampWrap") < scene.indexOf("valEntry"));
  assert.ok(!/Ver total de descontos|SceneDescontos/.test(player));
  const stampCss = read("components/presentation/presentation.module.css");
  assert.match(stampCss, /@keyframes stampSlam/);
  assert.match(stampCss, /prefers-reduced-motion: reduce\) \{\s*\.valStampGo, \.valShake \{ animation: none; opacity: 1; \}/);
  assert.match(scene, /Documentação gratuita/);
  assert.match(scene, /Subsídio Minha Casa Minha Vida/);
  // o valor do imóvel é o primeiro bloco da cena
  assert.ok(scene.indexOf("valHero") < scene.indexOf("valList"));
  const css = read("components/presentation/presentation.module.css");
  assert.match(css, /\.valFreeIcon \{[^}]*background: #15803d/);
  assert.ok(!/\.valFreeIcon \{[^}]*var\(--blue\)/.test(css), "check do ato 0 não é mais azul");
  assert.match(css, /\.root\[data-scene="valores"\] \.frame::before \{ opacity: 0; \}/);
});

// ---------- ATO ----------
test("ato: 0 informado vira `ato: 0` (a tela destaca 'Sem ato'); valor maior mostra o valor; NÃO informado não existe no DTO", () => {
  assert.equal(valuesOf(withSnapshot({ detalhePagamento: { ato: 0, blocos: [{ label: "P", parcelas: 24, valorParcela: 1000 }] } })).valores.ato, 0);
  assert.equal(valuesOf(withSnapshot({ detalhePagamento: { ato: 5000, blocos: [] } })).valores.ato, 5000);
  for (const bad of [undefined, null, "0", "", Number.NaN, -1, {}]) {
    const valores = valuesOf(withSnapshot({ detalhePagamento: { ato: bad, blocos: [{ label: "P", parcelas: 24, valorParcela: 1000 }] } })).valores;
    assert.ok(!("ato" in valores), `ato ${JSON.stringify(bad)} não pode virar 'sem ato'`);
  }
  const semDetalhe = valuesOf(withSnapshot({ detalhePagamento: undefined })).valores;
  assert.ok(!("ato" in semDetalhe) && !("parcelas" in semDetalhe));
});

test("player: 'Sem ato' só aparece com ato === 0 e entrada a pagar; ato ausente nunca afirma 'sem ato'; reduced-motion respeitado", () => {
  const player = read("components/presentation/PresentationPlayer.jsx");
  const scene = /function SceneValores[\s\S]*?\n}\r?\n/.exec(player)?.[0] || "";
  assert.ok(scene, "SceneValores");
  assert.match(scene, /const free = hasEntry && scene\.ato === 0;/);
  assert.match(scene, /const hasAto = hasEntry && scene\.ato > 0;/);
  assert.match(scene, /\{free \? \(/);
  assert.equal((scene.match(/Sem ato/g) || []).length, 1, "o texto 'Sem ato' só existe no ramo do zero informado");
  assert.match(scene, /Você pode avançar sem pagamento de ato/);
  // números entram com o MESMO contador das cenas de valores (reduced-motion: valor final direto)
  assert.ok((scene.match(/<Count /g) || []).length >= 3);
  assert.match(scene, /reduced=\{reduced \|\| fast\}/);
  const css = read("components/presentation/presentation.module.css");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.valFree \{ animation: fadeOnly/);
  assert.match(player, /const DARK_SCENES = new Set\(\[[^\]]*"valores"/);
  // anúncio para leitor de tela: mesma regra
  assert.match(player, /scene\.ato === 0 \? " Sem ato: você pode avançar sem pagamento de ato\./);
});

// ---------- ordem ----------
test("ordem do ramo: imóvel → valores dele → próximo imóvel → valores dele (e só imóvel quando não há valores)", () => {
  const dto = buildPublicPresentation({ simulation: simulation(), defaultReason: DEFAULT_REASON });
  assert.equal(dto.branch.length, 2, "o DTO segue com 1 item por imóvel (botão e imagem-resumo contam imóveis)");
  const flat = flattenBranch(dto.branch);
  assert.deepEqual(flat.map((scene) => [scene.id, scene.name]), [
    ["imovel", "Residencial Aurora"], ["valores", "Residencial Aurora"], ["imovel", "Condomínio Segundo"], ["valores", "Condomínio Segundo"]
  ]);
  assert.ok(flat.every((scene) => !("valores" in scene)));
  assert.deepEqual(flat.map((scene) => scene.position), [1, 1, 2, 2]);
  // só o 2º imóvel com valores
  const half = buildPublicPresentation({ simulation: simulation({ entryResults: { "emp-2": entry("emp-2") } }), defaultReason: DEFAULT_REASON });
  assert.deepEqual(flattenBranch(half.branch).map((scene) => scene.id), ["imovel", "imovel", "valores"]);
  // nenhum valor: só imóveis, como antes
  const none = buildPublicPresentation({ simulation: simulation({ entryResults: {} }), defaultReason: DEFAULT_REASON });
  assert.deepEqual(flattenBranch(none.branch).map((scene) => scene.id), ["imovel", "imovel"]);
  assert.deepEqual(flattenBranch([]), []);
  // o roteiro principal (e a contagem de cenas do CRM) não muda; a última cena do ramo leva ao "Próximo passo"
  assert.deepEqual(dto.scenes.map((scene) => scene.id), ["abertura", "poder", "formacao", "parcelas", "proximo", "validar", "documentos"]);
  assert.deepEqual(buildPresentationScenes({ simulation: simulation() }).map((scene) => scene.id), dto.scenes.map((scene) => scene.id));
  const player = read("components/presentation/PresentationPlayer.jsx");
  assert.match(player, /const flat = useMemo\(\(\) => flattenBranch\(branch\), \[branch\]\)/);
  assert.match(player, /branchLast: inBranch && branchIndex >= flat\.length - 1/);
  assert.match(player, /propertyCount: branch\.length/, "o botão do Próximo passo continua contando imóveis, não cenas");
  // 2026-10-06 (pedido do dono): sem botão "Ver valores"; com valores a seguir, o toque avança e fica só a dica
  assert.ok(!/[?:] "Ver valores"/.test(player));
  assert.match(player, /\{final \? null : nextIsValues && !last \? \(\s*<p className=\{`\$\{styles\.tapHint\}/);
  assert.match(player, /\{last \? "Continuar" : "Próximo imóvel"\}/);
});

// ---------- vazamento ----------
test("DTO público: a cena de valores só carrega a allowlist (nada do resultado do motor, do cadastro nem ids internos)", () => {
  const dto = buildPublicPresentation({ simulation: simulation(), defaultReason: DEFAULT_REASON });
  const json = JSON.stringify(dto);
  for (const forbidden of [
    "emp-1", "emp-2", "empreendimentoId", "empreendimentoNome", "NOME-INTERNO", "DESCONTO-INTERNO", "BENEFICIO-INTERNO", "AVISO-INTERNO", "clienteSnapshot",
    "rendaTotal", "8123", "fgtsDisponivel", "classificacao", "motivos", "descontosAplicados", "entradaAposFgts", "Souza", "Lima", "propertyId"
  ]) {
    assert.ok(!json.includes(forbidden), `vazou: ${forbidden}`);
  }
  for (const item of dto.branch) {
    for (const key of Object.keys(item)) assert.ok(PUBLIC_BRANCH_FIELDS.includes(key), `ramo expôs ${key}`);
    for (const key of Object.keys(item.valores)) assert.ok(PUBLIC_VALUES_FIELDS.includes(key), `valores expôs ${key}`);
    for (const block of item.valores.parcelas || []) for (const key of Object.keys(block)) assert.ok(PUBLIC_VALUES_INSTALLMENT_FIELDS.includes(key), `parcela expôs ${key}`);
    // números finais (nunca texto cru do banco)
    for (const [key, value] of Object.entries(item.valores)) if (key !== "parcelas") assert.equal(typeof value, "number", key);
  }
  // o player e a imagem-resumo não leem o resultado do motor nem o cadastro
  for (const file of ["components/presentation/PresentationPlayer.jsx", "lib/simulation-presentation-image-core.mjs"]) {
    assert.ok(!/clienteSnapshot|entrySimulationSnapshots|detalhePagamento/.test(read(file)), file);
  }
});

test("fonte única e PDF intocado: o core não recalcula nem importa o PDF; o servidor roda o MESMO motor do card (sem fórmula nova)", () => {
  const core = read("lib/simulation-presentation-core.mjs");
  const code = core.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/simularEntrada|proposta-pdf|calculator|entrySimulationSnapshots|entry_simulation_snapshots/.test(code));
  assert.ok(buildPropertyValues({ entry: entry("emp-1") }));
  assert.equal(buildPropertyValues({ entry: null }), null);
  assert.equal(buildPropertyValues({}), null);
  // o carregador do servidor usa os mesmos ingredientes da tela do card e do PDF, sem ajuste manual de ato/parcelas e sem gravar nada
  const loader = read("lib/simulation-presentation-entry.js");
  assert.match(loader, /clienteEntradaFromSimulation\(simulation\)/);
  assert.match(loader, /getEmpreendimentoRegras\(propertyId\)/);
  assert.match(loader, /simularEntrada\(cliente, aplicarParcelasManuais\(row\.regras, 0\), \{ atoDesejado: 0 \}\)/);
  assert.match(loader, /property\?\.features/);
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(loader));
  assert.match(read("lib/simulation-presentation.js"), /loadPropertyEntryResults\(simulation\)/);
});

test("Gerador: o bloco 'Entrada sugerida (simulação automática)' saiu da Etapa C e nada grava mais entry_simulation_snapshots (dados antigos intactos)", () => {
  const generator = read("components/SimulationGenerator.jsx");
  assert.ok(!/EntradaSimuladaCard|Entrada sugerida|simular-entrada|entradaResultados/.test(generator));
  assert.ok(!/entrySimulationSnapshots/.test(generator), "o formulário não manda a coluna: o mapper não a sobrescreve com []");
  // a tela do card do cliente → Empreendimento e o PDF seguem no motor
  assert.match(read("components/EmpreendimentoPresentation.jsx"), /\/api\/simular-entrada/);
  assert.ok(fs.existsSync(path.join(root, "app/api/simular-entrada/route.js")));
});
