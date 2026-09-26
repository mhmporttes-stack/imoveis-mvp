// Núcleo PURO do Guia de Atendimento (sem banco, sem rede): modelo do grafo, portas de saída, validação,
// classificação da origem do cliente, preenchimento de [Nome]/[Corretor] e o "andador" da árvore de decisão
// (avançar, voltar, entrar/sair do Banco de Objeções). Roda no servidor e no navegador — por isso é .mjs sem
// "server-only". Testes: tests/attendance-guide-core.test.mjs.
//
// O mapa é o MESMO tipo de grafo dos Fluxos do WhatsApp ({ nodes:[{id,type,x,y,data}], edges:[{id,from,port,to}] }),
// para reaproveitar o canvas do editor. Aqui cada RESPOSTA possível do cliente é uma porta de saída do card.

export const LIMITS = {
  maxNodes: 220,
  maxEdges: 700,
  maxOptions: 20,
  title: 120,
  text: 2500,
  option: 120,
  graphBytes: 600 * 1024
};

export const GUIDE_KINDS = {
  prospecting: { label: "Prospecção", hint: "Reativação / cliente antigo" },
  lead: { label: "Lead", hint: "Patrocinado / lead novo" },
  organic: { label: "Orgânico", hint: "Instagram, indicação, WhatsApp, contato espontâneo" },
  custom: { label: "Personalizado", hint: "Abre só quando o corretor escolher" },
  library: { label: "Banco de objeções", hint: "Objeções reutilizáveis pelos outros guias" }
};
export const AUTO_KINDS = ["prospecting", "lead", "organic"];
export const GUIDE_KIND_KEYS = Object.keys(GUIDE_KINDS);

export const NODE_TYPES = ["start", "card", "followup", "ref", "end", "return"];
export const START_NODE_ID = "start";

// Regra central do atendimento — a faixa no topo do card mostra em que ponto o corretor está.
export const PHASES = [
  { key: "abertura", label: "Abertura" },
  { key: "objecao", label: "Objeção" },
  { key: "investigar", label: "Investigar" },
  { key: "motivo", label: "Motivo real" },
  { key: "solucionar", label: "Solucionar" },
  { key: "testar", label: "Testar aceitação" },
  { key: "documentacao", label: "Documentação" },
  { key: "retorno", label: "Data de retorno" },
  { key: "encerramento", label: "Encerramento" }
];
export const RULE_PHASES = ["objecao", "investigar", "motivo", "solucionar", "testar", "documentacao", "retorno"];

export function emptyGuideGraph() {
  return { nodes: [{ id: START_NODE_ID, type: "start", x: 40, y: 140, data: {} }], edges: [] };
}

