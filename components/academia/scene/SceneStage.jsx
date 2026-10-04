"use client";

// ScenePlayer: monta as camadas da cena UMA vez (persiste entre telas = câmera única).
// Carregado com next/dynamic({ ssr: false }) pelo AcademiaApp — nunca importado fora de
// app/academia/**. Tudo aqui é decorativo (aria-hidden): a informação vive em texto no app.
// Camadas (trás -> frente): céu (dia/entardecer/noite) · estrelas · nuvens · skyline longe ·
// skyline meio · chão+torre+guindaste · tinta · luzes das janelas · véus de leitura.
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import styles from "../academia.module.css";
import { HW, LB, WINX, yTop, rng } from "./geometry";

const cx = (...a) => a.filter(Boolean).join(" ");

const Stars = memo(function Stars() {
  const r = rng(21);
  const items = [];
  for (let k = 0; k < 60; k++) items.push(<i key={k} style={{ left: `${(r() * 100).toFixed(1)}vw`, top: `${(r() * 70).toFixed(1)}vh`, opacity: (0.4 + r() * 0.6).toFixed(2) }} />);
  return items;
});

const Clouds = memo(function Clouds() {
  const r = rng(7);
  const g = [];
  for (let k = 0; k < 9; k++) {
    const x = -1500 + r() * 3000, y = -320 - k * 300 - r() * 120, w = 220 + r() * 220;
    g.push(
      <g key={k} opacity={(0.5 + r() * 0.3).toFixed(2)} fill="#fff">
        <ellipse cx={x} cy={y} rx={w / 2} ry={w / 8} />
        <ellipse cx={x - w * 0.18} cy={y - w / 12} rx={w / 4} ry={w / 9} />
      </g>
    );
  }
  return (
    <svg style={{ left: -1500, top: -3400 }} width="3000" height="3400" viewBox="-1500 -3400 3000 3400">{g}</svg>
  );
});

// skyline: silhuetas preenchidas, sem contorno; mais longe = mais claro e azulado
function skyline(seed, x0, x1, h0, h1, w0, w1, fill, pat) {
  const r = rng(seed);
  let x = x0;
  const o = [], p = [];
  let k = 0;
  while (x < x1) {
    const w = w0 + r() * (w1 - w0), h = h0 + r() * (h1 - h0);
    o.push(<rect key={"b" + k} x={x.toFixed(0)} y={(-h).toFixed(0)} width={w.toFixed(0)} height={(h + 1500).toFixed(0)} fill={fill} />);
    if (r() > 0.55) o.push(<rect key={"t" + k} x={(x + w * 0.2).toFixed(0)} y={(-h - 16 - r() * 18).toFixed(0)} width={(w * 0.6).toFixed(0)} height="34" fill={fill} />);
    if (pat) p.push(<rect key={"p" + k} x={(x + 5).toFixed(0)} y={(-h + 10).toFixed(0)} width={(w - 10).toFixed(0)} height={(h - 16).toFixed(0)} fill={`url(#${pat})`} />);
    x += w + 4 + r() * 18;
    k++;
  }
  return [...o, ...p];
}

const SkylineFar = memo(function SkylineFar() {
  return (
    <svg style={{ left: -1800, top: -1000 }} width="3600" height="2500" viewBox="-1800 -1000 3600 2500">
      <defs>
        <linearGradient id="acd-fgd" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E4EDF9" /><stop offset=".6" stopColor="#EDF3FB" /><stop offset="1" stopColor="#F6F9FD" />
        </linearGradient>
      </defs>
      <g>{skyline(3, -1800, 1800, 260, 780, 60, 120, "url(#acd-fgd)")}</g>
    </svg>
  );
});

