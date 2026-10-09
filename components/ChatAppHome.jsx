"use client";

import { useEffect } from "react";
import { CHAT_HOME, isStandaloneApp, setPwaHome } from "@/components/pwaHome";

// No app "Chat" instalado: lembra a casa (/chat-app) para que qualquer tela do painel aberta nesta
// janela (ex.: toque numa notificação) volte para o Chat (components/FinanceiroAppGuard.jsx).
export default function ChatAppHome() {
  useEffect(() => {
    if (isStandaloneApp()) setPwaHome(CHAT_HOME);
  }, []);
  return null;
}
