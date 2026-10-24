"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import styles from "./HenrySearchScene.module.css";
import { HENRY_BEAM_CYAN, HENRY_BEAM_GOLD, HenryStrandBeams } from "./HenryStrandBeam";
import { isPageHidden, onPageVisibilityChange } from "@/components/page-visibility";

// Cena de busca do Henry. Pedido original do dono (2026-10-22): dados transparentes atrás do anel e, para corretor, um
// "scanner" e o cardzinho com a foto ligado ao anel. Redesenho no mesmo dia ("a cena ficou muito pobre, quero algo bem
// mais elaborado"): ambiente de busca em camadas, nível "HUD de assistente de IA", sem poluir.
//   HenryDataScene   — grade em perspectiva (chão), partículas puxadas das bordas para o anel (canvas leve), painéis
//                      holográficos em perspectiva com cartões do assunto pedido (funil, ranking, clientes, relatório,
//                      meta, WhatsApp, web) e varredura de luz. Fases: entrada (desfocado → nítido) → busca (destaque
//                      passando de cartão em cartão) → achou (um cartão vem para frente e é absorvido pelo anel, que pulsa;
//                      os outros desfocam) → saída suave. Números FICTÍCIOS e sempre em movimento enquanto busca (nunca
//                      param num valor que pareça um resultado real); rótulos genéricos, nenhum nome de cliente.
//   HenryBrokerCards — carrossel de silhuetas passando rápido com a mira travando no corretor; achou → card premium
//                      (borda dourado/ciano, foto do painel, primeiro nome, 1–2 números contando, posição se vier) ligado
//                      ao anel por um feixe curvo com partículas. Até 3, em arco à direita do anel (celular: acima dele).
//   HenryDetailPanel — o detalhe completo da resposta (relatório/corretor/cliente) em lista, na tela (a voz só resume),
//                      sem card/fundo (dono, 2026-10-22): só o texto com sombra.
// Paleta do Henry: navy #07111F, ciano #4FC3E0, azul #1E9BFF, dourado #E8B85C. Estilos em HenrySearchScene.module.css.
// Aba oculta = tudo pausado (CSS, ticker e canvas); prefers-reduced-motion = versão parada.

const ACCENT = "#4FC3E0";
const GOLD = "#E8B85C";

// Só o giro do indicador do ícone pequeno (HenryIconSearchHint) continua global.
const CSS = `
@keyframes henry-spin { to { transform: rotate(360deg); } }
.henry-spin { animation: henry-spin 2.4s linear infinite; }
@media (prefers-reduced-motion: reduce) { .henry-spin { animation: none !important; } }
`;

export function HenrySceneStyles() {
  return <style>{CSS}</style>;
}

// Aba oculta → animações pausadas (economia de CPU/bateria).
// Aba oculta OU janela do app de desktop minimizada/na bandeja (components/page-visibility.js, 2026-10-23).
export function useTabHidden() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const sync = () => setHidden(isPageHidden());
    sync();
    return onPageVisibilityChange(sync);
  }, []);
  return hidden;
}

export function useViewportWidth() {
  const [width, setWidth] = useState(1280);
  useEffect(() => {
    const sync = () => setWidth(window.innerWidth);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  return width;
}

// Relógio da cena: avança enquanto busca (destaque, números e páginas mudam a cada passo).
function useTicker(running, ms = 950) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setTick((value) => value + 1), ms);
    return () => clearInterval(id);
  }, [running, ms]);
  return tick;
}

// Gerador determinístico (mesmo assunto = mesma "tela"), só para enfeite.
function seeded(seed) {
  let value = seed % 2147483647 || 1;
  return () => {
    value = (value * 48271) % 2147483647;
    return value / 2147483647;
  };
}
// Número de enfeite que muda a cada passo (não para num valor: não é resultado).
function churn(base, spread, tick, salt = 0) {
  return base + ((tick * 7919 + salt * 104729 + salt * salt * 31) % Math.max(1, spread));
}

