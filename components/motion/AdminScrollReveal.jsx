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
    let loadingTries = 0;
    const start = () => {
      if (getActiveSnapshot() && tries++ < 12) {
        timer = window.setTimeout(start, 250);
        return;
      }
      const root = document.getElementById(rootId);
      // Esqueleto da troca de tela (components/AdminRouteLoading.jsx) ainda no lugar: espera a tela de verdade chegar,
      // para a primeira varredura (a entrada em cascata) acontecer nela, como antes do esqueleto existir.
      if (root?.querySelector("[data-admin-route-loading]") && loadingTries++ < 300) {
        timer = window.setTimeout(start, 100);
        return;
      }
      stop = revealOnScroll(root);
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
