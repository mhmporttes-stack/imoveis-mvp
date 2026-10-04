// Motor de cena da Academia: UMA câmera (estado único) seguindo alvos por mola
// criticamente amortecida, um único laço rAF que só roda enquanto algo converge,
// parallax medido por camada, qualidade adaptativa N1-N3 e posicionamento dos
// elementos de interface presos à cena (número, rótulo, pino, rótulos da Evolução,
// plano da Aula). Sem biblioteca, sem rede, só `transform`/`opacity`.
//
// Quem desenha as camadas é `SceneStage.jsx` (carregado com next/dynamic, sem SSR);
// quem fornece os dados e a tela é `AcademiaApp.jsx` via `setCtx()`.
// Rolagem: nativa e passiva (o handler só pede um quadro; o laço lê `scrollTop`).
import { HW, WINX, yTop, flY, clamp, lerp, sstep } from "./geometry";
import { createQuality } from "./quality";

export function createEngine(styles) {
  const cam = { lz: Math.log(0.74), fl: 9.5, tx: 0.5, ay: 0.56, cx: 0, light: 0, dive: 0, hp: 0, pcm: 0, bb: 9, cr: 9, pv: 50, o_pct: 1, o_lbl: 1, o_pin: 1, o_cta: 1, o_nav: 1, tr: 0, vb: 0, cs: 0.3 };
  const vel = {};
  const tgt = { ...cam };
  for (const k in cam) vel[k] = 0;
  // ω (rad/s): assentamento 95% = 4,74/ω
  const OM = { lz: 4.6, fl: 3.2, tx: 5, ay: 5, cx: 6, light: 2.2, dive: 4.6, hp: 12, pcm: 6.5, bb: 4, cr: 2.4, pv: 4.2, o_pct: 8, o_lbl: 8, o_pin: 8, o_cta: 8, o_nav: 8, tr: 7, vb: 4, cs: 6 };
  const EPS = { lz: 0.0008, fl: 0.002, tx: 0.0008, ay: 0.0008, cx: 0.02, light: 0.002, dive: 0.0008, hp: 0.001, pcm: 0.001, bb: 0.002, cr: 0.002, pv: 0.02, o_pct: 0.004, o_lbl: 0.004, o_pin: 0.004, o_cta: 0.004, o_nav: 0.004, tr: 0.002, vb: 0.004, cs: 0.002 };

  // Entradas (preenchidas pelo AcademiaApp a cada render)
  const ctx = {
    view: "home", n: 9, open: 9, cq: 0, total: 18, percent: 50, mr: [], reduced: false,
    cqLbl: "", pinText: "", evHist: () => 0, evWeeks: 7, mods: [], trackTitle: ""
  };
  const E = { sc: {}, evm: [], layers: null };
  const cb = { hint: null, toast: null, layoutTrail: null, onQuality: null };
  const refCache = {};
  const A = { y: [], fl: [] };
  const RNG = { home: 1, evo: 1, railH: 1 };
  const quality = createQuality((n) => {
    const r = E.root;
    if (!r) return;
    r.classList.toggle(styles.q1, n >= 1);
    r.classList.toggle(styles.q2, n >= 2);
    r.classList.toggle(styles.q3, n >= 3);
    r.dataset.q = String(n);
    cb.onQuality?.(n);
  });

  let W = 1, H = 1, wide = false, uu = 1, TOP = 0, LX = 64, OX = 0, CW = 1, PADX = 20;
  let raf = 0, lastT = 0, moving = true, warm = 3, lastNEff = -1, mounted = false;
  let settleId = 0, evStart = 0, evRaf = 0;

  const rmOn = () => ctx.reduced;
  const ss = (e, k, v) => {
    if (!e) return;
    const c = "_" + k;
    if (e[c] !== v) { e[c] = v; e.style[k] = v; }
  };
  const total = () => ctx.total;

  /* ---------- medidas ---------- */
  function metrics() {
    W = window.innerWidth; H = window.innerHeight;
    wide = W >= 820 && W / H > 1.1;
    uu = wide ? Math.min(H / 900, 1.25) : clamp(H / 844, 0.7, 1.25);
    // zona segura superior: só o safe-area do dispositivo (a barra do visualizador era só do protótipo)
    const pr = document.createElement("div");
    pr.style.cssText = "position:fixed;left:0;top:0;width:1px;height:env(safe-area-inset-top,0px);visibility:hidden";
    document.body.appendChild(pr);
    const sa = pr.offsetHeight;
    pr.remove();
    TOP = Math.max(sa, 0);
    // caixa útil: em telas muito largas a composição fica centrada em 1440 px (a cena continua panorâmica)
    CW = wide ? Math.min(W, 1440) : W;
    OX = (W - CW) / 2;
    PADX = wide ? OX + Math.min(W * 0.08, 115.2) : 20;
    LX = wide ? PADX + 34 : 66;
    if (E.root) E.root.style.setProperty("--ac-vh", H + "px");
  }
  function ranges() {
    const h = E.sc.home, e = E.sc.evo;
    if (h) RNG.home = Math.max(1, h.scrollHeight - h.clientHeight);
    if (e) RNG.evo = Math.max(1, e.scrollHeight - e.clientHeight);
    RNG.railH = (E.rail && E.rail.clientHeight) || 1;
  }
  const evT = () => (E.sc.evo ? clamp(E.sc.evo.scrollTop / RNG.evo, 0, 1) : 0);
  const homeP = () => (E.sc.home ? clamp(E.sc.home.scrollTop / RNG.home, 0, 1) : 0);
  function trilhaFl0() {
    const s = E.sc.trilha;
    const Y = A.y, F = A.fl;
    if (!s || !Y.length) return ctx.n + 0.5;
    const y = s.scrollTop + H * 0.44;
    if (y <= Y[0]) return F[0];
    for (let i = 1; i < Y.length; i++) if (y <= Y[i]) return lerp(F[i - 1], F[i], (y - Y[i - 1]) / (Y[i] - Y[i - 1]));
    return F[F.length - 1];
  }
  function trilhaFl() {
    const f = trilhaFl0(), c = Math.min(ctx.n, total() - 1) + 0.5;
    return wide ? c + (f - c) * 0.6 : f;
  }

  /* ---------- alvos por tela ---------- */
  function targets() {
    const v = ctx.view, t = tgt, T = total();
    const z = (k) => Math.log(k * (wide ? 1.35 : 1));
    const curFl = Math.min(ctx.n, T - 1) + 0.5;
    t.bb = ctx.n; t.cx = 0; t.light = 0; t.dive = 0; t.hp = 0; t.pcm = 0; t.tr = 0; t.vb = 0; t.cs = wide ? 0.27 : 0.3;
    t.o_pct = 1; t.o_lbl = 1; t.o_pin = 0; t.o_cta = 0; t.o_nav = 1; t.pv = ctx.percent;
    OM.fl = 3.2; OM.bb = 4; OM.lz = 4.6; OM.pv = 4.2;
    if (v === "home") {
      const p = homeP(), e = sstep(0, 1, p);
      t.hp = p;
      t.fl = curFl + 0.9 * e;
      t.lz = z(lerp(wide ? 1.12 : 0.88, wide ? 1.5 : 1.1, e));
      t.tx = lerp(wide ? 0.7 : 0.72, 0.7, e);
      t.ay = lerp(wide ? 0.56 : 0.6, 0.52, e);
      t.pcm = p; t.o_pin = 1; t.o_cta = 1; OM.fl = 5;
    } else if (v === "trilha") {
      t.fl = trilhaFl(); t.lz = z(wide ? 1.15 : W < 400 ? 0.66 : 0.78); t.tx = wide ? 0.74 : W < 400 ? 0.94 : 0.9; t.ay = 0.5; t.pcm = 1; t.tr = 1; t.o_pin = 0; OM.fl = 8.5; OM.lz = 4;
    } else if (v === "evo") {
      const wk = evT() * ctx.evWeeks, b = ctx.evHist(wk);
      t.bb = b; t.pv = (b / T) * 100;
      const q0 = sstep(0.12, 1, b / Math.max(ctx.n, 1)), q = q0 * q0;
      t.fl = lerp(Math.max(2.4, b + 0.8), T / 2 + 0.6, q);
      t.lz = z(lerp(wide ? 1.1 : 1.05, 0.52, q));
      t.tx = wide ? 0.68 : 0.76; t.ay = lerp(0.52, 0.55, q); t.pcm = 1; t.cs = 0.4;
      OM.fl = 6; OM.bb = 7; OM.pv = 7; OM.lz = 5;
    } else if (v === "aula" || v === "quiz") {
      t.fl = ctx.open + 0.5; t.cx = WINX(1) + 17; t.lz = z(4.2); t.tx = 0.5; t.ay = 0.5; t.dive = 1; t.o_pct = 0; t.o_lbl = 0; t.o_nav = 0; t.bb = ctx.n; OM.lz = 4.2;
    } else if (v === "conq") {
      const ph = ctx.cq;
      t.o_lbl = ph >= 1 ? 1 : 0; t.o_nav = 0; t.pcm = 0; t.vb = 1; t.light = 0.95; t.tx = wide ? 0.72 : 0.7; t.ay = wide ? 0.55 : 0.3;
      t.fl = ph < 1 ? ctx.open + 0.5 : ph < 2 ? ctx.n + 0.3 : ctx.n + 1.4;
      t.lz = z(ph < 1 ? 1.2 : ph < 2 ? (wide ? 1.1 : 0.86) : (wide ? 0.95 : 0.7));
      OM.fl = ph >= 2 ? 2.2 : 3; OM.lz = 3.4; OM.light = 1.6;
    } else if (v === "cert") {
      t.fl = T + 1; t.lz = z(wide ? 1 : 0.8); t.tx = wide ? 0.72 : 0.68; t.ay = wide ? 0.5 : 0.3; t.vb = 1; t.light = 2; t.pcm = 0; t.o_lbl = 0; t.o_nav = 0; t.pv = 100; t.bb = T;
      OM.fl = 1.3; OM.lz = 2.2; OM.light = 1.1; OM.bb = 1.6;
    }
    t.cr = t.bb;
  }

  function step(dt) {
    let settled = true;
    const reduced = rmOn();
    for (const k in cam) {
      const w = OM[k], d = cam[k] - tgt[k];
      if (reduced) { cam[k] = tgt[k]; vel[k] = 0; continue; }
      const e = Math.exp(-w * dt), tt = (vel[k] + w * d) * dt;
      cam[k] = tgt[k] + (d + tt) * e;
      vel[k] = (vel[k] - w * tt) * e;
      if (Math.abs(cam[k] - tgt[k]) > EPS[k] || Math.abs(vel[k]) > EPS[k] * 6) settled = false;
      else { cam[k] = tgt[k]; vel[k] = 0; }
    }
    return settled;
  }

  const project = (wx, wy) => {
    const z = Math.exp(cam.lz), S0 = uu * z, cy = flY(cam.fl);
    return [OX + cam.tx * CW - cam.cx * S0 + wx * S0, cam.ay * H - cy * S0 + wy * S0, S0];
  };

  /* ---------- aplicação ---------- */
  function applyStates() {
    const L = E.layers;
    if (!L) return;
    const T = total();
    const n = Math.floor(cam.bb + 0.02);
    const fb = Math.floor(cam.bb + 1e-4), fr = cam.bb - fb;
    if (n !== lastNEff) {
      lastNEff = n;
      for (let i = 0; i < T; i++) {
        L.bf[i]?.classList.toggle(styles.on, i <= n);
        L.bf[i]?.classList.toggle(styles.cur, i === n);
        L.bn[i]?.classList.toggle(styles.on, i === n + 1);
        L.lt[i]?.classList.toggle(styles.cur, i === n);
      }
      L.crown?.classList.toggle(styles.stDone, n >= T);
      ctx.mr.forEach((m, k) => L.flag[k]?.classList.toggle(styles.on, n > m.b));
    }
    for (let i = 0; i < T; i++) {
      const o = i < fb ? 1 : i === fb ? 0.82 + 0.18 * fr : 0;
      const l = L.lt[i];
      if (!l) continue;
      const s = o.toFixed(3);
      if (l._o !== s) { l._o = s; l.style.opacity = s; }
    }
    ss(L.ltC, "opacity", clamp(cam.bb - (T - 1), 0, 1).toFixed(3));
    ss(L.beacon, "opacity", clamp(cam.bb - (T - 0.5), 0, 1).toFixed(3));
    L.bc?.setAttribute("fill", cam.bb >= T ? "#FFF4CF" : "#fff");
  }

  function apply() {
    const L = E.layers;
    const z = Math.exp(cam.lz), cy = flY(cam.fl), T = total();
    if (L) {
      const LY = { cloud: [L.cloud, 0.22, 0], far: [L.far, 0.35, 0.4], mid: [L.mid, 0.55, 0.7], tower: [L.tower, 1, 1], lights: [L.lights, 1, 1] };
      for (const k in LY) {
        const [el, p, kk] = LY[k];
        if (!el) continue;
        const S0 = uu * (1 + (z - 1) * kk);
        el.style.transform = `translate3d(${(OX + cam.tx * CW - cam.cx * p * S0).toFixed(2)}px,${(cam.ay * H - cy * p * S0).toFixed(2)}px,0) scale(${S0.toFixed(4)})`;
      }
      // luz do dia (só opacity); nas 3 primeiras passagens força a rasterização das camadas
      const wm = warm > 0 ? (warm--, 0.004) : 0;
      const dusk = Math.max(wm, clamp(cam.light, 0, 1)), night = Math.max(wm, clamp(cam.light - 1, 0, 1));
      ss(L.dusk, "opacity", dusk.toFixed(3)); ss(L.night, "opacity", night.toFixed(3)); ss(L.stars, "opacity", night.toFixed(3));
      ss(L.tint, "opacity", (dusk * 0.1 + night * 0.3).toFixed(3));
      ss(L.tintbg, "opacity", Math.min(1, dusk * 0.42 + night * 0.3).toFixed(3));
      ss(L.vb, "opacity", Math.max(wm, clamp(cam.vb, 0, 1)).toFixed(3));
      ss(L.vn, "opacity", clamp(cam.vb, 0, 1).toFixed(3));
      ss(L.haze, "opacity", (1 - dusk).toFixed(3));
      ss(L.vl, "opacity", cam.tr.toFixed(3));
      ss(L.vh, "opacity", (clamp(cam.o_cta, 0, 1) * (1 - 0.35 * cam.hp)).toFixed(3));
      // guindaste: a altura segue a obra
      const crTop = flY(cam.cr + 2.6);
      ss(L.mast, "transform", `scaleY(${clamp(-crTop / (L.mastH || 1500), 0, 1).toFixed(4)})`);
      ss(L.jib, "transform", `translateY(${crTop.toFixed(1)}px)`);
      applyStates();
    }
    E.root?.classList.toggle(styles.night, cam.light > 0.5);
    ss(E.vt, "opacity", clamp(cam.pcm, 0, 1) * (ctx.view === "conq" || ctx.view === "cert" ? 0 : 1) * clamp(1 - cam.dive * 3, 0, 1) + "");

    // número e rótulo (conteúdo vem do app; aqui só posição, escala e contagem)
    const pm = cam.pcm, padx = PADX;
    const bx = padx, by = wide ? Math.max(H * 0.22, TOP + 80) : TOP + 80, cs = cam.cs;
    const cxp = padx, cyp = TOP + (wide ? 64 : 62);
    const big = (wide ? clamp(H / 900, 0.85, 1.25) : H < 700 ? 0.82 : 1) * (ctx.view === "cert" && !wide ? 0.8 : 1);
    const px = lerp(bx, cxp, pm), py = lerp(by, cyp, pm), ps = lerp(big, cs, pm);
    const pc = E.pct;
    if (pc) {
      ss(pc, "transform", `translate3d(${px.toFixed(1)}px,${py.toFixed(1)}px,0) scale(${ps.toFixed(4)})`);
      ss(pc, "opacity", clamp(cam.o_pct, 0, 1).toFixed(3));
      const nm = Math.round(cam.pv);
      if (pc._v !== nm) { pc._v = nm; if (E.pctNum) E.pctNum.textContent = nm; pc._w = pc.offsetWidth || 200; }
      const lb = E.lbl;
      if (lb) {
        const bigH = (wide ? 210 : 128) * 0.82 * big;
        const lx = lerp(bx, cxp + (pc._w || 200) * cs + 12, pm);
        const ly = lerp(by + bigH + (wide ? 30 : 26), cyp + (wide ? 8 : Math.max(4, pc._w ? (128 * 0.82 * cs) / 2 - 9 : 4)), pm);
        ss(lb, "transform", `translate3d(${lx.toFixed(1)}px,${ly.toFixed(1)}px,0)`);
        ss(lb, "opacity", (clamp(cam.o_lbl, 0, 1) * (pm <= 0.05 || pm >= 0.95 ? 1 : clamp(Math.abs(pm - 0.5) * 2.6, 0, 1))).toFixed(3));
        lb.classList.toggle(styles.cm, pm > 0.5);
        const txt = ctx.view === "conq" ? ctx.cqLbl : ctx.view === "evo" ? `Semana ${Math.max(1, Math.ceil(evT() * ctx.evWeeks))} · ${Math.round(cam.bb)} de ${T} aulas` : `${ctx.n} de ${T} aulas`;
        if (lb._m !== txt) {
          lb._m = txt;
          if (E.lblA) E.lblA.style.display = ctx.view === "conq" ? "none" : "";
          if (E.lblN) E.lblN.textContent = txt;
        }
      }
    }
    // pino ancorado ao andar atual
    const pw = E.pin;
    if (pw) {
      const fi = Math.floor(clamp(cam.bb + 0.02, 0, T - 1));
      const [sx, sy] = project(-HW - 12, yTop(fi) + 30);
      ss(pw, "transform", `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`);
      const pinW = pw.firstElementChild;
      if (pinW) {
        ss(pinW, "transform", "translate(0,-50%)");
        const mw = Math.max(110, Math.min(wide ? 260 : 190, sx - 20));
        if (pinW._mw !== Math.round(mw)) { pinW._mw = Math.round(mw); pinW.style.maxWidth = Math.round(mw) + "px"; }
      }
      ss(pw, "opacity", clamp(cam.o_pin, 0, 1).toFixed(3));
      const pd = E.pinD;
      if (pd) {
        if (cam.hp > 0.03) ctx._g = true;
        const pt = ctx._g ? ctx.pinText : "Role para subir";
        if (pd._t !== pt) { pd._t = pt; pd.textContent = pt; }
        if (ctx._g) { ss(pd, "maxHeight", (cam.hp * 54).toFixed(0) + "px"); ss(pd, "opacity", clamp((cam.hp - 0.35) / 0.5, 0, 1).toFixed(3)); }
        else { ss(pd, "maxHeight", "44px"); ss(pd, "opacity", "1"); }
      }
    }
    ss(E.cta, "opacity", clamp(cam.o_cta, 0, 1).toFixed(3));
    ss(E.nav, "opacity", clamp(cam.o_nav, 0, 1).toFixed(3));

    // Evolução: rótulos presos à cena
    if (E.evnow || E.evm.length) {
      const nE = Math.floor(cam.bb + 0.02);
      ctx.mods.forEach((m, k) => {
        const e = E.evm[k];
        if (!e) return;
        const y0 = project(0, yTop(Math.round((m.a + m.b) / 2)) + 30);
        ss(e, "transform", `translate3d(${LX.toFixed(1)}px,${y0[1].toFixed(1)}px,0)`);
        const comp = nE > m.b, prog = !comp && nE > m.a;
        const st = ctx.view !== "evo" ? 0 : comp ? 1 : prog ? 2 : 0;
        const low = y0[1] < H - 120;
        if (e._st !== st || e._lw !== low) {
          e._lw = low; e._st = st;
          e.classList.toggle(styles.on, st > 0 && low);
          if (st) { const sp = e.querySelector("span"); if (sp) sp.textContent = st === 2 ? "em andamento" : (m.weekText || "concluído"); }
        }
      });
      if (E.evnow) ss(E.evnow, "transform", `translate3d(${LX.toFixed(1)}px,${project(0, yTop(clamp(nE, 0, T - 1)) + 30)[1].toFixed(1)}px,0)`);
      if (E.evcert) {
        const cy2 = Math.max(project(0, yTop(T - 1) - 70)[1], TOP + (wide ? 172 : 132));
        ss(E.evcert, "transform", `translate3d(${LX.toFixed(1)}px,${cy2.toFixed(1)}px,0)`);
      }
      const t = evT();
      ss(E.railF, "transform", `scaleY(${t.toFixed(4)})`);
      ss(E.railM, "transform", `translateY(${(t * RNG.railH).toFixed(1)}px)`);
    }

    // plano (aula/questão): abre a partir da janela da cena
    const pl = E.plane, d = cam.dive;
    if (pl) {
      if (d > 0.003) {
        pl.style.visibility = "visible";
        const S1 = uu * z, [wx0, wy0] = project(WINX(1), yTop(ctx.open) + 16);
        const w = 34 * S1, h = 28 * S1, k = sstep(0.4, 0.95, d);
        const it = lerp(Math.max(0, wy0), 0, k), il = lerp(Math.max(0, wx0), 0, k), ir = lerp(Math.max(0, W - (wx0 + w)), 0, k), ib = lerp(Math.max(0, H - (wy0 + h)), 0, k);
        pl.style.webkitClipPath = pl.style.clipPath = k >= 0.999 ? "none" : `inset(${it.toFixed(1)}px ${ir.toFixed(1)}px ${ib.toFixed(1)}px ${il.toFixed(1)}px round ${lerp(8, 0, k).toFixed(1)}px)`;
        ss(E.pc, "opacity", sstep(0.6, 0.95, d).toFixed(3));
      } else pl.style.visibility = "hidden";
    }
    ss(E.brand, "opacity", clamp(1 - d * 2.2, 0, 1));
  }

  /* ---------- laço ---------- */
  function tick(t) {
    raf = 0;
    const rawDt = t - lastT;
    quality.sample(rawDt, t, rmOn());
    const dt = Math.min(rawDt / 1000, 1 / 20);
    lastT = t;
    targets();
    const done = step(dt);
    apply();
    if (!done || moving) raf = requestAnimationFrame(tick);
  }
  function kick() {
    if (!mounted || raf) return;
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function settleSoon() {
    moving = true;
    clearTimeout(settleId);
    settleId = setTimeout(() => { moving = false; kick(); }, 180);
    kick();
  }
  const onVis = () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else { lastT = performance.now(); quality.reset(); kick(); }
  };
  const onResize = () => {
    metrics(); ranges();
    cb.layoutTrail?.();
    settleSoon();
  };
  const scrollHandlers = {};

  /* ---------- API ---------- */
  const api = {
    cam, tgt, ctx, quality, cb,
    get nEff() { return lastNEff; },
    get TOP() { return TOP; },
    metricsInfo: () => ({ W, H, uu, wide }),
    // refs de elementos de interface (callback ref estável por nome)
    ref(name) {
      return (refCache["r_" + name] ||= (el) => { E[name] = el || null; if (name === "root") api.root = el; });
    },
    refSc(name) {
      const key = "sc_" + name;
      return (refCache[key] ||= (el) => { E.sc[name] = el || null; });
    },
    refAt(name, i) {
      const key = name + i;
      return (refCache[key] ||= (el) => { E[name][i] = el || null; });
    },
    setLayers(layers) {
      E.layers = layers;
      lastNEff = -1; warm = 3;
      if (mounted) { targets(); apply(); kick(); }
    },
    setAnchors(y, fl) { A.y = y; A.fl = fl; settleSoon(); },
    setCtx(patch) {
      Object.assign(ctx, patch);
      if (mounted) { ranges(); kick(); }
    },
    snap() {
      targets();
      for (const k in cam) { cam[k] = tgt[k]; vel[k] = 0; }
      lastNEff = -1;
      apply();
    },
    mount() {
      if (mounted) return;
      mounted = true;
      metrics();
      ranges();
      targets();
      for (const k in cam) cam[k] = tgt[k];
      if (wide && W * H >= 1e6) quality.setBase(2);
      window.addEventListener("resize", onResize);
      document.addEventListener("visibilitychange", onVis);
      ["home", "trilha", "evo"].forEach((k) => {
        const el = E.sc[k];
        if (!el) return;
        scrollHandlers[k] = () => { if (ctx.view === k) settleSoon(); };
        el.addEventListener("scroll", scrollHandlers[k], { passive: true });
      });
      apply();
      settleSoon();
    },
    unmount() {
      mounted = false;
      cancelAnimationFrame(raf); raf = 0;
      clearTimeout(settleId); clearTimeout(evStart); cancelAnimationFrame(evRaf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      ["home", "trilha", "evo"].forEach((k) => { E.sc[k]?.removeEventListener("scroll", scrollHandlers[k]); });
    },
    kick, settleSoon,
    // Troca de tela: efeitos de rolagem e viagem no tempo da Evolução
    onViewChange(v, prev, opts = {}) {
      clearTimeout(evStart); cancelAnimationFrame(evRaf);
      if (v === "trilha" && prev !== "trilha") api.scrollTrailToCurrent();
      if (v === "evo" && prev !== "evo") {
        const s = E.sc.evo;
        if (s) {
          ranges();
          const range = s.scrollHeight - s.clientHeight;
          if (rmOn()) s.scrollTop = range;
          else { s.scrollTop = 0; evStart = setTimeout(playEvo, 520); }
          if (rmOn()) evStart = setTimeout(() => cb.hint?.(), 400);
        }
      }
      if (v === "home" && prev !== "home" && !opts.keepHome && E.sc.home) E.sc.home.scrollTop = 0;
      ranges();
      settleSoon();
    },
    scrollTrailToCurrent() {
      const s = E.sc.trilha;
      if (!s) return;
      const cur = s.querySelector("[data-cur='1']");
      if (!cur) { s.scrollTop = 0; return; }
      const tr = cur.closest("[data-trail]") || s.firstElementChild;
      const b = cur.getBoundingClientRect(), tb = tr.getBoundingClientRect();
      s.scrollTop = b.top - tb.top + b.height / 2 - H * 0.42;
    },
    // Conquista: o módulo pisca (andares em sequência, 110 ms entre eles)
    flashModule(a, b) {
      const L = E.layers;
      if (!L || rmOn()) return;
      for (let i = a; i <= b; i++) {
        const l = L.lt[i];
        if (!l) continue;
        l.classList.remove(styles.flash);
        void l.offsetWidth;
        l.style.setProperty("animation-delay", (i - a) * 110 + "ms");
        l.classList.add(styles.flash);
      }
    }
  };

  /* reprodução inicial da Evolução: percorre o tempo sozinha; qualquer toque a interrompe */
  function playEvo() {
    const s = E.sc.evo;
    if (!s) return;
    const range = s.scrollHeight - s.clientHeight;
    const t0 = performance.now(), dur = 4200;
    let stop = false;
    const evs = ["wheel", "touchstart", "keydown", "pointerdown"];
    const halt = () => { stop = true; evs.forEach((e) => s.removeEventListener(e, halt)); };
    evs.forEach((e) => s.addEventListener(e, halt, { passive: true }));
    (function f(now) {
      if (stop || ctx.view !== "evo") { halt(); return; }
      const k = clamp((now - t0) / dur, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      s.scrollTop = range * e;
      if (k < 1) evRaf = requestAnimationFrame(f);
      else { halt(); cb.hint?.(); }
    })(t0);
  }

  return api;
}
