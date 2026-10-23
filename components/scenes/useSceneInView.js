"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import { REVEAL_ROOT_MARGIN } from "@/components/motion/scroll-reveal";
import scene from "@/components/scenes/scenes.module.css";

// Cenas de entrada em sequência (Desempenho, 2026-10-22): a cena toca UMA vez quando o bloco entra na tela
// (IntersectionObserver) e de novo só quando `replayKey` muda (ex.: outro período carregado). Com "reduzir movimento"
// devolve "still" (tudo aparece direto). Sem IntersectionObserver: toca já.
// Fases: "wait" (escondido esperando) → "play" (tocando/tocou) | "still" (sem movimento).
// Mesma linha da entrada por rolagem do painel (scroll-reveal.js: o bloco entra ao passar de 90% da altura da tela):
// a cena de dentro não toca enquanto o bloco que a contém ainda está escondido. Dentro de um bloco que entra por
// rolagem, use delayMs (~300 ms) para a cena começar quando o bloco já está quase no lugar.
export const SCENE_ROOT_MARGIN = REVEAL_ROOT_MARGIN;

export function useSceneInView(ref, { replayKey = "", delayMs = 0, rootMargin = SCENE_ROOT_MARGIN } = {}) {
  const reduced = usePrefersReducedMotion();
  const [playedKey, setPlayedKey] = useState(null);

  useEffect(() => {
    if (reduced) return undefined;
    let timer = 0;
    const go = () => { timer = window.setTimeout(() => setPlayedKey(replayKey), Math.max(0, delayMs)); };
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      go();
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        go();
      }
    }, { rootMargin, threshold: 0 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey, reduced]);

  if (reduced) return "still";
  return playedKey === replayKey ? "play" : "wait";
}

// Props do contêiner da cena: classe, fase e tempos próprios (não usam --mm-motion-*).
// Itens dentro dele: className={scene.item} (ou itemBar/lineRise/pop) + style={sceneIndex(i)}.
export function sceneStaggerProps(phase, { stepMs = 120, durationMs = 600, rise = 14, hop = 6, className = "", style } = {}) {
  return {
    "data-scene": phase,
    className: `${scene.stagger} ${className}`.trim(),
    style: {
      "--scene-step": `${stepMs}ms`,
      "--scene-dur": `${durationMs}ms`,
      "--scene-rise": `${rise}px`,
      "--scene-hop": `${hop}px`,
      ...style
    }
  };
}

export function sceneIndex(i, style) {
  return { "--i": i, ...style };
}
