"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import scene from "@/components/scenes/scenes.module.css";

// Cena carregada sob demanda (lazy) — o CRM inteiro não paga o custo das
// animações; só quem realmente vai ver um reconhecimento baixa o código dela.
const RecognitionScene = dynamic(() => import("./scenes/RecognitionScene"), { ssr: false });

// Casca do overlay: tela cheia no fundo do tema. [REGRA OFICIAL DE NEGÓCIO —
// dono, 2026-10-22, RAN-9] NÃO fecha sozinha: fica parada até o corretor tocar
// (para tirar print/story). Fecha por toque/clique em qualquer lugar, pelo
// botão do rodapé ou Esc — nunca trava o CRM. previewMode = true é usado pelo
// botão "Testar" do admin: mesmo componente, nenhuma chamada de rede, nenhum
// evento gravado.
export default function CelebrationOverlay({ message, animation = "confete", triggerKey, onDismiss, previewMode = false, userName = "", userPhotoUrl = "" }) {
  const rootRef = useRef(null);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onDismiss?.();
    };
    document.addEventListener("keydown", onKeyDown);
    // Foco na própria cena (sem anel visível, para não sujar o print); Tab chega ao botão de fechar.
    const focusTimer = setTimeout(() => rootRef.current?.focus({ preventScroll: true }), 300);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearTimeout(focusTimer);
    };
  }, [onDismiss]);

  return (
    <motion.div
      ref={rootRef}
      tabIndex={-1}
      className={`${scene.theme} fixed inset-0 z-[200] outline-none`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      onClick={() => onDismiss?.()}
      role="dialog"
      aria-modal="true"
      aria-label="Reconhecimento"
    >
      <RecognitionScene
        message={message}
        animation={animation}
        triggerKey={triggerKey}
        userName={userName}
        userPhotoUrl={userPhotoUrl}
        previewMode={previewMode}
        closeLabel={previewMode ? "Fechar prévia" : "Toque na tela para fechar"}
      />
    </motion.div>
  );
}
