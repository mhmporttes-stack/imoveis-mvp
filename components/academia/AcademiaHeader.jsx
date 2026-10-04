"use client";

// Cabeçalho: marca (ícone oficial "M", sem alteração) + "Academia"; "Voltar ao CRM" sempre visível
// (no PWA não há barra de endereço) e controles. Fica na zona segura superior (safe-area).
import s from "./academia.module.css";
import Icon from "./Icon";
import ReduceMotionToggle from "./ReduceMotionToggle";

export default function AcademiaHeader({ engine, backHref, reduced, isSample, onToggleReduce, onOpenMenu }) {
  return (
    <header className={s.top}>
      <div className={s.brand} ref={engine.ref("brand")}>
        {/* ícone oficial do app (public/icons/icon-192-mm.png): só o raio da borda é CSS */}
        <img className={s.brandImg} src="/icons/icon-192-mm.png" width="36" height="36" alt="Matheus Machado" />
        <span>Academia<small>Matheus Machado</small></span>
        {isSample ? <em className={s.chip}>Dados de exemplo</em> : null}
      </div>
      <div className={s.ctl}>
        <a className={`${s.rb} ${s.ctlSec}`} href={backHref} aria-label="Voltar ao CRM">
          <Icon name="crm" /><span className={s.t}>Voltar ao CRM</span>
        </a>
        <ReduceMotionToggle className={s.ctlRm} pressed={reduced} onToggle={onToggleReduce} />
        <button type="button" className={s.rb} aria-haspopup="dialog" aria-label="Abrir opções" onClick={onOpenMenu}>
          <Icon name="menu" /><span className={s.t}>Opções</span>
        </button>
      </div>
    </header>
  );
}
