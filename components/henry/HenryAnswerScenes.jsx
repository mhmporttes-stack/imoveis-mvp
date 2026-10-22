"use client";

import { useEffect, useMemo, useRef } from "react";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import { extractSpokenFigures } from "@/lib/henry-voice-narration.mjs";
import { useTabHidden, useViewportWidth } from "./HenrySearchScene";
import styles from "./HenryAnswerScenes.module.css";

// Cenas da RESPOSTA do Henry (dono, 2026-10-22: "cenas diferentes por tipo de pergunta"). O tipo vem do servidor
// (`scene.kind`, escolhido pelas ferramentas chamadas em pickHenryAnswerScene — sem IA extra):
//   corretor    → os cards do corretor (HenryBrokerCards) continuam; sem card na tela, contadores com os números da fala;
//   numeros     → contadores grandes contando até os números que ele FALOU (extractSpokenFigures);
//   comparativo → barras lado a lado (período x anterior, do relatório), com a variação embaixo;
//   cliente     → ficha holográfica (nome e etapa/responsável do detalhe; nunca telefone na cena);
//   web         → globo girando em volta do anel + as fontes;
//   memoria     → nota sendo escrita (o lembrete anotado);
//   conversa    → só ondas e partículas em volta do anel, reagindo à voz (também enquanto pensa, antes da busca).
// Texto sempre SEM card (pedido do dono): palavras flutuando com sombra para ler em cima da cena (iPhone incluso).
// Honestidade: números só da fala/do detalhe real; sem número → a cena não inventa (cai nas ondas).
// Paleta do Henry: navy #07111F, ciano #4FC3E0, azul #1E9BFF, dourado #E8B85C. Aba oculta = pausado; reduced-motion = parado.

const GOLD = "#E8B85C";
const ACCENT = "#4FC3E0";

function formatFigure(item) {
  return (n) => `${item.decimals ? n.toFixed(item.decimals).replace(".", ",") : Math.round(n).toLocaleString("pt-BR")}${item.suffix}`;
}

// Onde fica o painel da cena: à direita do anel no computador (a esquerda é do detalhe), embaixo dele se a tela for
// estreita; no celular, a faixa acima do anel (a transcrição fica embaixo).
function usePanelStyle(mobile, orbSize, maxWidth = 320) {
  const viewport = useViewportWidth();
  if (mobile) return { left: 16, right: 16, top: "calc(env(safe-area-inset-top, 0px) + 78px)" };
  const ringOuter = Math.round(orbSize * 0.37);
  const width = Math.min(maxWidth, Math.round(viewport / 2 - ringOuter - 64));
  if (width >= 200) return { left: `calc(50% + ${ringOuter + 28}px)`, top: "50%", width, transform: "translateY(-50%)" };
  return { left: "50%", top: `calc(50% + ${Math.round(orbSize * 0.4)}px)`, width: Math.min(maxWidth + 40, viewport - 48), transform: "translateX(-50%)" };
}

