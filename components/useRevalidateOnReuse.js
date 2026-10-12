"use client";

import { useEffect, useRef } from "react";

// Tela reaproveitada pelo navegador (desempenho, 2026-10-12): páginas com `unstable_dynamicStaleTime` podem voltar a ser
// mostradas com os dados de uma visita anterior, sem passar pelo servidor. A página manda um `renderId` aleatório a cada
// renderização no servidor; se esta aba já viu esse id, a tela é reaproveitada e `revalidate` atualiza os dados em
// segundo plano (sem "carregando"). Guarda só ids aleatórios, nenhum dado.
const seenRenderIds = new Set();
// Tela pré-carregada antes do toque (components/AdminWarmup.jsx) chega "nova" mas pode ter sido montada há minutos:
// renderId traz a hora da renderização (lib/render-id.mjs); passou deste limite, também atualiza em segundo plano.
const FRESH_MS = 20000;

export function useRevalidateOnReuse(renderId, revalidate) {
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;
  const checkedRef = useRef(false);
  useEffect(() => {
    if (!renderId || checkedRef.current) return;
    checkedRef.current = true;
    const renderedAt = Number(String(renderId).split(".")[0]);
    const old = Number.isFinite(renderedAt) && renderedAt > 0 && Date.now() - renderedAt > FRESH_MS;
    if (seenRenderIds.has(renderId) || old) revalidateRef.current();
    seenRenderIds.add(renderId);
  }, [renderId]);
}
