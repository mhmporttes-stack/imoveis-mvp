// Cérebro realista do Henry "pensando" (dono, 2026-10-25: aprovado no protótipo "Pulso do CRM" → "Cérebro realista").
// Substitui a rede neural antiga do centro do anel. Cérebro humano visto de lado/3-4: contorno lateral real (lobos frontal, parietal,
// temporal, occipital, sulco lateral, sulco central), dois hemisférios com fissura longitudinal, giros e sulcos (campo de ondas de banda
// estreita = curvas de nível "labirinto"), cerebelo com folhas finas, tronco encefálico, corpo caloso e feixes de fibras onde correm os
// impulsos. Nós só nas cristas dos giros. Ondas de "pensamento" acendem regiões (occipital, parietal, motora, pré-frontal, Broca,
// temporal, Wernicke) e uma varredura holográfica sobe e desce.
// Regras do desenho: tudo dentro do anel (clip em 0,935 do raio), traço de 0,6–1,4 px, brilho aditivo ("lighter"), cor pela ALTURA como
// o anel (topo branco → laterais ciano → base azul) com UM gradiente linear (nada de cor por elemento), SEM dourado. A geometria é montada
// UMA vez (PRNG com semente → mesmo desenho a cada abertura; ~938 nós no computador, ~399 no celular < 820 px); por quadro só gira,
// projeta e desenha. Para ficar leve (p95 < 4 ms) os caminhos (linhas e pontos) são montados em revezamento — um grupo por quadro,
// ~20 Hz cada — e guardados em Path2D; todo quadro só os redesenha. Impulsos, varredura, brilhos das regiões e do núcleo são
// recalculados em todo quadro. Sprites de brilho criados uma vez. Movimento reduzido: um quadro parado.
// Coordenadas em px de CSS (o chamador aplica a escala do devicePixelRatio no contexto).

