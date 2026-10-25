"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import { useSceneHeld } from "@/components/motion/SceneGate";
import scene from "@/components/scenes/scenes.module.css";

// Anel da Meta Diária com a foto do corretor (visual novo, 2026-10-22). Na PRIMEIRA vez que aparece, o anel sobe
// até 100% com uma faísca azul na ponta, dá um pulinho mostrando "100%" e volta até o percentual real (mesmo efeito
// de "sobe e volta" que já existia). Atualizações seguintes (ex.: depois de uma tentativa) animam direto.
// Só apresentação: o percentual vem pronto do servidor (dailyGoalOverallProgress) — nunca recalcular aqui.
// Usado na tela do corretor (DailyGoalDashboard, tamanho padrão) e em cada card da visão da equipe
// (TeamDailyPerformance, menor, com playOnView: a cena só começa quando o card entra na tela, com um pequeno
// atraso escalonado entre os cards).
const R = 60;
const CIRCUMFERENCE = 2 * Math.PI * R; // ≈ 377
const INTRO_S = 3.8;
const PEAK_AT = 0.55;
const HOLD_UNTIL = 0.68;
// Primeiro acesso do dia (cena de 2026-10-25): o anel sobe do zero direto até o percentual real, em ~1,2 s (sem o "sobe e volta").
const DAILY_S = 1.2;

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] || "" : "")).toUpperCase();
}

// Espera o anel entrar na tela (pelo menos 35% visível) e então o atraso pedido. Sem IntersectionObserver: começa já.
function useStartWhenVisible(ref, enabled, delayMs) {
  const [started, setStarted] = useState(!enabled);
  useEffect(() => {
    if (!enabled || started) return undefined;
    let timer = null;
    const go = () => { timer = setTimeout(() => setStarted(true), Math.max(0, delayMs)); };
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      go();
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        go();
      }
    }, { threshold: 0.35 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, started]);
  return started;
}

// `intro`: "daily" = primeiro acesso do dia (sobe do zero em ~1,2 s); "wait" = ainda decidindo (anel espera, vazio); outro = comportamento de sempre.
export default function MetaRing({ percent = 0, name = "", photoUrl = "", size = 160, playOnView = false, delayMs = 0, label = "Meta diária", intro = "" }) {
  const reduced = usePrefersReducedMotion();
  const rootRef = useRef(null);
  // Dentro de um SceneGate (Meta Diária), o anel espera a Cena 2 terminar antes de começar a subir.
  const held = useSceneHeld();
  const started = useStartWhenVisible(rootRef, playOnView, delayMs) && !held && intro !== "wait";
  const real = Math.max(0, Math.round(Number(percent) || 0));
  const ringTarget = Math.min(100, real);
  const value = useMotionValue(0);
  const dashOffset = useTransform(value, (v) => CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, v)) / 100));
  const tipRotate = useTransform(value, (v) => `${Math.min(100, Math.max(0, v)) * 3.6}deg`);
  const mounted = useRef(false);
  const [phase, setPhase] = useState("rise"); // rise → peak → done

  useEffect(() => {
    if (reduced) {
      value.set(ringTarget);
      setPhase("done");
      mounted.current = true;
      return undefined;
    }
    if (!started) return undefined; // aguardando entrar na tela: anel vazio, só a foto
    if (mounted.current) {
      const controls = animate(value, ringTarget, { duration: 0.6, ease: [0.16, 1, 0.3, 1] });
      return () => controls.stop();
    }
    mounted.current = true;
    setPhase("rise");
    if (intro === "daily") {
      const direct = animate(value, ringTarget, { duration: DAILY_S, ease: [0.16, 1, 0.3, 1] });
      const settle = setTimeout(() => setPhase("done"), DAILY_S * 1000);
      return () => {
        direct.stop();
        clearTimeout(settle);
      };
    }
    const controls = animate(value, [0, 100, 100, ringTarget], {
      duration: INTRO_S,
      times: [0, PEAK_AT, HOLD_UNTIL, 1],
      ease: [[0.45, 0.05, 0.55, 1], "linear", [0.5, 0, 0.3, 1]]
    });
    const peak = setTimeout(() => setPhase("peak"), INTRO_S * PEAK_AT * 1000);
    const done = setTimeout(() => setPhase("done"), INTRO_S * (HOLD_UNTIL + 0.08) * 1000);
    return () => {
      controls.stop();
      clearTimeout(peak);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringTarget, reduced, started]);

  const userInitials = initials(name);
  const compact = size < 150;

  return (
    <div
      ref={rootRef}
      className={`${scene.theme} ${scene.metaRing} ${compact ? scene.metaRingCompact : ""} ${phase === "peak" ? scene.metaHop : ""}`}
      style={size !== 160 ? { "--meta-ring-size": `${size}px` } : undefined}
      role="img"
      aria-label={`${label}: ${real}%`}
    >
      <svg viewBox="0 0 132 132" aria-hidden="true">
        <circle cx="66" cy="66" r={R} fill="none" stroke="var(--scene-track)" strokeWidth="7" />
        <motion.circle
          cx="66" cy="66" r={R} fill="none" stroke="var(--scene-accent)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          style={{ strokeDashoffset: dashOffset }}
        />
      </svg>
      <span className={scene.metaPhoto} aria-hidden="true">
        {photoUrl ? <img src={photoUrl} alt="" /> : userInitials || <img src="/assets/matheus-machado-symbol.png" alt="" style={{ width: "58%", height: "auto", objectFit: "contain", filter: "var(--scene-logo-filter)" }} />}
      </span>
      {phase === "rise" && started ? (
        <motion.div className={scene.metaTipArm} style={{ rotate: tipRotate }} aria-hidden="true">
          <span className={scene.metaTip} />
        </motion.div>
      ) : null}
      {phase === "done" ? (
        <span className={`${scene.metaPill} ${real >= 100 ? scene.metaPillDone : ""}`} aria-hidden="true">{real}%</span>
      ) : null}
      <span className={`${scene.metaPill} ${scene.metaPill100} ${phase === "peak" ? scene.on : ""}`} aria-hidden="true">100%</span>
    </div>
  );
}
