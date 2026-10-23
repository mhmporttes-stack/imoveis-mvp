"use client";

// Partículas da cena de Reconhecimento (visual novo, 2026-10-22). As 4 animações-base configuráveis no admin
// (confete, fogos, moedas, coroa) + combo_200 (exclusivo do marco de 200%) viraram VARIAÇÕES da mesma cena:
//  - confete: canhões dos cantos de baixo (fitas, quadrados e bolinhas, giro 3D);
//  - fogos: estouros de faíscas no alto da tela;
//  - moedas: moedas douradas caindo e girando;
//  - coroa: coroa em destaque com brilho dourado + canhões mais leves;
//  - combo_200: canhões + fogos juntos.
// Tudo em CSS (transform/opacity) a partir de listas determinísticas — sem canvas, sem Math.random no render.
// Paleta: azul/branco/dourado (nada de laranja/arco-íris).

export const CELEBRATION_ANIMATIONS = ["confete", "fogos", "moedas", "coroa", "combo_200"];

// "Branco" vira azul-claro no tema claro (--scene-confetti-light), senão some no fundo.
const BLUES = ["#4FC3E0", "#2A8FB8", "#9FE3F5", "var(--scene-confetti-light, #FFFFFF)", "#1B6FA8"];
const GOLD = "linear-gradient(135deg,#FFF1C2,#F6C552 50%,#C98616)";

function rnd(n, salt = 91.345) {
  const x = Math.sin(n * salt) * 43758.5453;
  return x - Math.floor(x);
}

// Aparelho fraco (poucos núcleos ou pouca memória) recebe metade das partículas — mira em 60fps no celular em vez
// de travar. Heurística simples e barata, sem medir FPS de verdade.
export function getParticleQuality() {
  if (typeof navigator === "undefined") return "high";
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  return cores <= 4 || memory <= 4 ? "low" : "high";
}

// Confete em canhões: metade sai do canto inferior esquerdo, metade do direito.
export function cannonConfetti(count, startMs = 1800) {
  return Array.from({ length: count }, (_, i) => {
    const left = i % 2 === 0;
    const shape = i % 3;
    const gold = i % 6 === 4;
    const dx = Math.round(14 + rnd(i + 11) * 46);
    const dy = Math.round(-(55 + rnd(i + 17) * 35));
    const ex = Math.round(dx * (1.15 + rnd(i + 23) * 0.5));
    return {
      key: `c${i}`,
      style: {
        [left ? "left" : "right"]: "-6px",
        width: shape === 0 ? 5 : shape === 1 ? 9 : 7,
        height: shape === 0 ? 16 : shape === 1 ? 9 : 7,
        borderRadius: shape === 2 ? 99 : 2,
        background: gold ? GOLD : BLUES[i % BLUES.length],
        "--dx": `${left ? dx : -dx}vw`,
        "--dy": `${dy}vh`,
        "--ex": `${left ? ex : -ex}vw`,
        "--r": `${Math.round((rnd(i + 37) - 0.5) * 1080)}deg`,
        animationDuration: `${(3.4 + rnd(i + 31) * 1.6).toFixed(2)}s`,
        animationDelay: `${startMs + Math.round(rnd(i + 29) * 260)}ms`
      }
    };
  });
}

// Fogos: estouros de faíscas em pontos do alto da tela, um depois do outro.
export function fireworkBursts(bursts, sparksPerBurst, startMs = 1800) {
  return Array.from({ length: bursts }, (_, b) => ({
    key: `f${b}`,
    style: {
      left: `${Math.round(18 + rnd(b + 3, 51.7) * 64)}%`,
      top: `${Math.round(10 + rnd(b + 9, 51.7) * 26)}%`
    },
    sparks: Array.from({ length: sparksPerBurst }, (_, i) => {
      const angle = (i / sparksPerBurst) * Math.PI * 2;
      const dist = 70 + rnd(b * 40 + i, 33.1) * 70;
      const gold = (i + b) % 4 === 0;
      return {
        key: `f${b}s${i}`,
        style: {
          background: gold ? "#F6C552" : BLUES[(i + b) % BLUES.length],
          "--sx": `${Math.round(Math.cos(angle) * dist)}px`,
          "--sy": `${Math.round(Math.sin(angle) * dist + 24)}px`,
          animationDelay: `${startMs + b * 520}ms`
        }
      };
    })
  }));
}

// Moedas douradas caindo do alto e girando.
export function fallingCoins(count, startMs = 1800) {
  return Array.from({ length: count }, (_, i) => ({
    key: `m${i}`,
    style: {
      left: `${Math.round(rnd(i + 5, 21.3) * 96)}%`,
      width: Math.round(16 + rnd(i + 8, 21.3) * 10),
      animationDuration: `${(2.6 + rnd(i + 13, 21.3) * 1.4).toFixed(2)}s`,
      animationDelay: `${startMs + Math.round(rnd(i + 2, 21.3) * 1400)}ms`
    }
  }));
}

// Pontos de luz subindo devagar (contínuo enquanto a cena estiver na tela).
export function risingMotes(count) {
  return Array.from({ length: count }, (_, i) => ({
    key: `p${i}`,
    style: {
      left: `${Math.round(rnd(i + 30) * 100)}%`,
      width: 3 + (i % 3),
      height: 3 + (i % 3),
      animationDuration: `${5 + (i % 4)}s`,
      animationDelay: `${Math.round(rnd(i + 60) * 3000)}ms`
    }
  }));
}

// Quais efeitos cada animação liga (as quantidades caem pela metade em aparelho fraco).
export function effectsFor(animation, quality = "high") {
  const f = quality === "low" ? 0.5 : 1;
  const n = (value) => Math.max(1, Math.round(value * f));
  switch (animation) {
    case "fogos":
      return { cannons: [], bursts: fireworkBursts(n(5), 18), coins: [], crownGlow: false };
    case "moedas":
      return { cannons: [], bursts: [], coins: fallingCoins(n(36)), crownGlow: false };
    case "coroa":
      return { cannons: cannonConfetti(n(40)), bursts: [], coins: [], crownGlow: true };
    case "combo_200":
      return { cannons: cannonConfetti(n(84)), bursts: fireworkBursts(n(5), 18, 2600), coins: [], crownGlow: true };
    default:
      return { cannons: cannonConfetti(n(84)), bursts: [], coins: [], crownGlow: false };
  }
}