export function newId(prefix = "n") {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultNodeData(type) {
  switch (type) {
    case "card":
      return { title: "Novo card", phase: "investigar", guidance: "", argument: "", message: "", options: [] };
    case "followup":
      return { title: "Definir próximo passo e data de retorno", guidance: "Todo atendimento pendente termina com um próximo passo combinado e uma data para voltar a falar com o cliente.", message: "", defaultDays: 1, activityType: "follow_up" };
    case "ref":
      return { guideId: "", nodeId: "", label: "" };
    case "end":
      return { title: "Atendimento encerrado", guidance: "", outcome: "" };
    default:
      return {};
  }
}

export function optionsOf(node) {
  return Array.isArray(node?.data?.options) ? node.data.options : [];
}

export function getOutputPorts(node) {
  switch (node?.type) {
    case "start":
      return [{ id: "next", label: "Começar" }];
    case "card":
      return optionsOf(node).map((option) => ({ id: option.id, label: String(option.label || "").trim() || "Resposta" }));
    case "followup":
      return [{ id: "next", label: "Depois de agendar" }];
    case "ref":
      return [{ id: "next", label: "Ao voltar do tratamento" }];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Sanitização (servidor) — nunca confia no que veio do navegador.
// ---------------------------------------------------------------------------

function clip(value, max) {
  return String(value ?? "").slice(0, max);
}

export function sanitizeGuideGraph(input) {
  const nodesInput = Array.isArray(input?.nodes) ? input.nodes : [];
  const edgesInput = Array.isArray(input?.edges) ? input.edges : [];
  if (nodesInput.length > LIMITS.maxNodes) throw new Error(`O guia pode ter no máximo ${LIMITS.maxNodes} cards.`);
  if (edgesInput.length > LIMITS.maxEdges) throw new Error("Ligações demais no guia.");

  const seen = new Set();
  const nodes = [];
  for (const raw of nodesInput) {
    const id = clip(raw?.id, 40);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const type = NODE_TYPES.includes(raw?.type) ? raw.type : "card";
    const data = raw?.data && typeof raw.data === "object" ? raw.data : {};
    const node = { id, type, x: Math.round(Number(raw?.x) || 0), y: Math.round(Number(raw?.y) || 0), data: {} };
    if (type === "card") {
      const optionIds = new Set();
      node.data = {
        title: clip(data.title, LIMITS.title),
        phase: PHASES.some((phase) => phase.key === data.phase) ? data.phase : "investigar",
        guidance: clip(data.guidance, LIMITS.text),
        argument: clip(data.argument, LIMITS.text),
        message: clip(data.message, LIMITS.text),
        entry: data.entry === true,
        options: (Array.isArray(data.options) ? data.options : []).slice(0, LIMITS.maxOptions).map((option) => ({ id: clip(option?.id, 40), label: clip(option?.label, LIMITS.option) }))
          .filter((option) => {
            if (!option.id || optionIds.has(option.id)) return false;
            optionIds.add(option.id);
            return true;
          })
      };
    } else if (type === "followup") {
      const days = Math.round(Number(data.defaultDays));
      node.data = {
        title: clip(data.title, LIMITS.title),
        guidance: clip(data.guidance, LIMITS.text),
        message: clip(data.message, LIMITS.text),
        defaultDays: Number.isFinite(days) ? Math.min(Math.max(days, 0), 365) : 1,
        activityType: clip(data.activityType, 40) || "follow_up"
      };
    } else if (type === "ref") {
      node.data = { guideId: clip(data.guideId, 60), nodeId: clip(data.nodeId, 40), label: clip(data.label, LIMITS.title) };
    } else if (type === "end") {
      node.data = { title: clip(data.title, LIMITS.title), guidance: clip(data.guidance, LIMITS.text), outcome: clip(data.outcome, LIMITS.title) };
    }
    nodes.push(node);
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const usedPorts = new Set();
  const edges = [];
  for (const raw of edgesInput) {
    const from = String(raw?.from || "");
    const port = String(raw?.port || "");
    const to = String(raw?.to || "");
    const source = byId.get(from);
    if (!source || !byId.has(to) || to === START_NODE_ID) continue;
    if (!getOutputPorts(source).some((item) => item.id === port)) continue;
    const key = `${from}::${port}`;
    if (usedPorts.has(key)) continue; // uma ligação por saída
    usedPorts.add(key);
    edges.push({ id: clip(raw?.id || `e-${from}-${port}-${to}`, 120), from, port, to });
  }

  const graph = { nodes, edges };
  if (JSON.stringify(graph).length > LIMITS.graphBytes) throw new Error("O guia ficou grande demais.");
  return graph;
}

// ---------------------------------------------------------------------------
// Conformidade do texto (avisos — não bloqueiam a publicação)
// ---------------------------------------------------------------------------

const CLOSER_PATTERNS = [
  /\bme chama\b/i,
  /\bqualquer coisa\b.{0,20}\b(chama|avisa|fala)\b/i,
  /\bfico (no )?aguard/i,
  /\baguardo (o )?(seu )?(retorno|contato)\b/i,
  /\bfico (à|a) disposi/i,
  /\bquando (você |voce )?(quiser|puder)\b.{0,25}\b(chama|fala|avisa|retorna)/i,
  /\bs[óo] me avisar\b/i
];

const PROMISE_PATTERNS = [
  /\bgarant(o|imos|imos|ido|ida|idos|idas|ia)\b/i,
  /\baprova(ção|cao) (é )?(certa|garantida)\b/i,
  /\b100 ?% (aprovad|garantid|seguro)/i,
  /\bsem juros\b/i,
  /\bsem risco\b/i,
  /\bvai (se )?valorizar\b/i,
  /\bl(u|ú)cro (certo|garantido)\b/i,
  /\bcerteza de (aprova|lucro|valoriza)/i
];

export function scanCompliance(text, { allowNegation = true } = {}) {
  const value = String(text || "");
  const found = [];
  for (const pattern of CLOSER_PATTERNS) {
    const match = value.match(pattern);
    if (match) found.push({ kind: "closer", text: match[0] });
  }
  for (const pattern of PROMISE_PATTERNS) {
    const match = value.match(pattern);
    if (!match) continue;
    // "não posso garantir…" é a fala correta — não avisa.
    if (allowNegation) {
      const before = value.slice(Math.max(0, match.index - 24), match.index).toLowerCase();
      if (/\b(não|nao|nunca|sem)\b[^.!?]{0,20}$/.test(before)) continue;
    }
    found.push({ kind: "promise", text: match[0] });
  }
  // Dois padrões podem pegar o mesmo trecho ("me chama" dentro de "qualquer coisa me chama"): fica só o mais completo.
  return found.filter((hit) => !found.some((other) => other !== hit && other.kind === hit.kind && other.text.length > hit.text.length && other.text.toLowerCase().includes(hit.text.toLowerCase())));
}

// ---------------------------------------------------------------------------
// Validação do grafo
// ---------------------------------------------------------------------------

// libraryNodes: Map "guideId::nodeId" -> true (o que existe no Banco de Objeções) — opcional.
export function validateGuideGraph(graph, { libraryNodes = null, isLibrary = false } = {}) {
  const errors = [];
  const warnings = [];
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const start = nodes.find((node) => node.type === "start");

  if (!start) errors.push({ nodeId: null, message: "O guia precisa do bloco de início." });
  // O Banco de Objeções não tem um caminho único: cada objeção é uma entrada própria (card marcado como entrada).
  if (start && !isLibrary && !edges.some((edge) => edge.from === start.id && edge.port === "next")) {
    errors.push({ nodeId: start.id, message: "Ligue o início ao primeiro card." });
  }

  const outgoing = (nodeId, portId) => edges.find((edge) => edge.from === nodeId && edge.port === portId);

  for (const node of nodes) {
    const data = node.data || {};
    if (node.type === "card") {
      if (!String(data.title || "").trim()) errors.push({ nodeId: node.id, message: "Dê um título ao card." });
      const options = optionsOf(node);
      for (const option of options) {
        if (!String(option.label || "").trim()) errors.push({ nodeId: node.id, message: "Há uma resposta sem texto." });
        else if (!outgoing(node.id, option.id)) warnings.push({ nodeId: node.id, message: `A resposta "${option.label}" não leva a nenhum card.` });
      }
      if (!options.length) warnings.push({ nodeId: node.id, message: "Este card não tem próximas respostas — o corretor fica sem caminho. Termine com “Definir retorno” ou “Encerrar”." });
      for (const field of ["message", "argument"]) {
        for (const hit of scanCompliance(data[field])) {
          warnings.push({
            nodeId: node.id,
            message: hit.kind === "closer"
              ? `Evite encerrar com “${hit.text}”: todo atendimento pendente termina com próximo passo + data de retorno.`
              : `Evite promessa/afirmação financeira (“${hit.text}”): não é algo que possamos garantir.`
          });
        }
      }
    }
    if (node.type === "followup") {
      if (!String(data.title || "").trim()) errors.push({ nodeId: node.id, message: "Dê um título ao card de retorno." });
      for (const hit of scanCompliance(data.message)) {
        if (hit.kind === "closer") warnings.push({ nodeId: node.id, message: `Evite encerrar com “${hit.text}”.` });
      }
    }
    if (node.type === "ref") {
      if (!data.guideId || !data.nodeId) errors.push({ nodeId: node.id, message: "Escolha qual objeção do banco este card abre." });
      else if (libraryNodes && !libraryNodes.has(`${data.guideId}::${data.nodeId}`)) errors.push({ nodeId: node.id, message: "A objeção escolhida não existe mais no banco." });
      if (!outgoing(node.id, "next")) warnings.push({ nodeId: node.id, message: "Ligue “Ao voltar do tratamento” ao card que vem depois (ex.: Documentação)." });
    }
    if (node.type === "followup" && !outgoing(node.id, "next")) {
      // Fim natural do atendimento — só um aviso leve no painel.
      warnings.push({ nodeId: node.id, message: "Esta saída termina o atendimento (normal para o retorno final)." });
    }
  }

  // Cards soltos (ninguém chega neles).
  const reachable = new Set();
  const queue = start ? [start.id] : [];
  if (isLibrary) for (const node of nodes) if (node.type === "card" && node.data?.entry) queue.push(node.id);
  while (queue.length) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of edges) if (edge.from === id && byId.has(edge.to)) queue.push(edge.to);
  }
  for (const node of nodes) {
    if (node.type === "start") continue;
    if (!reachable.has(node.id) && !(node.type === "card" && node.data?.entry)) {
      warnings.push({ nodeId: node.id, message: "Este card não está ligado a nenhum caminho." });
    }
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Origem do atendimento -> tipo de guia
// ---------------------------------------------------------------------------

// Regras (dados que o CRM já tem): contato de Prospecção = reativação; anúncio/campanha = lead patrocinado;
// todo o resto (site, link do corretor, cadastro manual, Instagram, indicação, WhatsApp…) = orgânico.
const LEAD_ACQUISITION_KINDS = new Set(["whatsapp_ad", "campaign", "tracked_link", "roulette_link", "meta_ad"]);

export function classifyGuideKind({ prospectingContactId = null, acquisitionKind = "", conversationOriginKind = "" } = {}) {
  if (prospectingContactId) return "prospecting";
  if (conversationOriginKind === "meta_ad" || LEAD_ACQUISITION_KINDS.has(String(acquisitionKind || ""))) return "lead";
  return "organic";
}

// ---------------------------------------------------------------------------
// Texto: [Nome] / [Corretor]
// ---------------------------------------------------------------------------

function firstNameOf(value) {
  const first = String(value || "").trim().split(/\s+/)[0] || "";
  if (!first) return "";
  return first.charAt(0).toLocaleUpperCase("pt-BR") + first.slice(1).toLocaleLowerCase("pt-BR");
}

// Substitui [Nome], [Cliente], [Corretor], [Link] (link de simulação do corretor) e a concordância de gênero de quem
// atende: [o_a] ("o"/"a"/"o(a)") e [cargo_corretor] ("associada do corretor Matheus Machado", "corretora"…) — vêm de
// buildBrokerGenderVars (lib/broker-gender.js). Sem o dado, deixa o marcador para o corretor preencher à mão.
export function fillPlaceholders(text, { clientName = "", brokerName = "", simulationLink = "", brokerVars = null } = {}) {
  const client = firstNameOf(clientName);
  const broker = firstNameOf(brokerName);
  return String(text || "")
    .replace(/\[(nome|cliente)\]/gi, (match) => client || match)
    .replace(/\[corretor\]/gi, (match) => broker || match)
    .replace(/\[link\]/gi, (match) => simulationLink || match)
    .replace(/\[o_a\]/gi, (match) => brokerVars?.o_a || match)
    .replace(/\[cargo_corretor\]/gi, (match) => brokerVars?.cargo_corretor || match);
}

// Marcadores que ficaram sem preencher (ex.: cliente sem nome) — o corretor precisa completar antes de enviar.
export function findUnresolvedPlaceholders(text) {
  const found = String(text || "").match(/\[(nome|cliente|corretor|link|o_a|cargo_corretor)\]/gi) || [];
  return [...new Set(found.map((item) => item.toLowerCase()))];
}

// ---------------------------------------------------------------------------
// Andador da árvore de decisão
// ---------------------------------------------------------------------------

const MAX_HOPS = 12;
const MAX_PATH = 80;

function findNode(graph, nodeId) {
  return (graph?.nodes || []).find((node) => node.id === nodeId) || null;
}

function edgeFrom(graph, nodeId, portId) {
  return (graph?.edges || []).find((edge) => edge.from === nodeId && edge.port === portId) || null;
}

// Cards "invisíveis" (start, ref, return) são atravessados sozinhos: o corretor só vê card/followup/end.
function settle(graphs, guideId, nodeId, stack) {
  let currentGuide = guideId;
  let currentNode = nodeId;
  let currentStack = stack;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const graph = graphs.get(currentGuide);
    const node = findNode(graph, currentNode);
    if (!node) return null;
    if (node.type === "card" || node.type === "followup" || node.type === "end") {
      return { guideId: currentGuide, nodeId: currentNode, stack: currentStack };
    }
    if (node.type === "start") {
      const edge = edgeFrom(graph, node.id, "next");
      if (!edge) return null;
      currentNode = edge.to;
      continue;
    }
    if (node.type === "ref") {
      const targetGuide = node.data?.guideId;
      const targetNode = node.data?.nodeId;
      if (!targetGuide || !targetNode || !graphs.get(targetGuide)) return null;
      currentStack = [...currentStack, { guideId: currentGuide, nodeId: node.id }];
      currentGuide = targetGuide;
      currentNode = targetNode;
      continue;
    }
    if (node.type === "return") {
      if (!currentStack.length) return null;
      const resume = currentStack[currentStack.length - 1];
      currentStack = currentStack.slice(0, -1);
      const callerGraph = graphs.get(resume.guideId);
      const edge = edgeFrom(callerGraph, resume.nodeId, "next");
      if (!edge) return null;
      currentGuide = resume.guideId;
      currentNode = edge.to;
      continue;
    }
    return null;
  }
  return null;
}

// Primeiro card visível de um guia.
export function startState(graphs, guideId) {
  const settled = settle(graphs, guideId, START_NODE_ID, []);
  return settled ? { ...settled, path: [] } : null;
}

// Responde uma opção do card atual. Devolve o novo estado (ou o mesmo, se a opção não leva a lugar nenhum).
export function advance(state, graphs, portId) {
  const graph = graphs.get(state.guideId);
  const node = findNode(graph, state.nodeId);
  if (!node) return state;
  const edge = edgeFrom(graph, node.id, portId);
  if (!edge) return state;
  const settled = settle(graphs, state.guideId, edge.to, state.stack || []);
  if (!settled) return state;
  const label = getOutputPorts(node).find((port) => port.id === portId)?.label || "";
  const entry = { guideId: state.guideId, nodeId: state.nodeId, stack: state.stack || [], label };
  return { ...settled, path: [...(state.path || []), entry].slice(-MAX_PATH) };
}

export function goBack(state) {
  const path = state.path || [];
  const previous = path[path.length - 1];
  if (!previous) return state;
  return { guideId: previous.guideId, nodeId: previous.nodeId, stack: previous.stack || [], path: path.slice(0, -1) };
}

// Estado vindo do banco: garante que ainda aponta para um card que existe (o guia pode ter sido republicado).
export function restoreState(saved, graphs, fallbackGuideId) {
  if (saved && graphs.get(saved.guideId)) {
    const node = findNode(graphs.get(saved.guideId), saved.nodeId);
    if (node && ["card", "followup", "end"].includes(node.type)) {
      const stack = (Array.isArray(saved.stack) ? saved.stack : []).filter((item) => graphs.get(item?.guideId) && findNode(graphs.get(item.guideId), item.nodeId));
      const path = (Array.isArray(saved.path) ? saved.path : []).filter((item) => graphs.get(item?.guideId) && findNode(graphs.get(item.guideId), item.nodeId));
      return { guideId: saved.guideId, nodeId: saved.nodeId, stack, path: path.slice(-MAX_PATH) };
    }
  }
  return fallbackGuideId ? startState(graphs, fallbackGuideId) : null;
}

// Entradas do Banco de Objeções (cards marcados como entrada) — usadas pelo editor para escolher o destino de um "ref".
export function libraryEntries(guideId, graph) {
  return (graph?.nodes || [])
    .filter((node) => node.type === "card" && node.data?.entry)
    .map((node) => ({ guideId, nodeId: node.id, title: node.data?.title || "Objeção" }));
}

// Organiza em colunas por profundidade (mesma ideia do autoArrange dos Fluxos, com a geometria do guia).
export function computeDepths(graph) {
  const nodes = graph.nodes || [];
  const depth = new Map();
  const start = nodes.find((node) => node.type === "start");
  const roots = [start?.id, ...nodes.filter((node) => node.type === "card" && node.data?.entry).map((node) => node.id)].filter(Boolean);
  const queue = [];
  for (const root of roots) {
    depth.set(root, 0);
    queue.push(root);
  }
  while (queue.length) {
    const id = queue.shift();
    for (const edge of graph.edges || []) {
      if (edge.from === id && !depth.has(edge.to)) {
        depth.set(edge.to, depth.get(id) + 1);
        queue.push(edge.to);
      }
    }
  }
  return depth;
}
