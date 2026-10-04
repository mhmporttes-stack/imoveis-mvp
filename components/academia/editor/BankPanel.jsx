"use client";

import { useState } from "react";
import s from "./editor.module.css";
import { act } from "./api";
import ConfirmButton from "./ConfirmButton";

const blank = { questionId: null, statement: "", topic: "", options: ["", ""], correct: [0], multiple: false, explanation: "" };

// Banco de questões (F4): conteúdo reutilizável pelas provas. Editar cria uma NOVA versão da questão (as provas já publicadas
// continuam com a versão antiga). Aposentar tira a questão de novas provas, sem apagar nada.
export default function BankPanel({ bank, readOnly, reload, onError, onNote }) {
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const list = (bank || []).filter((q) => !filter.trim() || `${q.statement} ${q.topic || ""}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const edit = (q) => setForm({ questionId: q.id, statement: q.statement, topic: q.topic || "", options: q.options.map((o) => o.text), correct: q.options.map((o, i) => (q.correct.includes(o.id) ? i : -1)).filter((i) => i >= 0), multiple: q.type === "multi", explanation: q.explanation || "" });
  const call = async (action, input, ok) => {
    if (readOnly) { onError('Modo de visualização ("Alterar conta"): nada é gravado.'); return; }
    setBusy(true); onError(""); onNote("");
    try { await act(action, input); onNote(ok); await reload(); return true; } catch (e) { onError(e.message); return false; } finally { setBusy(false); }
  };
  const toggle = (i) => setForm((f) => ({ ...f, correct: f.multiple ? (f.correct.includes(i) ? f.correct.filter((x) => x !== i) : [...f.correct, i]) : [i] }));
  const save = async () => { const ok = await call("bankSave", { ...form, topic: form.topic.trim() || undefined }, "Questão salva no banco."); if (ok) setForm(null); };
  return (
    <section aria-label="Banco de questões">
      <div className={s.card}>
        <div className={s.row}>
          <h2 className={s.grow} style={{ margin: 0 }}>Banco de questões</h2>
          {!readOnly ? <button type="button" className={`${s.btn} ${s.pri}`} onClick={() => setForm({ ...blank })}>Nova questão</button> : null}
        </div>
        <p className={s.muted}>Questões reutilizáveis nas provas. Editar cria uma nova versão da questão; as provas já publicadas não mudam.</p>
        <input className={s.in} aria-label="Filtrar questões" placeholder="Filtrar por texto ou tema" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {form ? (
        <div className={s.card}>
          <h2>{form.questionId ? "Editar questão (nova versão)" : "Nova questão"}</h2>
          <label className={s.lab}>Tema (opcional)<input className={s.in} maxLength={80} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} /></label>
          <label className={s.lab}>Enunciado<textarea className={s.ta} maxLength={600} value={form.statement} onChange={(e) => setForm({ ...form, statement: e.target.value })} /></label>
          <label className={s.lab}><input type="checkbox" checked={form.multiple} onChange={(e) => setForm({ ...form, multiple: e.target.checked, correct: e.target.checked ? form.correct : form.correct.slice(0, 1) })} /> Mais de uma resposta correta</label>
          <p className={s.lab}>Alternativas (marque a correta)</p>
          {form.options.map((text, i) => (
            <div key={i} className={s.opt}>
              <input type={form.multiple ? "checkbox" : "radio"} name="bank-correct" aria-label={`Alternativa ${i + 1} é a correta`} checked={form.correct.includes(i)} onChange={() => toggle(i)} />
              <input className={s.in} aria-label={`Texto da alternativa ${i + 1}`} maxLength={300} value={text} onChange={(e) => setForm({ ...form, options: form.options.map((t, k) => (k === i ? e.target.value : t)) })} />
              {form.options.length > 2 ? <button type="button" className={`${s.btn} ${s.sm} ${s.danger}`} aria-label={`Remover alternativa ${i + 1}`} onClick={() => setForm({ ...form, options: form.options.filter((_, k) => k !== i), correct: form.correct.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)) })}>×</button> : <span />}
            </div>
          ))}
          {form.options.length < 6 ? <button type="button" className={`${s.btn} ${s.sm}`} onClick={() => setForm({ ...form, options: [...form.options, ""] })}>+ Alternativa</button> : null}
          <label className={s.lab}>Explicação (aparece só depois que o aluno é aprovado)<textarea className={s.ta} maxLength={600} value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} /></label>
          <div className={s.row} style={{ marginTop: 10 }}>
            <button type="button" className={`${s.btn} ${s.pri}`} disabled={busy} onClick={save}>Salvar no banco</button>
            <button type="button" className={s.btn} onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      ) : null}
      <div className={s.card}>
        {!bank ? <p className={s.muted}>Carregando…</p> : list.length === 0 ? <p className={s.muted}>Nenhuma questão.</p> : (
          <table className={s.tbl}>
            <thead><tr><th>Questão</th><th>Tema</th><th>Versão</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {list.map((q) => (
                <tr key={q.id}>
                  <td>{q.statement}</td><td>{q.topic || "—"}</td><td>v{q.qversion}</td>
                  <td><span className={`${s.badge} ${q.status === "active" ? s.pub : s.old}`}>{q.status === "active" ? "Ativa" : "Aposentada"}</span></td>
                  <td>{!readOnly ? <div className={s.row}>
                    <button type="button" className={`${s.btn} ${s.sm}`} onClick={() => edit(q)}>Editar</button>
                    {q.status === "active" ? <ConfirmButton disabled={busy} onConfirm={() => call("bankRetire", { questionId: q.id }, "Questão aposentada.")}>Aposentar</ConfirmButton>
                      : <button type="button" className={`${s.btn} ${s.sm}`} disabled={busy} onClick={() => call("bankRetire", { questionId: q.id, retired: false }, "Questão reativada.")}>Reativar</button>}
                  </div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
