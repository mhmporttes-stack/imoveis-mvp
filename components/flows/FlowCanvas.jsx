"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { LayoutGrid, Maximize2, Plus, ZoomIn, ZoomOut } from "lucide-react";
import { getOutputPorts } from "@/lib/whatsapp-flow-core.mjs";
import {
  HEADER_H,
  NODE_META,
  NODE_W,
  ROW_H,
  TONES,
  autoArrange,
  bodyHeight,
  edgePath,
  inputPosition,
  messageModeLabel,
  nodeHeight,
  nodeSummary,
  portPosition,
  triggerSummary
} from "@/components/flows/flow-ui";

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.6;
const ADDABLE = ["message", "input", "action", "condition", "delay"];

// O canvas é COMPARTILHADO: tudo que depende do tipo de bloco (portas, geometria, aparência, menu "Adicionar")
// vem de um "adapter". O padrão abaixo é o dos Fluxos do WhatsApp e não mudou; o Guia de Atendimento
// (components/guide) passa o seu.
export const FLOW_ADAPTER = {
  getPorts: getOutputPorts,
  nodeHeight,
  bodyHeight,
  portPosition,
  inputPosition,
  autoArrange,
  meta: NODE_META,
  addable: ADDABLE,
  addTitle: "Adicionar bloco",
  emptyHint: "Ligue o gatilho ao primeiro bloco: arraste a bolinha \"Então\" até um espaço vazio, ou clique em + para adicionar.",
  headerLabel: (node, meta) => `${meta.label}${node.type === "message" ? ` · ${messageModeLabel(node.data?.mode)}` : ""}`,
  renderBody: (node, trigger) => {
    const summary = nodeSummary(node);
    if (node.type === "start") return <p className="line-clamp-3 text-[13px] font-bold leading-5 text-navy">{triggerSummary(trigger)}</p>;
    if (Array.isArray(summary)) return summary.slice(0, 5).map((line, index) => <p key={index} className="truncate text-[12px] font-bold leading-[22px] text-navy">• {line}</p>);
    return <p className="line-clamp-3 whitespace-pre-line text-[13px] font-semibold leading-5 text-slate">{summary}</p>;
  }
};

