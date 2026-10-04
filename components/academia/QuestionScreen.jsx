"use client";

import s from "./academia.module.css";
import Icon from "./Icon";

// Questão: radiogroup real (setas movem a escolha), "Responder" com aria-disabled até escolher,
// feedback em região viva e sempre com ícone + texto (nunca só cor). Gabarito só aparece depois de acertar.
export default function QuestionScreen({ quiz, on, sel, answered, actionLabel, onSelect, onAction, onBack, headingRef }) {
  const q = quiz.question;
  const status = answered ? quiz.status : "unanswered";
  const checkedIdx = answered ? q.options.findIndex((o) => o.id === quiz.selectedOptionId) : sel;
  const key = (e, i) => {
    if (answered) return;
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + q.options.length) % q.options.length;
    onSelect(n);
    e.currentTarget.parentElement.children[n]?.focus();
  };
  return (
    <section className={`${s.scr} ${on ? s.on : ""}`} aria-labelledby="acd-qH">
      <div className={s.pbar}>
        <button type="button" className={s.bk} aria-label="Voltar para a aula" onClick={onBack}><Icon name="back" /></button>
        <p>Questão de exemplo<span>Sem tempo limite</span></p>
      </div>
      <div className={s.pbody}>
        <p className={s.qLab}>Escolha uma alternativa</p>
        <h2 className={s.qh} id="acd-qH" tabIndex={-1} ref={headingRef}>{q.stem}</h2>
        <div className={s.opts} role="radiogroup" aria-labelledby="acd-qH">
          {q.options.map((o, i) => {
            const checked = checkedIdx === i;
            const cls = `${s.opt} ${checked && status === "correct" ? s.ok : ""} ${checked && status === "incorrect" ? s.no : ""}`;
            return (
              <button key={o.id} type="button" role="radio" aria-checked={checked} className={cls} tabIndex={checked || (checkedIdx < 0 && i === 0) ? 0 : -1}
                disabled={false} onKeyDown={(e) => key(e, i)} onClick={() => { if (!answered) onSelect(i); }}>
                <span className={s.rd} aria-hidden="true" /><span>{o.text}</span>
              </button>
            );
          })}
        </div>
        <div className={`${s.fb} ${status === "correct" ? s.ok : status === "incorrect" ? s.no : ""}`} >
          {status === "correct" ? <><Icon name="check" />{quiz.feedback || "Correto."}</> : null}
          {status === "incorrect" ? <><Icon name="x" />Não foi dessa vez. {quiz.feedback ? "" : "Tente de novo."}</> : null}
        </div>
      </div>
      <div className={s.sticky}>
        <button type="button" className={s.btn} aria-disabled={status === "unanswered" && sel === null ? "true" : undefined} onClick={onAction}>{actionLabel}</button>
      </div>
    </section>
  );
}
