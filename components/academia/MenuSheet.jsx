"use client";

import { useEffect, useRef, useState } from "react";
import s from "./academia.module.css";

// Opções: <dialog> nativo (foco preso, Esc fecha, fundo inerte). Reduzir movimento (único lugar no celular),
// reiniciar o exemplo COM confirmação (diálogo próprio, nunca confirm() do navegador) e Voltar ao CRM.
export default function MenuSheet({ open, onClose, reduced, onToggleReduce, onReset, backHref, isSample }) {
  const ref = useRef(null);
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) { d.close(); setAsk(false); }
  }, [open]);
  return (
    <dialog ref={ref} className={s.sheet} aria-labelledby="acd-sh-h" onClose={() => { setAsk(false); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {ask ? (
        <>
          <h2 id="acd-sh-h">Reiniciar o exemplo?</h2>
          <p className={s.nt}>O progresso de exemplo volta a 9 de 18 aulas (50%). Nada real é apagado.</p>
          <button type="button" className={`${s.btn} ${s.sm}`} style={{ width: "100%", marginTop: 8 }} autoFocus onClick={() => { setAsk(false); onReset(); }}>Reiniciar</button>
          <button type="button" className={s.shLink} onClick={() => setAsk(false)}>Cancelar</button>
        </>
      ) : (
        <>
          <h2 id="acd-sh-h">Opções</h2>
          {isSample ? <p className={s.nt}>Dados de exemplo: nada aqui é conteúdo ou progresso real.</p> : null}
          <button type="button" className={s.shRow} aria-pressed={reduced} onClick={onToggleReduce}>Reduzir movimento<i className={s.swI} /></button>
          {isSample ? <button type="button" className={s.shLink} onClick={() => setAsk(true)}>Reiniciar exemplo (volta a 50%)</button> : null}
          <a className={s.shLink} href={backHref}>Voltar ao CRM</a>
          <button type="button" className={s.shLink} onClick={onClose}>Fechar</button>
        </>
      )}
    </dialog>
  );
}
