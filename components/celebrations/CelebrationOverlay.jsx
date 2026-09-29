"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { motion } from "motion/react";

// Cenas carregadas sob demanda (lazy) — o CRM inteiro não paga o custo dessas
// animações; só quem realmente vai ver um reconhecimento baixa o código dela.
// Novo gatilho com cena própria: importe aqui e registre em SCENE_BY_TRIGGER.
const Scene100 = dynamic(() => import("./scenes/Scene100"), { ssr: false });
const GenericScene = dynamic(() => import("./scenes/GenericScene"), { ssr: false });

const SCENE_BY_TRIGGER = {
  daily_goal_100: Scene100
};

// Duração total de cada cena (4-6s, pedido do dono) — cenas ainda não
// migradas (GenericScene) seguem a duração por tipo de animação.
const SCENE_DURATION_MS = { daily_goal_100: 5300 };
const GENERIC_DURATION_MS = { confete: 4000, fogos: 4500, moedas: 4000, coroa: 4000, combo_200: 5000 };

// Casca do overlay: fundo fixo em tela cheia, fecha sozinho ou por toque/
// clique (nunca trava o CRM), e delega todo o resto (fundo, herói, texto,
// partículas) pra cena escolhida por gatilho. previewMode = true é usado
// pelo botão "Testar" do admin: mesmo componente, nenhuma chamada de rede,
// nenhum evento gravado.
export default function CelebrationOverlay({ message, animation = "confete", triggerKey, onDismiss, previewMode = false }) {
  const Scene = (triggerKey && SCENE_BY_TRIGGER[triggerKey]) || null;
  const duration = Scene ? SCENE_DURATION_MS[triggerKey] : (GENERIC_DURATION_MS[animation] || 4000);

  useEffect(() => {
    const timer = setTimeout(() => onDismiss?.(), duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <motion.div
      className="fixed inset-0 z-[200]"
      style={{ "--cel-gold": "#F4C86B", "--cel-gold-bright": "#FFE9A8", "--cel-brand": "#1769D1", "--cel-navy": "#0D3B66" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      onClick={() => onDismiss?.()}
      role="dialog"
      aria-modal="true"
      aria-label="Reconhecimento"
    >
      {Scene ? <Scene message={message} /> : <GenericScene message={message} animation={animation} />}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss?.();
        }}
        className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] z-10 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-white/85 backdrop-blur transition hover:bg-white/20"
      >
        {previewMode ? "Fechar prévia" : "Fechar"}
      </button>
    </motion.div>
  );
}
