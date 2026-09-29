"use client";

// 4 animações-base (confete, fogos, moedas, coroa) + combo_200 (fogos +
// confete, exclusivo do marco de 200%). Canvas puro, sem dependência nova —
// leve o bastante para rodar em qualquer celular, nunca trava o resto da
// tela (a própria função devolve um cleanup que para tudo no unmount/dismiss).

const CONFETTI_COLORS = ["#F97316", "#FACC15", "#22C55E", "#3B82F6", "#EC4899", "#A855F7"];
const COIN_COLOR = "#F5C542";

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function makeConfettiParticles(width, count) {
  return Array.from({ length: count }, () => ({
    x: rand(0, width),
    y: rand(-160, -10),
    size: rand(6, 12),
    speedY: rand(2, 4.5),
    speedX: rand(-1.2, 1.2),
    rotation: rand(0, Math.PI * 2),
    rotationSpeed: rand(-0.15, 0.15),
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    life: rand(70, 130)
  }));
}

function makeCoinParticles(width, count) {
  return Array.from({ length: count }, () => ({
    x: rand(0, width),
    y: rand(-160, -10),
    size: rand(10, 18),
    speedY: rand(1.8, 3.4),
    wobble: rand(0, Math.PI * 2),
    wobbleSpeed: rand(0.05, 0.12),
    life: rand(90, 150)
  }));
}

function makeFireworkBurst(x, y, count = 40) {
  return Array.from({ length: count }, () => {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(1.5, 5);
    return {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      life: rand(40, 70),
      maxLife: 70
    };
  });
}

function drawConfettiFrame(ctx, particles, width, height) {
  ctx.clearRect(0, 0, width, height);
  for (const p of particles) {
    p.x += p.speedX;
    p.y += p.speedY;
    p.rotation += p.rotationSpeed;
    p.life -= 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    ctx.restore();
  }
  return particles.filter((p) => p.life > 0 && p.y < height + 40);
}

function drawCoinFrame(ctx, particles, width, height) {
  ctx.clearRect(0, 0, width, height);
  for (const p of particles) {
    p.y += p.speedY;
    p.wobble += p.wobbleSpeed;
    p.life -= 1;
    const scaleX = Math.abs(Math.cos(p.wobble));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
    ctx.scale(Math.max(0.15, scaleX), 1);
    ctx.beginPath();
    ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
    ctx.fillStyle = COIN_COLOR;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#B8860B";
    ctx.stroke();
    ctx.restore();
  }
  return particles.filter((p) => p.life > 0 && p.y < height + 40);
}

function drawFireworkFrame(ctx, particles, width, height) {
  ctx.clearRect(0, 0, width, height);
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.05; // gravidade leve
    p.life -= 1;
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  return particles.filter((p) => p.life > 0);
}