const STAGES = ["Atendimento", "Simulação", "Documentação", "Aprovação", "Venda"];
const STATUS = ["Em atendimento", "Simulação enviada", "Aguardando docs", "Em aprovação", "Tentando contato", "Reunião marcada"];
const TOPIC_SEED = { geral: 11, relatorio: 23, funil: 37, ranking: 41, clientes: 53, corretor: 67, meta: 79, whatsapp: 97, internet: 101 };
const RANKING = { left: ["rank", "bars", "line"], right: ["ring", "table"], mobile: ["rank", "ring"] };
const REPORT = { left: ["line", "funnel", "bars"], right: ["rank", "ring"], mobile: ["line", "funnel"] };
const LAYOUTS = {
  funil: { left: ["funnel", "bars", "line"], right: ["table", "ring"], mobile: ["funnel", "line"] },
  ranking: RANKING,
  corretor: RANKING,
  clientes: { left: ["table", "funnel", "line"], right: ["bars", "ring"], mobile: ["table", "funnel"] },
  relatorio: REPORT,
  geral: REPORT,
  meta: { left: ["ring", "rank", "bars"], right: ["line", "table"], mobile: ["ring", "rank"] },
  whatsapp: { left: ["status", "line", "bars"], right: ["table", "ring"], mobile: ["status", "line"] },
  internet: { left: ["query", "pages"], right: ["pages"], mobile: ["query", "pages"] }
};
const TITLES = {
  funnel: () => "Funil",
  bars: (topic) => ({ funil: "Entradas por dia", ranking: "Pontos na semana", corretor: "Pontos na semana", clientes: "Atendimentos", meta: "Atividades", whatsapp: "Mensagens" })[topic] || "Leads por dia",
  line: (topic) => ({ whatsapp: "Respostas", meta: "Ritmo da equipe", ranking: "Evolução", corretor: "Evolução" })[topic] || "Tendência do período",
  table: (topic) => (topic === "whatsapp" ? "Conversas" : "Clientes"),
  ring: (topic) => (topic === "meta" || topic === "ranking" || topic === "corretor" ? "Meta Diária" : "Conversão"),
  rank: () => "Ranking",
  status: () => "WhatsApp",
  query: () => "Pesquisa na web",
  pages: () => "Páginas"
};

function sparkPath(random, width = 200, height = 46) {
  const points = Array.from({ length: 10 }, (_, index) => [Math.round((index / 9) * width), Math.round(height - 6 - random() * (height - 14) * (0.35 + index / 14))]);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join(" ");
  return { line, area: `${line} L${width} ${height} L0 ${height} Z`, end: points[points.length - 1] };
}

function CardHead({ title, value }) {
  return (
    <div className={styles.cardHead}>
      <span className={styles.live} />
      <span>{title}</span>
      {value != null ? <span className={styles.headValue}>{value}</span> : null}
    </div>
  );
}

