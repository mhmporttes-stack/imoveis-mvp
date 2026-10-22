"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { revealOnScroll } from "./scroll-reveal";
import { getActiveSnapshot } from "./scene-transition-store";
import { ROOT_ID } from "./scene-transition-constants";

// Liga a entrada por rolagem (components/motion/scroll-reveal.js) em toda tela do painel, a cada troca de tela.
// Fora: Chat (cenas e moldura próprias) e Meta Diária (coreografia de cenas própria, SceneTransitionLink/SceneGate).
// Espera a cena de troca de tela terminar antes de varrer, para as duas animações não se somarem.
const SKIP = /^\/admin\/(chat|meta-diaria)(\/|$)/;

export default function AdminScrollReveal({ rootId = ROOT_ID }) {
  const pathname = usePathname() || "";

  useEffect(() => {
    if (SKIP.test(pathname)) return undefined;
    let stop = () => {};
    let tries = 0;
    let timer = 0;
    const start = () => {
      if (getActiveSnapshot() && tries++ < 12) {
        timer = window.setTimeout(start, 250);
        return;
      }
      stop = revealOnScroll(document.getElementById(rootId));
    };
    const frame = window.requestAnimationFrame(start);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      stop();
    };
  }, [pathname, rootId]);

  return null;
}
