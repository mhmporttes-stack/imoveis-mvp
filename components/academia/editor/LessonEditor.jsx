"use client";

import { useState } from "react";
import s from "./editor.module.css";
import ConfirmButton from "./ConfirmButton";
import ExamComposer from "./ExamComposer";

const BLOCK_LABEL = { heading: "Título", paragraph: "Parágrafo", list: "Lista", callout: "Destaque" };
const ACT_LABEL = { tip: "Dica", example: "Exemplo", checklist: "Lista de verificação" };
const move = (arr, i, d) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };

// Conteúdo da aula: lista de blocos (texto puro). Lista = um item por linha.
function BlocksEditor({ lesson, editable, run }) {
  const [blocks, setBlocks] = useState(() => (lesson.body?.blocks || []).map((b) => ({ type: b.type, text: b.type === "list" ? (b.items || []).join("\n") : b.text || "" })));
  const set = (i, patch) => setBlocks((bs) => bs.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  const save = () => run("updateLesson", {
    lessonId: lesson.id,
    blocks: blocks.filter((b) => b.text.trim()).map((b) => (b.type === "list" ? { type: "list", items: b.text.split("\n").map((x) => x.trim()).filter(Boolean) } : { type: b.type, text: b.text.trim() }))
  }, "Conteúdo salvo.");
  return (
    <div className={s.sub}>
      <h3>Conteúdo da aula</h3>
      {lesson.body?.sample ? <p className={s.muted}>Esta aula ainda tem texto de exemplo. Ao salvar, ele é substituído.</p> : null}
      {blocks.map((b, i) => (
        <div key={i} className={s.blk}>
          <select className={s.sel} aria-label={`Tipo do bloco ${i + 1}`} value={b.type} disabled={!editable} onChange={(e) => set(i, { type: e.target.value })}>
            {Object.entries(BLOCK_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <textarea className={s.ta} aria-label={`Texto do bloco ${i + 1}${b.type === "list" ? " (um item por linha)" : ""}`} value={b.text} disabled={!editable} maxLength={4000} onChange={(e) => set(i, { text: e.target.value })} />
          {editable ? (
            <div className={s.row}>
              <button type="button" className={`${s.btn} ${s.sm}`} aria-label="Subir bloco" onClick={() => setBlocks((bs) => move(bs, i, -1))}>↑</button>
              <button type="button" className={`${s.btn} ${s.sm}`} aria-label="Descer bloco" onClick={() => setBlocks((bs) => move(bs, i, 1))}>↓</button>
              <button type="button" className={`${s.btn} ${s.sm} ${s.danger}`} aria-label="Remover bloco" onClick={() => setBlocks((bs) => bs.filter((_, k) => k !== i))}>Remover</button>
            </div>
          ) : <span />}
        </div>
      ))}
      {editable ? (
        <div className={s.row}>
          <button type="button" className={`${s.btn} ${s.sm}`} onClick={() => setBlocks((bs) => [...bs, { type: "paragraph", text: "" }])}>+ Adicionar bloco</button>
          <button type="button" className={`${s.btn} ${s.pri} ${s.sm}`} onClick={save}>Salvar conteúdo</button>
        </div>
      ) : null}
    </div>
  );
}

// Questão da aula (quiz; na aula de prova final é a prova). Resposta correta marcada aqui; o aluno nunca a recebe antes de acertar.
function QuestionEditor({ lesson, editable, run }) {
  const q = lesson.question && !lesson.question.missing ? lesson.question : null;
  const [statement, setStatement] = useState(q?.statement || "");
  const [options, setOptions] = useState(() => (q ? q.options.map((o) => o.text) : ["", ""]));
  const [correct, setCorrect] = useState(() => (q ? q.options.map((o, i) => (q.correct.includes(o.id) ? i : -1)).filter((i) => i >= 0) : [0]));
  const [multiple, setMultiple] = useState(q?.type === "multi");
  const [explanation, setExplanation] = useState(q?.explanation || "");
  const toggle = (i) => setCorrect((c) => (multiple ? (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]) : [i]));
  const removeOpt = (i) => { setOptions((o) => o.filter((_, k) => k !== i)); setCorrect((c) => c.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x))); };
  return (
    <div className={s.sub}>
      <h3>{lesson.kind === "final_exam" ? "Questão da prova final" : "Questão da aula"}</h3>
      {lesson.question?.maxAttempts ? <p className={s.muted}>Prova com no máximo {lesson.question.maxAttempts} tentativas (+1 liberada manualmente). Nota mínima: 70%.</p> : <p className={s.muted}>Sem limite de tentativas. Nota mínima: 70%.</p>}
      <label className={s.lab} htmlFor={`st-${lesson.id}`}>Enunciado</label>
      <textarea id={`st-${lesson.id}`} className={s.ta} value={statement} disabled={!editable} maxLength={600} onChange={(e) => setStatement(e.target.value)} />
      <label className={s.lab}><input type="checkbox" checked={multiple} disabled={!editable} onChange={(e) => { setMultiple(e.target.checked); setCorrect((c) => (e.target.checked ? c : c.slice(0, 1))); }} /> Mais de uma resposta correta</label>
      <p className={s.lab}>Alternativas (marque a correta)</p>
      {options.map((text, i) => (
        <div key={i} className={s.opt}>
          <input type={multiple ? "checkbox" : "radio"} name={`co-${lesson.id}`} aria-label={`Alternativa ${i + 1} é a correta`} checked={correct.includes(i)} disabled={!editable} onChange={() => toggle(i)} />
          <input className={s.in} aria-label={`Texto da alternativa ${i + 1}`} value={text} disabled={!editable} maxLength={300} onChange={(e) => setOptions((o) => o.map((t, k) => (k === i ? e.target.value : t)))} />
          {editable && options.length > 2 ? <button type="button" className={`${s.btn} ${s.sm} ${s.danger}`} aria-label={`Remover alternativa ${i + 1}`} onClick={() => removeOpt(i)}>×</button> : <span />}
        </div>
      ))}
      {editable && options.length < 6 ? <button type="button" className={`${s.btn} ${s.sm}`} onClick={() => setOptions((o) => [...o, ""])}>+ Alternativa</button> : null}
      <label className={s.lab} htmlFor={`ex-${lesson.id}`}>Explicação (aparece só depois que o aluno acerta)</label>
      <textarea id={`ex-${lesson.id}`} className={s.ta} value={explanation} disabled={!editable} maxLength={600} onChange={(e) => setExplanation(e.target.value)} />
      {editable ? (
        <div className={s.row} style={{ marginTop: 10 }}>
          <button type="button" className={`${s.btn} ${s.pri} ${s.sm}`} onClick={() => run("setQuestion", { lessonId: lesson.id, statement, options, correct, multiple, explanation }, "Questão salva.")}>Salvar questão</button>
          {q ? <ConfirmButton onConfirm={() => run("removeQuestion", { lessonId: lesson.id }, "Questão removida.")}>Remover questão</ConfirmButton> : null}
        </div>
      ) : null}
    </div>
  );
}

