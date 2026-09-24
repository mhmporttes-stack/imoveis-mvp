import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOutgoing,
  decodeReplyId,
  emptyGraph,
  encodeReplyId,
  getOutputPorts,
  interpolate,
  isWithinBusinessHours,
  matchTrigger,
  runFlow,
  validateGraph,
  validateTrigger
} from "../lib/whatsapp-flow-core.mjs";

const FLOW_ID = "flow-1";

function node(id, type, data, x = 0, y = 0) {
  return { id, type, data, x, y };
}

function edge(from, port, to) {
  return { id: `${from}-${port}-${to}`, from, port, to };
}

// Boas-vindas com 2 botões: "Quero simular" -> pergunta o nome -> ação roleta -> link.
function sampleGraph() {
  return {
    nodes: [
      node("start", "start", {}),
      node("m1", "message", {
        mode: "buttons",
        text: "Olá {{primeiro_nome}}! O que você procura?",
        buttons: [{ id: "b1", title: "Quero simular" }, { id: "b2", title: "Falar com corretor" }],
        followUp: { enabled: true, amount: 2, unit: "hours" }
      }),
      node("i1", "input", { text: "Qual o seu nome?", variable: "nome" }),
      node("a1", "action", { actions: [{ type: "roulette" }] }),
      node("m2", "message", { mode: "link", text: "Aqui está, {{primeiro_nome}}", linkLabel: "Simular agora", linkUrl: "{{link_simulacao}}" }),
      node("a2", "action", { actions: [{ type: "handoff" }] }),
      node("m3", "message", { mode: "text", text: "Ainda por aí?" })
    ],
    edges: [
      edge("start", "next", "m1"),
      edge("m1", "b1", "i1"),
      edge("m1", "b2", "a2"),
      edge("m1", "no_reply", "m3"),
      edge("i1", "next", "a1"),
      edge("a1", "next", "m2")
    ]
  };
}

function makeDeps(overrides = {}) {
  const calls = { sent: [], actions: [], logs: [] };
  const deps = {
    calls,
    canSend: () => true,
    send: async (outgoing, n) => { calls.sent.push({ nodeId: n.id, outgoing }); },
    runActions: async (actions) => {
      calls.actions.push(actions);
      if (actions.some((action) => action.type === "handoff")) return { handoff: true };
      return { vars: { link_simulacao: "https://exemplo.com/simulacao?ref=ana", corretor: "Ana" } };
    },
    evaluateCondition: async () => true,
    log: (kind, nodeId, detail) => calls.logs.push({ kind, nodeId, detail }),
    now: () => 1_000_000,
    ...overrides
  };
  return deps;
}

const freshSession = { currentNodeId: "start", vars: { primeiro_nome: "Maria" }, retries: 0, awaiting: null, pendingTarget: null };

test("gatilhos: palavra-chave ignora acento/maiúscula, exata exige igualdade", () => {
  const contains = { type: "keyword", keywords: ["Simulação"], match: "contains" };
  assert.equal(matchTrigger(contains, { text: "quero fazer uma SIMULACAO agora" }), true);
  assert.equal(matchTrigger(contains, { text: "oi" }), false);
  const exact = { type: "keyword", keywords: ["oi"], match: "exact" };
  assert.equal(matchTrigger(exact, { text: " Oi " }), true);
  assert.equal(matchTrigger(exact, { text: "oi tudo bem" }), false);
  assert.equal(matchTrigger({ type: "first_message" }, { isFirstMessage: true }), true);
  assert.equal(matchTrigger({ type: "first_message" }, { isFirstMessage: false }), false);
  assert.equal(matchTrigger({ type: "ad_referral" }, { hasReferral: true }), true);
  assert.equal(matchTrigger({ type: "any_message" }, {}), true);
});

test("validação do gatilho", () => {
  assert.equal(validateTrigger({ type: "keyword", keywords: [] }).length, 1);
  assert.equal(validateTrigger({ type: "keyword", keywords: ["oi"] }).length, 0);
  assert.equal(validateTrigger({ type: "first_message" }).length, 0);
  assert.equal(validateTrigger({ type: "nada" }).length, 1);
});

