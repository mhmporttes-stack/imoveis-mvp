"use client";

import s from "./academia.module.css";
import Icon from "./Icon";

// Prova com várias questões (F4). Todas as questões numa tela só, uma resposta por questão (rádio) ou várias (caixas) se a
// questão for de múltipla escolha, envio único. Depois do envio: nota e acertos; reprovado mostra só os TEMAS errados (sem
// gabarito); aprovado mostra o gabarito e a explicação de cada questão. O gabarito nunca chega antes da aprovação.
export default function ExamScreen({ exam, title, on, headingRef, onAnswer, onSubmit, onRetry, onFinish, onBack }) {
  const st = exam?.status;
  const questions = exam?.questions || [];
  const missing = questions.filter((q) => !(exam.answers?.[q.id] || []).length).length;
  const result = exam?.result;
  return (
    <section className={`${s.scr} ${on ? s.on : ""}`} aria-labelledby="acd-eH">
      <div className={s.pbar}>
        <button type="button" className={s.bk} aria-label="Voltar para a aula" onClick={onBack}><Icon name="back" /></button>
        <p>Prova{exam?.maxAttempts ? <span>Tentativa {Math.min((exam.attemptsUsed ?? 0) + (st === "ready" || st === "submitting" ? 1 : 0), exam.maxAttempts)} de {exam.maxAttempts}</span> : <span>Sem limite de tentativas</span>}</p>
      </div>
      <div className={s.pbody}>
        <h1 id="acd-eH" tabIndex={-1} ref={headingRef}>{title}</h1>
        <p className={s.meta}><span>Nota mínima para aprovação: {exam?.passScore ?? 70}%</span></p>

        {st === "loading" || !exam ? <p className={s.tx} role="status">Carregando a prova…</p> : null}
        {st === "error" ? <p className={`${s.fb} ${s.no}`}><Icon name="x" />{exam.error || "Não foi possível carregar a prova."}</p> : null}
        {st === "exhausted" ? <p className={`${s.fb} ${s.no}`}><Icon name="x" />Você usou todas as tentativas desta prova. Fale com seu gestor para liberar uma nova.</p> : null}
        {st === "passed" ? <p className={`${s.fb} ${s.ok}`}><Icon name="check" />Você já foi aprovado nesta prova.</p> : null}

        {st === "ready" || st === "submitting" ? (
          <ol className={s.exList}>
            {questions.map((q, i) => (
              <li key={q.id} className={s.exq}>
                <p className={s.qLab}>Questão {i + 1} de {questions.length}{q.multiple ? " · marque todas as corretas" : ""}</p>
                <h2 className={s.qh} id={`exq-${q.id}`}>{q.stem}</h2>
                <div className={s.opts} role={q.multiple ? "group" : "radiogroup"} aria-labelledby={`exq-${q.id}`}>
                  {q.options.map((o) => {
                    const checked = (exam.answers?.[q.id] || []).includes(o.id);
                    return (
                      <button key={o.id} type="button" role={q.multiple ? "checkbox" : "radio"} aria-checked={checked} className={s.opt} disabled={st === "submitting"} onClick={() => onAnswer(q.id, o.id, q.multiple)}>
                        <span className={q.multiple ? s.cb : s.rd} aria-hidden="true" /><span>{o.text}</span>
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
        ) : null}

        {st === "result" && result ? (
          <div role="status" aria-live="polite">
            <p className={s.exScore}>{String(result.score).replace(".", ",")}%</p>
            <p className={`${s.fb} ${result.passed ? s.ok : s.no}`}>
              {result.passed ? <><Icon name="check" />Aprovado: {result.correctCount} de {result.total} questões certas.</> : <><Icon name="x" />Não atingiu {result.passScore}%: {result.correctCount} de {result.total} questões certas.</>}
            </p>
            {!result.passed && result.wrongTopics.length ? <p className={s.tx}>Revise: {result.wrongTopics.join(", ")}.</p> : null}
            {!result.passed && result.exhausted ? <p className={`${s.fb} ${s.no}`}><Icon name="x" />Você usou todas as tentativas. Fale com seu gestor para liberar uma nova.</p> : null}
            {result.passed && result.review ? (
              <ol className={s.exList}>
                {questions.map((q, i) => {
                  const rv = result.review.find((r) => r.questionId === q.id);
                  const right = new Set(rv?.correctOptionIds || []);
                  return (
                    <li key={q.id} className={s.exq}>
                      <p className={s.qLab}>Questão {i + 1}</p>
                      <h2 className={s.qh}>{q.stem}</h2>
                      <ul className={s.exRev}>
                        {q.options.map((o) => <li key={o.id} className={right.has(o.id) ? s.exRight : ""}>{right.has(o.id) ? <Icon name="check" /> : null}{o.text}</li>)}
                      </ul>
                      {rv?.explanation ? <p className={s.tx}>{rv.explanation}</p> : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </div>
        ) : null}

        {exam?.history?.length ? (
          <div className={s.exHist}>
            <p className={s.qLab}>Suas tentativas</p>
            <ul>{exam.history.map((h) => <li key={h.n}>Tentativa {h.n}: {h.score == null ? "—" : `${String(h.score).replace(".", ",")}%`} · {h.passed ? "aprovado" : "não aprovado"}</li>)}</ul>
          </div>
        ) : null}
      </div>
      <div className={s.sticky}>
        {st === "ready" || st === "submitting" ? (
          <button type="button" className={s.btn} aria-disabled={missing > 0 || st === "submitting" ? "true" : undefined} onClick={() => (missing > 0 ? null : onSubmit())}>
            {st === "submitting" ? "Enviando…" : missing > 0 ? `Responda todas (${missing} faltando)` : "Enviar prova"}
          </button>
        ) : null}
        {st === "result" && result ? (
          result.passed ? <button type="button" className={s.btn} onClick={onFinish}>Continuar</button>
            : result.exhausted ? <button type="button" className={s.btn} onClick={onBack}>Voltar</button>
              : <button type="button" className={s.btn} onClick={onRetry}>Tentar de novo</button>
        ) : null}
        {st === "error" || st === "exhausted" || st === "passed" ? <button type="button" className={s.btn} onClick={onBack}>Voltar</button> : null}
      </div>
    </section>
  );
}
