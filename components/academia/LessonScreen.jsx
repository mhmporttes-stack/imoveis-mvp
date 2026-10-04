"use client";

import s from "./academia.module.css";
import Icon from "./Icon";

// Aula: plano sólido claro, sem parallax. Cabeçalho de 1 linha ("Módulo 3 · aula 5 de 5"), conteúdo
// (vem do back; aqui texto de exemplo) e faixa fixa com a ação. Alvos >= 44 px.
export default function LessonScreen({ lesson, on, review, onBack, onNext, headingRef, isSample }) {
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
        <p className={s.tx}>{lesson.content}</p>
      </div>
      <div className={s.sticky}>
        <button type="button" className={s.btn} onClick={onNext}>{review ? "Revisar questão" : "Fazer a questão"} <Icon name="arrow" /></button>
      </div>
    </section>
  );
}
