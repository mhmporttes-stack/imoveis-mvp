"use client";

import s from "./academia.module.css";
import Icon from "./Icon";

// "Reduzir movimento": estado = preferência do aparelho OU escolha salva. Não enfraquece o modo normal.
export default function ReduceMotionToggle({ pressed, onToggle, className = "" }) {
  return (
    <button type="button" className={`${s.rb} ${className}`} aria-pressed={pressed} aria-label="Reduzir movimento" onClick={onToggle}>
      <Icon name="motion" /><span className={s.t}>Reduzir movimento</span>
    </button>
  );
}