test("validação do grafo: fluxo de exemplo é válido; limites da Meta são barrados", () => {
  const ok = validateGraph(sampleGraph());
  assert.deepEqual(ok.errors, []);

  const bad = sampleGraph();
  bad.nodes[1].data.buttons = [
    { id: "b1", title: "Um botão com título bem longo demais" },
    { id: "b2", title: "B" },
    { id: "b3", title: "C" },
    { id: "b4", title: "D" }
  ];
  const messages = validateGraph(bad).errors.map((error) => error.message).join("|");
  assert.match(messages, /No máximo 3 botões/);
  assert.match(messages, /passa de 20 caracteres/);

  const noStartEdge = { nodes: emptyGraph().nodes, edges: [] };
  assert.ok(validateGraph(noStartEdge).errors.some((error) => /Ligue o gatilho/.test(error.message)));

  const orphan = sampleGraph();
  orphan.nodes.push(node("x", "message", { mode: "text", text: "sozinho" }));
  assert.ok(validateGraph(orphan).warnings.some((warning) => warning.nodeId === "x"));
});

test("validação: link exige https ou {{link_simulacao}}; lista exige opções", () => {
  const graph = { nodes: [node("start", "start", {}), node("m", "message", { mode: "link", text: "oi", linkLabel: "Abrir", linkUrl: "ftp://x" })], edges: [edge("start", "next", "m")] };
  assert.ok(validateGraph(graph).errors.some((error) => /começar com https/.test(error.message)));
  const list = { nodes: [node("start", "start", {}), node("m", "message", { mode: "list", text: "oi", listButton: "Ver", items: [] })], edges: [edge("start", "next", "m")] };
  assert.ok(validateGraph(list).errors.some((error) => /ao menos uma opção/.test(error.message)));
});

test("portas de saída: botões + outra resposta + se não responder", () => {
  const ports = getOutputPorts(sampleGraph().nodes[1]).map((port) => port.id);
  assert.deepEqual(ports, ["b1", "b2", "other", "no_reply"]);
  assert.deepEqual(getOutputPorts(node("c", "condition", { kind: "is_client" })).map((port) => port.id), ["yes", "no"]);
});

test("mensagem de botões no formato da Meta, com ids rastreáveis e variáveis", () => {
  const { message, display } = buildOutgoing(sampleGraph().nodes[1], { primeiro_nome: "Maria" }, FLOW_ID);
  assert.equal(message.type, "interactive");
  assert.equal(message.interactive.type, "button");
  assert.equal(message.interactive.body.text, "Olá Maria! O que você procura?");
  assert.equal(message.interactive.action.buttons.length, 2);
  assert.deepEqual(decodeReplyId(message.interactive.action.buttons[0].reply.id), { flowId: FLOW_ID, nodeId: "m1", portId: "b1" });
  assert.deepEqual(display.buttons, ["Quero simular", "Falar com corretor"]);
});

test("mensagem de lista e de link", () => {
  const list = buildOutgoing(node("l", "message", { mode: "list", text: "Escolha", listButton: "Ver opções", items: [{ id: "i1", title: "Apto 2 quartos", description: "Zona sul" }] }), {}, FLOW_ID);
  assert.equal(list.message.interactive.type, "list");
  assert.equal(list.message.interactive.action.sections[0].rows[0].description, "Zona sul");
  const link = buildOutgoing(node("k", "message", { mode: "link", text: "Veja", linkLabel: "Abrir", linkUrl: "{{link_simulacao}}" }), { link_simulacao: "https://x.com/s" }, FLOW_ID);
  assert.equal(link.message.interactive.type, "cta_url");
  assert.equal(link.message.interactive.action.parameters.url, "https://x.com/s");
});

test("interpolate troca variáveis e apaga as desconhecidas", () => {
  assert.equal(interpolate("Oi {{nome}} {{x}}!", { nome: "Ana" }), "Oi Ana !");
});

test("executor: início envia botões e fica esperando (com prazo de 'se não responder')", async () => {
  const deps = makeDeps();
  const result = await runFlow({ graph: sampleGraph(), flowId: FLOW_ID, session: freshSession, deps });
  assert.equal(result.status, "waiting");
  assert.equal(deps.calls.sent.length, 1);
  assert.equal(result.session.awaiting.nodeId, "m1");
  assert.equal(result.session.awaiting.type, "choice");
  assert.equal(result.waitUntil.getTime(), 1_000_000 + 2 * 60 * 60 * 1000);
});

