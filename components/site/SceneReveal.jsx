"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Dispara uma "cena" de entrada quando o bloco aparece na tela (uma vez). Estados em `data-state`:
 *  idle  = tudo visível (sem JavaScript, "reduzir movimento" ligado ou navegador sem IntersectionObserver);
 *  armed = elementos da cena escondidos, esperando aparecer na tela;
 *  go    = a cena roda (o CSS do módulo da cena anima cada peça com seus tempos).
 * Quem decide o que anima e quando é o CSS (AboutScene.module.css); aqui só há o gatilho.
 */
export default function SceneReveal({ className = "", children }) {
  const ref = useRef(null);
  const [state, setState] = useState("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver !== "function") return undefined;
    setState("armed");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setState("go");
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} data-state={state}>
      {children}
    </div>
  );
}