function drawCrownGlowFrame(ctx, t, width, height) {
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  const pulse = 0.6 + 0.4 * Math.sin(t / 18);
  const radius = Math.min(width, height) * 0.28 * pulse;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, "rgba(250, 204, 21, 0.55)");
  gradient.addColorStop(1, "rgba(250, 204, 21, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

// Roda a animação escolhida no canvas até acabar sozinha (confete/moedas/
// fogos) ou até o cleanup ser chamado (coroa, que é um brilho contínuo
// enquanto o card estiver na tela). Devolve a função de parada.
export function runCelebrationEffect(canvas, type) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  let width = canvas.width = canvas.offsetWidth;
  let height = canvas.height = canvas.offsetHeight;
  let frame = 0;
  let stopped = false;
  let rafId = null;

  function resize() {
    width = canvas.width = canvas.offsetWidth;
    height = canvas.height = canvas.offsetHeight;
  }
  window.addEventListener("resize", resize);

  let particles = [];
  if (type === "confete") particles = makeConfettiParticles(width, 90);
  else if (type === "moedas") particles = makeCoinParticles(width, 60);
  else if (type === "fogos") particles = [];
  else if (type === "combo_200") particles = [];

  let nextBurstAt = 0;

  function loop() {
    if (stopped) return;
    frame += 1;

    if (type === "confete") {
      particles = drawConfettiFrame(ctx, particles, width, height);
      if (particles.length < 20 && frame < 150) particles.push(...makeConfettiParticles(width, 10));
    } else if (type === "moedas") {
      particles = drawCoinFrame(ctx, particles, width, height);
      if (particles.length < 15 && frame < 150) particles.push(...makeCoinParticles(width, 6));
    } else if (type === "fogos") {
      if (frame >= nextBurstAt) {
        particles.push(...makeFireworkBurst(rand(width * 0.25, width * 0.75), rand(height * 0.25, height * 0.55)));
        nextBurstAt = frame + rand(25, 45);
      }
      particles = drawFireworkFrame(ctx, particles, width, height);
    } else if (type === "coroa") {
      drawCrownGlowFrame(ctx, frame, width, height);
    } else if (type === "combo_200") {
      if (frame >= nextBurstAt) {
        particles.push(...makeFireworkBurst(rand(width * 0.2, width * 0.8), rand(height * 0.2, height * 0.5), 55));
        nextBurstAt = frame + rand(18, 30);
      }
      if (frame % 6 === 0 && frame < 220) particles.push(...makeConfettiParticles(width, 6));
      ctx.clearRect(0, 0, width, height);
      particles = particles.filter((p) => {
        if (p.rotation !== undefined) {
          p.x += p.speedX; p.y += p.speedY; p.rotation += p.rotationSpeed; p.life -= 1;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation);
          ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
          ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore();
          return p.life > 0 && p.y < height + 40;
        }
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= 1;
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
        return p.life > 0;
      });
    }

    rafId = requestAnimationFrame(loop);
  }

  rafId = requestAnimationFrame(loop);

  return () => {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resize);
    ctx.clearRect(0, 0, width, height);
  };
}

export const CELEBRATION_ANIMATIONS = ["confete", "fogos", "moedas", "coroa", "combo_200"];

// Aparelho fraco (poucos núcleos ou pouca memória) recebe metade das
// partículas nas cenas cinematográficas — mira em 60fps no celular em vez de
// travar. Heurística simples e barata, sem medir FPS de verdade.
export function getParticleQuality() {
  if (typeof navigator === "undefined") return "high";
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  return cores <= 4 || memory <= 4 ? "low" : "high";
}

const CINEMATIC_PALETTE = ["#F4C86B", "#FFE9A8", "#FFFFFF", "#1769D1"];

function makeExplosionParticles(cx, cy, count) {
  return Array.from({ length: count }, () => {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(3, 9);
    return {
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - rand(1, 3),
      size: rand(5, 11),
      rotation: rand(0, Math.PI * 2),
      rotationSpeed: rand(-0.2, 0.2),
      color: CINEMATIC_PALETTE[Math.floor(Math.random() * CINEMATIC_PALETTE.length)],
      life: rand(90, 150)
    };
  });
}

// Explosão radial de papel picado (dourado/branco/marca) a partir do centro,
// com gravidade e atrito — usada no pico das cenas cinematográficas (ex.:
// fechamento do anel dos 100%). Diferente de `runCelebrationEffect("confete")`,
// que é uma chuva contínua vinda do topo da tela.
export function burstConfettiExplosion(canvas, { quality = "high" } = {}) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  let width = (canvas.width = canvas.offsetWidth);
  let height = (canvas.height = canvas.offsetHeight);
  function resize() {
    width = canvas.width = canvas.offsetWidth;
    height = canvas.height = canvas.offsetHeight;
  }
  window.addEventListener("resize", resize);

  const count = quality === "low" ? 60 : 140;
  let particles = makeExplosionParticles(width / 2, height / 2, count);
  let stopped = false;
  let rafId = null;

  function loop() {
    if (stopped) return;
    ctx.clearRect(0, 0, width, height);
    particles = particles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.vx *= 0.99;
      p.rotation += p.rotationSpeed;
      p.life -= 1;
      if (p.life <= 0 || p.y > height + 40) return false;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
      return true;
    });
    if (particles.length) rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  return () => {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resize);
    ctx.clearRect(0, 0, width, height);
  };
}
