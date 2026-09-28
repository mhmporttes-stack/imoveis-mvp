// Progresso visual: só a conclusão confirmada pelo servidor libera 100%.
export function chatDocumentProgress(elapsedMs, completed = false) {
  if (completed) return 100;
  return Math.min(94, Math.max(0, Math.floor(94 * (1 - Math.exp(-Math.max(0, elapsedMs) / 22000)))));
}
