"use client";

import { useState } from "react";
import s from "./editor.module.css";
import ConfirmButton from "./ConfirmButton";

const move = (arr, i, d) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };

// Prova com várias questões do BANCO (F4), para uma aula (quiz/prova final) ou para um módulo (prova de módulo).
// Nota mínima: 70% por padrão; pode subir até 100%, nunca abaixo de 70. Limite de tentativas: 3 em prova de módulo/final
// (vem da versão); quiz de aula sem limite. "Sortear" escolhe N das questões a cada tentativa (mesmas questões em cada tentativa).
export default function ExamComposer({ target, exam, bank, editable, run, title }) {
  const [picked, setPicked] = useState(() => (exam?.questions || []).map((q) => q.id));
  const [mode, setMode] = useState(exam?.selection?.mode === "random" ? "random" : "fixed");
  const [count, setCount] = useState(String(exam?.selection?.count || 1));
  const [pass, setPass] = useState(exam?.passScore ? String(exam.passScore) : "");
  const [filter, setFilter] = useState("");
  const [add, setAdd] = useState("");
  const byId = new Map([...(bank || []).map((q) => [q.id, q]), ...(exam?.questions || []).map((q) => [q.id, { ...q, status: q.retired ? "retired" : "active" }])]);
  const used = new Set(picked.map((id) => byId.get(id)?.stableKey).filter(Boolean));
  const candidates = (bank || []).filter((q) => q.status === "active" && !picked.includes(q.id) && !used.has(q.stableKey)
    && (!filter.trim() || `${q.statement} ${q.topic || ""}`.toLowerCase().includes(filter.trim().toLowerCase())));
  const maxPass = 100;
  const save = () => run("setExam", { ...target, questionIds: picked, mode, count: mode === "random" ? Number(count) : undefined, passScore: pass.trim() ? Number(pass) : null }, "Prova salva.");
  return (
    <div className={s.sub}>
      <h3>{title}</h3>
      <p className={s.muted}>{exam ? `${exam.questions.length} questão(ões) · ${exam.selection?.mode === "random" ? `sorteia ${exam.selection.count} por tentativa` : "todas as questões"} · nota mínima ${exam.passScore || 70}%${exam.maxAttempts ? ` · ${exam.maxAttempts} tentativas (+1 liberada manualmente)` : " · sem limite de tentativas"}` : "Sem prova com várias questões."}</p>
      {picked.map((id, i) => {
        const q = byId.get(id);
        return (
          <div key={id} className={s.opt} style={{ gridTemplateColumns: "1fr auto" }}>
            <span>{i + 1}. {q?.statement || "Questão"}{q?.topic ? <em className={s.muted}> · {q.topic}</em> : null}{q?.status === "retired" ? <strong className={s.muted}> (aposentada)</strong> : null}</span>
            {editable ? (
              <span className={s.row}>
                <button type="button" className={`${s.btn} ${s.sm}`} aria-label="Subir questão" onClick={() => setPicked((p) => move(p, i, -1))}>↑</button>
                <button type="button" className={`${s.btn} ${s.sm}`} aria-label="Descer questão" onClick={() => setPicked((p) => move(p, i, 1))}>↓</button>
                <button type="button" className={`${s.btn} ${s.sm} ${s.danger}`} aria-label="Tirar da prova" onClick={() => setPicked((p) => p.filter((x) => x !== id))}>×</button>
              </span>
            ) : null}
          </div>
        );
      })}
      {editable ? (
        <>
          <div className={s.row}>
            <input className={`${s.in} ${s.grow}`} aria-label="Filtrar o banco por texto ou tema" placeholder="Filtrar o banco (texto ou tema)" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <select className={`${s.sel} ${s.grow}`} aria-label="Adicionar questão do banco" value={add} onChange={(e) => setAdd(e.target.value)}>
              <option value="">Escolha uma questão do banco…</option>
              {candidates.slice(0, 200).map((q) => <option key={q.id} value={q.id}>{q.statement.slice(0, 90)}{q.topic ? ` · ${q.topic}` : ""}</option>)}
            </select>
            <button type="button" className={`${s.btn} ${s.sm}`} disabled={!add} onClick={() => { setPicked((p) => [...p, add]); setAdd(""); }}>+ Adicionar</button>
          </div>
          <div className={s.row} style={{ marginTop: 10 }}>
            <label className={s.lab} style={{ margin: 0 }}>Seleção
              <select className={s.sel} value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="fixed">Todas as questões</option>
                <option value="random">Sortear N por tentativa</option>
              </select>
            </label>
            {mode === "random" ? <label className={s.lab} style={{ margin: 0, width: 130 }}>Quantas<input className={s.in} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 3))} /></label> : null}
            <label className={s.lab} style={{ margin: 0, width: 190 }}>Nota mínima (70 a {maxPass})<input className={s.in} inputMode="numeric" placeholder="70" value={pass} onChange={(e) => setPass(e.target.value.replace(/\D/g, "").slice(0, 3))} /></label>
          </div>
          <div className={s.row} style={{ marginTop: 10 }}>
            <button type="button" className={`${s.btn} ${s.pri} ${s.sm}`} disabled={!picked.length} onClick={save}>Salvar prova</button>
            {exam ? <ConfirmButton onConfirm={() => run("removeExam", target, "Prova removida.")}>Remover prova</ConfirmButton> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
