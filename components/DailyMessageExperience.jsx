"use client";
import { useEffect, useMemo, useState } from "react";
import { Playfair_Display, Cormorant_Garamond, Libre_Baskerville, Lora, Cinzel } from "next/font/google";
import { greetingForMinutes, saoPauloNow } from "@/lib/alexa-config-core.mjs";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import WeldText, { weldLayout } from "@/components/scenes/WeldText";
import scene from "@/components/scenes/scenes.module.css";
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

// Tempos da cena (aprovados no protótipo de 2026-10-22): a saudação começa a ser digitada aos 0,6 s e as letras da
// frase começam a voar junto com ela, 22 ms entre uma e outra; cada uma é soldada 560 ms depois de cravar.
const FLY_START_MS = 600;
const FLY_STEP_MS = 22;
const WELD_LAG_MS = 560;

// Classificação simples por tamanho do texto principal (calibrada nos 210
// cards reais da biblioteca: de ~16 a ~101 caracteres) — controla só a
// tipografia fluida (ver clamp() no CSS), nunca o conteúdo do card.
function lengthTier(text) {
  const length = String(text || "").length;
  if (length <= 40) return "short";
  if (length <= 75) return "medium";
  return "long";
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function todayLabel() {
  const text = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Experiência de abertura da jornada de trabalho — tela cheia, sem botão de
// fechar, sem X, sem clique-fora. Só sai daqui clicando em "Começar o dia".
// Tocar na tela durante a entrada só adianta a animação (não fecha).
// preview=true (usado pelo administrador em Gestão > Automações) roda a
// mesma sequência visual mas nunca registra conclusão — quem invoca decide
// o que fazer no fechamento do preview.
export default function DailyMessageExperience({ card, font = "cormorant_garamond", onComplete, preview = false, userName = "" }) {
  const reduced = usePrefersReducedMotion();
  const [skipped, setSkipped] = useState(false);
  const [ready, setReady] = useState(false);
  const [closing, setClosing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const layout = useMemo(() => weldLayout(card?.mainText, { start: FLY_START_MS, step: FLY_STEP_MS, lag: WELD_LAG_MS }), [card?.mainText]);
  const greeting = useMemo(() => {
    const name = firstName(userName);
    return `${greetingForMinutes(saoPauloNow().minutes)}${name ? `, ${name}:` : "!"}`;
  }, [userName]);
  const still = reduced || skipped;

  // O botão só fica clicável quando a frase terminou de ser soldada (ou se a animação foi pulada).
  useEffect(() => {
    setSkipped(false);
    setReady(false);
    const timer = setTimeout(() => setReady(true), layout.end + 200);
    return () => clearTimeout(timer);
  }, [card?.id, layout.end]);

  function handleStart() {
    if (submitting) return;
    setSubmitting(true);
    setClosing(true);
    setTimeout(() => onComplete?.(), 500);
  }

  if (!card) return null;
  const fontVariable = FONT_CLASS[font] || FONT_CLASS.cormorant_garamond;
  const isBiblical = card.type === "biblical";
  const timing = {
    "--boom": `${layout.end - 150}ms`,
    "--after": `${layout.end - 600}ms`,
    "--bye": `${layout.end - 200}ms`,
    "--cta": `${layout.end + 200}ms`
  };

  return (
    <div
      className={`${scene.theme} ${styles.overlay} ${fontVariable} ${closing ? styles.closing : ""} ${still ? `${scene.still} ${styles.still}` : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Mensagem do dia"
      style={timing}
      onClick={() => { if (!still) { setSkipped(true); setReady(true); } }}
    >
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.frame} data-length={lengthTier(card.mainText)}>
        <img className={styles.logo} src="/assets/matheus-machado-symbol.png" alt="Matheus Machado Corretor de Imóveis" width={1000} height={785} />
        <p className={styles.greeting}><span className={styles.typed} style={{ "--chars": greeting.length }}>{greeting}</span></p>
        <p className={`${styles.mainText} ${scene.boom}`} aria-label={card.mainText}>
          <WeldText layout={layout} />
        </p>
        {card.sourceText ? <p className={styles.sourceText}>{card.sourceText}</p> : null}
        <div className={styles.divider} aria-hidden="true" />
        {card.openingMessage ? <p className={styles.openingMessage}>{card.openingMessage}</p> : null}
        <p className={styles.date}>{todayLabel()} · {isBiblical ? "Mensagem do dia" : "Reflexão do dia"}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cta}
            onClick={(event) => { event.stopPropagation(); handleStart(); }}
            disabled={submitting || (!ready && !still)}
          >
            Começar o dia
          </button>
          {preview ? <p className={styles.previewHint}>Pré-visualização — não registra conclusão.</p> : null}
        </div>
      </div>
    </div>
  );
}
