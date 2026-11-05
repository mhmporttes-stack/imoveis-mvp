// "Puxar para atualizar" do painel (dono, 2026-11-04) — regras PURAS (testes: tests/pull-to-refresh-core.test.mjs).
// "Arrastar para baixo em qualquer lugar, segurar um pouquinho, soltar: atualiza." Só dispara com a tela no topo, um dedo,
// puxada mais vertical que lateral, passando da distância mínima E segurando um instante; soltar antes cancela.

export const PULL_START_SLOP_PX = 8; // movimento mínimo para considerar que é uma puxada
export const PULL_THRESHOLD_PX = 64; // distância (já com resistência) para "armar"
export const PULL_MAX_PX = 110; // até onde o indicador desce
export const PULL_HOLD_MS = 350; // segurar depois de passar da distância ("segure um pouquinho")
export const PULL_RESISTANCE = 0.5; // o indicador anda metade do dedo

// Distância do indicador para o quanto o dedo andou.
export function pullDistance(deltaY) {
  const dy = Number(deltaY);
  if (!Number.isFinite(dy) || dy <= 0) return 0;
  return Math.min(PULL_MAX_PX, dy * PULL_RESISTANCE);
}

// Primeira decisão de um movimento: "ignore" (não é puxada: foi para cima ou mais para o lado), "wait" (ainda curto) ou "pull".
export function classifyMove({ dx = 0, dy = 0 } = {}) {
  if (dy < 0) return "ignore";
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > PULL_START_SLOP_PX) return "ignore";
  if (dy < PULL_START_SLOP_PX) return "wait";
  return "pull";
}

// Fases: "idle" | "pulling" (puxando, ainda curto) | "ready" (passou da distância, esperando o tempo) | "armed" (pode soltar).
export function phaseFor({ distance = 0, heldMs = 0 } = {}) {
  if (distance < PULL_THRESHOLD_PX) return distance > 0 ? "pulling" : "idle";
  return heldMs >= PULL_HOLD_MS ? "armed" : "ready";
}

export function pullLabel(phase) {
  if (phase === "armed") return "Solte para atualizar";
  if (phase === "ready") return "Segure…";
  if (phase === "refreshing") return "Atualizando…";
  return "Puxe para atualizar";
}

// Onde NÃO começa a puxada: digitando, camada aberta (gaveta/modal/Henry em tela cheia) ou lista interna rolada para baixo.
export function isPullBlocked({ insideField = false, insideDialog = false, overlayOpen = false, scrollerOffTop = false, pageOffTop = false } = {}) {
  return Boolean(insideField || insideDialog || overlayOpen || scrollerOffTop || pageOffTop);
}
