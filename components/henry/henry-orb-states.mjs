// Alvos de cada estado do anel do Henry (HenryOrb.jsx) e cores — puro, testável. Todos os números são interpolados a cada
// quadro (orbEase ≈ 95% em 300 ms), então trocar de estado nunca corta a animação.
//   amp/levelAmp     = ondulação dos fios (base + quanto o volume soma)
//   swell/levelSwell = inchaço do raio
//   speed/levelSpeed = velocidade do ruído
//   spin/counterSpin = rotação geral / camadas em sentidos opostos
//   breath/breathRate= respiração (contrai/expande) e ritmo (ciclos por segundo)
//   travel           = onda que percorre o anel (ouvindo)
//   fan              = fios abrindo em leque (falando)
//   sphere           = vira quase esfera nos picos da voz (falando)
//   warm             = 0 frio (ciano/azul) → 1 quente (dourado e branco no topo)
//   glowBase/glowLevel = brilho de fundo; beamOn = feixe dourado no contorno (pensando)
export const HENRY_ORB_STATES = Object.freeze({
  idle: { amp: 0.4, levelAmp: 0, swell: 0, levelSwell: 0, speed: 0.3, levelSpeed: 0, spin: 0.05, counterSpin: 0, breath: 0.022, breathRate: 0.16, travel: 0, fan: 0, sphere: 0, warm: 0.15, glowBase: 0, glowLevel: 0, beamOn: 0 },
  listening: { amp: 0.75, levelAmp: 1.9, swell: 0.03, levelSwell: 0.16, speed: 1.3, levelSpeed: 2.6, spin: 0.12, counterSpin: 0, breath: 0.01, breathRate: 0.5, travel: 1, fan: 0.1, sphere: 0, warm: 0, glowBase: 0.08, glowLevel: 0.75, beamOn: 0 },
  thinking: { amp: 0.55, levelAmp: 0, swell: -0.02, levelSwell: 0, speed: 0.7, levelSpeed: 0, spin: 0.1, counterSpin: 1.1, breath: 0.07, breathRate: 0.75, travel: 0.2, fan: 0.15, sphere: 0, warm: 0.45, glowBase: 0.12, glowLevel: 0, beamOn: 1 },
  speaking: { amp: 0.9, levelAmp: 1.6, swell: 0.06, levelSwell: 0.42, speed: 1.1, levelSpeed: 1.8, spin: 0.18, counterSpin: 0.15, breath: 0.01, breathRate: 0.4, travel: 0.3, fan: 1, sphere: 1, warm: 1, glowBase: 0.15, glowLevel: 0.6, beamOn: 0 }
});

export const ORB_TRANSITION_MS = 300;

// Fator de aproximação por quadro: depois de ORB_TRANSITION_MS o valor percorreu ~95% do caminho, qualquer que seja o fps.
export function orbEase(deltaSeconds) {
  const tau = ORB_TRANSITION_MS / 1000 / 3;
  return 1 - Math.exp(-Math.max(0, Number(deltaSeconds) || 0) / tau);
}

const COOL = [
  [0, "#F3DCA6"],
  [0.16, "#BFF1FF"],
  [0.42, "#4FC3E0"],
  [0.72, "#1E9BFF"],
  [1, "#0B3D91"]
];
const WARM = [
  [0, "#FFFFFF"],
  [0.16, "#FFF1CF"],
  [0.42, "#F3DCA6"],
  [0.72, "#4FC3E0"],
  [1, "#1E9BFF"]
];

export function mixHexColor(from, to, t) {
  const amount = Math.max(0, Math.min(1, Number(t) || 0));
  const parse = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const a = parse(from);
  const b = parse(to);
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

export function orbStops(warm) {
  return COOL.map(([offset, color], index) => [offset, mixHexColor(color, WARM[index][1], warm)]);
}
