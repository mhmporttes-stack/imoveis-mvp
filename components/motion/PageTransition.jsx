"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

// Rotas em que a troca de página ganha uma transição (tela atual sai,
// próxima entra) — hoje só a Meta Diária, entrando ou saindo dela. As
// demais navegações do painel continuam exatamente como eram, sem efeito,
// pra não mudar comportamento de telas que não pediram isso. Adicionar uma
// rota nova aqui é só incluir o path neste Set.
const TRANSITION_ROUTES = new Set(["/admin/meta-diaria"]);

// Vive uma vez só no layout compartilhado (app/admin/layout.jsx), envolvendo
// {children} — cada página continua exatamente a mesma por dentro; isso só
// anima a TROCA de rota. Só transform/opacity; com prefers-reduced-motion
// ativo, não anima nada (troca instantânea, como antes).
export default function PageTransition({ children }) {
  const pathname = usePathname();
  const reducedMotion = usePrefersReducedMotion();
  const previousPathname = useRef(pathname);
  const leavingOrEnteringTransitionRoute = TRANSITION_ROUTES.has(pathname) || TRANSITION_ROUTES.has(previousPathname.current);
  previousPathname.current = pathname;

  if (reducedMotion || !leavingOrEnteringTransitionRoute) return children;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.99 }}
        transition={{ duration: 0.22, ease: "easeInOut" }}
        style={{ willChange: "transform, opacity" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
