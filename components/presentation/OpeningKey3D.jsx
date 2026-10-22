"use client";

import { useEffect, useRef, useState } from "react";
import OpeningAnimation from "./OpeningAnimation";
import styles from "./presentation.module.css";

// Abertura "3D" (dono, 2026-10-22): chave de ouro com o "M" oficial em WebGL (three.js, `opening-key-3d.mjs`).
// A three.js só é baixada aqui, no navegador, por import dinâmico — o resto da apresentação não carrega nada dela.
// Fallback obrigatório (nunca quebra a cena): movimento reduzido → abertura anterior parada; sem WebGL, falha ao carregar
// ou erro na cena → abertura anterior (casa + chave em SVG). Ao sair da cena o loop para e tudo é liberado (dispose).
// `still` = cópia da cena que está saindo (transição de 380 ms): não abre outro contexto WebGL.

function webglAvailable() {
  try {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function OpeningKey3D({ reduced = false, still = false }) {
  const boxRef = useRef(null);
  const [mode, setMode] = useState("3d"); // 3d | fallback
  useEffect(() => {
    if (reduced || still) return undefined;
    const box = boxRef.current;
    if (!box || !webglAvailable()) {
      setMode("fallback");
      return undefined;
    }
    let stop = null;
    let cancelled = false;
    // canvas novo a cada início: um contexto liberado (forceContextLoss) nunca é reaproveitado
    const canvas = document.createElement("canvas");
    canvas.className = styles.open3dCanvas;
    box.appendChild(canvas);
    import("./opening-key-3d.mjs")
      .then(({ startKeyScene }) => {
        if (cancelled) return;
        stop = startKeyScene(canvas);
      })
      .catch(() => {
        if (!cancelled) setMode("fallback");
      });
    const onLost = (event) => {
      event.preventDefault();
      if (!cancelled) setMode("fallback");
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => {
      cancelled = true;
      canvas.removeEventListener("webglcontextlost", onLost);
      try { stop?.(); } catch { /* já liberado */ }
      canvas.remove();
    };
  }, [reduced, still]);

  // a caixa reserva o espaço acima do título (protótipo: 300 px); a cena WebGL sai dela para cima e para baixo, atrás do texto
  return (
    <div className={styles.openStage} aria-hidden="true">
      {still ? null : reduced || mode === "fallback" ? (
        <div className={styles.open3dFallback}>
          <OpeningAnimation reducedMotion={reduced} />
        </div>
      ) : (
        <div ref={boxRef} className={styles.open3d} data-opening-3d="" />
      )}
    </div>
  );
}
