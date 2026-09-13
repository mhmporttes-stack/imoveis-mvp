"use client";
import { useState } from "react";
import { Save, Eye, X } from "lucide-react";
import { CLIENT_STATUS_META } from "@/lib/client-status";
import { publicJourneyDTO } from "@/lib/journey-presentation";
import ClientJourney from "./ClientJourney";

export default function JourneySettings({ initial }) {
  const [settings, setSettings] = useState(initial);
  const [status, setStatus] = useState("approved");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const item = settings.statuses[status];
  const update = (key, value) => setSettings(s => ({ ...s, statuses: { ...s.statuses, [status]: { ...s.statuses[status], [key]: value } } }));
  async function save() {
    setBusy(true); setFeedback("");
    try {
      const r = await fetch("/api/client-journey/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      setSettings(data); setFeedback("Configurações salvas.");
    } catch (e) { setFeedback(e.message); } finally { setBusy(false); }
  }
  const labels = { public_name: "Nome público", title: "Título da mensagem", subtitle: "Subtítulo", body: "Mensagem", cta_label: "Texto do botão", notification: "Mensagem de aviso no WhatsApp" };
  const globals = { brand: "Nome da experiência", celebration_title: "Título da celebração", celebration_subtitle: "Subtítulo da celebração", greeting: "Saudação após 24 horas", greeting_subtitle: "Subtítulo após 24 horas", progress_label: "Rótulo do progresso", contact: "Mensagem para o corretor", closing_quote: "Frase / versículo de encerramento", closing_author: "Referência / autor do encerramento" };
  return <section className="container-page pb-10">
    <div className="mb-6 flex flex-wrap items-end gap-4 border-b border-line pb-5">
      <label className="min-w-0 flex-1 text-sm font-bold">Status interno<select className="mt-2 w-full rounded-lg border border-line bg-white p-3" value={status} onChange={e => setStatus(e.target.value)}>{Object.keys(settings.statuses).map(key => <option key={key} value={key}>{CLIENT_STATUS_META[key]?.label || key}</option>)}</select></label>
      <button type="button" className="premium-button-secondary" onClick={() => setPreview(true)}><Eye size={18} />Pré-visualizar como cliente</button>
      <button type="button" disabled={busy} className="premium-button-primary" onClick={save}><Save size={18} />Salvar</button>
    </div>
    {feedback ? <p role="status" className="mb-4 text-sm font-bold">{feedback}</p> : null}
    <div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm font-bold">Percentual<input className="mt-2 w-full rounded-lg border border-line p-3" type="number" min="0" max="100" disabled={item.progress === null} value={item.progress ?? ""} onChange={e => update("progress", Number(e.target.value))} /></label>
      <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={item.progress === null} onChange={e => update("progress", e.target.checked ? null : 0)} />Manter o progresso já conquistado</label>
      {Object.entries(labels).map(([key, label]) => <label key={key} className={`min-w-0 text-sm font-bold ${["body", "notification"].includes(key) ? "md:col-span-2" : ""}`}>{label}{["body", "notification"].includes(key) ? <textarea rows={5} className="mt-2 w-full rounded-lg border border-line p-3 font-normal" value={item[key]} onChange={e => update(key, e.target.value)} /> : <input className="mt-2 w-full rounded-lg border border-line p-3 font-normal" value={item[key]} onChange={e => update(key, e.target.value)} />}</label>)}
      <label className="text-sm font-bold">Ação do botão<select className="mt-2 w-full rounded-lg border border-line bg-white p-3" value={item.cta} onChange={e => update("cta", e.target.value)}><option value="whatsapp">WhatsApp do responsável</option><option value="none">Sem botão</option></select></label>
    </div>
    <details className="mt-8 border-t border-line pt-4"><summary className="cursor-pointer font-bold">Textos gerais da experiência</summary><div className="mt-4 grid gap-4 md:grid-cols-2">{Object.entries(globals).map(([key, label]) => <label key={key} className="text-sm font-bold">{label}<textarea rows={3} className="mt-2 w-full rounded-lg border border-line p-3 font-normal" value={settings.copy[key]} onChange={e => setSettings(s => ({ ...s, copy: { ...s.copy, [key]: e.target.value } }))} /></label>)}</div></details>
    {preview ? <div className="fixed inset-0 z-[100] overflow-auto bg-white" role="dialog" aria-modal="true" aria-label="Pré-visualização"><button type="button" className="fixed right-3 top-3 z-10 rounded-full border border-line bg-white p-3" aria-label="Fechar pré-visualização" onClick={() => setPreview(false)}><X /></button><ClientJourney preview data={publicJourneyDTO({ full_name: "João", client_code: "#C1001" }, { progress: item.progress ?? 65, previous_progress: Math.max(0, (item.progress ?? 65) - 20), changed_at: new Date().toISOString() }, item, "11999999999", settings.copy)} /></div> : null}
  </section>;
}
