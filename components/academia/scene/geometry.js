// Geometria do mundo da Academia (px do mundo, y para baixo, chão em y=0).
// 1 aula = 1 andar. Valores do protótipo aprovado; só dependem destes números.
export const FH = 60; // altura do andar
export const LB = 64; // saguão
export const HW = 105; // meia largura da torre
export const NF = 18; // andares (aulas) do exemplo; o app usa o total vindo dos dados

export const yTop = (i) => -(LB + (i + 1) * FH); // topo do andar i
export const flY = (fl) => -(LB + fl * FH); // altura da câmera em "andares"
export const WINX = (j) => -93 + j * (34 + (186 - 136) / 3); // x esquerdo da janela j (0..3)

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Gerador pseudo-aleatório determinístico (nuvens/estrelas/skyline iguais em toda sessão).
export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
