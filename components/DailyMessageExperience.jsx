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

// Progressão aproximada pedida: fundo já entra via CSS (overlayIn); a
// partir daí cada elemento é revelado em sua própria etapa (fade + leve
// translateY), nunca todos juntos — mesmo padrão de reveal por estágio já
// usado em ClientJourney (setTimeout alternando classes .visible), só com
// mais estágios para dar a sensação de construção gradual da tela.
const STAGE_DELAYS = { kicker: 280, main: 620, source: 950, divider: 1150, opening: 1350, button: 1600 };
const STAGE_ORDER = ["kicker", "main", "source", "divider", "opening", "button"];

// Classificação simples por tamanho do texto principal (calibrada nos 210
// cards reais da biblioteca: de ~16 a ~101 caracteres) — controla só a
// tipografia fluida (ver clamp() no CSS), nunca o conteúdo do card.
function lengthTier(text) {
  const length = String(text || "").length;
  if (length <= 40) return "short";
  if (length <= 75) return "medium";
  return "long";
}

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
      setStage(STAGE_ORDER.length);
      return;
    }
    const timers = STAGE_ORDER.map((key, index) => setTimeout(() => setStage(index + 1), STAGE_DELAYS[key]));
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
  const stageIndex = (key) => (stage >= STAGE_ORDER.indexOf(key) + 1 ? styles.visible : "");

  return (
    <div className={`${styles.overlay} ${fontVariable} ${closing ? styles.closing : ""}`} role="dialog" aria-modal="true" aria-label="Mensagem do dia">
      <div className={styles.backdrop} aria-hidden="true">
        <div className={styles.glow} />
      </div>
      <div className={styles.frame} data-length={lengthTier(card.mainText)}>
        <p className={`${styles.kicker} ${stageIndex("kicker")}`}>{isBiblical ? "Mensagem do dia" : "Reflexão do dia"}</p>
        <p className={`${styles.mainText} ${stageIndex("main")}`}>{card.mainText}</p>
        <p className={`${styles.sourceText} ${stageIndex("source")}`}>{card.sourceText}</p>
        <div className={`${styles.divider} ${stageIndex("divider")}`} aria-hidden="true" />
        <p className={`${styles.openingMessage} ${stageIndex("opening")}`}>{card.openingMessage}</p>
        <div className={`${styles.actions} ${stageIndex("button")}`}>
          <button type="button" className={styles.cta} onClick={handleStart} disabled={submitting}>
            INICIAR JORNADA
          </button>
          {preview ? <p className={styles.previewHint}>Pré-visualização — não registra conclusão.</p> : null}
        </div>
      </div>
    </div>
  );
}
