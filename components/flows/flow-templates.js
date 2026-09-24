import { emptyGraph, getOutputPorts } from "../../lib/whatsapp-flow-core.mjs";

// Modelos de fluxo para começar sem partir do zero. Todos seguem a mesma meta
// de atendimento: levar o cliente por UM de dois caminhos —
//   1) fazer a simulação (link direto para o formulário), ou
//   2) ser atendido por um corretor (roleta → conversa atribuída ao corretor
//      no Chat, que continua pelo número oficial).
// Cada builder devolve { name, trigger, graph } já válido para ativar.

const FOLLOW_UP_OFF = { enabled: false, amount: 2, unit: "hours" };
const BLANK = { footer: "", imageUrl: "", buttons: [], listButton: "Ver opções", items: [], linkLabel: "", linkUrl: "", followUp: FOLLOW_UP_OFF };

function edge(from, port, to) {
  return { id: `e-${from}-${port}-${to}`, from, port, to };
}

const text = (id, body) => ({ id, type: "message", x: 0, y: 0, data: { ...BLANK, mode: "text", text: body } });
const buttons = (id, body, titles, { followUp = FOLLOW_UP_OFF, footer = "" } = {}) => ({
  id, type: "message", x: 0, y: 0,
  data: { ...BLANK, mode: "buttons", text: body, footer, buttons: titles.map((title, index) => ({ id: `b${index + 1}`, title })), followUp }
});
const link = (id, body, label) => ({ id, type: "message", x: 0, y: 0, data: { ...BLANK, mode: "link", text: body, linkLabel: label, linkUrl: "{{link_simulacao}}" } });
const ask = (id, body, variable) => ({ id, type: "input", x: 0, y: 0, data: { text: body, variable, followUp: FOLLOW_UP_OFF } });
const act = (id, actions) => ({ id, type: "action", x: 0, y: 0, data: { actions } });
const cond = (id, data) => ({ id, type: "condition", x: 0, y: 0, data });
const START = { id: "start", type: "start", x: 0, y: 0, data: {} };

const BUSINESS_HOURS = { kind: "business_hours", start: "08:00", end: "19:00", days: [1, 2, 3, 4, 5, 6] };

// Caminho 1 — simulação: link direto + convite para falar com corretor.
function simulationPath(prefix, nodes, edges) {
  const sim = `${prefix}sim`;
  nodes.push(link(sim, "Ótimo! 🏡 Aqui está o link para fazer a sua simulação de financiamento. Leva poucos minutos e é sem compromisso. Assim que você terminar, um corretor da nossa equipe entra em contato com você por aqui mesmo.", "Fazer simulação"));
  nodes.push(text(`${prefix}simfim`, "Se preferir falar com um corretor agora, é só me avisar por aqui. 😉"));
  edges.push(edge(sim, "next", `${prefix}simfim`));
  return sim;
}

// Caminho 2 — corretor: confirma o nome, encaminha pela roleta, avisa o cliente
// e passa a conversa (já atribuída ao corretor) para o Chat.
function brokerPath(prefix, nodes, edges) {
  const hasName = `${prefix}hn`;
  const question = `${prefix}q`;
  const action = `${prefix}act`;
  const hasBroker = `${prefix}hb`;
  nodes.push(cond(hasName, { kind: "has_name" }));
  nodes.push(ask(question, "Perfeito! Para eu te encaminhar ao corretor certo, qual é o seu nome?", "nome"));
  nodes.push(act(action, [{ type: "roulette" }, { type: "tag", tag: "Atendimento WhatsApp" }]));
  nodes.push(cond(hasBroker, { kind: "has_broker" }));
  nodes.push(text(`${prefix}ok`, "Prazer, {{primeiro_nome}}! 🙌 Você vai ser atendido(a) por {{corretor}}, {{nosso_cargo}} especialista em financiamento imobiliário. Já avisamos {{o_a}} {{corretor}}, que continua a conversa com você por aqui, neste mesmo número."));
  nodes.push(text(`${prefix}nobroker`, "Prazer, {{primeiro_nome}}! 🙌 Um dos nossos corretores vai continuar o seu atendimento por aqui, neste mesmo número, em instantes."));
  nodes.push(act(`${prefix}h1`, [{ type: "handoff" }]));
  nodes.push(act(`${prefix}h2`, [{ type: "handoff" }]));
  edges.push(
    edge(hasName, "yes", action), edge(hasName, "no", question), edge(question, "next", action),
    edge(action, "next", hasBroker), edge(hasBroker, "yes", `${prefix}ok`), edge(hasBroker, "no", `${prefix}nobroker`),
    edge(`${prefix}ok`, "next", `${prefix}h1`), edge(`${prefix}nobroker`, "next", `${prefix}h2`)
  );
  return hasName;
}

