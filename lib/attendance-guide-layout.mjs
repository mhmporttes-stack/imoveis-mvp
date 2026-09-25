// Geometria do mapa do Guia de Atendimento. As constantes são as MESMAS do editor de Fluxos
// (components/flows/flow-ui.js) — o canvas é compartilhado — e as alturas são determinísticas por tipo
// de card, para que as linhas das ligações saibam onde ficam as portas sem medir o DOM.
import { computeDepths, getOutputPorts } from "./attendance-guide-core.mjs";

export const NODE_W = 264;
export const HEADER_H = 40;
export const ROW_H = 30;
export const FOOT_PAD = 8;

export function guideBodyHeight(node) {
  switch (node.type) {
    case "start": return 44;
    case "card": return 78;
    case "followup": return 64;
    case "ref": return 56;
    case "end": return 56;
    case "return": return 44;
    default: return 48;
  }
}

export function guideNodeHeight(node) {
  return HEADER_H + guideBodyHeight(node) + getOutputPorts(node).length * ROW_H + FOOT_PAD;
}

export function guidePortPosition(node, portId) {
  const ports = getOutputPorts(node);
  const index = Math.max(0, ports.findIndex((port) => port.id === portId));
  return { x: node.x + NODE_W, y: node.y + HEADER_H + guideBodyHeight(node) + index * ROW_H + ROW_H / 2 };
}

export function guideInputPosition(node) {
  return { x: node.x, y: node.y + HEADER_H / 2 };
}

// Colunas por profundidade a partir do início (e das entradas do Banco de Objeções).
export function autoArrangeGuide(graph) {
  const nodes = graph.nodes || [];
  const depth = computeDepths(graph);
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
      y += guideNodeHeight(node) + 36;
    }
  }
  return { ...graph, nodes: nodes.map((node) => ({ ...node, ...positioned.get(node.id) })) };
}
