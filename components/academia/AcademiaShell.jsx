"use client";

// Shell da Academia: wrapper `.academia-root` com tokens escopados, fontes hospedadas (next/font/local),
// SEM a navegação do CRM. Fundo estático renderizado no servidor (evita o flash antes da cena).
import s from "./academia.module.css";
import { academiaSans, academiaSerif } from "./fonts";

export default function AcademiaShell({ engine, view, reduced, sceneReady, children }) {
  return (
    <div
      ref={engine.ref("root")}
      className={`academia-root ${s.root} ${academiaSerif.variable} ${academiaSans.variable} ${reduced ? s.rm : ""}`}
      data-view={view}
      data-reduced={reduced ? "1" : "0"}
      lang="pt-BR"
    >
      <div className={`${s.backdrop} ${sceneReady ? s.backdropGone : ""}`} aria-hidden="true" />
      {children}
    </div>
  );
}
