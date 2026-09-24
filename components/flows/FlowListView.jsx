"use client";

import { Plus } from "lucide-react";
import { getOutputPorts } from "@/lib/whatsapp-flow-core.mjs";
import { NODE_META, TONES, messageModeLabel, nodeSummary, orderNodes, triggerSummary } from "@/components/flows/flow-ui";

const NEW_TYPES = ["message", "input", "action", "condition", "delay"];

function shortSummary(node, trigger) {
  if (node.type === "start") return triggerSummary(trigger);
  const summary = nodeSummary(node);
  const text = Array.isArray(summary) ? summary.join(", ") : summary;
  return text.length > 46 ? `${text.slice(0, 46)}…` : text;
}

// Visão em lista do mesmo fluxo (celular / quem prefere lista): cada bloco
// mostra suas saídas com um seletor de "ligar a…". Edita o MESMO grafo do mapa.
export default function FlowListView({ graph, trigger, selectedId, issuesByNode, onSelect, onConnect, onAddNode }) {
  const ordered = orderNodes(graph);
  const indexOf = new Map(ordered.map((node, index) => [node.id, index + 1]));

  function handleTarget(node, portId, value) {
    if (value.startsWith("new:")) {
      const type = value.slice(4);
      const maxY = Math.max(...graph.nodes.map((item) => item.y), 0);
      onAddNode(type, { x: node.x + 340, y: maxY + 160 }, { nodeId: node.id, port: portId });
      return;
    }
    onConnect(node.id, portId, value || null);
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto pr-1">
      {ordered.map((node) => {
        const meta = NODE_META[node.type];
        const tone = TONES[meta.tone];
        const Icon = meta.icon;
        const issues = issuesByNode.get(node.id);
        const ports = getOutputPorts(node);
        return (
          <div key={node.id} className={`rounded-2xl border bg-white shadow-soft ${selectedId === node.id ? "border-brand ring-2 ring-brand/30" : "border-line"}`}>
            <button type="button" onClick={() => onSelect(node.id)} className={`flex w-full items-center gap-3 rounded-t-2xl px-3 py-2.5 text-left ${tone.soft}`}>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/70 text-[11px] font-black">{indexOf.get(node.id)}</span>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate text-sm font-black">{meta.label}{node.type === "message" ? ` · ${messageModeLabel(node.data?.mode)}` : ""}</span>
              {issues?.errors ? <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> : issues?.warnings ? <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> : null}
            </button>
            <button type="button" onClick={() => onSelect(node.id)} className="block w-full px-3 py-2 text-left text-[13px] font-semibold text-slate">
              {node.type === "start" ? triggerSummary(trigger) : Array.isArray(nodeSummary(node)) ? nodeSummary(node).join(" · ") : nodeSummary(node)}
            </button>
            <div className="divide-y divide-line/60 border-t border-line/60">
              {ports.map((port) => {
                const edge = graph.edges.find((item) => item.from === node.id && item.port === port.id);
                return (
                  <label key={port.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="w-[42%] shrink-0 truncate text-xs font-black text-navy">{port.label} →</span>
                    <select
                      value={edge?.to || ""}
                      onChange={(event) => handleTarget(node, port.id, event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-line bg-white p-2 text-xs font-semibold text-navy"
                    >
                      <option value="">— o fluxo termina aqui —</option>
                      <optgroup label="Ligar a um bloco">
                        {ordered.filter((other) => other.id !== node.id && other.type !== "start").map((other) => (
                          <option key={other.id} value={other.id}>{indexOf.get(other.id)}. {NODE_META[other.type].label} — {shortSummary(other, trigger)}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Criar novo bloco">
                        {NEW_TYPES.map((type) => <option key={type} value={`new:${type}`}>+ {NODE_META[type].label}</option>)}
                      </optgroup>
                    </select>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2 pb-2">
        {NEW_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onAddNode(type, { x: 40, y: Math.max(...graph.nodes.map((item) => item.y), 0) + 160 }, null)}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-brand px-3 py-2 text-xs font-black text-brand hover:bg-brand/5"
          >
            <Plus className="h-3.5 w-3.5" />{NODE_META[type].label}
          </button>
        ))}
      </div>
    </div>
  );
}