test("executor: toque no botão segue a ligação; pergunta o nome; resposta vira variável; roleta; link", async () => {
  const graph = sampleGraph();
  const deps = makeDeps();
  let result = await runFlow({ graph, flowId: FLOW_ID, session: freshSession, deps });

  const tap = { kind: "reply", text: "Quero simular", replyId: encodeReplyId(FLOW_ID, "m1", "b1") };
  result = await runFlow({ graph, flowId: FLOW_ID, session: result.session, input: tap, deps });
  assert.equal(result.status, "waiting");
  assert.equal(result.session.awaiting.type, "text");
  assert.equal(deps.calls.sent.at(-1).nodeId, "i1");

  result = await runFlow({ graph, flowId: FLOW_ID, session: result.session, input: { kind: "reply", text: "Joana Silva" }, deps });
  assert.equal(result.status, "completed");
  assert.equal(deps.calls.actions.length, 1);
  const last = deps.calls.sent.at(-1);
  assert.equal(last.nodeId, "m2");
  assert.equal(last.outgoing.message.interactive.action.parameters.url, "https://exemplo.com/simulacao?ref=ana");
  assert.equal(result.session.vars.nome, "Joana Silva");
  assert.equal(result.session.vars.primeiro_nome, "Joana");
});

test("executor: texto igual ao rótulo do botão conta como toque", async () => {
  const graph = sampleGraph();
  const deps = makeDeps();
  let result = await runFlow({ graph, flowId: FLOW_ID, session: freshSession, deps });
  result = await runFlow({ graph, flowId: FLOW_ID, session: result.session, input: { kind: "reply", text: "quero simular" }, deps });
  assert.equal(result.session.awaiting.nodeId, "i1");
});

test("executor: botão 'falar com corretor' -> ação de passar para atendente encerra em handoff", async () => {
  const graph = sampleGraph();
  const deps = makeDeps();
  let result = await runFlow({ graph, flowId: FLOW_ID, session: freshSession, deps });
  result = await runFlow({ graph, flowId: FLOW_ID, session: result.session, input: { kind: "reply", text: "x", replyId: encodeReplyId(FLOW_ID, "m1", "b2") }, deps });
  assert.equal(result.status, "handoff");
});

test("executor: resposta fora das opções repete a pergunta 2x e depois passa para uma pessoa", async () => {
  const graph = sampleGraph();
  const deps = makeDeps();
  let result = await runFlow({ graph, flowId: FLOW_ID, session: freshSession, deps });
  const junk = { kind: "reply", text: "blablabla" };
  result = await runFlow({ graph, flowId: FLOW_ID, session: result.session, input: junk, deps });
  assert.equal(result.status, "waiting");
  assert.equal(result.session.retries, 1);
  assert.equal(deps.calls.sent.length, 2);
  result = await runFlow({ graph, flowId: FLOW_ID, session: result.session, input: junk, deps });
  assert.equal(result.session.retries, 2);
  assert.equal(deps.calls.sent.length, 3);
  let handoffReason = null;
  const deps2 = makeDeps({ onHandoff: async (reason) => { handoffReason = reason; } });
  result = await runFlow({ graph, flowId: FLOW_ID, session: result.session, input: junk, deps: deps2 });
  assert.equal(result.status, "handoff");
  assert.equal(handoffReason, "resposta_fora_das_opcoes");
});

test("executor: porta 'outra resposta' ligada recebe o texto livre", async () => {
  const graph = sampleGraph();
  graph.edges.push(edge("m1", "other", "m3"));
  const deps = makeDeps();
  let result = await runFlow({ graph, flowId: FLOW_ID, session: freshSession, deps });
  result = await runFlow({ graph, flowId: FLOW_ID, session: result.session, input: { kind: "reply", text: "qualquer coisa" }, deps });
  assert.equal(deps.calls.sent.at(-1).nodeId, "m3");
  assert.equal(result.status, "completed");
});

test("executor: timeout segue 'se não responder'", async () => {
  const graph = sampleGraph();
  const deps = makeDeps();
  let result = await runFlow({ graph, flowId: FLOW_ID, session: freshSession, deps });
  result = await runFlow({ graph, flowId: FLOW_ID, session: result.session, input: { kind: "timeout" }, deps });
  assert.equal(deps.calls.sent.at(-1).nodeId, "m3");
  assert.equal(result.status, "completed");
});