const rng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6D2B79F5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const nClamp = (x) => Math.max(0, Math.min(1, x));
const smoothstep = (a, b, x) => { const k = nClamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const csHash = (n) => { const x = Math.sin(n * 12.9898 + 4.1414) * 43758.5453; return x - Math.floor(x); };
// matriz de rotação Rx(pitch)·Ry(yaw)·Rz(roll)
function csRot(yw, p, r, m) {
  const cyw = Math.cos(yw), syw = Math.sin(yw), cp = Math.cos(p), sp = Math.sin(p), cr = Math.cos(r), sr = Math.sin(r);
  m[0] = cyw * cr; m[1] = -cyw * sr; m[2] = syw;
  m[3] = cp * sr + sp * syw * cr; m[4] = cp * cr - sp * syw * sr; m[5] = -sp * cyw;
  m[6] = sp * sr - cp * syw * cr; m[7] = sp * cr + cp * syw * sr; m[8] = cp * cyw;
  return m;
}

// Sprites de brilho (8 tons ao longo do gradiente do anel), criados uma vez e compartilhados: 64 px (brilho/bokeh grandes) e
// reduzidos (24/32 px) para os nós e as manchas de volume.
const CSP = {};
function sprites() {
  if (CSP.glow) return CSP;
  const stops = [[0, [255, 255, 255]], [0.3, [191, 241, 255]], [0.55, [79, 195, 224]], [1, [30, 155, 255]]];
  const colAt = (t) => { let i = 1; while (i < 3 && t > stops[i][0]) i++; const [t0, a] = stops[i - 1], [t1, b] = stops[i], f = nClamp((t - t0) / (t1 - t0)); return a.map((c, j) => Math.round(c + (b[j] - c) * f)); };
  const glow = [], bokeh = [];
  const mk = (fn) => { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); fn(gr); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return c; };
  for (let i = 0; i < 8; i++) {
    const [r, g, b] = colAt(i / 7);
    const w = (k) => `rgba(${Math.round(r + (255 - r) * k)},${Math.round(g + (255 - g) * k)},${Math.round(b + (255 - b) * k)}`;
    glow.push(mk((gr) => { gr.addColorStop(0, w(0.75) + ",1)"); gr.addColorStop(0.1, w(0.4) + ",0.9)"); gr.addColorStop(0.24, w(0) + ",0.32)"); gr.addColorStop(0.5, w(0) + ",0.07)"); gr.addColorStop(1, w(0) + ",0)"); }));
    bokeh.push(mk((gr) => { gr.addColorStop(0, w(0.2) + ",0.26)"); gr.addColorStop(0.7, w(0) + ",0.3)"); gr.addColorStop(0.92, w(0) + ",0.14)"); gr.addColorStop(1, w(0) + ",0)"); }));
  }
  const small = (c, z) => { const k = document.createElement("canvas"); k.width = k.height = z; k.getContext("2d").drawImage(c, 0, 0, z, z); return k; };
  CSP.glow = glow;
  CSP.bokeh = bokeh;
  CSP.sp = glow.map((c) => small(c, 24));
  CSP.sb = bokeh.map((c) => small(c, 32));
  return CSP;
}

  const BRA = { Ac: 0, Yc: 0.04, gap: 0.012, ZW0: 0.4, YO: -0.055, DEP: 0.02, PER: 12.4 };
  const BR_SIL = [[0.50, 0.02], [0.475, 0.13], [0.41, 0.235], [0.29, 0.31], [0.12, 0.345], [-0.05, 0.35], [-0.22, 0.325], [-0.36, 0.255], [-0.46, 0.15], [-0.51, 0.045], [-0.495, -0.05], [-0.43, -0.12], [-0.31, -0.165], [-0.15, -0.205], [0, -0.215], [0.12, -0.215], [0.21, -0.18], [0.255, -0.12], [0.285, -0.085], [0.34, -0.075], [0.43, -0.055]];
  const BR_ZWT = [0.27, 0.33, 0.39, 0.42, 0.41, 0.35, 0.27, 0.28, 0.36, 0.40, 0.38, 0.31];
  // regiões que "acendem": occipital, parietal, motora, pré-frontal, Broca, temporal, Wernicke (A anterior, Y para cima)
  const BR_REG = [[-0.42, 0.07], [-0.2, 0.25], [0.02, 0.27], [0.36, 0.11], [0.2, 0.02], [-0.02, -0.14], [-0.26, 0.01]];
  const BR_SULC = {
    syl: [[0.25, -0.09], [0.17, -0.05], [0.04, -0.03], [-0.1, 0.0], [-0.23, 0.055], [-0.33, 0.115]],
    cen: [[-0.045, 0.335], [-0.03, 0.27], [-0.005, 0.2], [0.03, 0.13], [0.065, 0.06], [0.085, 0.0]],
    pos: [[-0.335, 0.29], [-0.36, 0.225], [-0.39, 0.165]]
  };
  const BR_MINOR = [
    [[0.2, -0.125], [0.05, -0.105], [-0.12, -0.065], [-0.27, -0.005]],                 // sulco temporal superior
    [[0.0, -0.17], [-0.15, -0.15], [-0.3, -0.1]],                                      // temporal inferior
    [[0.045, 0.325], [0.075, 0.24], [0.115, 0.15], [0.14, 0.095]],                     // pré-central
    [[-0.1, 0.325], [-0.085, 0.23], [-0.055, 0.15], [-0.03, 0.09]],                    // pós-central
    [[0.12, 0.11], [0.24, 0.13], [0.38, 0.15]],                                        // frontal inferior
    [[0.12, 0.25], [0.26, 0.23], [0.4, 0.2]],                                          // frontal superior
    [[-0.3, 0.2], [-0.2, 0.19], [-0.1, 0.12]],                                         // intraparietal
    [[-0.38, 0.08], [-0.42, 0.0], [-0.44, -0.07]]                                      // occipital lateral
  ];
  // feixes: [de, para, pontos (A, Y, fração da profundidade | null, z absoluto)], bilateral
  const BR_TR = [
    [0, 1, [[-0.45, 0.07, 0.82], [-0.4, 0.17, 0.7], [-0.3, 0.24, 0.72], [-0.2, 0.265, 0.8]]],                                   // 0 visual → parietal
    [1, 2, [[-0.2, 0.265, 0.8], [-0.1, 0.3, 0.66], [-0.02, 0.3, 0.7], [0.02, 0.27, 0.82]]],                                      // 1 parietal → motora
    [2, 3, [[0.02, 0.27, 0.82], [0.14, 0.3, 0.66], [0.27, 0.27, 0.68], [0.37, 0.15, 0.8]]],                                      // 2 motora → pré-frontal
    [6, 4, [[-0.26, 0.01, 0.88], [-0.25, 0.12, 0.7], [-0.1, 0.2, 0.55], [0.06, 0.17, 0.58], [0.17, 0.09, 0.7], [0.2, 0.02, 0.88]]], // 3 arqueado (Wernicke → Broca)
    [0, 5, [[-0.45, 0.05, 0.85], [-0.4, -0.07, 0.8], [-0.25, -0.14, 0.82], [-0.1, -0.16, 0.85], [-0.02, -0.14, 0.86]]],           // 4 ventral (visual → temporal)
    [5, 3, [[-0.02, -0.14, 0.86], [0.12, -0.12, 0.55], [0.28, -0.07, 0.5], [0.37, 0.03, 0.7], [0.38, 0.11, 0.82]]],              // 5 uncinado (temporal → pré-frontal)
    [0, 3, [[-0.44, 0.06, 0.8], [-0.28, 0.05, 0.5], [-0.05, 0.04, 0.32], [0.18, 0.07, 0.4], [0.38, 0.1, 0.75]]],                 // 6 occipito-frontal
    [6, 1, [[-0.26, 0.01, 0.88], [-0.28, 0.1, 0.75], [-0.25, 0.19, 0.78], [-0.2, 0.265, 0.8]]],                                  // 7 Wernicke → parietal
    [2, -1, [[0.02, 0.27, 0.82], [0.03, 0.2, 0.3], [0.0, 0.1, 0.1], [-0.02, 0.0, null, 0.02], [-0.04, -0.2, null, 0.0], [-0.07, -0.42, null, 0.0]]], // 8 corticoespinhal → tronco
    [-1, 2, [[-0.33, -0.2, null, 0.14], [-0.14, -0.28, null, 0.05], [-0.06, -0.2, null, 0.02], [0.0, 0.0, null, 0.04], [0.02, 0.15, 0.3], [0.02, 0.27, 0.82]]], // 9 cerebelo → tálamo → motora
    [-1, 3, [[0.0, 0.0, null, 0.04], [0.18, 0.08, 0.3], [0.34, 0.12, 0.78]]],                                                    // 10 tálamo → pré-frontal
    [4, 2, [[0.2, 0.02, 0.88], [0.15, 0.15, 0.6], [0.07, 0.24, 0.7], [0.02, 0.27, 0.82]]],                                       // 11 Broca → motora
    [-1, 1, [[0.0, 0.0, null, 0.04], [-0.15, 0.1, 0.3], [-0.2, 0.265, 0.8]]],                                                    // 12 tálamo → parietal
    [-1, 5, [[0.0, 0.0, null, 0.04], [0.0, -0.08, 0.4], [-0.02, -0.14, 0.86]]]                                                   // 13 tálamo → temporal
  ];
  // calosais (cruzam a linha média): âncora cortical (A, Y), região
  const BR_CC = [[0.3, 0.27, 3], [0.14, 0.305, 3], [-0.06, 0.315, 2], [-0.22, 0.285, 1], [-0.34, 0.2, 0]];
  // "pensamentos": ignição de regiões + impulsos em ondas (tempo em s, período BRA.PER)
  const BR_IGN = [[0, 0, 0.95], [1.05, 1, 0.8], [2.0, 2, 0.85], [3.15, 3, 0.95], [4.6, 6, 0.9], [6.3, 4, 0.85], [7.35, 2, 0.8], [8.6, 0, 0.9], [10.15, 5, 0.85], [11.6, 3, 0.85]];
  const BR_PUL = [[0.15, 0.9, 0], [1.2, 0.8, 1], [2.15, 1.0, 2], [3.3, 1.3, 14], [4.75, 1.5, 3], [6.45, 0.9, 11], [7.5, 1.3, 8], [8.75, 1.4, 4], [10.3, 1.3, 5], [5.5, 1.9, 9], [2.3, 1.5, 12], [9.0, 1.6, 18], [0.4, 1.7, 6]];
  const BRX = {}, BRS = new Float64Array(6), BRO = new Float64Array(6);
  const brCR = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
  function brSpline(pts, per, dims, closed) {
    const out = [], n = pts.length, segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = pts[closed ? (i + n - 1) % n : Math.max(0, i - 1)], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
      for (let k = 0; k < per; k++) { const t = k / per, q = []; for (let d = 0; d < dims; d++) q.push(brCR(p0[d], p1[d], p2[d], p3[d], t)); out.push(q); }
    }
    if (!closed) out.push(pts[n - 1].slice(0, dims));
    return out;
  }
  function brInit() {
    if (BRX.rho) return;
    const rho = new Float32Array(360), sp = brSpline(BR_SIL, 40, 2, true);
    for (const [px, py] of sp) { const x = px - BRA.Ac, y = py - BRA.Yc, b = ((Math.round(Math.atan2(y, x) * 57.29578) % 360) + 360) % 360, r = Math.hypot(x, y); if (r > rho[b]) rho[b] = r; }
    for (let i = 0; i < 360; i++) if (!rho[i]) {
      let a = i, b = i, da = 0, db = 0; while (!rho[a % 360] && da++ < 360) a = (a + 359) % 360; while (!rho[b % 360] && db++ < 360) b = (b + 1) % 360;
      const f = da / Math.max(1, da + db); rho[i] = rho[a] * (1 - f) + rho[b] * f;
    }
    for (let pass = 0; pass < 2; pass++) { const c = Float32Array.from(rho); for (let i = 0; i < 360; i++) rho[i] = (c[(i + 359) % 360] + 2 * c[i] + c[(i + 1) % 360]) / 4; }
    BRX.rho = rho;
    BRX.sulc = {}; for (const k in BR_SULC) BRX.sulc[k] = brSpline(BR_SULC[k], 8, 2, false);
  }
  const brRhoAt = (a) => { let d = (a * 57.29578) % 360; if (d < 0) d += 360; const i = d | 0, f = d - i; return BRX.rho[i] * (1 - f) + BRX.rho[(i + 1) % 360] * f; };
  const brZwAt = (a) => { let d = ((a * 57.29578 / 30) % 12 + 12) % 12; const i = d | 0, f = d - i, u = f * f * (3 - 2 * f); return BR_ZWT[i] * (1 - u) + BR_ZWT[(i + 1) % 12] * u; };
  // ponto da superfície de um hemisfério: al = ângulo no plano sagital, th = 0 (polo lateral) … π/2 (parede medial)
  function brSurf(al, th, o) {
    const rho = brRhoAt(al), s0 = Math.sin(th), c0 = Math.cos(th), s = Math.pow(s0, 0.8), c = Math.pow(Math.max(0, c0), 0.8), zw = BRA.ZW0 + (brZwAt(al) - BRA.ZW0) * s, ca = Math.cos(al), sa = Math.sin(al);
    o[0] = BRA.Ac + rho * s * ca; o[1] = BRA.Yc + rho * s * sa; o[2] = BRA.gap + zw * c;
    const s15 = Math.pow(s0, 1.2), c15 = Math.pow(Math.max(0, c0), 1.2), nA = s15 * ca / rho, nY = s15 * sa / rho, nZ = c15 / zw, l = Math.hypot(nA, nY, nZ) || 1;
    o[3] = nA / l; o[4] = nY / l; o[5] = nZ / l;
  }
  // (A, Y) lateral → (al, th) da superfície; devolve em BRO[0..1]
  function brInv(A, Y) {
    const dA = A - BRA.Ac, dY = Y - BRA.Yc, al = Math.atan2(dY, dA), q = Math.min(0.97, Math.hypot(dA, dY) / brRhoAt(al));
    BRO[0] = al; BRO[1] = Math.asin(Math.pow(q, 1.25));
  }
  function brSurfZ(A, Y) { brInv(A, Y); const al = BRO[0], th = BRO[1], q = Math.pow(Math.sin(th), 0.8); return BRA.gap + (BRA.ZW0 + (brZwAt(al) - BRA.ZW0) * q) * Math.pow(Math.cos(th), 0.8); }
  function brField(seed, K0, N) {
    const r = rng(seed), kx = new Float64Array(N), ky = new Float64Array(N), kz = new Float64Array(N), ph = new Float64Array(N), nrm = 1 / Math.sqrt(N / 2);
    for (let i = 0; i < N; i++) { const u = 2 * r() - 1, a = r() * 6.2832, q = Math.sqrt(1 - u * u), k = K0 * (0.88 + 0.24 * r()); kx[i] = k * q * Math.cos(a); ky[i] = k * u; kz[i] = k * q * Math.sin(a); ph[i] = r() * 6.2832; }
    return (x, y, z) => { let v = 0; for (let i = 0; i < N; i++) v += Math.sin(kx[i] * x + ky[i] * y + kz[i] * z + ph[i]); return v * nrm; };
  }
  function brSegDist(px, py, pl) {
    let best = 1e9;
    for (let i = 0; i < pl.length - 1; i++) {
      const ax = pl[i][0], ay = pl[i][1], dx = pl[i + 1][0] - ax, dy = pl[i + 1][1] - ay, t = nClamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)), ex = ax + dx * t - px, ey = ay + dy * t - py, d = ex * ex + ey * ey;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  function brGroove(A, Y, th) {
    const lat = smoothstep(0.1, 0.42, Math.cos(th)); if (lat <= 0) return 0;
    const S = BRX.sulc, a = Math.exp(-Math.pow(brSegDist(A, Y, S.syl) / 0.02, 2)), b = 0.8 * Math.exp(-Math.pow(brSegDist(A, Y, S.cen) / 0.013, 2)), c = 0.7 * Math.exp(-Math.pow(brSegDist(A, Y, S.pos) / 0.012, 2));
    return lat * Math.max(a, b, c);
  }
  // mode 0: com dobras (campo fld); 1: no fundo do sulco (linhas); 2: sem deslocamento
  function brPoint(al, th, fld, mode, o) {
    brSurf(al, th, o); let h = 0;
    if (mode !== 2) {
      const A = o[0], Y = o[1], f = mode === 1 ? 0 : fld(A, Y, o[2]);
      h = -BRA.DEP * Math.exp(-(f / 0.16) * (f / 0.16)) + 0.007 * smoothstep(0.2, 1, Math.abs(f)) - 0.03 * brGroove(A, Y, th);
    }
    o[0] += o[3] * h; o[1] += o[4] * h; o[2] += o[5] * h;
  }
  const brRegOf = (A, Y) => { let b = 0, bd = 9; for (let r = 0; r < BR_REG.length; r++) { const d = Math.hypot(A - BR_REG[r][0], Y - BR_REG[r][1]); if (d < bd) { bd = d; b = r; } } return [b, 1 - smoothstep(0.07, 0.2, bd)]; };

  function brBuild(small) {
    brInit();
    const rnd = rng(17), NP = small ? 150 : 250, NT = small ? 50 : 80, NH = small ? 165 : 410;
    // buffers de vértices (x = -A para o frontal ficar à esquerda; z = lado)
    const VP = [], VN = [];
    const pushV = (A, Y, Z, nA, nY, nZ) => { VP.push(-A, Y, Z); VN.push(-nA, nY, nZ); return VP.length / 3 - 1; };
    const sets = {}; const mkSet = (k) => (sets[k] = { a: [], b: [], r: [] });
    const lc = mkSet("con"), lb = mkSet("bold"), lm = mkSet("minor"), lr = mkSet("rim"), lf = mkSet("folia"), lk = mkSet("link"), lcc = mkSet("cc");
    const poly = (set, ids, reg) => { for (let i = 0; i < ids.length - 1; i++) { set.a.push(ids[i]); set.b.push(ids[i + 1]); set.r.push(reg === undefined ? 0 : reg); } };
    const nodes = { i: [], reg: [], rw: [], ph: [], sz: [] }, FADE = new Map();
    const addNode = (id, A, Y) => { const [rg, rw] = brRegOf(A, Y); nodes.i.push(id); nodes.reg.push(rg); nodes.rw.push(rw); nodes.ph.push(rnd() * 6.28); nodes.sz.push(0.75 + 0.5 * rnd()); };
    for (const hs of [0, 1]) {
      const fld = brField(hs ? 311 : 173, small ? 56 : 88, 18), side = hs ? -1 : 1, o = new Float64Array(6);
      const F = new Float32Array(NP * (NT + 1));
      for (let j = 0; j <= NT; j++) for (let i = 0; i < NP; i++) { brSurf(i / NP * 6.2832, j / NT * 1.5708, o); F[j * NP + i] = fld(o[0], o[1], o[2]); }
      const vid = new Int32Array(2 * NP * (NT + 1)).fill(-1);
      const fv = (i, j) => F[j * NP + (i % NP)];
      const edge = (e, i, j) => {
        let key, i1, j1, i2, j2;
        if (e === 0) { key = j * NP + (i % NP); i1 = i; j1 = j; i2 = i + 1; j2 = j; }
        else if (e === 1) { key = NP * (NT + 1) + j * NP + ((i + 1) % NP); i1 = i + 1; j1 = j; i2 = i + 1; j2 = j + 1; }
        else if (e === 2) { key = (j + 1) * NP + (i % NP); i1 = i; j1 = j + 1; i2 = i + 1; j2 = j + 1; }
        else { key = NP * (NT + 1) + j * NP + (i % NP); i1 = i; j1 = j; i2 = i; j2 = j + 1; }
        if (vid[key] >= 0) return vid[key];
        const v1 = fv(i1, j1), v2 = fv(i2, j2), t = v1 / (v1 - v2);
        brPoint((i1 + t * (i2 - i1)) / NP * 6.2832, (j1 + t * (j2 - j1)) / NT * 1.5708, fld, 1, o);
        return (vid[key] = pushV(o[0], o[1], side * o[2], o[3], o[4], side * o[5]));
      };
      const TB = [null, [3, 0], [0, 1], [3, 1], [1, 2], null, [0, 2], [3, 2], [2, 3], [0, 2], null, [1, 2], [3, 1], [0, 1], [3, 0]];
      const emit = (e1, e2, i, j) => {
        const a = edge(e1, i, j), b = edge(e2, i, j); if (a === b) return;
        lc.a.push(a); lc.b.push(b);
      };
      for (let j = 0; j < NT; j++) for (let i = 0; i < NP; i++) {
        const va = fv(i, j), vb = fv(i + 1, j), vc = fv(i + 1, j + 1), vd = fv(i, j + 1);
        const idx = (va > 0 ? 1 : 0) | (vb > 0 ? 2 : 0) | (vc > 0 ? 4 : 0) | (vd > 0 ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        if (idx === 5) { if ((va + vb + vc + vd) < 0) { emit(3, 0, i, j); emit(1, 2, i, j); } else { emit(3, 2, i, j); emit(0, 1, i, j); } }
        else if (idx === 10) { if ((va + vb + vc + vd) < 0) { emit(0, 1, i, j); emit(2, 3, i, j); } else { emit(0, 3, i, j); emit(1, 2, i, j); } }
        else emit(TB[idx][0], TB[idx][1], i, j);
      }
      // nós nas cristas dos giros (fora dos sulcos e do sulco lateral)
      const M = Math.round(NH * 3.4), cand = [];
      for (let k = 0; k < M; k++) {
        const th = Math.acos(1 - (k + 0.5) / M * 0.985), al = (k * 2.399963 + hs * 1.7) % 6.2832;
        brPoint(al, th, fld, 0, o); const f = fld(o[0], o[1], o[2]), gr = brGroove(o[0], o[1], th);
        if (Math.abs(f) < 0.16 || gr > 0.3) continue;
        cand.push([Math.abs(f) + 0.35 * rnd(), o[0], o[1], o[2], o[3], o[4], o[5]]);
      }
      cand.sort((p, q) => q[0] - p[0]);
      const first = nodes.i.length;
      for (const c of cand.slice(0, NH)) addNode(pushV(c[1], c[2], side * c[3], c[4], c[5], side * c[6]), c[1], c[2]);
      // ligações curtas entre nós vizinhos (malha fina)
      const ids = nodes.i.slice(first), seen = new Set();
      ids.forEach((a, ai) => {
        const ds = []; for (let bi = 0; bi < ids.length; bi++) if (bi !== ai) { const b = ids[bi]; ds.push([Math.hypot(VP[a * 3] - VP[b * 3], VP[a * 3 + 1] - VP[b * 3 + 1], VP[a * 3 + 2] - VP[b * 3 + 2]), b]); }
        ds.sort((p, q) => p[0] - q[0]);
        for (let k = 0; k < 2; k++) if (ds[k] && ds[k][0] < 0.1) { const b = ds[k][1], key = a < b ? a * 99999 + b : b * 99999 + a; if (!seen.has(key)) { seen.add(key); lk.a.push(a); lk.b.push(b); lk.r.push(0); } }
      });
      // sulcos principais e secundários + contorno (fissura longitudinal)
      const curve = (pts, set, per) => {
        const ids2 = []; for (const [A, Y] of brSpline(pts, per, 2, false)) { brInv(A, Y); brPoint(BRO[0], BRO[1], fld, 1, o); ids2.push(pushV(o[0], o[1], side * o[2], o[3], o[4], side * o[5])); }
        poly(set, ids2);
      };
      for (const k of ["syl", "cen", "pos"]) curve(BR_SULC[k], lb, 7);
      for (const pts of BR_MINOR) curve(pts, lm, 7);
      const rid = []; for (let k = 0; k < 220; k++) { brPoint(k / 220 * 6.2832, 1.5708, fld, 0, o); rid.push(pushV(o[0], o[1], side * o[2], o[3], o[4], side * o[5])); }
      rid.push(rid[0]); poly(lr, rid);
    }
    // cerebelo: elipsoide achatado sob o occipital, folhas horizontais finas; tronco encefálico: anéis
    const CB = [-0.315, -0.18, 0], CS_ = [0.17, 0.088, 0.25], cbN = (x, y, z) => { const a = x / (CS_[0] * CS_[0]), b = y / (CS_[1] * CS_[1]), c = z / (CS_[2] * CS_[2]), l = Math.hypot(a, b, c); return [a / l, b / l, c / l]; };
    const NFOL = small ? 10 : 16;
    for (let k = 0; k < NFOL; k++) {
      const u0 = -0.9 + 1.4 * k / (NFOL - 1), ids = [], seg = 56;
      for (let q = 0; q <= seg; q++) {
        const ph = q / seg * 6.2832, u = Math.max(-0.97, Math.min(0.97, u0 + 0.03 * Math.sin(4 * ph + k * 1.3))), r = Math.sqrt(1 - u * u);
        const dx = CS_[0] * r * Math.cos(ph), dy = CS_[1] * u, dz = CS_[2] * r * Math.sin(ph), n = cbN(dx, dy, dz);
        ids.push(pushV(CB[0] + dx, CB[1] + dy, dz, n[0], n[1], n[2]));
        if (q < seg && !(q % (small ? 8 : 6)) && k % 2 === 1) addNode(ids[ids.length - 1], CB[0] + dx, CB[1] + dy);
      }
      poly(lf, ids);
    }
    // vérmis (linha média) e fissura entre os hemisférios do cerebelo
    { const ids = []; for (let q = 0; q <= 24; q++) { const ph = q / 24 * 6.2832, dx = CS_[0] * Math.cos(ph), dy = CS_[1] * Math.sin(ph) * 0.97, n = cbN(dx, dy, 0); ids.push(pushV(CB[0] + dx, CB[1] + dy, 0, n[0], n[1], n[2])); } poly(lf, ids); }
    // tronco encefálico: coluna afunilada com a ponte (saliência), anéis e fibras longitudinais
    const stemC = (t) => [-0.01 - 0.07 * t, -0.1 - 0.34 * t], stemR = (t) => 0.056 - 0.014 * t + 0.02 * Math.exp(-Math.pow((t - 0.3) / 0.14, 2));
    const NR = small ? 7 : 9, ringIds = [];
    for (let k = 0; k < NR; k++) {
      const t = k / (NR - 1), [ca, cyv] = stemC(t), r = stemR(t), ids = [];
      for (let q = 0; q <= 24; q++) { const ph = q / 24 * 6.2832, dx = r * 0.95 * Math.cos(ph), dz = r * Math.sin(ph), l = Math.hypot(dx, dz); { const vi = pushV(ca + dx, cyv, dz, dx / l, 0, dz / l); ids.push(vi); FADE.set(vi, 1 - 0.95 * smoothstep(0.35, 1, t)); } if (q < 24 && q % 4 === 0 && k % 2 === 1) addNode(ids[ids.length - 1], ca + dx, cyv); }
      poly(lf, ids); ringIds.push(ids);
    }
    for (let q = 0; q < 24; q += 6) poly(lf, ringIds.map((ids) => ids[q]));
    // corpo caloso: arco na linha média (faixa de 3 fios) + nós
    const ycc = (A) => 0.03 + 0.12 * Math.pow(Math.max(0, 1 - (A / 0.33) * (A / 0.33)), 0.6) - (A > 0.26 ? (A - 0.26) * 1.1 : 0);
    for (const off of [-0.014, 0, 0.014]) {
      const ids = []; for (let k = 0; k <= 26; k++) { const A = 0.31 - 0.62 * k / 26; ids.push(pushV(A, ycc(A) + off, 0, 0, 1, 0)); if (!off && k % 2 === 0) addNode(ids[ids.length - 1], A, ycc(A)); }
      poly(lcc, ids);
    }
    // feixes de fibras (impulsos correm por aqui)
    const TP = [], tr = [];
    const frac = (p, side) => [-p[0], p[1], side * (p[2] == null ? p[3] : BRA.gap + p[2] * brSurfZ(p[0], p[1]))];
    BR_TR.forEach(([from, to, pts], bi) => {
      for (const side of [1, -1]) {
        const sp = brSpline(pts.map((p) => frac(p, side)), 9, 3, false), off = TP.length / 3;
        sp.forEach((p) => TP.push(p[0], p[1], p[2]));
        tr.push({ base: bi, side, off, n: sp.length, from, to });
      }
    });
    BR_CC.forEach(([A, Y, reg], k) => {
      const mid = [-A, ycc(A), 0], c1 = frac([A, Y, 0.78], 1), c2 = frac([A, Y, 0.78], -1), m1 = frac([A, (Y + ycc(A)) / 2 + 0.01, 0.4], 1), m2 = frac([A, (Y + ycc(A)) / 2 + 0.01, 0.4], -1);
      const sp = brSpline([c1, m1, mid, m2, c2], 9, 3, false), off = TP.length / 3;
      sp.forEach((p) => TP.push(p[0], p[1], p[2]));
      tr.push({ base: 14 + k, side: 0, off, n: sp.length, from: reg, to: reg });
    });
    // centros das regiões (para o brilho de ignição): 2 lados
    const RC = [];
    BR_REG.forEach(([A, Y]) => { for (const side of [1, -1]) RC.push(-A, Y, side * (BRA.gap + 0.55 * brSurfZ(A, Y))); });
    // empacota
    const nV = VP.length / 3, mk = (n, withN, src, srcN) => ({ n, P: Float32Array.from(src), N: withN ? Float32Array.from(srcN) : null, SX: new Float32Array(n), SY: new Float32Array(n), SD: new Float32Array(n), W: new Float32Array(n) });
    const G = mk(nV, true, VP, VN), T = mk(TP.length / 3, false, TP), RCc = mk(RC.length / 3, false, RC);
    const Fd = new Float32Array(nV).fill(1); FADE.forEach((v, k) => { Fd[k] = v; });
    G.F = Fd;
    const fin = (st) => ({ n: st.a.length, A: Uint32Array.from(st.a), B: Uint32Array.from(st.b), R: Uint8Array.from(st.r) });
    const L = {}; for (const k in sets) L[k] = fin(sets[k]);
    brChain(L.con, VP);
    const regSegs = BR_REG.map((_, r) => { const a = []; for (let e = 0; e < L.con.n; e++) if (L.con.R[e] === r) a.push(e); return Uint32Array.from(a); });
    return { small, G, T, RC: RCc, L, tr, nodes: { i: Uint32Array.from(nodes.i), reg: Uint8Array.from(nodes.reg), rw: Float32Array.from(nodes.rw), ph: Float32Array.from(nodes.ph), sz: Float32Array.from(nodes.sz), n: nodes.i.length }, regSegs, amb: tr.map((_, i) => ({ per: 6.5 + csHash(i + 3) * 4.5, off: csHash(i + 40) * 9 })), thal: mk(1, false, [0, 0.0, 0]) };
  }
  // reordena as arestas em cadeias contíguas (menos moveTo por quadro) e marca a região de cada uma
  function brChain(set, VP) {
    const n = set.n, adj = new Map(), add = (v, e) => { const l = adj.get(v); if (l) l.push(e); else adj.set(v, [e]); };
    for (let e = 0; e < n; e++) { add(set.A[e], e); add(set.B[e], e); }
    const used = new Uint8Array(n), oa = [], ob = [];
    const next = (v) => { const l = adj.get(v); if (l) for (const e of l) if (!used[e]) return e; return -1; };
    for (let e0 = 0; e0 < n; e0++) {
      if (used[e0]) continue;
      // anda para trás até uma ponta (ou volta ao começo, se for laço)
      let a = set.A[e0], e = e0, back = 0;
      for (;;) { const l = adj.get(a); let pe = -1; for (const x of l) if (x !== e && !used[x]) pe = x; if (pe < 0 || back++ > 20000) break; a = set.A[pe] === a ? set.B[pe] : set.A[pe]; e = pe; if (e === e0) break; }
      // percorre a cadeia a partir da ponta
      let v = a, ce = -1; const start = [];
      for (;;) { const l = adj.get(v); ce = -1; if (l) for (const x of l) if (!used[x]) { ce = x; break; } if (ce < 0) break; used[ce] = 1; const w = set.A[ce] === v ? set.B[ce] : set.A[ce]; oa.push(v); ob.push(w); v = w; }
    }
    set.A = Uint32Array.from(oa); set.B = Uint32Array.from(ob); set.n = oa.length;
    set.R = new Uint8Array(set.n);
    for (let e = 0; e < set.n; e++) { const a = set.A[e], b = set.B[e]; set.R[e] = brRegOf(-(VP[a * 3] + VP[b * 3]) / 2, (VP[a * 3 + 1] + VP[b * 3 + 1]) / 2)[0]; }
  }

// Geometria estática (compartilhada): montada uma vez por tamanho (computador / celular).
const BUILT = {};
export function buildHenryBrain(small) {
  const key = small ? "small" : "big";
  return BUILT[key] || (BUILT[key] = brBuild(Boolean(small)));
}

const BR_AL = { con: [0.09, 0.19, 0.33, 0.5], minor: [0.05, 0.12, 0.24, 0.42], bold: [0.1, 0.28, 0.55, 0.9], rim: [0.06, 0.16, 0.3, 0.5], folia: [0.06, 0.14, 0.26, 0.42], link: [0.0, 0.05, 0.1, 0.16], cc: [0.1, 0.2, 0.3, 0.42] };
const BR_MW = { con: 0.15, minor: 0.12, bold: 0.12, rim: 0.1, folia: 0.14, link: 0.3, cc: 0 };

// Desenho de UMA instância (um canvas). size = lado do canvas em px de CSS; radius = raio do anel em px de CSS (fixo: o cache do
// revezamento depende dele); small = versão do celular. draw(s, K, dt): s = tempo em segundos, K = 0..1 (entrada/saída), dt =
// segundos desde o último quadro desenhado (com poucos quadros por segundo o revezamento usa 2 grupos em vez de 3).
// reset() = recomeçar do zero (o cérebro saiu de cena).
export function createHenryBrain({ ctx, size, radius, small = false, reduced = false }) {
  const cx = size / 2, cy = size / 2, R = radius;
  const NU = Math.max(0.5, Math.min(1.15, R / 150)); // escala dos pontos/halos pelo tamanho do anel
  const nw = Math.max(0.8, NU);
  const B = buildHenryBrain(small);
  const spr = sprites();
  const own = (c) => ({ ...c, SX: new Float32Array(c.n), SY: new Float32Array(c.n), SD: new Float32Array(c.n), W: new Float32Array(c.n) });
  const G = own(B.G), T = own(B.T), RC = own(B.RC), thal = own(B.thal);
  const { L, tr, nodes, regSegs } = B;
  const byBase = tr.reduce((o, q) => { (o[q.base] || (o[q.base] = [])).push(q); return o; }, []);
  const m = new Float64Array(9);
  const C = { ready: false, fc: 0 };
  let grad = null;
  const gradient = () => {
    if (grad) return grad;
    grad = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    [[0, "#FFFFFF"], [0.3, "#BFF1FF"], [0.55, "#4FC3E0"], [1, "#1E9BFF"]].forEach(([o, c]) => grad.addColorStop(o, c));
    return grad;
  };
  const csTone = (y) => Math.max(0, Math.min(7, Math.round(((y - cy + R) / (2 * R)) * 7)));
  const csDot = (set, i, x, y, sz, a) => { if (a < 0.01) return; ctx.globalAlpha = a > 1 ? 1 : a; ctx.drawImage(set[i], x - sz / 2, y - sz / 2, sz, sz); };

  function proj(c, sc, Dd) {
    const { n, P, N, SX, SY, SD, W: Wv } = c;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const x = P[j], y = P[j + 1], z = P[j + 2];
      const X = m[0] * x + m[1] * y + m[2] * z, Y = m[3] * x + m[4] * y + m[5] * z, Z = m[6] * x + m[7] * y + m[8] * z, f = Dd / (Dd - Z), sd = nClamp(Z + 0.5);
      SX[i] = cx + sc * X * f; SY[i] = cy - sc * (Y - BRA.YO) * f; SD[i] = sd;
      Wv[i] = N ? (0.09 + 0.91 * smoothstep(-0.3, 0.3, m[6] * N[j] + m[7] * N[j + 1] + m[8] * N[j + 2])) * (0.55 + 0.45 * sd) * (c.F ? c.F[i] : 1) : 0.25 + 0.75 * sd;
    }
  }
  function bands(set, Wv, SX, SY, minW) {
    const ps = [new Path2D(), new Path2D(), new Path2D(), new Path2D()], used = [0, 0, 0, 0], { n, A, B: Bb } = set;
    let pq = -1, pb = -1;
    for (let e = 0; e < n; e++) {
      const a = A[e], b = Bb[e], w = (Wv[a] + Wv[b]) * 0.5; if (w < minW) { pq = -1; continue; }
      const q = w >= 1 ? 3 : (w * 4) | 0, p = ps[q]; if (q !== pq || a !== pb) p.moveTo(SX[a], SY[a]); p.lineTo(SX[b], SY[b]); used[q] = 1; pq = q; pb = b;
    }
    return { ps, used };
  }
  function stroke(bd, g, K, al, lw) {
    if (!bd) return; ctx.strokeStyle = g; ctx.lineWidth = lw;
    for (let q = 0; q < 4; q++) if (bd.used[q]) { ctx.globalAlpha = al[q] * K; ctx.stroke(bd.ps[q]); }
  }

  function draw(s, K, dt = 1 / 60) {
    if (K < 0.01) return;
    const se = reduced ? 3.9 : s, g = gradient();
    const turns = dt > 0.024 ? 2 : 3; // poucos quadros por segundo (tela cheia a 30 fps): 2 grupos, cada um a ~15 Hz
    const ph = !C.ready ? -1 : reduced ? 9 : C.fc++ % turns;
    const rebuildNodes = ph === -1 || (turns === 3 ? ph === 2 : ph === 1);
    const yaw = reduced ? 0.3 : 0.2 + 0.42 * Math.sin(s * 0.21), pitch = reduced ? 0.2 : 0.2 + 0.07 * Math.sin(s * 0.17);
    ctx.save();
    ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.935, 0, Math.PI * 2); ctx.clip();
    csRot(yaw, pitch, 0, m);
    const sc = R * 1.7, Dd = 4.2;
    if (ph === -1 || ph === 0) proj(G, sc, Dd);
    proj(T, sc, Dd); proj(RC, sc, Dd); proj(thal, sc, Dd);
    const { SX, SY, W: Wv, SD } = G;
    // ignição das regiões (ondas): amplitude por região
    const Ia = [0, 0, 0, 0, 0, 0, 0], P = BRA.PER, tm = ((se % P) + P) % P;
    for (const [t0, r, amp] of BR_IGN) { const tau = ((tm - t0) % P + P) % P; if (tau < 4) { const a = amp * Math.min(1, tau / 0.2) * Math.exp(-tau / 0.95); if (a > Ia[r]) Ia[r] = a; } }
    // ---- montagem em revezamento ----
    if (ph === -1 || ph === 0) {
      for (const k of ["minor", "bold", "rim", "folia", "link", "cc"]) C[k] = bands(L[k], Wv, SX, SY, BR_MW[k]);
      const vol = []; for (let k = 0; k < nodes.n; k += 13) { const i = nodes.i[k]; vol.push(SX[i], SY[i], (40 + 14 * SD[i]) * NU, 0.05 * (0.4 + Wv[i]), csTone(SY[i])); } C.vol = vol;
    }
    if (ph === -1 || ph === 1) {
      C.con = bands(L.con, Wv, SX, SY, BR_MW.con);
      C.hot = []; for (let r = 0; r < 7; r++) if (Ia[r] > 0.05) {
        const p = new Path2D(), ar = regSegs[r], { A, B: Bb } = L.con;
        for (let k = 0; k < ar.length; k++) { const e = ar[k], a = A[e], b = Bb[e]; if (Wv[a] + Wv[b] < 0.7) continue; p.moveTo(SX[a], SY[a]); p.lineTo(SX[b], SY[b]); }
        C.hot.push([p, r]);
      }
    }
    if (rebuildNodes) {
      const lv = [new Path2D(), new Path2D(), new Path2D(), new Path2D()], sp = [];
      for (let k = 0; k < nodes.n; k++) {
        const i = nodes.i[k], w = Wv[i]; if (w < 0.13 && (k & 1)) continue;
        const x = SX[i], y = SY[i], rg = nodes.reg[k], bo = Ia[rg] * nodes.rw[k], lit = bo, tw = 0.8 + 0.2 * Math.sin(s * 1.5 + nodes.ph[k]);
        const a = (0.2 + 0.7 * w + 0.7 * lit) * tw, r = (0.5 + 0.65 * w) * nodes.sz[k] * NU * (1 + 0.8 * lit) * (w < 0.34 ? 1.2 : 1), p = lv[a > 0.85 ? 3 : a > 0.6 ? 2 : a > 0.35 ? 1 : 0];
        p.moveTo(x + r, y); p.arc(x, y, r, 0, 6.2832);
        if (w > 0.34 && ((k & 3) === 0 || lit > 0.2)) sp.push(x, y, (7 + 6 * w + 16 * lit) * NU, Math.min(1, 0.3 + 0.35 * w + 0.5 * lit) * tw, csTone(y), 0);
        else if (w < 0.34 && (k % 3) === 0) sp.push(x, y, (9 + 5 * w) * NU, 0.2 * tw, csTone(y), 1);
      }
      C.lv = lv; C.sp = sp;
    }
    C.ready = true;
    // ---- desenho (todo quadro) ----
    csDot(spr.bokeh, 2, thal.SX[0], thal.SY[0], 0.62 * R, (0.3 + 0.06 * Math.sin(s * 0.9)) * K); csDot(spr.bokeh, 1, thal.SX[0], thal.SY[0] - 0.05 * R, 0.3 * R, 0.16 * K);
    ctx.beginPath(); for (let y = cy - 0.9 * R + ((-s * 6) % 5 + 5) % 5; y < cy + 0.9 * R; y += 5) { const w = Math.sqrt(Math.max(0, 0.84 * R * R - (y - cy) * (y - cy))); ctx.moveTo(cx - w, y); ctx.lineTo(cx + w, y); }
    ctx.strokeStyle = g; ctx.lineWidth = 1; ctx.globalAlpha = 0.035 * K; ctx.stroke();
    // feixes de fibras (guias muito tênues)
    ctx.strokeStyle = g; ctx.lineWidth = 0.8;
    for (const q of tr) {
      let sd = 0; for (let k = 0; k < q.n; k += 4) sd += T.SD[q.off + k]; sd /= Math.ceil(q.n / 4);
      ctx.beginPath(); ctx.moveTo(T.SX[q.off], T.SY[q.off]); for (let k = 1; k < q.n; k++) ctx.lineTo(T.SX[q.off + k], T.SY[q.off + k]);
      ctx.globalAlpha = (0.025 + 0.09 * sd * sd) * K; ctx.stroke();
    }
    stroke(C.con, g, K, BR_AL.con, Math.max(0.55, 0.72 * NU));
    for (const [p, r] of C.hot) { ctx.strokeStyle = g; ctx.lineWidth = 1.1 * nw; ctx.globalAlpha = 0.7 * Ia[r] * K; ctx.stroke(p); }
    stroke(C.minor, g, K, BR_AL.minor, 0.9 * nw);
    stroke(C.bold, g, K, BR_AL.bold, 1.4 * nw);
    stroke(C.rim, g, K, BR_AL.rim, 0.9 * nw);
    stroke(C.folia, g, K, BR_AL.folia, 0.7 * nw);
    stroke(C.link, g, K, BR_AL.link, 0.6 * nw);
    stroke(C.cc, g, K, BR_AL.cc, 0.8 * nw);
    // volume: manchas suaves fora de foco
    const vol = C.vol; for (let k = 0; k < vol.length; k += 5) csDot(spr.sb, vol[k + 4], vol[k], vol[k + 1], vol[k + 2], vol[k + 3] * K);
    // regiões acesas: mancha de luz
    for (let r = 0; r < 7; r++) if (Ia[r] > 0.04) for (let sdx = 0; sdx < 2; sdx++) { const i = r * 2 + sdx, ww = 0.15 + 0.85 * RC.W[i] * RC.W[i]; csDot(spr.bokeh, csTone(RC.SY[i]), RC.SX[i], RC.SY[i], 0.55 * R, Ia[r] * K * ww); csDot(spr.sp, csTone(RC.SY[i]), RC.SX[i], RC.SY[i], 0.3 * R, 0.4 * Ia[r] * K * ww); }
    // nós (neurônios de luz): pontos em lote por nível de brilho; brilho (sprite) só em alguns e nos que acendem; atrás = apagado
    ctx.fillStyle = g; for (let q = 0; q < 4; q++) { ctx.globalAlpha = (0.4 + 0.2 * q) * K; ctx.fill(C.lv[q]); }
    const sp = C.sp; for (let k = 0; k < sp.length; k += 6) csDot(sp[k + 5] ? spr.sb : spr.sp, sp[k + 4], sp[k], sp[k + 1], sp[k + 2], sp[k + 3] * K);
    // impulsos pelos feixes
    const pulse = (q, u, a) => {
      const f = u * (q.n - 1), k0 = Math.min(q.n - 2, f | 0), ff = f - k0, i0 = q.off + k0;
      const hx = T.SX[i0] + (T.SX[i0 + 1] - T.SX[i0]) * ff, hy = T.SY[i0] + (T.SY[i0 + 1] - T.SY[i0]) * ff, sd = T.SD[i0], fade = a * (0.3 + 0.7 * sd) * K;
      ctx.beginPath(); ctx.moveTo(hx, hy);
      for (let j = 1; j <= 9; j++) { const uj = u - j * 0.02; if (uj < 0) break; const fj = uj * (q.n - 1), kk = Math.min(q.n - 2, fj | 0), fq = fj - kk, ii = q.off + kk; ctx.lineTo(T.SX[ii] + (T.SX[ii + 1] - T.SX[ii]) * fq, T.SY[ii] + (T.SY[ii + 1] - T.SY[ii]) * fq); }
      ctx.strokeStyle = g; ctx.lineWidth = 1.4 * nw; ctx.globalAlpha = 0.9 * fade; ctx.stroke();
      csDot(spr.glow, csTone(hy), hx, hy, 28 * NU, 0.7 * fade); csDot(spr.glow, 0, hx, hy, 10 * NU, 0.95 * fade);
    };
    const env = (u) => smoothstep(0, 0.12, u) * (1 - smoothstep(0.85, 1, u));
    for (const [t0, dur, bi] of BR_PUL) {
      const tau = ((tm - t0) % P + P) % P; if (tau >= dur) continue; const u = tau / dur, uu = u * u * (3 - 2 * u);
      for (const q of byBase[bi] || []) pulse(q, uu, env(u));
    }
    if (!reduced) tr.forEach((q, i) => { const a = B.amb[i], tau = (s + a.off) % a.per, dur = 1.7; if (tau >= dur) return; const u = tau / dur; pulse(q, u, 0.5 * env(u)); });
    // (dono, 2026-10-30: a linha de varredura que descia sobre o cérebro foi removida — fica só o cérebro)
    ctx.restore();
  }

  return {
    draw,
    reset() { C.ready = false; C.fc = 0; }
  };
}