const SkylineMid = memo(function SkylineMid() {
  return (
    <svg style={{ left: -1600, top: -900 }} width="3200" height="2400" viewBox="-1600 -900 3200 2400">
      <defs>
        <pattern id="acd-wp" width="16" height="22" patternUnits="userSpaceOnUse"><rect x="4" y="6" width="8" height="10" rx="1" fill="#F2F7FD" opacity=".5" /></pattern>
        <linearGradient id="acd-mg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#C6D8EF" /><stop offset=".55" stopColor="#D8E5F4" /><stop offset="1" stopColor="#E9F0FA" />
        </linearGradient>
      </defs>
      {skyline(11, -1600, 1600, 140, 600, 70, 130, "url(#acd-mg)", "acd-wp")}
    </svg>
  );
});

// Torre: térreo, andares ainda não construídos (silhueta pálida) e coroamento (pronto/fantasma)
const TowerSvg = memo(function TowerSvg({ total }) {
  const t = yTop(total - 1);
  const crown = (done) => {
    const g = done ? ["#4B82CB", "#2A5DA3", "#1F4F8F", "#E6EEF9", "#0E3566"] : ["#FFFFFF", "#FFFFFF", "#FFFFFF", "#B4C9E6", "#FFFFFF"];
    return (
      <g className={done ? styles.cd : styles.cg} opacity={done ? 1 : 0.5}>
        <rect x="-108" y={t - 6} width="216" height="6" fill={g[3]} />
        <rect x="-84" y={t - 46} width="168" height="40" fill={g[0]} />
        <polygon points={`84,${t - 46} 102,${t - 53} 102,${t - 12} 84,${t - 6}`} fill={done ? "#17407A" : "#C9D8EE"} />
        <rect x="-84" y={t - 48} width="168" height="3" fill={g[3]} />
        {done && [-66, -24, 18, 60].map((x) => <rect key={x} x={x} y={t - 38} width="30" height="22" rx="2" fill="#0E3566" />)}
        <rect x="-46" y={t - 78} width="92" height="30" fill={g[1]} />
        <rect x="-50" y={t - 80} width="100" height="3" fill={g[3]} />
        {done && [-36, -26, -16, -6, 4, 14, 24, 34].map((x) => <rect key={x} x={x} y={t - 72} width="4" height="18" fill="#0E3566" />)}
        <rect x="52" y={t - 64} width="26" height="18" fill={g[2]} />
        <rect x="-80" y={t - 60} width="22" height="14" rx="2" fill={g[2]} />
        <rect x="-1.5" y={t - 150} width="3" height="72" fill={done ? "#0B2B52" : "#C4D5EC"} />
        <circle data-l={done ? "bc" : undefined} cx="0" cy={t - 154} r="6" fill={done ? "#fff" : "#DCE8F7"} stroke={done ? "#2A5DA3" : "#C4D5EC"} strokeWidth="2" />
      </g>
    );
  };
  const floors = [];
  for (let i = 0; i < total; i++) floors.push(<g key={i} className={styles.fl}><rect x={-HW} y={yTop(i) + 2} width={2 * HW} height="56" fill="#B9CCE6" opacity=".22" /></g>);
  const top = t - 236, h = -top + 20;
  return (
    <svg style={{ left: -140, top }} width="330" height={h} viewBox={`-140 ${top} 330 ${h}`}>
      <defs>
        <linearGradient id="acd-gS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1F4F8F" /><stop offset="1" stopColor="#0B2B52" /></linearGradient>
        <linearGradient id="acd-gL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2A5DA3" /><stop offset="1" stopColor="#17407A" /></linearGradient>
        <radialGradient id="acd-gSh"><stop offset="0" stopColor="#031D3A" stopOpacity=".30" /><stop offset="1" stopColor="#031D3A" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="26" cy="3" rx="170" ry="13" fill="url(#acd-gSh)" />
      <g>
        <polygon points={`${HW},-${LB} ${HW + 22},${-LB - 9} ${HW + 22},-9 ${HW},0`} fill="url(#acd-gS)" />
        <rect x={-HW} y={-LB} width={2 * HW} height={LB} fill="url(#acd-gL)" />
        <rect x={-HW} y="-8" width={2 * HW} height="8" fill="#0B2B52" />
        <rect x="-92" y="-46" width="40" height="34" rx="2" fill="#0E3566" /><rect x="52" y="-46" width="40" height="34" rx="2" fill="#0E3566" />
        <rect x="-30" y="-48" width="60" height="48" fill="#FFEFC0" /><path d="M0 -48V0M-15 -48V0M15 -48V0" stroke="#17407A" strokeWidth="1.5" />
        <rect x="-60" y="-56" width="120" height="7" rx="1.5" fill="#E6EEF9" /><rect x="-60" y="-49" width="120" height="3" fill="#031D3A" opacity=".28" />
        <path d="M-56 -49V-8M56 -49V-8" stroke="#E6EEF9" strokeWidth="2.5" />
      </g>
      {floors}
      <g className={styles.crown} data-l="crown">{crown(false)}{crown(true)}</g>
    </svg>
  );
});