// Menu de duas opções (com lembrete se o cliente não responder).
function choiceMenu(prefix, body, nodes, edges, simEntry, brokerEntry) {
  const menu = `${prefix}menu`;
  const nudge = `${prefix}nudge`;
  nodes.push(buttons(menu, body, ["Fazer simulação", "Falar com corretor"], { followUp: { enabled: true, amount: 2, unit: "hours" }, footer: "Atendimento virtual" }));
  nodes.push(buttons(nudge, "Ainda por aí, {{primeiro_nome}}? 🙂 Posso te ajudar de duas formas:", ["Fazer simulação", "Falar com corretor"]));
  edges.push(
    edge(menu, "b1", simEntry), edge(menu, "b2", brokerEntry), edge(menu, "no_reply", nudge),
    edge(nudge, "b1", simEntry), edge(nudge, "b2", brokerEntry)
  );
  return menu;
}

// Organiza em colunas (profundidade a partir do gatilho), com alturas estimadas
// iguais às do editor.
function layout(graph) {
  const heightOf = (node) => {
    const body = { start: 64, message: 78, input: 64, condition: 44, delay: 40 }[node.type] ?? 20 + 22 * Math.max(1, (node.data?.actions || []).length);
    return 40 + body + getOutputPorts(node).length * 30 + 8;
  };
  const depth = new Map([["start", 0]]);
  const queue = ["start"];
  while (queue.length) {
    const id = queue.shift();
    for (const item of graph.edges.filter((entry) => entry.from === id)) {
      if (!depth.has(item.to)) {
        depth.set(item.to, depth.get(id) + 1);
        queue.push(item.to);
      }
    }
  }
  const columns = new Map();
  for (const node of graph.nodes) {
    const column = depth.get(node.id) ?? 0;
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column).push(node);
  }
  const positions = new Map();
  for (const [column, list] of columns) {
    let y = 40;
    for (const node of list) {
      positions.set(node.id, { x: 40 + column * 360, y });
      y += heightOf(node) + 36;
    }
  }
  return { ...graph, nodes: graph.nodes.map((node) => ({ ...node, ...positions.get(node.id) })) };
}

function build(nodes, edges) {
  return layout({ nodes: [START, ...nodes], edges });
}

