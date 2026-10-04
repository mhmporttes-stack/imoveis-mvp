"use client";

import { useEffect, useState } from "react";
import s from "./editor.module.css";

// Botão destrutivo de 2 cliques: o 1º pede confirmação (volta ao normal em 4 s ou ao perder o foco).
export default function ConfirmButton({ onConfirm, children, className = "", ...rest }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button type="button" className={`${s.btn} ${s.sm} ${s.danger} ${className}`} onBlur={() => setArmed(false)}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }} {...rest}>
      {armed ? "Confirmar?" : children}
    </button>
  );
}
