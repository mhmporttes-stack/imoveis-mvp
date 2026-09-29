"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { animate } from "motion/react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { beginScene, markSceneDone, getActiveSnapshot, setPendingDirection } from "./scene-transition-store";
import { EXIT_DURATION, REVERSE_DURATION, ROOT_ID, STAGGER_GAP } from "./scene-transition-constants";

// Link reutilizável que toca a Cena 1 (saída) enquanto navega: os blocos
// diretos da tela atual (dentro de #scene-transition-root, montado uma vez
// em app/admin/layout.jsx) saem para a lateral em sequência curta (stagger)
// — só transform (x) e opacity. Ao terminar (ou ser pulado por um toque na
// tela, via SceneSkipCatcher), a Cena 2 (entrada) é tocada por
// SceneTransitionRoot ao detectar a chegada.
//
// A navegação começa JUNTO com a Cena 1 (não depois dela) — se a tela nova
// depender de dado do servidor, o carregamento acontece escondido durante os
// segundos da própria animação em vez de criar uma pausa parada depois que
// a Cena 1 já terminou (era isso que fazia a transição parecer "sem efeito").
//
// direction="forward": sai para a esquerda, dura EXIT_DURATION.
// direction="backward" (voltar): espelhado, dura REVERSE_DURATION (mais curto).
// Clique duplo/repetido enquanto uma cena já está em andamento é ignorado.
export default function SceneTransitionLink({ href, direction = "forward", className, children, ...rest }) {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();

  function handleClick(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();

    if (reducedMotion) {
      router.push(href);
      return;
    }
    if (getActiveSnapshot()) return;

    setPendingDirection(direction);
    router.push(href);

    const root = document.getElementById(ROOT_ID);
    const blocks = root ? Array.from(root.children) : [];
    if (!blocks.length) return;

    const exitX = direction === "forward" ? "-15%" : "15%";
    const duration = direction === "forward" ? EXIT_DURATION : REVERSE_DURATION;
    const controls = animate(blocks, { x: exitX, opacity: 0 }, { duration, delay: (i) => i * STAGGER_GAP, ease: [0.4, 0, 0.2, 1] });

    const finish = () => markSceneDone();
    beginScene({ controls, onFinish: finish });
    controls.then(finish);
  }

  return (
    <Link href={href} onClick={handleClick} className={className} {...rest}>
      {children}
    </Link>
  );
}
