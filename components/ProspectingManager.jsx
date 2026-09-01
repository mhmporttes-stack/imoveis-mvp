"use client";

import { useState } from "react";
import { History, MessageCircle, Pencil, RotateCcw, Trash2, Upload } from "lucide-react";
import { formatBrazilianPhone } from "@/lib/phone-utils";

export default function ProspectingManager({ initialContacts = [], isAdmin = false, users = [] }) {
  const [contacts, setContacts] = useState(initialContacts);
  const [busy, setBusy] = useState("");
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState({ id: "", items: [] });

  async function importExcel(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("import");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const raw = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
      const rows = raw.map((row) => ({ name: findValue(row, ["nome", "name"]), phone: findValue(row, ["whatsapp", "telefone", "phone", "celular"]) }));
      const response = await fetch("/api/prospecting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSummary(data);
      await reload();
    } catch (error) { alert(error.message || "Não foi possível importar a planilha."); }
    finally { setBusy(""); }
  }

  async function claim(contact) {
    setBusy(contact.id);
    try {
      const response = await fetch(`/api/prospecting/${contact.id}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setContacts((current) => current.filter((item) => item.id !== contact.id));
      window.open(data.whatsappUrl, "_blank", "noopener,noreferrer");
    } catch (error) { alert(error.message); }
    finally { setBusy(""); }
  }

  async function edit(contact) {
    const name = prompt("Nome", contact.name);
    if (name === null) return;
    const phone = prompt("WhatsApp", contact.phone);
    if (phone === null) return;
    await mutate(contact.id, "PATCH", { name, phone });
  }
  async function unblock(contact) { await mutate(contact.id, "PATCH", { action: "unblock" }); }
  async function remove(contact) { if (confirm(`Excluir ${contact.name} da prospecção?`)) await mutate(contact.id, "DELETE"); }
  async function showHistory(contact) {
    if (history.id === contact.id) { setHistory({ id: "", items: [] }); return; }
    const response = await fetch(`/api/prospecting/${contact.id}`);
    const data = await response.json();
    if (!response.ok) { alert(data.error); return; }
    setHistory({ id: contact.id, items: data });
  }
  async function mutate(id, method, body) {
    setBusy(id);
    try {
      const response = await fetch(`/api/prospecting/${id}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await reload();
    } catch (error) { alert(error.message); }
    finally { setBusy(""); }
  }
  async function reload() { const response = await fetch("/api/prospecting"); if (response.ok) setContacts(await response.json()); }

  return (
    <section className="container-page space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm font-black uppercase tracking-[0.16em] text-brand">Fila compartilhada</p><h2 className="mt-2 text-3xl font-black text-navy">Prospecção</h2></div>
        {isAdmin ? <label className="premium-button-primary cursor-pointer"><Upload className="h-4 w-4" /> Importar Excel<input className="hidden" type="file" accept=".xlsx" onChange={importExcel} disabled={busy === "import"} /></label> : null}
      </div>
      {summary ? <div className="rounded-2xl border border-line bg-white px-5 py-4 font-bold text-navy">Importados: {summary.imported} | Duplicados ignorados: {summary.duplicates} | Inválidos: {summary.invalid} | Não contactar ignorados: {summary.doNotContact}</div> : null}
      <div className="grid gap-3">
        {contacts.map((contact) => {
          const blocked = contact.status !== "available";
          const statusLabel = contact.status === "recent_attempt" ? "Tentativa recente" : contact.status === "do_not_contact" ? "Não contactar" : contact.status === "claimed" ? "Em atendimento" : "Disponível";
          return <article key={contact.id} className="rounded-[24px] border border-line bg-white p-5 shadow-soft">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div><h3 className="text-xl font-black text-navy">{contact.name}</h3><p className="mt-1 font-bold text-muted">{formatBrazilianPhone(contact.phone)}</p><p className={`mt-2 text-sm font-black ${blocked ? "text-red-700" : "text-emerald-700"}`}>{statusLabel}</p>{contact.status === "recent_attempt" ? <p className="text-sm font-bold text-muted">Disponível novamente em {formatDate(contact.availableAfter)}</p> : null}{isAdmin && contact.registrationId ? <select className="mt-3 h-9 rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy" value={contact.assignedUserId} onChange={(event) => mutate(contact.id, "PATCH", { assignedUserId: event.target.value })}><option value="">Sem responsável</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select> : null}</div>
              <div className="flex flex-wrap gap-2">
                <button className="premium-button-secondary" disabled={blocked || busy === contact.id} onClick={() => claim(contact)} type="button"><MessageCircle className="h-4 w-4" /> WhatsApp</button>
                {isAdmin ? <><button className="icon-button" title="Histórico" onClick={() => showHistory(contact)}><History className="h-4 w-4" /></button><button className="icon-button" title="Editar" onClick={() => edit(contact)}><Pencil className="h-4 w-4" /></button>{["recent_attempt", "do_not_contact"].includes(contact.status) ? <button className="icon-button" title="Retirar bloqueio" onClick={() => unblock(contact)}><RotateCcw className="h-4 w-4" /></button> : null}<button className="icon-button text-red-600" title="Excluir" onClick={() => remove(contact)}><Trash2 className="h-4 w-4" /></button></> : null}
              </div>
            </div>
            {history.id === contact.id ? <div className="mt-4 border-t border-line pt-3 text-sm">{history.items.length ? history.items.map((item) => <p className="py-1 text-muted" key={item.id}><strong className="text-navy">{historyLabel(item.eventType)}</strong> · {item.userName} · {formatDateTime(item.createdAt)}</p>) : <p className="text-muted">Nenhum evento registrado.</p>}</div> : null}
          </article>;
        })}
        {!contacts.length ? <div className="rounded-[24px] border border-line bg-white p-10 text-center font-black text-navy">Nenhum contato disponível para prospecção.</div> : null}
      </div>
    </section>
  );
}

function findValue(row, names) { const entry = Object.entries(row).find(([key]) => names.includes(String(key).trim().toLowerCase())); return entry?.[1] || ""; }
function formatDate(value) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value)) : ""; }
function formatDateTime(value) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : ""; }
function historyLabel(value) { return ({ claimed: "Contato assumido", in_service: "Em atendimento", returned: "Devolvido por 30 dias", do_not_contact: "Não contactar", unblocked: "Bloqueio removido", edited: "Contato editado" })[value] || value; }
