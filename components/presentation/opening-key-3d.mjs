// Cena 3D da ABERTURA da apresentação (aprovada pelo dono em 2026-10-22, protótipo "Apresentação da simulação", abertura "3D").
// Pedaços de ouro irregulares (pepitas e lascas facetadas) flutuam devagar, aceleram em redemoinho e se unem formando uma chave
// de ouro maciça; na argola, o "M" OFICIAL extrudado em dourado (traçado de public/assets/matheus-machado-symbol.png — nunca a
// logo antiga). Depois acende um reflexo dourado em estrela no canto superior da argola, a chave balança de leve e a câmera
// mergulha devagar. Lógica e parâmetros copiados do protótipo (`start3D`).
// Só é carregado no navegador, por import dinâmico (components/presentation/OpeningKey3D.jsx): a three.js não pesa o resto da
// página. Decorativo: o texto da cena é que informa. Devolve `stop()`, que para o loop e libera tudo (dispose).
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DodecahedronGeometry,
  DoubleSide,
  DynamicDrawUsage,
  ExtrudeGeometry,
  FogExp2,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  SRGBColorSpace,
  Scene,
  Shape,
  SpotLight,
  Sprite,
  SpriteMaterial,
  TetrahedronGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";

// "M" oficial (polígonos traçados do símbolo atual, espaço 0..1000 × 0..785 da imagem)
const M_MAIN = [[76, 0], [537, 380], [1000, 0], [1000, 785], [842, 785], [842, 318], [502, 597], [76, 177]];
const M_LEG = [[0, 138], [486, 607], [388, 694], [142, 451], [142, 785], [0, 785]];
const SHARDS = 950;

