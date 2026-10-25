import { notFound } from "next/navigation";
import SceneTransitionRoot from "@/components/motion/SceneTransitionRoot";

// Banco de prova da transição de tela (Meta Diária) — SOMENTE DESENVOLVIMENTO (`.dev.jsx`). Mesmo SceneTransitionRoot
// do painel, duas páginas fictícias: A (leve) e B (pesada, simula a Meta Diária montando). Medição: CHANGELOG_AI 2026-10-25.
export default function CenaLayout({ children }) {
  if (process.env.NODE_ENV === "production") notFound();
  return <SceneTransitionRoot>{children}</SceneTransitionRoot>;
}
