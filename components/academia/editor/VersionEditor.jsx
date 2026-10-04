"use client";

import { useState } from "react";
import s from "./editor.module.css";
import ConfirmButton from "./ConfirmButton";
import LessonEditor from "./LessonEditor";

const move = (arr, i, d) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };

function ModuleTitle({ mod, editable, run }) {
  const [title, setTitle] = useState(mod.title);
  const [summary, setSummary] = useState(mod.summary || "");
  const dirty = title !== mod.title || summary !== (mod.summary || "");
  return (
    <>
      <label className={`${s.lab} ${s.grow}`} style={{ margin: 0 }}>Módulo
        <input className={s.in} value={title} disabled={!editable} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={`${s.lab} ${s.grow}`} style={{ margin: 0 }}>Resumo (opcional)
        <input className={s.in} value={summary} disabled={!editable} maxLength={400} onChange={(e) => setSummary(e.target.value)} />
      </label>
      {editable ? <button type="button" className={`${s.btn} ${s.pri} ${s.sm}`} style={{ alignSelf: "end" }} disabled={!dirty} onClick={() => run("updateModule", { moduleId: mod.id, title, summary }, "Módulo salvo.")}>Salvar</button> : null}
    </>
  );
}

// Árvore de uma versão: módulos > aulas. Só rascunho é editável; versões publicadas/aposentadas são somente leitura.
export default function VersionEditor({ tree, run, busy }) {
  const { version, modules, validation } = tree;
  const editable = version.editable;
  const [open, setOpen] = useState({});
  const [newModule, setNewModule] = useState("");
  const [newLesson, setNewLesson] = useState({});
  const [note, setNote] = useState("");
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <div>
      <div className={s.card}>
        <div className={s.row}>
          <h2 className={s.grow} style={{ margin: 0 }}>Versão {version.version_number} <span className={`${s.badge} ${s[{ draft: "draft", published: "pub", retired: "old" }[version.status]]}`}>{{ draft: "Rascunho", published: "Publicada", retired: "Aposentada" }[version.status]}</span></h2>
        </div>
        {!editable ? <p className={s.muted}>Esta versão é somente leitura (conteúdo publicado nunca é alterado). Para mudar algo, crie um rascunho a partir dela.</p> : null}
        {editable ? (
          <>
            {validation.blocking.length ? <><p><strong>Para publicar, resolva:</strong></p><ul className={`${s.issues} ${s.bad}`}>{validation.blocking.map((i, k) => <li key={k}>{i.message}</li>)}</ul></> : <p className={`${s.msg} ${s.ok}`}>Pronta para publicar.</p>}
            {validation.warnings.length ? <details><summary className={s.muted}>{validation.warnings.length} aviso(s) (não impedem publicar)</summary><ul className={`${s.issues} ${s.warn}`}>{validation.warnings.map((i, k) => <li key={k}>{i.message}</li>)}</ul></details> : null}
            <label className={s.lab} htmlFor="pubnote">Nota da publicação (o que mudou)</label>
            <input id="pubnote" className={s.in} value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} />
            <div className={s.row} style={{ marginTop: 10 }}>
              <ConfirmButton className={s.pri} disabled={busy || !validation.ok} onConfirm={() => run("publish", { versionId: version.id, note }, "Versão publicada. Alunos novos já entram nela; quem já começou continua na versão anterior.")}>Publicar versão</ConfirmButton>
              <ConfirmButton disabled={busy} onConfirm={() => run("discardDraft", { versionId: version.id }, "Rascunho descartado.", { closeVersion: true })}>Descartar rascunho</ConfirmButton>
            </div>
          </>
        ) : null}
      </div>

      {modules.map((m, mi) => (
        <section key={m.id} className={s.mod} aria-label={`Módulo ${mi + 1}`}>
          <div className={s.modH}>
            <ModuleTitle key={`${m.id}-${m.title}-${m.summary}`} mod={m} editable={editable} run={run} />
            {editable ? <div className={s.row}>
              <button type="button" className={`${s.btn} ${s.sm}`} aria-label="Subir módulo" onClick={() => run("reorder", { kind: "modules", parentId: version.id, orderedIds: move(modules, mi, -1).map((x) => x.id) })}>↑</button>
              <button type="button" className={`${s.btn} ${s.sm}`} aria-label="Descer módulo" onClick={() => run("reorder", { kind: "modules", parentId: version.id, orderedIds: move(modules, mi, 1).map((x) => x.id) })}>↓</button>
              <ConfirmButton onConfirm={() => run("deleteModule", { moduleId: m.id }, "Módulo excluído.")}>Excluir</ConfirmButton>
            </div> : null}
          </div>
          {m.lessons.map((l, li) => (
            <div key={l.id} className={s.lesson}>
              <div className={s.lessonH}>
                <strong>{li + 1}. {l.title}{l.kind === "final_exam" ? " (prova final)" : ""}</strong>
                <span className={s.muted}>{l.est_minutes} min · {l.question ? "com questão" : "sem questão"}</span>
                {editable ? <>
                  <button type="button" className={`${s.btn} ${s.sm}`} aria-label="Subir aula" onClick={() => run("reorder", { kind: "lessons", parentId: m.id, orderedIds: move(m.lessons, li, -1).map((x) => x.id) })}>↑</button>
                  <button type="button" className={`${s.btn} ${s.sm}`} aria-label="Descer aula" onClick={() => run("reorder", { kind: "lessons", parentId: m.id, orderedIds: move(m.lessons, li, 1).map((x) => x.id) })}>↓</button>
                </> : null}
                <button type="button" className={`${s.btn} ${s.sm}`} aria-expanded={Boolean(open[l.id])} onClick={() => toggle(l.id)}>{open[l.id] ? "Fechar" : editable ? "Editar" : "Ver"}</button>
              </div>
              {open[l.id] ? <LessonEditor lesson={l} modules={modules} editable={editable} run={run} /> : null}
            </div>
          ))}
          {editable ? (
            <div className={s.lesson}>
              <div className={s.row}>
                <input className={`${s.in} ${s.grow}`} aria-label={`Título da nova aula no módulo ${mi + 1}`} placeholder="Título da nova aula" maxLength={160} value={newLesson[m.id]?.title || ""} onChange={(e) => setNewLesson((n) => ({ ...n, [m.id]: { ...n[m.id], title: e.target.value } }))} />
                <select className={s.sel} style={{ width: 180 }} aria-label="Tipo da nova aula" value={newLesson[m.id]?.kind || "lesson"} onChange={(e) => setNewLesson((n) => ({ ...n, [m.id]: { ...n[m.id], kind: e.target.value } }))}>
                  <option value="lesson">Aula</option><option value="final_exam">Prova final</option>
                </select>
                <button type="button" className={`${s.btn} ${s.sm}`} disabled={!(newLesson[m.id]?.title || "").trim()} onClick={() => run("addLesson", { moduleId: m.id, title: newLesson[m.id].title, kind: newLesson[m.id].kind || "lesson" }, "Aula adicionada.").then(() => setNewLesson((n) => ({ ...n, [m.id]: {} })))}>+ Aula</button>
              </div>
            </div>
          ) : null}
        </section>
      ))}
      {editable ? (
        <div className={s.card}>
          <div className={s.row}>
            <input className={`${s.in} ${s.grow}`} aria-label="Título do novo módulo" placeholder="Título do novo módulo" maxLength={160} value={newModule} onChange={(e) => setNewModule(e.target.value)} />
            <button type="button" className={`${s.btn} ${s.pri} ${s.sm}`} disabled={!newModule.trim()} onClick={() => run("addModule", { versionId: version.id, title: newModule }, "Módulo adicionado.").then(() => setNewModule(""))}>+ Módulo</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
