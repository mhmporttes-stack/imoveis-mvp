import { MessageSquare, HelpCircle, Zap, GitBranch, Clock, Play } from "lucide-react";
import { getOutputPorts } from "@/lib/whatsapp-flow-core.mjs";

// Metadados visuais e geometria dos blocos do editor de Fluxos. A geometria é
// DETERMINÍSTICA (alturas fixas por tipo) para que as linhas das ligações
// saibam onde ficam as portas sem medir o DOM.

export const NODE_W = 264;
export const HEADER_H = 40;
export const ROW_H = 30;
export const FOOT_PAD = 8;

export const NODE_META = {
  start: { label: "Gatilho", icon: Play, tone: "emerald", hint: "O que inicia o fluxo" },
  message: { label: "Mensagem", icon: MessageSquare, tone: "blue", hint: "Texto, botões, lista ou link" },
  input: { label: "Pergunta", icon: HelpCircle, tone: "violet", hint: "Pergunta e guarda a resposta" },
  action: { label: "Ação", icon: Zap, tone: "amber", hint: "Roleta, etiqueta, passar para atendente" },
  condition: { label: "Condição", icon: GitBranch, tone: "cyan", hint: "Horário comercial, já é cliente…" },
  delay: { label: "Espera", icon: Clock, tone: "slate", hint: "Aguarda um tempo e continua" }
};

export const TONES = {
  emerald: { bar: "bg-emerald-500", soft: "bg-emerald-50 text-emerald-700", ring: "ring-emerald-400" },
  blue: { bar: "bg-blue-500", soft: "bg-blue-50 text-blue-700", ring: "ring-blue-400" },
  violet: { bar: "bg-violet-500", soft: "bg-violet-50 text-violet-700", ring: "ring-violet-400" },
  amber: { bar: "bg-amber-500", soft: "bg-amber-50 text-amber-700", ring: "ring-amber-400" },
  cyan: { bar: "bg-cyan-500", soft: "bg-cyan-50 text-cyan-700", ring: "ring-cyan-400" },
  slate: { bar: "bg-slate-500", soft: "bg-slate-100 text-slate-700", ring: "ring-slate-400" }
};

export const ACTION_LABELS = {
  roulette: "Encaminhar para a roleta (cria o cliente)",
  tag: "Aplicar etiqueta no cliente",
  handoff: "Passar para um atendente",
  finish: "Marcar conversa como finalizada",
  stop: "Encerrar o fluxo"
};

export const CONDITION_LABELS = {
  business_hours: "Está no horário comercial?",
  is_client: "Já é cliente cadastrado?",
  has_broker: "Cliente já tem corretor?",
  ad_origin: "Veio de um anúncio?"
};

export const TRIGGER_LABELS = {
  keyword: "Palavra-chave",
  first_message: "Primeira mensagem do contato",
  ad_referral: "Conversa iniciada por anúncio",
  any_message: "Qualquer mensagem"
};

export function bodyHeight(node) {
  switch (node.type) {
    case "start": return 64;
    case "message": return 78;
    case "input": return 64;
    case "action": return 20 + 22 * Math.max(1, (node.data?.actions || []).length);
    case "condition": return 44;
    case "delay": return 40;
    default: return 48;
  }
}

export function nodeHeight(node) {
  return HEADER_H + bodyHeight(node) + getOutputPorts(node).length * ROW_H + FOOT_PAD;
}

export function portPosition(node, portId) {
  const ports = getOutputPorts(node);
  const index = Math.max(0, ports.findIndex((port) => port.id === portId));
  return { x: node.x + NODE_W, y: node.y + HEADER_H + bodyHeight(node) + index * ROW_H + ROW_H / 2 };
}

export function inputPosition(node) {
  return { x: node.x, y: node.y + HEADER_H / 2 };
}

export function edgePath(from, to) {
  const dx = Math.max(60, Math.abs(to.x - from.x) * 0.5);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

export function triggerSummary(trigger) {
  if (!trigger) return "Sem gatilho";
  if (trigger.type === "keyword") {
    const words = (trigger.keywords || []).filter(Boolean);
    return words.length ? `Palavra-chave: ${words.slice(0, 3).join(", ")}${words.length > 3 ? "…" : ""}` : "Palavra-chave (defina)";
  }
  return TRIGGER_LABELS[trigger.type] || "Sem gatilho";
}

export function nodeSummary(node) {
  const data = node.data || {};
  switch (node.type) {
    case "start":
      return "";
    case "message":
      return data.text || "Toque para escrever a mensagem…";
    case "input":
      return data.text || "Toque para escrever a pergunta…";
    case "action":
      return (data.actions || []).map((action) => (action.type === "tag" ? `Etiqueta: ${action.tag || "?"}` : ACTION_LABELS[action.type] || action.type));
    case "condition":
      return CONDITION_LABELS[data.kind] || "Escolha a condição";
    case "delay":
      return `Esperar ${data.amount || 0} ${data.unit === "hours" ? "hora(s)" : "minuto(s)"}`;
    default:
      return "";
  }
}

export function messageModeLabel(mode) {
  return { text: "Texto", buttons: "Botões", list: "Lista", link: "Link" }[mode] || "Mensagem";
}

// Ordem de leitura (largura a partir do gatilho) + blocos soltos no fim.
export function orderNodes(graph) {
  const nodes = graph.nodes || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const order = [];
  const seen = new Set();
  const queue = nodes.filter((node) => node.type === "start").map((node) => node.id);
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    order.push(byId.get(id));
    const node = byId.get(id);
    for (const port of getOutputPorts(node)) {
      const edge = (graph.edges || []).find((item) => item.from === id && item.port === port.id);
      if (edge) queue.push(edge.to);
    }
  }
  for (const node of nodes) if (!seen.has(node.id)) order.push(node);
  return order;
}

// Organiza em colunas por profundidade a partir do gatilho.
export function autoArrange(graph) {
  const nodes = graph.nodes || [];
  const depth = new Map();
  const start = nodes.find((node) => node.type === "start");
  if (start) {
    depth.set(start.id, 0);
    const queue = [start.id];
    while (queue.length) {
      const id = queue.shift();
      const node = nodes.find((item) => item.id === id);
      for (const port of getOutputPorts(node)) {
        const edge = (graph.edges || []).find((item) => item.from === id && item.port === port.id);
        if (edge && !depth.has(edge.to)) {
          depth.set(edge.to, depth.get(id) + 1);
          queue.push(edge.to);
        }
      }
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  const columns = new Map();
  for (const node of nodes) {
    const column = depth.has(node.id) ? depth.get(node.id) : maxDepth + 1;
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column).push(node);
  }
  const positioned = new Map();
  for (const [column, list] of columns) {
    let y = 40;
    for (const node of list) {
      positioned.set(node.id, { x: 40 + column * (NODE_W + 100), y });
      y += nodeHeight(node) + 36;
    }
  }
  return { ...graph, nodes: nodes.map((node) => ({ ...node, ...positioned.get(node.id) })) };
}
