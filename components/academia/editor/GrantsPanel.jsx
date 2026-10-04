"use client";

import { useCallback, useEffect, useState } from "react";
import s from "./editor.module.css";
import { grantExtra, listGrants } from "./api";

const fmt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");

// Liberação manual de +1 tentativa (regra do dono, ACA-2): só depois das 3, uma vez por aluno e prova, com registro.
export default function GrantsPanel({ readOnly }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState({});
  const [confirming, setConfirming] = useState("");

  const load = useCallback(async () => {
    try { setData(await listGrants()); setError(""); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const grant = async (p) => {
    if (busy || readOnly) return;
    const key = `${p.enrollmentId}:${p.examId}`;
    if (confirming !== key) { setConfirming(key); return; } // 2º clique confirma (fica registrado com seu nome)
    setConfirming("");
    setBusy(true); setNote(""); setError("");
    try {
      await grantExtra(p.enrollmentId, p.examId, (reason[`${p.enrollmentId}:${p.examId}`] || "").trim());
      setNote(`Tentativa extra liberada para ${p.studentName}.`);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <section aria-label="Liberações de tentativa">
      <div className={s.card}>
        <h2>Alunos sem tentativas</h2>
        <p className={s.muted}>Depois das 3 tentativas, você pode liberar <strong>+1</strong> tentativa, uma única vez por aluno e prova. Nunca é automático. Gestor vê só a própria equipe.</p>
        {readOnly ? <p className={`${s.msg} ${s.err}`}>Modo de visualização ("Alterar conta"): nada é gravado.</p> : null}
        {error ? <p className={`${s.msg} ${s.err}`} role="alert">{error}</p> : null}
        {note ? <p className={`${s.msg} ${s.ok}`} role="status">{note}</p> : null}
        {!data ? <p className={s.muted}>Carregando…</p> : data.pending.length === 0 ? <p className={s.muted}>Nenhum aluno está sem tentativas agora.</p> : (
          <table className={s.tbl}>
            <thead><tr><th>Aluno</th><th>Prova</th><th>Tentativas</th><th>Motivo (opcional)</th><th /></tr></thead>
            <tbody>
              {data.pending.map((p) => {
                const k = `${p.enrollmentId}:${p.examId}`;
                return (
                  <tr key={k}>
                    <td>{p.studentName}</td><td>{p.lessonTitle}</td><td>{p.attemptsUsed} de {p.maxAttempts}</td>
                    <td><input className={s.in} aria-label={`Motivo para ${p.studentName}`} maxLength={300} value={reason[k] || ""} onChange={(e) => setReason((r) => ({ ...r, [k]: e.target.value }))} /></td>
                    <td><button type="button" className={`${s.btn} ${s.pri} ${s.sm}`} disabled={busy || readOnly} onClick={() => grant(p)} onBlur={() => setConfirming((c) => (c === k ? "" : c))}>{confirming === k ? "Confirmar" : "Liberar +1"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className={s.card}>
        <h2>Liberações feitas</h2>
        {!data || data.granted.length === 0 ? <p className={s.muted}>Nenhuma liberação ainda.</p> : (
          <table className={s.tbl}>
            <thead><tr><th>Aluno</th><th>Prova</th><th>Liberada por</th><th>Quando</th><th>Motivo</th></tr></thead>
            <tbody>{data.granted.map((g) => <tr key={g.id}><td>{g.studentName}</td><td>{g.lessonTitle}</td><td>{g.grantedBy || "—"}</td><td>{fmt(g.grantedAt)}</td><td>{g.reason || "—"}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </section>
  );
}
