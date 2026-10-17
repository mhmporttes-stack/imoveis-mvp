import { Fragment } from "react";
import styles from "./HeroJourney.module.css";
import FitLine from "./FitLine";

// Abertura da home — modelo B aprovado pelo dono (2026-10-16): título calmo, uma frase e a linha do tempo
// "Simule → Aprovação → Chaves". A CENA de apresentação é só CSS (sem JavaScript no navegador): o texto entra em
// sequência e a linha se desenha ponto a ponto, contando o caminho até as chaves. Roda uma vez ao abrir a página; com
// "reduzir movimento" ligado, tudo aparece de uma vez no estado final.
const STEPS = [
  { title: "Simule", detail: "2 minutos" },
  { title: "Aprovação", detail: "Caixa e MCMV" },
  { title: "Chaves", detail: "Seu imóvel" }
];

export default function HeroJourney() {
  return (
    <>
      <p className={`${styles.rise} text-[11px] font-black uppercase tracking-[0.14em] text-blue-200/90 sm:text-sm sm:tracking-[0.2em] md:text-xs lg:text-sm`} style={{ "--d": "0s" }}>
        Minha Casa Minha Vida <span className="text-white/35" aria-hidden="true">·</span> Financiamento Caixa
      </p>

      {/* Título, frase e linha do tempo têm a MESMA largura (a da frase, até o fim de "financiar"): ficam no mesmo bloco e o
          título (uma linha, maiúsculas) é ajustado por FitLine para terminar exatamente onde a frase termina. */}
      <div className="w-fit max-w-full">
      {/* Celular: título e frase ocupam só a coluna da esquerda (a foto fica à direita, como no computador); a linha do tempo segue em largura total. */}
      <div className="max-w-[54%] sm:max-w-[58%] md:max-w-none">
      <FitLine minPx={16} className={`${styles.rise} ${styles.title} mt-4 font-extrabold sm:mt-5`} style={{ "--d": "0.12s" }}>
        Seu primeiro imóvel em <span className="text-[#6FA8FA]">Marília</span>
      </FitLine>

      <p className={`${styles.rise} mt-5 max-w-[32rem] text-[14px] leading-[1.45] text-white/80 sm:text-lg sm:leading-8`} style={{ "--d": "0.32s" }}>
        Descubra em menos de 2 minutos quanto você pode financiar.
      </p>
      </div>

      {/* Linha do tempo: os pontos ficam no começo, no meio e NO FIM da largura (as chaves chegam na ponta direita, onde a
          frase termina); cada ponto acende e a linha seguinte se desenha até o próximo (tempo = --d). */}
      <div className={`${styles.track} mt-7 sm:mt-8`}>
        <div className={styles.dots} aria-hidden="true">
          {STEPS.map((step, index) => {
            const last = index === STEPS.length - 1;
            const start = 0.7 + index * 0.55;
            return (
              <Fragment key={step.title}>
                <span className={`${styles.dot} ${last ? styles.dotEnd : ""}`} style={{ "--d": `${start}s` }} />
                {last ? null : <span className={styles.line} style={{ "--d": `${start + 0.12}s` }} />}
              </Fragment>
            );
          })}
        </div>
        <ol className={styles.labels} aria-label="Do primeiro passo até a entrega das chaves">
          {STEPS.map((step, index) => (
            <li key={step.title} className={`${styles.label} ${index === 0 ? styles.labelStart : index === STEPS.length - 1 ? styles.labelEnd : styles.labelMid}`} style={{ "--d": `${0.75 + index * 0.55}s` }}>
              <b>{step.title}</b>
              <span>{step.detail}</span>
            </li>
          ))}
        </ol>
      </div>
      </div>
    </>
  );
}

/** Entrada suave de um bloco da abertura (botões e selos), depois que o caminho foi desenhado. */
export function HeroReveal({ delay = 0, className = "", children }) {
  return (
    <div className={`${styles.rise} ${className}`} style={{ "--d": `${delay}s` }}>
      {children}
    </div>
  );
}
