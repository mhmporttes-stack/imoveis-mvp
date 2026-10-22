"use client";

import { useEffect, useRef, useState } from "react";
import { animate } from "motion/react";

// Número que conta de 0 até o valor quando a cena toca (phase "play", de useSceneInView), depois do atraso da linha.
// SEMPRE termina no valor exato recebido (já calculado no servidor; aqui só a exibição). Em "still" (reduzir
// movimento) ou "wait" mostra o valor final direto (em "wait" o item já está escondido pela cena). Leitores de tela
// leem só o valor final.
export default function SceneCount({ value, phase, delayMs = 0, durationMs = 700, format = (n) => String(n), className = "" }) {
  const target = Number(value || 0);
  const [shown, setShown] = useState(target);
  const playedFor = useRef(null);

  useEffect(() => {
    if (phase !== "play" || !Number.isFinite(target)) {
      if (phase !== "play") playedFor.current = null;
      setShown(target);
      return undefined;
    }
    // Já contou nesta cena e só o número mudou (atualização silenciosa): vai direto, sem recontar.
    if (playedFor.current !== null) {
      setShown(target);
      return undefined;
    }
    playedFor.current = target;
    let done = false;
    setShown(0);
    const controls = animate(0, target, {
      duration: durationMs / 1000,
      delay: delayMs / 1000,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setShown(Math.round(latest)),
      onComplete: () => { done = true; setShown(target); }
    });
    return () => {
      controls.stop();
      // Interrompida antes do fim (troca de valor, desmontagem/StrictMode): a próxima cena pode contar de novo.
      if (!done) playedFor.current = null;
      setShown(target);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, target]);

  return (
    <>
      <span className={className} aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(target)}</span>
    </>
  );
}