// ---------- conversa: ondas e partículas ----------
function WavesScene({ getSignal, orbSize, centerTop, running, quiet = false }) {
  const ref = useRef(null);
  const signalRef = useRef(getSignal);
  signalRef.current = getSignal;
  useEffect(() => {
    if (!running) return undefined;
    let raf = 0;
    let level = 0;
    const frame = () => {
      const target = Math.max(0, Math.min(1, Number(signalRef.current?.()?.level) || 0));
      level += (target - level) * 0.18;
      ref.current?.style.setProperty("--lvl", level.toFixed(3));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  const size = Math.round(orbSize * 0.78);
  return (
    <div ref={ref} className={styles.waves} data-quiet={quiet ? "1" : undefined} style={{ top: centerTop, width: size, height: size, "--R": `${Math.round(size / 2)}px` }}>
      {[0, 1, 2, 3].map((index) => (
        <span key={index} className={styles.wave} data-gold={index === 2 ? "1" : undefined} style={{ "--i": index }} />
      ))}
      {Array.from({ length: 16 }, (_, index) => (
        <i
          key={index}
          className={styles.mote}
          data-gold={index % 4 === 0 ? "1" : undefined}
          style={{ "--a": `${(index * 137.5) % 360}deg`, "--d": `${6 + (index % 5)}s`, "--delay": `${-(index * 0.7)}s`, "--r": `${0.55 + (index % 3) * 0.08}` }}
        />
      ))}
    </div>
  );
}

// ---------- números: contadores grandes ----------
function NumbersScene({ figures, panelStyle, mobile }) {
  return (
    <div className={`${styles.panel} ${styles.counters}`} style={panelStyle} data-count={figures.length}>
      {figures.map((item, index) => (
        <div key={`${item.label}-${index}`} className={styles.counter} style={{ "--delay": `${index * 160}ms` }}>
          <svg viewBox="0 0 100 100" className={styles.counterRing} aria-hidden="true">
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(79,195,224,0.16)" strokeWidth="1.5" />
            <circle cx="50" cy="50" r="44" fill="none" stroke={index === 0 ? GOLD : ACCENT} strokeWidth="2.5" strokeLinecap="round" pathLength="1" className={styles.counterArc} />
          </svg>
          <p className={styles.counterValue}>
            <AnimatedNumber value={item.value} duration={mobile ? 1.1 : 1.4} format={formatFigure(item)} />
          </p>
          {item.label ? <p className={styles.counterLabel}>{item.label}</p> : null}
        </div>
      ))}
    </div>
  );
}

// ---------- comparativo: barras lado a lado ----------
function CompareScene({ chart, figures, panelStyle, mobile }) {
  const rows = chart?.rows?.length ? chart.rows : figures.map((item) => ({ label: item.label || "", current: item.value, suffix: item.suffix }));
  const paired = Boolean(chart?.rows?.length);
  const max = Math.max(1, ...rows.flatMap((row) => [row.current, paired ? row.previous : 0]));
  const height = mobile ? 56 : 150;
  return (
    <div className={`${styles.panel} ${styles.compare}`} style={panelStyle}>
      {paired ? (
        <p className={styles.legend}>
          <span><i style={{ background: GOLD }} />{chart.currentLabel}</span>
          <span><i style={{ background: ACCENT }} />{chart.previousLabel}</span>
        </p>
      ) : null}
      <div className={styles.chart} style={{ height }}>
        {rows.map((row, index) => {
          const delta = paired && row.previous > 0 ? Math.round(((row.current - row.previous) / row.previous) * 100) : null;
          return (
            <div key={`${row.label}-${index}`} className={styles.group} style={{ "--delay": `${index * 120}ms` }}>
              <div className={styles.barsPair}>
                <span className={styles.barCol} style={{ "--h": (row.current / max).toFixed(3) }}>
                  <span className={styles.barValue}>
                    <AnimatedNumber value={row.current} duration={1.2} format={(n) => `${Math.round(n)}${row.suffix || ""}`} />
                  </span>
                  <span className={styles.barNow} />
                </span>
                {paired ? (
                  <span className={styles.barCol} style={{ "--h": (row.previous / max).toFixed(3) }}>
                    <span className={styles.barValue} data-muted="1">{row.previous}</span>
                    <span className={styles.barBefore} />
                  </span>
                ) : null}
              </div>
              <p className={styles.groupLabel}>{row.label}</p>
              {delta !== null && !mobile ? <p className={styles.delta} data-up={delta >= 0 ? "1" : "0"}>{delta > 0 ? "+" : ""}{delta}%</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- cliente: ficha holográfica ----------
function ClientScene({ detail, panelStyle }) {
  const section = detail?.sections?.[0];
  const name = section?.title && !/^Fontes|^Lembretes/.test(detail?.title || "") ? section.title : "";
  const rows = (section?.rows || []).filter((row) => row?.value && !/telefone|cpf|e-?mail/i.test(row.label)).slice(0, 3);
  const extra = detail?.sections?.length > 1 ? detail.sections.length - 1 : 0;
  return (
    <div className={`${styles.panel} ${styles.file}`} style={panelStyle}>
      <svg viewBox="0 0 300 190" className={styles.fileFrame} preserveAspectRatio="none" aria-hidden="true">
        <path d="M14 30 H104 L118 16 H286 V176 H14 Z" fill="none" stroke={ACCENT} strokeWidth="1.3" pathLength="1" className={styles.fileDraw} vectorEffect="non-scaling-stroke" />
        <path d="M14 30 H104 L118 16 H160" fill="none" stroke={GOLD} strokeWidth="2" pathLength="1" className={styles.fileDraw} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className={styles.fileBody}>
        <span className={styles.fileAvatar}>{(name || "?").trim().charAt(0).toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          {name ? <p className={styles.fileName}>{name}</p> : <span className={styles.skeleton} style={{ width: "70%" }} />}
          {rows.length
            ? rows.map((row, index) => (
                <p key={row.label} className={styles.fileRow} style={{ "--delay": `${420 + index * 140}ms` }}>
                  <span>{row.label}</span> {row.value}
                </p>
              ))
            : [64, 82, 48].map((width, index) => <span key={width} className={styles.skeleton} style={{ width: `${width}%`, "--delay": `${300 + index * 140}ms` }} />)}
          {extra ? <p className={styles.fileMore}>+{extra} na lista</p> : null}
        </div>
      </div>
      <span className={styles.lens} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5l5 5" />
        </svg>
      </span>
    </div>
  );
}

// ---------- web: globo em volta do anel + fontes ----------
function WebScene({ detail, orbSize, centerTop, panelStyle, mobile }) {
  const size = Math.round(orbSize * 0.9);
  const sources = (detail?.sections || []).flatMap((section) => section.rows || []).filter((row) => row?.href).slice(0, 3);
  return (
    <>
      <div className={styles.globe} style={{ top: centerTop, width: size, height: size }}>
        <svg viewBox="0 0 200 200" width="100%" height="100%" aria-hidden="true">
          <circle cx="100" cy="100" r="96" fill="none" stroke={ACCENT} strokeOpacity="0.5" strokeWidth="0.8" />
          {[-60, -30, 0, 30, 60].map((lat) => {
            const y = 100 + (lat / 90) * 96;
            const rx = Math.sqrt(Math.max(0, 96 * 96 - (y - 100) * (y - 100)));
            return <ellipse key={lat} cx="100" cy={y} rx={rx} ry={rx * 0.12} fill="none" stroke={ACCENT} strokeOpacity="0.22" strokeWidth="0.6" />;
          })}
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <ellipse key={index} cx="100" cy="100" rx="96" ry="96" fill="none" stroke={index === 0 ? GOLD : ACCENT} strokeOpacity={index === 0 ? 0.7 : 0.3} strokeWidth="0.7" className={styles.meridian} style={{ "--m": `${-index}s` }} />
          ))}
          <g className={styles.orbit}>
            <ellipse cx="100" cy="100" rx="99" ry="34" fill="none" stroke={GOLD} strokeOpacity="0.35" strokeWidth="0.6" strokeDasharray="2 5" />
            <circle cx="199" cy="100" r="2.6" fill={GOLD} />
            <circle cx="1" cy="100" r="1.8" fill={ACCENT} />
          </g>
        </svg>
      </div>
      {/* Celular: as fontes já aparecem embaixo, junto da conversa — aqui só o globo. */}
      {sources.length && !mobile ? (
        <div className={`${styles.panel} ${styles.sources}`} style={panelStyle}>
          <p className={styles.kicker}>Pesquisado na internet</p>
          {sources.map((row, index) => (
            <p key={`${row.href}-${index}`} className={styles.source} style={{ "--delay": `${300 + index * 160}ms` }}>
              <i />
              {row.value || row.label}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}

// ---------- memória: nota sendo escrita ----------
function MemoryScene({ detail, panelStyle }) {
  const note = detail?.sections?.[0]?.rows?.[0]?.label || "";
  const total = Number.parseInt(detail?.subtitle || "", 10);
  return (
    <div className={`${styles.panel} ${styles.note}`} style={panelStyle} data-forget={note ? undefined : "1"}>
      <p className={styles.kicker}>{note ? "Anotado" : "Lembretes atualizados"}</p>
      <div className={styles.noteBody}>
        <svg viewBox="0 0 24 24" className={styles.pin} fill="none" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 3l7 7-4 1-4 4 1 5-3 1-3-5-5 5M9 9l6 6" />
        </svg>
        {note ? <p className={styles.noteText}>{note}</p> : <span className={styles.noteStrike} />}
      </div>
      <span className={styles.rule} />
      <span className={styles.rule} data-short="1" />
      {Number.isFinite(total) && total > 1 ? <p className={styles.noteCount}>{total} lembretes guardados</p> : null}
    </div>
  );
}

export default function HenryAnswerScenes({ kind = "conversa", scene = null, text = "", detail = null, hasBrokers = false, mobile = false, orbSize = 520, getSignal, sceneKey = "" }) {
  const hidden = useTabHidden();
  const reduced = usePrefersReducedMotion();
  const panelStyle = usePanelStyle(mobile, orbSize, kind === "comparativo" ? 400 : 320);
  const figures = useMemo(() => extractSpokenFigures(text, 3), [text]);
  const centerTop = mobile ? "calc(50% - 14vh)" : "50%";
  // Sem dado para desenhar, a cena não inventa: volta para as ondas.
  let shown = kind;
  if (kind === "corretor") shown = hasBrokers ? "" : figures.length ? "numeros" : "conversa";
  if (kind === "numeros" && !figures.length) shown = "conversa";
  if (kind === "comparativo" && !scene?.chart?.rows?.length && !figures.length) shown = "conversa";
  if (kind === "memoria" && !detail?.sections?.length && !text) shown = "conversa";
  return (
    <div className={`${styles.layer} ${hidden ? styles.paused : ""} ${reduced ? styles.still : ""}`} data-henry-answer-scene={shown || "corretor"} aria-hidden="true" key={sceneKey}>
      {/* Ondas: a cena inteira na conversa; atrás das outras cenas ficam paradas e discretas (no globo, não). */}
      {shown !== "web" ? <WavesScene getSignal={getSignal} orbSize={orbSize} centerTop={centerTop} running={shown === "conversa" && !hidden && !reduced} quiet={shown !== "conversa"} /> : null}
      {shown === "numeros" ? <NumbersScene figures={figures} panelStyle={panelStyle} mobile={mobile} /> : null}
      {shown === "comparativo" ? <CompareScene chart={scene?.chart} figures={figures} panelStyle={panelStyle} mobile={mobile} /> : null}
      {shown === "cliente" ? <ClientScene detail={detail} panelStyle={panelStyle} /> : null}
      {shown === "web" ? <WebScene detail={detail} orbSize={orbSize} centerTop={centerTop} panelStyle={panelStyle} mobile={mobile} /> : null}
      {shown === "memoria" ? <MemoryScene detail={detail} panelStyle={panelStyle} /> : null}
    </div>
  );
}
