"use client";

import { useEffect } from "react";
import { CHAT_HOME, isStandaloneApp, setPwaHome } from "@/components/pwaHome";

// Marca o modo "só Chat" e, no app "Chat" instalado, lembra a casa (/chat-app) para que qualquer tela do painel aberta nesta
// janela (ex.: toque numa notificação) volte para o Chat (components/FinanceiroAppGuard.jsx).
export default function ChatAppHome() {
  useEffect(() => {
    // Modo "só Chat" também quando se chega aqui por navegação interna (ex.: depois do login), em que o
    // script do layout não roda de novo — sem isto a faixa da barra inferior e o desfoque do topo voltavam.
    document.documentElement.setAttribute("data-mm-app", "chat");
    if (isStandaloneApp()) setPwaHome(CHAT_HOME);
  }, []);
  return null;
}
