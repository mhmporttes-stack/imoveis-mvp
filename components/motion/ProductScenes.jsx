"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useHenryFullscreen } from "@/components/henry/useHenryFullscreen";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { sessionSceneMemory, shouldPlayStatusScene, statusSceneKeys } from "./product-scenes-core.mjs";
import styles from "./ProductScenes.module.css";

// Cenas de produto (2026-10-25, "Todas" aprovadas pelo dono). Peças só de apresentação: quem decide QUANDO tocar é a tela,
// sempre com o que ela já recebeu (resposta da ação ou lista atual) — aqui não há regra de negócio nem consulta.
// Especificação e valores: .claude/design/MOTION.md ("Cenas do produto").

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// ---- Cena 1 · Venda marcada como "Pago" (card da venda no Financeiro, ~2,2 s) ---------------------------------------
// O pai precisa ser `position: relative` (e arredondado: o brilho herda o raio). Selo "PAGO" bate como o carimbo da
// apresentação; um brilho azul passa uma vez. O valor que sobe contando é o <CountUp/> no lugar do número do card.
export function PaidSceneLayer({ above = false }) {
  return (
    <span className={styles.paidLayer} aria-hidden="true" data-scene="paid">
      <span className={styles.paidSheen} />
      <span className={`${styles.paidStamp} ${above ? styles.paidStampAbove : ""}`}>Pago</span>
    </span>
  );
}

// Número que sobe de 0 até o valor, escrito direto no texto (sem setState por quadro). Reduzido = valor final na hora.
export function CountUp({ value, format, delayMs = 450, durationMs = 1100, className = "" }) {
  const ref = useRef(null);
  const reduced = usePrefersReducedMotion();
  useIsoLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (reduced) {
      node.textContent = format(value);
      return undefined;
    }
    let raf = 0;
    const start = performance.now() + delayMs;
    node.textContent = format(0);
    const tick = (now) => {
      if (now < start) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const progress = Math.min(1, (now - start) / durationMs);
      node.textContent = format(value * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      node.textContent = format(value);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced]);
  return <span ref={ref} className={`${styles.paidCount} ${className}`} />;
}

// ---- Cena 2 · Crédito aprovado na CCA (card do cliente, ~1,4 s) ------------------------------------------------------
// `pulseClass` vai no card (escala 0,97 → 1); a camada (faixa + check dentro do anel) vai dentro dele.
export const approvedPulseClass = styles.approvedPulse;

export function ApprovedSceneLayer() {
  return (
    <span className={styles.approvedLayer} aria-hidden="true" data-scene="approved">
      <span className={styles.approvedStrip} />
      <span className={styles.approvedBadge}>
        <svg viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="22" stroke="#d6e6fb" strokeWidth="4" />
          <circle className={styles.approvedRing} cx="32" cy="32" r="22" stroke="#1769d1" strokeWidth="4" strokeLinecap="round" transform="rotate(-90 32 32)" />
          <path className={styles.approvedCheck} d="M22 33 l7 7 l14 -15" stroke="#1769d1" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </span>
  );
}

// Decide quando a cena do aprovado toca para ESTE cliente: a tela viu o status mudar para o alvo (compara com o último
// status visto neste navegador/sessão) e ainda não animou esta mudança. Sem registro anterior não anima (abrir a lista não
// vira festa). Só para o corretor responsável (`enabled`). Com a tela cheia do Henry aberta espera e decide ao fechar.
export function useStatusChangeScene({ id, status, target = "approved", enabled = true }) {
  const henryOpen = useHenryFullscreen();
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!enabled || !id || henryOpen) return;
    const keys = statusSceneKeys(id, status);
    const previous = sessionSceneMemory.read(keys.seen);
    const play = shouldPlayStatusScene({ previous, current: status, target, alreadyAnimated: sessionSceneMemory.read(keys.animated) === "1" });
    sessionSceneMemory.write(keys.seen, status);
    if (!play) return;
    sessionSceneMemory.write(keys.animated, "1");
    setPlaying(true);
  }, [id, status, target, enabled, henryOpen]);
  useEffect(() => {
    if (!playing) return undefined;
    const timer = setTimeout(() => setPlaying(false), 1600);
    return () => clearTimeout(timer);
  }, [playing]);
  return playing;
}

// ---- Cena 3 · Transferência de cliente (lista de Clientes, 700 ms + selo que se apaga em 1,5 s) -----------------------
export const transferOutClass = styles.transferOut;

export function TransferSeal({ name }) {
  return (
    <span className={styles.transferSeal} role="status" data-scene="transfer">
      <svg viewBox="0 0 24 24" fill="none" stroke="#1769d1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h13" />
        <path d="m13 6 6 6-6 6" />
      </svg>
      <span>{name ? `Transferido para ${name}` : "Transferido"}</span>
    </span>
  );
}

// ---- Cena 4 · Primeiro acesso do dia à Meta Diária (cartões 6 + anel, ~1,2 s) ----------------------------------------
export const dailyInClass = styles.dailyIn;