export function startKeyScene(canvas, { clockOffset = 0 } = {}) {
  const W = canvas.clientWidth || 390;
  const H = canvas.clientHeight || 500;
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, H, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  scene.fog = new FogExp2(0x030b16, 0.055);
  const camera = new PerspectiveCamera(32, W / H, 0.1, 120);

  // Estúdio para reflexos: painéis de luz (branco em cima, ciano e âmbar nas laterais)
  const pm = new PMREMGenerator(renderer);
  const envScene = new Scene();
  envScene.background = new Color(0x01060d);
  const panel = (w, h, color, k, x, y, z) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(k), side: DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };
  panel(8, 1.4, 0xffffff, 4, 0, 6, 1); panel(1.4, 7, 0x4fc3e0, 4, -6, 1, 1); panel(1.4, 7, 0xffc27a, 4, 6, 1, -1); panel(10, 1, 0x1e9bff, 2, 0, -2, -6); panel(3, 3, 0xffcf8a, 1.6, 2, 2, 6);
  const env = pm.fromScene(envScene, 0.035).texture;
  scene.environment = env;

  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const sprite = (color, sx, sy, op) => {
    const s = new Sprite(new SpriteMaterial({ map: glowTex, color, transparent: true, opacity: op, blending: AdditiveBlending, depthWrite: false, fog: false }));
    s.scale.set(sx, sy, 1);
    return s;
  };

  // Chave de ouro polido (a chave do imóvel): argola, colar, haste torneada e dentes
  const hero = new Group(); scene.add(hero);
  const keyG = new Group(); hero.add(keyG);
  const gold = new MeshPhysicalMaterial({ color: 0xe0ac52, metalness: 1, roughness: 0.16, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 1.7, side: DoubleSide });
  const bow = new Mesh(new TorusGeometry(0.6, 0.15, 48, 160), gold); bow.position.y = 1.18; keyG.add(bow);
  // "M" oficial em ouro maciço dentro da argola
  const mShape = (pts) => {
    const sh = new Shape();
    pts.forEach(([x, y], k) => { const X = ((x - 500) / 1000) * 0.74; const Y = (-(y - 392) / 1000) * 0.74; if (k) sh.lineTo(X, Y); else sh.moveTo(X, Y); });
    sh.closePath();
    return sh;
  };
  const mOpts = { depth: 0.16, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.014, bevelSegments: 4, curveSegments: 1 };
  const goldM = new MeshPhysicalMaterial({ color: 0xc8891f, metalness: 0.92, roughness: 0.38, envMapIntensity: 0.75, emissive: 0x4a2c00, emissiveIntensity: 0.6 });
  const goldPale = new MeshPhysicalMaterial({ color: 0xe8b85c, metalness: 1, roughness: 0.3, envMapIntensity: 1.2, emissive: 0x4a3000, emissiveIntensity: 0.35 });
  const mMain = new Mesh(new ExtrudeGeometry(mShape(M_MAIN), mOpts), goldM);
  const mLeg = new Mesh(new ExtrudeGeometry(mShape(M_LEG), mOpts), goldPale);
  [mMain, mLeg].forEach((m) => { m.position.set(0, 1.18, -0.08 - 0.025); keyG.add(m); });
  const prof = [[0, 0.45], [0.22, 0.45], [0.22, 0.4], [0.15, 0.36], [0.15, 0.28], [0.19, 0.24], [0.19, 0.16], [0.12, 0.12], [0.115, -1.55], [0.14, -1.6], [0, -1.63]].reverse().map(([x, y]) => new Vector2(x, y));
  const shaft = new Mesh(new LatheGeometry(prof, 64), gold); keyG.add(shaft);
  [[-0.78, 0.26, 0.2], [-1.02, 0.36, 0.2], [-1.28, 0.22, 0.16], [-1.46, 0.3, 0.14]].forEach(([y, w, h]) => {
    const tooth = new Mesh(new BoxGeometry(w, h, 0.14, 1, 1, 1), gold);
    tooth.position.set(0.07 + w / 2, y, 0);
    keyG.add(tooth);
  });
  keyG.position.y = 0.2;
  // Reflexo dourado num cantinho da argola (estrela de luz)
  const glint = new Group(); glint.position.set(0.56, 1.92, 0.35); hero.add(glint);
  const gRay1 = sprite(0xffd590, 1.6, 0.05, 0); const gRay2 = sprite(0xffd590, 1.6, 0.05, 0); const gRay3 = sprite(0xffe9c2, 0.7, 0.03, 0); const gCore = sprite(0xfff1d6, 0.5, 0.5, 0);
  gRay2.material.rotation = Math.PI / 2; gRay3.material.rotation = Math.PI / 4;
  [gRay1, gRay2, gRay3, gCore].forEach((x) => glint.add(x));
  const warm = new PointLight(0xffb866, 0, 12, 1.5); warm.position.set(2.6, 3, 4.5); scene.add(warm);
  const floorGlow = sprite(0x2aa8ff, 9, 9, 0); floorGlow.material.rotation = 0; floorGlow.position.set(0, -2.1, 0); scene.add(floorGlow);

  // Luzes de cena
  scene.add(new AmbientLight(0x10243c, 0.6));
  const key = new SpotLight(0xdff4ff, 0, 40, 0.5, 0.6, 1.2); key.position.set(4, 7, 5); key.target = hero; scene.add(key);
  const fill = new DirectionalLight(0xffe2b0, 0); fill.position.set(-4, 5, 7); scene.add(fill);
  const rim = new DirectionalLight(0x4fc3e0, 0); rim.position.set(-5, 3, -6); scene.add(rim);

  // Faixa de luz azul ao fundo
  const back = sprite(0x1e9bff, 14, 1.6, 0); back.position.set(0, 0.9, -6); scene.add(back);

  // Pedaços de ouro (lascas facetadas de metal): flutuam devagar, aceleram, se unem e viram a chave
  keyG.updateMatrixWorld(true);
  const targets = [];
  keyG.children.forEach((m) => {
    if (!m.geometry) return;
    m.updateMatrix();
    const pa = m.geometry.attributes.position;
    const v = new Vector3();
    for (let j = 0; j < pa.count; j += 1) { v.fromBufferAttribute(pa, j).applyMatrix4(m.matrix); targets.push(v.x, v.y, v.z); }
  });
  const tc = targets.length / 3;
  const shardMat = new MeshStandardMaterial({ color: 0xf0bd5e, metalness: 1, roughness: 0.28, envMapIntensity: 2.4, emissive: 0x3a2400, emissiveIntensity: 0.45, flatShading: true });
  // Formas de pepita/estilhaço: sólidos irregulares com arestas vivas (vértices deslocados), lascas finas e pontiagudas
  const jag = (geo, amt, seed) => {
    // os poliedros da three.js já vêm sem índice; só converte se precisar (cada vértice de face fica independente)
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    const pa = g.attributes.position;
    const map = new Map();
    const v = new Vector3();
    let k = seed;
    const rnd = () => { k = (k * 9301 + 49297) % 233280; return k / 233280; };
    for (let j = 0; j < pa.count; j += 1) {
      v.fromBufferAttribute(pa, j);
      const id = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
      if (!map.has(id)) map.set(id, 1 - amt + rnd() * amt * 2);
      const m = map.get(id);
      pa.setXYZ(j, v.x * m, v.y * m, v.z * m);
    }
    g.computeVertexNormals();
    return g;
  };
  const geos = [jag(new DodecahedronGeometry(1, 0), 0.45, 11), jag(new IcosahedronGeometry(1, 0), 0.5, 37), jag(new TetrahedronGeometry(1, 0), 0.3, 71), jag(new OctahedronGeometry(1, 0), 0.55, 97)];
  const meshes = geos.map((g) => { const m = new InstancedMesh(g, shardMat, SHARDS); m.instanceMatrix.setUsage(DynamicDrawUsage); m.count = 0; keyG.add(m); return m; });
  const S = [];
  for (let i = 0; i < SHARDS; i += 1) {
    const q = Math.floor(Math.random() * tc) * 3;
    const a = Math.random() * Math.PI * 2;
    const z = Math.random() * 2 - 1;
    const r = 1.6 + Math.random() * 3.4;
    const h = Math.sqrt(1 - z * z);
    const gi = i % 4;
    const li = meshes[gi].count;
    meshes[gi].count += 1;
    const kind = Math.random();
    S.push({
      gi, li,
      ex: kind < 0.35 ? 0.35 + Math.random() * 0.3 : 0.7 + Math.random() * 0.6,
      ez: kind < 0.35 ? 1.2 + Math.random() * 0.9 : 0.7 + Math.random() * 0.6,
      tx: targets[q], ty: targets[q + 1], tz: targets[q + 2],
      sx: Math.cos(a) * h * r, sy: 0.3 + z * r * 0.8, sz: Math.sin(a) * h * r,
      d: Math.random() * 0.6, sc: 0.035 + Math.pow(Math.random(), 2.2) * 0.085,
      ax: Math.random() * 6, ay: Math.random() * 6, wx: 0.6 + Math.random(), wy: 0.6 + Math.random(), sq: 0.5 + Math.random() * 0.9
    });
  }
  const dummy = new Object3D();
  const metals = [gold, goldPale, goldM];
  metals.forEach((m) => { m.transparent = true; m.opacity = 0; m.depthWrite = false; });
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const bump = (t, a, b, c) => (t < a ? 0 : t < b ? (t - a) / (b - a) : t < c ? 1 - (t - b) / (c - b) : 0);
  hero.position.set(-0.35, 0.15, 0);
  hero.rotation.z = -0.32;

  // tamanho acompanha a caixa (girar o celular, barra do navegador)
  const resize = () => {
    const w = canvas.clientWidth;
    const hh = canvas.clientHeight;
    if (!w || !hh) return;
    renderer.setSize(w, hh, false);
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
  };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);

  let raf = 0;
  let alive = true;
  let solid = false;
  const t0 = performance.now() - (clockOffset || 0);
  const frame = () => {
    if (!alive) return;
    const t = (performance.now() - t0) / 1000;
    // Câmera: mergulho que desacelera
    const dive = ease(t / 3.4);
    const ang = -0.55 + dive * 0.55 + Math.sin(Math.max(0, t - 3.6) * 0.25) * 0.2;
    const dist = 17 - dive * 6;
    camera.position.set(Math.sin(ang) * dist, 1.15 + (1 - dive) * 1.3 + Math.sin(t * 0.6) * 0.05, Math.cos(ang) * dist);
    camera.lookAt(0, 0.2, 0);
    // A chave se forma no lugar; depois balança de leve
    const settle = ease((t - 2.4) / 1.4);
    keyG.rotation.y = (1 - settle) * 0.9 * Math.sin(t * 0.8) + Math.sin(Math.max(0, t - 3.6) * 0.7) * 0.4;
    hero.position.y = 0.15 + Math.sin(t * 1.1) * 0.04 * settle;
    // Pedaços: deriva lenta girando no próprio eixo → aceleram em redemoinho → encaixam na superfície e somem no ouro
    for (let i = 0; i < SHARDS; i += 1) {
      const p = S[i];
      const u = Math.min(1, Math.max(0, (t - 0.35 - p.d) / 2.15));
      const c = Math.pow(u, 2.4);
      const orbit = t * 0.35 + (1 - c) * c * 9;
      const cs = Math.cos(orbit * (1 - c));
      const sn = Math.sin(orbit * (1 - c));
      const f = 1 - c;
      const ox = p.sx - p.tx;
      const oy = p.sy - p.ty;
      const oz = p.sz - p.tz;
      dummy.position.set(p.tx + (ox * cs - oz * sn) * f + Math.sin(t * p.wx + i) * 0.06 * f, p.ty + oy * f + Math.sin(t * p.wy + i * 0.3) * 0.08 * f, p.tz + (ox * sn + oz * cs) * f);
      const spin = 1 + c * 10;
      dummy.rotation.set(p.ax + t * p.wx * spin, p.ay + t * p.wy * spin, p.ax * 0.7);
      const fade = 1 - ease((t - 2.55 - p.d * 0.4) / 0.45);
      dummy.scale.set(p.sc * fade * p.ex, p.sc * fade * p.sq, p.sc * fade * p.ez);
      dummy.updateMatrix();
      meshes[p.gi].setMatrixAt(p.li, dummy.matrix);
    }
    meshes.forEach((m) => { m.instanceMatrix.needsUpdate = true; });
    // O ouro se materializa
    const op = ease((t - 2.3) / 0.6);
    if (!solid) {
      metals.forEach((m) => { m.opacity = op; m.depthWrite = op > 0.5; });
      if (op >= 1) { solid = true; metals.forEach((m) => { m.transparent = false; m.needsUpdate = true; }); }
    }
    // Luzes
    key.intensity = ease((t - 0.6) / 1.6) * 100; rim.intensity = ease((t - 1.0) / 1.5) * 3.2; fill.intensity = ease((t - 1.6) / 1.4) * 1.6;
    key.position.set(Math.sin(t * 0.5) * 6, 6, 5);
    warm.intensity = ease((t - 0.4) / 1.5) * 30;
    back.material.opacity = ease((t - 0.8) / 1.5) * 0.4;
    floorGlow.material.opacity = ease((t - 1.6) / 1.4) * 0.3;
    // Reflexo dourado no canto: acende com um lampejo e depois cintila devagar
    const gf = bump(t, 2.95, 3.15, 4.0);
    const gl = ease((t - 2.95) / 0.3) * (0.75 + 0.25 * Math.sin(t * 2.3));
    gRay1.material.opacity = gRay2.material.opacity = Math.max(gl, gf); gRay3.material.opacity = gl * 0.7; gCore.material.opacity = Math.max(gl, gf);
    const gs = 1 + gf * 1.6; gRay1.scale.set(1.6 * gs, 0.05, 1); gRay2.scale.set(1.6 * gs, 0.05, 1); gCore.scale.setScalar(0.5 * (1 + gf));
    glint.rotation.z = t * 0.15; gRay1.material.rotation = t * 0.12; gRay2.material.rotation = Math.PI / 2 + t * 0.12; gRay3.material.rotation = Math.PI / 4 - t * 0.2;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  // primeiro quadro na hora (um erro de shader aparece aqui e cai no fallback do componente)
  frame();

  return function stop() {
    alive = false;
    cancelAnimationFrame(raf);
    observer?.disconnect();
    pm.dispose();
    env.dispose();
    glowTex.dispose();
    const disposed = new Set();
    const once = (resource) => { if (resource && !disposed.has(resource)) { disposed.add(resource); resource.dispose(); } };
    [scene, envScene].forEach((root) => root.traverse((o) => { once(o.geometry); once(o.material); }));
    meshes.forEach((m) => m.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
  };
}