// Canvas do editor de Fluxos: blocos arrastáveis sobre um fundo quadriculado,
// ligados por linhas curvas (uma por saída), zoom/pan, auto-organizar. Sem
// biblioteca externa — a geometria é fixa por tipo de bloco (flow-ui.js).
const FlowCanvas = forwardRef(function FlowCanvas(
  { graph, trigger, selectedId, issuesByNode, onSelect, onGraphChange, onAddNode, adapter = FLOW_ADAPTER },
  ref
) {
  const containerRef = useRef(null);
  const [view, setView] = useState({ x: 24, y: 24, z: 1 });
  const [connecting, setConnecting] = useState(null); // { from, port, start:{x,y}, cursor:{x,y} }
  const [menu, setMenu] = useState(null); // { sx, sy, gx, gy, connectFrom }
  const [hoverEdge, setHoverEdge] = useState("");

  const graphRef = useRef(graph);
  const viewRef = useRef(view);
  graphRef.current = graph;
  viewRef.current = view;

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  const toGraph = useCallback((clientX, clientY) => {
    const rect = containerRef.current.getBoundingClientRect();
    const current = viewRef.current;
    return { x: (clientX - rect.left - current.x) / current.z, y: (clientY - rect.top - current.y) / current.z };
  }, []);

  const fit = useCallback(() => {
    const container = containerRef.current;
    const nodes = graphRef.current.nodes;
    if (!container || !nodes.length) return;
    const minX = Math.min(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxX = Math.max(...nodes.map((node) => node.x + NODE_W));
    const maxY = Math.max(...nodes.map((node) => node.y + adapter.nodeHeight(node)));
    const width = container.clientWidth;
    const height = container.clientHeight;
    const z = Math.min(1, Math.max(MIN_ZOOM, Math.min((width - 80) / (maxX - minX), (height - 80) / (maxY - minY))));
    setView({ z, x: (width - (maxX - minX) * z) / 2 - minX * z, y: Math.max(24, (height - (maxY - minY) * z) / 2 - minY * z) });
  }, [adapter]);

  const zoomBy = useCallback((factor, center) => {
    setView((current) => {
      const container = containerRef.current;
      const cx = center?.x ?? (container ? container.clientWidth / 2 : 0);
      const cy = center?.y ?? (container ? container.clientHeight / 2 : 0);
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.z * factor));
      const ratio = z / current.z;
      return { z, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
    });
  }, []);

  useImperativeHandle(ref, () => ({ fit, centerOn: (x, y) => {
    const container = containerRef.current;
    if (!container) return;
    setView((current) => ({ ...current, x: container.clientWidth / 2 - x * current.z, y: container.clientHeight / 2 - y * current.z }));
  } }), [fit]);

  useEffect(() => {
    fit();
    // Só ajusta a visão na abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Roda do mouse: Ctrl/Cmd + roda = zoom; roda sozinha = mover a tela.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    function onWheel(event) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, { x: event.clientX - rect.left, y: event.clientY - rect.top });
      } else {
        setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
      }
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  // --- mover a tela (arrastar o fundo) ---
  function onBackgroundPointerDown(event) {
    if (event.button !== 0 || event.target.closest("[data-flow-node]") || event.target.closest("[data-flow-ui]")) return;
    setMenu(null);
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...viewRef.current };
    let moved = false;
    function move(moveEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      setView({ ...origin, x: origin.x + dx, y: origin.y + dy });
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) onSelect(null);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // --- arrastar um bloco ---
  function onNodePointerDown(event, node) {
    if (event.button !== 0) return;
    event.stopPropagation();
    setMenu(null);
    onSelect(node.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: node.x, y: node.y };
    let started = false;
    function move(moveEvent) {
      const dx = (moveEvent.clientX - startX) / viewRef.current.z;
      const dy = (moveEvent.clientY - startY) / viewRef.current.z;
      if (!started) {
        if (Math.abs(dx) + Math.abs(dy) < 3) return;
        started = true;
        // Guarda o estado anterior no histórico (desfazer) e depois move sem histórico.
        onGraphChange(graphRef.current, { history: true, key: `move-${node.id}-${startX}-${startY}` });
      }
      onGraphChange({
        ...graphRef.current,
        nodes: graphRef.current.nodes.map((item) => (item.id === node.id ? { ...item, x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) } : item))
      }, { history: false });
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // --- ligar: arrastar de uma saída até outro bloco ---
  function onPortPointerDown(event, node, portId) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    setMenu(null);
    const start = adapter.portPosition(node, portId);
    setConnecting({ from: node.id, port: portId, start, cursor: start });
    function move(moveEvent) {
      setConnecting((current) => (current ? { ...current, cursor: toGraph(moveEvent.clientX, moveEvent.clientY) } : current));
    }
    function up(upEvent) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setConnecting(null);
      const targetElement = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
      const dropNode = targetElement?.closest("[data-flow-node]");
      const targetId = dropNode?.getAttribute("data-flow-node");
      if (targetId && targetId !== node.id && targetId !== "start") {
        connect(node.id, portId, targetId);
      } else if (!targetId && targetElement?.closest("[data-flow-canvas]")) {
        const rect = containerRef.current.getBoundingClientRect();
        const point = toGraph(upEvent.clientX, upEvent.clientY);
        setMenu({ sx: upEvent.clientX - rect.left, sy: upEvent.clientY - rect.top, gx: point.x, gy: point.y - 20, connectFrom: { nodeId: node.id, port: portId } });
      }
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function connect(from, port, to) {
    const current = graphRef.current;
    const edges = current.edges.filter((edge) => !(edge.from === from && edge.port === port));
    edges.push({ id: `e-${from}-${port}-${to}`, from, port, to });
    onGraphChange({ ...current, edges }, { history: true });
  }

  function removeEdge(edgeId) {
    onGraphChange({ ...graphRef.current, edges: graphRef.current.edges.filter((edge) => edge.id !== edgeId) }, { history: true });
    setHoverEdge("");
  }

  function openMenuAt(event) {
    if (event.target.closest("[data-flow-node]") || event.target.closest("[data-flow-ui]")) return;
    const rect = containerRef.current.getBoundingClientRect();
    const point = toGraph(event.clientX, event.clientY);
    setMenu({ sx: event.clientX - rect.left, sy: event.clientY - rect.top, gx: point.x, gy: point.y, connectFrom: null });
  }

  function openMenuFromButton() {
    const container = containerRef.current;
    const center = toGraph(container.getBoundingClientRect().left + container.clientWidth / 2, container.getBoundingClientRect().top + container.clientHeight / 2);
    setMenu({ sx: container.clientWidth - 260, sy: 60, gx: center.x - NODE_W / 2, gy: center.y - 60, connectFrom: null });
  }

  function chooseNodeType(type) {
    onAddNode(type, { x: menu.gx, y: menu.gy }, menu.connectFrom);
    setMenu(null);
  }

  return (
    <div
      ref={containerRef}
      data-flow-canvas
      className="relative h-full w-full touch-none select-none overflow-hidden rounded-2xl border border-line bg-[#f4f6fa]"
      style={{ backgroundImage: "radial-gradient(#cfd6e2 1px, transparent 1px)", backgroundSize: `${20 * view.z}px ${20 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      onPointerDown={onBackgroundPointerDown}
      onDoubleClick={openMenuAt}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
          <defs>
            <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#8a97ad" />
            </marker>
          </defs>
          {graph.edges.map((edge) => {
            const from = nodesById.get(edge.from);
            const to = nodesById.get(edge.to);
            if (!from || !to) return null;
            const a = adapter.portPosition(from, edge.port);
            const b = adapter.inputPosition(to);
            const hovered = hoverEdge === edge.id;
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            return (
              <g key={edge.id}>
                <path d={edgePath(a, b)} fill="none" stroke={hovered ? "#0d3b66" : "#8a97ad"} strokeWidth={hovered ? 2.5 : 2} markerEnd="url(#flow-arrow)" />
                <path
                  d={edgePath(a, b)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="16"
                  style={{ pointerEvents: "stroke", cursor: "pointer" }}
                  onPointerEnter={() => setHoverEdge(edge.id)}
                  onPointerLeave={() => setHoverEdge((current) => (current === edge.id ? "" : current))}
                />
                {hovered ? (
                  <g
                    data-flow-ui
                    style={{ pointerEvents: "all", cursor: "pointer" }}
                    onPointerEnter={() => setHoverEdge(edge.id)}
                    onPointerDown={(event) => { event.stopPropagation(); removeEdge(edge.id); }}
                  >
                    <circle cx={mid.x} cy={mid.y} r="11" fill="#ffffff" stroke="#dc2626" strokeWidth="1.5" />
                    <path d={`M ${mid.x - 4} ${mid.y - 4} L ${mid.x + 4} ${mid.y + 4} M ${mid.x + 4} ${mid.y - 4} L ${mid.x - 4} ${mid.y + 4}`} stroke="#dc2626" strokeWidth="2" strokeLinecap="round" />
                  </g>
                ) : null}
              </g>
            );
          })}
          {connecting ? <path d={edgePath(connecting.start, connecting.cursor)} fill="none" stroke="#2563eb" strokeWidth="2" strokeDasharray="6 4" /> : null}
        </svg>

        {graph.nodes.map((node) => (
          <NodeCard
            key={node.id}
            adapter={adapter}
            node={node}
            trigger={trigger}
            selected={selectedId === node.id}
            issues={issuesByNode.get(node.id)}
            edges={graph.edges}
            connectingActive={Boolean(connecting) && connecting.from !== node.id && node.type !== "start"}
            onPointerDown={(event) => onNodePointerDown(event, node)}
            onPortPointerDown={(event, portId) => onPortPointerDown(event, node, portId)}
          />
        ))}
      </div>

      {!graph.nodes.some((node) => node.type !== "start") ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 text-center text-sm font-bold text-muted">
          {adapter.emptyHint}
        </div>
      ) : null}

      <div data-flow-ui className="absolute right-3 top-3 z-10 flex flex-col gap-2">
        <ControlButton primary label={adapter.addTitle} onClick={openMenuFromButton}><Plus className="h-5 w-5" /></ControlButton>
        <ControlButton label="Aproximar" onClick={() => zoomBy(1.2)}><ZoomIn className="h-4 w-4" /></ControlButton>
        <ControlButton label="Afastar" onClick={() => zoomBy(1 / 1.2)}><ZoomOut className="h-4 w-4" /></ControlButton>
        <ControlButton label="Ajustar à tela" onClick={fit}><Maximize2 className="h-4 w-4" /></ControlButton>
        <ControlButton label="Organizar blocos" onClick={() => { onGraphChange(adapter.autoArrange(graphRef.current), { history: true }); setTimeout(fit, 30); }}><LayoutGrid className="h-4 w-4" /></ControlButton>
      </div>

      {menu ? (
        <div
          data-flow-ui
          className="absolute z-20 w-64 rounded-2xl border border-line bg-white p-2 shadow-soft"
          style={{ left: Math.min(menu.sx, (containerRef.current?.clientWidth || 600) - 270), top: Math.min(menu.sy, (containerRef.current?.clientHeight || 400) - 300) }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <p className="px-2 pb-1 pt-1 text-[11px] font-black uppercase tracking-wider text-muted">{adapter.addTitle}</p>
          {adapter.addable.map((type) => {
            const meta = adapter.meta[type];
            const Icon = meta.icon;
            return (
              <button key={type} type="button" onClick={() => chooseNodeType(type)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-mist">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TONES[meta.tone].soft}`}><Icon className="h-4 w-4" /></span>
                <span>
                  <span className="block text-sm font-black text-navy">{meta.label}</span>
                  <span className="block text-xs font-semibold text-muted">{meta.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});

export default FlowCanvas;

function ControlButton({ children, label, onClick, primary = false }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      className={`flex h-10 w-10 items-center justify-center rounded-full shadow-soft transition ${primary ? "bg-brand text-white hover:bg-navy" : "border border-line bg-white text-navy hover:bg-mist"}`}
    >
      {children}
    </button>
  );
}

function NodeCard({ adapter, node, trigger, selected, issues, edges, connectingActive, onPointerDown, onPortPointerDown }) {
  const meta = adapter.meta[node.type] || adapter.meta.message;
  const tone = TONES[meta.tone];
  const Icon = meta.icon;
  const ports = adapter.getPorts(node);
  const body = adapter.bodyHeight(node);
  const height = adapter.nodeHeight(node);
  const errorCount = issues?.errors || 0;
  const warningCount = issues?.warnings || 0;

  return (
    <div
      data-flow-node={node.id}
      className={`absolute rounded-2xl border bg-white shadow-soft transition-shadow ${selected ? `border-transparent ring-2 ${tone.ring}` : "border-line"} ${connectingActive ? "ring-2 ring-blue-300" : ""}`}
      style={{ left: node.x, top: node.y, width: NODE_W, height }}
      onPointerDown={onPointerDown}
    >
      <span className="absolute -left-[7px] top-[13px] h-3.5 w-3.5 rounded-full border-2 border-white bg-slate-400 shadow" aria-hidden="true" />
      <div className={`flex cursor-grab items-center gap-2 rounded-t-2xl px-3 active:cursor-grabbing ${tone.soft}`} style={{ height: HEADER_H }}>
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate text-[13px] font-black">{adapter.headerLabel(node, meta)}</span>
        {errorCount ? <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" title={`${errorCount} pendência(s)`} /> : warningCount ? <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" title="Atenção" /> : null}
      </div>

      <div className="overflow-hidden px-3 py-2" style={{ height: body }}>
        {adapter.renderBody(node, trigger)}
      </div>

      <div>
        {ports.map((port) => {
          const connected = edges.some((edge) => edge.from === node.id && edge.port === port.id);
          return (
            <div key={port.id} className="relative flex items-center justify-end border-t border-line/60 pr-4" style={{ height: ROW_H }}>
              <span className="mr-2 max-w-[190px] truncate text-[12px] font-bold text-navy">{port.label}</span>
              <button
                type="button"
                data-flow-ui
                title="Arraste até um bloco para ligar"
                aria-label={`Ligar saída ${port.label}`}
                onPointerDown={(event) => onPortPointerDown(event, port.id)}
                className={`absolute -right-[8px] h-4 w-4 cursor-crosshair rounded-full border-2 border-white shadow transition hover:scale-125 ${connected ? "bg-brand" : "bg-slate-300 hover:bg-blue-400"}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
