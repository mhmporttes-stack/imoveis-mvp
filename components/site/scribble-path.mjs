// Trajetos "à mão" das setas-rabisco da seção de imóveis (dono, 2026-10-17). Puro (sem DOM): recebe ponto de saída e de
// chegada e devolve pontos que passam por uma curva suave, no estilo de uma anotação feita à mão. Cada `shape` é um
// caminho diferente (um com laço, outro em vai-e-vem), definidos em frações do deslocamento (dx, dy) mais folgas em px,
// então funcionam em qualquer largura de tela.

/** @typedef {{x:number,y:number}} Point */

// [fração de dx, fração de dy, folga em px no eixo y, folga em px no eixo x]
const SHAPES = {
  // Sai da direita do "U", sobe em arco, desce fazendo um laço e entra no meio do botão "Região".
  laco: [
    [0, 0, 0, 0],
    [0.1, 0, -12, 0],
    [0.26, 0, -26, 0],
    [0.46, 0, -24, 0],
    [0.62, 0.04, -6, 0],
    [0.7, 0.2, 0, 8],
    [0.66, 0.36, 4, 4],
    [0.56, 0.3, 0, -6],
    [0.58, 0.16, 0, 0],
    [0.72, 0.22, 0, 0],
    [0.86, 0.52, 0, 0],
    [0.96, 0.84, 0, 0],
    [1, 1, 0, 0]
  ],
  // Sai da esquerda do "E", faz um arco para fora, um vai-e-vem (zigue-zague) e chega no "ou" da busca.
  onda: [
    [0, 0, 0, 0],
    [0.08, 0, -14, 0],
    [0.24, 0, -28, 0],
    [0.46, 0.02, -20, 0],
    [0.62, 0.14, 0, -6],
    [0.5, 0.3, 0, 10],
    [0.36, 0.42, 0, -2],
    [0.52, 0.56, 0, 12],
    [0.66, 0.66, 0, 0],
    [0.5, 0.82, 0, 6],
    [0.8, 0.92, 0, 0],
    [1, 1, 0, 0]
  ]
};

/** Pontos do rabisco indo de S até T. */
export function scribblePoints(S, T, shape = "laco") {
  const dx = T.x - S.x;
  const dy = T.y - S.y;
  return (SHAPES[shape] || SHAPES.laco).map(([fx, fy, oy, ox]) => ({ x: S.x + dx * fx + ox, y: S.y + dy * fy + oy }));
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

/** Ponta da seta (duas hastes finas) no ponto final, alinhada à direção de chegada. */
export function arrowHead(from, to, size = 11, spread = 0.5) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const wing = (sign) => ({ x: to.x - size * Math.cos(angle + sign * spread), y: to.y - size * Math.sin(angle + sign * spread) });
  const a = wing(1);
  const b = wing(-1);
  const f = (n) => Math.round(n * 10) / 10;
  return `M${f(a.x)} ${f(a.y)} L${f(to.x)} ${f(to.y)} L${f(b.x)} ${f(b.y)}`;
}

export const SCRIBBLE_SHAPES = Object.keys(SHAPES);
