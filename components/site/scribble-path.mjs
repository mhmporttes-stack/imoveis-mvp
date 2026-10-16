// Trajetos "à mão" das setas-rabisco da seção de imóveis (dono, 2026-10-17). Puro (sem DOM): recebe ponto de saída e de
// chegada e devolve pontos que passam por uma curva suave, no estilo de uma anotação feita à mão. Cada `shape` é um
// caminho diferente (um com laço, outro em vai-e-vem), definidos em frações do deslocamento (dx, dy) mais folgas em px,
// então funcionam em qualquer largura de tela.

/** @typedef {{x:number,y:number}} Point */

// [fração de dx, fração de dy, folga em px no eixo y, folga em px no eixo x]
const SHAPES = {
  // Sai da direita do "U", sobe num arco largo, faz UM laço limpo e termina descendo na vertical, acima do botão "Região".
  laco: [
    [0, 0, 0, 0],
    [0.12, 0, -10, 0],
    [0.3, 0, -20, 0],
    [0.5, 0.02, -14, 0],
    [0.64, 0.14, -2, 0],
    [0.72, 0.3, 4, 6],
    [0.62, 0.44, 6, 0],
    [0.56, 0.3, 0, -4],
    [0.72, 0.2, 0, 0],
    [0.9, 0.3, 0, 0],
    [0.965, 0.52, 0, 0],
    [0.995, 0.8, 0, 0],
    [1, 1, 0, 0]
  ],
  // Sai da esquerda do "E", faz UM arco largo e suave para a esquerda e termina descendo na vertical, acima do "ou" da busca.
  onda: [
    [0, 0, 0, 0],
    [0.1, 0, -14, 0],
    [0.3, 0, -30, 0],
    [0.55, 0.02, -28, 0],
    [0.78, 0.1, -12, 0],
    [0.93, 0.3, 0, 0],
    [0.975, 0.56, 0, 0],
    [0.997, 0.82, 0, 0],
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
