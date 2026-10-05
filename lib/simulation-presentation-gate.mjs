// Trava das cenas finais da apresentação (PURO: importado pelo servidor e pelo player no navegador).
// A cena "Próximo passo" é o fim do fluxo automático; "esse é o próximo passo!" e "documentos" só abrem depois do
// botão VALIDAR SIMULAÇÃO. Nada é enviado nem gravado por esse botão: ele só libera o avanço dentro da apresentação.

/** Cenas alcançáveis só depois de VALIDAR SIMULAÇÃO. */
export const PRESENTATION_GATED_SCENES = ["validar", "documentos"];

/** Quantas cenas já podem ser navegadas (antes de VALIDAR: até a cena "Próximo passo"; depois: todas). */
export function navigableSceneCount(scenes = [], unlocked = false) {
  if (unlocked) return scenes.length;
  const gateIndex = scenes.findIndex((scene) => PRESENTATION_GATED_SCENES.includes(scene?.id));
  return gateIndex < 0 ? scenes.length : gateIndex;
}
