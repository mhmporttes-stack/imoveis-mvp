"use client";

import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, House, Pause, Play } from "lucide-react";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import { formatBRL, splitBRL } from "@/lib/simulation-presentation-format.mjs";
import { formatInterestRateLabel } from "@/lib/interest-rate.mjs";
import { navigableSceneCount } from "@/lib/simulation-presentation-gate.mjs";
import { BRAND_NAME, BRAND_ROLE, DOCUMENTS_SCENE_TEXT } from "@/lib/simulation-presentation-documents.mjs";
import {
  advanceClock,
  branchStep,
  buildAssetHrefs,
  countValue,
  createPlayerState,
  isAutoAdvancing,
  isLastScene,
  isPaused,
  keyAction,
  playerReducer,
  propertiesButtonLabel,
  sceneMetricEvents,
  swipeAction,
  tapAction,
  transitionPlan
} from "./player-core.mjs";
import DocumentsSheet from "./DocumentsSheet";
import OpeningAnimation from "./OpeningAnimation";
import { ArchBackdrop, FolderArt, PowerRings, QuoteMark, StepArrow } from "./SceneArt";
import styles from "./presentation.module.css";

// Player da apresentação interativa da simulação. Recebe só o DTO público (cenas já decididas no servidor) e nunca
// calcula valor financeiro: apenas anima e formata o que veio. Sem biblioteca de animação nem áudio.
// `token` vazio ou `preview` = prévia do CRM: não envia nenhuma métrica e os botões de download ficam desativados.
// A logo da Caixa (a mesma do formulário público) fica no rodapé FIXO de todas as cenas, DIRETO sobre o fundo (sem pílula/caixa).
// Os imóveis sugeridos (`branch`) são um ramo OPCIONAL fora do roteiro (`scenes`): abertos pelo botão do "Próximo passo".

const DARK_SCENES = new Set(["abertura", "poder", "formacao", "imovel", "proximo", "validar"]);
const theme = (scene) => (DARK_SCENES.has(scene?.id) ? "dark" : "light");
const SESSION_KEY = (token) => `mm-apresentacao-${token.slice(0, 8)}`;
const CAIXA_LOGO = "/assets/caixa-logo-transparent.png";

function announcement(scene, index, total) {
  if (scene.id === "imovel") return `Imóvel ${scene.position} de ${scene.count}: ${scene.name}. ${scene.reason}`;
  const head = `Cena ${index + 1} de ${total}. `;
  switch (scene.id) {
    case "abertura": return `${head}${scene.firstName ? `${scene.firstName}, sua` : "Sua"} simulação de financiamento está pronta. Você já está um passo mais próximo da compra do seu imóvel.`;
    case "poder": return `${head}Seu poder de compra: ${formatBRL(scene.value)}.`;
    case "formacao": return `${head}Como esse valor é formado. Poder total de compra: ${formatBRL(scene.total)}.`;
    case "parcelas": {
      const rate = formatInterestRateLabel(scene.interestRate);
      return `${head}Condição de pagamento. Primeira parcela ${formatBRL(scene.first)}, última parcela ${formatBRL(scene.last)}${rate ? `, taxa de juros ${rate}` : ""}.`;
    }
    case "diferenca": return `${head}Diferença entre imóvel novo e usado. Diferença de subsídio: ${formatBRL(scene.difference)}.`;
    case "validar": return `${head}${scene.firstName ? `${scene.firstName}, esse` : "Esse"} é o próximo passo!`;
    case "documentos": return `${head}${DOCUMENTS_SCENE_TEXT}`;
    default: return `${head}Próximo passo.`;
  }
}

/** Número que sobe até o valor final (rAF + easing). Reduced-motion: valor final direto. A largura é reservada pelo texto final.
 *  Os centavos ficam menores (só tipografia: o texto lido é o mesmo valor); --len guarda o tamanho do número para o ajuste de fonte. */
