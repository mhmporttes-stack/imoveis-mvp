"use client";

import { useMemo, useState } from "react";
import { CheckSquare, History, MessageCircle, Pencil, RotateCcw, Trash2, Upload } from "lucide-react";
import { formatBrazilianPhone } from "@/lib/phone-utils";

export default function ProspectingManager({ initialContacts = [], isAdmin = false, users = [] }) {
  const [contacts, setContacts] = useState(initialContacts);
  const [busy, setBusy] = useState("");
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState({ id: "", items: [] });
  const [importDraft, setImportDraft] = useState(null);
  const [dddMode, setDddMode] = useState("all");
  const [dddValue, setDddValue] = useState("14");
  const [selectedIds, setSelectedIds] = useState([]);
  const visibleContacts = useMemo(() => contacts.filter((contact) => {
    if (dddMode === "equal" && dddValue.length === 2) return getPhoneDdd(contact.phone) === dddValue;
    if (dddMode === "different" && dddValue.length === 2) return getPhoneDdd(contact.phone) !== dddValue;
    return true;
  }), [contacts, dddMode, dddValue]);
  const allVisibleSelected = visibleContacts.length > 0 && visibleContacts.every((contact) => selectedIds.includes(contact.id));

  function toggleSelectAll() {
    const visibleIds = visibleContacts.map((contact) => contact.id);
    setSelectedIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : Array.from(new Set([...current, ...visibleIds])));
  }

  function toggleContact(id) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function loadExcel(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const raw = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
      const headers = Array.from(new Set(raw.flatMap((row) => Object.keys(row))));
      if (!headers.length || !raw.length) throw new Error("A primeira aba da planilha está vazia.");
      setImportDraft({
        headers,
        rows: raw,
        nameColumn: guessColumn(headers, ["nome", "name", "cliente"]),
        phoneColumn: guessColumn(headers, ["whatsapp", "telefone", "phone", "celular", "numero", "número"])
      });
      setSummary(null);
    } catch (error) { alert(error.message || "Não foi possível ler a planilha."); }
  }

  async function confirmImport() {
    if (!importDraft?.nameColumn || !importDraft?.phoneColumn) {
      alert("Selecione as colunas de nome e WhatsApp.");
      return;
    }
    if (importDraft.nameColumn === importDraft.phoneColumn) {
      alert("Nome e WhatsApp devem usar colunas diferentes.");
      return;
    }
    setBusy("import");
    try {
      const rows = importDraft.rows.map((row) => ({ name: row[importDraft.nameColumn], phone: row[importDraft.phoneColumn] }));
      const response = await fetch("/api/prospecting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSummary(data);
      setImportDraft(null);
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
        {isAdmin ? <label className="premium-button-primary cursor-pointer"><Upload className="h-4 w-4" /> Importar Excel<input className="hidden" type="file" accept=".xlsx" onChange={loadExcel} disabled={busy === "import"} /></label> : null}
      </div>
      {importDraft ? (
        <div className="rounded-[24px] border border-line bg-white p-5 shadow-soft">
          <h3 className="text-xl font-black text-navy">Identifique as colunas</h3>
          <p className="mt-1 text-sm font-bold text-muted">{importDraft.rows.length} linhas encontradas na primeira aba.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-black text-navy">Coluna do nome<select className="mt-2 h-12 w-full rounded-2xl border border-line bg-white px-4 font-bold outline-none focus:border-brand" value={importDraft.nameColumn} onChange={(event) => setImportDraft((current) => ({ ...current, nameColumn: event.target.value }))}><option value="">Selecione</option>{importDraft.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>
            <label className="text-sm font-black text-navy">Coluna do WhatsApp<select className="mt-2 h-12 w-full rounded-2xl border border-line bg-white px-4 font-bold outline-none focus:border-brand" value={importDraft.phoneColumn} onChange={(event) => setImportDraft((current) => ({ ...current, phoneColumn: event.target.value }))}><option value="">Selecione</option>{importDraft.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>
          </div>
          {importDraft.nameColumn && importDraft.phoneColumn ? <div className="mt-4 rounded-2xl bg-mist px-4 py-3 text-sm text-muted"><strong className="text-navy">Prévia:</strong> {String(importDraft.rows[0]?.[importDraft.nameColumn] || "-")} · {String(importDraft.rows[0]?.[importDraft.phoneColumn] || "-")}</div> : null}
          <div className="mt-4 flex flex-wrap gap-2"><button className="premium-button-primary" disabled={busy === "import"} onClick={confirmImport} type="button">Confirmar importação</button><button className="premium-button-secondary" disabled={busy === "import"} onClick={() => setImportDraft(null)} type="button">Cancelar</button></div>
        </div>
      ) : null}
      {summary ? <div className="rounded-2xl border border-line bg-white px-5 py-4 font-bold text-navy">Importados: {summary.imported} | Duplicados ignorados: {summary.duplicates} | Inválidos: {summary.invalid} | Não contactar ignorados: {summary.doNotContact}</div> : null}
      {isAdmin ? <div className="flex flex-wrap items-center gap-3 rounded-[20px] border border-line bg-white p-3 shadow-soft">
        <label className="min-w-[210px] flex-1 sm:flex-none"><span className="sr-only">Tipo de filtro por DDD</span><select className="h-11 w-full rounded-2xl border border-brand/25 bg-white px-4 text-sm font-extrabold text-navy outline-none focus:border-brand" value={dddMode} onChange={(event) => setDddMode(event.target.value)}><option value="all">Todos os DDDs</option><option value="equal">DDD igual a</option><option value="different">DDD diferente de</option></select></label>
        {dddMode !== "all" ? <label className="w-24"><span className="sr-only">Número do DDD</span><input className="h-11 w-full rounded-2xl border border-brand/25 bg-white px-4 text-center text-sm font-extrabold text-navy outline-none focus:border-brand" inputMode="numeric" maxLength={2} onChange={(event) => setDddValue(event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="DDD" value={dddValue} /></label> : null}
        <button className="premium-button-secondary" onClick={toggleSelectAll} type="button"><CheckSquare className="h-4 w-4" /> {allVisibleSelected ? "Desmarcar tudo" : "Selecionar tudo"}</button>
        {selectedIds.length ? <span className="text-sm font-extrabold text-muted">{selectedIds.length} selecionado{selectedIds.length === 1 ? "" : "s"}</span> : null}
      </div> : null}
      <div className="grid gap-3">
        {visibleContacts.map((contact) => {
          const blocked = contact.status !== "available";
          const statusLabel = contact.status === "recent_attempt" ? "Tentativa recente" : contact.status === "do_not_contact" ? "Não contactar" : contact.status === "claimed" ? "Em atendimento" : "Disponível";
          return <article key={contact.id} className="rounded-[24px] border border-line bg-white p-5 shadow-soft">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-start gap-3">{isAdmin ? <input aria-label={`Selecionar ${contact.name}`} checked={selectedIds.includes(contact.id)} className="mt-1 h-5 w-5 shrink-0 accent-brand" onChange={() => toggleContact(contact.id)} type="checkbox" /> : null}<div><h3 className="text-xl font-black text-navy">{contact.name}</h3><p className="mt-1 font-bold text-muted">{formatBrazilianPhone(contact.phone)}</p><p className={`mt-2 text-sm font-black ${blocked ? "text-red-700" : "text-emerald-700"}`}>{statusLabel}</p>{contact.status === "recent_attempt" ? <p className="text-sm font-bold text-muted">Disponível novamente em {formatDate(contact.availableAfter)}</p> : null}{isAdmin && contact.registrationId ? <select className="mt-3 h-9 rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy" value={contact.assignedUserId} onChange={(event) => mutate(contact.id, "PATCH", { assignedUserId: event.target.value })}><option value="">Sem responsável</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select> : null}</div></div>
              <div className="flex flex-wrap gap-2">
                <button className="premium-button-secondary" disabled={blocked || busy === contact.id} onClick={() => claim(contact)} type="button"><MessageCircle className="h-4 w-4" /> WhatsApp</button>
                {isAdmin ? <><button className="icon-button" title="Histórico" onClick={() => showHistory(contact)}><History className="h-4 w-4" /></button><button className="icon-button" title="Editar" onClick={() => edit(contact)}><Pencil className="h-4 w-4" /></button>{["recent_attempt", "do_not_contact"].includes(contact.status) ? <button className="icon-button" title="Retirar bloqueio" onClick={() => unblock(contact)}><RotateCcw className="h-4 w-4" /></button> : null}<button className="icon-button text-red-600" title="Excluir" onClick={() => remove(contact)}><Trash2 className="h-4 w-4" /></button></> : null}
              </div>
            </div>
            {history.id === contact.id ? <div className="mt-4 border-t border-line pt-3 text-sm">{history.items.length ? history.items.map((item) => <p className="py-1 text-muted" key={item.id}><strong className="text-navy">{historyLabel(item.eventType)}</strong> · {item.userName} · {formatDateTime(item.createdAt)}</p>) : <p className="text-muted">Nenhum evento registrado.</p>}</div> : null}
          </article>;
        })}
        {!visibleContacts.length ? <div className="rounded-[24px] border border-line bg-white p-10 text-center font-black text-navy">Nenhum contato disponível para este filtro.</div> : null}
      </div>
    </section>
  );
}

function guessColumn(headers, names) { return headers.find((header) => { const normalized = String(header).trim().toLowerCase(); return names.some((name) => normalized === name || normalized.startsWith(name)); }) || ""; }
function getPhoneDdd(value) { const digits = String(value || "").replace(/\D/g, ""); const national = digits.startsWith("55") ? digits.slice(2) : digits; return national.slice(0, 2); }
function formatDate(value) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value)) : ""; }
function formatDateTime(value) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : ""; }
function historyLabel(value) { return ({ claimed: "Contato assumido", in_service: "Em atendimento", returned: "Devolvido por 30 dias", auto_returned: "Devolvido automaticamente por 30 dias", do_not_contact: "Não contactar", unblocked: "Bloqueio removido", edited: "Contato editado" })[value] || value; }
