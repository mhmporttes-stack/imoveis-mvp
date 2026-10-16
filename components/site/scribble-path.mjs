// Trajetos "à mão" das setas-rabisco da seção de imóveis (dono, 2026-10-17). Puro (sem DOM).
//
// Os dois desenhos vieram do quadro de modelos aprovado pelo dono (setas 1 e 2). Cada um é uma lista de pontos medidos
// no desenho original; aqui eles são ESTICADOS para ligar o ponto de saída S ao ponto de chegada T de qualquer tela:
//  - o eixo x vai de S até T (se T está à esquerda de S o desenho sai ESPELHADO, que é o que a seta da esquerda precisa);
//  - o eixo y é escalado para o traço terminar exatamente em T, com o arco para cima limitado (para não invadir o
//    texto acima); se o arco limitado deixar o fim curto, a diferença é distribuída suavemente ao longo do percurso.

/** @typedef {{x:number,y:number}} Point */

// Pontos do desenho original (coordenadas da imagem do quadro), do início ao fim, ponta apontando para baixo.
const SHAPES = {
  // Seta 1: arco largo, um laço grande e uma descida em curva até a ponta.
  laco: [
    [70, 218], [105, 172], [160, 130], [230, 102], [320, 86], [395, 92], [450, 112], [484, 150], [494, 190], [478, 230],
    [432, 254], [392, 240], [380, 205], [402, 165], [455, 133], [520, 122], [590, 130], [645, 158], [680, 205], [696, 258],
    [697, 303]
  ],
  // Seta 2: onda suave, um laço pequeno no meio e um gancho final até a ponta.
  onda: [
    [828, 182], [850, 168], [880, 162], [920, 172], [970, 200], [1020, 240], [1070, 268], [1120, 280], [1180, 270],
    [1235, 238], [1262, 200], [1268, 168], [1250, 132], [1215, 121], [1178, 135], [1163, 168], [1178, 200], [1215, 214],
    [1255, 208], [1300, 193], [1345, 190], [1395, 205], [1428, 240], [1442, 282], [1447, 308]
  ]
};

const MAX_UP_PX = 42; // até onde o arco pode subir acima do ponto de saída
const smoothstep = (t) => t * t * (3 - 2 * t);

/** Pontos do rabisco indo de S até T (a curva passa por eles). */
export function scribblePoints(S, T, shape = "laco") {
  const ref = SHAPES[shape] || SHAPES.laco;
  const dx = T.x - S.x;
  const dy = T.y - S.y;
  const [x0, y0] = ref[0];
  const [xEnd, yEnd] = ref[ref.length - 1];
  const endRel = yEnd - y0;
  const upAmp = y0 - Math.min(...ref.map((p) => p[1]));
  // escala vertical natural (o fim cai exatamente em T); limitada pelo arco máximo
  const kx = Math.abs(dx / (xEnd - x0));
  let ky = endRel !== 0 ? Math.min(dy / endRel, kx * 1.05) : 1; // nunca mais esticado na vertical que na horizontal: laços continuam redondos
  if (ky * upAmp > MAX_UP_PX) ky = MAX_UP_PX / upAmp;
  const correction = dy - endRel * ky; // o que faltou descer (0 quando não houve limite)
  const last = ref.length - 1;
  return ref.map(([x, y], i) => ({
    x: S.x + dx * ((x - x0) / (xEnd - x0)),
    y: S.y + (y - y0) * ky + correction * smoothstep(i / last)
  }));
}

/** Curva suave (Catmull-Rom → Bézier cúbica) passando por todos os pontos. */
export function smoothPath(points, tension = 0.5) {
  if (points.length < 2) return "";
  const f = (n) => Math.round(n * 10) / 10;
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1 = { x: p1.x + ((p2.x - p0.x) * tension) / 3, y: p1.y + ((p2.y - p0.y) * tension) / 3 };
    const c2 = { x: p2.x - ((p3.x - p1.x) * tension) / 3, y: p2.y - ((p3.y - p1.y) * tension) / 3 };
    d += ` C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/**
 * Ponta da seta ARREDONDADA, desenhada à mão: duas asas em curva suave (Bézier quadrática) que se encontram na ponta,
 * sem hastes retas nem ângulo duro (o traço usa pontas e junções arredondadas). Alinhada à direção de chegada.
 */
export function arrowHead(from, to, size = 14) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  const sx = -fy;
  const sy = fx;
  const at = (back, side) => ({ x: to.x - fx * back + sx * side, y: to.y - fy * back + sy * side });
  const wingA = at(size * 1.0, size * 0.62);
  const wingB = at(size * 1.0, -size * 0.62);
  const ctrlA = at(size * 0.78, size * 0.1); // curva as asas para dentro (efeito "gancho" de caneta)
  const ctrlB = at(size * 0.78, -size * 0.1);
  const tipA = at(size * 0.1, size * 0.02);
  const tipB = at(size * 0.1, -size * 0.02);
  const f = (n) => Math.round(n * 10) / 10;
  const pt = (q) => `${f(q.x)} ${f(q.y)}`;
  return `M${pt(wingA)} Q${pt(ctrlA)} ${pt(tipA)} Q${pt(to)} ${pt(tipB)} Q${pt(ctrlB)} ${pt(wingB)}`;
}

export const SCRIBBLE_SHAPES = Object.keys(SHAPES);
