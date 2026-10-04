"use client";

import s from "./academia.module.css";
import Icon from "./Icon";

// Aula: plano sólido claro, sem parallax. Cabeçalho de 1 linha ("Módulo 3 · aula 5 de 5"), conteúdo
// (vem do back; aqui texto de exemplo) e faixa fixa com a ação. Alvos >= 44 px.
const ACT_LABEL = { tip: "Dica", example: "Exemplo", checklist: "Lista de verificação" };

// Corpo da aula (F3): blocos de texto puro (heading, paragraph, list, callout), sempre escapados pelo React.
function Blocks({ blocks, fallback }) {
  if (!blocks?.length) return <p className={s.tx}>{fallback}</p>;
  return blocks.map((b, i) => {
    if (b.type === "heading") return <h2 key={i} className={s.blkH}>{b.text}</h2>;
    if (b.type === "list") return <ul key={i} className={s.blkL}>{(b.items || []).map((it, j) => <li key={j}>{it}</li>)}</ul>;
    if (b.type === "callout") return <p key={i} className={s.blkC}>{b.text}</p>;
    return <p key={i} className={s.tx}>{b.text}</p>;
  });
}

// Atividades da aula (F3): dica, exemplo e lista de verificação. Só leitura (nada é gravado por elas).
function Activities({ items }) {
  if (!items?.length) return null;
  return items.map((a) => (
    <aside key={a.id} className={s.act} aria-label={ACT_LABEL[a.kind] || "Atividade"}>
      <p className={s.actK}>{ACT_LABEL[a.kind] || "Atividade"}</p>
      {a.config?.title ? <h3>{a.config.title}</h3> : null}
      {a.kind === "checklist"
        ? <ul>{(a.config?.items || []).map((it, j) => <li key={j}>{it}</li>)}</ul>
        : <p>{a.config?.text}</p>}
    </aside>
  ));
}

export default function LessonScreen({ lesson, on, review, onBack, onNext, headingRef, isSample }) {
  const hasQuiz = lesson.hasQuiz !== false;
  const label = lesson.multiExam ? (review ? "Revisar prova" : "Fazer a prova") : hasQuiz ? (review ? "Revisar questão" : "Fazer a questão") : review ? "Voltar à trilha" : "Concluir aula";
  return (
    <section className={`${s.scr} ${on ? s.on : ""}`} aria-labelledby="acd-aH">
      <div className={s.pbar}>
        <button type="button" className={s.bk} aria-label="Voltar para a trilha" onClick={onBack}><Icon name="back" /></button>
        <p>Módulo {lesson.moduleN} · aula {lesson.index} de {lesson.of}<span>{lesson.moduleTitle}</span></p>
      </div>
      <div className={s.pbody}>
        <div className={s.vid} aria-hidden="true">
          <svg className={s.vidH} viewBox="0 0 120 90" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round"><path d="M10 45L60 8l50 37v37H10z" /><path d="M50 82V56h20v26" /><rect x="82" y="52" width="14" height="14" /></svg>
        </div>
        <h1 id="acd-aH" tabIndex={-1} ref={headingRef}>{lesson.title}</h1>
        <p className={s.meta}><span><Icon name="clock" size={18} />{lesson.minutes} min</span>{isSample ? <span>Conteúdo de exemplo</span> : null}</p>
        <Blocks blocks={lesson.blocks} fallback={lesson.content} />
        <Activities items={lesson.activities} />
      </div>
      <div className={s.sticky}>
        <button type="button" className={s.btn} onClick={onNext}>{label} <Icon name="arrow" /></button>
      </div>
    </section>
  );
}
