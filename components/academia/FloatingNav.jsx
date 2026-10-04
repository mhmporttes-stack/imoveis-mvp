"use client";

import s from "./academia.module.css";
import Icon from "./Icon";

const ITEMS = [["home", "Início", "home"], ["trilha", "Trilha", "route"], ["evo", "Evolução", "grow"]];

// Pílula flutuante Início | Trilha | Evolução. Navegação por estado (câmera única), sem trocar de página.
export default function FloatingNav({ engine, view, onGo }) {
  const active = ITEMS.some((i) => i[0] === view);
  return (
    <>
      <div className={s.navfade} aria-hidden="true" />
      <nav className={s.nav} ref={engine.ref("nav")} aria-label="Seções da Academia" inert={!active}>
        {ITEMS.map(([k, label, icon]) => (
          <button key={k} type="button" aria-current={view === k ? "page" : undefined} onClick={() => onGo(k)}>
            <Icon name={icon} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
