/* Personagens 2D articulados (estilo fantoche) — paleta da marca. Sem dependências.
   Uso:  const c = Rig.make("corretor"); parent.appendChild(c.el); c.set({ aE:[100,30], hE:"aberta", mouth:"grin" });
   Origem do personagem = centro dos pés (0,0); altura ~600 unidades (y negativo = para cima).
   Ângulos em graus. Braços: [ombro, cotovelo], "para fora" = positivo nos dois lados;
   cotovelo positivo = antebraço dobra para cima. Lado E = esquerda da imagem, D = direita. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const OUT = "#0B1A3A", OW = 5;                  // contorno
  const SKIN = ["#EDB48B", "#D79A71"], BLUSH = "#F4877F";
  const LOOKS = {
    corretor: { skin: SKIN, hair: "#2A1B16", hairStyle: "repartido", top: "blazer", blazer: "#1F4396", lapel: "#2E5FC4", shirt: "#FFFFFF", tie: "#3B8BFF", pants: "#2F3B52", shoe: "#4A2F22", sleeve: "#1F4396", cuff: "#FFFFFF" },
    cliente:  { skin: ["#C98B62", "#B5744C"], hair: "#1D1512", hairStyle: "cacheado", top: "camiseta", shirt: "#FFFFFF", pants: "#3A5C9E", shoe: "#F2F4F8", sleeve: "#FFFFFF", cuff: "#FFFFFF" },
    cliente2: { skin: ["#F1C09A", "#DBA57C"], hair: "#5B3522", hairStyle: "longo", top: "camiseta", shirt: "#CFE0FF", pants: "#25324F", shoe: "#FFFFFF", sleeve: "#CFE0FF", cuff: "#CFE0FF" },
  };
  let uid = 0;

  /* ---- helpers de forma: contorno externo uniforme (paint-order) ---- */
  const o = (extra = "") => `stroke="${OUT}" stroke-width="${OW * 2}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke" ${extra}`;
  const thin = (w = 4) => `stroke="${OUT}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  const path = (d, fill, extra = "") => `<path d="${d}" fill="${fill}" ${o(extra)}/>`;
  const ell = (cx, cy, rx, ry, fill, extra = "") => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${o(extra)}/>`;
  const rect = (x, y, w, h, r, fill, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${o(extra)}/>`;

  /* ---- mãos (coordenadas locais do punho; eixo +y = direção do antebraço; polegar em -x) ---- */
  function handShapes(name, skin, pass) {
    const f = pass ? skin[0] : OUT, sh = pass ? skin[1] : OUT;
    const S = pass ? "" : `stroke="${OUT}" stroke-width="${OW * 2}" stroke-linejoin="round" stroke-linecap="round"`;
    const E = (cx, cy, rx, ry, rot = 0, c = f) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${rot ? `transform="rotate(${rot} ${cx} ${cy})"` : ""} fill="${c}" ${S}/>`;
    const R = (x, y, w, h, r, c = f) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${c}" ${S}/>`;
    const L = (d) => pass ? `<path d="${d}" fill="none" stroke="${sh}" stroke-width="3.5" stroke-linecap="round"/>` : "";
    if (name === "aberta") return E(-23, 16, 10, 16, 18) + E(0, 32, 27, 30) + L("M -8,52 L -8,60 M 6,52 L 6,60");
    if (name === "aponta") return R(-8, 36, 17, 52, 8.5) + E(-22, 22, 10, 13, 16) + E(0, 30, 24, 24) + E(12, 44, 10, 10) + E(10, 56, 9, 9);
    if (name === "punho")  return E(0, 30, 27, 28) + L("M -14,24 L 14,24 M -14,34 L 14,34");
    if (name === "joinha") return R(-8, 46, 17, 46, 8.5) + E(0, 30, 27, 27) + L("M -14,24 L 14,24 M -14,34 L 14,34");
    return "";
  }
  const HANDS = ["aberta", "aponta", "punho", "joinha"];

  function limb(side, look, pass) {
    const sx = side === "E" ? -1 : 1, fill = pass ? look.sleeve : OUT, S = pass ? "" : `stroke="${OUT}" stroke-width="${OW * 2}" stroke-linejoin="round"`;
    const flip = side === "E" ? "scale(-1,1)" : "";
    const hands = HANDS.map(h => `<g data-hand="${side}:${h}" style="display:${h === "aberta" ? "inline" : "none"}">${handShapes(h, look.skin, pass)}</g>`).join("");
    const cuff = pass ? `<rect x="-22" y="54" width="44" height="16" rx="6" fill="${look.cuff}" ${thin(3.5)}/>` : "";
    return `<g data-p="arm${side}.u" transform="translate(${sx * 82},-338)">
      <circle cx="0" cy="0" r="27" fill="${fill}" ${S}/>
      <rect x="-23" y="0" width="46" height="78" rx="23" fill="${fill}" ${S}/>
      <circle cx="0" cy="78" r="23" fill="${fill}" ${S}/>
      <g data-p="arm${side}.f" transform="translate(0,78)">
        <g transform="translate(0,66) ${flip}">${hands}</g>
        <rect x="-20" y="0" width="40" height="74" rx="20" fill="${fill}" ${S}/>${cuff}
      </g></g>`;
  }

  /* ---- cabelos ---- */
  function hairBack(look) {
    if (look.hairStyle !== "longo") return "";
    return path("M -112,-500 C -134,-612 134,-612 112,-500 C 126,-440 126,-372 98,-356 C 70,-346 40,-368 0,-368 C -40,-368 -70,-346 -98,-356 C -126,-372 -126,-440 -112,-500 Z", look.hair);
  }
  function hairFront(look) {
    const h = look.hair, hi = "rgba(255,255,255,.16)";
    if (look.hairStyle === "repartido")
      return path("M -108,-490 C -116,-574 -58,-610 6,-608 C 72,-606 118,-566 108,-488 C 102,-514 86,-534 58,-542 C 40,-522 -2,-540 -44,-530 C -78,-524 -96,-508 -108,-490 Z", h) +
             `<path d="M -56,-580 Q -22,-600 22,-596" fill="none" stroke="${hi}" stroke-width="9" stroke-linecap="round"/>`;
    if (look.hairStyle === "cacheado") {
      const C = ["-78,-556,40", "-34,-586,44", "22,-594,46", "70,-568,42", "98,-520,30", "-102,-518,30", "6,-560,36"].map(q => q.split(",").map(Number));
      return C.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${OUT}" stroke="${OUT}" stroke-width="${OW * 2}"/>`).join("") +
             C.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${h}"/>`).join("") +
             `<path d="M -84,-566 Q -50,-596 -4,-592" fill="none" stroke="${hi}" stroke-width="8" stroke-linecap="round"/>`;
    }
    if (look.hairStyle === "longo")
      return path("M -110,-488 C -116,-578 -50,-612 8,-608 C 78,-604 118,-566 110,-488 C 96,-536 56,-552 22,-556 C -10,-530 -64,-536 -110,-488 Z", h) +
             `<path d="M -60,-584 Q -24,-602 24,-598" fill="none" stroke="${hi}" stroke-width="8" stroke-linecap="round"/>`;
    return "";
  }

  /* ---- boca ---- */
  const MOUTHS = {
    smile:  `<path d="M -28,-436 Q 0,-406 28,-436" fill="none" ${thin(5.5)}/>`,
    grin:   `<path d="M -36,-440 Q 0,-430 36,-440 Q 32,-396 0,-394 Q -32,-396 -36,-440 Z" fill="#7C1D2B" ${thin(5)}/>
             <path d="M -33,-438 Q 0,-429 33,-438 L 31,-423 Q 0,-414 -31,-423 Z" fill="#fff"/>
             <path d="M -18,-404 Q 0,-420 18,-404 Q 10,-396 0,-396 Q -10,-396 -18,-404 Z" fill="#F0857F"/>`,
    o:      `<ellipse cx="0" cy="-424" rx="16" ry="20" fill="#7C1D2B" ${thin(5)}/><ellipse cx="0" cy="-414" rx="9" ry="6" fill="#F0857F"/>`,
    flat:   `<path d="M -22,-428 L 22,-428" fill="none" ${thin(5.5)}/>`,
    frown:  `<path d="M -28,-418 Q 0,-442 28,-418" fill="none" ${thin(5.5)}/>`,
    worry:  `<path d="M -30,-426 Q -15,-440 0,-426 Q 15,-412 30,-426" fill="none" ${thin(5.5)}/>`,
    side:   `<path d="M -22,-424 Q 6,-426 28,-440" fill="none" ${thin(5.5)}/>`,
  };

  /* ---- montagem ---- */
  function make(kind, opts = {}) {
    const look = LOOKS[kind], id = "c" + (uid++), [sk, skS] = look.skin;
    const eye = (x, side) => `<clipPath id="${id}e${side}"><circle cx="${x}" cy="-470" r="27"/></clipPath>
      <circle cx="${x}" cy="-470" r="27" fill="#fff" ${thin(4.5)}/>
      <g data-p="eyeS${side}" style="transform-origin:${x}px -470px"><g data-p="pup${side}"><circle cx="${x}" cy="-470" r="13" fill="#10131c"/><circle cx="${x - 4}" cy="-475" r="4.6" fill="#fff"/></g>
      <g clip-path="url(#${id}e${side})"><rect data-p="lid${side}" x="${x - 30}" y="-500" width="60" height="60" fill="${sk}" style="transform-origin:${x}px -500px;transform:scaleY(0)"/>
      <line data-p="lidline${side}" x1="${x - 28}" x2="${x + 28}" y1="-500" y2="-500" ${thin(4.5)} style="display:none"/></g></g>`;
    const brow = (x, side) => `<path data-p="brow${side}" d="M -25,0 Q 0,-10 25,0" fill="none" stroke="${look.hair}" stroke-width="11" stroke-linecap="round" transform="translate(${x},-524)"/>`;
    const legs = [-1, 1].map(s => `<g data-p="leg${s < 0 ? "E" : "D"}" transform="translate(${s * 34},-186)">
        ${rect(-29, -12, 58, 168, 26, look.pants)}
        ${path(s < 0 ? "M -54,150 L 30,150 L 32,184 Q 32,190 24,190 L -40,190 Q -58,190 -58,176 Q -58,160 -54,150 Z" : "M 54,150 L -30,150 L -32,184 Q -32,190 -24,190 L 40,190 Q 58,190 58,176 Q 58,160 54,150 Z", look.shoe)}
        <path d="${s < 0 ? "M -58,180 L 30,180" : "M 58,180 L -30,180"}" stroke="${OUT}" stroke-width="3.5" opacity=".5"/>
      </g>`).join("");
    const blazer = look.top === "blazer";
    const torso = blazer
      ? path("M -80,-346 Q -80,-366 -58,-366 L 58,-366 Q 80,-366 80,-346 L 74,-192 Q 74,-172 54,-172 L -54,-172 Q -74,-172 -74,-192 Z", look.blazer) +
        path("M -26,-366 L 26,-366 L 0,-272 Z", look.shirt, "") +
        `<path d="M -10,-336 L 10,-336 L 14,-290 L 0,-272 L -14,-290 Z" fill="${look.tie}" ${thin(3.5)}/>` +
        `<path d="M -28,-366 L -50,-362 L -14,-262 L 0,-272 L -14,-300 Z M 28,-366 L 50,-362 L 14,-262 L 0,-272 L 14,-300 Z" fill="${look.lapel}" ${thin(4)}/>` +
        `<circle cx="14" cy="-226" r="6" fill="#0B1A3A"/><path d="M -62,-206 L -34,-206" stroke="#0B1A3A" stroke-width="4" stroke-linecap="round" opacity=".55"/>`
      : path("M -78,-346 Q -78,-366 -56,-366 L 56,-366 Q 78,-366 78,-346 L 72,-190 Q 72,-172 52,-172 L -52,-172 Q -72,-172 -72,-190 Z", look.shirt) +
        `<path d="M -26,-366 Q 0,-336 26,-366" fill="${skS}" ${thin(4)}/>`;
    const html = `<g data-p="root"><g data-p="legs">${legs}</g>
      <g data-p="upper">
        ${hairBack(look)}
        <rect x="-24" y="-410" width="48" height="50" fill="${skS}" ${thin(4)}/>
        ${torso}
        <g data-p="head">
          ${ell(-104, -474, 17, 24, sk)}${ell(104, -474, 17, 24, sk)}
          ${path("M -106,-478 C -106,-545 -58,-576 0,-576 C 58,-576 106,-545 106,-478 C 106,-426 62,-384 0,-384 C -62,-384 -106,-426 -106,-478 Z", sk)}
          ${hairFront(look)}
          <ellipse cx="-66" cy="-440" rx="15" ry="11" fill="${BLUSH}" opacity=".7"/><ellipse cx="66" cy="-440" rx="15" ry="11" fill="${BLUSH}" opacity=".7"/>
          <ellipse cx="0" cy="-447" rx="9" ry="7" fill="${skS}"/>
          ${eye(-40, "E")}${eye(40, "D")}
          ${brow(-40, "E")}${brow(40, "D")}
          <g data-p="mouth">${MOUTHS.smile}</g>
        </g>
        <g data-p="arms"><g data-p="armsE">${limb("E", look, 0)}${limb("E", look, 1)}</g><g data-p="armsD">${limb("D", look, 0)}${limb("D", look, 1)}</g></g>
      </g></g>`;
    const g = document.createElementNS(NS, "g"); g.setAttribute("data-char", kind); g.innerHTML = html;
    const q = (s) => [...g.querySelectorAll(s)];
    const P = {};
    ["root", "upper", "head", "mouth", "browE", "browD", "pupE", "pupD", "lidE", "lidD", "lidlineE", "lidlineD", "eyeSE", "eyeSD", "legE", "legD"].forEach(k => P[k] = q(`[data-p="${k}"]`)[0]);
    ["armE.u", "armE.f", "armD.u", "armD.f"].forEach(k => P[k] = q(`[data-p="${k}"]`));
    const tr = (el, t) => el.setAttribute("transform", t);
    const S0 = { x: 0, y: 0, r: 0, sx: 1, sy: 1, lean: 0, hr: 0, hx: 0, hy: 0, aE: [4, 6], aD: [4, 6], hE: "aberta", hD: "aberta", lE: 0, lD: 0,
                 look: [0, 0], blink: 0, eyeS: 1, brow: [0, 0, 0, 0], mouth: "smile" };
    function set(p) {
      p = Object.assign({}, S0, p);
      tr(P.root, `translate(${p.x},${p.y}) rotate(${p.r}) scale(${p.sx},${p.sy})`);
      tr(P.upper, `translate(0,-186) rotate(${p.lean}) translate(0,186)`);
      tr(P.head, `translate(${p.hx},${p.hy}) translate(0,-396) rotate(${p.hr}) translate(0,396)`);
      tr(P.legE, `translate(-34,-186) rotate(${-p.lE})`); tr(P.legD, `translate(34,-186) rotate(${p.lD})`);
      P["armE.u"].forEach(e => tr(e, `translate(-82,-338) rotate(${p.aE[0]})`)); P["armE.f"].forEach(e => tr(e, `translate(0,78) rotate(${p.aE[1]})`));
      P["armD.u"].forEach(e => tr(e, `translate(82,-338) rotate(${-p.aD[0]})`)); P["armD.f"].forEach(e => tr(e, `translate(0,78) rotate(${-p.aD[1]})`));
      q("[data-hand]").forEach(h => { const [sd, nm] = h.getAttribute("data-hand").split(":"); h.style.display = nm === (sd === "E" ? p.hE : p.hD) ? "inline" : "none"; });
      const lx = Math.max(-1, Math.min(1, p.look[0])) * 9, ly = Math.max(-1, Math.min(1, p.look[1])) * 8;
      tr(P.pupE, `translate(${lx},${ly})`); tr(P.pupD, `translate(${lx},${ly})`);
      [P.eyeSE, P.eyeSD].forEach(e => e.style.transform = `scale(${p.eyeS})`);
      const b = Math.max(0, Math.min(1, p.blink));
      [P.lidE, P.lidD].forEach(e => e.style.transform = `scaleY(${b})`);
      [["E", P.lidlineE, -40], ["D", P.lidlineD, 40]].forEach(([, l]) => { l.style.display = b > 0.05 ? "inline" : "none"; l.setAttribute("y1", -500 + 60 * b); l.setAttribute("y2", -500 + 60 * b); });
      tr(P.browE, `translate(-40,${-524 + p.brow[0]}) rotate(${-p.brow[1]})`); tr(P.browD, `translate(40,${-524 + p.brow[2]}) rotate(${p.brow[3]})`);
      if (P.mouth._m !== p.mouth) { P.mouth.innerHTML = MOUTHS[p.mouth] || MOUTHS.smile; P.mouth._m = p.mouth; }
    }
    g.setAttribute("data-uid", id); set({});
    return { el: g, set, look };
  }

  /* expressões prontas (sobrancelha: [yE, rotE, yD, rotD]; rot > 0 = ponta de dentro para cima) */
  const EXPR = {
    feliz:      { brow: [-4, 0, -4, 0], mouth: "smile", eyeS: 1 },
    animado:    { brow: [-12, 0, -12, 0], mouth: "grin", eyeS: 1.04 },
    surpreso:   { brow: [-20, 0, -20, 0], mouth: "o", eyeS: 1.12 },
    preocupado: { brow: [-2, 20, -2, 20], mouth: "worry", eyeS: 1.02 },
    triste:     { brow: [0, 24, 0, 24], mouth: "frown", eyeS: 1 },
    bravo:      { brow: [4, -22, 4, -22], mouth: "frown", eyeS: .96 },
    pensativo:  { brow: [2, 0, -16, 0], mouth: "side", eyeS: 1, look: [.8, -.8] },
    neutro:     { brow: [0, 0, 0, 0], mouth: "flat", eyeS: 1 },
  };
  window.Rig = { make, EXPR, LOOKS, OUT };
})();
