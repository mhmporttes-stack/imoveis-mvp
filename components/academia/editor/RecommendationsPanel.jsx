"use client";

import { useCallback, useEffect, useState } from "react";
import s from "./editor.module.css";
import { listRecs, listTeam, recAction } from "./api";

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
const ST = { open: "Aberta", accepted: "Aceita", dismissed: "Dispensada" };

// Recomendações de treinamento (F7): manuais ou vindas da auditoria de atendimento. Só preparam: aceitar MATRICULA a pessoa; nada é enviado.
export default function RecommendationsPanel({ readOnly, tracks, onError, onNote }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("open");
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState({ userId: "", trackId: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setData(await listRecs(filter)); } catch (e) { onError(e.message); } }, [filter, onError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { listTeam({}).then((d) => setPeople(d.members)).catch(() => {}); }, []);

  const call = async (body, ok) => {
    if (readOnly) { onError('Modo de visualização ("Alterar conta"): nada é gravado.'); return false; }
    setBusy(true); onError(""); onNote("");
    try { await recAction(body); onNote(ok); await load(); return true; } catch (e) { onError(e.message); return false; } finally { setBusy(false); }
  };
  const create = async () => { if (await call({ action: "create", ...form }, "Recomendação registrada.")) setForm({ userId: "", trackId: "", reason: "" }); };

  return (
    <section aria-label="Recomendações de treinamento">
      <div className={s.card}>
        <h2>Recomendar treinamento</h2>
        <p className={s.muted}>Registre por que a pessoa deveria fazer uma formação. Aceitar matricula a pessoa; nenhuma mensagem é enviada. Gestor só para a própria equipe.</p>
        <div className={s.row}>
          <select className={s.sel} style={{ width: 240 }} aria-label="Pessoa" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}><option value="">Pessoa…</option>{people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}</select>
          <select className={s.sel} style={{ width: 240 }} aria-label="Formação" value={form.trackId} onChange={(e) => setForm({ ...form, trackId: e.target.value })}><option value="">Formação…</option>{(tracks || []).filter((t) => t.status === "active").map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
          <input className={`${s.in} ${s.grow}`} aria-label="Motivo" placeholder="Motivo (ex.: vácuo em vários atendimentos)" maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <button type="button" className={`${s.btn} ${s.pri} ${s.sm}`} disabled={busy || readOnly || !form.userId || !form.trackId || form.reason.trim().length < 3} onClick={create}>Recomendar</button>
        </div>
      </div>
      <div className={s.card}>
        <div className={s.row}>
          <h2 className={s.grow} style={{ margin: 0 }}>Recomendações</h2>
          <select className={s.sel} style={{ width: 180 }} aria-label="Filtrar situação" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="open">Abertas</option><option value="accepted">Aceitas</option><option value="dismissed">Dispensadas</option><option value="">Todas</option></select>
        </div>
        {!data ? <p className={s.muted}>Carregando…</p> : data.recommendations.length === 0 ? <p className={s.muted}>Nenhuma recomendação.</p> : (
          <table className={s.tbl}>
            <thead><tr><th>Pessoa</th><th>Formação</th><th>Motivo</th><th>Origem</th><th>Situação</th><th /></tr></thead>
            <tbody>{data.recommendations.map((r) => (
              <tr key={r.id}>
                <td>{r.userName}</td><td>{r.trackTitle}</td><td>{r.reason}<br /><span className={s.muted}>{r.createdBy || ""} · {fmt(r.createdAt)}</span></td>
                <td>{r.source === "atendimento_audit" ? "Auditoria de atendimento" : "Manual"}</td>
                <td>{ST[r.status]}{r.decidedAt ? ` em ${fmt(r.decidedAt)}` : ""}</td>
                <td>{r.status === "open" ? <div className={s.row}>
                  <button type="button" className={`${s.btn} ${s.pri} ${s.sm}`} disabled={busy || readOnly} onClick={() => call({ action: "accept", recommendationId: r.id }, "Recomendação aceita: a pessoa foi matriculada.")}>Aceitar (matricular)</button>
                  <button type="button" className={`${s.btn} ${s.sm}`} disabled={busy || readOnly} onClick={() => call({ action: "dismiss", recommendationId: r.id }, "Recomendação dispensada.")}>Dispensar</button>
                </div> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </section>
  );
}
