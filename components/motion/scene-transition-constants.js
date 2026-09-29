// Durações/timing da coreografia de cenas (SceneTransitionLink +
// SceneTransitionRoot) num só lugar, pra ajustar fácil depois.
export const EXIT_DURATION = 1; // Cena 1 (saída do painel principal), ida
export const ENTER_DURATION = 1; // Cena 2 (entrada da área de destino), ida
export const REVERSE_DURATION = 0.6; // volta (Meta Diária -> painel principal), as duas fases
export const STAGGER_GAP = 0.07; // atraso entre cada bloco da tela na saída/entrada
export const ROOT_ID = "scene-transition-root";
