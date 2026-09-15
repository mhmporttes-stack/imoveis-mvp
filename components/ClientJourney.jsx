"use client";
import { useEffect, useState } from "react";
import { Cormorant_Garamond } from "next/font/google";
import { UserRound, KeyRound, House, MessageCircle } from "lucide-react";
import { isJourneyCelebrating } from "@/lib/journey-presentation";
import styles from "./ClientJourney.module.css";

// Usada apenas na frase de encerramento (ver .closingQuote no CSS) — o
// restante da página mantém a tipografia padrão da aplicação.
const closingFont = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"], display: "swap", variable: "--font-closing" });

export default function ClientJourney({ data, preview = false }) {
  const [celebrating, setCelebrating] = useState(() => isJourneyCelebrating(data.changedAt));
  const [moving, setMoving] = useState(false);
  const [arrived, setArrived] = useState(() => !isJourneyCelebrating(data.changedAt));
  useEffect(() => {
    const active = isJourneyCelebrating(data.changedAt);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setCelebrating(active);
    setMoving(false);
    setArrived(!active || reduced);
    if (!active) return;
    const expiry = setTimeout(() => { setCelebrating(false); setArrived(true); }, Math.max(0, 86400000 - (Date.now() - new Date(data.changedAt).getTime())));
    if (reduced) return () => clearTimeout(expiry);
    const start = setTimeout(() => setMoving(true), 180);
    const finish = setTimeout(() => setArrived(true), 1750);
    return () => { clearTimeout(start); clearTimeout(finish); clearTimeout(expiry); };
  }, [data.changedAt, data.progress]);
  const progress = celebrating && !moving && !arrived ? data.previousProgress : data.progress;
  return <main className={`${styles.page} ${closingFont.variable}`}>
    <div className={styles.inner}>
      <p className={styles.brand}>{data.copy.brand}</p>
      <header className={styles.header}>
        <h1>{celebrating ? data.copy.celebration_title : data.copy.greeting}</h1>
        <p>{celebrating ? data.copy.celebration_subtitle : data.copy.greeting_subtitle}</p>
      </header>
      <div className={`${styles.journey} ${data.progress === 100 ? styles.finalJourney : ""}`} aria-label={`${data.copy.progress_label}: ${data.progress}%`}>
        <div className={styles.track}>
          <div className={styles.fill} style={{ width: `${progress}%` }} />
          <span className={styles.person}><UserRound aria-hidden="true" /></span>
          <span className={`${styles.house} ${data.progress === 100 ? styles.complete : ""}`}><House aria-hidden="true" /></span>
          <span className={styles.key} style={{ left: `${progress}%` }}><KeyRound aria-hidden="true" /></span>
        </div>
        <p className={styles.percent}>{data.copy.progress_label}: <strong>{arrived ? data.progress : data.previousProgress}%</strong></p>
      </div>
      {celebrating && arrived ? <div className={styles.confetti} aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ "--i": i, "--side": i % 2 ? "100%" : "0%", "--direction": i % 2 ? -1 : 1 }} />)}</div> : null}
      <section className={`${styles.message} ${!arrived ? styles.hidden : ""}`} aria-hidden={!arrived}>
        <p className={styles.eyebrow}>{data.publicName}</p>
        <h2>{data.title}</h2>
        {data.subtitle ? <h3>{data.subtitle}</h3> : null}
        <p className={styles.body}>{data.body}</p>
      </section>
      {data.ctaUrl && !preview ? <a className={styles.cta} href={data.ctaUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={20} aria-hidden="true" />{data.ctaLabel}</a> : <button type="button" className={styles.cta} disabled><MessageCircle size={20} aria-hidden="true" />{data.ctaLabel}</button>}
      {!data.ctaUrl && !preview ? <p className={styles.contactUnavailable}>WhatsApp do corretor indisponível.</p> : null}
      {data.copy.closing_quote ? <footer className={`${styles.closing} ${!arrived ? styles.hidden : ""}`}>
        <hr className={styles.closingDivider} aria-hidden="true" />
        <p className={styles.closingQuote}>&ldquo;{data.copy.closing_quote}&rdquo;</p>
        {data.copy.closing_author ? <p className={styles.closingAuthor}>{data.copy.closing_author}</p> : null}
      </footer> : null}
    </div>
  </main>;
}
