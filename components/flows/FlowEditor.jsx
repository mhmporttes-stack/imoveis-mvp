"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CircleAlert, Eye, LayoutList, Loader2, Map as MapIcon, Pause, Play, Redo2, Undo2, Zap } from "lucide-react";
import FlowCanvas from "@/components/flows/FlowCanvas";
import FlowListView from "@/components/flows/FlowListView";
import FlowNodePanel from "@/components/flows/FlowNodePanel";
import FlowPreview from "@/components/flows/FlowPreview";
import { NODE_META, TONES } from "@/components/flows/flow-ui";
import { defaultNodeData, getOutputPorts, newId, validateGraph, validateTrigger } from "@/lib/whatsapp-flow-core.mjs";

const HISTORY_LIMIT = 60;
const AUTOSAVE_MS = 1000;

function cleanEdges(graph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = graph.edges.filter((edge) => {
    const from = byId.get(edge.from);
    if (!from || !byId.has(edge.to)) return false;
    return getOutputPorts(from).some((port) => port.id === edge.port);
  });
  return edges.length === graph.edges.length ? graph : { ...graph, edges };
}

export default function FlowEditor({ initialFlow }) {
  const [flow, setFlow] = useState(initialFlow);
  const [name, setName] = useState(initialFlow.name);
  const [trigger, setTrigger] = useState(initialFlow.trigger);
  const [graph, setGraph] = useState(initialFlow.graph);
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState("map");
  const [saveState, setSaveState] = useState("saved"); // saved | dirty | saving | error
  const [saveError, setSaveError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState(null); // { kind: "ok"|"error", text, details }
  const [showPreview, setShowPreview] = useState(false);
  // Histórico em refs (o updater do setState precisa ser puro); histVersion só
  // força a releitura dos botões desfazer/refazer.
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const [, setHistVersion] = useState(0);

  const canvasRef = useRef(null);
  const stateRef = useRef({ name, trigger, graph });
  stateRef.current = { name, trigger, graph };
  const lastHistoryKey = useRef({ key: "", at: 0 });
  const saveTimer = useRef(null);
  const saving = useRef(false);
  const pendingSave = useRef(false);
  const mounted = useRef(false);

  // Começa na lista em telas pequenas (o mapa é para o computador).
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setView("list");
  }, []);

  // ---------------- salvar (rascunho, automático) ----------------
  const flushSave = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (saving.current) {
      pendingSave.current = true;
      return;
    }
    saving.current = true;
    setSaveState("saving");
    try {
      const { name: currentName, trigger: currentTrigger, graph: currentGraph } = stateRef.current;
      const response = await fetch(`/api/admin/whatsapp-flows/${initialFlow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: currentName, trigger: currentTrigger, graph: currentGraph })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      setFlow(data.flow);
      setSaveError("");
      setSaveState(pendingSave.current ? "dirty" : "saved");
    } catch (error) {
      setSaveError(error.message);
      setSaveState("error");
    } finally {
      saving.current = false;
      if (pendingSave.current) {
        pendingSave.current = false;
        flushSave();
      }
    }
  }, [initialFlow.id]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return undefined;
    }
    setSaveState((current) => (current === "saving" ? current : "dirty"));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, AUTOSAVE_MS);
    return () => clearTimeout(saveTimer.current);
  }, [name, trigger, graph, flushSave]);

  useEffect(() => {
    function beforeUnload(event) {
      if (saveState === "dirty" || saveState === "saving") {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveState]);

  // ---------------- histórico (desfazer/refazer) ----------------
  const snapshotNow = () => ({ trigger: stateRef.current.trigger, graph: stateRef.current.graph });

  const pushHistory = useCallback((key) => {
    const now = Date.now();
    // Digitar num campo gera muitas mudanças seguidas: junta em um passo só.
    if (key && lastHistoryKey.current.key === key && now - lastHistoryKey.current.at < 900) {
      lastHistoryKey.current.at = now;
      return;
    }
    lastHistoryKey.current = { key: key || "", at: now };
    pastRef.current = [...pastRef.current.slice(-(HISTORY_LIMIT - 1)), snapshotNow()];
    futureRef.current = [];
    setHistVersion((value) => value + 1);
  }, []);

  const undo = useCallback(() => {
    const previous = pastRef.current[pastRef.current.length - 1];
    if (!previous) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, snapshotNow()];
    lastHistoryKey.current = { key: "", at: 0 };
    setTrigger(previous.trigger);
    setGraph(previous.graph);
    setHistVersion((value) => value + 1);
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current[futureRef.current.length - 1];
    if (!next) return;
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, snapshotNow()];
    lastHistoryKey.current = { key: "", at: 0 };
    setTrigger(next.trigger);
    setGraph(next.graph);
    setHistVersion((value) => value + 1);
  }, []);

  const applyGraph = useCallback((next, { history = true, key = "" } = {}) => {
    if (history) pushHistory(key);
    setGraph(cleanEdges(next));
  }, [pushHistory]);

  // ---------------- edição ----------------
  const changeNodeData = useCallback((nodeId, data) => {
    pushHistory(`edit-${nodeId}`);
    setGraph((current) => cleanEdges({ ...current, nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, data } : node)) }));
  }, [pushHistory]);

  const changeTrigger = useCallback((next) => {
    pushHistory("trigger");
    setTrigger(next);
  }, [pushHistory]);

  const addNode = useCallback((type, position, connectFrom) => {
    pushHistory("");
    const node = { id: newId("n"), type, x: Math.round(position.x), y: Math.round(position.y), data: defaultNodeData(type) };
    setGraph((current) => {
      let edges = current.edges;
      if (connectFrom) {
        edges = edges.filter((edge) => !(edge.from === connectFrom.nodeId && edge.port === connectFrom.port));
        edges = [...edges, { id: `e-${connectFrom.nodeId}-${connectFrom.port}-${node.id}`, from: connectFrom.nodeId, port: connectFrom.port, to: node.id }];
      }
      return { nodes: [...current.nodes, node], edges };
    });
    setSelectedId(node.id);
  }, [pushHistory]);

  const connect = useCallback((from, port, to) => {
    pushHistory("");
    setGraph((current) => {
      const edges = current.edges.filter((edge) => !(edge.from === from && edge.port === port));
      if (to) edges.push({ id: `e-${from}-${port}-${to}`, from, port, to });
      return { ...current, edges };
    });
  }, [pushHistory]);

  const deleteNode = useCallback((nodeId) => {
    const node = stateRef.current.graph.nodes.find((item) => item.id === nodeId);
    if (!node || node.type === "start") return;
    pushHistory("");
    setGraph((current) => ({ nodes: current.nodes.filter((item) => item.id !== nodeId), edges: current.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId) }));
    setSelectedId(null);
  }, [pushHistory]);

  const duplicateNode = useCallback((nodeId) => {
    const node = stateRef.current.graph.nodes.find((item) => item.id === nodeId);
    if (!node || node.type === "start") return;
    pushHistory("");
    const data = JSON.parse(JSON.stringify(node.data || {}));
    // Botões/opções ganham ids novos (as ligações não são copiadas).
    if (Array.isArray(data.buttons)) data.buttons = data.buttons.map((button) => ({ ...button, id: newId("b") }));
    if (Array.isArray(data.items)) data.items = data.items.map((item) => ({ ...item, id: newId("i") }));
    const copy = { ...node, id: newId("n"), x: node.x + 40, y: node.y + 60, data };
    setGraph((current) => ({ ...current, nodes: [...current.nodes, copy] }));
    setSelectedId(copy.id);
  }, [pushHistory]);

  // Atalhos: Ctrl+Z / Ctrl+Shift+Z / Delete.
  useEffect(() => {
    function onKeyDown(event) {
      const tag = event.target?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !typing) {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.key === "Delete" || event.key === "Backspace") && !typing && selectedId) {
        event.preventDefault();
        deleteNode(selectedId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, deleteNode, selectedId]);

  // ---------------- validação ----------------
  const validation = useMemo(() => {
    const result = validateGraph(graph);
    const triggerErrors = validateTrigger(trigger);
    const byNode = new Map();
    const bucket = (id) => {
      if (!byNode.has(id)) byNode.set(id, { errors: [], warnings: [] });
      return byNode.get(id);
    };
    for (const error of result.errors) if (error.nodeId) bucket(error.nodeId).errors.push(error.message);
    for (const warning of result.warnings) if (warning.nodeId) bucket(warning.nodeId).warnings.push(warning.message);
    if (triggerErrors.length) {
      const startNode = graph.nodes.find((node) => node.type === "start");
      if (startNode) for (const message of triggerErrors) bucket(startNode.id).errors.push(message);
    }
    const counts = new Map([...byNode].map(([id, value]) => [id, { errors: value.errors.length, warnings: value.warnings.length }]));
    const generalErrors = result.errors.filter((error) => !error.nodeId).map((error) => error.message);
    return { byNode, counts, generalErrors, total: result.errors.length + triggerErrors.length };
  }, [graph, trigger]);

  // ---------------- ativar ----------------
  async function publish() {
    setNotice(null);
    setPublishing(true);
    try {
      clearTimeout(saveTimer.current);
      // Espera qualquer salvamento em andamento e salva o estado mais recente.
      while (saving.current) await new Promise((resolve) => setTimeout(resolve, 150));
      await flushSave();
      while (saving.current) await new Promise((resolve) => setTimeout(resolve, 150));
      const response = await fetch(`/api/admin/whatsapp-flows/${initialFlow.id}/publish`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const first = data.details?.errors?.find((item) => item.nodeId);
        if (first) setSelectedId(first.nodeId);
        setNotice({ kind: "error", text: data.error || "Não foi possível ativar o fluxo.", details: [...(data.details?.trigger || []), ...(data.details?.errors || []).map((item) => item.message)] });
        return;
      }
      setFlow(data.flow);
      setNotice({ kind: "ok", text: flow.status === "active" ? "Fluxo atualizado. As próximas conversas já usam esta versão." : "Fluxo ativado! Ele já responde às mensagens que casarem com o gatilho." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setPublishing(false);
    }
  }

  async function togglePause() {
    setNotice(null);
    const next = flow.status === "active" ? "paused" : "active";
    try {
      const response = await fetch(`/api/admin/whatsapp-flows/${initialFlow.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível alterar o status.");
      setFlow(data.flow);
      setNotice({ kind: "ok", text: next === "paused" ? "Fluxo pausado: novas conversas não o iniciam (as em andamento continuam)." : "Fluxo retomado." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    }
  }

  const selectedNode = graph.nodes.find((node) => node.id === selectedId) || null;
  const statusLabel = flow.status === "active" ? "Ativo" : flow.status === "paused" ? "Pausado" : "Rascunho";
  const statusTone = flow.status === "active" ? "bg-emerald-100 text-emerald-800" : flow.status === "paused" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700";
  const needsPublish = flow.status === "draft" || flow.hasUnpublishedChanges;

  const panel = (
    <FlowNodePanel
      key={selectedNode?.id || "none"}
      node={selectedNode}
      trigger={trigger}
      issues={selectedNode ? validation.byNode.get(selectedNode.id) || { errors: [], warnings: [] } : null}
      onChangeData={(data) => changeNodeData(selectedNode.id, data)}
      onChangeTrigger={changeTrigger}
      onDelete={() => deleteNode(selectedNode.id)}
      onDuplicate={() => duplicateNode(selectedNode.id)}
      onClose={() => setSelectedId(null)}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1640px] px-4">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3 shadow-soft">
        <Link href="/admin/automacoes?tab=flows" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-black text-navy hover:bg-mist"><ArrowLeft className="h-4 w-4" />Fluxos</Link>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          aria-label="Nome do fluxo"
          className="min-w-[160px] flex-1 rounded-lg border border-transparent px-3 py-2 text-base font-black text-navy outline-none hover:border-line focus:border-brand"
        />
        <span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone}`}>{statusLabel}</span>
        {flow.status !== "draft" && flow.hasUnpublishedChanges ? <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">Alterações não publicadas</span> : null}
        <span className="flex items-center gap-1.5 text-xs font-bold text-muted" aria-live="polite">
          {saveState === "saving" || saveState === "dirty" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Salvando…</> : null}
          {saveState === "saved" ? <><Check className="h-3.5 w-3.5 text-emerald-600" />Salvo</> : null}
          {saveState === "error" ? <span className="text-red-600" title={saveError}><CircleAlert className="mr-1 inline h-3.5 w-3.5" />Erro ao salvar</span> : null}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={undo} disabled={!pastRef.current.length} title="Desfazer (Ctrl+Z)" aria-label="Desfazer" className="rounded-full border border-line p-2 text-navy hover:bg-mist disabled:opacity-40"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={redo} disabled={!futureRef.current.length} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer" className="rounded-full border border-line p-2 text-navy hover:bg-mist disabled:opacity-40"><Redo2 className="h-4 w-4" /></button>
          <div className="flex rounded-full border border-line p-0.5">
            <button type="button" onClick={() => setView("map")} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${view === "map" ? "bg-navy text-white" : "text-navy"}`}><MapIcon className="h-3.5 w-3.5" />Mapa</button>
            <button type="button" onClick={() => setView("list")} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${view === "list" ? "bg-navy text-white" : "text-navy"}`}><LayoutList className="h-3.5 w-3.5" />Lista</button>
          </div>
          <button type="button" onClick={() => setShowPreview(true)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-black text-navy hover:bg-mist"><Eye className="h-4 w-4" />Pré-visualizar</button>
          {flow.publishedVersion !== null ? (
            <button type="button" onClick={togglePause} className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-black text-navy hover:bg-mist">
              {flow.status === "active" ? <><Pause className="h-4 w-4" />Pausar</> : <><Play className="h-4 w-4" />Retomar</>}
            </button>
          ) : null}
          <button type="button" onClick={publish} disabled={publishing || (!needsPublish && flow.status === "active")} className="inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2 text-sm font-black text-white shadow-soft hover:bg-navy disabled:opacity-50">
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {flow.status === "active" ? "Atualizar" : "Ativar"}
          </button>
        </div>
      </div>

      {notice ? (
        <div className={`mt-3 rounded-2xl px-4 py-3 text-sm font-bold ${notice.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {notice.text}
          {notice.details?.length ? <ul className="mt-1 list-disc pl-5 font-semibold">{notice.details.slice(0, 8).map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
        </div>
      ) : null}
      {validation.generalErrors.length ? <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{validation.generalErrors.join(" ")}</div> : null}

      {/* Área de trabalho */}
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_370px]" style={{ height: "calc(100dvh - 250px)", minHeight: 560 }}>
        <div className="min-h-0">
          {view === "map" ? (
            <FlowCanvas
              ref={canvasRef}
              graph={graph}
              trigger={trigger}
              selectedId={selectedId}
              issuesByNode={validation.counts}
              onSelect={setSelectedId}
              onGraphChange={applyGraph}
              onAddNode={addNode}
            />
          ) : (
            <FlowListView graph={graph} trigger={trigger} selectedId={selectedId} issuesByNode={validation.counts} onSelect={setSelectedId} onConnect={connect} onAddNode={addNode} />
          )}
        </div>

        {/* Painel: lateral no computador; folha inferior no celular */}
        <div className="hidden min-h-0 lg:block">
          {selectedNode ? panel : (
            <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white p-6 text-center">
              <span className={`mb-3 flex h-12 w-12 items-center justify-center rounded-2xl ${TONES.blue.soft}`}><NODE_META.message.icon className="h-6 w-6" /></span>
              <p className="text-base font-black text-navy">Selecione um bloco</p>
              <p className="mt-1 text-sm font-semibold text-muted">Clique em um bloco do mapa para editar. Arraste a bolinha de uma saída até outro bloco para ligar; clique numa linha para remover a ligação.</p>
              {validation.total ? <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{validation.total} pendência(s) para ativar — os blocos com bolinha vermelha.</p> : <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">Tudo certo para ativar.</p>}
            </div>
          )}
        </div>
      </div>

      {selectedNode ? (
        <div className="fixed inset-x-0 bottom-0 z-40 max-h-[82dvh] p-2 lg:hidden">
          <div className="max-h-[80dvh] overflow-hidden rounded-2xl shadow-2xl">{panel}</div>
        </div>
      ) : null}

      {showPreview ? <FlowPreview graph={graph} flowId={initialFlow.id} onClose={() => setShowPreview(false)} /> : null}
    </div>
  );
}