// Andares construídos (HTML, só opacity), próximo andar (contorno) e bandeiras de módulo
const Buildings = memo(function Buildings({ total, mr }) {
  const items = [];
  for (let i = 0; i < total; i++) {
    const w = [], wn = [];
    for (let j = 0; j < 4; j++) {
      const x = (WINX(j) + HW).toFixed(1);
      w.push(<i key={j} className={styles.w} style={{ left: x + "px" }} />);
      wn.push(<i key={j} className={styles.wn} style={{ left: x + "px" }} />);
    }
    const mb = mr.some((r, k) => k < mr.length - 1 && r.b === i);
    const pos = { left: -HW, top: yTop(i) };
    items.push(
      <div key={"n" + i} className={styles.bn} data-bn={i} style={pos}>{wn}</div>,
      <div key={"f" + i} className={cx(styles.bf, mb && styles.mb)} data-bf={i} style={pos}>
        <b className={styles.fa} /><b className={styles.mu} /><b className={styles.sp} /><b className={styles.sd} /><b className={styles.cu} />{w}<b className={styles.sl} />
      </div>
    );
  }
  mr.forEach((r, k) => items.push(
    <div key={"g" + k} className={styles.fgf} data-flag={k} style={{ left: -HW + 4, top: yTop(r.b) - 40 }}><span className={styles.pole} /><span className={styles.pen} /></div>
  ));
  return items;
});

const Lights = memo(function Lights({ total }) {
  const t = yTop(total - 1);
  const items = [];
  for (let i = 0; i < total; i++) {
    const w = [];
    for (let j = 0; j < 4; j++) w.push(<i key={j} style={{ left: (WINX(j) + HW).toFixed(1) + "px" }} />);
    items.push(<div key={i} className={styles.lt} data-lt={i} style={{ left: -HW, top: yTop(i) }}><b />{w}</div>);
  }
  items.push(
    <div key="C" className={styles.lt} data-l="ltC" style={{ left: -HW, top: t - 46, height: 40 }}>
      {[18, 60, 102, 144].map((x) => <i key={x} style={{ left: x, top: 8, width: 30, height: 22 }} />)}
    </div>,
    <div key="B" data-l="beacon" style={{ position: "absolute", left: -90, top: t - 154 - 90, width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,244,207,.95) 0,rgba(255,236,170,.35) 30%,rgba(255,236,170,0) 68%)", opacity: 0 }} />
  );
  return items;
});

