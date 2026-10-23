// Feixe padrão do Henry (dono, 2026-10-23, protótipo v18) — desenho PURO (só canvas 2D, sem React), testável:
// 5 fios finos vibrando bem juntos, gradiente da cor até o branco e 2 gotinhas brancas correndo. Usado pelo Pulso do CRM
// (HenryPulse) e pela camada HenryStrandBeams (Spotify, cards e scanner de corretor). Não crie outro desenho de feixe.

export const HENRY_BEAM_GOLD = "#e9c27a";
export const HENRY_BEAM_CYAN = "#5cd6ff";
export const HENRY_BEAM_GROW_MS = 600;
const STRANDS = 5;

// Desenha um feixe já posicionado. point(u) = ponto da curva (0 = anel, 1 = card); reach = quanto dela já existe (0–1);
// sx/sy = início (gradiente); color em hex #rrggbb; dim = 0–1 (apagado quando o Henry pensa/fala).
export function drawStrandBeam(ctx, { point, sx, sy, reach, color, t, seed = 0, reduced = false, dim = 1 }) {
  if (!(reach > 0.001)) return;
  const [ex, ey] = point(reach);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowColor = color;
  for (let s = 0; s < STRANDS; s += 1) {
    const strandPhase = s * 1.9 + seed;
    const amp = 3 + s * 0.8;
    ctx.beginPath();
    for (let u = 0; u <= reach + 0.0001; u += 0.02) {
      const uu = Math.min(u, reach);
      const [px, py] = point(uu);
      const [qx, qy] = point(Math.min(1, uu + 0.01));
      const l = Math.hypot(qx - px, qy - py) || 1;
      const envelope = Math.sin(Math.PI * Math.min(1, uu / Math.max(reach, 0.001))); // zero nas pontas: os fios se reencontram
      const v = reduced ? 0 : (Math.sin(uu * 22 + t * 0.012 + strandPhase) * 0.6 + Math.sin(uu * 47 - t * 0.02 + strandPhase * 1.7) * 0.4) * amp * envelope;
      const x = px + (-(qy - py) / l) * v;
      const y = py + ((qx - px) / l) * v;
      if (u === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const gradient = ctx.createLinearGradient(sx, sy, ex, ey);
    gradient.addColorStop(0, `${color}10`);
    gradient.addColorStop(0.5, `${color}aa`);
    gradient.addColorStop(1, "#ffffffcc");
    ctx.strokeStyle = gradient;
    ctx.shadowBlur = s === 2 ? 10 : 0; // glow só no fio central (leve sem GPU)
    ctx.lineWidth = (s === 2 ? 1.2 : 0.7) * (0.6 + dim * 0.4);
    ctx.globalAlpha = (0.55 + (s === 2 ? 0.35 : 0)) * dim;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 8;
  ctx.fillStyle = "#ffffff";
  for (let drop = 0; drop < 2; drop += 1) {
    const [dx, dy] = point(((t * 0.0016 + drop * 0.5) % 1) * reach);
    ctx.beginPath();
    ctx.arc(dx, dy, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Curva quadrática início → controle → fim (as cenas já calculam esses três pontos).
export function quadraticPoint([sx, sy], [qx, qy], [ex, ey]) {
  return (u) => {
    const m = 1 - u;
    return [m * m * sx + 2 * m * u * qx + u * u * ex, m * m * sy + 2 * m * u * qy + u * u * ey];
  };
}
