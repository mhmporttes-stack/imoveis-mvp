import assert from "node:assert/strict";
import test from "node:test";
import {
  advance, classifyGuideKind, fillPlaceholders, getOutputPorts, goBack, libraryEntries, restoreState, sanitizeGuideGraph,
  scanCompliance, startState, validateGuideGraph
} from "../lib/attendance-guide-core.mjs";
import { buildSeedGuides, SEED_IDS } from "../lib/attendance-guide-seed.mjs";

const seeds = buildSeedGuides();
const bySlug = Object.fromEntries(seeds.map((guide) => [guide.slug, guide]));
const graphs = new Map(seeds.map((guide) => [guide.id, guide.graph]));
const libraryNodes = new Set(seeds.flatMap((guide) => guide.graph.nodes.map((node) => `${guide.id}::${node.id}`)));

test("origem do atendimento → tipo de guia", () => {
  assert.equal(classifyGuideKind({ prospectingContactId: "x", acquisitionKind: "campaign" }), "prospecting");
  assert.equal(classifyGuideKind({ acquisitionKind: "whatsapp_ad" }), "lead");
  assert.equal(classifyGuideKind({ acquisitionKind: "campaign" }), "lead");
  assert.equal(classifyGuideKind({ conversationOriginKind: "meta_ad", acquisitionKind: "whatsapp_reply" }), "lead");
  assert.equal(classifyGuideKind({ acquisitionKind: "manual" }), "organic");
  assert.equal(classifyGuideKind({ acquisitionKind: "site" }), "organic");
  assert.equal(classifyGuideKind({}), "organic");
});

test("[Nome], [Corretor] e [Link] são preenchidos; sem dado o marcador fica para o corretor", () => {
  assert.equal(fillPlaceholders("Oi [Nome], sou [Corretor]. [Link]", { clientName: "MARIA da Silva", brokerName: "joão pedro", simulationLink: "https://x" }), "Oi Maria, sou João. https://x");
  assert.equal(fillPlaceholders("Oi [nome]!", {}), "Oi [nome]!");
});

test("conformidade: 'me chama' e promessas viram aviso; negação não", () => {
  assert.ok(scanCompliance("Qualquer coisa me chama!").some((hit) => hit.kind === "closer"));
  assert.ok(scanCompliance("Fico aguardando seu retorno").some((hit) => hit.kind === "closer"));
  assert.ok(scanCompliance("Sua aprovação é garantida").some((hit) => hit.kind === "promise"));
  assert.ok(scanCompliance("É financiamento sem juros").some((hit) => hit.kind === "promise"));
  assert.equal(scanCompliance("Eu não posso garantir a aprovação, quem decide é o banco.").length, 0);
  assert.equal(scanCompliance("Vou te retornar amanhã às 10h com os valores.").length, 0);
});

test("modelos iniciais: 4 guias, todos os destinos existem e nenhum texto pronto viola a regra", () => {
  assert.equal(seeds.length, 4);
  for (const guide of seeds) {
    const ids = new Set(guide.graph.nodes.map((node) => node.id));
    assert.equal(ids.size, guide.graph.nodes.length, `${guide.slug}: ids duplicados`);
    for (const edge of guide.graph.edges) {
      assert.ok(ids.has(edge.from) && ids.has(edge.to), `${guide.slug}: ligação quebrada ${edge.from} -> ${edge.to}`);
      const from = guide.graph.nodes.find((node) => node.id === edge.from);
      assert.ok(getOutputPorts(from).some((port) => port.id === edge.port), `${guide.slug}: porta inexistente ${edge.from}/${edge.port}`);
    }
    const result = validateGuideGraph(guide.graph, { libraryNodes, isLibrary: guide.kind === "library" });
    assert.deepEqual(result.errors, [], `${guide.slug}: erros de validação`);
    const violations = result.warnings.filter((warning) => /Evite/.test(warning.message));
    assert.deepEqual(violations, [], `${guide.slug}: texto fora da regra`);
    // a sanitização não pode perder nada do modelo
    const sanitized = sanitizeGuideGraph(guide.graph);
    assert.equal(sanitized.nodes.length, guide.graph.nodes.length);
    assert.equal(sanitized.edges.length, guide.graph.edges.length);
  }
});

