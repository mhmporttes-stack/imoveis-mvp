"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import scene from "@/components/scenes/scenes.module.css";

// Anel da Meta Diária com a foto do corretor (visual novo, 2026-10-22). Na PRIMEIRA vez que aparece, o anel sobe
// até 100% com uma faísca azul na ponta, dá um pulinho mostrando "100%" e volta até o percentual real (mesmo efeito
// de "sobe e volta" que já existia). Atualizações seguintes (ex.: depois de uma tentativa) animam direto.
// Só apresentação: o percentual vem pronto do servidor (dailyGoalOverallProgress).
const R = 60;
const CIRCUMFERENCE = 2 * Math.PI * R; // ≈ 377
const INTRO_S = 3.8;
const PEAK_AT = 0.55;
const HOLD_UNTIL = 0.68;

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] || "" : "")).toUpperCase();
}

export default function DailyGoalRing({ percent = 0, name = "", photoUrl = "" }) {
  const reduced = usePrefersReducedMotion();
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
    if (mounted.current) {
      const controls = animate(value, ringTarget, { duration: 0.6, ease: [0.16, 1, 0.3, 1] });
      return () => controls.stop();
    }
    mounted.current = true;
    setPhase("rise");
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
  }, [ringTarget, reduced]);

  const userInitials = initials(name);

  return (
    <div className={`${scene.theme} ${scene.metaRing} ${phase === "peak" ? scene.metaHop : ""}`} role="img" aria-label={`Meta diária: ${real}%`}>
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
      {phase === "rise" ? (
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