const TEMPLATES = [
  {
    key: "formulario-concluido",
    title: "Formulário concluído (Receber minha simulação)",
    description: "Para quem toca em \"Receber minha simulação\" ao terminar o formulário: encaminha a conversa ao corretor do cadastro (ou à roleta) e avisa o prazo.",
    build: () => {
      const nodes = [
        cond("hours", BUSINESS_HOURS),
        act("act", [{ type: "roulette" }, { type: "tag", tag: "Simulação pelo WhatsApp" }]),
        text("open", "Olá, {{primeiro_nome}}! 👋 Recebemos o seu cadastro. Em alguns minutos, um dos nossos associados já enviará para você um PDF com todas as informações detalhadas e iniciará o seu atendimento."),
        text("closed", "Olá, {{primeiro_nome}}! 👋 Recebemos o seu cadastro. Nosso time atende de segunda a sábado, das 8h às 19h. Assim que o atendimento começar, um dos nossos associados enviará para você um PDF com todas as informações detalhadas e iniciará o seu atendimento."),
        act("h1", [{ type: "handoff" }]),
        act("h2", [{ type: "handoff" }])
      ];
      const edges = [
        edge("start", "next", "act"), edge("act", "next", "hours"),
        edge("hours", "yes", "open"), edge("hours", "no", "closed"),
        edge("open", "next", "h1"), edge("closed", "next", "h2")
      ];
      return {
        name: "Formulário concluído (Receber minha simulação)",
        trigger: { type: "keyword", keywords: ["preenchi meu cadastro", "receber a minha simulação", "receber minha simulação"], match: "contains", cooldownHours: 12 },
        graph: build(nodes, edges)
      };
    }
  },
  {
    key: "blank",
    title: "Em branco",
    description: "Comece do zero e monte do seu jeito.",
    build: () => ({ name: "Novo fluxo", trigger: { type: "keyword", keywords: [], match: "contains", cooldownHours: 0 }, graph: emptyGraph() })
  },
  {
    key: "menu-principal",
    title: "Menu principal (qualquer mensagem)",
    description: "Recebe qualquer contato, avisa se estiver fora do horário e oferece dois caminhos: fazer a simulação ou falar com um corretor.",
    build: () => {
      const nodes = [];
      const edges = [];
      const simEntry = simulationPath("s", nodes, edges);
      const brokerEntry = brokerPath("b", nodes, edges);
      const menu = choiceMenu("m", "Olá, {{primeiro_nome}}! 👋 Bem-vindo(a) ao atendimento do Matheus Machado Imóveis. Como você prefere seguir?", nodes, edges, simEntry, brokerEntry);
      nodes.push(cond("hours", BUSINESS_HOURS));
      nodes.push(text("after", "Olá, {{primeiro_nome}}! 👋 Nosso time atende de segunda a sábado, das 8h às 19h, mas você não precisa esperar: já dá para adiantar tudo por aqui."));
      edges.push(edge("start", "next", "hours"), edge("hours", "yes", menu), edge("hours", "no", "after"), edge("after", "next", menu));
      return {
        name: "Menu principal",
        trigger: { type: "any_message", keywords: [], match: "contains", cooldownHours: 6 },
        graph: build(nodes, edges)
      };
    }
  },
  {
    key: "anuncio",
    title: "Anúncio (Click to WhatsApp)",
    description: "Para quem chega clicando no anúncio: agradece o interesse e oferece os dois caminhos.",
    build: () => {
      const nodes = [];
      const edges = [];
      const simEntry = simulationPath("s", nodes, edges);
      const brokerEntry = brokerPath("b", nodes, edges);
      const menu = choiceMenu("m", "Olá, {{primeiro_nome}}! 👋 Que bom que você se interessou pelo nosso anúncio. Como prefere seguir?", nodes, edges, simEntry, brokerEntry);
      edges.push(edge("start", "next", menu));
      return {
        name: "Anúncio (Click to WhatsApp)",
        trigger: { type: "ad_referral", keywords: [], match: "contains", cooldownHours: 0 },
        graph: build(nodes, edges)
      };
    }
  },
  {
    key: "palavra-simulacao",
    title: "Palavra-chave: simulação",
    description: "Quando o cliente pede simulação/financiamento, manda direto o link.",
    build: () => {
      const nodes = [];
      const edges = [];
      const simEntry = simulationPath("s", nodes, edges);
      edges.push(edge("start", "next", simEntry));
      return {
        name: "Palavra-chave: simulação",
        trigger: { type: "keyword", keywords: ["simulação", "simulacao", "simular", "financiamento", "financiar", "quero financiar", "minha casa minha vida", "mcmv"], match: "contains", cooldownHours: 0 },
        graph: build(nodes, edges)
      };
    }
  },
  {
    key: "palavra-corretor",
    title: "Palavra-chave: falar com corretor",
    description: "Quando o cliente pede um corretor/atendente, encaminha pela roleta e passa para o Chat.",
    build: () => {
      const nodes = [];
      const edges = [];
      const brokerEntry = brokerPath("b", nodes, edges);
      edges.push(edge("start", "next", brokerEntry));
      return {
        name: "Palavra-chave: falar com corretor",
        trigger: { type: "keyword", keywords: ["corretor", "corretora", "atendente", "humano", "falar com alguém", "falar com alguem", "falar com uma pessoa"], match: "contains", cooldownHours: 0 },
        graph: build(nodes, edges)
      };
    }
  }
];

export function listFlowTemplates() {
  return TEMPLATES.map(({ key, title, description }) => ({ key, title, description }));
}

export function buildFlowFromTemplate(key) {
  const template = TEMPLATES.find((item) => item.key === key) || TEMPLATES[0];
  return template.build();
}
