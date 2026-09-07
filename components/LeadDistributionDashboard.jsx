"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, Pause, Play, UsersRound } from "lucide-react";

export default function LeadDistributionDashboard({ initialData }) {
  const [brokers, setBrokers] = useState(initialData?.brokers || []);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState("");
  const [copied, setCopied] = useState(false);
  const queue = useMemo(() => brokers.filter((broker) => broker.enabled && broker.status === "active"), [brokers]);
  const outside = useMemo(() => brokers.filter((broker) => !broker.enabled || broker.status !== "active"), [brokers]);
  const nextBroker = queue[0] || null;

  useEffect(() => {
    const refresh = async () => {
      const response = await fetch("/api/lead-distribution", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      if (payload?.brokers) setBrokers(payload.brokers);
    };
    const timer = window.setInterval(refresh, 10000);
    return () => window.clearInterval(timer);
  }, []);

  async function saveOrder(nextQueue) {
    const response = await fetch("/api/lead-distribution", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: nextQueue.map((broker) => broker.id) }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível reorganizar a fila.");
  }

  async function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= queue.length) return;
    const nextQueue = [...queue];
    [nextQueue[index], nextQueue[target]] = [nextQueue[target], nextQueue[index]];
    setBrokers([...nextQueue, ...outside]);
    setError("");
    try { await saveOrder(nextQueue); } catch (moveError) { setBrokers([...queue, ...outside]); setError(moveError.message); }
  }

  async function toggle(broker) {
    setSavingId(broker.id);
    setError("");
    const enabled = !broker.enabled;
    try {
      const response = await fetch(`/api/admin-users/${broker.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadDistributionEnabled: enabled }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível alterar a participação.");
      const nextBrokers = brokers.map((item) => item.id === broker.id ? { ...item, enabled } : item);
      setBrokers(nextBrokers);
      if (enabled && broker.status === "active") await saveOrder(nextBrokers.filter((item) => item.enabled && item.status === "active"));
    } catch (toggleError) { setError(toggleError.message); }
    finally { setSavingId(""); }
  }

  async function copySimulationLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/simulacao/equipe`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return <section className="container-page space-y-5">
    <div className="grid gap-3 sm:grid-cols-4">
      <Metric label="Na fila" value={queue.length} />
      <Metric label="Fora da fila" value={outside.filter((broker) => broker.status === "active").length} />
      <Metric label="Usuários inativos" value={outside.filter((broker) => broker.status !== "active").length} />
      <Metric label="Próximo corretor" value={nextBroker?.name || "Nenhum"} text />
    </div>
    {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}
    <div className="rounded-[24px] border border-line bg-white p-5 shadow-soft">
      <div className="flex items-center gap-3"><UsersRound className="h-6 w-6 text-brand" /><div><h2 className="text-xl font-black text-navy">Ordem da fila</h2><p className="text-sm font-bold text-muted">O primeiro recebe o próximo lead e depois vai automaticamente para o fim da fila.</p></div></div>
      <div className="mt-5 space-y-2">{queue.map((broker, index) => <BrokerRow broker={broker} index={index} key={broker.id} onMove={move} onToggle={toggle} saving={savingId === broker.id} total={queue.length} />)}{!queue.length ? <Empty text="Nenhum corretor participa da roleta." /> : null}</div>
    </div>
    <div className="rounded-[24px] border border-line bg-white p-5 shadow-soft"><h2 className="text-xl font-black text-navy">Fora da fila</h2><div className="mt-5 space-y-2">{outside.map((broker) => <BrokerRow broker={broker} key={broker.id} onToggle={toggle} saving={savingId === broker.id} />)}{!outside.length ? <Empty text="Todos os corretores estão na fila." /> : null}</div></div>
    <div className="flex justify-end"><button className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-white px-4 text-xs font-black text-navy shadow-soft" onClick={copySimulationLink} type="button">{copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-brand" />}{copied ? "Link copiado" : "Copiar link da roleta"}</button></div>
  </section>;
}

function BrokerRow({ broker, index, total, onMove, onToggle, saving }) {
  const active = broker.status === "active";
  return <div className="grid items-center gap-3 rounded-2xl border border-line px-4 py-3 md:grid-cols-[52px_1fr_auto_auto]">
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-mist font-black text-navy">{index === undefined ? "-" : index + 1}</div>
    <div className="min-w-0"><p className="truncate font-black text-navy">{broker.name}</p><p className="truncate text-xs font-bold text-muted">{roleLabel(broker.role)} · {active ? `${broker.clientCount} clientes` : "Usuário inativo"}</p></div>
    {index !== undefined ? <div className="flex gap-1"><IconButton disabled={index === 0} label="Subir na fila" onClick={() => onMove(index, -1)}><ArrowUp /></IconButton><IconButton disabled={index === total - 1} label="Descer na fila" onClick={() => onMove(index, 1)}><ArrowDown /></IconButton></div> : <span className={`rounded-full px-3 py-1 text-xs font-black ${active ? "bg-slate-100 text-slate-600" : "bg-red-50 text-red-700"}`}>{active ? "Disponível" : "Inativo"}</span>}
    <button className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-black text-navy disabled:opacity-50" disabled={!active || saving} onClick={() => onToggle(broker)} type="button">{broker.enabled ? <><Pause className="h-4 w-4" />Retirar</> : <><Play className="h-4 w-4" />Adicionar</>}</button>
  </div>;
}
function IconButton({ children, disabled, label, onClick }) { return <button aria-label={label} className="icon-button disabled:opacity-30" disabled={disabled} onClick={onClick} title={label} type="button">{children}</button>; }
function Metric({ label, value, text }) { return <div className="rounded-[22px] border border-line bg-white p-5 shadow-soft"><p className={`${text ? "truncate text-xl" : "text-3xl"} font-black text-navy`}>{value}</p><p className="mt-1 text-sm font-bold text-muted">{label}</p></div>; }
function Empty({ text }) { return <p className="rounded-2xl bg-mist/50 p-5 text-center font-bold text-muted">{text}</p>; }
function roleLabel(role) { return role === "associate" ? "Associado" : role === "admin" ? "Administrador" : role === "manager" ? "Gestor" : "Corretor"; }