// guindaste de treliça: mastro, torre de cabos, lança, contralança com contrapeso, carrinho, cabo e gancho
const Crane = memo(function Crane({ mastH }) {
  const MX = 148;
  return (
    <div data-l="crane">
      <div className={styles.mast} data-l="mast" style={{ left: MX - 7, top: -mastH, height: mastH, width: 14 }} />
      <svg className={styles.jib} data-l="jib" width="280" height="140" viewBox="0 0 280 140" style={{ left: MX - 168, top: -124, overflow: "visible" }}>
        <g stroke="#2A5DA3" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 96H274M20 106H274" />
          <path d="M20 106L36 96L52 106L68 96L84 106L100 96L116 106L132 96L148 106L164 96L180 106L196 96L212 106L228 96L244 106L260 96L274 106" />
          <path d="M161 96V40M175 96V40M161 40L168 20L175 40M161 56H175M161 72H175" />
          <path d="M168 20L28 96M168 20L112 96M168 20L246 96" strokeWidth="1" />
          <path d="M168 20V6" strokeWidth="2" />
        </g>
        <rect x="236" y="106" width="36" height="9" fill="#17407A" /><rect x="238" y="115" width="32" height="9" fill="#1F4F8F" /><rect x="154" y="106" width="30" height="14" rx="2" fill="#0B2B52" />
        <rect x="76" y="106" width="10" height="6" fill="#0B2B52" /><path d="M81 112V132" stroke="#0B2B52" strokeWidth="1.2" /><path d="M81 132v4a3 3 0 1 1 -3 3" stroke="#0B2B52" strokeWidth="1.6" fill="none" /><rect x="76" y="124" width="10" height="7" fill="#2A5DA3" />
      </svg>
    </div>
  );
});

export default function SceneStage({ engine, total, mr, onReady }) {
  const ref = useRef(null);
  const mastH = useMemo(() => Math.max(1500, Math.ceil(-(64 + (total + 3) * 60))), [total]);

  useLayoutEffect(() => {
    const st = ref.current;
    if (!st) return undefined;
    const one = (k) => st.querySelector(`[data-l="${k}"]`);
    const many = (a) => Array.from({ length: total }, (_, i) => st.querySelector(`[data-${a}="${i}"]`));
    engine.setLayers({
      cloud: one("cloud"), far: one("far"), mid: one("mid"), tower: one("tower"), lights: one("lights"),
      dusk: one("dusk"), night: one("night"), stars: one("stars"), tint: one("tint"), tintbg: one("tintbg"),
      vb: one("veilB"), vn: one("veilN"), haze: one("haze"), vl: one("veilL"), vh: one("veilH"),
      mast: one("mast"), jib: one("jib"), crown: one("crown"), ltC: one("ltC"), beacon: one("beacon"), bc: one("bc"),
      bf: many("bf"), bn: many("bn"), lt: many("lt"),
      flag: mr.map((_, k) => st.querySelector(`[data-flag="${k}"]`)), mastH
    });
    const id = requestAnimationFrame(() => onReady?.());
    return () => { cancelAnimationFrame(id); engine.setLayers(null); };
  }, [engine, total, mr, mastH, onReady]);

  return (
    <div ref={ref} className={styles.stage} aria-hidden="true">
      <div className={cx(styles.sky, styles.sDay)} />
      <div className={cx(styles.sky, styles.sDusk)} data-l="dusk" />
      <div className={cx(styles.sky, styles.sNight)} data-l="night" />
      <div className={cx(styles.lyr, styles.stars)} data-l="stars"><Stars /></div>
      <div className={cx(styles.lyr, styles.cloud)} data-l="cloud"><Clouds /></div>
      <div className={cx(styles.lyr, styles.far)} data-l="far"><SkylineFar /></div>
      <div className={cx(styles.lyr, styles.mid)} data-l="mid"><SkylineMid /></div>
      <div className={styles.tintBg} data-l="tintbg" />
      <div className={cx(styles.lyr, styles.tower)} data-l="tower">
        <div className={styles.ground}><div className={styles.gd} /></div>
        <TowerSvg total={total} />
        <div><Buildings total={total} mr={mr} /></div>
        <Crane mastH={mastH} />
      </div>
      <div className={styles.tint} data-l="tint" />
      <div className={cx(styles.lyr, styles.lights)} data-l="lights"><Lights total={total} /></div>
      <div className={styles.veilB} data-l="veilB" />
      <div className={styles.veilN} data-l="veilN" />
      <div className={styles.haze} data-l="haze" />
      <div className={styles.veilH} data-l="veilH" />
      <div className={styles.veilL} data-l="veilL" />
    </div>
  );
}
