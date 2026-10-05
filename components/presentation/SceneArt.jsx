import styles from "./presentation.module.css";

// Ilustrações DECORATIVAS da apresentação (aria-hidden): linhas e formas arquitetônicas discretas, sem texto e sem dado.
// Todas em SVG de traço fino (currentColor), animadas só com opacity e stroke-dashoffset.

/** Fundo de marca: casas, prédio, escada ascendente e círculos de luz, em traço bem fino, ancorados no pé do palco. */
export function ArchBackdrop() {
  return (
    <div className={styles.backdrop} aria-hidden="true">
      <svg viewBox="0 0 600 760" preserveAspectRatio="xMidYMax slice" focusable="false" role="presentation">
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <g className={styles.artSun}>
            <circle cx="468" cy="168" r="52" />
            <circle cx="468" cy="168" r="94" />
            <circle cx="468" cy="168" r="142" strokeDasharray="2 8" />
          </g>
          <path className={styles.artSteps} d="M16 372 H70 V328 H124 V284 H178 V240 H232 V196" />
          <path d="M0 702 H600" />
          {/* casa de telhado inclinado */}
          <path d="M44 702 V548 L156 456 L268 548 V702" />
          <path d="M72 702 V560 L156 491 L240 560 V702" opacity="0.55" />
          <path d="M104 592 H146 V634 H104 Z M125 592 V634 M104 613 H146 M168 592 H210 V634 H168 Z M189 592 V634 M168 613 H210" />
          <path d="M128 702 V650 H184 V702" />
          {/* prédio moderno */}
          <path d="M318 702 V402 H524 V702" />
          <path d="M318 476 H524 M318 550 H524 M318 624 H524 M386 402 V702 M456 402 V702" opacity="0.5" />
          <path d="M338 430 H368 V458 H338 Z M408 430 H438 V458 H408 Z M478 430 H508 V458 H478 Z M338 504 H368 V532 H338 Z M478 504 H508 V532 H478 Z M408 578 H438 V606 H408 Z M338 652 H368 V680 H338 Z" opacity="0.7" />
          {/* bloco baixo ao fundo */}
          <path d="M548 702 V520 H606" opacity="0.6" />
        </g>
      </svg>
    </div>
  );
}

/** Anéis concêntricos que se desenham atrás do número "poder de compra". */
export function PowerRings() {
  return (
    <svg className={styles.rings} viewBox="0 0 320 320" aria-hidden="true" focusable="false" role="presentation">
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <circle className={styles.ringDraw} style={{ "--rd": "200ms" }} cx="160" cy="160" r="70" pathLength="1" strokeWidth="1.6" />
        <circle className={styles.ringDraw} style={{ "--rd": "450ms" }} cx="160" cy="160" r="112" pathLength="1" strokeWidth="1.4" />
        <circle className={styles.ringDraw} style={{ "--rd": "700ms" }} cx="160" cy="160" r="152" pathLength="1" strokeWidth="1.2" strokeOpacity="0.7" />
      </g>
    </svg>
  );
}

/** Anel com seta de avanço (cena "esse é o próximo passo!"): o traço se desenha. */
export function StepArrow() {
  return (
    <svg className={styles.stepArrow} viewBox="0 0 120 120" aria-hidden="true" focusable="false" role="presentation">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle className={styles.ringDraw} style={{ "--rd": "100ms", "--rdur": "1100ms" }} cx="60" cy="60" r="54" pathLength="1" strokeWidth="2.6" />
        <path className={styles.ringDraw} style={{ "--rd": "800ms", "--rdur": "700ms" }} d="M36 60 H82 M64 42 L82 60 L64 78" pathLength="1" strokeWidth="3.4" />
      </g>
    </svg>
  );
}

/** Pasta com folhas (cena de documentos). */
export function FolderArt() {
  return (
    <svg className={styles.folder} viewBox="0 0 180 130" aria-hidden="true" focusable="false" role="presentation">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
        <path className={styles.ringDraw} style={{ "--rd": "100ms", "--rdur": "900ms" }} pathLength="1" d="M16 112 V24 a8 8 0 0 1 8 -8 H72 L86 32 H156 a8 8 0 0 1 8 8 V112 a8 8 0 0 1 -8 8 H24 a8 8 0 0 1 -8 -8 Z" />
        <g className={styles.sheetsArt}>
          <path d="M40 66 V40 a4 4 0 0 1 4 -4 H112 a4 4 0 0 1 4 4 V66" strokeOpacity="0.55" />
          <path d="M52 66 V52 a4 4 0 0 1 4 -4 H124 a4 4 0 0 1 4 4 V66" strokeOpacity="0.8" />
          <path d="M62 60 H108 M62 52 H96" strokeWidth="2" strokeOpacity="0.6" />
        </g>
        <path className={styles.ringDraw} style={{ "--rd": "500ms", "--rdur": "800ms" }} pathLength="1" d="M16 70 a8 8 0 0 1 8 -8 H156 a8 8 0 0 1 8 8 V112 a8 8 0 0 1 -8 8 H24 a8 8 0 0 1 -8 -8 Z" fill="var(--bg)" />
      </g>
    </svg>
  );
}

/** Aspas grandes e discretas (cena "Por que este imóvel?"). */
export function QuoteMark() {
  return (
    <svg className={styles.quote} viewBox="0 0 64 48" aria-hidden="true" focusable="false" role="presentation">
      <path fill="currentColor" d="M0 48V28C0 12.5 8.2 3.2 22 0l3 6.6C17.4 9.4 14 14.6 13.6 21H26v27H0Zm38 0V28C38 12.5 46.2 3.2 60 0l3 6.6C55.4 9.4 52 14.6 51.6 21H64v27H38Z" />
    </svg>
  );
}
