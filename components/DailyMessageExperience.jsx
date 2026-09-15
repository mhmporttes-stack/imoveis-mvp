"use client";
import { useEffect, useState } from "react";
import { Playfair_Display, Cormorant_Garamond, Libre_Baskerville, Lora, Cinzel } from "next/font/google";
import styles from "./DailyMessageExperience.module.css";

// next/font/google exige import estático — as 5 fontes permitidas pela
// configuração administrativa (item 23) são todas carregadas aqui; a
// escolha em tempo real só troca qual variável CSS é aplicada, sem
// requisição extra além das já feitas pelo build.
const playfairDisplay = Playfair_Display({ subsets: ["latin"], weight: ["500", "600", "700"], display: "swap", variable: "--font-daily-message" });
const cormorantGaramond = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600", "700"], display: "swap", variable: "--font-daily-message" });
const libreBaskerville = Libre_Baskerville({ subsets: ["latin"], weight: ["400", "700"], display: "swap", variable: "--font-daily-message" });
const lora = Lora({ subsets: ["latin"], weight: ["500", "600", "700"], display: "swap", variable: "--font-daily-message" });
const cinzel = Cinzel({ subsets: ["latin"], weight: ["500", "600", "700"], display: "swap", variable: "--font-daily-message" });

const FONT_CLASS = {
  playfair_display: playfairDisplay.variable,
  cormorant_garamond: cormorantGaramond.variable,
  libre_baskerville: libreBaskerville.variable,
  lora: lora.variable,
  cinzel: cinzel.variable
};

const STAGE_DELAYS = { main: 120, source: 650, opening: 1500, button: 2050 };

// Experiência de abertura da jornada de trabalho — tela cheia, sem botão de
// fechar, sem X, sem clique-fora. Só sai daqui clicando em INICIAR JORNADA.
// preview=true (usado pelo administrador em Gestão > Automações) roda a
// mesma sequência visual mas nunca chama onComplete de verdade — quem
// invoca decide o que fazer no fechamento do preview.
export default function DailyMessageExperience({ card, font = "cormorant_garamond", onComplete, preview = false }) {
  const [stage, setStage] = useState(0);
  const [closing, setClosing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setStage(4);
      return;
    }
    const timers = [
      setTimeout(() => setStage(1), STAGE_DELAYS.main),
      setTimeout(() => setStage(2), STAGE_DELAYS.source),
      setTimeout(() => setStage(3), STAGE_DELAYS.opening),
      setTimeout(() => setStage(4), STAGE_DELAYS.button)
    ];
    return () => timers.forEach(clearTimeout);
  }, [card?.id]);

  async function handleStart() {
    if (submitting) return;
    setSubmitting(true);
    setClosing(true);
    setTimeout(() => onComplete?.(), 500);
  }

  if (!card) return null;
  const fontVariable = FONT_CLASS[font] || FONT_CLASS.cormorant_garamond;
  const isBiblical = card.type === "biblical";

  return (
    <div className={`${styles.overlay} ${fontVariable} ${closing ? styles.closing : ""}`} role="dialog" aria-modal="true" aria-label="Mensagem do dia">
      <div className={styles.frame}>
        <p className={`${styles.kicker} ${stage >= 1 ? styles.visible : ""}`}>{isBiblical ? "Mensagem do dia" : "Reflexão do dia"}</p>
        <p className={`${styles.mainText} ${stage >= 1 ? styles.visible : ""}`}>{card.mainText}</p>
        <p className={`${styles.sourceText} ${stage >= 2 ? styles.visible : ""}`}>{card.sourceText}</p>
        <div className={styles.divider} aria-hidden="true" />
        <p className={`${styles.openingMessage} ${stage >= 3 ? styles.visible : ""}`}>{card.openingMessage}</p>
        <div className={`${styles.actions} ${stage >= 4 ? styles.visible : ""}`}>
          <button type="button" className={styles.cta} onClick={handleStart} disabled={submitting}>
            INICIAR JORNADA
          </button>
          {preview ? <p className={styles.previewHint}>Pré-visualização — não registra conclusão.</p> : null}
        </div>
      </div>
    </div>
  );
}
