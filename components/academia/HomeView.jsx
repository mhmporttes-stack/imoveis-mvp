"use client";

// Início: % herói (Fraunces), rótulo, pino "Você está aqui" preso ao andar e a ação principal
// (Continuar) visível em repouso. Posição/escala vêm do motor (câmera); o texto vem dos dados.
// Os textos iniciais são renderizados no servidor; o motor só reescreve número/rótulo depois.
import { useState } from "react";
import s from "./academia.module.css";
import Icon from "./Icon";

export default function HomeView({ engine, home, active, onAction }) {
  // valores iniciais congelados: depois o motor é dono destes nós (contagem 50→56, rótulo)
  const [init] = useState(() => ({ pct: home.percent, lbl: `${home.done} de ${home.total} aulas`, pin: "Role para subir" }));
  const lesson = home.lesson;
  const act = home.nextAction;
  return (
    <>
      <div className={s.sc + (active ? " " + s.on : "")} ref={engine.refSc("home")} inert={!active} tabIndex={active ? 0 : -1} role="region" aria-label="Rolar para subir o prédio (opcional)">
        <div className={s.spHome} />
      </div>
      <div className={s.pct} ref={engine.ref("pct")} aria-hidden="true" suppressHydrationWarning>
        <span ref={engine.ref("pctNum")} suppressHydrationWarning>{init.pct}</span><span className={s.pctSym}>%</span>
      </div>
      <p className={s.lbl} ref={engine.ref("lbl")} aria-hidden="true">
        <span className={s.a} ref={engine.ref("lblA")}><b>{home.track.title}</b>{" · "}</span><span ref={engine.ref("lblN")} suppressHydrationWarning>{init.lbl}</span>
      </p>
      <div className={s.sr}>
        <p>{home.percent}% concluído: {home.done} de {home.total} aulas da {home.track.title}.</p>
        {lesson && home.module ? <p>Você está no Módulo {home.module.n}, {lesson.label.toLowerCase()}: {lesson.title}, {lesson.minutes} minutos.</p> : null}
      </div>
      <div className={`${s.anc} ${s.pin}`} ref={engine.ref("pin")} inert aria-hidden="true">
        <div className={s.pw}>
          <span className={s.pinDot} />
          <span className={s.pt}><span>Você está aqui</span><span className={s.pd} ref={engine.ref("pinD")} suppressHydrationWarning>{init.pin}</span></span>
        </div>
      </div>
      <div className={s.ctaHome} ref={engine.ref("cta")} inert={!active || act.kind === "none"}>
        {act.kind !== "none" ? (
          <button type="button" className={s.btn} onClick={onAction}>{act.label} <Icon name="arrow" /></button>
        ) : null}
      </div>
    </>
  );
}