test("executor: 'Espera' agenda a retomada e resume continua do próximo bloco", async () => {
  const graph = {
    nodes: [node("start", "start", {}), node("d", "delay", { amount: 30, unit: "minutes" }), node("m", "message", { mode: "text", text: "voltei" })],
    edges: [edge("start", "next", "d"), edge("d", "next", "m")]
  };
  const deps = makeDeps();
  let result = await runFlow({ graph, flowId: FLOW_ID, session: freshSession, deps });
  assert.equal(result.status, "waiting");
  assert.equal(result.waitUntil.getTime(), 1_000_000 + 30 * 60 * 1000);
  assert.equal(deps.calls.sent.length, 0);
  result = await runFlow({ graph, flowId: FLOW_ID, session: result.session, input: { kind: "resume" }, deps });
  assert.equal(result.status, "completed");
  assert.equal(deps.calls.sent.length, 1);
});

test("executor: janela de 24h fechada encerra sem enviar", async () => {
  const deps = makeDeps({ canSend: () => false });
  const result = await runFlow({ graph: sampleGraph(), flowId: FLOW_ID, session: freshSession, deps });
  assert.equal(result.status, "expired");
  assert.equal(result.endReason, "janela_de_24h_fechada");
  assert.equal(deps.calls.sent.length, 0);
});

test("executor: condição escolhe sim/não; laço infinito é interrompido", async () => {
  const graph = {
    nodes: [node("start", "start", {}), node("c", "condition", { kind: "is_client" }), node("y", "message", { mode: "text", text: "cliente" }), node("n", "message", { mode: "text", text: "novo" })],
    edges: [edge("start", "next", "c"), edge("c", "yes", "y"), edge("c", "no", "n")]
  };
  const yes = makeDeps({ evaluateCondition: async () => true });
  await runFlow({ graph, flowId: FLOW_ID, session: freshSession, deps: yes });
  assert.equal(yes.calls.sent[0].nodeId, "y");
  const no = makeDeps({ evaluateCondition: async () => false });
  await runFlow({ graph, flowId: FLOW_ID, session: freshSession, deps: no });
  assert.equal(no.calls.sent[0].nodeId, "n");

  const loop = { nodes: [node("start", "start", {}), node("c", "condition", { kind: "is_client" })], edges: [edge("start", "next", "c"), edge("c", "yes", "c"), edge("c", "no", "c")] };
  const result = await runFlow({ graph: loop, flowId: FLOW_ID, session: freshSession, deps: makeDeps() });
  assert.equal(result.status, "failed");
  assert.equal(result.endReason, "limite_de_passos");
});

test("executor: muitas mensagens seguidas são divididas entre ciclos (não estoura o webhook)", async () => {
  const nodes = [node("start", "start", {})];
  const edges = [edge("start", "next", "t0")];
  for (let index = 0; index < 12; index += 1) {
    nodes.push(node(`t${index}`, "message", { mode: "text", text: `msg ${index}` }));
    if (index < 11) edges.push(edge(`t${index}`, "next", `t${index + 1}`));
  }
  const deps = makeDeps();
  let result = await runFlow({ graph: { nodes, edges }, flowId: FLOW_ID, session: freshSession, deps });
  assert.equal(result.status, "waiting");
  assert.equal(deps.calls.sent.length, 8);
  result = await runFlow({ graph: { nodes, edges }, flowId: FLOW_ID, session: result.session, input: { kind: "resume" }, deps });
  assert.equal(deps.calls.sent.length, 12);
  assert.equal(result.status, "completed");
});

test("horário comercial em America/Sao_Paulo", () => {
  const config = { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] };
  // 2026-09-23 é quarta; 13:00 UTC = 10:00 em São Paulo
  assert.equal(isWithinBusinessHours(config, new Date("2026-09-23T13:00:00Z")), true);
  // 23:00 UTC = 20:00 em São Paulo
  assert.equal(isWithinBusinessHours(config, new Date("2026-09-23T23:00:00Z")), false);
  // sábado 10:00 SP
  assert.equal(isWithinBusinessHours(config, new Date("2026-09-26T13:00:00Z")), false);
});

test("modelos prontos do editor passam na validação de ativação", async () => {
  const { buildFlowFromTemplate, listFlowTemplates } = await import("../components/flows/flow-templates.js");
  for (const { key } of listFlowTemplates()) {
    const { trigger, graph } = buildFlowFromTemplate(key);
    const graphResult = validateGraph(graph);
    const triggerErrors = key === "blank" ? [] : validateTrigger(trigger);
    if (key === "blank") continue; // em branco precisa ser preenchido antes de ativar
    assert.deepEqual(graphResult.errors, [], `modelo ${key}`);
    assert.deepEqual(triggerErrors, [], `gatilho do modelo ${key}`);
  }
});