function ActivityEditor({ activity, editable, run, onUp, onDown }) {
  const isList = activity.kind === "checklist";
  const [title, setTitle] = useState(activity.config?.title || "");
  const [text, setText] = useState(isList ? (activity.config?.items || []).join("\n") : activity.config?.text || "");
  const save = () => run("updateActivity", {
    activityId: activity.id,
    config: { ...(title.trim() ? { title: title.trim() } : {}), ...(isList ? { items: text.split("\n").map((x) => x.trim()).filter(Boolean) } : { text: text.trim() }) }
  }, "Atividade salva.");
  return (
    <div className={s.sub}>
      <div className={s.row}><strong className={s.grow}>{ACT_LABEL[activity.kind]}</strong>
        {editable ? <>
          <button type="button" className={`${s.btn} ${s.sm}`} aria-label="Subir atividade" onClick={onUp}>↑</button>
          <button type="button" className={`${s.btn} ${s.sm}`} aria-label="Descer atividade" onClick={onDown}>↓</button>
          <ConfirmButton onConfirm={() => run("deleteActivity", { activityId: activity.id }, "Atividade removida.")}>Remover</ConfirmButton>
        </> : null}
      </div>
      <label className={s.lab}>Título (opcional)<input className={s.in} value={title} disabled={!editable} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className={s.lab}>{isList ? "Itens (um por linha)" : "Texto"}<textarea className={s.ta} value={text} disabled={!editable} maxLength={4000} onChange={(e) => setText(e.target.value)} /></label>
      {editable ? <button type="button" className={`${s.btn} ${s.pri} ${s.sm}`} onClick={save}>Salvar atividade</button> : null}
    </div>
  );
}

