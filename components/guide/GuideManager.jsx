"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Copy, Loader2, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { GUIDE_KINDS, GUIDE_KIND_KEYS } from "@/lib/attendance-guide-core.mjs";

const KIND_TONE = {
  prospecting: "bg-violet-100 text-violet-800",
  lead: "bg-blue-100 text-blue-800",
  organic: "bg-emerald-100 text-emerald-800",
  custom: "bg-slate-100 text-slate-700",
  library: "bg-amber-100 text-amber-800"
};

function statusOf(guide) {
  if (guide.publishedVersion === null) return { label: "Rascunho", className: "bg-slate-100 text-slate-700" };
  return guide.enabled ? { label: "Ativo", className: "bg-emerald-100 text-emerald-800" } : { label: "Desativado", className: "bg-amber-100 text-amber-800" };
}

// Lista dos guias (Gestão → Guia de Atendimento): criar, abrir o editor visual, duplicar, ativar/desativar, excluir.
export default function GuideManager({ initialGuides }) {
  const router = useRouter();
  const [guides, setGuides] = useState(initialGuides);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("custom");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  async function request(url, options, fallback) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || fallback);
    return data;
  }

  async function reload() {
    const data = await request("/api/admin/attendance-guides", { cache: "no-store" }, "Não foi possível recarregar.");
    setGuides(data.guides);
  }

  async function create() {
    setError("");
    setBusyId("new");
    try {
      const data = await request("/api/admin/attendance-guides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, kind: newKind })
      }, "Não foi possível criar o guia.");
      router.push(`/admin/guia-atendimento/${data.guide.id}`);
    } catch (createError) {
      setError(createError.message);
      setBusyId("");
    }
  }

  async function act(guide, action) {
    setError("");
    setBusyId(guide.id);
    try {
      if (action === "duplicate") {
        await request(`/api/admin/attendance-guides/${guide.id}/duplicate`, { method: "POST" }, "Não foi possível duplicar.");
      } else if (action === "toggle") {
        await request(`/api/admin/attendance-guides/${guide.id}/enabled`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !guide.enabled })
        }, "Não foi possível alterar o guia.");
      } else if (action === "delete") {
        if (!window.confirm(`Excluir o guia "${guide.name}"? O progresso dos corretores nele também é apagado. Isso não pode ser desfeito.`)) return;
        await request(`/api/admin/attendance-guides/${guide.id}`, { method: "DELETE" }, "Não foi possível excluir.");
      }
      await reload();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="container-page space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[28px] border border-line bg-white p-6 shadow-soft">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-2xl font-black text-navy"><BookOpen className="h-6 w-6 text-brand" />Guia de Atendimento</h2>
          <p className="mt-1 text-sm font-semibold text-muted">
            A árvore de decisão que aparece ao lado do Chat: o corretor escolhe o que o cliente respondeu e vê a orientação, o argumento e a mensagem pronta. Cada guia abre sozinho conforme a origem do cliente (Prospecção, Lead ou Orgânico). Alterações só chegam aos corretores quando você clica em <strong>Publicar</strong>.
          </p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="premium-button-primary"><Plus className="h-5 w-5" />Novo guia</button>
      </div>

      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
        {guides.map((guide) => {
          const status = statusOf(guide);
          const busy = busyId === guide.id;
          return (
            <article key={guide.id} className="rounded-[24px] border border-line bg-white p-5 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/admin/guia-atendimento/${guide.id}`} className="block truncate text-lg font-black text-navy hover:text-brand">{guide.name}</Link>
                  <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-muted">{guide.description || GUIDE_KINDS[guide.kind]?.hint}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${status.className}`}>{status.label}</span>
                  {guide.hasUnpublishedChanges ? <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-black text-blue-700">Alterações não publicadas</span> : null}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs font-black">
                <span className={`rounded-full px-2.5 py-1 ${KIND_TONE[guide.kind] || KIND_TONE.custom}`}>{GUIDE_KINDS[guide.kind]?.label || guide.kind}</span>
                <span className="text-muted">{guide.nodeCount} cards</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/admin/guia-atendimento/${guide.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-xs font-black text-white"><Pencil className="h-3.5 w-3.5" />Editar</Link>
                {guide.publishedVersion !== null ? (
                  <button type="button" disabled={busy} onClick={() => act(guide, "toggle")} className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-black text-navy hover:bg-mist">
                    <Power className="h-3.5 w-3.5" />{guide.enabled ? "Desativar" : "Ativar"}
                  </button>
                ) : null}
                <button type="button" disabled={busy} onClick={() => act(guide, "duplicate")} className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-black text-navy hover:bg-mist"><Copy className="h-3.5 w-3.5" />Duplicar</button>
                <button type="button" disabled={busy} onClick={() => act(guide, "delete")} className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-red-200 px-4 py-2 text-xs font-black text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" />Excluir</button>
                {busy ? <Loader2 className="h-4 w-4 animate-spin self-center text-muted" /> : null}
              </div>
            </article>
          );
        })}
      </div>

      {creating ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4" onClick={() => setCreating(false)}>
          <div className="w-full max-w-md rounded-[24px] bg-white p-6 shadow-soft" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-navy">Novo guia</h3>
              <button type="button" onClick={() => setCreating(false)} className="rounded-full p-2 hover:bg-mist" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <label className="mt-4 block text-xs font-black uppercase tracking-wide text-muted">
              Nome
              <input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={120} placeholder="Ex.: Cliente FGTS" className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-sm font-bold normal-case tracking-normal text-navy outline-none focus:border-brand" />
            </label>
            <label className="mt-3 block text-xs font-black uppercase tracking-wide text-muted">
              Quando abre
              <select value={newKind} onChange={(event) => setNewKind(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold normal-case tracking-normal text-navy outline-none focus:border-brand">
                {GUIDE_KIND_KEYS.map((key) => <option key={key} value={key}>{GUIDE_KINDS[key].label} — {GUIDE_KINDS[key].hint}</option>)}
              </select>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="rounded-full border border-line px-5 py-2 text-sm font-black text-navy hover:bg-mist">Cancelar</button>
              <button type="button" onClick={create} disabled={busyId === "new"} className="premium-button-primary">{busyId === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Criar e abrir o editor</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
