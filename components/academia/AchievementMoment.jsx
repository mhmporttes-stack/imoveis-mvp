"use client";

import s from "./academia.module.css";
import Icon from "./Icon";

// Conquista: primeiro a câmera (recua, anoitece, o andar acende e o contador sobe), depois o texto.
// O texto "de 50% para 56%" existe também em movimento reduzido (informação equivalente).
export default function AchievementMoment({ a, on, show, canCertificate, onNext, onEvo, headingRef }) {
  const done = a.moduleCompleted;
  const title = done ? `Módulo ${done.n} concluído` : "Aula concluída";
  const text = `${a.text}${a.nextModule ? ` Próximo: Módulo ${a.nextModule.n}, ${a.nextModule.title}.` : ""}`;
  const nextLabel = canCertificate ? "Ver certificado" : a.nextModule ? "Ver o próximo módulo" : "Ver a trilha";
  return (
    <section className={`${s.mom} ${s.onDark} ${on ? s.on : ""} ${show ? s.show : ""}`} aria-labelledby="acd-cqH" inert={!on}>
      <div className={s.cq}>
        <h2 className={s.cqH} id="acd-cqH" tabIndex={-1} ref={headingRef}>{title}</h2>
        <p className={s.cqTxt}>{text}</p>
        <div className={s.cqActs}>
          <button type="button" className={`${s.btn} ${s.lite}`} onClick={onNext}>{nextLabel} <Icon name="arrow" /></button>
          <button type="button" className={`${s.btn} ${s.alt}`} onClick={onEvo}>Ver minha evolução</button>
        </div>
      </div>
    </section>
  );
}
