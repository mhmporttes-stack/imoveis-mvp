"use client";

import { useEffect, useState } from "react";

// Fonte única de "o usuário pediu menos movimento?" para os componentes de
// animação — nunca duplicar essa leitura de matchMedia em cada componente.
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const handler = (event) => setReduced(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  return reduced;
}
