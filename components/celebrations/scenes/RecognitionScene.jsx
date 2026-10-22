"use client";

import { useMemo, useState } from "react";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import WeldText, { weldLayout } from "@/components/scenes/WeldText";
import scene from "@/components/scenes/scenes.module.css";
import styles from "../celebration.module.css";
import { effectsFor, getParticleQuality, risingMotes } from "../celebrationEffects";

// Cena única de Reconhecimento (visual novo, 2026-10-22) para todos os gatilhos. O que muda por gatilho é só o
// título, o selo e o chip — tudo derivado do próprio gatilho, nunca um número inventado. A mensagem é a do banco
// de textos (já com o nome). A animação escolhida no admin (confete/fogos/moedas/coroa/combo_200) muda as partículas.
const LOOK = {
  daily_goal_100: { kicker: "Meta do dia batida", badge: "100%", chip: "Meta Diária" },
  daily_goal_150: { kicker: "Meta do dia superada", badge: "150%", chip: "Meta Diária" },
  daily_goal_200: { kicker: "Meta do dia em dobro", badge: "200%", chip: "Meta Diária" },
  ranking_no1: { kicker: "Liderança do dia", badge: "1º", chip: "Ranking do dia" },
  goal_streak: { kicker: "Sequência de metas", chip: "Meta Diária" },
  personal_record: { kicker: "Seu melhor dia", chip: "Recorde pessoal" },
  first_of_day: { kicker: "Primeira ação do dia", chip: "Hoje" },
  sales_month_milestone: { kicker: "Marco de vendas do mês", chip: "Vendas no mês" },
  weekly_goal_met: { kicker: "Meta da semana batida", chip: "Meta semanal" },
  monthly_goal_met: { kicker: "Meta do mês batida", chip: "Meta mensal" },
  mcmv_approved: { kicker: "Crédito aprovado", chip: "Cliente aprovado" },
  mcmv_contract: { kicker: "Contrato assinado", chip: "Contrato" },
  mcmv_keys: { kicker: "Chaves entregues", chip: "Chaves" },
  rank_climb: { kicker: "Acima da média do time", chip: "Ranking do dia" },
  birthday: { kicker: "Feliz aniversário", chip: "Aniversário" },
  work_anniversary: { kicker: "Tempo de casa", chip: "Equipe" }
};

const START_MS = 2300;

function lengthClass(text) {
  const length = String(text || "").length;
  if (length <= 32) return styles.short;
  if (length <= 80) return styles.medium;
  return styles.long;
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] || "" : "")).toUpperCase();
}

function todayChip() {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit" })
    .format(new Date()).replace(".", "");
}

export default function RecognitionScene({ message, animation = "confete", triggerKey, userName = "", userPhotoUrl = "", previewMode = false, closeLabel }) {
  const reduced = usePrefersReducedMotion();
  const [quality] = useState(() => getParticleQuality());
  const look = LOOK[triggerKey] || { kicker: "Reconhecimento", chip: "" };
  const layout = useMemo(() => weldLayout(message, { start: START_MS, step: 30, lag: 520, spreadX: 800, spreadY: 460, salt: 91.345 }), [message]);
  const effects = useMemo(() => effectsFor(animation, quality), [animation, quality]);
  const motes = useMemo(() => risingMotes(quality === "low" ? 10 : 18), [quality]);
  const end = layout.end;
  const chips = [
    look.chip ? { label: look.chip } : null,
    { label: "Hoje", value: todayChip() },
    previewMode ? { label: "Prévia" } : { label: "Só você vê" }
  ].filter(Boolean);
  const userInitials = initials(userName);

  return (
    <div className={`${styles.stage} ${reduced ? `${styles.still} ${scene.still}` : ""}`} style={{ "--after": `${end - 300}ms` }}>
      <div className={`${styles.glow} ${effects.crownGlow ? styles.glowGold : ""}`} aria-hidden="true" />
      {!reduced ? (
        <div className={styles.particles} aria-hidden="true">
          {motes.map((item) => <span key={item.key} className={styles.mote} style={item.style} />)}
          <div className={styles.cannons}>
            {effects.cannons.map((item) => <span key={item.key} className={styles.confetti} style={item.style} />)}
          </div>
          {effects.bursts.map((burst) => (
            <span key={burst.key} className={styles.burst} style={burst.style}>
              {burst.sparks.map((item) => <span key={item.key} className={styles.spark} style={item.style} />)}
            </span>
          ))}
          {effects.coins.map((item) => <span key={item.key} className={styles.coin} style={item.style} />)}
        </div>
      ) : null}

      <div className={styles.content}>
        <div className={styles.avatar}>
          <div className={styles.rays} aria-hidden="true" />
          <svg className={styles.ring} viewBox="-16 -16 164 164" aria-hidden="true">
            <circle className={styles.ringTrack} cx="66" cy="66" r="60" fill="none" strokeWidth="5" />
            <circle className={styles.ringNeon} cx="66" cy="66" r="60" fill="none" strokeWidth="5" strokeLinecap="round" />
          </svg>
          <span className={styles.photo}>
            {userPhotoUrl ? (
              <img src={userPhotoUrl} alt={userName || "Sua foto"} />
            ) : userInitials ? (
              <span aria-hidden="true">{userInitials}</span>
            ) : (
              <img className={styles.symbol} src="/assets/matheus-machado-symbol.png" alt="" />
            )}
          </span>
          {look.badge ? <span className={styles.badge}>{look.badge}</span> : null}
          <span className={`${styles.crown} ${effects.crownGlow ? styles.crownGlow : ""}`} aria-hidden="true"><span>♛</span></span>
        </div>

        <p className={styles.kicker}>{look.kicker}</p>
        <p
          className={`${styles.message} ${lengthClass(message)} ${scene.boom}`}
          style={{ "--boom": `${end - 150}ms` }}
          aria-label={message}
        >
          <WeldText layout={layout} />
        </p>
        <div className={styles.line} aria-hidden="true" />
        <div className={styles.chips}>
          {chips.map((chip, i) => (
            <span key={chip.label} className={styles.chip} style={{ animationDelay: `${end + i * 160}ms` }}>
              {chip.value ? <><b>{chip.label}</b> {chip.value}</> : <b>{chip.label}</b>}
            </span>
          ))}
        </div>
        <button type="button" className={styles.close}>{closeLabel}</button>
      </div>
    </div>
  );
}
