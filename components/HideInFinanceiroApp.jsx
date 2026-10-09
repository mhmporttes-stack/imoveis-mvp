"use client";

import { useEffect, useState } from "react";
import { getMmApp } from "@/components/pwaHome";

// Não monta o conteúdo (popups, mensagens, celebrações) dentro dos apps "Financeiro" e "Chat" da tela inicial.
export default function HideInFinanceiroApp({ children }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => { setHidden(Boolean(getMmApp())); }, []);
  return hidden ? null : children;
}
