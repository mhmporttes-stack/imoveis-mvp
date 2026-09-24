"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Link2, Loader2, MessageSquareText, Plus, Send, Settings2, Trash2, X, Zap } from "lucide-react";

const KIND_ICON = { text: MessageSquareText, image: ImageIcon, document: FileText, simulation_link: Link2 };
const KIND_LABEL = { text: "Texto", image: "Imagem", document: "Documento", simulation_link: "Link de simulação" };

// Atalhos do Chat: só um ícone (raio) ao lado do campo de mensagem; ao tocar
// abre a lista. Escolher um atalho mostra uma prévia e só envia ao confirmar.
export default function WhatsappChatShortcuts({ conversationId, canManage, disabled, onSent }) {
  const [open, setOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(null);
  const [selected, setSelected] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  const rootRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/whatsapp-chat/shortcuts", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      setShortcuts(response.ok ? data.shortcuts || [] : []);
    } catch {
      setShortcuts([]);
    }
  }, []);

  useEffect(() => {
    if (open && shortcuts === null) load();
  }, [open, shortcuts, load]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
        setSelected(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    setOpen(false);
    setSelected(null);
    setError("");
  }, [conversationId]);

  async function send() {
    if (!selected || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversationId}/shortcut`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortcutId: selected.id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível enviar o atalho.");
      setOpen(false);
      setSelected(null);
      onSent();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-label="Atalhos"
        title="Atalhos"
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition disabled:opacity-40 ${open ? "bg-blue-50 text-brand" : "text-slate-500 hover:bg-mist hover:text-navy"}`}
      >
        <Zap className="h-5 w-5" />
      </button>

      {open ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-[min(320px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-line bg-white shadow-soft">
          {!selected ? (
            <>
              <div className="max-h-72 overflow-y-auto p-1.5">
                {shortcuts === null ? <p className="flex items-center justify-center gap-2 p-5 text-sm font-bold text-muted"><Loader2 className="h-4 w-4 animate-spin" /></p> : null}
                {shortcuts && !shortcuts.length ? <p className="p-4 text-center text-sm font-bold text-muted">Nenhum atalho cadastrado.</p> : null}
                {(shortcuts || []).map((shortcut) => {
                  const Icon = KIND_ICON[shortcut.kind] || MessageSquareText;
                  return (
                    <button key={shortcut.id} type="button" onClick={() => { setSelected(shortcut); setError(""); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-mist">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-brand"><Icon className="h-4 w-4" /></span>
                      <span className="truncate text-sm font-extrabold text-navy">{shortcut.label}</span>
                    </button>
                  );
                })}
              </div>
              {canManage ? (
                <button type="button" onClick={() => { setManaging(true); setOpen(false); }} className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-xs font-extrabold text-muted hover:bg-mist hover:text-navy">
                  <Settings2 className="h-3.5 w-3.5" /> Gerenciar atalhos
                </button>
              ) : null}
            </>
          ) : (
            <div className="space-y-3 p-3">
              <p className="text-sm font-black text-navy">{selected.label}</p>
              {selected.kind === "image" && selected.mediaUrl ? <img src={selected.mediaUrl} alt={selected.label} className="max-h-48 w-full rounded-xl border border-line object-contain" /> : null}
              {selected.kind === "document" ? <p className="flex items-center gap-2 rounded-xl bg-mist px-3 py-2 text-xs font-bold text-navy"><FileText className="h-4 w-4" />{selected.mediaName || "Documento"}</p> : null}
              {selected.kind === "simulation_link" ? <p className="rounded-xl bg-mist px-3 py-2 text-xs font-bold text-navy">Envia o link de simulação do <b>corretor responsável</b> por este cliente, direto na simulação.</p> : null}
              {selected.body ? <p className="whitespace-pre-line rounded-xl bg-[#DCEBFF] px-3 py-2 text-sm font-semibold text-navy">{selected.body}</p> : null}
              {error ? <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p> : null}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setSelected(null); setError(""); }} disabled={sending} className="h-10 flex-1 rounded-full border border-line text-sm font-extrabold text-navy hover:bg-mist">Voltar</button>
                <button type="button" onClick={send} disabled={sending} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-navy text-sm font-extrabold text-white hover:bg-[#082f55] disabled:opacity-60">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {managing ? <ManageShortcuts onClose={() => { setManaging(false); setShortcuts(null); }} /> : null}
    </div>
  );
}

function ManageShortcuts({ onClose }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState("text");
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/whatsapp-chat/shortcuts?all=1", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    setItems(response.ok ? data.shortcuts || [] : []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const form = new FormData();
      form.append("label", label);
      form.append("kind", kind);
      form.append("body", body);
      if (file) form.append("file", file);
      const response = await fetch("/api/admin/whatsapp-chat/shortcuts", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível criar o atalho.");
      setLabel("");
      setBody("");
      setFile(null);
      await load();
    } catch (createError) {
      setError(createError.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(item) {
    if (!window.confirm(`Excluir o atalho "${item.label}"?`)) return;
    await fetch(`/api/admin/whatsapp-chat/shortcuts/${item.id}`, { method: "DELETE" });
    load();
  }

  const needsFile = kind === "image" || kind === "document";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/50 p-4" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-[28px] border border-line bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-black text-navy">Atalhos do Chat</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-full p-2 text-muted hover:bg-mist"><X className="h-5 w-5" /></button>
        </div>

        <ul className="divide-y divide-line rounded-2xl border border-line">
          {items === null ? <li className="p-4 text-sm font-bold text-muted">Carregando…</li> : null}
          {(items || []).map((item) => {
            const Icon = KIND_ICON[item.kind] || MessageSquareText;
            return (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-50 text-brand"><Icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold text-navy">{item.label}</span>
                  <span className="block truncate text-[11px] font-bold text-muted">{KIND_LABEL[item.kind]}{item.mediaName ? ` · ${item.mediaName}` : ""}</span>
                </span>
                <button type="button" onClick={() => remove(item)} aria-label={`Excluir ${item.label}`} className="rounded-full p-2 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
              </li>
            );
          })}
        </ul>

        <form onSubmit={create} className="mt-5 space-y-3 rounded-2xl border border-line p-4">
          <p className="flex items-center gap-2 text-sm font-black text-navy"><Plus className="h-4 w-4" /> Novo atalho</p>
          <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} placeholder="Nome do atalho" className="h-10 w-full rounded-xl border border-line px-3 text-sm font-bold text-navy outline-none focus:border-brand" />
          <select value={kind} onChange={(event) => { setKind(event.target.value); setFile(null); }} className="h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand">
            {Object.entries(KIND_LABEL).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} placeholder={kind === "text" ? "Texto da mensagem" : "Legenda / mensagem (opcional)"} className="w-full rounded-xl border border-line px-3 py-2 text-sm font-semibold text-navy outline-none focus:border-brand" />
          {needsFile ? (
            <input type="file" accept={kind === "image" ? "image/jpeg,image/png" : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"} onChange={(event) => setFile(event.target.files?.[0] || null)} className="block w-full text-xs font-bold text-muted" />
          ) : null}
          {error ? <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p> : null}
          <button type="submit" disabled={saving || !label.trim()} className="inline-flex h-10 items-center gap-2 rounded-full bg-navy px-5 text-sm font-extrabold text-white disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Criar atalho
          </button>
        </form>
      </div>
    </div>
  );
}