export default function LessonEditor({ lesson, modules, editable, run, bank }) {
  const [title, setTitle] = useState(lesson.title);
  const [minutes, setMinutes] = useState(String(lesson.est_minutes));
  const [newKind, setNewKind] = useState("tip");
  const [targetModule, setTargetModule] = useState("");
  const here = modules.find((m) => m.lessons.some((l) => l.id === lesson.id));
  const reorderActs = (i, d) => run("reorder", { kind: "activities", parentId: lesson.id, orderedIds: move(lesson.activities, i, d).map((a) => a.id) });
  return (
    <div>
      <div className={s.row}>
        <label className={`${s.lab} ${s.grow}`}>Título da aula<input className={s.in} value={title} disabled={!editable} maxLength={160} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className={s.lab} style={{ width: 120 }}>Minutos<input className={s.in} inputMode="numeric" value={minutes} disabled={!editable} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))} /></label>
        {editable ? <button type="button" className={`${s.btn} ${s.pri} ${s.sm}`} style={{ alignSelf: "end" }} onClick={() => run("updateLesson", { lessonId: lesson.id, title, estMinutes: Number(minutes || 0) }, "Aula salva.")}>Salvar</button> : null}
      </div>
      <BlocksEditor key={`b-${lesson.id}-${JSON.stringify(lesson.body?.blocks || [])}`} lesson={lesson} editable={editable} run={run} />
      <QuestionEditor key={`q-${lesson.id}-${lesson.question?.id || "none"}`} lesson={lesson} editable={editable} run={run} />
      <ExamComposer key={`x-${lesson.id}-${lesson.exam?.examId || "none"}-${lesson.exam?.questions?.length || 0}`} target={{ lessonId: lesson.id }} exam={lesson.exam && lesson.exam.questions.length > 1 ? lesson.exam : null}
        bank={bank} editable={editable} run={run} title={lesson.kind === "final_exam" ? "Prova final com várias questões (do banco)" : "Prova com várias questões (do banco)"} />
      <div className={s.sub}>
        <h3>Atividades da aula</h3>
        {lesson.activities.length === 0 ? <p className={s.muted}>Nenhuma atividade.</p> : null}
        {lesson.activities.map((a, i) => <ActivityEditor key={`${a.id}-${JSON.stringify(a.config)}`} activity={a} editable={editable} run={run} onUp={() => reorderActs(i, -1)} onDown={() => reorderActs(i, 1)} />)}
        {editable ? (
          <div className={s.row}>
            <select className={s.sel} style={{ width: 220 }} aria-label="Tipo da nova atividade" value={newKind} onChange={(e) => setNewKind(e.target.value)}>
              {Object.entries(ACT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" className={`${s.btn} ${s.sm}`} onClick={() => run("addActivity", { lessonId: lesson.id, kind: newKind, config: newKind === "checklist" ? { items: ["Novo item"] } : { text: "Novo texto" } }, "Atividade adicionada.")}>+ Adicionar atividade</button>
          </div>
        ) : null}
      </div>
      {editable ? (
        <div className={s.row}>
          <select className={s.sel} style={{ width: 260 }} aria-label="Mover a aula para o módulo" value={targetModule} onChange={(e) => setTargetModule(e.target.value)}>
            <option value="">Mover para outro módulo…</option>
            {modules.filter((m) => m.id !== here?.id).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          <button type="button" className={`${s.btn} ${s.sm}`} disabled={!targetModule} onClick={() => run("moveLesson", { lessonId: lesson.id, toModuleId: targetModule }, "Aula movida.")}>Mover</button>
          <ConfirmButton onConfirm={() => run("deleteLesson", { lessonId: lesson.id }, "Aula removida.")}>Excluir aula</ConfirmButton>
        </div>
      ) : null}
    </div>
  );
}
