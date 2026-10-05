"use client";

import { House, KeyRound } from "lucide-react";
import styles from "./presentation.module.css";

// PONTO DE EXTENSÃO da animação de abertura (cena 1 da apresentação). Isolado de propósito: o acabamento visual
// (a animação da chave) é trabalho do design e substitui só o MIOLO deste componente, sem tocar no player.
// Interface estável:
//   durationMs     duração total da animação (padrão 2650 ms; as etapas internas são frações dela)
//   reducedMotion  true = estado final estático, sem movimento (o player passa o valor de prefers-reduced-motion)
// Decorativo (aria-hidden): o texto da cena é que informa. Sem áudio, sem biblioteca de animação.
export const OPENING_ANIMATION_DEFAULT_MS = 2650;

export default function OpeningAnimation({ durationMs = OPENING_ANIMATION_DEFAULT_MS, reducedMotion = false }) {
  const total = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : OPENING_ANIMATION_DEFAULT_MS;
  return (
    <div
      className={`${styles.track} ${reducedMotion ? styles.trackStatic : ""}`}
      style={{ "--open-dur": `${total}ms` }}
      aria-hidden="true"
      data-opening-animation=""
    >
      <span className={styles.trackLine} />
      <span className={`${styles.node} ${styles.nodeKey}`}><KeyRound /></span>
      <span className={`${styles.node} ${styles.nodeHouse}`}><House /></span>
    </div>
  );
}
