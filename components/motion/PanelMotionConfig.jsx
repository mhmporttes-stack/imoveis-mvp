"use client";

import { MotionConfig } from "motion/react";

// Reduzir movimento no painel inteiro (dono, 2026-10-25, item 7): com `reducedMotion="user"` todo componente `motion.*`
// do painel (Supervisão, Central de Alertas, Henry, cenas...) respeita a preferência do sistema — some o deslocamento,
// a escala e o giro (x, y, scale, rotate, layout) e fica a opacidade/cor que explicam o estado. Sem a preferência
// ligada nada muda. Animações imperativas (`animate()`) e CSS têm o caminho reduzido próprio de cada cena.
export default function PanelMotionConfig({ children }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