test("nos modelos, toda resposta tem destino e nenhum card fica sem caminho", () => {
  for (const guide of seeds) {
    const result = validateGuideGraph(guide.graph, { libraryNodes, isLibrary: guide.kind === "library" });
    const loose = result.warnings.filter((warning) => /não leva a nenhum card|não tem próximas respostas|não está ligado/.test(warning.message));
    assert.deepEqual(loose, [], `${guide.slug}: caminhos soltos`);
  }
});

test("Prospecção: abertura → apresentação → não comprou → sem entrada (banco) → volta para a documentação", () => {
  let state = startState(graphs, SEED_IDS.prospecting);
  assert.equal(state.nodeId, "p-abertura");
  const pick = (from, label) => {
    const node = graphs.get(state.guideId).nodes.find((item) => item.id === state.nodeId);
    assert.equal(node.id, from);
    const port = getOutputPorts(node).find((item) => item.label === label);
    assert.ok(port, `opção "${label}" em ${from}`);
    state = advance(state, graphs, port.id);
  };
  pick("p-abertura", "Cliente respondeu");
  pick("p-apresentacao", "Não comprou");
  pick("p-motivo", "Sem entrada");
  assert.equal(state.guideId, SEED_IDS.library);
  assert.equal(state.nodeId, "obj-sem-entrada");
  assert.equal(state.stack.length, 1);
  pick("obj-sem-entrada", "Não tem nada separado");
  pick("sol-sem-entrada", "Não gostou das opções sem entrada");
  assert.equal(state.nodeId, "sol-primeiro-imovel");
  pick("sol-primeiro-imovel", "Entendeu e gostou da ideia");
  pick("lib-testar", "Aceitou / quer seguir");
  // o "return" é atravessado sozinho: volta ao guia de origem, já na Documentação, com a pilha vazia
  assert.equal(state.guideId, SEED_IDS.prospecting);
  assert.equal(state.nodeId, "p-documentacao");
  assert.deepEqual(state.stack, []);
  // voltar desfaz um passo por vez
  state = goBack(state);
  assert.equal(state.nodeId, "lib-testar");
  assert.equal(state.guideId, SEED_IDS.library);
});

test("progresso salvo é restaurado; card que sumiu volta ao começo", () => {
  const started = startState(graphs, SEED_IDS.lead);
  const firstPort = getOutputPorts(graphs.get(SEED_IDS.lead).nodes.find((node) => node.id === started.nodeId))[0].id;
  const next = advance(started, graphs, firstPort);
  const restored = restoreState(JSON.parse(JSON.stringify(next)), graphs, SEED_IDS.lead);
  assert.equal(restored.nodeId, next.nodeId);
  const broken = restoreState({ guideId: SEED_IDS.lead, nodeId: "nao-existe", stack: [], path: [] }, graphs, SEED_IDS.lead);
  assert.equal(broken.nodeId, "l-recepcao");
});

test("Banco de objeções cobre todas as objeções pedidas", () => {
  const entries = libraryEntries(SEED_IDS.library, bySlug["banco-de-objecoes"].graph);
  const titles = entries.map((entry) => entry.title.toLowerCase()).join(" | ");
  for (const word of ["entrada", "parcela", "renda", "aprovação", "restrição", "imóvel", "esperar", "juntar", "juros", "financiar", "pensar", "família", "reprovado", "aluguel", "outro corretor", "responde", "outra objeção"]) {
    assert.ok(titles.includes(word), `falta objeção: ${word}`);
  }
  assert.ok(entries.length >= 18);
});

test("sanitização: descarta tipos/portas/duplicados inválidos e limita textos", () => {
  const graph = sanitizeGuideGraph({
    nodes: [
      { id: "start", type: "start", x: 1, y: 2 },
      { id: "a", type: "card", data: { title: "x".repeat(500), options: [{ id: "o1", label: "Sim" }, { id: "o1", label: "dup" }] } },
      { id: "a", type: "card" },
      { id: "b", type: "hack", data: {} }
    ],
    edges: [
      { from: "start", port: "next", to: "a" },
      { from: "a", port: "o1", to: "b" },
      { from: "a", port: "naoexiste", to: "b" },
      { from: "a", port: "o1", to: "start" }
    ]
  });
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.nodes.find((node) => node.id === "b").type, "card");
  assert.equal(graph.nodes.find((node) => node.id === "a").data.title.length, 120);
  assert.equal(graph.nodes.find((node) => node.id === "a").data.options.length, 1);
  assert.equal(graph.edges.length, 2);
});
