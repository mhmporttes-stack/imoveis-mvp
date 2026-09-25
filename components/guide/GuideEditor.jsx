"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CircleAlert, Loader2, Power, Redo2, Undo2, Zap } from "lucide-react";
import FlowCanvas from "@/components/flows/FlowCanvas";
import GuideNodePanel from "@/components/guide/GuideNodePanel";
import { GUIDE_NODE_META, makeGuideAdapter } from "@/components/guide/guide-ui";
import { TONES } from "@/components/flows/flow-ui";
import { GUIDE_KINDS, GUIDE_KIND_KEYS, defaultNodeData, getOutputPorts, newId, validateGuideGraph } from "@/lib/attendance-guide-core.mjs";

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

// Editor visual do Guia de Atendimento. Mesma arquitetura do editor de Fluxos do WhatsApp (canvas compartilhado,
// rascunho salvo sozinho, desfazer/refazer, validação, Publicar) — muda só o tipo dos cards.
export default function GuideEditor({ initialGuide, libraryOptions = [] }) {
  const [guide, setGuide] = useState(initialGuide);
  const [name, setName] = useState(initialGuide.name);
  const [kind, setKind] = useState(initialGuide.kind);
  const [graph, setGraph] = useState(initialGuide.graph);
  const [selectedId, setSelectedId] = useState(null);
  const [saveState, setSaveState] = useState("saved"); // saved | dirty | saving | error
  const [saveError, setSaveError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState(null);
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const [, setHistVersion] = useState(0);

  const canvasRef = useRef(null);
  const stateRef = useRef({ name, kind, graph });
  stateRef.current = { name, kind, graph };
  const lastHistoryKey = useRef({ key: "", at: 0 });
  const saveTimer = useRef(null);
  const saving = useRef(false);
  const pendingSave = useRef(false);
  const mounted = useRef(false);

  const isLibrary = kind === "library";

  // Títulos das objeções do banco (para mostrar "Abre: …" nos cards) + as do próprio guia, se ele for o banco.
  const libraryTitles = useMemo(() => {
    const titles = new Map();
    for (const library of libraryOptions) for (const entry of library.entries) titles.set(`${entry.guideId}::${entry.nodeId}`, entry.title);
    if (initialGuide.kind === "library") for (const node of graph.nodes) if (node.type === "card") titles.set(`${initialGuide.id}::${node.id}`, node.data?.title || "Objeção");
    return titles;
  }, [libraryOptions, graph, initialGuide.id, initialGuide.kind]);
  const adapter = useMemo(() => makeGuideAdapter({ libraryTitles, isLibrary }), [libraryTitles, isLibrary]);

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
      const { name: currentName, kind: currentKind, graph: currentGraph } = stateRef.current;
      const response = await fetch(`/api/admin/attendance-guides/${initialGuide.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: currentName, kind: currentKind, graph: currentGraph })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      setGuide(data.guide);
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
  }, [initialGuide.id]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return undefined;
    }
    setSaveState((current) => (current === "saving" ? current : "dirty"));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, AUTOSAVE_MS);
    return () => clearTimeout(saveTimer.current);
  }, [name, kind, graph, flushSave]);

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
  const snapshotNow = () => ({ graph: stateRef.current.graph });

  const pushHistory = useCallback((key) => {
    const now = Date.now();
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
    setGraph(previous.graph);
    setHistVersion((value) => value + 1);
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current[futureRef.current.length - 1];
    if (!next) return;
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, snapshotNow()];
    lastHistoryKey.current = { key: "", at: 0 };
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

  // Liga (ou desliga, com `to` vazio) UMA saída a qualquer card.
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
    // Respostas ganham ids novos (as ligações não são copiadas) e a cópia deixa de ser "entrada" do banco.
    if (Array.isArray(data.options)) data.options = data.options.map((option) => ({ ...option, id: newId("o") }));
    if (data.entry) data.entry = false;
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
    const libraryNodes = new Set([...libraryTitles.keys()]);
    const result = validateGuideGraph(graph, { libraryNodes, isLibrary });
    const byNode = new Map();
    const bucket = (id) => {
      if (!byNode.has(id)) byNode.set(id, { errors: [], warnings: [] });
      return byNode.get(id);
    };
    for (const error of result.errors) if (error.nodeId) bucket(error.nodeId).errors.push(error.message);
    for (const warning of result.warnings) if (warning.nodeId) bucket(warning.nodeId).warnings.push(warning.message);
    // Na bolinha do mapa só entram erros, blocos soltos e textos fora da regra; "esta saída termina o atendimento" é normal.
    const counts = new Map([...byNode].map(([id, value]) => [id, { errors: value.errors.length, warnings: value.warnings.filter((message) => /não está ligado|Evite|não leva a nenhum|não tem próximas/.test(message)).length }]));
    const generalErrors = result.errors.filter((error) => !error.nodeId).map((error) => error.message);
    return { byNode, counts, generalErrors, total: result.errors.length, warningTotal: result.warnings.filter((warning) => /Evite/.test(warning.message)).length };
  }, [graph, isLibrary, libraryTitles]);

  // ---------------- publicar / ativar ----------------
  async function publish() {
    setNotice(null);
    setPublishing(true);
    try {
      clearTimeout(saveTimer.current);
      while (saving.current) await new Promise((resolve) => setTimeout(resolve, 150));
      await flushSave();
      while (saving.current) await new Promise((resolve) => setTimeout(resolve, 150));
      const response = await fetch(`/api/admin/attendance-guides/${initialGuide.id}/publish`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const first = data.details?.errors?.find((item) => item.nodeId);
        if (first) setSelectedId(first.nodeId);
        setNotice({ kind: "error", text: data.error || "Não foi possível publicar o guia.", details: (data.details?.errors || []).map((item) => item.message) });
        return;
      }
      setGuide(data.guide);
      setNotice({ kind: "ok", text: "Guia publicado. Os corretores já usam esta versão nos próximos atendimentos." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setPublishing(false);
    }
  }

  async function toggleEnabled() {
    setNotice(null);
    const next = !guide.enabled;
    try {
      const response = await fetch(`/api/admin/attendance-guides/${initialGuide.id}/enabled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível alterar o guia.");
      setGuide(data.guide);
      setNotice({ kind: "ok", text: next ? "Guia ativado." : "Guia desativado: deixa de abrir para os corretores (nada foi apagado)." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    }
  }

  const selectedNode = graph.nodes.find((node) => node.id === selectedId) || null;
  const published = guide.publishedVersion !== null;
  const statusLabel = !published ? "Rascunho" : guide.enabled ? "Ativo" : "Desativado";
  const statusTone = !published ? "bg-slate-100 text-slate-700" : guide.enabled ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800";
  const needsPublish = !published || guide.hasUnpublishedChanges;

  const panel = (
    <GuideNodePanel
      key={selectedNode?.id || "none"}
      node={selectedNode}
      graph={graph}
      isLibrary={isLibrary}
      libraryOptions={libraryOptions}
      libraryTitles={libraryTitles}
      issues={selectedNode ? validation.byNode.get(selectedNode.id) || { errors: [], warnings: [] } : null}
      onChangeData={(data) => changeNodeData(selectedNode.id, data)}
      onConnect={connect}
      onDelete={() => deleteNode(selectedNode.id)}
      onDuplicate={() => duplicateNode(selectedNode.id)}
      onClose={() => setSelectedId(null)}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1640px] px-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3 shadow-soft">
        <Link href="/admin/guia-atendimento" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-black text-navy hover:bg-mist"><ArrowLeft className="h-4 w-4" />Guias</Link>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          aria-label="Nome do guia"
          className="min-w-[160px] flex-1 rounded-lg border border-transparent px-3 py-2 text-base font-black text-navy outline-none hover:border-line focus:border-brand"
        />
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          aria-label="Tipo de atendimento"
          title="Define quando este guia abre sozinho ao abrir o Chat de um cliente"
          className="rounded-full border border-line bg-white px-3 py-2 text-xs font-black text-navy outline-none focus:border-brand"
        >
          {GUIDE_KIND_KEYS.map((key) => <option key={key} value={key}>{GUIDE_KINDS[key].label}</option>)}
        </select>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone}`}>{statusLabel}</span>
        {published && guide.hasUnpublishedChanges ? <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">Alterações não publicadas</span> : null}
        <span className="flex items-center gap-1.5 text-xs font-bold text-muted" aria-live="polite">
          {saveState === "saving" || saveState === "dirty" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Salvando…</> : null}
          {saveState === "saved" ? <><Check className="h-3.5 w-3.5 text-emerald-600" />Salvo</> : null}
          {saveState === "error" ? <span className="text-red-600" title={saveError}><CircleAlert className="mr-1 inline h-3.5 w-3.5" />Erro ao salvar</span> : null}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={undo} disabled={!pastRef.current.length} title="Desfazer (Ctrl+Z)" aria-label="Desfazer" className="rounded-full border border-line p-2 text-navy hover:bg-mist disabled:opacity-40"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={redo} disabled={!futureRef.current.length} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer" className="rounded-full border border-line p-2 text-navy hover:bg-mist disabled:opacity-40"><Redo2 className="h-4 w-4" /></button>
          {published ? (
            <button type="button" onClick={toggleEnabled} className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-black text-navy hover:bg-mist">
              <Power className="h-4 w-4" />{guide.enabled ? "Desativar" : "Ativar"}
            </button>
          ) : null}
          <button type="button" onClick={publish} disabled={publishing || (!needsPublish && guide.enabled)} className="inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2 text-sm font-black text-white shadow-soft hover:bg-navy disabled:opacity-50">
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {published ? "Publicar alterações" : "Publicar"}
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

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_390px]" style={{ height: "calc(100dvh - 235px)", minHeight: 560 }}>
        <div className="min-h-0">
          <FlowCanvas
            ref={canvasRef}
            adapter={adapter}
            graph={graph}
            trigger={null}
            selectedId={selectedId}
            issuesByNode={validation.counts}
            onSelect={setSelectedId}
            onGraphChange={applyGraph}
            onAddNode={addNode}
          />
        </div>

        <div className="hidden min-h-0 lg:block">
          {selectedNode ? panel : (
            <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white p-6 text-center">
              <span className={`mb-3 flex h-12 w-12 items-center justify-center rounded-2xl ${TONES.blue.soft}`}><GUIDE_NODE_META.card.icon className="h-6 w-6" /></span>
              <p className="text-base font-black text-navy">Selecione um card</p>
              <p className="mt-1 text-sm font-semibold text-muted">Clique num card do mapa para editar. Arraste a bolinha de uma resposta até outro card para ligar; passe o mouse numa linha para remover a ligação.</p>
              {validation.total ? <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{validation.total} pendência(s) para publicar — os cards com bolinha vermelha.</p> : <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">Tudo certo para publicar.</p>}
              {validation.warningTotal ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{validation.warningTotal} aviso(s) de texto fora da regra (não bloqueiam).</p> : null}
            </div>
          )}
        </div>
      </div>

      {selectedNode ? (
        <div className="fixed inset-x-0 bottom-0 z-40 max-h-[82dvh] p-2 lg:hidden">
          <div className="max-h-[80dvh] overflow-hidden rounded-2xl shadow-2xl">{panel}</div>
        </div>
      ) : null}
    </div>
  );
}