function CardBody({ kind, topic, seed, tick, mobile, gradientId }) {
  const data = useMemo(() => {
    const random = seeded(seed);
    return { spark: sparkPath(random), bases: Array.from({ length: 12 }, () => random()) };
  }, [seed]);
  const { bases } = data;
  if (kind === "line") {
    return (
      <>
        <CardHead title={TITLES.line(topic)} />
        <p className={styles.bigNumber}>
          {churn(120 + Math.round(bases[0] * 80), 60, tick, seed)}
          <span className={styles.unit}>{topic === "whatsapp" ? "respostas" : topic === "meta" ? "atividades" : "leads"}</span>
        </p>
        <svg viewBox="0 0 200 46" preserveAspectRatio="none" className={styles.spark} aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity="0.35" />
              <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={data.spark.area} fill={`url(#${gradientId})`} className={styles.sparkArea} />
          <path d={data.spark.line} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" pathLength="1" className={styles.sparkLine} vectorEffect="non-scaling-stroke" />
        </svg>
      </>
    );
  }
  if (kind === "bars") {
    const count = mobile ? 7 : 9;
    return (
      <>
        <CardHead title={TITLES.bars(topic)} />
        <div className={styles.bars}>
          {Array.from({ length: count }, (_, index) => {
            const height = 0.25 + ((bases[index % 12] * 0.6 + ((tick + index) % 4) * 0.08) % 0.75);
            return <span key={index} className={styles.bar} data-gold={index === count - 1 ? "1" : undefined} style={{ "--h": height.toFixed(2), "--bd": `${index * 45}ms` }} />;
          })}
        </div>
      </>
    );
  }
  if (kind === "funnel") {
    const stages = mobile ? STAGES.slice(0, 3) : STAGES;
    return (
      <>
        <CardHead title={TITLES.funnel()} />
        <div className={styles.rows}>
          {stages.map((stage, index) => {
            const width = Math.max(0.12, 1 - index * 0.19 - bases[index] * 0.08 + ((tick + index) % 3) * 0.03);
            return (
              <div key={stage} className={styles.row}>
                <span className={styles.rowLabel}>{stage}</span>
                <span className={styles.rowValue}>{churn(Math.round(90 / (index + 1)), 14, tick, index + seed)}</span>
                <span className={styles.track}>
                  <span className={styles.fill} style={{ "--w": width.toFixed(2), "--bd": `${index * 70}ms` }} />
                </span>
              </div>
            );
          })}
        </div>
      </>
    );
  }
  if (kind === "rank") {
    const rows = mobile ? 3 : 5;
    return (
      <>
        <CardHead title={TITLES.rank()} />
        <div className={styles.rows}>
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className={styles.row}>
              <span className={styles.rowLabel}>
                <span className={styles.rankPos}>{index + 1}º</span>
                <span className={styles.mask}>{"●".repeat(4 + ((index + seed) % 3))}</span>
              </span>
              <span className={styles.rowValue}>{churn(420 - index * 55, 30, tick, index)} pts</span>
              <span className={styles.track}>
                <span className={styles.fill} data-gold={index === 0 ? "1" : undefined} style={{ "--w": (0.95 - index * 0.15).toFixed(2), "--bd": `${index * 70}ms` }} />
              </span>
            </div>
          ))}
        </div>
      </>
    );
  }
  if (kind === "table" || kind === "status") {
    const rows = Array.from({ length: 8 }, (_, index) =>
      kind === "status" || topic === "whatsapp"
        ? { label: `Número ${(index % 2) + 1}`, value: (index + seed) % 5 ? "conectado" : "reconectando", tone: (index + seed) % 5 ? "cyan" : "gold" }
        : { label: "Cliente ••••", value: STATUS[(index + seed) % STATUS.length], tone: ["cyan", "blue", "gold"][index % 3] }
    );
    return (
      <>
        <CardHead title={kind === "status" ? TITLES.status() : TITLES.table(topic)} value={kind === "status" ? null : `${churn(30, 40, tick, seed)}`} />
        <div className={styles.tableWin}>
          <div className={styles.tableRoll} style={{ animationDuration: `${8 + (seed % 4)}s` }}>
            {[...rows, ...rows].map((row, index) => (
              <div key={index} className={styles.tableRow}>
                <span className={styles.dot} data-tone={row.tone} />
                <span className={styles.rowLabel}>{row.label}</span>
                <span className={styles.rowLabel} style={{ color: "rgba(215,238,246,0.6)" }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }
  if (kind === "ring") {
    const percent = churn(52, 40, tick, seed);
    const circumference = 1;
    return (
      <>
        <CardHead title={TITLES.ring(topic)} />
        <div className={styles.ringWrap}>
          <svg viewBox="0 0 64 64" className={styles.ringSvg} aria-hidden="true">
            <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(79,195,224,0.14)" strokeWidth="6" />
            <circle cx="32" cy="32" r="26" fill="none" stroke={GOLD} strokeWidth="6" strokeLinecap="round" pathLength="1" className={styles.ringArc} style={{ strokeDashoffset: circumference - percent / 100 }} />
          </svg>
          <div>
            <p className={styles.bigNumber} style={{ marginTop: 0 }}>
              {percent}
              <span className={styles.unit}>%</span>
            </p>
            {!mobile ? <p className={styles.unit} style={{ marginLeft: 0 }}>da equipe agora</p> : null}
          </div>
        </div>
      </>
    );
  }
  if (kind === "query") {
    return (
      <>
        <CardHead title={TITLES.query()} />
        <div className={styles.query}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" />
          </svg>
          <span>Pesquisando</span>
          <span className={styles.typing}>
            <i />
            <i />
            <i />
          </span>
        </div>
        {!mobile ? (
          <div className={styles.rows}>
            {["Fontes encontradas", "Lendo agora"].map((label, index) => (
              <div key={label} className={styles.row}>
                <span className={styles.rowLabel}>{label}</span>
                <span className={styles.rowValue}>{index ? (tick % 3) + 1 : Math.min(9, 3 + (tick % 7))}</span>
              </div>
            ))}
          </div>
        ) : null}
      </>
    );
  }
  // pages: páginas genéricas folheando (título + barras de texto; nenhum site real).
  const total = 4;
  return (
    <>
      <CardHead title={TITLES.pages()} value={`${(tick % total) + 1}/${total}`} />
      <div className={styles.pages}>
        {Array.from({ length: total }, (_, index) => {
          const position = (((index - tick) % total) + total) % total;
          const pos = position === total - 1 ? -1 : position;
          return (
            <div key={index} className={styles.page} data-pos={pos}>
              <div className={styles.pageTitle} style={{ width: `${48 + ((index * 17 + seed) % 30)}%` }} />
              <div className={styles.pageUrl} />
              {Array.from({ length: mobile ? 3 : 7 }, (_, line) => (
                <div key={line} className={styles.pageLine} style={{ width: `${64 + ((line * 23 + index * 11) % 34)}%` }} />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

// Partículas/feixes puxados das bordas para o anel (canvas 2D leve, só enquanto busca e com a aba visível).
function HenryParticles({ running, mobile, orbSize, burst }) {
  const ref = useRef(null);
  const burstRef = useRef(burst);
  burstRef.current = burst;
  useEffect(() => {
    if (!running) return undefined;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return undefined;
    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const max = mobile ? 26 : 60;
    const colors = ["79,195,224", "79,195,224", "30,155,255", "232,184,92"];
    const parts = [];
    const spawn = () => {
      const side = Math.floor(Math.random() * 4);
      const t = Math.random();
      const x = side === 0 ? t * width : side === 1 ? width + 10 : side === 2 ? t * width : -10;
      const y = side === 0 ? -10 : side === 1 ? t * height : side === 2 ? height + 10 : t * height;
      parts.push({ x, y, speed: 30 + Math.random() * 50, spin: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.35), color: colors[Math.floor(Math.random() * colors.length)], age: 0 });
    };
    let last = performance.now();
    let raf = 0;
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const cx = width / 2;
      const cy = height / 2 - (mobile ? window.innerHeight * 0.14 : 0);
      const ring = orbSize * 0.33;
      const bursting = burstRef.current;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      if (parts.length < (bursting ? max * 1.5 : max) && Math.random() < (bursting ? 0.95 : 0.4)) spawn();
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const p = parts[index];
        const dx = cx - p.x;
        const dy = cy - p.y;
        const distance = Math.hypot(dx, dy) || 1;
        p.age += dt;
        p.speed += dt * (bursting ? 620 : 150);
        const ux = dx / distance;
        const uy = dy / distance;
        // componente tangencial: entra em espiral, como se o anel puxasse
        const swirl = p.spin * Math.min(1, distance / (ring * 3));
        const vx = ux - uy * swirl;
        const vy = uy + ux * swirl;
        const norm = Math.hypot(vx, vy) || 1;
        const step = p.speed * dt;
        p.x += (vx / norm) * step;
        p.y += (vy / norm) * step;
        if (distance < ring * 1.04) {
          parts.splice(index, 1);
          continue;
        }
        const tail = Math.min(70, 6 + p.speed * 0.14);
        const alpha = Math.min(1, p.age * 2) * Math.min(1, (distance - ring) / (ring * 0.9)) * 0.75;
        const tx = p.x - (vx / norm) * tail;
        const ty = p.y - (vy / norm) * tail;
        const gradient = ctx.createLinearGradient(tx, ty, p.x, p.y);
        gradient.addColorStop(0, `rgba(${p.color},0)`);
        gradient.addColorStop(1, `rgba(${p.color},${alpha.toFixed(3)})`);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.fillStyle = `rgba(${p.color},${(alpha * 0.9).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      ctx.clearRect(0, 0, width, height);
    };
  }, [running, mobile, orbSize]);
  return <canvas ref={ref} className={styles.particles} aria-hidden="true" />;
}

// Fases: off → enter (700 ms) → search → [busca termina] found (1,1 s) → exit (0,6 s) → off.
function useScenePhase(active, reduced) {
  const [phase, setPhase] = useState(active ? "enter" : "off");
  useEffect(() => {
    if (active) {
      setPhase(reduced ? "search" : "enter");
      if (reduced) return undefined;
      const id = setTimeout(() => setPhase("search"), 700);
      return () => clearTimeout(id);
    }
    setPhase((current) => (current === "off" ? "off" : reduced ? "exit" : "found"));
    return undefined;
  }, [active, reduced]);
  useEffect(() => {
    if (phase !== "found" && phase !== "exit") return undefined;
    const id = setTimeout(() => setPhase(phase === "found" ? "exit" : "off"), phase === "found" ? 1100 : 650);
    return () => clearTimeout(id);
  }, [phase]);
  return phase;
}

export function HenryDataScene({ active = false, topic = "geral", mobile = false, orbSize = 520, hasBrokers = false }) {
  const hidden = useTabHidden();
  const reduced = usePrefersReducedMotion();
  const viewport = useViewportWidth();
  const phase = useScenePhase(active, reduced);
  const [shownTopic, setShownTopic] = useState(topic);
  useEffect(() => {
    if (active) setShownTopic(topic);
  }, [active, topic]);
  const searching = phase === "enter" || phase === "search";
  const tick = useTicker(searching && !hidden && !reduced);
  const layout = LAYOUTS[shownTopic] || LAYOUTS.geral;
  const seedBase = TOPIC_SEED[shownTopic] || 7;
  const ringOuter = Math.round(orbSize * 0.37);
  const wingWidth = Math.min(276, Math.round(viewport / 2 - ringOuter - 56));
  const showWings = !mobile && wingWidth >= 190;
  // Celular: faixa acima do anel (os corretores ficam abaixo dele). Computador: asa esquerda + direita (a direita cede
  // o lugar ao arco de corretores).
  const wings = mobile
    ? [{ key: "top", kinds: layout.mobile }]
    : showWings
      ? [{ key: "left", kinds: layout.left }, ...(hasBrokers ? [] : [{ key: "right", kinds: layout.right }])]
      : [];
  const cards = wings.flatMap((wing) => wing.kinds.map((kind, index) => ({ wing: wing.key, kind, index })));
  const lit = cards.length ? tick % cards.length : -1;
  const litRef = useRef(lit);
  if (searching) litRef.current = lit;
  const chosen = litRef.current;
  const cardRefs = useRef([]);
  const sceneRef = useRef(null);
  const gradientBase = useId().replace(/[^a-zA-Z0-9]/g, "");

  // Achou: o cartão escolhido voa até o centro do anel (deslocamento medido na hora).
  useLayoutEffect(() => {
    if (phase !== "found") return;
    const element = cardRefs.current[chosen];
    const scene = sceneRef.current;
    if (!element || !scene) return;
    const box = element.getBoundingClientRect();
    const area = scene.getBoundingClientRect();
    const cx = area.left + area.width / 2;
    const cy = area.top + area.height / 2 - (mobile ? window.innerHeight * 0.14 : 0);
    element.style.setProperty("--dx", `${Math.round(cx - (box.left + box.width / 2))}px`);
    element.style.setProperty("--dy", `${Math.round(cy - (box.top + box.height / 2))}px`);
  }, [phase, chosen, mobile]);

  if (phase === "off" && !active) {
    return <div aria-hidden="true" data-henry-data-scene="off" className={styles.scene} data-phase="off" />;
  }
  const centerTop = mobile ? "calc(50% - 14vh)" : "50%";
  const wingStyle = (key) => {
    if (key === "top") return { top: "calc(env(safe-area-inset-top, 0px) + 68px)", left: 14, right: 14, transform: "rotateX(16deg)" };
    if (key === "left") return { right: `calc(50% + ${ringOuter + 20}px)`, width: wingWidth, top: "50%", transform: "translateY(-52%) rotateY(20deg)", transformOrigin: "100% 50%" };
    return { left: `calc(50% + ${ringOuter + 20}px)`, width: wingWidth, top: `calc(50% - ${Math.round(Math.min(orbSize * 0.5, 300))}px)`, transform: "rotateY(-20deg)", transformOrigin: "0% 50%" };
  };
  let cardIndex = -1;
  return (
    <div
      ref={sceneRef}
      aria-hidden="true"
      data-henry-data-scene={active ? shownTopic : "off"}
      data-phase={phase}
      className={`${styles.scene} ${mobile ? styles.mobile : ""} ${hidden ? styles.paused : ""}`}
    >
      <div className={styles.floor}>
        <div className={styles.floorGrid} />
      </div>
      <div className={styles.horizon} />
      {!reduced ? <HenryParticles running={phase !== "exit" && phase !== "off" && !hidden} mobile={mobile} orbSize={orbSize} burst={phase === "found"} /> : null}
      <div className={styles.stage}>
        {wings.map((wing) => (
          <div key={wing.key} className={`${styles.wing} ${wing.key === "top" ? styles.wingTop : ""}`} style={wingStyle(wing.key)}>
            {wing.kinds.map((kind) => {
              cardIndex += 1;
              const index = cardIndex;
              return (
                <div
                  key={`${shownTopic}-${wing.key}-${index}`}
                  ref={(element) => {
                    cardRefs.current[index] = element;
                  }}
                  className={styles.card}
                  data-lit={phase === "search" && index === lit ? "1" : undefined}
                  data-chosen={index === chosen ? "1" : undefined}
                  style={{ "--delay": `${index * 80}ms` }}
                >
                  <CardBody kind={kind} topic={shownTopic} seed={seedBase + index * 13} tick={tick} mobile={mobile} gradientId={`${gradientBase}-g${index}`} />
                  {!reduced ? <span className={styles.scan} style={{ "--scan-delay": `${index * 0.7}s` }} /> : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {phase === "found" ? (
        <>
          <span className={styles.pulse} style={{ left: "50%", top: centerTop, width: orbSize * 0.66, height: orbSize * 0.66, animationDelay: "380ms" }} />
          <span className={styles.pulse} data-second="1" style={{ left: "50%", top: centerTop, width: orbSize * 0.66, height: orbSize * 0.66, animationDelay: "600ms" }} />
        </>
      ) : null}
    </div>
  );
}

// ======================= corretores =======================

function initialOf(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function BrokerAvatar({ broker, size = 44 }) {
  const [failed, setFailed] = useState(false);
  if (broker.photoUrl && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={broker.photoUrl} alt="" width={size} height={size} onError={() => setFailed(true)} className="shrink-0 rounded-full object-cover ring-2" style={{ width: size, height: size, "--tw-ring-color": ACCENT }} draggable={false} />;
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full text-base font-bold ring-2" style={{ width: size, height: size, background: "#0F2A47", color: GOLD, "--tw-ring-color": ACCENT }}>
      {initialOf(broker.firstName)}
    </span>
  );
}

function Silhouette() {
  return (
    <svg viewBox="0 0 56 76" width="100%" height="100%" aria-hidden="true">
      <circle cx="28" cy="30" r="11" fill="#24507A" />
      <path d="M8 76c2-16 10-24 20-24s18 8 20 24z" fill="#1B3B5E" />
    </svg>
  );
}

function BrokerPhoto({ broker, className }) {
  const [failed, setFailed] = useState(false);
  if (broker.photoUrl && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={broker.photoUrl} alt="" className={className} onError={() => setFailed(true)} draggable={false} />;
  }
  return <span className={`${className} ${styles.initial}`}>{initialOf(broker.firstName)}</span>;
}

// Procurando: silhuetas passando rápido; a fita desacelera e a mira trava no corretor (foto ainda levemente desfocada).
function BrokerScanner({ broker, mobile, compact }) {
  const tile = mobile ? 50 : 56;
  const width = compact ? 112 : mobile ? 236 : 252;
  const target = 6;
  const land = Math.round(width / 2 - (12 + target * (tile + 12) + tile / 2));
  return (
    <div className={styles.scanner} style={{ width }} data-henry-broker-scanner>
      <div className={styles.strip} style={{ "--land": `${land}px` }}>
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} className={styles.tile} data-target={index === target ? "1" : undefined}>
            {index === target && broker?.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={broker.photoUrl} alt="" draggable={false} />
            ) : (
              <Silhouette />
            )}
          </span>
        ))}
      </div>
      <span className={styles.reticle}>
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className={styles.scanBeamV} style={{ "--scan-w": `${width}px` }} />
      {!compact ? <span className={styles.scanLabel}>Procurando corretor</span> : null}
    </div>
  );
}

function parseStat(value) {
  const match = /^(\d{1,7})(\D{0,6})$/.exec(String(value || "").trim());
  return match ? { number: Number(match[1]), suffix: match[2] } : null;
}

function PremiumCard({ broker, mobile, delay = 0 }) {
  const positionStat = (broker.stats || []).find((stat) => /posi|lugar|ranking/i.test(stat.label));
  const position = broker.position || (positionStat ? String(positionStat.value).replace(/\D/g, "") : "");
  const stats = (broker.stats || []).filter((stat) => stat !== positionStat).slice(0, 2);
  return (
    <div className={styles.premium} style={{ "--delay": `${delay}ms` }} data-henry-broker-card={broker.id}>
      <div className={styles.premiumInner}>
        <span className={styles.sheen} />
        <span className={styles.photoWrap}>
          <BrokerPhoto broker={broker} className={styles.photo} />
          {position ? <span className={styles.badge}>{position}º</span> : null}
        </span>
        <div style={{ minWidth: 0 }}>
          <p className={styles.name}>{broker.firstName}</p>
          {stats.length ? (
            <div className={styles.stats}>
              {stats.map((stat) => {
                const parsed = parseStat(stat.value);
                return (
                  <span key={stat.label} className={styles.stat}>
                    <span className={styles.statValue}>
                      {parsed ? <AnimatedNumber value={parsed.number} duration={1.1} format={(n) => `${Math.round(n)}${parsed.suffix}`} /> : stat.value}
                    </span>
                    <span className={styles.statLabel}>{stat.label}</span>
                  </span>
                );
              })}
            </div>
          ) : (
            <p className={styles.found}>encontrado</p>
          )}
        </div>
      </div>
    </div>
  );
}

const ARC_ANGLES = { 1: [0], 2: [-24, 16], 3: [-46, -12, 22] };

// Cards em arco à direita do anel (computador) ou acima dele (celular), ligados pelo feixe padrão do Henry.
export function HenryBrokerCards({ brokers = [], orbSize = 400, mobile = false }) {
  const hidden = useTabHidden();
  const reduced = usePrefersReducedMotion();
  const list = brokers.slice(-3);
  if (!list.length) return null;
  const found = list.filter((broker) => broker.found);
  const searchingBroker = [...list].reverse().find((broker) => !broker.found) || null;
  const items = [...found.map((broker) => ({ kind: "card", broker })), ...(searchingBroker ? [{ kind: "scanner", broker: searchingBroker }] : [])].slice(-3);
  const size = orbSize;
  const c = size / 2;
  const ring = size * 0.33;
  const placed = items.map((item, index) => {
    if (mobile) {
      const compact = item.kind === "scanner" && items.length > 1;
      // Celular: abaixo do anel (acima fica o cabeçalho; a transcrição começa mais abaixo).
      const spread = items.length === 1 ? [0] : items.length === 2 ? [-62, 62] : [-120, 0, 120];
      const x = c + spread[index];
      const y = c + ring + 20;
      const angle = Math.atan2(y - c, x - c);
      const start = [c + ring * Math.cos(angle), c + ring * Math.sin(angle)];
      return { ...item, compact, x, y, start, control: [x, (start[1] + y) / 2 - 4] };
    }
    const angle = ((ARC_ANGLES[items.length] || ARC_ANGLES[3])[index] * Math.PI) / 180;
    const radius = size * 0.5 + 34;
    const x = c + radius * Math.cos(angle);
    const y = c + radius * Math.sin(angle);
    const start = [c + ring * Math.cos(angle), c + ring * Math.sin(angle)];
    const mid = (ring + radius) / 2;
    const control = [c + mid * Math.cos(angle) - Math.sin(angle) * 34, c + mid * Math.sin(angle) + Math.cos(angle) * 34];
    return { ...item, x, y, start, control };
  });
  return (
    <div className={`${styles.brokers} ${mobile ? styles.mobileB : ""} ${hidden ? styles.paused : ""}`} style={{ width: size, height: size }} data-henry-brokers aria-hidden="true">
      {/* Feixe padrão do Henry (5 fios vibrando, HenryStrandBeam): dourado no card do corretor, ciano no scanner. */}
      <HenryStrandBeams
        beams={placed.map((item) => ({ id: `${item.kind}-${item.broker.id}`, start: item.start, control: item.control, end: [item.x, item.y], color: item.kind === "card" ? HENRY_BEAM_GOLD : HENRY_BEAM_CYAN }))}
        size={size}
        reduced={reduced}
        hidden={hidden}
      />
      <svg className={styles.beams} width={size} height={size} aria-hidden="true">
        {placed.map((item) => (
          <circle key={`${item.kind}-${item.broker.id}`} cx={item.x} cy={item.y} r="3.2" fill={item.kind === "card" ? GOLD : ACCENT} />
        ))}
      </svg>
      {placed.map((item, index) => (
        <div
          key={`${item.kind}-${item.broker.id}`}
          className={`${styles.slot} ${mobile ? styles.slotTop : ""}`}
          style={{ left: mobile ? item.x : item.x + 4, top: item.y }}
        >
          {item.kind === "card" ? <PremiumCard broker={item.broker} mobile={mobile} delay={index * 90} /> : <BrokerScanner broker={item.broker} mobile={mobile} compact={item.compact} />}
        </div>
      ))}
    </div>
  );
}

// Detalhe da resposta na tela (relatório, corretor, cliente): título, período e seções com linhas rótulo/valor/nota.
// Ações de uma linha (rascunho de aniversário do cliente do dono, 2026-10-24): copiar o texto e abrir o WhatsApp (wa.me
// com o texto pronto). O Henry nunca envia: quem manda é o dono.
function HenryRowActions({ actions = [] }) {
  const [copied, setCopied] = useState(false);
  const list = (actions || []).filter((action) => (action?.kind === "copy" && typeof action.text === "string") || (action?.kind === "link" && /^https:\/\/wa\.me\//.test(action.href || "")));
  if (!list.length) return null;
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <span className="mt-1 flex flex-wrap gap-2" style={{ textShadow: "none" }}>
      {list.map((action, index) =>
        action.kind === "copy" ? (
          <button key={index} type="button" onClick={() => copy(action.text)} className="rounded-full px-3 py-1 text-[11px] font-bold ring-1 ring-white/25 hover:bg-white/10" style={{ color: ACCENT }}>
            {copied ? "Copiado" : action.label || "Copiar"}
          </button>
        ) : (
          <a key={index} href={action.href} target="_blank" rel="noopener noreferrer" className="rounded-full px-3 py-1 text-[11px] font-bold ring-1 ring-white/25 hover:bg-white/10" style={{ color: ACCENT }}>
            {action.label || "Abrir WhatsApp"}
          </a>
        )
      )}
    </span>
  );
}

// Confirmação na tela (HENRY-1, dono 2026-10-24): o aviso de aniversariante ao corretor só sai por este clique.
function HenryConfirmBlock({ confirm, onConfirm }) {
  const [state, setState] = useState({ busy: false, done: false, text: "" });
  const key = (confirm?.clientIds || []).join(",");
  useEffect(() => setState({ busy: false, done: false, text: "" }), [key]);
  if (!confirm?.label || typeof onConfirm !== "function") return null;
  const send = async () => {
    if (state.busy || state.done) return;
    setState({ busy: true, done: false, text: "" });
    const result = await onConfirm(confirm).catch(() => ({ ok: false, text: "Não consegui enviar o aviso agora." }));
    setState({ busy: false, done: result?.ok === true, text: result?.text || "" });
  };
  return (
    <div className="mt-3" style={{ textShadow: "none" }}>
      {confirm.note ? <p className="mb-2 text-[11px] text-white/75">{confirm.note}</p> : null}
      <button type="button" onClick={send} disabled={state.busy || state.done} className="rounded-full bg-white px-4 py-2 text-[12px] font-bold text-navy disabled:opacity-60">
        {state.done ? "Aviso enviado" : state.busy ? "Enviando…" : confirm.label}
      </button>
      {state.text ? <p className="mt-2 text-[12px] text-white/90" role="status">{state.text}</p> : null}
    </div>
  );
}

export function HenryDetailPanel({ detail, mobile = false, onConfirm = null }) {
  if (!detail?.sections?.length) return null;
  return (
    <section
      className={`${mobile ? "w-full" : "absolute left-6 top-24 w-[min(380px,30vw)] max-h-[calc(100vh-9rem)] overflow-y-auto md:left-8"} py-1 text-left`}
      // Sem card (dono, 2026-10-22: "texto sem fundo, só as palavras flutuando"): sombra em camadas para ler sobre a cena.
      style={{ textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 0 10px rgba(7,17,31,0.95), 0 0 22px rgba(7,17,31,0.85)", userSelect: "text", WebkitUserSelect: "text" }}
      aria-label={detail.title}
      data-henry-detail
    >
      <p className="text-[13px] font-bold text-white">{detail.title}</p>
      {detail.subtitle ? <p className="text-[11px] text-white/75">{detail.subtitle}</p> : null}
      <div className="mt-3 space-y-3">
        {detail.sections.map((section, index) => (
          <div key={`${section.title}-${index}`}>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: ACCENT }}>{section.title}</p>
            <ul className="space-y-0.5">
              {(section.rows || []).map((row, rowIndex) => Array.isArray(row.actions) && row.actions.length ? (
                <li key={rowIndex} className="text-[13px] leading-snug text-white/90">
                  <span className="font-bold text-white">{row.label}</span>
                  {row.note ? <span className="mt-0.5 block text-[12px] text-white/85">{row.note}</span> : null}
                  <HenryRowActions actions={row.actions} />
                </li>
              ) : (
                <li key={rowIndex} className="flex items-baseline gap-2 text-[13px] leading-snug text-white/90">
                  {row.href && /^https:\/\//.test(row.href) ? (
                    <a href={row.href} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate underline decoration-white/30 underline-offset-2 hover:text-white">
                      {row.label}
                    </a>
                  ) : (
                    <span className={`min-w-0 flex-1 ${row.value ? "truncate" : ""}`}>{row.label}</span>
                  )}
                  <span className="font-bold tabular-nums text-white">{row.value}</span>
                  {row.note ? <span className="text-[11px] text-white/70">{row.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {detail.confirm ? <HenryConfirmBlock confirm={detail.confirm} onConfirm={onConfirm} /> : null}
    </section>
  );
}

// Ícone pequeno: algo sutil — arco tracejado girando enquanto busca e, quando achou um corretor, a fotinho no canto.
export function HenryIconSearchHint({ searching = false, broker = null, size = 56 }) {
  if (!searching && !broker) return null;
  return (
    <>
      {searching ? (
        <span aria-hidden="true" className="henry-spin pointer-events-none absolute rounded-full" style={{ border: `2px dashed ${ACCENT}`, opacity: 0.8, left: -5, top: -5, width: size + 10, height: size + 10 }} />
      ) : null}
      {broker ? (
        <span className="pointer-events-none absolute -left-1 -top-1" aria-hidden="true">
          <BrokerAvatar broker={broker} size={22} />
        </span>
      ) : null}
    </>
  );
}