function Count({ value, reduced, duration = 1700, delay = 350, className = "" }) {
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return undefined;
    }
    let raf = 0;
    const timer = setTimeout(() => {
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        setShown(countValue(value, progress));
        if (progress < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [value, reduced, duration, delay]);
  const final = formatBRL(value);
  const part = splitBRL(shown);
  const ghost = splitBRL(value);
  const body = (parts) => {
    const cut = parts.number.lastIndexOf(",");
    return cut > 0 ? (<span className={styles.num}>{parts.number.slice(0, cut)}<em>{parts.number.slice(cut)}</em></span>) : (<span className={styles.num}>{parts.number}</span>);
  };
  const cutGhost = ghost.number.lastIndexOf(",");
  const len = cutGhost > 0 ? cutGhost : ghost.number.length;
  return (
    <span className={`${styles.count} ${className}`} style={{ "--len": len }}>
      <span className={styles.countGhost} aria-hidden="true"><small>{ghost.symbol}</small>{body(ghost)}</span>
      <span aria-hidden="true"><small>{part.symbol}</small>{body(part)}</span>
      <span className={styles.sr}>{final}</span>
    </span>
  );
}

/** Texto que se revela palavra por palavra (só opacity e transform). O texto lido é o mesmo. */
function RevealWords({ text, start = 0, step = 55 }) {
  const words = text.split(" ");
  return words.map((word, i) => (
    <Fragment key={`${i}-${word}`}>
      <span className={styles.word} style={{ "--d": `${start + i * step}ms` }}>{word}</span>
      {i < words.length - 1 ? " " : null}
    </Fragment>
  ));
}

function SceneAbertura({ scene, reduced }) {
  const title = scene.firstName ? `${scene.firstName}, sua simulação de financiamento está pronta` : "Sua simulação de financiamento está pronta";
  return (
    <div className={`${styles.sceneInner} ${styles.openingInner}`}>
      <div className={styles.openArt}>
        <OpeningAnimation reducedMotion={reduced} />
      </div>
      <div className={styles.openText}>
        <h1 className={`${styles.title} ${styles.titleHero}`}>
          {reduced ? title : <RevealWords text={title} start={1000} />}
        </h1>
        <p className={`${styles.lead} ${styles.rise}`} style={{ "--d": reduced ? "0ms" : "1500ms" }}>Você já está um passo mais próximo da compra do seu imóvel</p>
      </div>
    </div>
  );
}

function ScenePoder({ scene, reduced }) {
  return (
    <div className={styles.sceneInner}>
      <div className={styles.powerWrap}>
        <PowerRings />
        <p className={`${styles.eyebrow} ${styles.rise}`} style={{ "--d": "100ms" }}>Seu poder de compra</p>
        <strong className={styles.bigNumber}><Count value={scene.value} reduced={reduced} /></strong>
        <span className={styles.underline} style={{ "--d": "2000ms" }} aria-hidden="true" />
      </div>
    </div>
  );
}

function SceneFormacao({ scene, reduced }) {
  const single = scene.mode !== "soma";
  return (
    <div className={styles.sceneInner}>
      <p className={`${styles.eyebrow} ${styles.rise}`} style={{ "--d": "50ms" }}>Como esse valor é formado</p>
      <div className={`${styles.rows} ${single ? "" : styles.rowsSoma}`}>
        {single ? (
          <>
            <div className={`${styles.row} ${styles.rowTotal} ${styles.rise}`} style={{ "--d": "400ms" }}>
              <span className={styles.rowLabel}>{scene.mode === "subsidio" ? "Subsídio" : "Financiamento"}</span>
              <span className={styles.rowValue}><Count value={scene.total} reduced={reduced} duration={1100} delay={450} /></span>
            </div>
            <p className={`${styles.note} ${styles.rise}`} style={{ "--d": "1300ms" }}>
              {scene.mode === "subsidio" ? "Seu poder de compra vem do subsídio." : "Seu poder de compra vem do financiamento."}
            </p>
          </>
        ) : (
          <>
            <div className={`${styles.row} ${styles.rowPart} ${styles.rise}`} style={{ "--d": "400ms" }}>
              <span className={styles.rowLabel}>Financiamento</span>
              <span className={styles.rowValue}>{formatBRL(scene.financing)}</span>
            </div>
            <div className={`${styles.plus} ${styles.rise}`} style={{ "--d": "900ms" }} aria-hidden="true"><span>+</span></div>
            <div className={`${styles.row} ${styles.rowPart} ${styles.rise}`} style={{ "--d": "1200ms" }}>
              <span className={styles.rowLabel}>Subsídio</span>
              <span className={styles.rowValue}>{formatBRL(scene.subsidy)}</span>
            </div>
            <div className={`${styles.row} ${styles.rowTotal} ${styles.rise}`} style={{ "--d": "2000ms" }}>
              <span className={styles.rowLabel}>= Poder total</span>
              <span className={styles.rowValue}><Count value={scene.total} reduced={reduced} duration={1000} delay={2050} /></span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SceneParcelas({ scene }) {
  const both = scene.first > 0 && scene.last > 0;
  const rate = formatInterestRateLabel(scene.interestRate);
  return (
    <div className={styles.sceneInner}>
      <p className={`${styles.eyebrow} ${styles.rise}`} style={{ "--d": "50ms" }}>Condição de pagamento</p>
      <div className={styles.stats}>
        {scene.first > 0 ? (
          <div className={`${styles.stat} ${styles.rise}`} style={{ "--d": "400ms" }}>
            <span className={styles.statLabel}>Primeira parcela</span>
            <strong className={styles.statValue}>{formatBRL(scene.first)}</strong>
          </div>
        ) : null}
        {both ? <div className={styles.statLink} style={{ "--d": "900ms" }} aria-hidden="true"><svg viewBox="0 0 24 56"><path d="M12 2 V50 M4 42 L12 52 L20 42" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></div> : null}
        {scene.last > 0 ? (
          <div className={`${styles.stat} ${styles.rise}`} style={{ "--d": both ? "1500ms" : "400ms" }}>
            <span className={styles.statLabel}>Última parcela</span>
            <strong className={styles.statValue}>{formatBRL(scene.last)}</strong>
          </div>
        ) : null}
        {rate ? (
          <div className={`${styles.stat} ${styles.statRate} ${styles.rise}`} style={{ "--d": both ? "2200ms" : "1000ms" }}>
            <span className={styles.statLabel}>Taxa de juros</span>
            <strong className={styles.statValueSmall}>{rate}</strong>
          </div>
        ) : null}
      </div>
      <p className={`${styles.note} ${styles.rise}`} style={{ "--d": rate ? (both ? "2800ms" : "1500ms") : both ? "2100ms" : "900ms" }}>Valores da simulação realizada.</p>
    </div>
  );
}

// Única diferença entre imóvel novo e usado que a apresentação mostra: o subsídio. A cena só existe quando os dois
// subsídios são diferentes (decisão do servidor); sem diferença, nenhuma palavra "novo"/"usado" aparece.
function SceneDiferenca({ scene }) {
  return (
    <div className={styles.sceneInner}>
      <h2 className={`${styles.title} ${styles.titleMid} ${styles.rise}`} style={{ "--d": "100ms" }}>Diferença entre imóvel novo e usado</h2>
      <div className={styles.diffRows}>
        <div className={`${styles.diffRow} ${styles.rise}`} style={{ "--d": "600ms" }}>
          <span className={styles.diffLabel}>Imóvel novo</span>
          <span className={styles.diffText}>subsídio de</span>
          <strong className={styles.diffValue}>{formatBRL(scene.novo)}</strong>
        </div>
        <div className={`${styles.diffRow} ${styles.rise}`} style={{ "--d": "1100ms" }}>
          <span className={styles.diffLabel}>Imóvel usado</span>
          <span className={styles.diffText}>subsídio de</span>
          <strong className={styles.diffValue}>{formatBRL(scene.usado)}</strong>
        </div>
        <div className={`${styles.diffTotal} ${styles.rise}`} style={{ "--d": "1700ms" }}>
          <span className={styles.diffTotalLabel}>Diferença de subsídio</span>
          <strong className={styles.diffTotalValue}>{formatBRL(scene.difference)}</strong>
        </div>
      </div>
      <p className={`${styles.note} ${styles.rise}`} style={{ "--d": "2300ms" }}>Os valores das cenas anteriores consideram o imóvel {scene.scenario}.</p>
    </div>
  );
}

/** Cena do RAMO de imóveis (uma por imóvel sugerido): foto em revelação, características em sequência e a mensagem. */
function SceneImovel({ scene, onNext, last, fast }) {
  const [failed, setFailed] = useState(false);
  const multi = scene.count > 1;
  const d = (ms) => (fast ? "0ms" : `${ms}ms`);
  const afterBenefits = 800 + scene.benefits.length * 240;
  return (
    <>
      <div className={`${styles.photoWrap} ${styles.photoReveal}`}>
        {scene.imageUrl && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.photo} src={scene.imageUrl} alt={`Foto de ${scene.name}`} width={1080} height={1350} decoding="async" onError={() => setFailed(true)} />
        ) : (
          <div className={styles.photoFallback} aria-hidden="true">
            <svg className={styles.fallbackRings} viewBox="0 0 400 400" fill="none" stroke="currentColor" strokeWidth="1.2">
              <circle cx="200" cy="200" r="70" /><circle cx="200" cy="200" r="120" /><circle cx="200" cy="200" r="170" /><circle cx="200" cy="200" r="198" />
            </svg>
            <span className={styles.fallbackIcon}><House /></span>
          </div>
        )}
        <div className={styles.photoShade} />
      </div>
      <div className={styles.photoText}>
        <div className={styles.photoScroll}>
          <p className={`${styles.eyebrow} ${styles.counter} ${styles.rise}`} style={{ "--d": d(250) }}>
            {multi ? (
              <>
                <span className={styles.dots} aria-hidden="true">
                  {Array.from({ length: Math.min(scene.count, 8) }, (_, i) => (
                    <i key={i} className={i + 1 === scene.position ? styles.dotOn : ""} />
                  ))}
                </span>
                {`Imóvel ${scene.position} de ${scene.count}`}
              </>
            ) : "Imóvel sugerido"}
          </p>
          <h2 className={styles.rise} style={{ "--d": d(450) }}>{scene.name}</h2>
          {scene.benefits.length ? (
            <ul className={styles.benefits}>
              {scene.benefits.map((benefit, i) => (
                <li key={`${i}-${benefit}`} className={styles.slideIn} style={{ "--d": d(800 + i * 240) }}>{benefit}</li>
              ))}
            </ul>
          ) : null}
          <p className={`${styles.propReason} ${styles.rise}`} style={{ "--d": d(afterBenefits + 100) }}>{scene.reason}</p>
        </div>
        <div className={`${styles.propActions} ${styles.rise}`} style={{ "--d": d(afterBenefits + 500) }}>
          <button type="button" className={styles.cta} onClick={onNext} data-no-nav="" data-branch-next="">
            {last ? "Continuar" : "Próximo imóvel"}
          </button>
        </div>
      </div>
    </>
  );
}

/** Botão de download de imagem: link do mesmo token; sem link (prévia do CRM) fica desativado e diz por quê. */
function DownloadAction({ href, label, className, hint }) {
  if (!href) {
    return (
      <button type="button" className={className} disabled aria-disabled="true" title={hint} data-no-nav="">
        <Download aria-hidden="true" />
        {label}
      </button>
    );
  }
  return (
    <a className={className} href={href} download data-no-nav="">
      <Download aria-hidden="true" />
      {label}
    </a>
  );
}

function SceneProximo({ scene, onValidate, onOpenProperties, propertyCount, hrefs, fast }) {
  const propertiesLabel = propertiesButtonLabel(propertyCount);
  const d = (ms) => (fast ? "0ms" : `${ms}ms`);
  return (
    <div className={styles.sceneInner}>
      <p className={`${styles.eyebrow} ${styles.rise}`} style={{ "--d": "50ms" }}>Próximo passo</p>
      <h2 className={`${styles.title} ${styles.titleMid} ${styles.rise}`} style={{ "--d": d(450) }}>
        Agora que você conhece seu poder de compra, podemos avançar para encontrar a melhor opção dentro dessas condições.
      </h2>
      {scene.dateLabel ? <p className={`${styles.note} ${styles.rise}`} style={{ "--d": d(1100) }}>Simulação realizada em {scene.dateLabel}</p> : null}
      <div className={`${styles.actions} ${styles.rise}`} style={{ "--d": d(1500) }}>
        {propertiesLabel ? (
          <button type="button" className={`${styles.ghostBtn} ${styles.ctaCaps}`} onClick={onOpenProperties} data-no-nav="" data-open-properties="">
            <House aria-hidden="true" />
            {propertiesLabel}
          </button>
        ) : null}
        <button type="button" className={`${styles.cta} ${styles.ctaCaps}`} onClick={onValidate} data-no-nav="">
          VALIDAR SIMULAÇÃO
        </button>
        <DownloadAction href={hrefs.summary} label="Baixar apresentação" className={styles.ghostBtn} hint="Disponível no link enviado ao cliente" />
      </div>
    </div>
  );
}

function SceneValidar({ scene }) {
  return (
    <div className={styles.sceneInner}>
      <StepArrow />
      <h2 className={`${styles.title} ${styles.rise}`} style={{ "--d": "150ms" }}>
        {scene.firstName ? `${scene.firstName}, esse é o próximo passo!` : "Esse é o próximo passo!"}
      </h2>
      <p className={`${styles.lead} ${styles.rise}`} style={{ "--d": "900ms" }}>Vamos validar os valores desta simulação junto à Caixa.</p>
      <p className={`${styles.note} ${styles.rise}`} style={{ "--d": "1500ms" }}>
        Simulação estimada: os valores finais dependem da análise de crédito do banco e da confirmação da incorporadora.
      </p>
    </div>
  );
}

function SceneDocumentos({ onRestart, hrefs, onOpenList }) {
  return (
    <div className={styles.sceneInner}>
      <FolderArt />
      <p className={`${styles.eyebrow} ${styles.rise}`} style={{ "--d": "50ms" }}>Documentos</p>
      <h2 className={`${styles.title} ${styles.titleSm} ${styles.rise}`} style={{ "--d": "350ms" }}>{DOCUMENTS_SCENE_TEXT}</h2>
      <div className={`${styles.actions} ${styles.rise}`} style={{ "--d": "1000ms" }}>
        <button type="button" className={styles.cta} onClick={onOpenList} data-no-nav="" data-open-docs="">
          <FileText aria-hidden="true" />
          Lista de documentos
        </button>
        <DownloadAction href={hrefs.documents} label="Baixar imagem da lista de documentos" className={styles.ghostBtn} hint="Disponível no link enviado ao cliente" />
        <button type="button" className={styles.textBtn} onClick={onRestart} data-no-nav="">Rever a apresentação</button>
      </div>
    </div>
  );
}

function renderScene(scene, ctx) {
  switch (scene.id) {
    case "abertura": return <SceneAbertura scene={scene} reduced={ctx.reduced} />;
    case "poder": return <ScenePoder scene={scene} reduced={ctx.reduced} />;
    case "formacao": return <SceneFormacao scene={scene} reduced={ctx.reduced} />;
    case "parcelas": return <SceneParcelas scene={scene} />;
    case "diferenca": return <SceneDiferenca scene={scene} />;
    case "imovel": return <SceneImovel scene={scene} onNext={ctx.branchNext} last={scene.position >= scene.count} fast={ctx.fast} />;
    case "proximo": return <SceneProximo scene={scene} onValidate={ctx.validate} onOpenProperties={ctx.openProperties} propertyCount={ctx.propertyCount} hrefs={ctx.hrefs} fast={ctx.fast} />;
    case "validar": return <SceneValidar scene={scene} />;
    case "documentos": return <SceneDocumentos onRestart={ctx.restart} hrefs={ctx.hrefs} onOpenList={ctx.openList} />;
    default: return null;
  }
}

function sendEvent(token, body) {
  // Métrica é acessória: falha de rede nunca atrapalha a apresentação (e não há o que corrigir no cliente).
  fetch(`/api/s/${encodeURIComponent(token)}/evento`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
    cache: "no-store",
    credentials: "omit"
  }).catch(() => {});
}

export default function PresentationPlayer({ scenes, branch = [], token = "", preview = false, initialIndex = 0, initialBranch = 0, assetsBase = "", assetsQuery = "" }) {
  const reduced = usePrefersReducedMotion();
  const total = scenes.length;
  // Antes de VALIDAR SIMULAÇÃO só existem as cenas até "Próximo passo"; as finais abrem depois do botão.
  // `initialIndex` só é usado pela vitrine de desenvolvimento (revisão visual cena a cena); o link real começa na cena 1.
  const startIndex = Math.min(Math.max(0, Number(initialIndex) || 0), Math.max(0, total - 1));
  const [unlocked, setUnlocked] = useState(() => startIndex >= navigableSceneCount(scenes, false));
  const navTotal = navigableSceneCount(scenes, unlocked);
  const [state, dispatch] = useReducer(playerReducer, null, () => ({ ...createPlayerState(navigableSceneCount(scenes, startIndex >= navigableSceneCount(scenes, false))), index: startIndex }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [leaving, setLeaving] = useState(null);
  const [direction, setDirection] = useState("forward");
  const [docsOpen, setDocsOpen] = useState(false);
  // ramo opcional de imóveis: null = roteiro principal; número = posição (0-based) dentro de `branch`
  // `initialBranch` (1-based) só é usado pela vitrine de desenvolvimento
  const [branchIndex, setBranchIndex] = useState(() => (initialBranch > 0 && branch.length ? Math.min(Math.floor(initialBranch), branch.length) - 1 : null));
  const [returned, setReturned] = useState(false);
  const inBranch = branchIndex !== null;
  const prevIndex = useRef(null);
  const elapsed = useRef(0);
  const fillRef = useRef(null);
  const pointer = useRef(null);
  const maxReached = useRef(0);
  const openerRef = useRef(null);
  const tracking = Boolean(token) && !preview;
  const scene = scenes[state.index];
  const effective = { ...state, reducedMotion: reduced };
  const hrefs = useMemo(() => buildAssetHrefs({ token, preview, assetsBase, assetsQuery }), [token, preview, assetsBase, assetsQuery]);

  // troca de cena: relógio e barra zerados, saída suave da cena anterior (sem saída em movimento reduzido)
  useEffect(() => {
    elapsed.current = 0;
    setDocsOpen(false);
    if (fillRef.current) fillRef.current.style.transform = isLastScene(stateRef.current) ? "scaleX(1)" : "scaleX(0)";
    const plan = transitionPlan(effective, prevIndex.current);
    prevIndex.current = state.index;
    setDirection(plan.direction);
    setLeaving(plan.leaving);
    if (plan.leaving === null) return undefined;
    const timer = setTimeout(() => setLeaving(null), 380);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index]);

  // auto-avanço: relógio que só corre sem pausa (aba oculta também pausa) e respeita o tempo de leitura da cena
  const auto = isAutoAdvancing(state) && !inBranch; // no ramo de imóveis quem avança é o cliente
  useEffect(() => {
    if (!auto) return undefined;
    const duration = scene.durationMs;
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      const clock = advanceClock({ elapsed: elapsed.current, delta: now - last, duration });
      last = now;
      elapsed.current = clock.elapsed;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${duration ? clock.elapsed / duration : 1})`;
      if (clock.done) dispatch({ type: "auto" });
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [auto, state.index, scene.durationMs]);

  useEffect(() => {
    const onVisibility = () => dispatch({ type: document.hidden ? "hidden" : "visible" });
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // pré-carrega só a foto da PRÓXIMA cena do ramo (a primeira, enquanto o cliente está no "Próximo passo")
  useEffect(() => {
    const target = inBranch ? branch[branchIndex + 1] : scenes[state.index]?.id === "proximo" ? branch[0] : null;
    if (target?.imageUrl) {
      const image = new Image();
      image.src = target.imageUrl;
    }
  }, [scenes, branch, state.index, inBranch, branchIndex]);

  // métricas (só link real): abertura da sessão (recarga não conta de novo) + última cena + conclusão
  useEffect(() => {
    if (!tracking) return;
    let isNew = false;
    try {
      const key = SESSION_KEY(token);
      isNew = !window.sessionStorage.getItem(key);
      if (isNew) window.sessionStorage.setItem(key, "1");
    } catch {
      isNew = false;
    }
    sendEvent(token, { tipo: "abriu", nova: isNew });
  }, [tracking, token]);

  useEffect(() => {
    if (!tracking) return;
    // "concluiu" = chegou à ÚLTIMA cena da apresentação inteira (inclusive as liberadas por VALIDAR SIMULAÇÃO).
    const result = sceneMetricEvents({ index: state.index, total, maxReached: maxReached.current });
    maxReached.current = result.maxReached;
    result.events.forEach((event) => sendEvent(token, event));
  }, [tracking, token, state.index, total]);

  const branchRef = useRef({ branchIndex, length: branch.length });
  branchRef.current = { branchIndex, length: branch.length };
  const stepBranch = useCallback((action) => {
    const { branchIndex: current, length } = branchRef.current;
    const result = branchStep({ index: current ?? 0, total: length }, action);
    if (result.exit) {
      setBranchIndex(null); // volta ao "Próximo passo" do roteiro principal (o índice dele nunca saiu de lá)
      setReturned(true);
    } else setBranchIndex(result.index);
  }, []);
  const act = useCallback((action) => {
    if (action === "toggle") return dispatch({ type: "toggle" });
    if (branchRef.current.branchIndex !== null) return stepBranch(action);
    if (action === "next") dispatch({ type: "next" });
    else if (action === "prev") dispatch({ type: "prev" });
  }, [stepBranch]);
  const openProperties = useCallback(() => {
    if (!branchRef.current.length) return;
    setReturned(false);
    setBranchIndex(0);
  }, []);
  const branchNext = useCallback(() => stepBranch("next"), [stepBranch]);

  // VALIDAR SIMULAÇÃO: só um avanço dentro da apresentação (nenhuma mensagem enviada, nenhum dado gravado além da métrica de cena).
  const validate = useCallback(() => {
    setUnlocked(true);
    dispatch({ type: "unlock", total });
  }, [total]);
  const openList = useCallback((event) => {
    openerRef.current = event?.currentTarget || null;
    setDocsOpen(true);
  }, []);
  const closeList = useCallback(() => {
    setDocsOpen(false);
    if (openerRef.current && typeof openerRef.current.focus === "function") openerRef.current.focus();
  }, []);

  const onPointerDown = (event) => {
    if (event.target.closest("a,button,[data-no-nav]")) {
      pointer.current = null;
      return;
    }
    pointer.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const swipe = swipeAction(dx, dy);
    if (swipe) return act(swipe);
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) act(tapAction(event.clientX, event.currentTarget.clientWidth));
  };
  const onKeyDown = (event) => {
    if (event.target.closest("[data-sheet]")) return; // lista de documentos aberta: o teclado é dela
    if (event.target.closest("a,button") && (event.key === " " || event.key === "Enter")) return;
    if (event.key === "Escape" && branchRef.current.branchIndex !== null) {
      event.preventDefault();
      return stepBranch("prev");
    }
    const action = keyAction(event.key);
    if (action) {
      event.preventDefault();
      act(action);
    }
  };

  const paused = isPaused(state);
  const current = inBranch ? branch[branchIndex] : scenes[state.index];
  const announce = useMemo(() => announcement(current, state.index, total), [current, state.index, total]);
  const leavingScene = leaving !== null ? scenes[leaving] : null;
  const restart = useCallback(() => {
    setBranchIndex(null);
    dispatch({ type: "goto", index: 0 });
  }, []);
  const dir = direction === "back" ? styles.back : "";
  const ctx = { reduced, restart, validate, openList, hrefs, openProperties, branchNext, propertyCount: branch.length, fast: returned };

  return (
    <div
      className={styles.root}
      data-theme={theme(current)}
      data-scene={current.id}
      role="region"
      aria-roledescription="apresentação"
      aria-label="Apresentação da sua simulação"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className={styles.halo} aria-hidden="true" />

      <div className={styles.frame}>
        <ArchBackdrop />
        <div className={styles.chrome}>
          <div className={styles.bars} aria-hidden="true">
            {inBranch
              ? branch.map((item, i) => (
                  <span key={`branch-${i}`} className={`${styles.bar} ${i <= branchIndex ? styles.barDone : ""}`}>
                    <span className={styles.barFill} />
                  </span>
                ))
              : scenes.slice(0, navTotal).map((item, i) => (
                  <span key={`${item.id}-${i}`} className={`${styles.bar} ${i < state.index ? styles.barDone : ""}`}>
                    {i === state.index ? <span ref={fillRef} className={styles.barFill} /> : <span className={styles.barFill} />}
                  </span>
                ))}
          </div>
          <div className={styles.chromeRow}>
            <span className={styles.brand}>
              {/* logo oficial (único do projeto): o branco do M exige fundo escuro, por isso vai sempre sobre azul-marinho */}
              <span className={styles.brandMark}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/assets/matheus-machado-symbol.png" alt="" width={24} height={19} />
              </span>
              {/* mesma assinatura da logo: nome em destaque e a função logo abaixo */}
              <span className={styles.brandText}>
                <strong>{BRAND_NAME}</strong>
                <span>{BRAND_ROLE}</span>
              </span>
            </span>
            <button type="button" className={styles.iconBtn} onClick={() => dispatch({ type: "toggle" })} aria-label={state.paused ? "Continuar apresentação" : "Pausar apresentação"} aria-pressed={state.paused}>
              {state.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            </button>
          </div>
          {preview ? <p className={styles.preview}>Prévia: esta visualização não conta como abertura</p> : null}
        </div>

        <div className={styles.stage} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { pointer.current = null; }}>
          {leavingScene && !inBranch ? (
            <div key={`leave-${leaving}`} data-scene={leavingScene.id} className={`${styles.scene} ${styles.leave} ${leavingScene.id === "imovel" ? styles.photoScene : ""}`} aria-hidden="true">
              {renderScene(leavingScene, { ...ctx, reduced: true })}
            </div>
          ) : null}
          <div key={inBranch ? `branch-${branchIndex}` : `scene-${state.index}`} data-scene={current.id} className={`${styles.scene} ${styles.enter} ${inBranch ? "" : dir} ${current.id === "imovel" ? styles.photoScene : ""}`}>
            {renderScene(current, ctx)}
          </div>
          {docsOpen && current.id === "documentos" ? <DocumentsSheet items={current.items} onClose={closeList} /> : null}
        </div>

        {/* logo da Caixa (a MESMA do formulário público): rodapé fixo de TODAS as cenas, direto sobre o fundo (sem pílula,
            sem caixa); nas cenas escuras ganha um brilho suave para o azul não sumir no azul-marinho. Só a logo, sem texto. */}
        <div className={styles.caixa}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.caixaLogo} src={CAIXA_LOGO} alt="Caixa Econômica Federal" width={780} height={196} />
        </div>
      </div>

      <button type="button" className={`${styles.side} ${styles.sidePrev}`} onClick={() => act("prev")} disabled={!inBranch && state.index === 0} aria-label="Cena anterior">
        <ChevronLeft aria-hidden="true" />
      </button>
      <button type="button" className={`${styles.side} ${styles.sideNext}`} onClick={() => act("next")} disabled={!inBranch && isLastScene(state)} aria-label="Próxima cena">
        <ChevronRight aria-hidden="true" />
      </button>

      <div className={styles.sr} aria-live="polite" role="status">{announce}{paused ? " Pausado." : ""}</div>
    </div>
  );
}
